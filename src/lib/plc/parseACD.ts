import { type PlcProjectIR, emptyIR, computeStats } from "./ir";

// ─────────────────────────────────────────────────────────────────────────
// .ACD (native Studio 5000 binary project) — SUMMARY ONLY.
//
// .ACD is an undocumented, proprietary binary container. Fully decoding it
// (programs/routines/rung logic) is out of scope for this MVP. What we CAN do
// reliably is scrape the readable metadata the binary embeds — the RSLogix/
// Studio 5000 save log (which records every save with its exact firmware
// revision and timestamp), and the internal component-class census (which
// reveals which programming languages the project actually uses) — so the user
// still gets an honest, useful summary node, plus a clear instruction to export
// to .L5X for the rich Explorer experience.
//
// This intentionally does NOT fabricate programs/tags/catalog numbers it cannot
// verify. Where a value is genuinely not stored in plaintext (e.g. the controller
// catalog number), it says so rather than guessing.
// ─────────────────────────────────────────────────────────────────────────

function scrapeStrings(buf: Buffer, min = 4): string[] {
  const out: string[] = [];
  let cur = "";
  for (let i = 0; i < buf.length; i++) {
    const c = buf[i];
    if (c >= 0x20 && c <= 0x7e) {
      cur += String.fromCharCode(c);
    } else {
      if (cur.length >= min) out.push(cur);
      cur = "";
    }
  }
  if (cur.length >= min) out.push(cur);
  return out;
}

interface AcdSaveEntry {
  ts: string;
  rev: string; // e.g. "32.00.00"
  build: string; // e.g. "3736.000"
}

function parseSaveLog(strings: string[]): {
  creation?: string;
  lastSaved?: AcdSaveEntry;
  firstRev?: string;
  allRevs: string[];
  saveCount: number;
} {
  const saves: AcdSaveEntry[] = [];
  let creation: string | undefined;
  const tsRe = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})(?:\.\d+)?:\s*(.*)$/;
  const savedRe = /Saved\s*-\s*V(\d+\.\d+\.\d+)\/(\d+\.\d+)/i;
  for (const s of strings) {
    const m = s.match(tsRe);
    if (!m) continue;
    const [, ts, rest] = m;
    if (/File Creation/i.test(rest) && !creation) creation = ts;
    const sm = rest.match(savedRe);
    if (sm) saves.push({ ts, rev: sm[1], build: sm[2] });
  }
  const allRevs = Array.from(new Set(saves.map((s) => s.rev)));
  return {
    creation,
    lastSaved: saves.length ? saves[saves.length - 1] : undefined,
    firstRev: saves.length ? saves[0].rev : undefined,
    allRevs,
    saveCount: saves.length,
  };
}

/** Census of internal Rockwell component classes → which languages are present. */
function detectLanguages(strings: string[]): {
  languages: string[];
  counts: Record<string, number>;
} {
  const counts: Record<string, number> = {};
  const bump = (k: string, n = 1) => (counts[k] = (counts[k] ?? 0) + n);
  for (const s of strings) {
    // Component-class tokens like RxFBD, RxSFC, RxSTX, RxLL (ladder)
    if (/^RxFBD\b/.test(s)) bump("Function Block (FBD)");
    else if (/^RxA?SFC\b/.test(s)) bump("Sequential Function Chart (SFC)");
    else if (/^RxA?STX?\b/.test(s)) bump("Structured Text (ST)");
    else if (/^RxA?LL\b/.test(s) || /^RxLadder/i.test(s)) bump("Ladder (RLL)");
  }
  const languages = Object.keys(counts).filter((k) => counts[k] > 0);
  return { languages, counts };
}

export function parseACD(buf: Buffer, filename: string): PlcProjectIR {
  const ir = emptyIR("acd");
  const strings = scrapeStrings(buf);

  const log = parseSaveLog(strings);
  const { languages } = detectLanguages(strings);

  // Catalog number is generally NOT stored as plaintext in the .ACD container,
  // so we only report it when a clean catalog token is genuinely present.
  let processor: string | undefined;
  const catRe = /\b(1769-L\w+|1768-L\w+|1756-L\w+|175\d-L\w+|5069-L\w+)\b/;
  for (const s of strings) {
    const m = s.match(catRe);
    if (m) {
      processor = m[1];
      break;
    }
  }

  // The current revision = the LAST recorded save (the project may have been
  // created on an older version and upgraded). Report major.minor.
  const lastRev = log.lastSaved?.rev; // e.g. "32.00.00"
  let majorRev: string | undefined;
  let minorRev: string | undefined;
  let softwareRevision: string | undefined;
  if (lastRev) {
    const parts = lastRev.split(".");
    majorRev = parts[0];
    minorRev = parts[1];
    softwareRevision = `${parts[0]}.${parts[1]}`; // "32.00"
  }

  const base = filename.replace(/\.acd$/i, "");

  // Build an honest, information-rich description.
  const lines: string[] = [
    "Imported from a native Studio 5000 .ACD project (proprietary binary). " +
      "EAS read the embedded metadata below; full structure requires an .L5X export.",
  ];
  if (softwareRevision)
    lines.push(
      `Firmware revision: V${log.lastSaved!.rev} (build ${log.lastSaved!.build}).`,
    );
  if (log.firstRev && lastRev && log.firstRev !== lastRev)
    lines.push(`Created on V${log.firstRev}, later upgraded to V${lastRev}.`);
  if (log.creation) lines.push(`Created: ${log.creation}.`);
  if (log.lastSaved) lines.push(`Last saved: ${log.lastSaved.ts}.`);
  if (log.saveCount) lines.push(`Save history: ${log.saveCount} recorded saves.`);
  if (languages.length)
    lines.push(`Programming languages detected: ${languages.join(", ")}.`);
  if (!processor)
    lines.push(
      "Controller catalog number is not stored in plaintext in the .ACD; export to .L5X to confirm the exact processor.",
    );

  ir.controller = {
    name: base || "Controller",
    processorType: processor,
    majorRev,
    minorRev,
    description: lines.join(" "),
    tags: [],
  };
  ir.softwareRevision = softwareRevision
    ? `${softwareRevision} (V${log.lastSaved!.rev})`
    : undefined;
  ir.exportDate = log.lastSaved?.ts;
  ir.fidelity = "summary";
  ir.fidelityNote =
    "This is a native Studio 5000 .ACD project (proprietary binary), so EAS can read summary metadata only — " +
    "the firmware revision, save history, and which programming languages the project uses are shown above. " +
    "For full exploration — programs, routines, ladder/FBD/ST logic, tags, AOIs and UDTs — open the project in " +
    "Studio 5000 and export it as an .L5X file (right-click the controller ▸ Export Controller, or File ▸ Save As ▸ L5X), then upload the .L5X.";
  ir.stats = computeStats(ir);
  return ir;
}
