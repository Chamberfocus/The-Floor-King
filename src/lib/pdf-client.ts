// Browser-only helpers: extract text from a PDF and chunk long text.
// Used by the importers so big PDFs are read locally and only TEXT is sent to
// the server (no upload-size or function-time limits).

export async function pdfToText(
  file: File,
): Promise<{ text: string; pages: number }> {
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
  return { text: out, pages: doc.numPages };
}

/** Read an Excel/CSV file into CSV text (all sheets). */
export async function spreadsheetToText(file: File): Promise<string> {
  const XLSX = await import("xlsx");
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  let out = "";
  for (const name of wb.SheetNames) {
    out += XLSX.utils.sheet_to_csv(wb.Sheets[name]) + "\n";
  }
  return out;
}

/** Split long text into chunks (by lines, and hard-splitting any huge line). */
export function chunkText(text: string, maxChars = 12000): string[] {
  const lines: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    if (raw.length <= maxChars) lines.push(raw);
    else for (let i = 0; i < raw.length; i += maxChars) lines.push(raw.slice(i, i + maxChars));
  }
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
