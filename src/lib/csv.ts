import Papa from "papaparse";

/**
 * Sanitize cell values against CSV formula injection (=, +, -, @, \t, \r).
 * Prepends a single quote (') if any dangerous character starts the value.
 */
export function sanitizeCSVValue(val: unknown): unknown {
  if (typeof val === "string") {
    if (/^[=+\-@\t\r]/.test(val) || /^[=+\-@]/.test(val.trim())) {
      return `'${val}`;
    }
  }
  return val;
}

export function sanitizeCSVRow(row: Record<string, unknown>): Record<string, unknown> {
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    clean[k] = sanitizeCSVValue(v);
  }
  return clean;
}

export function downloadCSV(filename: string, rows: Record<string, unknown>[]) {
  const safeRows = rows.map(sanitizeCSVRow);
  const csv = Papa.unparse(safeRows);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function parseCSV<T = Record<string, string>>(file: File): Promise<T[]> {
  return new Promise((resolve, reject) => {
    Papa.parse<T>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (res) => resolve(res.data),
      error: reject,
    });
  });
}

/** Parse CSV/TSV supplied as a raw string (from paste or a fetched API response). */
export function parseCSVText<T = Record<string, string>>(text: string): T[] {
  const res = Papa.parse<T>(text.trim(), {
    header: true,
    skipEmptyLines: true,
  });
  return res.data;
}
