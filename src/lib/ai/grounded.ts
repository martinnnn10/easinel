import type { RetrievedChunk } from "@/lib/rag/retrieve";

// Extractive, HONEST grounding for the offline engine (no live LLM configured).
// Instead of emitting a content-free template that merely lists filenames, this
// actually READS the retrieved document chunks and surfaces the passages that
// answer the technician's question — quoted verbatim, with the source number
// that matches the UI's "Sources" list. When there is no LLM to synthesize,
// "grounded" must mean: show the operator exactly what their own documents say.

const STOP = new Set([
  "the", "a", "an", "and", "or", "to", "of", "in", "on", "is", "are", "my",
  "why", "what", "how", "this", "that", "it", "for", "with", "i", "do", "does",
  "should", "check", "first", "show", "me", "at", "be", "by", "as", "if", "so",
  "out", "up", "can", "will", "was", "has", "have", "not", "no", "you", "your",
  "when", "where", "which", "any", "all", "get", "got", "into", "from", "but",
]);

// Domain synonym expansion so a terse query term matches the words a manual or
// drawing actually uses. Keys are what a technician types; values are the words
// the document is likely to contain. This dramatically raises recall on real,
// jargon-dense plant documents.
const SYNONYMS: Record<string, string[]> = {
  rtd: ["resistance", "temperature", "detector", "pt100", "pt1000", "thermistor", "sensor", "thermocouple", "probe", "3-wire", "4-wire"],
  temp: ["temperature", "thermal", "heat", "degrees", "deg"],
  temperature: ["thermal", "rtd", "thermocouple", "sensor", "probe"],
  fault: ["fault", "faulted", "faulty", "alarm", "trip", "tripped", "error", "fail", "failed", "failure", "open", "short", "broken", "loss"],
  faulted: ["fault", "alarm", "trip", "error", "open", "short", "broken", "failure", "out-of-range", "overrange", "underrange"],
  overload: ["overload", "overcurrent", "amps", "current", "thermal", "trip", "ol"],
  comms: ["communication", "network", "ethernet", "dpi", "connection", "cable", "node", "scanner"],
  drive: ["vfd", "inverter", "powerflex", "motor", "drive"],
  vfd: ["drive", "inverter", "powerflex", "motor"],
  motor: ["motor", "winding", "bearing", "current", "amps"],
  pressure: ["pressure", "psi", "transducer", "transmitter", "bar"],
  leak: ["leak", "seal", "gasket", "weep", "drip"],
  vibration: ["vibration", "vibe", "imbalance", "misalignment", "bearing", "fft"],
  wire: ["wire", "wiring", "terminal", "lead", "conductor", "cable", "landing"],
  sensor: ["sensor", "transducer", "transmitter", "probe", "input", "channel"],
  channel: ["channel", "input", "module", "point", "terminal"],
  module: ["module", "card", "input", "channel", "slot"],
  reading: ["reading", "value", "signal", "measurement", "indication", "scaling"],
};

function tokenize(s: string): string[] {
  return (s.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter(
    (t) => t.length > 1 && !STOP.has(t)
  );
}

// Query terms weighted: the technician's OWN words carry full weight; the
// synonym expansions carry partial weight (they help recall without letting a
// generic synonym outrank a direct hit).
interface WeightedTerms {
  core: Set<string>; // the operator's literal words
  expanded: Set<string>; // synonyms, lower weight
}

function buildTerms(question: string): WeightedTerms {
  const core = new Set(tokenize(question));
  const expanded = new Set<string>();
  for (const t of core) {
    for (const syn of SYNONYMS[t] ?? []) {
      if (!core.has(syn)) expanded.add(syn);
    }
  }
  return { core, expanded };
}

// Split a (possibly messy, punctuation-poor) PDF/plaintext chunk into candidate
// passages. We split on sentence terminators AND newlines, since extracted
// drawing/manual text is often line-oriented rather than sentence-oriented.
function splitPassages(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => s.length >= 12 && s.length <= 400);
}

