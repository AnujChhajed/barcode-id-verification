import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { gateApi, peopleApi, type GateResult } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import {
  Users,
  ScanLine,
  CheckCircle2,
  XCircle,
  Clock,
  UserCheck,
  UserPlus,
  AlertTriangle,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: Dashboard,
});

/** The most rows the API returns in one page (`listGateEventsQuerySchema`). */
const PAGE_LIMIT = 200;

/** "YYYY-MM-DD" for an instant, in the browser's LOCAL timezone. */
function dateKey(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

/**
 * Local midnight for a "YYYY-MM-DD" key as an ISO instant, for the inclusive
 * `from` bound. The backend reports the plant's own date key from `/api/inside`,
 * so the browser never guesses which calendar day the site is on.
 */
function dayStartIso(key: string) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0).toISOString();
}

/** End of a local calendar day → ISO instant for the inclusive `to` bound. */
function dayEndIso(key: string) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d, 23, 59, 59, 999).toISOString();
}

type Bucket = { hour: string; approved: number; rejected: number; unable: number };

function bucketOf(result: GateResult): keyof Omit<Bucket, "hour"> {
  if (result === "approved") return "approved";
  if (result === "rejected") return "rejected";
  return "unable";
}

function Dashboard() {
  const { t } = useTranslation();
  const { isAdmin } = useAuth();

  // ── Who is on site (authoritative — derived on the server) ──────────────
  const { data: inside } = useQuery({
    queryKey: ["inside"],
    queryFn: () => gateApi.inside(),
    refetchInterval: 30_000,
  });

  const todayKey = inside?.today ?? dateKey(new Date());
  const insideRows = inside?.inside ?? [];

  // ── Today's totals, counted by the server (never by the browser) ────────
  const { data: stats } = useQuery({
    queryKey: ["dash-stats", todayKey],
    refetchInterval: 30_000,
    queryFn: async () => {
      const from = dayStartIso(todayKey);
      const [scans, approved, rejected, unable] = await Promise.all([
        gateApi.events({ from, limit: 1 }),
        gateApi.events({ from, result: "approved", limit: 1 }),
        gateApi.events({ from, result: "rejected", limit: 1 }),
        gateApi.events({ from, result: "unable_to_verify", limit: 1 }),
      ]);
      return {
        scans: scans.total,
        approved: approved.total,
        rejected: rejected.total,
        unable: unable.total,
      };
    },
  });

  // ── Register size — administrators only, the endpoint is role-guarded ───
  const { data: people } = useQuery({
    queryKey: ["dash-people"],
    enabled: isAdmin,
    queryFn: () => peopleApi.list({ status: "active", limit: 1 }),
  });

  // ── Scans by hour, today ────────────────────────────────────────────────
  const { data: hourly } = useQuery({
    queryKey: ["dash-hourly", todayKey],
    refetchInterval: 60_000,
    queryFn: async () => {
      const res = await gateApi.events({ from: dayStartIso(todayKey), limit: PAGE_LIMIT });
      const buckets: Bucket[] = Array.from({ length: 24 }, (_, h) => ({
        hour: `${h}:00`,
        approved: 0,
        rejected: 0,
        unable: 0,
      }));
      for (const e of res.events) {
        const h = new Date(e.occurredAt).getHours();
        if (h >= 0 && h < 24) buckets[h][bucketOf(e.result)]++;
      }
      return { buckets, total: res.total };
    },
  });

  const hourlyTruncated = (hourly?.total ?? 0) > PAGE_LIMIT;

  // ── Last 7 days, one server count per day ───────────────────────────────
  const { data: weekly } = useQuery({
    queryKey: ["dash-weekly", todayKey],
    refetchInterval: 300_000,
    queryFn: async () => {
      const days: Array<{ key: string; label: string }> = [];
      for (let i = 6; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        days.push({ key: dateKey(d), label: d.toLocaleDateString(undefined, { weekday: "short" }) });
      }
      return Promise.all(
        days.map(async (d) => {
          const res = await gateApi.events({
            from: dayStartIso(d.key),
            to: dayEndIso(d.key),
            limit: 1,
          });
          return { day: d.label, scans: res.total };
        }),
      );
    },
  });

  // ── Live feed (polling: the new backend has no websocket transport) ─────
  const { data: feed } = useQuery({
    queryKey: ["dash-feed"],
    refetchInterval: 15_000,
    queryFn: () => gateApi.events({ limit: 10 }),
  });

  const recent = feed?.events ?? [];

  const cards = [
    ...(isAdmin
      ? [
          {
            key: "people",
            label: t("common.active_people"),
            value: people?.total ?? "—",
            icon: Users,
            color: "text-primary",
          },
        ]
      : []),
    {
      key: "scans",
      label: t("common.scans_today"),
      value: stats?.scans ?? "—",
      icon: ScanLine,
      color: "text-foreground",
    },
    {
      key: "approved",
      label: t("common.allowed_today"),
      value: stats?.approved ?? "—",
      icon: CheckCircle2,
      color: "text-success",
    },
    {
      key: "rejected",
      label: t("common.denied_today"),
      value: stats?.rejected ?? "—",
      icon: XCircle,
      color: "text-destructive",
    },
    {
      key: "inside",
      label: t("common.currently_inside"),
      value: insideRows.length,
      icon: UserCheck,
      color: "text-primary",
    },
    {
      key: "visitors",
      label: t("common.active_visitors"),
      value: insideRows.filter((r) => r.person.category === "visitor").length,
      icon: UserPlus,
      color: "text-warning",
    },
  ];

  // Hardcoded hex values — CSS custom properties don't resolve inside SVG fill attributes
  const C = { approved: "#16A34A", rejected: "#DC2626", unable: "#F59E0B" };

  const pieData = stats
    ? [
        { name: t("logs.result_approved"), value: stats.approved, color: C.approved },
        { name: t("logs.result_rejected"), value: stats.rejected, color: C.rejected },
        { name: t("logs.result_unable"), value: stats.unable, color: C.unable },
      ]
    : [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{t("dash.title")}</h1>
          <p className="text-sm text-muted-foreground">
            {isAdmin ? t("dash.subtitle_admin") : t("dash.subtitle_op")}
          </p>
        </div>
        <Link
          to="/verify"
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          {t("dash.open_scanner")}
        </Link>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map(({ key, label, value, icon: Icon, color }) => (
          <div key={key} className="rounded-xl border border-border bg-card p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {label}
              </p>
              <Icon className={`h-4 w-4 ${color}`} />
            </div>
            <p className={`mt-2 text-3xl font-bold ${color}`}>{value}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-xl border border-border bg-card p-5 shadow-sm lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold">{t("dash.chart_hourly")}</h2>
            {hourlyTruncated && (
              <span className="flex items-center gap-1 text-[11px] text-warning">
                <AlertTriangle className="h-3 w-3" />
                {t("dash.chart_capped", { limit: PAGE_LIMIT })}
              </span>
            )}
          </div>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={hourly?.buckets ?? []}>
              <XAxis dataKey="hour" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
              <Tooltip />
              <Bar
                dataKey="approved"
                name={t("logs.result_approved")}
                stackId="a"
                fill={C.approved}
              />
              <Bar
                dataKey="rejected"
                name={t("logs.result_rejected")}
                stackId="a"
                fill={C.rejected}
              />
              <Bar dataKey="unable" name={t("logs.result_unable")} stackId="a" fill={C.unable} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold">{t("dash.chart_split")}</h2>
          <ResponsiveContainer width="100%" height={240}>
            <PieChart>
              <Pie data={pieData} dataKey="value" nameKey="name" innerRadius={45} outerRadius={75}>
                {pieData.map((d, i) => (
                  <Cell key={i} fill={d.color} />
                ))}
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
            <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
            <Tooltip />
            <Bar dataKey="scans" name={t("dash.series_scans")} fill={C.approved} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="rounded-xl border border-border bg-card shadow-sm">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="font-semibold">{t("dash.live_title")}</h2>
          <Link to="/logs" className="text-xs text-primary hover:underline">
            {t("dash.view_all")}
          </Link>
        </div>
        <div className="divide-y divide-border">
          {recent.length === 0 && (
            <div className="px-5 py-10 text-center text-sm text-muted-foreground">
              {t("dash.no_scans")}
            </div>
          )}
          {recent.map((log) => (
            <div key={log.id} className="flex items-center gap-3 px-5 py-3 text-sm">
              {log.result === "approved" ? (
                <CheckCircle2 className="h-4 w-4 text-success" />
              ) : log.result === "rejected" ? (
                <XCircle className="h-4 w-4 text-destructive" />
              ) : (
                <Clock className="h-4 w-4 text-muted-foreground" />
              )}
              <span className="rounded bg-secondary px-1.5 text-[10px] uppercase text-muted-foreground">
                {log.direction === "entry" ? t("dash.dir_entry") : t("dash.dir_exit")}
              </span>
              <div className="flex-1 truncate">
                <span className="font-medium">
                  {log.personName ?? (
                    <span className="italic text-muted-foreground">{t("logs.unknown_code")}</span>
                  )}
                </span>
                {log.personCategory && (
                  <span className="ml-2 text-xs text-muted-foreground">{log.personCategory}</span>
                )}
                {log.reasonText && (
                  <span className="ml-2 text-xs text-muted-foreground">· {log.reasonText}</span>
                )}
              </div>
              <span className="text-xs text-muted-foreground">
                {new Date(log.occurredAt).toLocaleTimeString()}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
