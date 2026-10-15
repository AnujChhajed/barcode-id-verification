import { createFileRoute, Link, Navigate } from "@tanstack/react-router";
import { useEffect, useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PassRenewalModal, RenewablePerson } from "@/components/PassRenewalModal";
import {
  Users, ScanLine, CheckCircle2, XCircle, Clock, UserCheck, UserPlus,
  AlertTriangle, X, CalendarClock, ShieldAlert, HardHat, GraduationCap,
  Calendar, RefreshCw, ChevronRight
} from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from "recharts";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: Dashboard,
});

/** Returns "YYYY-MM-DD" in the browser's LOCAL timezone — avoids UTC-date off-by-one in UTC+ zones. */
function localDateStr(d: Date) {
  const y  = d.getFullYear();
  const m  = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function Dashboard() {
  const { t } = useTranslation();
  const { isAdmin, loading } = useAuth();

  // ── Renewal Modal State (Task 8.2) ───────────────────────────────────────
  const [renewalPerson, setRenewalPerson] = useState<RenewablePerson | null>(null);
  const [renewalOpen, setRenewalOpen]     = useState(false);

  // ── Expiry Enforcement & Validity Window Query (Task 8.1) ─────────────────
  const {
    data: expiryData,
    refetch: refetchExpiries,
    isLoading: expiriesLoading,
  } = useQuery({
    queryKey: ["dashboard-expiries"],
    refetchInterval: 60_000,
    queryFn: async () => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const todayStr = localDateStr(today);

      const next7Days = new Date(today);
      next7Days.setDate(next7Days.getDate() + 7);
      const next7Str = localDateStr(next7Days);

      // Query personnel expiring within next 7 days or already expired
      const { data, error } = await supabase
        .from("students")
        .select("id,full_name,admission_number,category,company_name,institution,expires_at,status,notes")
        .not("expires_at", "is", null)
        .lte("expires_at", `${next7Str}T23:59:59`)
        .order("expires_at", { ascending: true })
        .limit(30);

      if (error) throw error;

      const records = (data ?? []) as any[];
      const expiredList = records.filter(
        (r) => new Date(r.expires_at).getTime() < today.getTime()
      );
      const expiringSoonList = records.filter(
        (r) =>
          new Date(r.expires_at).getTime() >= today.getTime() &&
          new Date(r.expires_at).getTime() <= new Date(`${next7Str}T23:59:59`).getTime()
      );

      return {
        expiredList,
        expiringSoonList,
        totalExpired: expiredList.length,
        totalExpiringSoon: expiringSoonList.length,
      };
    },
  });

  const { data: stats } = useQuery({
    queryKey: ["dashboard-stats"],
    refetchInterval: 30_000, // refresh every 30s
    queryFn: async () => {
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const todayISO    = today.toISOString();
      const todayLocal  = localDateStr(today);
      const [students, todayLogs, allowed, denied, entries, exits, activeVisitors] = await Promise.all([
        supabase.from("students").select("id", { count: "exact", head: true }).eq("status", "active").eq("is_visitor", false),
        supabase.from("access_logs").select("id", { count: "exact", head: true }).gte("scanned_at", todayISO),
        supabase.from("access_logs").select("id", { count: "exact", head: true }).eq("decision", "allowed").gte("scanned_at", todayISO),
        supabase.from("access_logs").select("id", { count: "exact", head: true }).eq("decision", "denied").gte("scanned_at", todayISO),
        supabase.from("access_logs").select("id", { count: "exact", head: true }).eq("decision", "allowed").eq("direction", "in").gte("scanned_at", todayISO),
        supabase.from("access_logs").select("id", { count: "exact", head: true }).eq("decision", "allowed").eq("direction", "out").gte("scanned_at", todayISO),
        supabase.from("students").select("id", { count: "exact", head: true }).eq("is_visitor", true).eq("status", "active").gte("expires_at", todayLocal),
      ]);
      const inside = Math.max(0, (entries.count ?? 0) - (exits.count ?? 0));
      return {
        students:        students.count ?? 0,
        scans:           todayLogs.count ?? 0,
        allowed:         allowed.count ?? 0,
        denied:          denied.count ?? 0,
        inside,
        activeVisitors:  activeVisitors.count ?? 0,
      };
    },
  });

  const { data: hourly } = useQuery({
    queryKey: ["dashboard-hourly"],
    queryFn: async () => {
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const { data } = await supabase.from("access_logs").select("scanned_at, decision").gte("scanned_at", today.toISOString());
      const buckets = Array.from({ length: 24 }, (_, h) => ({ hour: `${h}:00`, allowed: 0, denied: 0, unknown: 0 }));
      (data ?? []).forEach((l: any) => {
        const h = new Date(l.scanned_at).getHours();
        const k = l.decision as "allowed" | "denied" | "unknown";
        if (k in buckets[h]) (buckets[h] as any)[k]++;
      });
      return buckets;
    },
  });

  const { data: weekly } = useQuery({
    queryKey: ["dashboard-weekly"],
    queryFn: async () => {
      const start = new Date(); start.setHours(0, 0, 0, 0); start.setDate(start.getDate() - 6);
      const { data } = await supabase.from("access_logs").select("scanned_at, decision").gte("scanned_at", start.toISOString());
      const days: Record<string, { day: string; allowed: number; denied: number; unknown: number }> = {};
      for (let i = 0; i < 7; i++) {
        const d = new Date(start); d.setDate(start.getDate() + i);
        const key = localDateStr(d); // local date key, not UTC
        days[key] = { day: d.toLocaleDateString(undefined, { weekday: "short" }), allowed: 0, denied: 0, unknown: 0 };
      }
      (data ?? []).forEach((l: any) => {
        const k = localDateStr(new Date(l.scanned_at)); // bucket by local date
        if (days[k]) (days[k] as any)[l.decision]++;
      });
      return Object.values(days);
    },
  });

  const [surgeAlertDismissed, setSurgeAlertDismissed] = useState(false);

  // ── Denial surge detection ────────────────────────────────────────────
  const { data: surgeData } = useQuery({
    queryKey: ["denial-surge"],
    refetchInterval: 30_000,
    queryFn: async () => {
      const tenMinAgo = new Date(Date.now() - 10 * 60_000).toISOString();
      const [{ count: recent }, { data: threshold }] = await Promise.all([
        supabase.from("access_logs")
          .select("id", { count: "exact", head: true })
          .eq("decision", "denied")
          .gte("scanned_at", tenMinAgo),
        supabase.from("settings")
          .select("value")
          .eq("key", "denial_alert_threshold")
          .maybeSingle(),
      ]);
      return {
        recent:    recent ?? 0,
        threshold: Number(threshold?.value ?? 5),
      };
    },
  });

  const surgeActive =
    !surgeAlertDismissed &&
    !!surgeData &&
    surgeData.recent >= surgeData.threshold;

  const [recent, setRecent] = useState<any[]>([]);
  useEffect(() => {
    let active = true;
    supabase.from("access_logs").select("id, scanned_code, decision, reason, scanned_at, direction, student:students(full_name, admission_number)")
      .order("scanned_at", { ascending: false }).limit(10)
      .then(({ data }) => { if (active && data) setRecent(data); });
    const ch = supabase.channel("dashboard-feed")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "access_logs" }, async (payload) => {
        const newLog: any = payload.new;
        let student = null;
        if (newLog.student_id) {
          const { data } = await supabase.from("students").select("full_name, admission_number").eq("id", newLog.student_id).maybeSingle();
          student = data;
        }
        setRecent((prev) => [{ ...newLog, student }, ...prev].slice(0, 10));
      })
      .subscribe();
    return () => { active = false; supabase.removeChannel(ch); };
  }, []);

  if (loading) return null;
  if (!isAdmin) return <Navigate to="/verify" replace />;

  const cards = [
    { label: t("common.active_students"),  value: stats?.students        ?? "—", icon: Users,       color: "text-primary"     },
    { label: t("common.scans_today"),      value: stats?.scans           ?? "—", icon: ScanLine,    color: "text-foreground"  },
    { label: t("common.allowed_today"),    value: stats?.allowed         ?? "—", icon: CheckCircle2,color: "text-success"     },
    { label: t("common.denied_today"),     value: stats?.denied          ?? "—", icon: XCircle,     color: "text-destructive" },
    { label: t("common.currently_inside"), value: stats?.inside          ?? "—", icon: UserCheck,   color: "text-primary"     },
    { label: t("common.active_visitors"),  value: stats?.activeVisitors  ?? "—", icon: UserPlus,    color: "text-warning"     },
  ];

  // Hardcoded hex values — CSS custom properties don't resolve inside SVG fill attributes
  const C = { allowed: "#16A34A", denied: "#DC2626", unknown: "#F59E0B" };

  const pieData = stats ? [
    { name: t("common.allowed"), value: stats.allowed, color: C.allowed },
    { name: t("common.denied"),  value: stats.denied,  color: C.denied  },
    { name: t("common.unknown"), value: Math.max(0, stats.scans - stats.allowed - stats.denied), color: C.unknown },
  ] : [];

  const handleOpenRenewal = (p: RenewablePerson) => {
    setRenewalPerson(p);
    setRenewalOpen(true);
  };

  return (
    <div className="space-y-6">
      {/* ── Denial surge banner ── */}
      {surgeActive && (
        <div className="flex items-start gap-3 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive animate-in fade-in duration-300">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="flex-1">
            <span className="font-semibold">{t("dash.surge_title")}</span>
            {t("dash.surge_body", { recent: surgeData!.recent, threshold: surgeData!.threshold })}{" "}
            <a className="underline underline-offset-2" href="/logs">{t("dash.surge_logs")}</a>{" "}
            {t("dash.surge_details")}
          </div>
          <button
            onClick={() => setSurgeAlertDismissed(true)}
            className="rounded-md p-0.5 hover:bg-destructive/20 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* ── Top Header ── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">{t("dash.title")}</h1>
            <Badge variant="outline" className="border-red-600/30 bg-red-600/10 text-red-600 font-semibold text-xs px-2 py-0.5">
              ABB Plant 3
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">{isAdmin ? t("dash.subtitle_admin") : t("dash.subtitle_op")}</p>
        </div>
        <div className="flex items-center gap-2">
          <Link to="/canteen">
            <Button variant="outline" size="sm" className="gap-1.5 text-xs">
              Canteen Turnstile
            </Button>
          </Link>
          <Link to="/verify" className="rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 shadow-sm transition-colors">
            {t("dash.open_scanner")}
          </Link>
        </div>
      </div>

      {/* ── Quick KPI Stat Cards ── */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="rounded-xl border border-border bg-card p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
              <Icon className={`h-4 w-4 ${color}`} />
            </div>
            <p className={`mt-2 text-3xl font-bold ${color}`}>{value}</p>
          </div>
        ))}
      </div>

      {/* ── Phase 8 Task 8.1 & 8.2: Credential Validity & Expiry Alerts Widget ── */}
      <div className="rounded-xl border border-border bg-card p-5 shadow-sm space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
          <div className="flex items-center gap-2.5">
            <div className="grid h-8 w-8 place-items-center rounded-lg bg-amber-500/10 text-amber-600">
              <CalendarClock className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-foreground">
                Credential Validity & Expiry Alerts
              </h2>
              <p className="text-xs text-muted-foreground">
                Automated gate rejection active for expired passes • 7-day upcoming expiration warning window
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Badge variant="destructive" className="text-xs font-bold gap-1 px-2 py-0.5">
              {expiryData?.totalExpired ?? 0} Expired
            </Badge>
            <Badge variant="outline" className="border-amber-500/40 text-amber-600 bg-amber-500/10 text-xs font-bold gap-1 px-2 py-0.5">
              {expiryData?.totalExpiringSoon ?? 0} Expiring &lt;7 Days
            </Badge>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => refetchExpiries()}
              className="h-8 w-8 p-0"
              title="Refresh expiries"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${expiriesLoading ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </div>

        {/* List of Expired & Expiring Soon Personnel */}
        {expiriesLoading ? (
          <div className="py-8 text-center text-xs text-muted-foreground">
            Checking validity status against database…
          </div>
        ) : (expiryData?.expiredList.length === 0 && expiryData?.expiringSoonList.length === 0) ? (
          <div className="flex items-center justify-between rounded-lg bg-secondary/30 p-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              All registered workers, interns, and visitor passes are within valid authorization periods.
            </span>
            <span className="font-medium text-foreground">0 expiring within 7 days</span>
          </div>
        ) : (
          <div className="divide-y divide-border/60">
            {/* Show up to 8 combined items */}
            {[...(expiryData?.expiredList ?? []), ...(expiryData?.expiringSoonList ?? [])].slice(0, 8).map((p: any) => {
              const isPast = new Date(p.expires_at).getTime() < Date.now();
              const category = p.category || "worker";
              const org = p.company_name || p.institution || "ABB Plant 3";

              // Calculate days remaining / elapsed
              const diffDays = Math.ceil(
                (new Date(p.expires_at).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
              );

              return (
                <div key={p.id} className="py-3 flex flex-wrap items-center justify-between gap-3 text-xs">
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className={`grid h-8 w-8 shrink-0 place-items-center rounded-full font-bold text-[10px] ${
                        isPast
                          ? "bg-destructive/10 text-destructive ring-1 ring-destructive/30"
                          : "bg-amber-500/10 text-amber-600 ring-1 ring-amber-500/30"
                      }`}
                    >
                      {category === "intern" ? (
                        <GraduationCap className="h-4 w-4" />
                      ) : (
                        <HardHat className="h-4 w-4" />
                      )}
                    </div>

                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-foreground truncate">{p.full_name}</span>
                        <span className="font-mono text-[11px] text-muted-foreground">({p.admission_number})</span>
                        <Badge
                          variant="outline"
                          className={`text-[9px] font-bold uppercase px-1 py-0 ${
                            category === "intern"
                              ? "border-indigo-500/30 text-indigo-600"
                              : "border-blue-500/30 text-blue-600"
                          }`}
                        >
                          {category}
                        </Badge>
                      </div>
                      <p className="text-[11px] text-muted-foreground truncate">
                        {org} • Expiry: <strong>{new Date(p.expires_at).toLocaleDateString()}</strong>
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <Badge
                      className={`text-[10px] font-bold px-2 py-0.5 ${
                        isPast
                          ? "bg-destructive text-destructive-foreground"
                          : "bg-amber-500/20 text-amber-700 dark:text-amber-300 border border-amber-500/30"
                      }`}
                    >
                      {isPast ? `Expired ${Math.abs(diffDays)}d ago` : `Expires in ${diffDays}d`}
                    </Badge>

                    {/* 1-Click Renew Action Button */}
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleOpenRenewal(p)}
                      className="h-7 text-xs font-semibold gap-1 hover:border-red-600/40 hover:text-red-600"
                    >
                      <CalendarClock className="h-3 w-3" />
                      Renew / Extend
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="flex items-center justify-between pt-1 text-xs text-muted-foreground border-t border-border/50">
          <span>Non-valid credentials are automatically denied at the gate turnstile.</span>
          <Link to="/personnel" className="text-primary hover:underline font-semibold flex items-center gap-1">
            Manage all pass records <ChevronRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>

      {/* ── Charts ── */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-xl border border-border bg-card p-5 shadow-sm lg:col-span-2">
          <h2 className="mb-3 text-sm font-semibold">{t("dash.chart_hourly")}</h2>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={hourly ?? []}>
              <XAxis dataKey="hour" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip />
              <Bar dataKey="allowed" name={t("common.allowed")} stackId="a" fill={C.allowed} />
              <Bar dataKey="denied"  name={t("common.denied")}  stackId="a" fill={C.denied}  />
              <Bar dataKey="unknown" name={t("common.unknown")} stackId="a" fill={C.unknown} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold">{t("dash.chart_split")}</h2>
          <ResponsiveContainer width="100%" height={240}>
            <PieChart>
              <Pie data={pieData} dataKey="value" nameKey="name" innerRadius={45} outerRadius={75}>
                {pieData.map((d, i) => <Cell key={i} fill={d.color} />)}
              </Pie>
              <Legend />
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold">{t("dash.chart_weekly")}</h2>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={weekly ?? []}>
            <XAxis dataKey="day" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip />
            <Legend />
            <Bar dataKey="allowed" name={t("common.allowed")} stackId="a" fill={C.allowed} />
            <Bar dataKey="denied"  name={t("common.denied")}  stackId="a" fill={C.denied}  />
            <Bar dataKey="unknown" name={t("common.unknown")} stackId="a" fill={C.unknown} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* ── Live Scans Stream ── */}
      <div className="rounded-xl border border-border bg-card shadow-sm">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="font-semibold">{t("dash.live_title")}</h2>
          <Link to="/logs" className="text-xs text-primary hover:underline">{t("dash.view_all")}</Link>
        </div>
        <div className="divide-y divide-border">
          {recent.length === 0 && (
            <div className="px-5 py-10 text-center text-sm text-muted-foreground">{t("dash.no_scans")}</div>
          )}
          {recent.map((log) => (
            <div key={log.id} className="flex items-center gap-3 px-5 py-3 text-sm">
              {log.decision === "allowed" ? <CheckCircle2 className="h-4 w-4 text-success" /> :
               log.decision === "denied" ? <XCircle className="h-4 w-4 text-destructive" /> :
               <Clock className="h-4 w-4 text-muted-foreground" />}
              {log.direction && <span className="rounded bg-secondary px-1.5 text-[10px] uppercase text-muted-foreground">{log.direction === "in" ? t("dash.dir_entry") : t("dash.dir_exit")}</span>}
              <div className="flex-1 truncate">
                <span className="font-medium">{log.student?.full_name ?? log.scanned_code}</span>
                {log.student?.admission_number && <span className="ml-2 text-xs text-muted-foreground">{log.student.admission_number}</span>}
                {log.reason && <span className="ml-2 text-xs text-muted-foreground">· {log.reason}</span>}
              </div>
              <span className="text-xs text-muted-foreground">{new Date(log.scanned_at).toLocaleTimeString()}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Pass Renewal & Extension Dialog (Task 8.2) ── */}
      <PassRenewalModal
        open={renewalOpen}
        onOpenChange={setRenewalOpen}
        person={renewalPerson}
        onSuccess={() => refetchExpiries()}
      />
    </div>
  );
}
