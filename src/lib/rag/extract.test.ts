import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import * as XLSX from "xlsx";
import { extractDocument, classifyKind, isImage } from "./extract";

// Build a minimal but valid .docx (Office Open XML) in memory.
async function makeDocx(paragraphs: string[]): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      `<Default Extension="xml" ContentType="application/xml"/>` +
      `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
      `</Types>`
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>` +
      `</Relationships>`
  );
  const body = paragraphs
    .map((p) => `<w:p><w:r><w:t>${p}</w:t></w:r></w:p>`)
    .join("");
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
      `<w:body>${body}</w:body></w:document>`
  );
  return zip.generateAsync({ type: "nodebuffer" });
}

// Build a minimal but valid .pptx with two slides.
async function makePptx(slides: string[][]): Promise<Buffer> {
  const zip = new JSZip();
  slides.forEach((runs, i) => {
    const runXml = runs.map((t) => `<a:p><a:r><a:t>${t}</a:t></a:r></a:p>`).join("");
    zip.file(
      `ppt/slides/slide${i + 1}.xml`,
      `<?xml version="1.0"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="x"><p:cSld><p:spTree>${runXml}</p:spTree></p:cSld></p:sld>`
    );
  });
  return zip.generateAsync({ type: "nodebuffer" });
}

function makeXlsx(rows: (string | number)[][]): Buffer {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

describe("extractDocument multi-format extraction", () => {
  it("extracts real text from a Word .docx", async () => {
    const buf = await makeDocx([
      "Hydraulic pump P-101 overheating procedure",
      "Step 1: verify oil level and cooler flow.",
    ]);
    const r = await extractDocument(buf, "pump-procedure.docx");
    expect(r.status).toBe("extracted");
    expect(r.text).toContain("Hydraulic pump P-101");
    expect(r.text).toContain("verify oil level");
  });

  it("extracts cell data from an Excel .xlsx including the sheet name", async () => {
    const buf = makeXlsx([
      ["Tag", "Description", "Setpoint"],
      ["TT-205", "Bearing temperature", 85],
    ]);
    const r = await extractDocument(buf, "instrument-list.xlsx");
    expect(r.status).toBe("extracted");
    expect(r.text).toContain("Sheet1");
    expect(r.text).toContain("TT-205");
    expect(r.text).toContain("Bearing temperature");
  });

  it("extracts slide text from a PowerPoint .pptx in slide order", async () => {
    const buf = await makePptx([
      ["Lockout Tagout Overview"],
      ["Always verify zero energy state"],
    ]);
    const r = await extractDocument(buf, "loto.pptx");
    expect(r.status).toBe("extracted");
    expect(r.text).toContain("Lockout Tagout Overview");
    expect(r.text).toContain("zero energy state");
    expect(r.text.indexOf("Lockout")).toBeLessThan(r.text.indexOf("zero energy"));
  });

  it("reads CSV and plain text directly", async () => {
    const csv = Buffer.from("asset,fault\nCONV-3,VFD overcurrent\n");
    const r = await extractDocument(csv, "faults.csv");
    expect(r.status).toBe("extracted");
    expect(r.text).toContain("VFD overcurrent");
  });

  it("returns binary_unsupported with guidance for a Rockwell .acd", async () => {
    const buf = Buffer.from([0x00, 0x01, 0x02, 0x03, 0xff, 0xfe]);
    const r = await extractDocument(buf, "line2.acd");
    expect(r.status).toBe("binary_unsupported");
    expect(r.detail).toMatch(/L5X/i);
    expect(r.text).toBe("");
  });

  it("flags an unsupported binary blob instead of storing garbage", async () => {
    // Mostly low control bytes — clearly not readable text.
    const buf = Buffer.from(Array.from({ length: 500 }, (_, i) => (i % 20) + 1));
    const r = await extractDocument(buf, "mystery.bin");
    expect(r.status).toBe("unsupported");
    expect(r.text).toBe("");
  });

  it("reports an empty text file honestly", async () => {
    const r = await extractDocument(Buffer.from("   \n  "), "blank.txt");
    expect(r.status).toBe("empty");
    expect(r.text).toBe("");
  });
});

describe("classifyKind / isImage", () => {
  it("classifies PLC and image files", () => {
    expect(classifyKind("line.l5x")).toBe("plc");
    expect(classifyKind("photo.jpg")).toBe("photo");
    expect(isImage("photo.jpg")).toBe(true);
    expect(isImage("doc.pdf")).toBe(false);
  });
});
