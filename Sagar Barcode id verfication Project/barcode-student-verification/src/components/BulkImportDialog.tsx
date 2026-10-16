import { useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";
import { downloadCSV, parseCSVText } from "@/lib/csv";
import { toast } from "sonner";
import {
  Upload, Link2, ClipboardPaste, FileSpreadsheet, Loader2, CheckCircle2,
  AlertTriangle, ArrowLeft, Download, Sparkles, Info,
} from "lucide-react";

/* ─────────────────────────────────────────────────────────────────────────
   Target student columns + header aliases for smart auto-mapping.
   Only `full_name` is required — everything else is optional and, for the
   admission number / barcode, auto-generated when missing.
   ───────────────────────────────────────────────────────────────────────── */
const NONE = "__none__";

type Target =
  | "full_name" | "admission_number" | "barcode" | "programme" | "nta_level"
  | "year_of_study" | "status" | "expires_at" | "parent_email" | "parent_phone" | "notes";

const TARGETS: { key: Target; label: string; required?: boolean; aliases: string[] }[] = [
  { key: "full_name",        label: "Full name",     required: true,
    aliases: ["full_name", "fullname", "name", "names", "student_name", "studentname", "student"] },
  { key: "admission_number", label: "Admission no.",
    aliases: ["admission_number", "admissionno", "admission", "admno", "reg_no", "regno", "registration", "registration_number", "index_number", "indexno", "index", "matric", "student_id", "studentid"] },
  { key: "barcode",          label: "Barcode",
    aliases: ["barcode", "bar_code", "card", "card_number", "cardno", "qr", "code"] },
  { key: "programme",        label: "Programme",
    aliases: ["programme", "program", "course", "department", "dept", "major", "class"] },
  { key: "nta_level",        label: "NTA level",
    aliases: ["nta_level", "ntalevel", "nta", "level"] },
  { key: "year_of_study",    label: "Year of study",
    aliases: ["year_of_study", "yearofstudy", "year", "yos", "yr", "study_year"] },
  { key: "status",           label: "Status",
    aliases: ["status", "state"] },
  { key: "expires_at",       label: "Expiry date",
    aliases: ["expires_at", "expiry", "expires", "valid_until", "validuntil", "expiration", "expiry_date"] },
  { key: "parent_email",     label: "Parent email",
    aliases: ["parent_email", "guardian_email", "email", "parentemail"] },
  { key: "parent_phone",     label: "Parent phone",
    aliases: ["parent_phone", "guardian_phone", "phone", "mobile", "contact", "parentphone", "msisdn"] },
  { key: "notes",            label: "Notes",
    aliases: ["notes", "note", "remark", "remarks", "comment", "comments"] },
];

const STATUSES = ["active", "suspended", "graduated"];

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

function autoMap(cols: string[]): Record<string, string> {
  const nc = cols.map((c) => ({ raw: c, n: norm(c) }));
  const m: Record<string, string> = {};
  for (const tgt of TARGETS) {
    let found = "";
    for (const alias of tgt.aliases) {                 // pass 1: exact normalized match
      const hit = nc.find((c) => c.n === norm(alias));
      if (hit) { found = hit.raw; break; }
    }
    if (!found) for (const alias of tgt.aliases) {      // pass 2: contains match
      const na = norm(alias);
      const hit = nc.find((c) => na.length >= 3 && c.n.includes(na));
      if (hit) { found = hit.raw; break; }
    }
    m[tgt.key] = found || NONE;
  }
  return m;
}

function findArray(obj: any): any[] {
  for (const k of ["data", "results", "students", "rows", "items", "records", "list"]) {
    if (Array.isArray(obj?.[k])) return obj[k];
  }
  for (const v of Object.values(obj ?? {})) if (Array.isArray(v)) return v as any[];
  return obj && typeof obj === "object" ? [obj] : [];
}

/** Detect JSON vs CSV vs a plain newline-separated list of names, and parse to rows. */
function detectAndParse(text: string, filename?: string, contentType?: string): any[] {
  const trimmed = (text ?? "").trim();
  if (!trimmed) return [];

  const looksJson =
    trimmed[0] === "[" || trimmed[0] === "{" ||
    !!contentType?.includes("json") ||
    !!filename?.toLowerCase().endsWith(".json");

  if (looksJson) {
    try {
      const json = JSON.parse(trimmed);
      const arr = Array.isArray(json) ? json : findArray(json);
      // Support arrays of plain strings/numbers → treat each as a name.
      return arr.map((it: any) =>
        it && typeof it === "object" && !Array.isArray(it) ? it : { full_name: String(it) },
      );
    } catch {
      /* not valid JSON after all — fall through to delimited parsing */
    }
  }

  const firstLine = trimmed.split(/\r?\n/)[0] ?? "";
  if (/[,\t;]/.test(firstLine)) return parseCSVText(trimmed);

  // Single column → a plain list of names, one per line.
  const lines = trimmed.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const skipHeader = /^(names?|full[_ ]?names?|student(_?names?)?)$/i.test(lines[0] ?? "") ? 1 : 0;
  return lines.slice(skipHeader).map((name) => ({ full_name: name }));
}

function normalizeDate(s: string): string | null {
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

interface PreparedRow {
  full_name: string;
  admission_number: string | null;   // null → will be auto-generated on import
  barcode: string | null;
  programme: string;
  nta_level: string;
  year_of_study: number;
  status: string;
  expires_at: string | null;
  parent_email: string | null;
  parent_phone: string | null;
  notes: string | null;
  _auto: boolean;
}

interface ImportResult {
  total: number; valid: number; skipped: number; generated: number;
  dupMerged: number; created: number; updated: number; success: number; errors: string[];
}

export default function BulkImportDialog({
  open, onOpenChange, onImported,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onImported: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState<"file" | "paste" | "url">("file");

  // Source input state
  const [pasteText, setPasteText] = useState("");
  const [apiUrl, setApiUrl] = useState("");
  const [apiHeaderName, setApiHeaderName] = useState("Authorization");
  const [apiAuth, setApiAuth] = useState("");
  const [loadingSrc, setLoadingSrc] = useState(false);
  const [srcError, setSrcError] = useState<string | null>(null);

  // Parsed data + mapping
  const [rawRows, setRawRows] = useState<any[] | null>(null);
  const [sourceCols, setSourceCols] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [autoGen, setAutoGen] = useState(true);

  // Import execution
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<ImportResult | null>(null);

  const resetSource = () => {
    setRawRows(null); setSourceCols([]); setMapping({}); setSrcError(null); setResult(null);
  };
  const resetAll = () => {
    resetSource(); setPasteText(""); setApiUrl(""); setApiAuth(""); setProgress(0);
  };
  const close = () => { onOpenChange(false); setTimeout(resetAll, 200); };

  // ── Source ingestion ──────────────────────────────────────────────────────
  const ingest = (rows: any[]) => {
    if (!rows.length) { setSrcError("No rows found in the supplied data."); return; }
    const cols = Array.from(
      new Set(rows.slice(0, 200).flatMap((r) => (r && typeof r === "object" ? Object.keys(r) : [])).filter(Boolean)),
    );
    setRawRows(rows); setSourceCols(cols); setMapping(autoMap(cols)); setSrcError(null);
  };

  const handleFile = async (file: File) => {
    setLoadingSrc(true); setSrcError(null);
    try {
      ingest(detectAndParse(await file.text(), file.name));
    } catch (e: any) {
      setSrcError(e?.message || "Could not read the file.");
    } finally {
      setLoadingSrc(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const handlePaste = () => {
    setSrcError(null);
    try {
      ingest(detectAndParse(pasteText));
    } catch (e: any) {
      setSrcError("Could not parse pasted text: " + (e?.message || ""));
    }
  };

  const handleFetch = async () => {
    if (!/^https?:\/\//i.test(apiUrl.trim())) { setSrcError("Enter a valid http(s) URL."); return; }
    setLoadingSrc(true); setSrcError(null);
    try {
      const headers: Record<string, string> = {};
      if (apiAuth.trim()) headers[apiHeaderName.trim() || "Authorization"] = apiAuth.trim();
      const res = await fetch(apiUrl.trim(), { headers });
      if (!res.ok) { setSrcError(`The endpoint responded ${res.status} ${res.statusText}.`); return; }
      const text = await res.text();
      ingest(detectAndParse(text, undefined, res.headers.get("content-type") || undefined));
    } catch (e: any) {
      setSrcError(
        "Fetch failed: " + (e?.message || "") +
        ". The API may block cross-origin (CORS) requests from the browser — download the file and use Upload instead.",
      );
    } finally {
      setLoadingSrc(false);
    }
  };

  // ── Prepare / validate rows from the current mapping ───────────────────────
  const prepared = useMemo(() => {
    if (!rawRows) return null;
    const get = (row: any, target: Target) => {
      const col = mapping[target];
      if (!col || col === NONE) return "";
      const v = row?.[col];
      return v === null || v === undefined ? "" : String(v).trim();
    };
    const seen = new Map<string, number>();
    const rows: PreparedRow[] = [];
    let skippedNoName = 0, willGenerate = 0, dupMerged = 0;

    for (const row of rawRows) {
      const full_name = get(row, "full_name");
      if (!full_name) { skippedNoName++; continue; }

      const admission = get(row, "admission_number");
      let barcode = get(row, "barcode");
      const auto = !admission;
      if (auto) willGenerate++;
      if (!barcode) barcode = admission;

      const statusRaw = get(row, "status").toLowerCase();
      const yos = parseInt(get(row, "year_of_study"), 10);

      const rec: PreparedRow = {
        full_name,
        admission_number: admission || null,
        barcode: barcode || null,
        programme: get(row, "programme"),
        nta_level: get(row, "nta_level"),
        year_of_study: Number.isFinite(yos) && yos > 0 ? yos : 1,
        status: STATUSES.includes(statusRaw) ? statusRaw : "active",
        expires_at: normalizeDate(get(row, "expires_at")),
        parent_email: get(row, "parent_email") || null,
        parent_phone: get(row, "parent_phone") || null,
        notes: get(row, "notes") || null,
        _auto: auto,
      };

      if (!auto) {
        // De-duplicate within the batch by admission number (last one wins) —
        // Postgres upsert cannot touch the same conflict target twice.
        if (seen.has(admission)) { rows[seen.get(admission)!] = rec; dupMerged++; }
        else { seen.set(admission, rows.length); rows.push(rec); }
      } else {
        rows.push(rec);
      }
    }
    return { rows, stats: { total: rawRows.length, valid: rows.length, skippedNoName, willGenerate, dupMerged } };
  }, [rawRows, mapping]);

  const nameMapped = mapping.full_name && mapping.full_name !== NONE;
  const canImport = !!prepared && prepared.rows.length > 0 && !!nameMapped && (autoGen || prepared.stats.willGenerate === 0);

  // ── Execute import ─────────────────────────────────────────────────────────
  const doImport = async () => {
    if (!prepared?.rows.length) { toast.error("Nothing valid to import."); return; }
    setImporting(true); setProgress(0);
    try {
      const base = Date.now().toString(36).toUpperCase();
      const finalRows = prepared.rows.map((r, i) => {
        const admission = r.admission_number ?? `S${base}${i}`;
        const { _auto, ...rest } = r;
        return { ...rest, admission_number: admission, barcode: (r.barcode || admission), is_visitor: false };
      });

      // Determine which admission numbers already exist → created vs updated.
      const keys = finalRows.map((r) => r.admission_number);
      const existing = new Set<string>();
      for (let i = 0; i < keys.length; i += 300) {
        const { data } = await supabase
          .from("students").select("admission_number").in("admission_number", keys.slice(i, i + 300));
        (data ?? []).forEach((d: any) => existing.add(d.admission_number));
      }

      let success = 0;
      const successKeys: string[] = [];
      const errors: string[] = [];
      const CHUNK = 500;
      const chunks = Math.ceil(finalRows.length / CHUNK);
      for (let c = 0; c < chunks; c++) {
        const slice = finalRows.slice(c * CHUNK, c * CHUNK + CHUNK);
        const { error } = await supabase.from("students").upsert(slice as any, { onConflict: "admission_number" });
        if (error) errors.push(error.message);
        else { success += slice.length; slice.forEach((r) => successKeys.push(r.admission_number)); }
        setProgress(Math.round(((c + 1) / chunks) * 100));
      }

      const created = successKeys.filter((k) => !existing.has(k)).length;
      const res: ImportResult = {
        total: prepared.stats.total,
        valid: prepared.stats.valid,
        skipped: prepared.stats.skippedNoName,
        generated: prepared.stats.willGenerate,
        dupMerged: prepared.stats.dupMerged,
        created,
        updated: success - created,
        success,
        errors,
      };
      setResult(res);
      if (success > 0) {
        toast.success(`Imported ${success} student${success !== 1 ? "s" : ""} · ${created} new, ${success - created} updated`);
        onImported();
      } else {
        toast.error("Import failed — see details.");
      }
    } catch (e: any) {
      toast.error(e?.message || "Import failed.");
    } finally {
      setImporting(false);
    }
  };

  const downloadTemplate = () => downloadCSV("students-template.csv", [{
    admission_number: "24050512001", barcode: "24050512001", full_name: "John Doe",
    programme: "Computer Science", nta_level: "6", year_of_study: "1", status: "active",
    expires_at: "", parent_email: "parent@example.com", parent_phone: "+255700000000", notes: "",
  }]);

  const selectableCols = sourceCols.filter(Boolean);

  return (
    <Dialog open={open} onOpenChange={(v) => (v ? onOpenChange(true) : close())}>
      <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5 text-primary" /> Bulk import students
          </DialogTitle>
          <DialogDescription>
            Add many students at once from a CSV/JSON file, pasted text, or a live API link.
            Only a <strong>name</strong> is required — admission numbers and barcodes are generated automatically when missing.
          </DialogDescription>
        </DialogHeader>

        {/* ── STEP 3: results ─────────────────────────────────────────────── */}
        {result ? (
          <div className="space-y-4">
            <div className="flex items-center gap-2 rounded-lg bg-success/10 px-4 py-3 text-success">
              <CheckCircle2 className="h-5 w-5" />
              <span className="font-semibold">Import complete</span>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                { label: "New", value: result.created, cls: "text-success bg-success/10" },
                { label: "Updated", value: result.updated, cls: "text-primary bg-primary/10" },
                { label: "Skipped (no name)", value: result.skipped, cls: "text-warning bg-warning/10" },
                { label: "Auto-coded", value: result.generated, cls: "text-muted-foreground bg-secondary" },
              ].map((s) => (
                <div key={s.label} className={`flex flex-col items-center rounded-xl py-4 ${s.cls}`}>
                  <span className="text-3xl font-bold">{s.value}</span>
                  <span className="mt-1 text-center text-xs font-medium">{s.label}</span>
                </div>
              ))}
            </div>
            {result.dupMerged > 0 && (
              <p className="text-xs text-muted-foreground">
                {result.dupMerged} duplicate admission number{result.dupMerged !== 1 ? "s" : ""} within the file were merged (last row won).
              </p>
            )}
            {result.errors.length > 0 && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3">
                <p className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-destructive">
                  <AlertTriangle className="h-4 w-4" /> {result.errors.length} error(s)
                </p>
                <ul className="max-h-32 space-y-1 overflow-y-auto text-xs text-destructive/90">
                  {result.errors.map((e, i) => <li key={i}>• {e}</li>)}
                </ul>
              </div>
            )}
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => { resetAll(); }}>Import more</Button>
              <Button onClick={close}>Done</Button>
            </DialogFooter>
          </div>
        ) : prepared ? (
          /* ── STEP 2: mapping + preview ─────────────────────────────────── */
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <button onClick={resetSource} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
                <ArrowLeft className="h-4 w-4" /> Change source
              </button>
              <Badge variant="secondary">{rawRows!.length} row{rawRows!.length !== 1 ? "s" : ""} loaded</Badge>
            </div>

            {/* Column mapping */}
            <div>
              <p className="mb-2 text-sm font-semibold">Match your columns</p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {TARGETS.map((tgt) => (
                  <div key={tgt.key} className="flex items-center gap-2">
                    <Label className="w-28 shrink-0 text-xs">
                      {tgt.label}{tgt.required && <span className="text-destructive"> *</span>}
                    </Label>
                    <Select
                      value={mapping[tgt.key] ?? NONE}
                      onValueChange={(v) => setMapping((m) => ({ ...m, [tgt.key]: v }))}
                    >
                      <SelectTrigger className="h-8 flex-1 text-xs">
                        <SelectValue placeholder="— Not mapped —" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE}>— Not mapped —</SelectItem>
                        {selectableCols.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>
            </div>

            {!nameMapped && (
              <div className="flex items-center gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
                <AlertTriangle className="h-4 w-4 shrink-0" /> Map the <strong>Full name</strong> column to continue.
              </div>
            )}

            {/* Auto-generate toggle */}
            <label className="flex items-start gap-2 rounded-lg border border-border bg-secondary/30 p-3 text-sm">
              <input type="checkbox" checked={autoGen} onChange={(e) => setAutoGen(e.target.checked)} className="mt-0.5" />
              <span className="flex items-center gap-1.5">
                <Sparkles className="h-3.5 w-3.5 text-primary" />
                Auto-generate an admission number &amp; barcode when a row has none
                {prepared.stats.willGenerate > 0 && (
                  <Badge variant="outline" className="ml-1 text-[10px]">{prepared.stats.willGenerate} row(s)</Badge>
                )}
              </span>
            </label>

            {/* Validation summary */}
            <div className="flex flex-wrap gap-2 text-xs">
              <Badge className="bg-success/15 text-success hover:bg-success/20">{prepared.stats.valid} ready</Badge>
              {prepared.stats.skippedNoName > 0 && <Badge variant="outline" className="text-warning">{prepared.stats.skippedNoName} skipped (no name)</Badge>}
              {prepared.stats.dupMerged > 0 && <Badge variant="outline">{prepared.stats.dupMerged} duplicates merged</Badge>}
            </div>

            {/* Preview */}
            {prepared.rows.length > 0 && (
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-xs">
                  <thead className="bg-secondary/60 text-left uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2">Name</th>
                      <th className="px-3 py-2">Admission</th>
                      <th className="px-3 py-2">Barcode</th>
                      <th className="px-3 py-2 hidden sm:table-cell">Programme</th>
                      <th className="px-3 py-2">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {prepared.rows.slice(0, 8).map((r, i) => (
                      <tr key={i}>
                        <td className="px-3 py-1.5 font-medium">{r.full_name}</td>
                        <td className="px-3 py-1.5 font-mono">
                          {r.admission_number ?? <span className="italic text-primary">(auto)</span>}
                        </td>
                        <td className="px-3 py-1.5 font-mono">
                          {r.barcode ?? <span className="italic text-primary">(auto)</span>}
                        </td>
                        <td className="px-3 py-1.5 hidden sm:table-cell text-muted-foreground">{r.programme || "—"}</td>
                        <td className="px-3 py-1.5">{r.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {prepared.rows.length > 8 && (
                  <div className="bg-secondary/30 px-3 py-1.5 text-center text-[11px] text-muted-foreground">
                    +{prepared.rows.length - 8} more row(s)
                  </div>
                )}
              </div>
            )}

            {importing && <Progress value={progress} className="h-2" />}

            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={resetSource} disabled={importing}>Back</Button>
              <Button onClick={doImport} disabled={!canImport || importing} className="gap-2">
                {importing
                  ? <><Loader2 className="h-4 w-4 animate-spin" /> Importing… {progress}%</>
                  : <><Upload className="h-4 w-4" /> Import {prepared.rows.length} student{prepared.rows.length !== 1 ? "s" : ""}</>}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          /* ── STEP 1: choose a source ───────────────────────────────────── */
          <Tabs value={tab} onValueChange={(v) => { setTab(v as any); setSrcError(null); }}>
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="file" className="gap-1.5"><FileSpreadsheet className="h-4 w-4" /> File</TabsTrigger>
              <TabsTrigger value="paste" className="gap-1.5"><ClipboardPaste className="h-4 w-4" /> Paste</TabsTrigger>
              <TabsTrigger value="url" className="gap-1.5"><Link2 className="h-4 w-4" /> API link</TabsTrigger>
            </TabsList>

            {/* FILE */}
            <TabsContent value="file" className="space-y-3 pt-2">
              <div
                onClick={() => fileRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) handleFile(f); }}
                className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border py-10 text-center transition-colors hover:border-primary/50 hover:bg-primary/[0.02]"
              >
                {loadingSrc
                  ? <Loader2 className="h-8 w-8 animate-spin text-primary" />
                  : <Upload className="h-8 w-8 text-muted-foreground" />}
                <p className="text-sm font-medium">Click to choose, or drag &amp; drop a file</p>
                <p className="text-xs text-muted-foreground">CSV or JSON · up to a few thousand rows</p>
              </div>
              <input
                ref={fileRef} type="file" accept=".csv,.json,.txt,text/csv,application/json" hidden
                onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
              />
              <button onClick={downloadTemplate} className="flex items-center gap-1.5 text-xs text-primary hover:underline">
                <Download className="h-3.5 w-3.5" /> Download CSV template
              </button>
            </TabsContent>

            {/* PASTE */}
            <TabsContent value="paste" className="space-y-3 pt-2">
              <Textarea
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                placeholder={"Paste CSV, JSON, or one student name per line, e.g.\n\nJohn Doe\nJane Smith\nAli Hassan"}
                className="h-40 font-mono text-xs"
              />
              <div className="flex items-center justify-between">
                <p className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Info className="h-3.5 w-3.5" /> A plain list of names works too.
                </p>
                <Button size="sm" onClick={handlePaste} disabled={!pasteText.trim() || loadingSrc} className="gap-1.5">
                  Parse <ArrowLeft className="h-3.5 w-3.5 rotate-180" />
                </Button>
              </div>
            </TabsContent>

            {/* URL */}
            <TabsContent value="url" className="space-y-3 pt-2">
              <div className="space-y-1.5">
                <Label className="text-xs">API endpoint URL</Label>
                <Input
                  value={apiUrl}
                  onChange={(e) => setApiUrl(e.target.value)}
                  placeholder="https://api.example.com/students"
                />
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label className="text-xs">Auth header name (optional)</Label>
                  <Input value={apiHeaderName} onChange={(e) => setApiHeaderName(e.target.value)} placeholder="Authorization" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Auth header value (optional)</Label>
                  <Input value={apiAuth} onChange={(e) => setApiAuth(e.target.value)} placeholder="Bearer xxxxx or an API key" type="password" />
                </div>
              </div>
              <p className="flex items-start gap-1 text-xs text-muted-foreground">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                The endpoint should return a JSON array of students (or an object with a <code>data</code>/<code>students</code> array), or CSV text.
                Cross-origin (CORS) restrictions apply — if the fetch is blocked, download the data and use the File tab.
              </p>
              <div className="flex justify-end">
                <Button size="sm" onClick={handleFetch} disabled={!apiUrl.trim() || loadingSrc} className="gap-1.5">
                  {loadingSrc ? <><Loader2 className="h-4 w-4 animate-spin" /> Fetching…</> : <><Link2 className="h-4 w-4" /> Fetch</>}
                </Button>
              </div>
            </TabsContent>

            {srcError && (
              <div className="mt-3 flex items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> <span>{srcError}</span>
              </div>
            )}
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
}
