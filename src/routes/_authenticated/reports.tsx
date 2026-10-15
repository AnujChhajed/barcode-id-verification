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
import {
  Download, Users, HardHat, GraduationCap, ShieldAlert,
  Clock, ArrowDownToLine, ArrowUpFromLine, ScanLine, AlertTriangle,
  Building2, Search, FileSpreadsheet, RefreshCw, XCircle, CheckCircle2,
  Calendar, ChevronRight, FileText, Activity
} from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from "recharts";
import { downloadCSV } from "@/lib/csv";
import jsPDF from "jspdf";

export const Route = createFileRoute("/_authenticated/reports")({
  component: ReportsPage,
});

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function localDateStr(d: Date) {
  const y  = d.getFullYear();
  const m  = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function ReportsPage() {
  const { t } = useTranslation();
  const { isAdmin, loading } = useAuth();

  // ── Global Report Filter State ──
  const [reportDate, setReportDate]     = useState(todayStr());
  const [activeTab, setActiveTab]       = useState("traffic");
  const [contractorFilter, setContractorFilter] = useState("all");
  const [searchQuery, setSearchQuery]   = useState("");

  // ── Fetch Access Logs for Selected Date Range ──
  const { data: logs, isLoading: logsLoading, refetch: refetchLogs } = useQuery({
    queryKey: ["reports-logs", reportDate],
    queryFn: async () => {
      const dayStart = new Date(`${reportDate}T00:00:00`).toISOString();
      const dayEnd   = new Date(`${reportDate}T23:59:59.999`).toISOString();

      const { data, error } = await supabase
        .from("access_logs")
        .select(
          "id,student_id,direction,decision,reason,scanned_at,scanned_code,overridden,operator_note," +
          "students(id,full_name,admission_number,category,company_name,institution,status,expires_at,is_visitor)"
        )
        .gte("scanned_at", dayStart)
        .lte("scanned_at", dayEnd)
        .order("scanned_at", { ascending: false });

      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  // ── Fetch All Active Personnel for Contractor & Intern Rosters ──
  const { data: personnel, isLoading: personnelLoading } = useQuery({
    queryKey: ["reports-personnel"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("students")
        .select("id,full_name,admission_number,category,company_name,institution,status,valid_from,expires_at,is_visitor,notes,created_at")
        .order("full_name", { ascending: true });

      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  // ── Fetch Missing Exits (Personnel inside > 12h without exit scan) ──
  const { data: missingExits, isLoading: missingExitsLoading } = useQuery({
    queryKey: ["reports-missing-exits"],
    queryFn: async () => {
      // Look back 48 hours
      const past48h = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
      const { data, error } = await supabase
        .from("access_logs")
        .select(
          "id,student_id,direction,decision,scanned_at,scanned_code," +
          "students(id,full_name,admission_number,category,company_name,institution,photo_url,parent_phone)"
        )
        .gte("scanned_at", past48h)
        .eq("decision", "allowed")
        .not("student_id", "is", null)
        .order("scanned_at", { ascending: true });

      if (error) throw error;

      // Group latest direction
      const map = new Map<string, any>();
      for (const log of data ?? []) {
        if (!log.student_id || !log.students) continue;
        const prev = map.get(log.student_id) ?? {
          studentId: log.student_id,
          student: log.students,
          lastIn: log.scanned_at,
          lastDirection: log.direction,
        };
        if (log.direction === "in") {
          prev.lastIn = log.scanned_at;
          prev.lastDirection = "in";
        } else if (log.direction === "out") {
          prev.lastDirection = "out";
        }
        map.set(log.student_id, prev);
      }

      // Filter: lastDirection is "in" AND lastIn is older than 12 hours ago
      const cutoff12h = Date.now() - 12 * 60 * 60 * 1000;
      return Array.from(map.values()).filter(
        (e) => e.lastDirection === "in" && new Date(e.lastIn).getTime() < cutoff12h
      );
    },
  });

  // ── Compute Traffic Metrics (Task 9.1) ──
  const trafficMetrics = useMemo(() => {
    const list = logs ?? [];
    const entries = list.filter((l) => l.direction === "in" && l.decision === "allowed").length;
    const exits   = list.filter((l) => l.direction === "out" && l.decision === "allowed").length;
    const denied  = list.filter((l) => l.decision === "denied").length;
    const totalScans = list.length;

    // Hourly distribution
    const hourly = Array.from({ length: 24 }, (_, h) => ({
      hour: `${String(h).padStart(2, "0")}:00`,
      entries: 0,
      exits: 0,
      denied: 0,
    }));

    for (const l of list) {
      const h = new Date(l.scanned_at).getHours();
      if (l.decision === "denied") {
        hourly[h].denied++;
      } else if (l.direction === "in") {
        hourly[h].entries++;
      } else if (l.direction === "out") {
        hourly[h].exits++;
      }
    }

    return { entries, exits, denied, totalScans, hourly };
  }, [logs]);

  // ── Compute Rejections Breakdown (Task 9.1) ──
  const rejections = useMemo(() => {
    const deniedLogs = (logs ?? []).filter((l) => l.decision === "denied");

    // Breakdown by reason categories
    const categories: Record<string, number> = {
      "Pass Expired": 0,
      "Watchlist Alert": 0,
      "Account Suspended": 0,
      "Plant Mismatch": 0,
      "Unregistered Credential": 0,
      "Other / Policy": 0,
    };

    for (const l of deniedLogs) {
      const r = (l.reason || "").toLowerCase();
      if (r.includes("expired")) categories["Pass Expired"]++;
      else if (r.includes("watchlist")) categories["Watchlist Alert"]++;
      else if (r.includes("suspended")) categories["Account Suspended"]++;
      else if (r.includes("plant")) categories["Plant Mismatch"]++;
      else if (r.includes("unregistered") || r.includes("no matching") || r.includes("unknown")) categories["Unregistered Credential"]++;
      else categories["Other / Policy"]++;
    }

    const pieData = Object.entries(categories)
      .filter(([, count]) => count > 0)
      .map(([name, value]) => ({ name, value }));

    return { deniedLogs, categories, pieData };
  }, [logs]);

  // ── Contractor Companies & Intern Rosters (Task 9.2) ──
  const contractorGroups = useMemo(() => {
    const workers = (personnel ?? []).filter(
      (p) => p.category === "worker" || (!p.category && !p.is_visitor)
    );

    const map = new Map<string, any[]>();
    for (const w of workers) {
      const company = w.company_name?.trim() || "Independent / Unassigned";
      if (!map.has(company)) map.set(company, []);
      map.get(company)!.push(w);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [personnel]);

  const internGroups = useMemo(() => {
    const interns = (personnel ?? []).filter((p) => p.category === "intern");
    const map = new Map<string, any[]>();
    for (const i of interns) {
      const inst = i.institution?.trim() || "Unspecified Institution";
      if (!map.has(inst)) map.set(inst, []);
      map.get(inst)!.push(i);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [personnel]);

  const visitorList = useMemo(() => {
    return (personnel ?? []).filter((p) => p.is_visitor || p.category === "visitor");
  }, [personnel]);

  // ── CSV Export Generators (Task 9.3 Hardened against Formula Injection) ──
  const exportTrafficCSV = () => {
    const rows = trafficMetrics.hourly.map((h) => ({
      "Hour Slot": h.hour,
      "Entries In": h.entries,
      "Exits Out": h.exits,
      "Denied Attempts": h.denied,
      "Total Traffic": h.entries + h.exits + h.denied,
    }));
    downloadCSV(`ABB-Plant3-Gate-Traffic-${reportDate}.csv`, rows);
  };

  const exportRejectionsCSV = () => {
    const rows = rejections.deniedLogs.map((l) => ({
      "Timestamp": new Date(l.scanned_at).toLocaleString(),
      "Scanned Code": l.scanned_code,
      "Full Name": l.students?.full_name || "Unidentified",
      "ID Number": l.students?.admission_number || l.scanned_code,
      "Classification": (l.students?.category || (l.students?.is_visitor ? "visitor" : "worker")).toUpperCase(),
      "Company / Institution": l.students?.company_name || l.students?.institution || "ABB Plant 3",
      "Rejection Reason": l.reason || "Denied",
      "Overridden": l.overridden ? "Yes" : "No",
    }));
    downloadCSV(`ABB-Plant3-Rejections-Audit-${reportDate}.csv`, rows);
  };

  const exportMissingExitsCSV = () => {
    const rows = (missingExits ?? []).map((e) => {
      const durationHours = Math.floor((Date.now() - new Date(e.lastIn).getTime()) / (1000 * 60 * 60));
      return {
        "Full Name": e.student.full_name,
        "ID Number": e.student.admission_number,
        "Classification": (e.student.category || "worker").toUpperCase(),
        "Organization": e.student.company_name || e.student.institution || "ABB Plant 3",
        "Entry Timestamp": new Date(e.lastIn).toLocaleString(),
        "Time Inside (Hours)": `${durationHours} hours`,
        "Contact Phone": e.student.parent_phone || "—",
      };
    });
    downloadCSV(`ABB-Plant3-Missing-Exits-${todayStr()}.csv`, rows);
  };

  const exportContractorsCSV = () => {
    const rows: any[] = [];
    for (const [company, members] of contractorGroups) {
      for (const m of members) {
        rows.push({
          "Contractor Company": company,
          "Full Name": m.full_name,
          "Worker ID": m.admission_number,
          "Status": m.status?.toUpperCase() || "ACTIVE",
          "Valid From": m.valid_from ? String(m.valid_from).slice(0, 10) : "—",
          "Valid Until": m.expires_at ? String(m.expires_at).slice(0, 10) : "Permanent",
        });
      }
    }
    downloadCSV(`ABB-Plant3-Contractor-Rosters-${todayStr()}.csv`, rows);
  };

  const exportPDFSummary = () => {
    const doc = new jsPDF({ unit: "pt", format: "a4" });
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.setTextColor(220, 38, 38); // ABB Red
    doc.text("ABB Plant 3 — Daily Security Gate Audit Report", 40, 40);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(100, 100, 100);
    doc.text(`Generated: ${new Date().toLocaleString()}  |  Target Date: ${reportDate}`, 40, 56);
    doc.text(`Total Entries: ${trafficMetrics.entries}   Total Exits: ${trafficMetrics.exits}   Total Denied: ${trafficMetrics.denied}`, 40, 70);

    // Header line
    doc.setDrawColor(200, 200, 200);
    doc.line(40, 80, 555, 80);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(50, 50, 50);
    let y = 96;
    doc.text("Time", 40, y);
    doc.text("Person / Scanned Code", 110, y);
    doc.text("Company / Institution", 270, y);
    doc.text("Denial Reason", 410, y);

    y += 6;
    doc.line(40, y, 555, y);
    y += 14;

    doc.setFont("helvetica", "normal");
    const rejectionsList = rejections.deniedLogs.slice(0, 35);

    if (rejectionsList.length === 0) {
      doc.text("No access rejections recorded for this date.", 40, y);
    } else {
      for (const l of rejectionsList) {
        if (y > 780) {
          doc.addPage();
          y = 40;
        }
        const timeStr = new Date(l.scanned_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        const nameStr = (l.students?.full_name || l.scanned_code || "").slice(0, 26);
        const compStr = (l.students?.company_name || l.students?.institution || "—").slice(0, 24);
        const reasonStr = (l.reason || "Denied").slice(0, 28);

        doc.text(timeStr, 40, y);
        doc.text(nameStr, 110, y);
        doc.text(compStr, 270, y);
        doc.text(reasonStr, 410, y);
        y += 14;
      }
    }

    doc.save(`ABB-Plant3-Security-Report-${reportDate}.pdf`);
  };

  const PIE_COLORS = ["#DC2626", "#F59E0B", "#6366F1", "#3B82F6", "#8B5CF6", "#64748B"];

  return (
    <div className="space-y-6">

      {/* ── Top Header ── */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
              <Activity className="h-6 w-6 text-red-600" />
              Industrial Security Reports & Audit
            </h1>
            <Badge variant="outline" className="border-red-600/30 bg-red-600/10 text-red-600 font-semibold text-xs px-2 py-0.5">
              ABB Plant 3
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            Authoritative gate traffic analytics, access rejection audit logs, missing exit tracking, and contractor rosters.
          </p>
        </div>

        {/* Global Controls */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 shadow-sm">
            <Calendar className="h-4 w-4 text-muted-foreground" />
            <input
              type="date"
              value={reportDate}
              onChange={(e) => setReportDate(e.target.value)}
              className="bg-transparent text-xs font-mono font-medium focus:outline-none"
            />
          </div>

          <Button
            size="sm"
            variant="outline"
            onClick={exportPDFSummary}
            className="gap-1.5 h-9"
          >
            <FileText className="h-3.5 w-3.5 text-red-600" /> Export PDF
          </Button>

          <Button
            size="sm"
            variant="outline"
            onClick={() => refetchLogs()}
            disabled={logsLoading}
            className="gap-1.5 h-9"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${logsLoading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* ── Summary KPI Strip ── */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Gate Entries</span>
            <ArrowDownToLine className="h-4 w-4 text-emerald-600" />
          </div>
          <p className="mt-1 text-2xl font-black text-emerald-600">{trafficMetrics.entries}</p>
          <span className="text-[11px] text-muted-foreground">Authorized check-ins</span>
        </div>

        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Gate Exits</span>
            <ArrowUpFromLine className="h-4 w-4 text-blue-600" />
          </div>
          <p className="mt-1 text-2xl font-black text-blue-600">{trafficMetrics.exits}</p>
          <span className="text-[11px] text-muted-foreground">Authorized check-outs</span>
        </div>

        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Access Denials</span>
            <XCircle className="h-4 w-4 text-red-600" />
          </div>
          <p className="mt-1 text-2xl font-black text-red-600">{trafficMetrics.denied}</p>
          <span className="text-[11px] text-muted-foreground">Turnstile rejections</span>
        </div>

        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Missing Exits (&gt;12h)</span>
            <AlertTriangle className="h-4 w-4 text-amber-600" />
          </div>
          <p className="mt-1 text-2xl font-black text-amber-600">{missingExits?.length ?? 0}</p>
          <span className="text-[11px] text-amber-700/80 dark:text-amber-300">Overtime inside facility</span>
        </div>
      </div>

      {/* ── Report Tabs ── */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="bg-secondary/40 p-1 rounded-xl border border-border flex flex-wrap h-auto gap-1">
          <TabsTrigger value="traffic" className="gap-1.5 text-xs font-semibold">
            <ScanLine className="h-3.5 w-3.5" /> Gate Traffic & Hourly Peak
          </TabsTrigger>
          <TabsTrigger value="rejections" className="gap-1.5 text-xs font-semibold">
            <XCircle className="h-3.5 w-3.5" /> Rejections & Security Audit
          </TabsTrigger>
          <TabsTrigger value="missing_exits" className="gap-1.5 text-xs font-semibold">
            <Clock className="h-3.5 w-3.5" /> Missing Exits ({missingExits?.length ?? 0})
          </TabsTrigger>
          <TabsTrigger value="contractors" className="gap-1.5 text-xs font-semibold">
            <HardHat className="h-3.5 w-3.5" /> Contractor Rosters
          </TabsTrigger>
          <TabsTrigger value="visitors" className="gap-1.5 text-xs font-semibold">
            <ShieldAlert className="h-3.5 w-3.5" /> Visitor Logs ({visitorList.length})
          </TabsTrigger>
        </TabsList>

        {/* ── TAB 1: GATE TRAFFIC & PEAK HOURS ── */}
        <TabsContent value="traffic" className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-foreground">Hourly Turnstile Flow Distribution</h3>
            <Button size="sm" variant="outline" onClick={exportTrafficCSV} className="gap-1.5 h-8 text-xs">
              <Download className="h-3 w-3" /> Export Traffic CSV
            </Button>
          </div>

          <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={trafficMetrics.hourly}>
                <XAxis dataKey="hour" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend />
                <Bar dataKey="entries" name="Entries In" fill="#16A34A" stackId="a" />
                <Bar dataKey="exits" name="Exits Out" fill="#2563EB" stackId="a" />
                <Bar dataKey="denied" name="Access Denied" fill="#DC2626" stackId="a" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </TabsContent>

        {/* ── TAB 2: ACCESS DENIALS & SECURITY AUDIT ── */}
        <TabsContent value="rejections" className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-foreground">Access Denial Audit Trail</h3>
              <p className="text-xs text-muted-foreground">Every rejected turnstile scan with server-evaluated reason</p>
            </div>
            <Button size="sm" variant="outline" onClick={exportRejectionsCSV} className="gap-1.5 h-8 text-xs">
              <Download className="h-3 w-3" /> Export Rejections CSV
            </Button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            {/* Rejection Pie Chart (4 cols) */}
            <div className="lg:col-span-4 rounded-xl border border-border bg-card p-5 shadow-sm">
              <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">Rejection Causes</h4>
              {rejections.pieData.length === 0 ? (
                <div className="py-16 text-center text-xs text-muted-foreground">
                  <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-600 mb-2" />
                  Zero access rejections recorded on {reportDate}.
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={240}>
                  <PieChart>
                    <Pie data={rejections.pieData} dataKey="value" nameKey="name" innerRadius={40} outerRadius={70}>
                      {rejections.pieData.map((d, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                    </Pie>
                    <Tooltip />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>

            {/* Rejections Table (8 cols) */}
            <div className="lg:col-span-8 rounded-xl border border-border bg-card shadow-sm overflow-hidden">
              {rejections.deniedLogs.length === 0 ? (
                <div className="py-20 text-center text-xs text-muted-foreground">
                  No access rejections recorded on {reportDate}.
                </div>
              ) : (
                <div className="overflow-x-auto max-h-[380px]">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-border bg-secondary/30 text-muted-foreground sticky top-0">
                      <tr>
                        <th className="px-4 py-3">Time</th>
                        <th className="px-4 py-3">Person / Code</th>
                        <th className="px-4 py-3">Company / Inst</th>
                        <th className="px-4 py-3">Denial Reason</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {rejections.deniedLogs.map((log: any) => (
                        <tr key={log.id} className="hover:bg-secondary/20">
                          <td className="px-4 py-3 font-mono text-muted-foreground whitespace-nowrap">
                            {new Date(log.scanned_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                          </td>
                          <td className="px-4 py-3 font-semibold text-foreground whitespace-nowrap">
                            {log.students ? log.students.full_name : <span className="font-mono">{log.scanned_code}</span>}
                          </td>
                          <td className="px-4 py-3 text-muted-foreground">
                            {log.students?.company_name || log.students?.institution || "—"}
                          </td>
                          <td className="px-4 py-3 text-red-600 font-medium">
                            {log.reason || "Access Denied"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </TabsContent>

        {/* ── TAB 3: MISSING EXITS & OVERTIME STAYS ── */}
        <TabsContent value="missing_exits" className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-foreground">Missing Exits Report</h3>
              <p className="text-xs text-muted-foreground">
                Personnel clocked inside Plant 3 for &gt;12 hours without an exit badge event (potential overnight stay or missed scan).
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={exportMissingExitsCSV}
              disabled={!missingExits?.length}
              className="gap-1.5 h-8 text-xs"
            >
              <Download className="h-3 w-3" /> Export Missing Exits CSV
            </Button>
          </div>

          <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
            {missingExitsLoading ? (
              <div className="py-16 text-center text-xs text-muted-foreground">
                Evaluating physical gate movement sequences…
              </div>
            ) : missingExits?.length === 0 ? (
              <div className="py-16 text-center text-xs text-muted-foreground">
                <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-600 mb-2" />
                No missing exits detected. All personnel inside have valid active shift durations (&lt;12 hours).
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-border bg-secondary/30 text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3">Person</th>
                      <th className="px-4 py-3">Classification</th>
                      <th className="px-4 py-3">Organization</th>
                      <th className="px-4 py-3">Entry Time</th>
                      <th className="px-4 py-3">Elapsed Time</th>
                      <th className="px-4 py-3">Contact</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {missingExits.map((item: any) => {
                      const durationHours = Math.floor((Date.now() - new Date(item.lastIn).getTime()) / (1000 * 60 * 60));
                      return (
                        <tr key={item.studentId} className="hover:bg-secondary/20">
                          <td className="px-4 py-3 font-semibold text-foreground">
                            {item.student.full_name}
                            <span className="block font-mono text-[10px] text-muted-foreground">
                              {item.student.admission_number}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <Badge variant="outline" className="text-[10px] uppercase font-semibold">
                              {item.student.category || "Worker"}
                            </Badge>
                          </td>
                          <td className="px-4 py-3 text-muted-foreground">
                            {item.student.company_name || item.student.institution || "ABB Plant 3"}
                          </td>
                          <td className="px-4 py-3 font-mono text-muted-foreground">
                            {new Date(item.lastIn).toLocaleString()}
                          </td>
                          <td className="px-4 py-3 font-bold text-amber-600">
                            {durationHours} hours on site
                          </td>
                          <td className="px-4 py-3 text-muted-foreground font-mono">
                            {item.student.parent_phone || "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </TabsContent>

        {/* ── TAB 4: CONTRACTOR ROSTERS BY COMPANY ── */}
        <TabsContent value="contractors" className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-foreground">Contractor Rosters by Company</h3>
              <p className="text-xs text-muted-foreground">Active contractor workers organized by vendor organization</p>
            </div>
            <Button size="sm" variant="outline" onClick={exportContractorsCSV} className="gap-1.5 h-8 text-xs">
              <Download className="h-3 w-3" /> Export Contractors CSV
            </Button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {contractorGroups.map(([company, members]) => (
              <div key={company} className="rounded-xl border border-border bg-card p-4 shadow-sm space-y-3">
                <div className="flex items-center justify-between border-b border-border pb-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <Building2 className="h-4 w-4 text-blue-600 shrink-0" />
                    <h4 className="font-bold text-sm text-foreground truncate">{company}</h4>
                  </div>
                  <Badge variant="secondary" className="text-xs font-bold">
                    {members.length} workers
                  </Badge>
                </div>

                <div className="space-y-1.5 max-h-48 overflow-y-auto divide-y divide-border/40 text-xs">
                  {members.map((m: any) => (
                    <div key={m.id} className="pt-1.5 first:pt-0 flex items-center justify-between">
                      <div className="min-w-0">
                        <p className="font-medium text-foreground truncate">{m.full_name}</p>
                        <span className="font-mono text-[10px] text-muted-foreground">{m.admission_number}</span>
                      </div>
                      <Badge
                        variant="outline"
                        className={`text-[9px] uppercase font-bold ${
                          m.status === "active" ? "border-emerald-500/30 text-emerald-600" : "border-destructive/30 text-destructive"
                        }`}
                      >
                        {m.status || "active"}
                      </Badge>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </TabsContent>

        {/* ── TAB 5: VISITOR LOGS ── */}
        <TabsContent value="visitors" className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-foreground">Temporary Visitor Passes</h3>
              <p className="text-xs text-muted-foreground">Guest passes registered for ABB Plant 3 visits</p>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                const rows = visitorList.map((v) => ({
                  "Visitor Name": v.full_name,
                  "Pass Code": v.admission_number,
                  "Status": v.status?.toUpperCase() || "ACTIVE",
                  "Issued": v.created_at ? new Date(v.created_at).toLocaleDateString() : "—",
                  "Valid Until": v.expires_at ? new Date(v.expires_at).toLocaleDateString() : "End of Day",
                }));
                downloadCSV(`ABB-Plant3-Visitors-${todayStr()}.csv`, rows);
              }}
              className="gap-1.5 h-8 text-xs"
            >
              <Download className="h-3 w-3" /> Export Visitors CSV
            </Button>
          </div>

          <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-border bg-secondary/30 text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3">Visitor Name</th>
                    <th className="px-4 py-3">Pass Code</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Issued Date</th>
                    <th className="px-4 py-3">Valid Until</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {visitorList.map((v: any) => (
                    <tr key={v.id} className="hover:bg-secondary/20">
                      <td className="px-4 py-3 font-semibold text-foreground">{v.full_name}</td>
                      <td className="px-4 py-3 font-mono text-muted-foreground">{v.admission_number}</td>
                      <td className="px-4 py-3">
                        <Badge
                          variant="outline"
                          className={`text-[10px] uppercase font-bold ${
                            v.status === "active" ? "border-emerald-500/30 text-emerald-600 bg-emerald-500/10" : "border-destructive/30 text-destructive"
                          }`}
                        >
                          {v.status || "active"}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground font-mono">
                        {v.created_at ? new Date(v.created_at).toLocaleDateString() : "—"}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground font-mono">
                        {v.expires_at ? new Date(v.expires_at).toLocaleDateString() : "End of Day"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
