// HONEST electrical-drawing intelligence.
//
// Parses structured facts from the ALREADY-EXTRACTED text of an electrical
// drawing (documents.kind === "drawing"). This is deliberately conservative:
// we only surface what is actually present in the indexed text. If a drawing
// is an image-only / scanned PDF with no extractable text, this returns an
// all-empty DrawingInfo and the UI shows nothing — we never fabricate.
//
// Pure + total: extractDrawingInfo() never throws and never touches the DB.

export interface DrawingInfo {
  drawingNumber: string | null; // e.g. "E-CONV3-014"
  revision: string | null; // e.g. "C"
  title: string | null; // first meaningful line / "... Drawing" line
  area: string | null; // "AREA: Packaging Line 2"
  equipmentTags: string[]; // e.g. MTR-CONV3, VFD-CONV3, CB-CONV3, MCC-2
  panels: string[]; // panel/MCC/enclosure names, e.g. "MCC-2", "PKG2"
  plcRefs: string[]; // PLC/controller refs, e.g. "CompactLogix L24", "EtherNet/IP"
  wireNumbers: string[]; // wire numbers if present
  components: string[]; // notable components mentioned (breaker, gearbox, safety relay, STO, e-stop, etc.)
}

const EMPTY: DrawingInfo = {
  drawingNumber: null,
  revision: null,
  title: null,
  area: null,
  equipmentTags: [],
  panels: [],
  plcRefs: [],
  wireNumbers: [],
  components: [],
};

/** Dedupe preserving first-seen order, then cap. */
function bounded(values: string[], cap: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const v = raw.trim();
    if (!v) continue;
    const key = v.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
    if (out.length >= cap) break;
  }
  return out;
}

// Component vocabulary. Each entry: a matcher regex (case-insensitive, word
// boundaries where sensible) and the human-cased label to surface.
const COMPONENT_VOCAB: { re: RegExp; label: string }[] = [
  { re: /\bbreakers?\b/i, label: "Breaker" },
  { re: /\bgearbox\b/i, label: "Gearbox" },
  { re: /\bmotors?\b/i, label: "Motor" },
  { re: /\bVFDs?\b/i, label: "VFD" },
  // "drive" AFTER VFD so both can be reported independently.
  { re: /\bdrives?\b/i, label: "Drive" },
  { re: /\bcontactors?\b/i, label: "Contactor" },
  { re: /\boverloads?\b/i, label: "Overload" },
  { re: /\bsafety relays?\b/i, label: "Safety relay" },
  { re: /\bSTO\b/, label: "STO" },
  { re: /\be-?stop\b/i, label: "E-stop" },
  { re: /\bpull-?cords?\b/i, label: "Pull-cord" },
  { re: /\bgate guards?\b/i, label: "Gate guard" },
  { re: /\bphoto-?eyes?\b/i, label: "Photoeye" },
  { re: /\bproximity\b/i, label: "Proximity" },
  { re: /\btransformers?\b/i, label: "Transformer" },
  { re: /\bfuses?\b/i, label: "Fuse" },
  // Plain "relay" last so "safety relay" is preferred; still reported if present.
  { re: /\brelays?\b/i, label: "Relay" },
];

const PLC_VOCAB: { re: RegExp; label: string }[] = [
  { re: /\bCompactLogix(?:\s+[A-Z0-9]{1,6})?\b/i, label: "CompactLogix" },
  { re: /\bControlLogix(?:\s+[A-Z0-9]{1,6})?\b/i, label: "ControlLogix" },
  { re: /\bStudio\s*5000\b/i, label: "Studio 5000" },
  { re: /\bEtherNet\/IP\b/i, label: "EtherNet/IP" },
  { re: /\bDeviceNet\b/i, label: "DeviceNet" },
  { re: /\bPLC\b/, label: "PLC" },
];

