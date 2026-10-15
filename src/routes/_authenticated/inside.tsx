import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { downloadCSV } from "@/lib/csv";
import {
  Users, RefreshCw, ArrowDownToLine, ArrowUpFromLine,
  Clock, ScanLine, ArrowLeft, Search, ArrowUpDown, X,
  Building2, HardHat, GraduationCap, ShieldAlert,
  Download, AlertTriangle, Moon, CheckCircle2
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/inside")({
  component: InsidePage,
});

interface LogRow {
  id:           string;
  student_id:   string | null;
  direction:    string | null;
  scanned_at:   string;
  scanned_code: string;
  decision:     string | null;
  students: {
    id:               string;
    full_name:        string;
    admission_number: string;
    category:         "worker" | "intern" | "visitor" | null;
    company_name:     string | null;
    institution:      string | null;
    plant_id:         string | null;
    photo_url:        string | null;
    is_visitor:       boolean | null;
    status:           string | null;
    valid_from:       string | null;
    expires_at:       string | null;
  } | null;
}

interface OccupantEntry {
  studentId:     string;
  student:       NonNullable<LogRow["students"]>;
  ins:           number;
  outs:          number;
  lastIn:        string;
  firstIn:       string;
  lastDirection: "in" | "out";
  lastScannedAt: string;
  category:      "worker" | "intern" | "visitor";
  isNightShift:  boolean;
}

type SortKey = "last_in" | "first_in" | "name_asc" | "name_desc" | "duration" | "entries" | "company";
type CategoryFilter = "all" | "worker" | "intern" | "visitor";

function getInitials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function getDurationMinutes(isoDate: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(isoDate).getTime()) / 60_000));
}

