import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Megaphone, Plus, CheckCircle2, AlertTriangle, Info, Zap, X, Clock, RefreshCw, Users } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/announcements")({
  component: AnnouncementsPage,
});

function AnnouncementsPage() {
  const { t } = useTranslation();
  const { user, isAdmin } = useAuth();
  const qc = useQueryClient();

  const PRIORITY = {
    low:    { label: t("ann.priority_low"),    ring: "ring-border",          badge: "bg-secondary text-muted-foreground",           icon: Info,          glow: false },
    normal: { label: t("ann.priority_normal"), ring: "ring-primary/30",      badge: "bg-primary/10 text-primary",                   icon: Megaphone,     glow: false },
    high:   { label: t("ann.priority_high"),   ring: "ring-warning/50",      badge: "bg-warning/15 text-warning",                   icon: AlertTriangle, glow: false },
    urgent: { label: t("ann.priority_urgent"), ring: "ring-destructive/60",  badge: "bg-destructive/15 text-destructive font-bold",  icon: Zap,           glow: true  },
  } as const;

  const [showForm, setShowForm]     = useState(false);
  const [title,    setTitle]        = useState("");
  const [body,     setBody]         = useState("");
  const [priority, setPriority]     = useState<"low"|"normal"|"high"|"urgent">("normal");
  const [expires,  setExpires]      = useState("");
  const [busy,     setBusy]         = useState(false);

  // ── All active (non-expired) announcements ──
  const { data: announcements, isLoading, refetch } = useQuery({
    queryKey: ["announcements"],
    refetchInterval: 30_000,
    queryFn: async () => {
      const now = new Date().toISOString();
      const { data } = await supabase
        .from("announcements")
        .select("id, title, body, priority, expires_at, created_at, created_by")
        .or(`expires_at.is.null,expires_at.gt.${now}`)
        .order("created_at", { ascending: false });
      return data ?? [];
    },
  });

  // ── Which ones the current user has already acknowledged ──
  const { data: readSet } = useQuery({
    queryKey: ["announcement-reads", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase
        .from("announcement_reads")
        .select("announcement_id")
        .eq("user_id", user!.id);
      return new Set((data ?? []).map((r: any) => r.announcement_id as string));
    },
  });

  // ── Acknowledgement counts per announcement (admin only) ──
  const { data: readCounts } = useQuery({
    queryKey: ["announcement-read-counts"],
    enabled: isAdmin,
    queryFn: async () => {
      const { data } = await supabase
        .from("announcement_reads")
        .select("announcement_id");
      const counts: Record<string, number> = {};
      (data ?? []).forEach((r: any) => {
        counts[r.announcement_id] = (counts[r.announcement_id] ?? 0) + 1;
      });
      return counts;
    },
  });

  const acknowledge = async (id: string) => {
    if (!user || readSet?.has(id)) return;
    const { error } = await supabase
      .from("announcement_reads")
      .insert({ announcement_id: id, user_id: user.id });
    if (!error) {
      qc.invalidateQueries({ queryKey: ["announcement-reads"] });
      qc.invalidateQueries({ queryKey: ["announcements-unread", user.id] });
      qc.invalidateQueries({ queryKey: ["announcement-read-counts"] });
      toast.success(t("ann.acknowledged"));
    }
  };

  const create = async () => {
    if (!title.trim() || !body.trim()) {
      toast.error(t("ann.required_fields"));
      return;
    }
    setBusy(true);
    const { error } = await supabase.from("announcements").insert({
      title:      title.trim(),
      body:       body.trim(),
      priority,
      created_by: user?.id ?? null,
      expires_at: expires || null,
    });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success(t("ann.posted"));
    setTitle(""); setBody(""); setPriority("normal"); setExpires("");
    setShowForm(false);
    qc.invalidateQueries({ queryKey: ["announcements"] });
    qc.invalidateQueries({ queryKey: ["announcement-read-counts"] });
  };

  const remove = async (id: string) => {
    if (!confirm(t("ann.confirm_delete"))) return;
    await supabase.from("announcements").delete().eq("id", id);
    qc.invalidateQueries({ queryKey: ["announcements"] });
    qc.invalidateQueries({ queryKey: ["announcements-unread", user?.id] });
    toast.success(t("ann.deleted"));
  };

  const unread = (announcements ?? []).filter((a: any) => !readSet?.has(a.id)).length;

  // Sort: unread first, then by priority weight, then by date
  const priorityWeight = { urgent: 0, high: 1, normal: 2, low: 3 };
  const sorted = [...(announcements ?? [])].sort((a: any, b: any) => {
    const aRead = readSet?.has(a.id) ? 1 : 0;
    const bRead = readSet?.has(b.id) ? 1 : 0;
    if (aRead !== bRead) return aRead - bRead;
    const pw = (priorityWeight as any);
    return (pw[a.priority] ?? 2) - (pw[b.priority] ?? 2);
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{t("ann.title")}</h1>
          <p className="text-sm text-muted-foreground">
            {unread > 0
              ? t("ann.unread_many", { count: unread })
              : t("ann.all_read")}
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => refetch()}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> {t("common2.refresh")}
          </Button>
          {isAdmin && (
            <Button size="sm" onClick={() => setShowForm((s) => !s)}>
              <Plus className="mr-1.5 h-4 w-4" /> {t("ann.new_btn")}
            </Button>
          )}
        </div>
      </div>

      {/* Unread urgency banner */}
      {unread > 0 && (
        <div className="flex items-center gap-3 rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning animate-in fade-in duration-300">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>
            <strong>{unread} {t("ann.unread_label")}</strong> — {t("ann.unread_hint")}
          </span>
        </div>
      )}

      {/* Create form */}
      {showForm && isAdmin && (
        <div className="rounded-xl border border-border bg-card p-5 shadow-sm space-y-4 animate-in fade-in slide-in-from-top-2 duration-200">
          <h2 className="font-semibold">{t("ann.post_btn")}</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2 space-y-1.5">
              <Label>{t("ann.field_title")} <span className="text-destructive">*</span></Label>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t("ann.title_ph")}
                autoFocus
              />
            </div>
            <div className="sm:col-span-2 space-y-1.5">
              <Label>{t("ann.field_message")} <span className="text-destructive">*</span></Label>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder={t("ann.message_ph")}
                rows={4}
                className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-none"
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t("ann.field_priority")}</Label>
              <Select value={priority} onValueChange={(v) => setPriority(v as any)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">{t("ann.priority_low")}</SelectItem>
                  <SelectItem value="normal">{t("ann.priority_normal")}</SelectItem>
                  <SelectItem value="high">{t("ann.priority_high")}</SelectItem>
                  <SelectItem value="urgent">{t("ann.priority_urgent")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{t("ann.field_expires")}</Label>
              <Input
                type="datetime-local"
                value={expires}
                onChange={(e) => setExpires(e.target.value)}
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" onClick={() => setShowForm(false)}>{t("common.cancel")}</Button>
            <Button onClick={create} disabled={busy || !title.trim() || !body.trim()}>
              {busy ? t("common.loading") : t("ann.post_btn")}
            </Button>
          </div>
        </div>
      )}

      {/* List */}
      {isLoading ? (
        <div className="py-12 text-center text-sm text-muted-foreground">{t("common.loading")}</div>
      ) : sorted.length === 0 ? (
        <div className="rounded-xl border border-border bg-card py-16 text-center">
          <Megaphone className="mx-auto mb-3 h-10 w-10 text-muted-foreground/25" />
          <p className="text-sm font-medium text-muted-foreground">{t("ann.empty")}</p>
          <p className="mt-1 text-xs text-muted-foreground/60">{t("ann.empty_hint")}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {sorted.map((ann: any) => {
            const cfg   = PRIORITY[ann.priority as keyof typeof PRIORITY] ?? PRIORITY.normal;
            const Icon  = cfg.icon;
            const isRead = readSet?.has(ann.id) ?? false;
            const count  = readCounts?.[ann.id] ?? 0;

            return (
              <div
                key={ann.id}
                className={cn(
                  "rounded-xl border bg-card p-5 shadow-sm transition-all duration-200 ring-1",
                  cfg.ring,
                  isRead ? "opacity-60" : "hover:shadow-md",
                  cfg.glow && !isRead && "animate-pulse-border"
                )}
              >
                <div className="flex items-start gap-3">
                  {/* Priority icon */}
                  <div className={cn(
                    "mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg",
                    cfg.badge
                  )}>
                    <Icon className="h-4 w-4" />
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-1.5">
                      <span className={cn("rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide", cfg.badge)}>
                        {cfg.label}
                      </span>
                      {!isRead && (
                        <span className="rounded-full bg-primary px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-primary-foreground animate-pulse">
                          {t("ann.new_badge")}
                        </span>
                      )}
                      <span className="ml-auto text-xs text-muted-foreground">
                        {new Date(ann.created_at).toLocaleString()}
                      </span>
                    </div>

                    <p className="font-semibold text-foreground leading-snug">{ann.title}</p>
                    <p className="mt-1.5 text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed">{ann.body}</p>

                    {ann.expires_at && (
                      <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Clock className="h-3 w-3" />
                        {t("ann.expires_at", { date: new Date(ann.expires_at).toLocaleString() })}
                      </p>
                    )}

                    <div className="mt-3 flex flex-wrap items-center gap-3">
                      {isRead ? (
                        <span className="flex items-center gap-1.5 text-xs font-medium text-success">
                          <CheckCircle2 className="h-3.5 w-3.5" /> {t("ann.acknowledged")}
                        </span>
                      ) : (
                        <Button size="sm" variant="outline" onClick={() => acknowledge(ann.id)}>
                          <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" /> {t("ann.ack_btn")}
                        </Button>
                      )}
                      {isAdmin && (
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Users className="h-3 w-3" /> {count} {t("ann.acknowledged")}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Admin delete */}
                  {isAdmin && (
                    <button
                      onClick={() => remove(ann.id)}
                      className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-secondary hover:text-destructive transition-colors"
                      title="Delete announcement"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
