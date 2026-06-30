// Extract searchable text from an uploaded file buffer based on mime/extension.
// Text-extractable formats are indexed for retrieval. Images are stored and (in
// live mode) passed to vision; they are not text-indexed here.
//
// Every extraction returns a structured ExtractResult so the ingest pipeline and
// the UI can be HONEST about whether a file's content was actually read, only
// partially read, or could not be read at all (binary/unsupported). We never
// silently store an error string as if it were document content.

import JSZip from "jszip";

export type ExtractStatus =
  | "extracted" // real text content was recovered
  | "empty" // file parsed but contained no extractable text
  | "binary_unsupported" // binary format we deliberately do not decode as text
  | "unsupported" // file type we cannot extract
  | "error"; // extraction threw

export interface ExtractResult {
  text: string;
  status: ExtractStatus;
  /** Human-readable explanation shown to the user when status !== "extracted". */
  detail?: string;
  /** The detected/normalized file kind label (mirrors classifyKind). */
  kind: string;
}

// Plain-text / code / structured-text formats we can read directly as UTF-8.
const TEXT_EXTS = [
  "txt", "md", "markdown", "csv", "tsv", "log", "json", "xml", "yaml", "yml",
  "l5x", "l5k", "scl", "awl", "st", "il", "ini", "cfg", "html", "htm", "rtf",
];

// Rich document formats with dedicated parsers.
const DOCX_EXTS = ["docx"];
const XLSX_EXTS = ["xlsx", "xlsm", "xlsb", "xls"];
const PPTX_EXTS = ["pptx"];

// Binary engineering project files we deliberately do NOT decode as raw text
// (doing so produces garbage). We store the file and tell the user how to get
// readable content out of it.
const BINARY_UNSUPPORTED: Record<string, string> = {
  acd: "Rockwell Studio 5000 project files (.ACD) are a compiled binary format and cannot be read as text. In Studio 5000 use File → Save As and choose the .L5X (XML) export, then upload that — the full program will be indexed and searchable.",
  apa: "This is a compiled/archived binary project. Export an open text format (e.g. .L5X for Rockwell) and upload that instead.",
  pdf_image: "This PDF appears to be a scanned image with no embedded text. Upload a text-based PDF, or use a searchable/OCR'd version so its contents can be indexed.",
};

function ext(filename: string): string {
  return filename.split(".").pop()?.toLowerCase() ?? "";
}

// Whether a filename/kind looks like an engineering drawing or schematic. Used
// so the upload pipeline can give an EXPLICIT, schematic-specific confirmation
// of whether the drawing was actually loaded and made searchable.
export function isDrawingName(filename: string, mime?: string): boolean {
  const name = filename.toLowerCase();
  if (/schematic|wiring|electrical|\bdrawing\b|\bdwg\b|\belec\b|one.?line|\bp&id\b|\bpid\b|hydraulic|pneumatic|ladder|\bprint\b|blueprint|\bdiagram\b/.test(name)) {
    return true;
  }
  return classifyKind(filename, mime) === "drawing";
}

export function isImage(filename: string, mime?: string): boolean {
  const e = ext(filename);
  if (["png", "jpg", "jpeg", "webp", "gif", "bmp", "tiff", "svg"].includes(e)) return true;
  return Boolean(mime?.startsWith("image/"));
}

// Whether we will attempt text extraction for indexing (vs. store-only).
export function isTextExtractable(filename: string, mime?: string): boolean {
  const e = ext(filename);
  if (TEXT_EXTS.includes(e)) return true;
  if (DOCX_EXTS.includes(e) || XLSX_EXTS.includes(e) || PPTX_EXTS.includes(e)) return true;
  if (e === "pdf" || mime === "application/pdf") return true;
  if (mime?.startsWith("text/")) return true;
  if (
    mime ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    mime ===
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    mime ===
      "application/vnd.openxmlformats-officedocument.presentationml.presentation"
  ) {
    return true;
  }
  return false;
}

// Heuristic: does a string look like real readable text rather than binary noise?
function looksLikeText(s: string): boolean {
  if (!s) return false;
  const sample = s.slice(0, 4000);
  let printable = 0;
  for (let i = 0; i < sample.length; i++) {
    const c = sample.charCodeAt(i);
    // tab/newline/carriage-return or normal printable range
    if (c === 9 || c === 10 || c === 13 || (c >= 32 && c <= 126) || c >= 160) {
      printable++;
    }
  }
  return printable / sample.length > 0.85;
}

async function extractDocx(buffer: Buffer): Promise<ExtractResult> {
  try {
    const mammoth = await import("mammoth");
    const { value } = await mammoth.extractRawText({ buffer });
    const text = (value ?? "").trim();
    if (!text) {
      return { text: "", status: "empty", detail: "The Word document contained no extractable text.", kind: "document" };
    }
    return { text, status: "extracted", kind: "document" };
  } catch (err) {
    return { text: "", status: "error", detail: `Could not read Word document: ${(err as Error).message}`, kind: "document" };
  }
}

async function extractXlsx(buffer: Buffer, filename: string): Promise<ExtractResult> {
  try {
    const XLSX = await import("xlsx");
    const wb = XLSX.read(buffer, { type: "buffer" });
    const parts: string[] = [];
    for (const sheetName of wb.SheetNames) {
      const sheet = wb.Sheets[sheetName];
      if (!sheet) continue;
      const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false });
      if (csv.trim()) {
        parts.push(`# Sheet: ${sheetName}\n${csv.trim()}`);
      }
    }
    const text = parts.join("\n\n").trim();
    if (!text) {
      return { text: "", status: "empty", detail: "The spreadsheet contained no data.", kind: "document" };
    }
    return { text, status: "extracted", kind: classifyKind(filename) };
  } catch (err) {
    return { text: "", status: "error", detail: `Could not read spreadsheet: ${(err as Error).message}`, kind: "document" };
  }
}