export function extractDrawingInfo(text: string): DrawingInfo {
  try {
    if (!text || typeof text !== "string" || !text.trim()) return { ...EMPTY };

    // --- drawingNumber ---
    let drawingNumber: string | null = null;
    const dwgLabelled =
      text.match(/(?:Drawing\s*(?:No\.?|Number)?|DWG\.?)\s*[:#]?\s*([A-Z]{1,3}-[A-Z0-9]+-\d{2,4})\b/i) ||
      text.match(/(?:Drawing\s*(?:No\.?|Number)|DWG\.?\s*(?:No\.?)?)\s*[:#]?\s*([A-Z0-9][A-Z0-9\-]{2,})\b/i);
    if (dwgLabelled) {
      drawingNumber = dwgLabelled[1].toUpperCase();
    } else {
      const generic = text.match(/\b([A-Z]{1,3}-[A-Z0-9]+-\d{2,4})\b/);
      if (generic) drawingNumber = generic[1].toUpperCase();
    }

    // --- revision ---
    let revision: string | null = null;
    const rev = text.match(/\bRev(?:ision)?\.?\s*[:#]?\s*([A-Z0-9]{1,3})\b/i);
    if (rev) revision = rev[1].toUpperCase();

    // --- title: first non-empty line ---
    let title: string | null = null;
    for (const line of text.split(/\r?\n/)) {
      const t = line.trim();
      if (t) {
        title = t.length > 140 ? t.slice(0, 140).trimEnd() + "…" : t;
        break;
      }
    }

    // --- area ---
    let area: string | null = null;
    const areaM = text.match(/AREA:\s*([^\n]+)/i);
    if (areaM) {
      let a = areaM[1].trim();
      if (a.length > 140) a = a.slice(0, 140).trimEnd() + "…";
      area = a || null;
    }

    // --- equipmentTags: TAG-CODE tokens, excluding the drawing number ---
    const tagMatches = text.match(/\b[A-Z]{2,4}-[A-Z0-9]{1,6}\b/g) ?? [];
    const dwgUpper = (drawingNumber ?? "").toUpperCase();
    const equipmentTags = bounded(
      tagMatches
        .map((m) => m.toUpperCase())
        .filter((m) => m !== dwgUpper && !dwgUpper.startsWith(m + "-")),
      30
    );

    // --- panels: tags/words referencing panels/enclosures ---
    const panelCandidates: string[] = [];
    for (const tag of tagMatches.map((m) => m.toUpperCase())) {
      if (/^(MCC|PANEL|ENCL|RACK|PNL)/.test(tag) && tag !== dwgUpper) {
        panelCandidates.push(tag);
      }
    }
    // Standalone words containing panel keywords, e.g. "MCC-2", "PANEL A", "rack PKG2".
    const wordPanel =
      text.match(/\b(?:MCC|PANEL|ENCLOSURE|RACK)[- ]?[A-Z0-9]{1,6}\b/gi) ?? [];
    for (const w of wordPanel) panelCandidates.push(w.trim().replace(/\s+/g, " "));
    // "rack PKG2" -> capture the rack name token that follows "rack".
    for (const m of text.matchAll(/\brack\s+([A-Z][A-Z0-9]{1,7})\b/gi)) {
      panelCandidates.push(m[1].toUpperCase());
    }
    // "Bucket N" enclosure references.
    for (const m of text.matchAll(/\bBucket\s+\d{1,3}\b/gi)) {
      panelCandidates.push(m[0].replace(/\s+/g, " "));
    }
    const panels = bounded(panelCandidates, 20);

    // --- plcRefs ---
    const plcRefs = bounded(
      PLC_VOCAB.flatMap(({ re }) => {
        const m = text.match(re);
        return m ? [m[0].replace(/\s+/g, " ").trim()] : [];
      }),
      20
    );

    // --- wireNumbers: only with a clear pattern ---
    const wireCandidates: string[] = [];
    for (const m of text.matchAll(/\bW\d{2,5}\b/g)) wireCandidates.push(m[0]);
    for (const m of text.matchAll(/wire\s*#\s*([A-Z0-9]{1,6})\b/gi))
      wireCandidates.push("Wire #" + m[1]);
    const wireNumbers = bounded(wireCandidates, 30);

    // --- components: fixed-vocabulary keyword scan ---
    const components = bounded(
      COMPONENT_VOCAB.filter(({ re }) => re.test(text)).map(({ label }) => label),
      30
    );

    return {
      drawingNumber,
      revision,
      title,
      area,
      equipmentTags,
      panels,
      plcRefs,
      wireNumbers,
      components,
    };
  } catch {
    // Total by contract — never throw.
    return { ...EMPTY };
  }
}
