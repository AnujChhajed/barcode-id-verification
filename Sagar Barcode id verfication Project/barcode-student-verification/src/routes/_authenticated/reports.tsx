import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Download, ChevronDown, ChevronRight, Users, UserCheck, UserX, Clock } from "lucide-react";
import { downloadCSV } from "@/lib/csv";
import jsPDF from "jspdf";

type StudentRow = {
  id: string;
  full_name: string;
  admission_number: string;
  programme: string;
  parent_email: string | null;
  parent_phone: string | null;
};

export const Route = createFileRoute("/_authenticated/reports")({
  component: ReportsPage,
});

function todayStr() { return new Date().toISOString().slice(0, 10); }

function ReportsPage() {
  const { t } = useTranslation();
  const { loading } = useAuth();
  const [reportDate, setReportDate] = useState(todayStr());
  const [lateCutoff, setLateCutoff] = useState("09:00");
  const [progFilter, setProgFilter] = useState("all");
  const [expandedProg, setExpandedProg] = useState<Set<string>>(new Set());

  // ── Fetch all active, non-visitor students ────────────────────────────
  const { data: students } = useQuery({
    queryKey: ["reports-students"],
    staleTime: 60_000,
    queryFn: async () => {
      const { data } = await supabase
        .from("students")
        .select("id, full_name, admission_number, programme, parent_email, parent_phone")
        .eq("status", "active")
        .eq("is_visitor", false);
      return data ?? [];
    },
  });

  // ── Fetch that day's allowed IN entries ───────────────────────────────
  const { data: entries, isLoading } = useQuery({
    queryKey: ["reports-entries", reportDate],
    queryFn: async () => {
      const dayStart = new Date(reportDate); dayStart.setHours(0, 0, 0, 0);
      const dayEnd   = new Date(reportDate); dayEnd.setHours(23, 59, 59, 999);
      const { data } = await supabase
        .from("access_logs")
        .select("student_id, scanned_at")
        .eq("decision", "allowed")
        .eq("direction", "in")
        .gte("scanned_at", dayStart.toISOString())
        .lte("scanned_at", dayEnd.toISOString());
      return data ?? [];
    },
  });

  // ── Derived data ──────────────────────────────────────────────────────
  const { presentSet, firstEntry } = useMemo(() => {
    const presentSet = new Set<string>();
    const firstEntry = new Map<string, string>(); // student_id → ISO string
    for (const e of entries ?? []) {
      if (!e.student_id) continue;
      presentSet.add(e.student_id);
      const prev = firstEntry.get(e.student_id);
      if (!prev || e.scanned_at < prev) firstEntry.set(e.student_id, e.scanned_at);
    }
    return { presentSet, firstEntry };
  }, [entries]);

  const programmes = useMemo(() => {
    const ps = new Set<string>();
    for (const s of students ?? []) ps.add(s.programme ?? "—");
    return Array.from(ps).sort();
  }, [students]);

  type ProgRow = {
    enrolled: StudentRow[];
    present:  StudentRow[];
    absent:   StudentRow[];
    late:     Array<{ student: StudentRow; time: string }>;
  };

  // programme → { enrolled[], present[], absent[], late[] }
  const byProgramme = useMemo(() => {
    const map = new Map<string, ProgRow>();
    for (const s of students ?? []) {
      const prog = s.programme ?? "—";
      if (!map.has(prog)) map.set(prog, { enrolled: [], present: [], absent: [], late: [] });
      const row = map.get(prog)!;
      row.enrolled.push(s);
      if (presentSet.has(s.id)) {
        row.present.push(s);
        const t = firstEntry.get(s.id)!;
        const tStr = t.slice(11, 16); // HH:MM
        if (tStr > lateCutoff) row.late.push({ student: s, time: t });
      } else {
        row.absent.push(s);
      }
    }
    return map;
  }, [students, presentSet, firstEntry, lateCutoff]);

  const filteredProgrammes = useMemo(() =>
    progFilter === "all"
      ? Array.from(byProgramme.entries())
      : Array.from(byProgramme.entries()).filter(([p]) => p === progFilter),
    [byProgramme, progFilter]);

  const totals = useMemo(() => {
    let enrolled = 0, present = 0, absent = 0, late = 0;
    for (const [, v] of filteredProgrammes) {
      enrolled += v.enrolled.length;
      present  += v.present.length;
      absent   += v.absent.length;
      late     += v.late.length;
    }
    return { enrolled, present, absent, late };
  }, [filteredProgrammes]);

  if (loading) return null;

  const toggleProg = (p: string) =>
    setExpandedProg((s) => { const n = new Set(s); n.has(p) ? n.delete(p) : n.add(p); return n; });

  const pct = (n: number, d: number) => (d === 0 ? "—" : `${Math.round((n / d) * 100)}%`);

  // ── Exports ───────────────────────────────────────────────────────────
  const exportSummaryCSV = () => {
    const rows = filteredProgrammes.map(([prog, v]) => ({
      programme: prog,
      enrolled:  v.enrolled.length,
      present:   v.present.length,
      absent:    v.absent.length,
      late:      v.late.length,
      pct_present: pct(v.present.length, v.enrolled.length),
    }));
    downloadCSV(`attendance-summary-${reportDate}.csv`, rows);
  };

  const exportAbsenteesCSV = () => {
    const rows: any[] = [];
    for (const [prog, v] of filteredProgrammes) {
      for (const s of v.absent) {
        rows.push({ programme: prog, admission: s.admission_number, name: s.full_name, parent_email: s.parent_email ?? "", parent_phone: s.parent_phone ?? "" });
      }
    }
    downloadCSV(`absentees-${reportDate}.csv`, rows);
  };

  const exportSummaryPDF = () => {
    const doc = new jsPDF({ unit: "mm", format: "a4" });
    doc.setFontSize(14); doc.setFont("helvetica", "bold");
    doc.text("Attendance Report", 14, 18);
    doc.setFontSize(9); doc.setFont("helvetica", "normal");
    doc.text(`Date: ${reportDate}  ·  Late cutoff: ${lateCutoff}  ·  Generated: ${new Date().toLocaleString()}`, 14, 25);
    doc.setDrawColor(200); doc.line(14, 28, 196, 28);

    // Summary table
    const headers = ["Programme", "Enrolled", "Present", "Absent", "Late", "% Present"];
    const colW    = [70, 20, 20, 20, 18, 22];
    let y = 36;
    doc.setFillColor(240, 245, 240); doc.rect(14, y - 4, 182, 7, "F");
    doc.setFont("helvetica", "bold"); doc.setFontSize(8);
    let x = 14;
    headers.forEach((h, i) => { doc.text(h, x + 1, y); x += colW[i]; });
    y += 6; doc.setFont("helvetica", "normal");

    for (const [prog, v] of filteredProgrammes) {
      if (y > 270) { doc.addPage(); y = 20; }
      const pp = pct(v.present.length, v.enrolled.length);
      x = 14;
      [prog.slice(0, 40), String(v.enrolled.length), String(v.present.length), String(v.absent.length), String(v.late.length), pp]
        .forEach((c, i) => { doc.text(c, x + 1, y); x += colW[i]; });
      y += 6;
    }

    // Totals row
    y += 2; doc.setDrawColor(180); doc.line(14, y, 196, y); y += 5;
    doc.setFont("helvetica", "bold");
    x = 14;
    ["TOTAL", String(totals.enrolled), String(totals.present), String(totals.absent), String(totals.late), pct(totals.present, totals.enrolled)]
      .forEach((c, i) => { doc.text(c, x + 1, y); x += colW[i]; });

    // Absentees section
    y += 12; doc.setFontSize(11); doc.text("Absentee Detail", 14, y); y += 6;
    doc.setFont("helvetica", "normal"); doc.setFontSize(7.5);
    for (const [prog, v] of filteredProgrammes) {
      if (!v.absent.length) continue;
      if (y > 265) { doc.addPage(); y = 20; }
      doc.setFont("helvetica", "bold"); doc.text(prog, 14, y); y += 5;
      doc.setFont("helvetica", "normal");
      for (const s of v.absent) {
        if (y > 270) { doc.addPage(); y = 20; }
        doc.text(`  ${s.admission_number}  ${s.full_name}`, 14, y); y += 5;
      }
      y += 2;
    }
    doc.save(`attendance-${reportDate}.pdf`);
  };

  const allLate = useMemo(() => {
    const arr: Array<{ student: StudentRow; time: string; programme: string }> = [];
    for (const [prog, v] of filteredProgrammes) {
      for (const entry of v.late) arr.push({ student: entry.student, time: entry.time, programme: prog });
    }
    return arr.sort((a, b) => a.time.localeCompare(b.time));
  }, [filteredProgrammes]);

  const allAbsent = useMemo(() => {
    const arr: Array<StudentRow & { programme_: string }> = [];
    for (const [prog, v] of filteredProgrammes) {
      for (const s of v.absent) arr.push({ ...s, programme_: prog });
    }
    return arr;
  }, [filteredProgrammes]);

  // ─────────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t("rpt.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("rpt.subtitle")}</p>
      </div>

      {/* ── Controls ── */}
      <div className="flex flex-wrap items-end gap-4 rounded-xl border border-border bg-card p-4 shadow-sm">
        <div className="space-y-1">
          <Label className="text-xs">{t("rpt.label_date")}</Label>
          <Input type="date" value={reportDate} onChange={(e) => setReportDate(e.target.value)} className="h-9 w-44" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">{t("rpt.label_late_after")}</Label>
          <Input type="time" value={lateCutoff} onChange={(e) => setLateCutoff(e.target.value)} className="h-9 w-32" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">{t("rpt.label_programme")}</Label>
          <Select value={progFilter} onValueChange={setProgFilter}>
            <SelectTrigger className="h-9 w-56"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("rpt.all_programmes")}</SelectItem>
              {programmes.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-end gap-2 ml-auto">
          <Button size="sm" variant="outline" onClick={exportSummaryCSV}><Download className="mr-1.5 h-3.5 w-3.5" /> {t("rpt.export_summary_csv")}</Button>
          <Button size="sm" variant="outline" onClick={exportAbsenteesCSV}><Download className="mr-1.5 h-3.5 w-3.5" /> {t("rpt.export_absentees_csv")}</Button>
          <Button size="sm" onClick={exportSummaryPDF}><Download className="mr-1.5 h-3.5 w-3.5" /> {t("rpt.export_pdf")}</Button>
        </div>
      </div>

      {/* ── Summary stat strip ── */}
      <div className="grid gap-3 sm:grid-cols-4">
        {[
          { label: t("rpt.stat_enrolled"), value: totals.enrolled, icon: Users,      color: "text-foreground" },
          { label: t("rpt.stat_present"),  value: totals.present,  icon: UserCheck,  color: "text-success" },
          { label: t("rpt.stat_absent"),   value: totals.absent,   icon: UserX,      color: "text-destructive" },
          { label: t("rpt.stat_late"),     value: totals.late,     icon: Clock,      color: "text-warning" },
        ].map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="rounded-xl border border-border bg-card p-4 shadow-sm flex items-center gap-3">
            <Icon className={`h-8 w-8 ${color} opacity-80`} />
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
              <p className={`text-2xl font-bold ${color}`}>{isLoading ? "…" : value}</p>
            </div>
          </div>
        ))}
      </div>

      <Tabs defaultValue="summary">
        <TabsList>
          <TabsTrigger value="summary">{t("rpt.tab_summary")}</TabsTrigger>
          <TabsTrigger value="absentees">
            {t("rpt.tab_absentees")}
            {totals.absent > 0 && <span className="ml-1.5 rounded-full bg-destructive/15 px-1.5 text-[10px] font-bold text-destructive">{totals.absent}</span>}
          </TabsTrigger>
          <TabsTrigger value="late">
            {t("rpt.tab_late")}
            {totals.late > 0 && <span className="ml-1.5 rounded-full bg-warning/15 px-1.5 text-[10px] font-bold text-warning">{totals.late}</span>}
          </TabsTrigger>
        </TabsList>

        {/* ── By Programme tab ── */}
        <TabsContent value="summary" className="space-y-2 pt-2">
          <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
            {isLoading ? (
              <div className="px-5 py-10 text-center text-sm text-muted-foreground">{t("common.loading")}</div>
            ) : filteredProgrammes.length === 0 ? (
              <div className="px-5 py-10 text-center text-sm text-muted-foreground">{t("rpt.no_data")}</div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-secondary text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 text-left">{t("rpt.col_programme")}</th>
                    <th className="px-4 py-3 text-right">{t("rpt.stat_enrolled")}</th>
                    <th className="px-4 py-3 text-right">{t("rpt.stat_present")}</th>
                    <th className="px-4 py-3 text-right">{t("rpt.stat_absent")}</th>
                    <th className="px-4 py-3 text-right">{t("rpt.stat_late")}</th>
                    <th className="px-4 py-3 text-right">{t("rpt.col_attendance")}</th>
                    <th className="px-4 py-3 w-8"></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredProgrammes.map(([prog, v]) => {
                    const isExp = expandedProg.has(prog);
                    const pp = v.enrolled.length ? Math.round((v.present.length / v.enrolled.length) * 100) : 0;
                    return (
                      <>
                        <tr
                          key={prog}
                          className="border-t border-border hover:bg-secondary/40 cursor-pointer"
                          onClick={() => toggleProg(prog)}
                        >
                          <td className="px-4 py-3 font-medium flex items-center gap-2">
                            {isExp ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                            {prog}
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums">{v.enrolled.length}</td>
                          <td className="px-4 py-3 text-right tabular-nums text-success font-medium">{v.present.length}</td>
                          <td className="px-4 py-3 text-right tabular-nums text-destructive font-medium">{v.absent.length}</td>
                          <td className="px-4 py-3 text-right tabular-nums text-warning">{v.late.length}</td>
                          <td className="px-4 py-3 text-right">
                            <div className="inline-flex items-center gap-2">
                              <div className="h-2 w-20 overflow-hidden rounded-full bg-secondary">
                                <div className="h-full rounded-full bg-success transition-all" style={{ width: `${pp}%` }} />
                              </div>
                              <span className={`text-xs font-semibold tabular-nums ${pp >= 75 ? "text-success" : pp >= 50 ? "text-warning" : "text-destructive"}`}>{pp}%</span>
                            </div>
                          </td>
                          <td />
                        </tr>
                        {isExp && (
                          <tr key={`${prog}-detail`} className="border-t border-dashed border-border bg-secondary/20">
                            <td colSpan={7} className="px-6 py-3">
                              <div className="grid gap-3 sm:grid-cols-2">
                                {v.absent.length > 0 && (
                                  <div>
                                    <p className="mb-1 text-xs font-semibold text-destructive uppercase tracking-wide">{t("rpt.stat_absent")} ({v.absent.length})</p>
                                    <div className="space-y-1">
                                      {v.absent.map((s) => (
                                        <div key={s.id} className="flex items-center gap-2 text-xs">
                                          <span className="font-mono text-muted-foreground">{s.admission_number}</span>
                                          <span>{s.full_name}</span>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}
                                {v.late.length > 0 && (
                                  <div>
                                    <p className="mb-1 text-xs font-semibold text-warning uppercase tracking-wide">{t("rpt.late_after", { time: lateCutoff })} ({v.late.length})</p>
                                    <div className="space-y-1">
                                      {v.late.map(({ student: s, time: t }) => (
                                        <div key={s.id} className="flex items-center gap-2 text-xs">
                                          <span className="font-mono text-muted-foreground">{s.admission_number}</span>
                                          <span>{s.full_name}</span>
                                          <span className="ml-auto text-warning">{new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </>
                    );
                  })}
                  {/* Totals footer */}
                  <tr className="border-t-2 border-border bg-secondary/50 font-semibold">
                    <td className="px-4 py-3">{t("rpt.total_row")}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{totals.enrolled}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-success">{totals.present}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-destructive">{totals.absent}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-warning">{totals.late}</td>
                    <td className="px-4 py-3 text-right">
                      <span className={`text-sm font-bold tabular-nums ${
                        totals.enrolled === 0 ? "" :
                        pct(totals.present, totals.enrolled) >= "75" ? "text-success" : "text-warning"
                      }`}>{pct(totals.present, totals.enrolled)}</span>
                    </td>
                    <td />
                  </tr>
                </tbody>
              </table>
            )}
          </div>
        </TabsContent>

        {/* ── Absentees tab ── */}
        <TabsContent value="absentees" className="pt-2">
          <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
            {allAbsent.length === 0 ? (
              <div className="px-5 py-12 text-center text-sm text-muted-foreground">
                {t("rpt.no_absentees", { prog: progFilter !== "all" ? progFilter : "", date: reportDate })}
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-secondary text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 text-left">{t("stu.col_admission")}</th>
                    <th className="px-4 py-3 text-left">{t("common.name")}</th>
                    <th className="px-4 py-3 text-left">{t("rpt.col_programme")}</th>
                    <th className="px-4 py-3 text-left">{t("rpt.col_parent_contact")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {allAbsent.map((s) => (
                    <tr key={s.id} className="hover:bg-secondary/40">
                      <td className="px-4 py-2.5 font-mono text-xs">{s.admission_number}</td>
                      <td className="px-4 py-2.5 font-medium">{s.full_name}</td>
                      <td className="px-4 py-2.5 text-muted-foreground text-xs">{s.programme_}</td>
                      <td className="px-4 py-2.5 text-xs text-muted-foreground">
                        {s.parent_email ?? s.parent_phone ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </TabsContent>

        {/* ── Late Arrivals tab ── */}
        <TabsContent value="late" className="pt-2">
          <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
            {allLate.length === 0 ? (
              <div className="px-5 py-12 text-center text-sm text-muted-foreground">
                {t("rpt.no_late", { time: lateCutoff, date: reportDate })}
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-secondary text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 text-left">{t("common.name")}</th>
                    <th className="px-4 py-3 text-left">{t("stu.col_admission")}</th>
                    <th className="px-4 py-3 text-left">{t("rpt.col_programme")}</th>
                    <th className="px-4 py-3 text-left">{t("rpt.col_arrived_at")}</th>
                    <th className="px-4 py-3 text-left">{t("rpt.col_mins_late")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {allLate.map(({ student: s, time: t, programme: prog }) => {
                    const arrivalMin = new Date(t).getHours() * 60 + new Date(t).getMinutes();
                    const [ch, cm] = lateCutoff.split(":").map(Number);
                    const cutoffMin = ch * 60 + cm;
                    const minsLate  = arrivalMin - cutoffMin;
                    return (
                      <tr key={s.id} className="hover:bg-secondary/40">
                        <td className="px-4 py-2.5 font-medium">{s.full_name}</td>
                        <td className="px-4 py-2.5 font-mono text-xs">{s.admission_number}</td>
                        <td className="px-4 py-2.5 text-xs text-muted-foreground">{prog}</td>
                        <td className="px-4 py-2.5 text-xs font-medium text-warning">
                          {new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </td>
                        <td className="px-4 py-2.5">
                          <Badge variant="secondary" className="text-warning">+{minsLate} min</Badge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