function scorePassage(passage: string, terms: WeightedTerms): number {
  const toks = new Set(tokenize(passage));
  let score = 0;
  for (const t of terms.core) if (toks.has(t)) score += 2; // direct word hit
  for (const t of terms.expanded) if (toks.has(t)) score += 1; // synonym hit
  // Small bonus for passages that read like actionable guidance.
  if (/\b(check|verify|inspect|replace|measure|ensure|confirm|caused|indicates?|means?)\b/i.test(passage))
    score += 1;
  return score;
}

export interface GroundedPassage {
  text: string;
  filename: string;
  kind: string;
  marker: number; // 1-based source number matching the UI "Sources" list
}

// Pull the most relevant passages out of the retrieved chunks. `ctx` order MUST
// match the caller's `sources` array so `marker` lines up with the UI numbering.
export function extractRelevantPassages(
  question: string,
  ctx: RetrievedChunk[],
  maxPassages = 5
): GroundedPassage[] {
  const terms = buildTerms(question);
  if (terms.core.size === 0) return [];
  const scored: (GroundedPassage & { score: number })[] = [];
  ctx.forEach((chunk, i) => {
    for (const passage of splitPassages(chunk.content)) {
      const score = scorePassage(passage, terms);
      if (score >= 2) {
        scored.push({
          text: passage,
          filename: chunk.filename,
          kind: chunk.kind,
          marker: i + 1,
          score,
        });
      }
    }
  });
  scored.sort((a, b) => b.score - a.score);
  // De-duplicate near-identical passages (PDFs repeat headers/footers).
  const seen = new Set<string>();
  const out: GroundedPassage[] = [];
  for (const p of scored) {
    const key = p.text.toLowerCase().slice(0, 60);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ text: p.text, filename: p.filename, kind: p.kind, marker: p.marker });
    if (out.length >= maxPassages) break;
  }
  return out;
}

// True when the retrieved documents actually contain content relevant to the
// question — used by the caller to decide between a grounded answer and the
// honest "no matching content" fallback.
export function hasRelevantContent(question: string, ctx: RetrievedChunk[]): boolean {
  return extractRelevantPassages(question, ctx, 1).length > 0;
}

function summarizeRequest(q: string): string {
  const clean = q.replace(/\s+/g, " ").trim();
  return clean.length > 90 ? clean.slice(0, 87) + "…" : clean;
}

// Build a grounded answer that leads with what the documents ACTUALLY say. This
// is the offline engine's real deliverable: quoted, cited evidence from the
// operator's own uploads, followed by an honest action framing.
export function buildGroundedFromDocuments(
  question: string,
  ctx: RetrievedChunk[]
): string {
  const passages = extractRelevantPassages(question, ctx);
  if (!passages.length) return ""; // caller falls back to the honest generic

  const evidence = passages
    .map((p) => `- "${p.text}" — **${p.filename}** [${p.marker}]`)
    .join("\n");

  return `## What Your Documents Say
These passages from your uploaded documents match *"${summarizeRequest(question)}"* — read directly from the files, cited by source number:

${evidence}

## How to Act on This
1. **LOTO and verify zero energy** before any contact work on wiring or terminals.
2. Start with the highest-scoring passage above — it is the closest match in your documentation. Confirm the specific terminals, channel, or part numbers it names against the physical device.
3. Where the passage names a check (a reading, a terminal, a setting), take that measurement and compare it to the good/bad threshold the document gives.
4. If the document specifies a fault code or wiring detail, verify it end-to-end (source → wiring → input channel → controller) rather than swapping parts.
5. Record what you found and close the loop against this document.

## Safety Considerations
- Lockout/tagout and verify stored energy (electrical bus, hydraulic/pneumatic, gravity/spring) is discharged before touching wiring or terminals.
- Use PPE appropriate to the task; arc-flash rated for any energized verification.

## Confidence
**Medium** — grounded in ${passages.length} matching passage${passages.length === 1 ? "" : "s"} from your own documents. If a wiring/loop drawing for this exact device is attached, I can point to the specific terminals and channel.

## Sources Used
{{REFS}}`;
}
