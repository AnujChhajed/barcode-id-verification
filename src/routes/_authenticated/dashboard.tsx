import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Users, ScanLine, CheckCircle2, XCircle, Clock, UserCheck, UserPlus, AlertTriangle, X } from "lucide-react";
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
  const { isAdmin } = useAuth();

  const { data: stats } = useQuery({
    queryKey: ["dashboard-stats"],
    refetchInterval: 30_000, // refresh every 30s
    queryFn: async () => {
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const todayISO    = today.toISOString();
      // Local date string for expires_at comparison (avoid UTC-date bug)
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

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{t("dash.title")}</h1>
          <p className="text-sm text-muted-foreground">{isAdmin ? t("dash.subtitle_admin") : t("dash.subtitle_op")}</p>
        </div>
        <Link to="/verify" className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90">{t("dash.open_scanner")}</Link>
      </div>

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
    </div>
  );
}
