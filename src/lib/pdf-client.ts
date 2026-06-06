// Browser-only helpers: extract text from a PDF and chunk long text.
// Used by the importers so big PDFs are read locally and only TEXT is sent to
// the server (no upload-size or function-time limits).

export async function pdfToText(file: File): Promise<string> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;
  const data = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data }).promise;
  let out = "";
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    out +=
      content.items
        .map((i) => ("str" in i ? (i as { str: string }).str : ""))
        .join(" ") + "\n";
  }
  return out;
}

/** Split long text into chunks (by lines) so each server call stays small/fast. */
export function chunkText(text: string, maxChars = 12000): string[] {
  const lines = text.split(/\r?\n/);
  const chunks: string[] = [];
  let cur = "";
  for (const line of lines) {
    if (cur.length + line.length + 1 > maxChars && cur) {
      chunks.push(cur);
      cur = "";
    }
    cur += line + "\n";
  }
  if (cur.trim()) chunks.push(cur);
  return chunks.length ? chunks : [text];
}
