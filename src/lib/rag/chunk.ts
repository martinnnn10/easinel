// Simple, robust text chunker. Splits on blank lines/length boundaries so each
// chunk is a retrievable unit of roughly CHUNK_SIZE characters.

const CHUNK_SIZE = 1200;
const OVERLAP = 150;

export function chunkText(text: string): string[] {
  const clean = text
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
  if (!clean) return [];

  // First pass: split on paragraph boundaries.
  const paras = clean.split(/\n{2,}/);
  const chunks: string[] = [];
  let buf = "";

  const flush = () => {
    const t = buf.trim();
    if (t) chunks.push(t);
    buf = "";
  };

  for (const para of paras) {
    if ((buf + "\n\n" + para).length > CHUNK_SIZE) {
      flush();
      // If a single paragraph is huge, hard-split it.
      if (para.length > CHUNK_SIZE) {
        for (let i = 0; i < para.length; i += CHUNK_SIZE - OVERLAP) {
          chunks.push(para.slice(i, i + CHUNK_SIZE).trim());
        }
      } else {
        buf = para;
      }
    } else {
      buf = buf ? buf + "\n\n" + para : para;
    }
  }
  flush();
  return chunks.filter(Boolean);
}
