// Native PDF text extraction with OCR fallback.
//
// Engineering drawings (schematics, electrical packages) and scanned manuals do
// not yield usable text from a naive text-layer read:
//   • CAD/vector PDFs DO carry a text layer, but a positional reader (pdf-parse)
//     emits it in object order, not reading order → scrambled "+ 107689342 = 5".
//   • Scanned PDFs carry NO text layer at all → nothing to extract.
//
// This module fixes both by preferring poppler's `pdftotext -layout` (correct
// reading order, clean title blocks and component tags) and, when the embedded
// text is missing or too sparse to be a real read, falling back to rendering
// each page to an image (`pdftoppm`) and running OCR (`tesseract`).
//
// It shells out to native binaries (poppler-utils + tesseract-ocr) which are far
// faster and more accurate than JS equivalents. If those binaries are absent the
// caller falls back to pdf-parse, so the app degrades gracefully.

import { spawn } from "child_process";
import { promises as fs } from "fs";
import os from "os";
import path from "path";

export type PdfExtractMethod = "text_layer" | "ocr" | "none";

export interface PdfExtractResult {
  text: string;
  method: PdfExtractMethod;
  pageCount: number;
  /** Pages actually OCR'd (0 when the text layer was sufficient). */
  ocrPages: number;
  /** True when neither poppler nor tesseract could be invoked. */
  toolingMissing: boolean;
}

// Guardrails so a single huge upload can't monopolize a 1-vCPU box.
const MAX_OCR_PAGES = Number(process.env.PDF_OCR_MAX_PAGES ?? 40);
const OCR_DPI = Number(process.env.PDF_OCR_DPI ?? 150);
const CMD_TIMEOUT_MS = Number(process.env.PDF_EXTRACT_TIMEOUT_MS ?? 180_000);

// Minimum "real text" per page below which we assume the text layer is empty or
// junk (a scan) and OCR is worthwhile.
const MIN_CHARS_PER_PAGE = 40;

interface RunResult {
  code: number | null;
  stdout: Buffer;
  stderr: string;
  timedOut: boolean;
}

function run(cmd: string, args: string[], input?: Buffer): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"] });
    const out: Buffer[] = [];
    let err = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, CMD_TIMEOUT_MS);
    child.stdout.on("data", (d: Buffer) => out.push(d));
    child.stderr.on("data", (d: Buffer) => (err += d.toString()));
    child.on("error", () => {
      clearTimeout(timer);
      resolve({ code: null, stdout: Buffer.concat(out), stderr: err, timedOut });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout: Buffer.concat(out), stderr: err, timedOut });
    });
    if (input) {
      child.stdin.write(input);
    }
    child.stdin.end();
  });
}

async function hasBinary(name: string): Promise<boolean> {
  const r = await run("which", [name]);
  return r.code === 0 && r.stdout.toString().trim().length > 0;
}

async function pdfPageCount(file: string): Promise<number> {
  const r = await run("pdfinfo", [file]);
  if (r.code !== 0) return 0;
  const m = r.stdout.toString().match(/Pages:\s*(\d+)/i);
  return m ? parseInt(m[1], 10) : 0;
}

// Heuristic: does the extracted text look like a real read rather than a few
// stray glyphs? Uses per-page density plus a check that it isn't mostly isolated
// single characters/numbers (typical of a failed CAD text-layer read).
function textIsSufficient(text: string, pageCount: number): boolean {
  const t = text.trim();
  if (!t) return false;
  const minChars = Math.max(80, (pageCount || 1) * MIN_CHARS_PER_PAGE);
  if (t.length < minChars) return false;
  // Count "word-like" tokens (2+ alphanumerics). A scrambled read is dominated
  // by 1-char tokens, so require a reasonable share of real words.
  const tokens = t.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return false;
  const wordish = tokens.filter((w) => /[A-Za-z0-9]{2,}/.test(w)).length;
  return wordish / tokens.length > 0.4 && wordish > 20;
}

async function extractTextLayer(file: string): Promise<string> {
  // -layout preserves the visual column/row order so title blocks and tag
  // columns read correctly instead of in internal object order.
  const r = await run("pdftotext", ["-layout", "-enc", "UTF-8", file, "-"]);
  if (r.code !== 0) return "";
  return r.stdout.toString("utf-8");
}

async function ocrPdf(file: string, pageCount: number): Promise<{ text: string; pages: number }> {
  const pages = Math.min(pageCount || MAX_OCR_PAGES, MAX_OCR_PAGES);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "eas-ocr-"));
  try {
    // Render pages to grayscale PNGs at a legible DPI.
    const base = path.join(dir, "pg");
    const render = await run("pdftoppm", [
      "-f", "1",
      "-l", String(pages),
      "-r", String(OCR_DPI),
      "-gray",
      "-png",
      file,
      base,
    ]);
    if (render.code !== 0 && !render.timedOut) {
      // fall through — maybe some pages rendered
    }
    const files = (await fs.readdir(dir))
      .filter((f) => f.endsWith(".png"))
      .sort();
    const parts: string[] = [];
    let done = 0;
    for (const f of files) {
      const img = path.join(dir, f);
      // tesseract <img> stdout  → recognized text on stdout
      const r = await run("tesseract", [img, "stdout", "--psm", "6", "-l", "eng"]);
      if (r.code === 0) {
        const pageText = r.stdout.toString("utf-8").trim();
        if (pageText) parts.push(pageText);
      }
      done++;
    }
    return { text: parts.join("\n\n").trim(), pages: done };
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Extract text from a PDF buffer using the native pipeline:
 *   1. pdftotext -layout   (fast, correct reading order)
 *   2. OCR fallback         (scanned/image-only PDFs)
 * Returns method="none" + toolingMissing when neither tool is available so the
 * caller can fall back to pdf-parse.
 */
export async function extractPdfNative(buffer: Buffer): Promise<PdfExtractResult> {
  const havePdftotext = await hasBinary("pdftotext");
  const haveTesseract = await hasBinary("tesseract");
  const havePdftoppm = await hasBinary("pdftoppm");
  if (!havePdftotext && !(haveTesseract && havePdftoppm)) {
    return { text: "", method: "none", pageCount: 0, ocrPages: 0, toolingMissing: true };
  }

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "eas-pdf-"));
  const file = path.join(dir, "in.pdf");
  try {
    await fs.writeFile(file, buffer);
    const pageCount = await pdfPageCount(file);

    let layerText = "";
    if (havePdftotext) {
      layerText = await extractTextLayer(file);
      if (textIsSufficient(layerText, pageCount)) {
        return {
          text: layerText.trim(),
          method: "text_layer",
          pageCount,
          ocrPages: 0,
          toolingMissing: false,
        };
      }
    }

    // Text layer missing/insufficient → OCR fallback (if available).
    if (haveTesseract && havePdftoppm) {
      const { text: ocrText, pages } = await ocrPdf(file, pageCount);
      // Prefer whichever read is richer; combine when both have content so a
      // hybrid PDF (some text pages + some scanned pages) loses nothing.
      const best =
        ocrText.length > layerText.trim().length
          ? ocrText
          : layerText.trim();
      if (best) {
        return {
          text: best,
          method: ocrText.length >= layerText.trim().length ? "ocr" : "text_layer",
          pageCount,
          ocrPages: pages,
          toolingMissing: false,
        };
      }
    }

    // Only a weak text layer and no OCR available — return what we have.
    return {
      text: layerText.trim(),
      method: layerText.trim() ? "text_layer" : "none",
      pageCount,
      ocrPages: 0,
      toolingMissing: false,
    };
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
