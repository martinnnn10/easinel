import type { RetrievedChunk } from "@/lib/rag/retrieve";

// EXPERT ANSWER LAYER for the offline engine. A technician who asks "what's the
// undervoltage code for a PowerFlex drive?" wants "F004 — UnderVoltage", not a
// pile of document passages. This module reads the fault tables that live in the
// retrieved OEM/plant chunks and produces a DIRECT, structured expert answer.
//
// It returns "" when the question isn't a fault-code question, so the caller can
// fall back to the general grounded/expert paths.

export interface FaultEntry {
  code: string; // e.g. "F004"
  name: string; // e.g. "UnderVoltage"
  meaning: string; // first clause after the dash
  checks: string; // remaining guidance ("Check ...")
  filename: string;
  marker: number; // 1-based source index (matches UI "Sources")
}

// A fault line looks like:
//   F004 UnderVoltage — DC bus below limit. Check incoming supply, voltage sags…
// We accept F/E/A + digits, an em- or hyphen-dash, and split meaning vs. checks.
const FAULT_LINE = /\b([FEA]\d{2,4})\b[ \t]+([A-Za-z][A-Za-z0-9 /\-]{1,40}?)\s*[—–-]\s*(.+)/;

export function parseFaultEntries(ctx: RetrievedChunk[]): FaultEntry[] {
  const out: FaultEntry[] = [];
  const seen = new Set<string>();
  ctx.forEach((chunk, i) => {
    for (const raw of chunk.content.split(/\n+/)) {
      const line = raw.trim();
      const m = line.match(FAULT_LINE);
      if (!m) continue;
      const code = m[1].toUpperCase();
      const name = m[2].trim();
      const rest = m[3].trim();
      // Split "DC bus below limit. Check incoming supply…" → meaning + checks.
      const dot = rest.search(/\.\s/);
      const meaning = (dot > 0 ? rest.slice(0, dot) : rest).replace(/\.$/, "").trim();
      const checks = dot > 0 ? rest.slice(dot + 1).trim() : "";
      const key = code + "|" + chunk.filename;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ code, name, meaning, checks, filename: chunk.filename, marker: i + 1 });
    }
  });
  return out;
}

// Map a symptom the user typed to the words a fault NAME/MEANING would contain.
const SYMPTOM_TERMS: { symptom: RegExp; match: RegExp; label: string }[] = [
  { symptom: /under\s?voltage|low (dc )?(bus|voltage)|bus low/i, match: /undervoltage|under voltage|dc bus below/i, label: "undervoltage" },
  { symptom: /over\s?voltage|bus (too )?high|high (dc )?bus/i, match: /overvoltage|over voltage|dc bus too high/i, label: "overvoltage" },
  { symptom: /over\s?load|thermal (overload|trip)|i2t|motor overload/i, match: /overload/i, label: "overload" },
  { symptom: /over\s?current|instantaneous|short circuit/i, match: /overcurrent|over current/i, label: "overcurrent" },
  { symptom: /ground fault|earth fault|leakage to ground/i, match: /ground fault|ground/i, label: "ground fault" },
  { symptom: /comm(unication)?s? (loss|fault|error)|network (loss|down)|lost (comms|connection)|offline/i, match: /comm loss|comm|network|ethernet/i, label: "communication loss" },
  { symptom: /safe torque|sto|e-?stop|safety string|gate guard/i, match: /safe torque|sto/i, label: "safe torque off" },
  { symptom: /power unit|internal (hardware|fault)/i, match: /power unit/i, label: "power unit fault" },
];

interface FaultQuery {
  kind: "code" | "symptom";
  code?: string;
  symptomMatch?: RegExp;
  symptomLabel?: string;
}

// Decide whether the question is asking for a fault CODE (by code or by symptom).
export function detectFaultQuery(question: string): FaultQuery | null {
  const q = question.toLowerCase();
  // Direct code, e.g. "what does F004 mean", "fault f 007", "code f081".
  const codeMatch = q.match(/\b([fea])\s?(\d{2,4})\b/i);
  const mentionsCodeIntent = /\b(code|fault|error|trip|means?|f\d)/i.test(q);
  if (codeMatch && mentionsCodeIntent) {
    return { kind: "code", code: (codeMatch[1] + codeMatch[2]).toUpperCase() };
  }
  // Symptom → code, e.g. "what code is under voltage for a powerflex".
  for (const s of SYMPTOM_TERMS) {
    if (s.symptom.test(q)) {
      return { kind: "symptom", symptomMatch: s.match, symptomLabel: s.label };
    }
  }
  return null;
}

function whenToWorkOrder(name: string): string {
  return `Open a work order if the fault **recurs** after you clear it, if clearing it requires replacing a part (fuse, contactor, drive, sensor), or if the root cause is not an obvious one-time external event. Record the fault code, what you found, and the fix so the machine's history captures the ${name.toLowerCase()} pattern.`;
}

// Build the direct expert answer. Returns "" if this isn't a fault-code question
// or no matching fault line was found in the retrieved references.
export function buildFaultCodeAnswer(question: string, ctx: RetrievedChunk[]): string {
  const query = detectFaultQuery(question);
  if (!query) return "";
  const entries = parseFaultEntries(ctx);
  if (!entries.length) return "";

  let hit: FaultEntry | undefined;
  if (query.kind === "code") {
    // Normalize the code space (F04 vs F004) by comparing the numeric part.
    const num = query.code!.replace(/^[FEA]/, "").replace(/^0+/, "");
    hit = entries.find((e) => e.code.replace(/^[FEA]/, "").replace(/^0+/, "") === num);
  } else {
    hit = entries.find((e) => query.symptomMatch!.test(e.name) || query.symptomMatch!.test(e.meaning));
  }
  if (!hit) return "";

  const device = /powerflex/i.test(question) || /powerflex/i.test(hit.filename)
    ? "PowerFlex 525"
    : "this drive";
  const meaning = hit.meaning ? `${hit.meaning}.` : "";
  const checks = hit.checks
    ? hit.checks.replace(/^check\s+/i, "").replace(/\.$/, "")
    : "";

  const parts: string[] = [];
  const opener =
    query.kind === "symptom"
      ? `On a ${device}, the ${query.symptomLabel} fault is **${hit.code} (${hit.name})**.`
      : `On a ${device}, **${hit.code}** is the **${hit.name}** fault.`;
  parts.push(`## Answer\n**${hit.code} — ${hit.name}.** ${opener}`);
  if (meaning) parts.push(`## What It Means\n${meaning}.`);
  const items = checks
    ? checks.split(/,|;| and /i).map((s) => s.trim()).filter(Boolean)
    : [];
  if (items.length) {
    parts.push(
      `## Likely Causes\n${items.map((it) => `- ${cap(it)}`).join("\n")}`
    );
    parts.push(
      `## What To Check First\n${items.map((it, i) => `${i + 1}. ${cap(it)}.`).join("\n")}`
    );
  }
  parts.push(
    `## Safety\n- Follow LOTO before touching terminals. On a VFD the **DC bus holds lethal voltage for up to 5 minutes** after power-off — verify 0 VDC first.\n- Never defeat a safety (STO / e-stop / guard) string to clear a fault.`
  );
  parts.push(`## When To Create a Work Order\n${whenToWorkOrder(hit.name)}`);
  parts.push(`## Confidence\n**High** — matched to the OEM fault reference for this equipment class.`);
  parts.push(`## Sources Used\n{{REFS}}`);
  return parts.join("\n\n");
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
