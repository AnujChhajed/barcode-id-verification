import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  Users, RefreshCw, ArrowDownToLine, ArrowUpFromLine,
  User as UserIcon, Clock, ScanLine, ArrowLeft,
  Search, ArrowUpDown, X,
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
  students: {
    id:               string;
    full_name:        string;
    admission_number: string;
    programme:        string | null;
    nta_level:        number | null;
    year_of_study:    number | null;
    photo_url:        string | null;
    is_visitor:       boolean | null;
  } | null;
}

interface OccupantEntry {
  studentId: string;
  student:   LogRow["students"];
  ins:       number;
  outs:      number;
  lastIn:    string;
  firstIn:   string;
}

type SortKey = "last_in" | "first_in" | "name_asc" | "name_desc" | "duration" | "entries";
type TypeFilter = "all" | "students" | "visitors";

function InsidePage() {
  const { t } = useTranslation();
  // ── Filter / sort state ─────────────────────────────────────────────────
  const [search,    setSearch]    = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [programme, setProgramme] = useState("all");
  const [sortKey,   setSortKey]   = useState<SortKey>("last_in");

  const {
    data: logs,
    isLoading,
    isFetching,
    dataUpdatedAt,
    refetch,
  } = useQuery({
    queryKey: ["who-is-inside"],
    queryFn: async () => {
      // Use local midnight to avoid UTC-offset cutting off today's scans
      const now = new Date();
      const localMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
      const { data, error } = await supabase
        .from("access_logs")
        .select(
          "id,student_id,direction,scanned_at,scanned_code," +
          "students(id,full_name,admission_number,programme,nta_level,year_of_study,photo_url,is_visitor)",
        )
        .gte("scanned_at", localMidnight.toISOString())
        .eq("decision", "allowed")
        .not("student_id", "is", null)
        .order("scanned_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as LogRow[];
    },
    refetchInterval: 30_000,
    staleTime:       10_000,
  });

  // ── Compute occupancy map ───────────────────────────────────────────────
  const allOccupancy: OccupantEntry[] = useMemo(() => {
    if (!logs) return [];
    const map = new Map<string, OccupantEntry>();
    for (const log of logs) {
      if (!log.student_id || !log.students) continue;
      const prev = map.get(log.student_id) ?? {
        studentId: log.student_id,
        student:   log.students,
        ins:       0,
        outs:      0,
        lastIn:    log.scanned_at,
        firstIn:   log.scanned_at,
      };
      if (log.direction === "in") {
        prev.ins++;
        prev.lastIn = log.scanned_at;
      }
      if (log.direction === "out") prev.outs++;
      map.set(log.student_id, prev);
    }
    return Array.from(map.values()).filter((e) => e.ins > e.outs);
  }, [logs]);

  // ── Unique programmes for filter dropdown ──────────────────────────────
  const programmes = useMemo(() => {
    const set = new Set<string>();
    for (const e of allOccupancy) {
      if (e.student?.programme) set.add(e.student.programme);
    }
    return Array.from(set).sort();
  }, [allOccupancy]);

  // ── Apply filters + sort ───────────────────────────────────────────────
  const occupancy = useMemo(() => {
    let rows = allOccupancy;

    // Type
    if (typeFilter === "students") rows = rows.filter((e) => !e.student?.is_visitor);
    if (typeFilter === "visitors") rows = rows.filter((e) =>  e.student?.is_visitor);

    // Programme
    if (programme !== "all") rows = rows.filter((e) => e.student?.programme === programme);

    // Search
    const q = search.trim().toLowerCase();
    if (q) {
      rows = rows.filter((e) =>
        e.student?.full_name.toLowerCase().includes(q) ||
        e.student?.admission_number.toLowerCase().includes(q) ||
        e.student?.programme?.toLowerCase().includes(q),
      );
    }

    // Sort
    rows = [...rows].sort((a, b) => {
      switch (sortKey) {
        case "last_in":  return new Date(b.lastIn).getTime()  - new Date(a.lastIn).getTime();
        case "first_in": return new Date(a.firstIn).getTime() - new Date(b.firstIn).getTime();
        case "name_asc": return (a.student?.full_name ?? "").localeCompare(b.student?.full_name ?? "");
        case "name_desc":return (b.student?.full_name ?? "").localeCompare(a.student?.full_name ?? "");
        case "duration": return new Date(a.firstIn).getTime() - new Date(b.firstIn).getTime(); // longest first = earliest firstIn
        case "entries":  return b.ins - a.ins;
        default:         return 0;
      }
    });

    return rows;
  }, [allOccupancy, typeFilter, programme, search, sortKey]);

  const totalEntriesToday = logs?.filter((l) => l.direction === "in").length  ?? 0;
  const totalExitsToday   = logs?.filter((l) => l.direction === "out").length ?? 0;
  const visitorsInside    = allOccupancy.filter((e) => e.student?.is_visitor).length;
  const studentsInside    = allOccupancy.length - visitorsInside;

  const hasActiveFilter = search !== "" || typeFilter !== "all" || programme !== "all";

  const clearFilters = () => {
    setSearch(""); setTypeFilter("all"); setProgramme("all");
  };

  return (
    <div className="space-y-6">

      {/* ── Header ── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link to="/verify">
            <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground">
              <ArrowLeft className="h-4 w-4" /> {t("nav.gate_scan")}
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold">{t("inside.title")}</h1>
            <p className="text-sm text-muted-foreground">
              {t("inside.subtitle")}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {dataUpdatedAt > 0 && (
            <span className="text-xs text-muted-foreground">
              {t("inside.updated_at", { time: new Date(dataUpdatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) })}
            </span>
          )}
          <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
            {t("common2.refresh")}
          </Button>
        </div>
      </div>

      {/* ── Stat cards ── */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard value={allOccupancy.length} label={t("inside.stat_inside")}   color="text-success"          bg="bg-success/10"  live />
        <StatCard value={studentsInside}       label={t("inside.stat_students")} color="text-primary"          bg="bg-primary/10"       />
        <StatCard value={visitorsInside}       label={t("inside.stat_visitors")} color="text-warning"          bg="bg-warning/10"       />
        <StatCard value={totalEntriesToday}    label={t("inside.stat_entries")}  color="text-muted-foreground" bg="bg-secondary"        />
      </div>

      {/* ── Today's throughput bar ── */}
      <div className="flex flex-wrap gap-4 rounded-xl border border-border bg-card px-5 py-3 text-sm text-muted-foreground shadow-sm">
        <span className="flex items-center gap-1.5">
          <ArrowDownToLine className="h-4 w-4 text-success" />
          <strong className="text-foreground">{totalEntriesToday}</strong> {t("common2.entry")}
        </span>
        <span className="flex items-center gap-1.5">
          <ArrowUpFromLine className="h-4 w-4 text-primary" />
          <strong className="text-foreground">{totalExitsToday}</strong> {t("common2.exit")}
        </span>
        <span className="ml-auto flex items-center gap-1.5">
          <ScanLine className="h-4 w-4" />
          {t("inside.total_scans_today", { count: totalEntriesToday + totalExitsToday })}
        </span>
      </div>

      {/* ── Filter / sort toolbar ── */}
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card p-4 shadow-sm">
        {/* Search */}
        <div className="relative flex-1 min-w-[200px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("inside.search_ph")}
            className="pl-9 h-9"
          />
        </div>

        {/* Type */}
        <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as TypeFilter)}>
          <SelectTrigger className="w-[140px] h-9"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("inside.type_all")}</SelectItem>
            <SelectItem value="students">{t("inside.type_students")}</SelectItem>
            <SelectItem value="visitors">{t("inside.type_visitors")}</SelectItem>
          </SelectContent>
        </Select>

        {/* Programme */}
        <Select value={programme} onValueChange={setProgramme}>
          <SelectTrigger className="w-[180px] h-9"><SelectValue placeholder={t("rpt.all_programmes")} /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("rpt.all_programmes")}</SelectItem>
            {programmes.map((p) => (
              <SelectItem key={p} value={p}>{p}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Sort */}
        <div className="flex items-center gap-2">
          <ArrowUpDown className="h-4 w-4 text-muted-foreground shrink-0" />
          <Select value={sortKey} onValueChange={(v) => setSortKey(v as SortKey)}>
            <SelectTrigger className="w-[170px] h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="last_in">{t("inside.sort_last_in")}</SelectItem>
              <SelectItem value="first_in">{t("inside.sort_first_in")}</SelectItem>
              <SelectItem value="duration">{t("inside.sort_duration")}</SelectItem>
              <SelectItem value="name_asc">{t("inside.sort_name_asc")}</SelectItem>
              <SelectItem value="name_desc">{t("inside.sort_name_desc")}</SelectItem>
              <SelectItem value="entries">{t("inside.sort_entries")}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Clear */}
        {hasActiveFilter && (
          <Button size="sm" variant="ghost" onClick={clearFilters} className="h-9 gap-1.5 text-muted-foreground">
            <X className="h-3.5 w-3.5" /> {t("common2.clear_filters")}
          </Button>
        )}
      </div>

      {/* ── Occupancy list ── */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <div className="flex flex-col items-center gap-3">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
          </div>
        </div>
      ) : allOccupancy.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-border bg-card py-20">
          <Users className="h-14 w-14 text-muted-foreground/20" />
          <p className="font-semibold text-muted-foreground">{t("inside.empty")}</p>
          <p className="text-sm text-muted-foreground">
            {t("inside.empty_hint")}
          </p>
          <Link to="/verify" className="mt-2">
            <Button size="sm" variant="outline">
              <ScanLine className="mr-1.5 h-4 w-4" /> {t("inside.go_to_gate")}
            </Button>
          </Link>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
          {/* Table header */}
          <div className="flex items-center justify-between border-b border-border bg-secondary/30 px-5 py-3">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-semibold">
                {hasActiveFilter
                  ? t("inside.filtered_count", { shown: occupancy.length, total: allOccupancy.length })
                  : t("inside.total_count", { count: allOccupancy.length })}
              </span>
            </div>
            <div className="flex items-center gap-1.5 rounded-full border border-success/25 bg-success/10 px-3 py-1">
              <span className="h-2 w-2 rounded-full bg-success animate-pulse" />
              <span className="text-xs font-semibold text-success">{t("common2.live_badge")}</span>
            </div>
          </div>

          {occupancy.length === 0 ? (
            <div className="px-5 py-12 text-center text-sm text-muted-foreground">
              {t("inside.no_match")}{" "}
              <button onClick={clearFilters} className="text-primary underline-offset-2 hover:underline">
                {t("common2.clear_filters")}
              </button>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {occupancy.map(({ studentId, student, ins, outs, lastIn, firstIn }) => {
                if (!student) return null;
                const timeSince = (() => {
                  const diff = Math.floor((Date.now() - new Date(lastIn).getTime()) / 60_000);
                  if (diff < 1)  return "just now";
                  if (diff < 60) return `${diff}m ago`;
                  const h = Math.floor(diff / 60); const m = diff % 60;
                  return m > 0 ? `${h}h ${m}m ago` : `${h}h ago`;
                })();

                const durationMins = Math.floor((Date.now() - new Date(firstIn).getTime()) / 60_000);
                const durationStr = (() => {
                  if (durationMins < 60) return `${durationMins}m`;
                  const h = Math.floor(durationMins / 60); const m = durationMins % 60;
                  return m > 0 ? `${h}h ${m}m` : `${h}h`;
                })();

                return (
                  <div
                    key={studentId}
                    className="flex items-center gap-4 px-5 py-3.5 hover:bg-secondary/20 transition-colors"
                  >
                    {/* Avatar */}
                    <div className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-full bg-secondary ring-2 ring-border">
                      <UserIcon className="h-5 w-5 text-muted-foreground" />
                    </div>

                    {/* Name + info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-semibold text-sm">{student.full_name}</p>
                        {student.is_visitor && (
                          <Badge className="bg-warning/15 text-warning hover:bg-warning/20 text-[10px] font-bold uppercase px-1.5">
                            {t("inside.stat_visitors")}
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground truncate">
                        {student.admission_number}
                        {student.programme   && ` · ${student.programme}`}
                        {student.nta_level   && ` · NTA ${student.nta_level}`}
                        {student.year_of_study && ` · Yr ${student.year_of_study}`}
                      </p>
                    </div>

                    {/* Duration badge */}
                    <div className="hidden sm:flex items-center gap-1 rounded-full border border-border bg-secondary/60 px-2.5 py-1 text-xs text-muted-foreground">
                      <Clock className="h-3 w-3" />
                      {durationStr}
                    </div>

                    {/* Stats */}
                    <div className="flex flex-col items-end gap-1 text-xs text-muted-foreground">
                      <div className="flex items-center gap-3">
                        <span className="flex items-center gap-0.5 text-success font-medium">
                          <ArrowDownToLine className="h-3 w-3" /> {ins}
                        </span>
                        <span className="flex items-center gap-0.5">
                          <ArrowUpFromLine className="h-3 w-3" /> {outs}
                        </span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Clock className="h-3 w-3 sm:hidden" />
                        <span title={new Date(lastIn).toLocaleString()}>{timeSince}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Footer */}
          <div className="border-t border-border bg-secondary/10 px-5 py-2.5 text-xs text-muted-foreground">
            {t("inside.footer")}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Stat card ───────────────────────────────────────────────────────────────

function StatCard({
  value, label, color, bg, live = false,
}: {
  value: number;
  label: string;
  color: string;
  bg:    string;
  live?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className={`flex flex-col items-start gap-1 rounded-xl border border-border p-5 shadow-sm ${bg}`}>
      <div className="flex w-full items-center justify-between">
        <span className={`text-3xl font-bold ${color}`}>{value}</span>
        {live && (
          <span className="flex items-center gap-1 rounded-full border border-success/25 bg-success/15 px-2 py-0.5 text-[10px] font-bold text-success">
            <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse" /> {t("common2.live_badge")}
          </span>
        )}
      </div>
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
    </div>
  );
}