// PPTX is a zip of slide XML files; pull visible text runs (<a:t> elements).
async function extractPptx(buffer: Buffer): Promise<ExtractResult> {
  try {
    const zip = await JSZip.loadAsync(buffer);
    const slidePaths = Object.keys(zip.files)
      .filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p))
      .sort((a, b) => {
        const na = parseInt(a.match(/slide(\d+)\.xml/)?.[1] ?? "0", 10);
        const nb = parseInt(b.match(/slide(\d+)\.xml/)?.[1] ?? "0", 10);
        return na - nb;
      });
    const slides: string[] = [];
    for (let i = 0; i < slidePaths.length; i++) {
      const xml = await zip.files[slidePaths[i]].async("string");
      const runs = [...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) =>
        m[1]
          .replace(/&amp;/g, "&")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'")
      );
      const slideText = runs.join(" ").replace(/\s+/g, " ").trim();
      if (slideText) slides.push(`# Slide ${i + 1}\n${slideText}`);
    }
    const text = slides.join("\n\n").trim();
    if (!text) {
      return { text: "", status: "empty", detail: "The presentation contained no extractable text.", kind: "document" };
    }
    return { text, status: "extracted", kind: "document" };
  } catch (err) {
    return { text: "", status: "error", detail: `Could not read presentation: ${(err as Error).message}`, kind: "document" };
  }
}

async function extractPdf(buffer: Buffer): Promise<ExtractResult> {
  try {
    // pdf-parse is CommonJS; import the implementation directly to avoid its
    // index.js debug harness that reads a local test file.
    const pdfParse = (await import("pdf-parse/lib/pdf-parse.js")).default as (
      b: Buffer
    ) => Promise<{ text: string }>;
    const data = await pdfParse(buffer);
    const text = (data.text ?? "").trim();
    if (!text) {
      return {
        text: "",
        status: "binary_unsupported",
        detail: BINARY_UNSUPPORTED.pdf_image,
        kind: "document",
      };
    }
    return { text, status: "extracted", kind: "document" };
  } catch (err) {
    return { text: "", status: "error", detail: `Could not extract PDF text: ${(err as Error).message}`, kind: "document" };
  }
}

/**
 * Extract text + an honest status from an uploaded file buffer.
 */
export async function extractDocument(
  buffer: Buffer,
  filename: string,
  mime?: string
): Promise<ExtractResult> {
  const e = ext(filename);

  // Deliberately-unsupported binary engineering files.
  if (BINARY_UNSUPPORTED[e]) {
    return { text: "", status: "binary_unsupported", detail: BINARY_UNSUPPORTED[e], kind: classifyKind(filename, mime) };
  }

  if (e === "pdf" || mime === "application/pdf") {
    const r = await extractPdf(buffer);
    return { ...r, kind: r.kind === "document" ? classifyKind(filename, mime) : r.kind };
  }
  if (DOCX_EXTS.includes(e)) return { ...(await extractDocx(buffer)), kind: classifyKind(filename, mime) };
  if (XLSX_EXTS.includes(e)) return extractXlsx(buffer, filename);
  if (PPTX_EXTS.includes(e)) return { ...(await extractPptx(buffer)), kind: classifyKind(filename, mime) };

  // Plain text / code / structured text.
  if (TEXT_EXTS.includes(e) || mime?.startsWith("text/")) {
    const text = buffer.toString("utf-8");
    if (!text.trim()) {
      return { text: "", status: "empty", detail: "The file was empty.", kind: classifyKind(filename, mime) };
    }
    return { text, status: "extracted", kind: classifyKind(filename, mime) };
  }

  // Unknown type: try UTF-8, but only accept it if it actually looks like text.
  const guess = buffer.toString("utf-8");
  if (looksLikeText(guess)) {
    return { text: guess, status: "extracted", kind: classifyKind(filename, mime) };
  }
  return {
    text: "",
    status: "unsupported",
    detail: `"${filename}" is not a text-readable format, so its contents could not be indexed. Supported: PDF, Word (.docx), Excel (.xlsx/.csv), PowerPoint (.pptx), and plain-text/code/L5X files.`,
    kind: classifyKind(filename, mime),
  };
}

/**
 * Backwards-compatible helper: returns just the text (empty string when a file
 * could not be read). Prefer extractDocument() for status-aware ingestion.
 */
export async function extractText(
  buffer: Buffer,
  filename: string,
  mime?: string
): Promise<string> {
  const r = await extractDocument(buffer, filename, mime);
  return r.text;
}

// Best-effort classification of an uploaded file into an EAS document kind.
export function classifyKind(filename: string, mime?: string): string {
  const name = filename.toLowerCase();
  const e = name.split(".").pop() ?? "";
  if (["l5x", "l5k", "acd", "scl", "awl", "st", "il"].includes(e)) return "plc";
  if (isImage(filename, mime)) return "photo";
  if (/schematic|wiring|electrical|drawing|dwg|elec/.test(name)) return "drawing";
  if (/hydraulic|pneumatic|p&id|pid/.test(name)) return "drawing";
  if (/alarm|event|fault.?log/.test(name)) return "alarm";
  if (/vibration|vib|fft|spectrum/.test(name)) return "vibration";
  if (/manual|guide|handbook/.test(name)) return "manual";
  if (/sop|procedure|work.?instruction/.test(name)) return "sop";
  if (/\bpm\b|preventive/.test(name)) return "sop";
  if (/\.xlsx?$|\.csv$/.test(name)) return "document";
  return "document";
}
