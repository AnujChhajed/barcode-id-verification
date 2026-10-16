import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { CheckCircle2, XCircle, AlertTriangle, Search, Download, Activity, TrendingDown } from "lucide-react";
import { downloadCSV } from "@/lib/csv";
import jsPDF from "jspdf";

export const Route = createFileRoute("/_authenticated/logs")({
  component: LogsPage,
});

// ── Helpers ───────────────────────────────────────────────────────────────

/** Returns "YYYY-MM-DD" in the browser's LOCAL timezone, n days from today. */
function dayOffset(n: number) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  const y  = d.getFullYear();
  const m  = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

/** Start of a local calendar day → ISO string for Supabase gte filter. */
function localDayStart(dateStr: string) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0).toISOString();
}

/** End of a local calendar day → ISO string for Supabase lte filter. */
function localDayEnd(dateStr: string) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d, 23, 59, 59, 999).toISOString();
}

function LogsPage() {
  const { t } = useTranslation();
  const [search,    setSearch]    = useState("");
  const [decision,  setDecision]  = useState("all");
  const [direction, setDirection] = useState("all");
  const [live,      setLive]      = useState(false);
  const [fromDate,  setFromDate]  = useState(dayOffset(-30));
  const [toDate,    setToDate]    = useState(dayOffset(1));

  const { data: gates } = useQuery({
    queryKey: ["gates-min"],
    queryFn: async () => (await supabase.from("gates").select("id,name")).data ?? [],
  });
  const [gateId, setGateId] = useState("all");

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["logs", search, decision, direction, gateId, fromDate, toDate],
    queryFn: async () => {
      let q = supabase.from("access_logs")
        .select("id, scanned_code, decision, reason, scanned_at, direction, gate_id, student:students(full_name, admission_number, programme)")
        .order("scanned_at", { ascending: false })
        .limit(2000)
        .gte("scanned_at", localDayStart(fromDate))
        .lte("scanned_at", localDayEnd(toDate));
      if (decision  !== "all") q = q.eq("decision",  decision  as any);
      if (direction !== "all") q = q.eq("direction", direction as any);
      if (gateId    !== "all") q = q.eq("gate_id",   gateId);
      if (search.trim()) q = q.ilike("scanned_code", `%${search.trim()}%`);
      const { data } = await q;
      return data ?? [];
    },
  });

  // Live realtime
  useEffect(() => {
    if (!live) return;
    const ch = supabase.channel("logs-live")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "access_logs" }, () => refetch())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [live, refetch]);

  const gateName = (id: string | null) => gates?.find((g) => g.id === id)?.name ?? "—";

  // ── Today attendance ──────────────────────────────────────────────────
  const attendance = useMemo(() => {
    if (!data) return [];
    const today = new Date(); today.setHours(0,0,0,0);
    const map = new Map<string, { name: string; programme: string; firstIn: string | null; lastOut: string | null }>();
    for (const l of [...data].reverse() as any[]) {
      if (new Date(l.scanned_at) < today) continue;
      if (!l.student?.admission_number) continue;
      const key = l.student.admission_number;
      const cur = map.get(key) ?? { name: l.student.full_name, programme: l.student.programme ?? "", firstIn: null, lastOut: null };
      if (l.direction === "in"  && !cur.firstIn)  cur.firstIn  = l.scanned_at;
      if (l.direction === "out")                   cur.lastOut  = l.scanned_at;
      map.set(key, cur);
    }
    return Array.from(map.entries()).map(([k, v]) => ({ admission: k, ...v }));
  }, [data]);

  // ── Denied frequency ──────────────────────────────────────────────────
  const deniedFreq = useMemo(() => {
    if (!data) return [];
    const map = new Map<string, { code: string; name: string | null; programme: string | null; count: number; lastSeen: string }>();
    for (const l of data as any[]) {
      if (l.decision !== "denied") continue;
      const key = l.scanned_code;
      const cur = map.get(key) ?? { code: key, name: l.student?.full_name ?? null, programme: l.student?.programme ?? null, count: 0, lastSeen: l.scanned_at };
      cur.count++;
      if (l.scanned_at > cur.lastSeen) cur.lastSeen = l.scanned_at;
      map.set(key, cur);
    }
    return Array.from(map.values()).sort((a, b) => b.count - a.count).slice(0, 50);
  }, [data]);

  // ── Exports ───────────────────────────────────────────────────────────
  const exportLogsCSV = () => {
    if (!data?.length) return;
    downloadCSV(`logs-${fromDate}-to-${toDate}.csv`,
      data.map((l: any) => ({
        when:         l.scanned_at,
        decision:     l.decision,
        direction:    l.direction ?? "",
        gate:         gateName(l.gate_id),
        student:      l.student?.full_name ?? "",
        admission:    l.student?.admission_number ?? "",
        scanned_code: l.scanned_code,
        reason:       l.reason ?? "",
      })));
  };

  const exportLogsPDF = () => {
    if (!data?.length) return;
    const doc = new jsPDF({ unit: "pt", format: "a4" });
    doc.setFontSize(13); doc.setFont("helvetica", "bold");
    doc.text("Access Logs", 40, 40);
    doc.setFontSize(9); doc.setFont("helvetica", "normal");
    doc.text(`${fromDate} → ${toDate}  ·  ${data.length} records`, 40, 56);
    doc.setFontSize(8);
    let y = 80;
    const cols = ["When", "Decision", "Dir", "Student", "Code", "Reason"];
    const xs   = [40, 155, 210, 240, 400, 480];
    doc.setFont("helvetica", "bold");
    cols.forEach((c, i) => doc.text(c, xs[i], y));
    y += 8; doc.line(40, y, 555, y); y += 12;
    doc.setFont("helvetica", "normal");
    for (const l of data as any[]) {
      if (y > 800) { doc.addPage(); y = 40; }
      doc.text(new Date(l.scanned_at).toLocaleString().slice(0,18), xs[0], y);
      doc.text(l.decision,                                          xs[1], y);
      doc.text(l.direction ?? "—",                                  xs[2], y);
      doc.text((l.student?.full_name ?? "—").slice(0, 24),          xs[3], y);
      doc.text(String(l.scanned_code).slice(0,14),                  xs[4], y);
      doc.text((l.reason ?? "").slice(0, 16),                       xs[5], y);
      y += 14;
    }
    doc.save(`logs-${fromDate}-to-${toDate}.pdf`);
  };

  const exportAttendanceCSV = () => {
    downloadCSV(`attendance-${new Date().toISOString().slice(0,10)}.csv`,
      attendance.map((a) => ({ admission: a.admission, name: a.name, programme: a.programme, first_entry: a.firstIn ?? "", last_exit: a.lastOut ?? "" })));
  };

  const exportDeniedCSV = () => {
    if (!deniedFreq.length) return;
    downloadCSV(`denied-frequency-${fromDate}-to-${toDate}.csv`,
      deniedFreq.map((d) => ({ code: d.code, student: d.name ?? "", programme: d.programme ?? "", denials: d.count, last_seen: d.lastSeen })));
  };

  const exportDeniedPDF = () => {
    if (!deniedFreq.length) return;
    const doc = new jsPDF({ unit: "pt", format: "a4" });
    doc.setFontSize(13); doc.setFont("helvetica", "bold");
    doc.text("Denied Access — Frequency Report", 40, 40);
    doc.setFontSize(9); doc.setFont("helvetica", "normal");
    doc.text(`${fromDate} → ${toDate}  ·  Top ${deniedFreq.length} codes`, 40, 56);
    let y = 80;
    doc.setFont("helvetica", "bold"); doc.setFontSize(8);
    doc.text("#", 40, y); doc.text("Code", 65, y); doc.text("Student", 200, y); doc.text("Denials", 380, y); doc.text("Last seen", 430, y);
    y += 8; doc.line(40, y, 555, y); y += 12;
    doc.setFont("helvetica", "normal");
    deniedFreq.forEach((d, i) => {
      if (y > 800) { doc.addPage(); y = 40; }
      doc.text(String(i + 1), 40, y);
      doc.text(String(d.code).slice(0, 20), 65, y);
      doc.text((d.name ?? "Unknown").slice(0, 30), 200, y);
      doc.text(String(d.count), 380, y);
      doc.text(new Date(d.lastSeen).toLocaleString().slice(0, 18), 430, y);
      y += 14;
    });
    doc.save(`denied-frequency-${fromDate}-to-${toDate}.pdf`);
  };

  // ── UI ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{t("logs.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("logs.subtitle")}</p>
        </div>
        <Button size="sm" variant={live ? "default" : "outline"} onClick={() => setLive((l) => !l)}>
          <Activity className="mr-2 h-4 w-4" /> {live ? t("logs.live_on") : t("common2.live_badge")}
        </Button>
      </div>

      {/* Date range filter */}
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card p-4 shadow-sm">
        <div className="flex flex-1 flex-wrap gap-3">
          <div className="space-y-1 min-w-[140px]">
            <Label className="text-xs">{t("logs.from")}</Label>
            <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="h-9" />
          </div>
          <div className="space-y-1 min-w-[140px]">
            <Label className="text-xs">{t("logs.to")}</Label>
            <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="h-9" />
          </div>
          {/* Quick presets */}
          <div className="flex items-end gap-1.5 flex-wrap">
            {[
              { label: t("logs.preset_today"),   from: dayOffset(0),   to: dayOffset(1) },
              { label: t("logs.preset_7d"),       from: dayOffset(-7),  to: dayOffset(1) },
              { label: t("logs.preset_30d"),      from: dayOffset(-30), to: dayOffset(1) },
            ].map((p) => (
              <Button key={p.label} size="sm" variant="outline" className="h-9"
                onClick={() => { setFromDate(p.from); setToDate(p.to); }}>
                {p.label}
              </Button>
            ))}
          </div>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={exportLogsCSV}><Download className="mr-2 h-4 w-4" /> CSV</Button>
          <Button size="sm" variant="outline" onClick={exportLogsPDF}><Download className="mr-2 h-4 w-4" /> PDF</Button>
        </div>
      </div>

      <Tabs defaultValue="logs">
        <TabsList>
          <TabsTrigger value="logs">{t("logs.tab_logs")}</TabsTrigger>
          <TabsTrigger value="attendance">{t("logs.tab_attend")}</TabsTrigger>
          <TabsTrigger value="denied">
            <TrendingDown className="mr-1.5 h-3.5 w-3.5" />
            {t("logs.tab_denied")}
            {deniedFreq.length > 0 && (
              <span className="ml-1.5 rounded-full bg-destructive/15 px-1.5 text-[10px] font-bold text-destructive">
                {deniedFreq.length}
              </span>
            )}
          </TabsTrigger>
        </TabsList>

        {/* ── All logs tab ── */}
        <TabsContent value="logs" className="space-y-4">
          <div className="flex flex-wrap gap-3">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder={t("logs.search_ph")} className="pl-9" />
            </div>
            <Select value={decision} onValueChange={setDecision}>
              <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("logs.all_decisions")}</SelectItem>
                <SelectItem value="allowed">{t("logs.decision_allowed")}</SelectItem>
                <SelectItem value="denied">{t("logs.decision_denied")}</SelectItem>
                <SelectItem value="unknown">{t("logs.decision_unknown")}</SelectItem>
              </SelectContent>
            </Select>
            <Select value={direction} onValueChange={setDirection}>
              <SelectTrigger className="w-[120px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("logs.dir_all")}</SelectItem>
                <SelectItem value="in">{t("common2.entry")}</SelectItem>
                <SelectItem value="out">{t("common2.exit")}</SelectItem>
              </SelectContent>
            </Select>
            <Select value={gateId} onValueChange={setGateId}>
              <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("logs.all_gates")}</SelectItem>
                {(gates ?? []).map((g) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
            {isLoading ? (
              <div className="px-5 py-10 text-center text-sm text-muted-foreground">{t("common.loading")}</div>
            ) : (data ?? []).length === 0 ? (
              <div className="px-5 py-10 text-center text-sm text-muted-foreground">{t("logs.no_match")}</div>
            ) : (
              <>
                <div className="border-b border-border px-5 py-2 text-xs text-muted-foreground">
                  {t("common2.records", { count: (data ?? []).length })}
                </div>
                <table className="w-full text-sm">
                  <thead className="bg-secondary text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3 text-left">{t("logs.col_when")}</th>
                      <th className="px-4 py-3 text-left">{t("logs.col_decision")}</th>
                      <th className="px-4 py-3 text-left">{t("logs.col_dir")}</th>
                      <th className="px-4 py-3 text-left">{t("gates.title")}</th>
                      <th className="px-4 py-3 text-left">{t("common.student")}</th>
                      <th className="px-4 py-3 text-left">{t("logs.col_code")}</th>
                      <th className="px-4 py-3 text-left">{t("logs.col_reason")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {(data as any[]).map((log) => (
                      <tr key={log.id} className="hover:bg-secondary/30">
                        <td className="px-4 py-3 text-xs text-muted-foreground">{new Date(log.scanned_at).toLocaleString()}</td>
                        <td className="px-4 py-3"><DecisionBadge d={log.decision} /></td>
                        <td className="px-4 py-3 text-xs uppercase text-muted-foreground">{log.direction ?? "—"}</td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">{gateName(log.gate_id)}</td>
                        <td className="px-4 py-3">
                          {log.student
                            ? <div><div className="font-medium">{log.student.full_name}</div><div className="text-xs text-muted-foreground">{log.student.admission_number}</div></div>
                            : <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="px-4 py-3 font-mono text-xs">{log.scanned_code}</td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">{log.reason ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </div>
        </TabsContent>

        {/* ── Today attendance tab ── */}
        <TabsContent value="attendance" className="space-y-4">
          <div className="flex justify-end">
            <Button size="sm" variant="outline" onClick={exportAttendanceCSV}>
              <Download className="mr-2 h-4 w-4" /> {t("logs.export_csv")}
            </Button>
          </div>
          <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
            {attendance.length === 0 ? (
              <div className="px-5 py-10 text-center text-sm text-muted-foreground">{t("logs.no_entries_today")}</div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-secondary text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 text-left">{t("stu.col_admission")}</th>
                    <th className="px-4 py-3 text-left">{t("common.name")}</th>
                    <th className="px-4 py-3 text-left">{t("rpt.col_programme")}</th>
                    <th className="px-4 py-3 text-left">{t("logs.col_first_entry")}</th>
                    <th className="px-4 py-3 text-left">{t("logs.col_last_exit")}</th>
                    <th className="px-4 py-3 text-left">{t("common.status")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {attendance.map((a) => (
                    <tr key={a.admission}>
                      <td className="px-4 py-3 font-mono text-xs">{a.admission}</td>
                      <td className="px-4 py-3 font-medium">{a.name}</td>
                      <td className="px-4 py-3 text-muted-foreground">{a.programme || "—"}</td>
                      <td className="px-4 py-3 text-xs">{a.firstIn  ? new Date(a.firstIn).toLocaleTimeString()  : "—"}</td>
                      <td className="px-4 py-3 text-xs">{a.lastOut ? new Date(a.lastOut).toLocaleTimeString() : "—"}</td>
                      <td className="px-4 py-3">
                        {a.firstIn && !a.lastOut ? <Badge className="bg-success text-success-foreground">{t("logs.attend_campus")}</Badge>
                          : a.lastOut ? <Badge variant="secondary">{t("logs.attend_left")}</Badge>
                          : <Badge variant="outline">—</Badge>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </TabsContent>

        {/* ── Denied frequency tab ── */}
        <TabsContent value="denied" className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              {t("logs.denied_desc")}
            </p>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={exportDeniedCSV}><Download className="mr-2 h-4 w-4" /> CSV</Button>
              <Button size="sm" variant="outline" onClick={exportDeniedPDF}><Download className="mr-2 h-4 w-4" /> PDF</Button>
            </div>
          </div>
          <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
            {isLoading ? (
              <div className="px-5 py-10 text-center text-sm text-muted-foreground">{t("common.loading")}</div>
            ) : deniedFreq.length === 0 ? (
              <div className="px-5 py-10 text-center text-sm text-muted-foreground">{t("logs.no_denied")}</div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-secondary text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 text-left">#</th>
                    <th className="px-4 py-3 text-left">{t("logs.col_code")}</th>
                    <th className="px-4 py-3 text-left">{t("common.student")}</th>
                    <th className="px-4 py-3 text-left">{t("logs.col_denials")}</th>
                    <th className="px-4 py-3 text-left">{t("logs.col_last_seen")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {deniedFreq.map((d, i) => (
                    <tr key={d.code} className="hover:bg-secondary/30">
                      <td className="px-4 py-3 text-muted-foreground">{i + 1}</td>
                      <td className="px-4 py-3 font-mono text-xs">{d.code}</td>
                      <td className="px-4 py-3">
                        {d.name
                          ? <div><div className="font-medium">{d.name}</div><div className="text-xs text-muted-foreground">{d.programme}</div></div>
                          : <span className="text-muted-foreground italic">{t("logs.unknown_code")}</span>}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`font-bold tabular-nums ${d.count >= 10 ? "text-destructive" : d.count >= 5 ? "text-warning" : ""}`}>
                          {d.count}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{new Date(d.lastSeen).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function DecisionBadge({ d }: { d: string }) {
  const { t } = useTranslation();
  if (d === "allowed") return <Badge className="gap-1 bg-success text-success-foreground"><CheckCircle2 className="h-3 w-3" /> {t("logs.decision_allowed")}</Badge>;
  if (d === "denied")  return <Badge variant="destructive" className="gap-1"><XCircle className="h-3 w-3" /> {t("logs.decision_denied")}</Badge>;
  return <Badge variant="secondary" className="gap-1"><AlertTriangle className="h-3 w-3" /> {t("logs.decision_unknown")}</Badge>;
}
