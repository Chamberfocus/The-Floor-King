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

/** Parse one delimited CSV line honoring quotes. */
function splitCsvLine(line: string, delim: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else q = false;
      } else cur += c;
    } else if (c === '"') q = true;
    else if (c === delim) {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

/**
 * Parse a spreadsheet/CSV file into a grid of rows (array of string[]) in the
 * browser. The first non-empty row is the header. Fast — no AI.
 */
export async function fileToGrid(file: File): Promise<string[][]> {
  const name = file.name.toLowerCase();
  const isExcel =
    name.endsWith(".xlsx") ||
    name.endsWith(".xls") ||
    file.type.includes("spreadsheet") ||
    file.type.includes("excel");

  if (isExcel) {
    const XLSX = await import("xlsx");
    const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, {
      header: 1,
      raw: false,
      defval: "",
      blankrows: false,
    }) as unknown[][];
    return rows.map((r) => r.map((c) => String(c ?? "").trim()));
  }

  const text = await file.text();
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length);
  if (!lines.length) return [];
  const delim = lines[0].includes("\t") && !lines[0].includes(",") ? "\t" : ",";
  return lines.map((l) => splitCsvLine(l, delim));
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