function formatDuration(mins: number): string {
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function formatClockTime(isoDate: string): string {
  const d = new Date(isoDate);
  const now = new Date();
  const isToday =
    d.getDate() === now.getDate() &&
    d.getMonth() === now.getMonth() &&
    d.getFullYear() === now.getFullYear();

  const timeStr = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (isToday) return `Today at ${timeStr}`;

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday =
    d.getDate() === yesterday.getDate() &&
    d.getMonth() === yesterday.getMonth() &&
    d.getFullYear() === yesterday.getFullYear();

  if (isYesterday) return `Yesterday at ${timeStr}`;
  return `${d.toLocaleDateString([], { month: "short", day: "numeric" })} ${timeStr}`;
}

function InsidePage() {
  const { t } = useTranslation();

  // ── Filter / sort state ─────────────────────────────────────────────────
  const [search,         setSearch]         = useState("");
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all");
  const [companyFilter,  setCompanyFilter]  = useState("all");
  const [sortKey,        setSortKey]        = useState<SortKey>("last_in");

  // ── Rolling 36-hour window query for 24h plant shifts ────────────────────
  const {
    data: logs,
    isLoading,
    isFetching,
    dataUpdatedAt,
    refetch,
  } = useQuery({
    queryKey: ["who-is-inside-plant3"],
    queryFn: async () => {
      // 36-hour rolling window captures night shifts entering prior to midnight
      const rolling36hAgo = new Date(Date.now() - 36 * 60 * 60 * 1000).toISOString();
      const { data, error } = await supabase
        .from("access_logs")
        .select(
          "id,student_id,direction,scanned_at,scanned_code,decision," +
          "students(id,full_name,admission_number,category,company_name,institution,plant_id,photo_url,is_visitor,status,valid_from,expires_at)"
        )
        .gte("scanned_at", rolling36hAgo)
        .eq("decision", "allowed")
        .not("student_id", "is", null)
        .order("scanned_at", { ascending: true });

      if (error) throw error;
      return (data ?? []) as unknown as LogRow[];
    },
    refetchInterval: 30_000,
    staleTime:       10_000,
  });

  // ── Local midnight for today's throughput counters ──────────────────────
  const localMidnightTime = useMemo(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0).getTime();
  }, []);

  // ── Compute active occupancy map ─────────────────────────────────────────
  const allOccupancy: OccupantEntry[] = useMemo(() => {
    if (!logs) return [];
    const map = new Map<string, OccupantEntry>();

    for (const log of logs) {
      if (!log.student_id || !log.students) continue;

      const category: "worker" | "intern" | "visitor" =
        log.students.category === "intern"
          ? "intern"
          : log.students.category === "visitor" || log.students.is_visitor
          ? "visitor"
          : "worker";

      const scanTime = new Date(log.scanned_at).getTime();
      const isNightShift = scanTime < localMidnightTime;

      const prev = map.get(log.student_id) ?? {
        studentId:     log.student_id,
        student:       log.students,
        ins:           0,
        outs:          0,
        lastIn:        log.scanned_at,
        firstIn:       log.scanned_at,
        lastDirection: (log.direction ?? "in") as "in" | "out",
        lastScannedAt: log.scanned_at,
        category,
        isNightShift,
      };

      if (log.direction === "in") {
        prev.ins++;
        prev.lastIn = log.scanned_at;
        prev.lastDirection = "in";
        prev.isNightShift = new Date(log.scanned_at).getTime() < localMidnightTime;
      } else if (log.direction === "out") {
        prev.outs++;
        prev.lastDirection = "out";
      }

      prev.lastScannedAt = log.scanned_at;
      if (log.students) {
        prev.student = log.students;
        prev.category = category;
      }

      map.set(log.student_id, prev);
    }

    // A person is physically inside Plant 3 if their latest recorded gate movement is "in"
    return Array.from(map.values()).filter((e) => e.lastDirection === "in");
  }, [logs, localMidnightTime]);

  // ── Category breakdowns ──────────────────────────────────────────────────
  const workersInside  = useMemo(() => allOccupancy.filter((e) => e.category === "worker").length, [allOccupancy]);
  const internsInside  = useMemo(() => allOccupancy.filter((e) => e.category === "intern").length, [allOccupancy]);
  const visitorsInside = useMemo(() => allOccupancy.filter((e) => e.category === "visitor").length, [allOccupancy]);
  const nightShiftsInside = useMemo(() => allOccupancy.filter((e) => e.isNightShift).length, [allOccupancy]);

  // ── Today's throughput (scanned since 00:00 local time) ──────────────────
  const todayLogs = useMemo(() => {
    return (logs ?? []).filter((l) => new Date(l.scanned_at).getTime() >= localMidnightTime);
  }, [logs, localMidnightTime]);

  const totalEntriesToday = todayLogs.filter((l) => l.direction === "in").length;
  const totalExitsToday   = todayLogs.filter((l) => l.direction === "out").length;

  // ── Unique contractor companies and institutions for filter ──────────────
  const companies = useMemo(() => {
    const set = new Set<string>();
    for (const e of allOccupancy) {
      if (e.student.company_name) set.add(e.student.company_name);
      if (e.student.institution)  set.add(e.student.institution);
    }
    return Array.from(set).sort();
  }, [allOccupancy]);

  // ── Apply search, filters & sort ─────────────────────────────────────────
  const occupancy = useMemo(() => {
    let rows = allOccupancy;

    // Category filter
    if (categoryFilter !== "all") {
      rows = rows.filter((e) => e.category === categoryFilter);
    }

    // Contractor / Institution filter
    if (companyFilter !== "all") {
      rows = rows.filter(
        (e) => e.student.company_name === companyFilter || e.student.institution === companyFilter
      );
    }

    // Search query
    const q = search.trim().toLowerCase();
    if (q) {
      rows = rows.filter((e) =>
        e.student.full_name.toLowerCase().includes(q) ||
        e.student.admission_number.toLowerCase().includes(q) ||
        e.student.company_name?.toLowerCase().includes(q) ||
        e.student.institution?.toLowerCase().includes(q)
      );
    }

    // Sorting
    rows = [...rows].sort((a, b) => {
      switch (sortKey) {
        case "last_in":
          return new Date(b.lastIn).getTime() - new Date(a.lastIn).getTime();
        case "first_in":
          return new Date(a.firstIn).getTime() - new Date(b.firstIn).getTime();
        case "duration":
          // Longest inside first = earliest lastIn
          return new Date(a.lastIn).getTime() - new Date(b.lastIn).getTime();
        case "name_asc":
          return a.student.full_name.localeCompare(b.student.full_name);
        case "name_desc":
          return b.student.full_name.localeCompare(a.student.full_name);
        case "company": {
          const compA = a.student.company_name || a.student.institution || "";
          const compB = b.student.company_name || b.student.institution || "";
          return compA.localeCompare(compB);
        }
        case "entries":
          return b.ins - a.ins;
        default:
          return 0;
      }
    });

    return rows;
  }, [allOccupancy, categoryFilter, companyFilter, search, sortKey]);

  const hasActiveFilter = search !== "" || categoryFilter !== "all" || companyFilter !== "all";

  const clearFilters = () => {
    setSearch("");
    setCategoryFilter("all");
    setCompanyFilter("all");
  };

  // ── Safety / Evacuation Roster Export ─────────────────────────────────────
  const exportEvacuationRoster = () => {
    const timestampStr = new Date().toISOString().slice(0, 19).replace(/:/g, "-");
    const rows = occupancy.map((e) => {
      const org = e.student.company_name || e.student.institution || "ABB Plant 3";
      const durationMins = getDurationMinutes(e.lastIn);
      return {
        "Full Name": e.student.full_name,
        "ID / Pass Number": e.student.admission_number,
        "Classification": e.category.toUpperCase(),
        "Organization / Contractor": org,
        "Entry Timestamp": new Date(e.lastIn).toLocaleString(),
        "Time on Site": formatDuration(durationMins),
        "Night Shift": e.isNightShift ? "Yes" : "No",
        "Total Ins (36h)": e.ins,
        "Total Outs (36h)": e.outs,
      };
    });
    downloadCSV(`ABB-Plant3-WhoIsInside-${timestampStr}.csv`, rows);
  };

  return (
    <div className="space-y-6">

      {/* ── Header ── */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link to="/verify">
            <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground hover:text-foreground">
              <ArrowLeft className="h-4 w-4" /> {t("nav.gate_scan", "Gate Scan")}
            </Button>
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight text-foreground">
                {t("nav.whos_inside", "Who's Inside")}
              </h1>
              <Badge variant="outline" className="border-red-600/30 bg-red-600/10 text-red-600 font-semibold text-xs px-2 py-0.5">
                ABB Plant 3
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              Live facility occupancy tracking across rolling 36-hour entry window with night-shift continuity.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {dataUpdatedAt > 0 && (
            <span className="text-xs text-muted-foreground hidden sm:inline">
              Updated {new Date(dataUpdatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </span>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={exportEvacuationRoster}
            disabled={allOccupancy.length === 0}
            className="gap-1.5 border-border shadow-sm text-foreground"
            title="Export CSV roster for emergency evacuation / roll call"
          >
            <Download className="h-3.5 w-3.5" />
            <span className="hidden md:inline">Evacuation Roster</span>
            <span className="md:hidden">CSV</span>
          </Button>
          <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isFetching} className="gap-1.5">
            <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
            {t("common2.refresh", "Refresh")}
          </Button>
        </div>
      </div>

      {/* ── Stat cards ── */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {/* Total Inside */}
        <div className="flex flex-col items-start gap-1 rounded-xl border border-emerald-500/25 bg-emerald-500/10 p-5 shadow-sm">
          <div className="flex w-full items-center justify-between">
            <span className="text-3xl font-extrabold text-emerald-600 dark:text-emerald-400">{allOccupancy.length}</span>
            <span className="flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/20 px-2 py-0.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-300">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" /> LIVE
            </span>
          </div>
          <span className="text-xs font-semibold text-emerald-950 dark:text-emerald-200">Total Personnel Inside</span>
          <span className="text-[11px] text-muted-foreground">Plant 3 Facility</span>
        </div>

        {/* Contract Workers */}
        <div className="flex flex-col items-start gap-1 rounded-xl border border-blue-500/20 bg-blue-500/5 p-5 shadow-sm">
          <div className="flex w-full items-center justify-between">
            <span className="text-3xl font-extrabold text-blue-600 dark:text-blue-400">{workersInside}</span>
            <HardHat className="h-5 w-5 text-blue-500/70" />
          </div>
          <span className="text-xs font-semibold text-foreground">Contract Workers</span>
          <span className="text-[11px] text-muted-foreground">Contractor companies</span>
        </div>

        {/* Interns */}
        <div className="flex flex-col items-start gap-1 rounded-xl border border-indigo-500/20 bg-indigo-500/5 p-5 shadow-sm">
          <div className="flex w-full items-center justify-between">
            <span className="text-3xl font-extrabold text-indigo-600 dark:text-indigo-400">{internsInside}</span>
            <GraduationCap className="h-5 w-5 text-indigo-500/70" />
          </div>
          <span className="text-xs font-semibold text-foreground">Internship Students</span>
          <span className="text-[11px] text-muted-foreground">Colleges & Universities</span>
        </div>

        {/* Visitors */}
        <div className="flex flex-col items-start gap-1 rounded-xl border border-amber-500/20 bg-amber-500/5 p-5 shadow-sm">
          <div className="flex w-full items-center justify-between">
            <span className="text-3xl font-extrabold text-amber-600 dark:text-amber-400">{visitorsInside}</span>
            <ShieldAlert className="h-5 w-5 text-amber-500/70" />
          </div>
          <span className="text-xs font-semibold text-foreground">Active Visitors</span>
          <span className="text-[11px] text-muted-foreground">Temporary day passes</span>
        </div>
      </div>

      {/* ── Today's throughput bar ── */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border bg-card px-5 py-3 text-sm text-muted-foreground shadow-sm">
        <div className="flex flex-wrap items-center gap-5">
          <span className="flex items-center gap-1.5 font-medium">
            <ArrowDownToLine className="h-4 w-4 text-emerald-500" />
            <strong className="text-foreground">{totalEntriesToday}</strong> Entries Today
          </span>
          <span className="flex items-center gap-1.5 font-medium">
            <ArrowUpFromLine className="h-4 w-4 text-blue-500" />
            <strong className="text-foreground">{totalExitsToday}</strong> Exits Today
          </span>
          <span className="flex items-center gap-1.5 font-medium">
            <ScanLine className="h-4 w-4 text-muted-foreground" />
            <strong className="text-foreground">{totalEntriesToday + totalExitsToday}</strong> Total Today Scans
          </span>
        </div>

        <div className="flex items-center gap-2 text-xs">
          {nightShiftsInside > 0 && (
            <span className="flex items-center gap-1 text-indigo-600 dark:text-indigo-400 font-medium bg-indigo-500/10 px-2 py-0.5 rounded-full border border-indigo-500/20">
              <Moon className="h-3 w-3" /> {nightShiftsInside} Night-Shift Stay(s)
            </span>
          )}
          <span className="text-muted-foreground/80 hidden md:inline">
            36-Hour Rolling Active Window
          </span>
        </div>
      </div>

      {/* ── Category tabs & Filter toolbar ── */}
      <div className="space-y-3">
        {/* Category tabs */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setCategoryFilter("all")}
            className={`rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-all ${
              categoryFilter === "all"
                ? "bg-foreground text-background shadow-sm"
                : "bg-secondary text-muted-foreground hover:bg-secondary/80 hover:text-foreground"
            }`}
          >
            All Categories ({allOccupancy.length})
          </button>
          <button
            onClick={() => setCategoryFilter("worker")}
            className={`flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-all ${
              categoryFilter === "worker"
                ? "bg-blue-600 text-white shadow-sm"
                : "bg-secondary text-muted-foreground hover:bg-secondary/80 hover:text-foreground"
            }`}
          >
            <HardHat className="h-3.5 w-3.5" />
            Contract Workers ({workersInside})
          </button>
          <button
            onClick={() => setCategoryFilter("intern")}
            className={`flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-all ${
              categoryFilter === "intern"
                ? "bg-indigo-600 text-white shadow-sm"
                : "bg-secondary text-muted-foreground hover:bg-secondary/80 hover:text-foreground"
            }`}
          >
            <GraduationCap className="h-3.5 w-3.5" />
            Interns ({internsInside})
          </button>
          <button
            onClick={() => setCategoryFilter("visitor")}
            className={`flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-all ${
              categoryFilter === "visitor"
                ? "bg-amber-600 text-white shadow-sm"
                : "bg-secondary text-muted-foreground hover:bg-secondary/80 hover:text-foreground"
            }`}
          >
            <ShieldAlert className="h-3.5 w-3.5" />
            Visitors ({visitorsInside})
          </button>
        </div>

        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-4 shadow-sm">
          {/* Search */}
          <div className="relative flex-1 min-w-[220px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, ID, contractor company, university…"
              className="pl-9 h-9 text-sm"
            />
          </div>

          {/* Company / Institution selector */}
          <Select value={companyFilter} onValueChange={setCompanyFilter}>
            <SelectTrigger className="w-[200px] h-9 text-xs">
              <SelectValue placeholder="All Companies & Depts" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Companies & Depts</SelectItem>
              {companies.map((c) => (
                <SelectItem key={c} value={c} className="text-xs">
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Sort */}
          <div className="flex items-center gap-1.5">
            <ArrowUpDown className="h-4 w-4 text-muted-foreground shrink-0" />
            <Select value={sortKey} onValueChange={(v) => setSortKey(v as SortKey)}>
              <SelectTrigger className="w-[180px] h-9 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="last_in">Latest Entry First</SelectItem>
                <SelectItem value="duration">Longest Inside First</SelectItem>
                <SelectItem value="name_asc">Name: A → Z</SelectItem>
                <SelectItem value="name_desc">Name: Z → A</SelectItem>
                <SelectItem value="company">Company / Institution</SelectItem>
                <SelectItem value="entries">Most Gate Crossings</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Clear */}
          {hasActiveFilter && (
            <Button size="sm" variant="ghost" onClick={clearFilters} className="h-9 gap-1.5 text-muted-foreground hover:text-foreground">
              <X className="h-3.5 w-3.5" /> {t("common2.clear_filters", "Clear filters")}
            </Button>
          )}
        </div>
      </div>

      {/* ── Occupancy List ── */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <div className="flex flex-col items-center gap-3">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            <p className="text-sm text-muted-foreground">{t("common.loading", "Loading occupancy records…")}</p>
          </div>
        </div>
      ) : allOccupancy.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-border bg-card py-20 text-center px-4">
          <div className="grid h-14 w-14 place-items-center rounded-full bg-secondary">
            <Users className="h-7 w-7 text-muted-foreground/60" />
          </div>
          <p className="font-semibold text-foreground text-lg">No Personnel Currently Inside Plant 3</p>
          <p className="text-sm text-muted-foreground max-w-md">
            All personnel have exited or no entry events have been registered in the current active 36-hour operational window.
          </p>
          <Link to="/verify" className="mt-3">
            <Button size="sm" variant="default" className="gap-1.5 bg-red-600 hover:bg-red-700 text-white">
              <ScanLine className="h-4 w-4" /> Open Gate Scanner
            </Button>
          </Link>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
          {/* Table Header */}
          <div className="flex items-center justify-between border-b border-border bg-secondary/30 px-5 py-3">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-semibold text-foreground">
                {hasActiveFilter
                  ? `Showing ${occupancy.length} of ${allOccupancy.length} personnel inside`
                  : `All ${allOccupancy.length} personnel currently inside Plant 3`}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1">
                <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">Plant 3 Main Gate</span>
              </div>
            </div>
          </div>

          {occupancy.length === 0 ? (
            <div className="px-5 py-14 text-center text-sm text-muted-foreground">
              No personnel match your search filters.{" "}
              <button onClick={clearFilters} className="text-primary underline-offset-2 hover:underline font-semibold ml-1">
                Clear filters
              </button>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {occupancy.map(({ studentId, student, ins, outs, lastIn, category, isNightShift }) => {
                const durationMins = getDurationMinutes(lastIn);
                const durationStr = formatDuration(durationMins);
                const isOvertime = durationMins > 12 * 60; // Flag extended shifts over 12h

                // Category styling tokens
                const categoryBadge =
                  category === "intern" ? (
                    <Badge variant="outline" className="border-indigo-500/30 bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.2">
                      Intern
                    </Badge>
                  ) : category === "visitor" ? (
                    <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400 text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.2">
                      Visitor
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-400 text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.2">
                      Worker
                    </Badge>
                  );

                const ringColor =
                  category === "intern"
                    ? "ring-indigo-500/40"
                    : category === "visitor"
                    ? "ring-amber-500/40"
                    : "ring-blue-500/40";

                const orgName = student.company_name || student.institution || "ABB Plant 3";

                return (
                  <div
                    key={studentId}
                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-5 py-3.5 hover:bg-secondary/20 transition-colors"
                  >
                    {/* Left: Avatar & Person Details */}
                    <div className="flex items-center gap-3.5 min-w-0">
                      {/* Avatar */}
                      <div className={`grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-full bg-secondary ring-2 ${ringColor}`}>
                        {student.photo_url ? (
                          <img
                            src={student.photo_url}
                            alt={student.full_name}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <span className="font-bold text-xs text-foreground">
                            {getInitials(student.full_name)}
                          </span>
                        )}
                      </div>

                      {/* Info */}
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-semibold text-sm text-foreground truncate">{student.full_name}</p>
                          {categoryBadge}
                          {isNightShift && (
                            <Badge variant="outline" className="border-purple-500/30 bg-purple-500/10 text-purple-600 dark:text-purple-300 text-[10px] font-medium gap-1 px-1.5">
                              <Moon className="h-2.5 w-2.5" /> Night Shift
                            </Badge>
                          )}
                          {isOvertime && (
                            <Badge variant="destructive" className="text-[10px] font-semibold gap-1 px-1.5">
                              <AlertTriangle className="h-2.5 w-2.5" /> &gt;12h on site
                            </Badge>
                          )}
                        </div>

                        <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5 truncate">
                          <span className="font-mono font-medium text-foreground/80">{student.admission_number}</span>
                          <span>•</span>
                          <span className="flex items-center gap-1 truncate text-foreground/70">
                            {category === "intern" ? (
                              <GraduationCap className="h-3 w-3 shrink-0 text-indigo-500" />
                            ) : category === "worker" ? (
                              <HardHat className="h-3 w-3 shrink-0 text-blue-500" />
                            ) : (
                              <Building2 className="h-3 w-3 shrink-0 text-amber-500" />
                            )}
                            {orgName}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Right: Stay Duration & Shift Details */}
                    <div className="flex items-center justify-between sm:justify-end gap-4 pl-13 sm:pl-0">
                      {/* Duration badge */}
                      <div className="flex flex-col items-start sm:items-end">
                        <div className="flex items-center gap-1.5 rounded-full border border-border bg-secondary/60 px-2.5 py-1 text-xs font-semibold text-foreground">
                          <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                          <span>{durationStr} on site</span>
                        </div>
                        <span className="text-[11px] text-muted-foreground mt-0.5" title={new Date(lastIn).toLocaleString()}>
                          Entered {formatClockTime(lastIn)}
                        </span>
                      </div>

                      {/* Crossings tally */}
                      <div className="flex items-center gap-2 text-xs text-muted-foreground border-l border-border pl-3">
                        <span className="flex items-center gap-0.5 text-emerald-600 font-semibold" title="Total entries in 36h window">
                          <ArrowDownToLine className="h-3.5 w-3.5" /> {ins}
                        </span>
                        <span className="flex items-center gap-0.5 text-muted-foreground" title="Total exits in 36h window">
                          <ArrowUpFromLine className="h-3.5 w-3.5" /> {outs}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Footer */}
          <div className="flex flex-wrap items-center justify-between border-t border-border bg-secondary/10 px-5 py-2.5 text-xs text-muted-foreground">
            <span>Plant 3 Single-Gate Verification • Real-time occupancy</span>
            <span className="hidden sm:inline">Calculated from authoritative access logs (rolling 36 hours)</span>
          </div>
        </div>
      )}
    </div>
  );
}
