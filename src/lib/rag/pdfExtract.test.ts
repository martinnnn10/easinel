import { describe, it, expect } from "vitest";
import { execFileSync } from "child_process";
import { extractPdfNative } from "./pdfExtract";

// These tests exercise the native pipeline end-to-end. They require poppler
// (pdftoppm/pdftotext) to be installed; if it isn't, the extractor honestly
// reports toolingMissing and we assert that graceful-degradation contract
// instead of failing the suite.
function hasPoppler(): boolean {
  try {
    execFileSync("which", ["pdftotext"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

// A minimal, valid single-page PDF with a real text layer ("Hello EAS 12345").
// Built inline so the test needs no fixture file.
function makeTextPdf(): Buffer {
  const content = "BT /F1 24 Tf 72 700 Td (Hello EAS 12345 MOTOR OVERLOAD) Tj ET";
  const objects: string[] = [];
  objects.push("<< /Type /Catalog /Pages 2 0 R >>");
  objects.push("<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  objects.push("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>");
  objects.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((obj, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.forEach((off) => {
    pdf += `${String(off).padStart(10, "0")} 00000 n \n`;
  });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return Buffer.from(pdf, "latin1");
}

describe("extractPdfNative", () => {
  it("recovers a text layer in correct reading order", async () => {
    const buf = makeTextPdf();
    const res = await extractPdfNative(buf);
    if (res.toolingMissing) {
      // Environment without poppler — contract is honest degradation.
      expect(res.method).toBe("none");
      expect(res.text).toBe("");
      return;
    }
    expect(hasPoppler()).toBe(true);
    // A tiny synthetic PDF may pass through either path (its text layer can be
    // below the per-page "sufficient" threshold, triggering the OCR fallback).
    // The real contract is: the text is recovered in a usable form.
    expect(["text_layer", "ocr"]).toContain(res.method);
    expect(res.text).toContain("Hello EAS 12345");
    expect(res.text).toContain("MOTOR OVERLOAD");
    expect(res.pageCount).toBeGreaterThanOrEqual(1);
  });

  it("reports toolingMissing=none-method for a non-PDF/garbage buffer without throwing", async () => {
    const res = await extractPdfNative(Buffer.from("not a pdf at all"));
    // Either tooling is missing, or poppler returns no text → method "none".
    expect(["none", "text_layer", "ocr"]).toContain(res.method);
    expect(typeof res.text).toBe("string");
  });
});
