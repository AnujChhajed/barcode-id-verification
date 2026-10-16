import { createFileRoute, Navigate, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RefreshCw, Bell, CheckCircle2, XCircle, Clock, Mail, MessageSquare } from "lucide-react";
import { useTranslation } from "react-i18next";

export const Route = createFileRoute("/_authenticated/notifications")({
  component: NotificationsPage,
});

function NotificationsPage() {
  const { t } = useTranslation();
  const { isAdmin, loading } = useAuth();
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<"all" | "sent" | "failed" | "pending">("all");

  const { data: notifications, isLoading } = useQuery({
    queryKey: ["notifications", statusFilter],
    enabled: isAdmin,
    queryFn: async () => {
      let q = supabase
        .from("notifications")
        .select(`
          id, created_at, kind, channel, recipient, status, error, subject,
          student:related_student_id ( full_name, admission_number )
        `)
        .order("created_at", { ascending: false })
        .limit(300);
      if (statusFilter !== "all") q = q.eq("status", statusFilter);
      const { data } = await q;
      return data ?? [];
    },
  });

  const { data: counts } = useQuery({
    queryKey: ["notification-counts"],
    enabled: isAdmin,
    queryFn: async () => {
      const [sent, failed, pending] = await Promise.all([
        supabase.from("notifications").select("id", { count: "exact", head: true }).eq("status", "sent"),
        supabase.from("notifications").select("id", { count: "exact", head: true }).eq("status", "failed"),
        supabase.from("notifications").select("id", { count: "exact", head: true }).eq("status", "pending"),
      ]);
      return {
        sent:    sent.count    ?? 0,
        failed:  failed.count  ?? 0,
        pending: pending.count ?? 0,
      };
    },
  });

  if (loading) return null;
  if (!isAdmin) return <Navigate to="/verify" />;

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["notifications"] });
    qc.invalidateQueries({ queryKey: ["notification-counts"] });
  };

  const channelIcon = (channel: string) =>
    channel === "email" ? <Mail className="h-3.5 w-3.5" /> : <MessageSquare className="h-3.5 w-3.5" />;

  const statusBadge = (status: string) => {
    if (status === "sent")    return <Badge className="bg-success/15 text-success"><CheckCircle2 className="mr-1 h-3 w-3" />{t("notifs.stat_sent")}</Badge>;
    if (status === "failed")  return <Badge variant="destructive"><XCircle className="mr-1 h-3 w-3" />{t("notifs.stat_failed")}</Badge>;
    return <Badge variant="secondary"><Clock className="mr-1 h-3 w-3" />{t("notifs.stat_pending")}</Badge>;
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{t("notifs.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("notifs.subtitle")}</p>
        </div>
        <Button size="sm" variant="outline" onClick={refresh}>
          <RefreshCw className="mr-2 h-3.5 w-3.5" /> {t("common2.refresh")}
        </Button>
      </div>

      {/* ── Summary cards ── */}
      <div className="grid gap-3 sm:grid-cols-3">
        {[
          { label: t("notifs.stat_sent"),    filter: "sent",    value: counts?.sent    ?? "—", color: "text-success",     Icon: CheckCircle2 },
          { label: t("notifs.stat_failed"),  filter: "failed",  value: counts?.failed  ?? "—", color: "text-destructive", Icon: XCircle      },
          { label: t("notifs.stat_pending"), filter: "pending", value: counts?.pending ?? "—", color: "text-muted-foreground", Icon: Clock  },
        ].map(({ label, filter, value, color, Icon }) => (
          <div
            key={filter}
            onClick={() => setStatusFilter(filter as any)}
            className="cursor-pointer rounded-xl border border-border bg-card p-4 shadow-sm hover:bg-secondary/40 transition-colors"
          >
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
              <Icon className={`h-4 w-4 ${color}`} />
            </div>
            <p className={`mt-1 text-3xl font-bold ${color}`}>{value}</p>
          </div>
        ))}
      </div>

      {/* ── Filter ── */}
      <div className="flex items-center gap-3">
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as any)}>
          <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("common2.all_statuses")}</SelectItem>
            <SelectItem value="sent">{t("notifs.stat_sent")}</SelectItem>
            <SelectItem value="failed">{t("notifs.stat_failed")}</SelectItem>
            <SelectItem value="pending">{t("notifs.stat_pending")}</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-sm text-muted-foreground">
          {isLoading ? t("common.loading") : t("common2.records", { count: (notifications ?? []).length })}
        </span>
      </div>

      {/* ── Table ── */}
      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        {isLoading ? (
          <div className="px-5 py-12 text-center text-sm text-muted-foreground">{t("common.loading")}</div>
        ) : (notifications ?? []).length === 0 ? (
          <div className="px-5 py-12 text-center text-sm text-muted-foreground">
            <Bell className="mx-auto mb-2 h-8 w-8 opacity-30" />
            {t("notifs.empty")}
            {statusFilter !== "all" && (
              <button onClick={() => setStatusFilter("all")} className="ml-1 text-primary hover:underline">
                {t("common2.clear_filters")}
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-secondary text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 text-left">{t("notifs.col_time")}</th>
                  <th className="px-4 py-3 text-left">{t("notifs.col_kind")}</th>
                  <th className="px-4 py-3 text-left">{t("notifs.col_channel")}</th>
                  <th className="px-4 py-3 text-left">{t("notifs.col_recipient")}</th>
                  <th className="px-4 py-3 text-left">{t("common.student")}</th>
                  <th className="px-4 py-3 text-left">{t("common.status")}</th>
                  <th className="px-4 py-3 text-left">{t("notifs.col_error")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {(notifications ?? []).map((n: any) => (
                  <tr key={n.id} className="hover:bg-secondary/40">
                    <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground whitespace-nowrap">
                      {new Date(n.created_at).toLocaleString()}
                    </td>
                    <td className="px-4 py-2.5 text-xs capitalize">{n.kind?.replace(/_/g, " ") ?? "—"}</td>
                    <td className="px-4 py-2.5">
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                        {channelIcon(n.channel)} {n.channel}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-xs font-mono">{n.recipient}</td>
                    <td className="px-4 py-2.5 text-xs">
                      {n.student ? (
                        <Link
                          to="/students/$id"
                          params={{ id: n.related_student_id }}
                          className="text-primary hover:underline"
                        >
                          {n.student.full_name}
                        </Link>
                      ) : "—"}
                    </td>
                    <td className="px-4 py-2.5">{statusBadge(n.status)}</td>
                    <td className="px-4 py-2.5 text-xs text-destructive max-w-[200px] truncate" title={n.error ?? ""}>
                      {n.error ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        Notifications are written here by Edge Functions when events occur (denied access, suspension, etc.).
        Connect an email or SMS provider in the Edge Function to start delivering messages.
      </p>
    </div>
  );
}
