import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertOctagon, Plus, ShieldAlert, Clock, CheckCircle2,
  ChevronDown, ChevronUp, RefreshCw, MapPin, Users, X,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/incidents")({
  component: IncidentsPage,
});

type StatusKey   = "open" | "under_review" | "resolved" | "closed";
type SeverityKey = "low" | "medium" | "high" | "critical";

function IncidentsPage() {
  const { t } = useTranslation();
  const { user, isAdmin } = useAuth();

  const INCIDENT_TYPES = [
    { value: "trespassing",       label: t("inc.type_trespass")   },
    { value: "theft",             label: t("inc.type_theft")      },
    { value: "suspicious_person", label: t("inc.type_suspicious") },
    { value: "medical",           label: t("inc.type_medical")    },
    { value: "damaged_property",  label: t("inc.type_damage")     },
    { value: "altercation",       label: t("inc.type_altercation")},
    { value: "lost_id",           label: t("inc.type_lost_id")    },
    { value: "other",             label: t("inc.type_other")      },
  ];

  const SEVERITY_CFG = {
    low:      { label: t("inc.sev_low"),      badge: "bg-secondary text-muted-foreground",   dot: "bg-muted-foreground" },
    medium:   { label: t("inc.sev_medium"),   badge: "bg-primary/10 text-primary",           dot: "bg-primary"          },
    high:     { label: t("inc.sev_high"),     badge: "bg-warning/15 text-warning",           dot: "bg-warning"          },
    critical: { label: t("inc.sev_critical"), badge: "bg-destructive/15 text-destructive",   dot: "bg-destructive"      },
  };

  const STATUS_CFG = {
    open:          { label: t("inc.status_open"),     badge: "bg-destructive/15 text-destructive" },
    under_review:  { label: t("inc.status_review"),   badge: "bg-warning/15 text-warning"         },
    resolved:      { label: t("inc.status_resolved"), badge: "bg-success/15 text-success"         },
    closed:        { label: t("inc.status_closed"),   badge: "bg-secondary text-muted-foreground" },
  };
  const qc = useQueryClient();

  const [statusFilter, setStatusFilter] = useState<"all" | StatusKey>("all");
  const [showForm,     setShowForm]     = useState(false);
  const [expandedId,   setExpandedId]   = useState<string | null>(null);

  // Form state
  const [type,     setType]     = useState("trespassing");
  const [severity, setSeverity] = useState<SeverityKey>("medium");
  const [title,    setTitle]    = useState("");
  const [desc,     setDesc]     = useState("");
  const [location, setLocation] = useState("");
  const [persons,  setPersons]  = useState("");
  const [busy,     setBusy]     = useState(false);

  // Admin review state
  const [adminNote,    setAdminNote]    = useState<Record<string, string>>({});
  const [reviewBusy,   setReviewBusy]   = useState<string | null>(null);

  const { data: incidents, isLoading, refetch } = useQuery({
    queryKey: ["incidents", statusFilter],
    queryFn: async () => {
      let q = supabase
        .from("incidents")
        .select("*, reporter:reported_by(email), reviewer:reviewed_by(email)")
        .order("created_at", { ascending: false });
      if (statusFilter !== "all") q = q.eq("status", statusFilter);
      const { data } = await q;
      return data ?? [];
    },
  });

  const counts = useQuery({
    queryKey: ["incident-counts"],
    queryFn: async () => {
      const [open, review, resolved, closed] = await Promise.all([
        supabase.from("incidents").select("id", { count: "exact", head: true }).eq("status", "open"),
        supabase.from("incidents").select("id", { count: "exact", head: true }).eq("status", "under_review"),
        supabase.from("incidents").select("id", { count: "exact", head: true }).eq("status", "resolved"),
        supabase.from("incidents").select("id", { count: "exact", head: true }).eq("status", "closed"),
      ]);
      return {
        open:         open.count    ?? 0,
        under_review: review.count  ?? 0,
        resolved:     resolved.count ?? 0,
        closed:       closed.count  ?? 0,
      };
    },
  });

  const report = async () => {
    if (!title.trim() || !desc.trim()) { toast.error(t("inc.required_fields")); return; }
    setBusy(true);
    const { error } = await supabase.from("incidents").insert({
      type, severity, title: title.trim(), description: desc.trim(),
      location:         location.trim() || null,
      persons_involved: persons.trim()  || null,
      reported_by:      user?.id ?? null,
    });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success(t("inc.reported"));
    setTitle(""); setDesc(""); setLocation(""); setPersons(""); setType("trespassing"); setSeverity("medium");
    setShowForm(false);
    qc.invalidateQueries({ queryKey: ["incidents"] });
    qc.invalidateQueries({ queryKey: ["incident-counts"] });
  };

  const updateStatus = async (id: string, newStatus: StatusKey) => {
    setReviewBusy(id);
    const payload: any = {
      status:      newStatus,
      updated_at:  new Date().toISOString(),
    };
    if (newStatus === "resolved" || newStatus === "closed") {
      payload.resolved_at = new Date().toISOString();
    }
    if (isAdmin) {
      payload.reviewed_by = user?.id;
      if (adminNote[id]?.trim()) payload.admin_notes = adminNote[id].trim();
    }
    const { error } = await supabase.from("incidents").update(payload).eq("id", id);
    setReviewBusy(null);
    if (error) { toast.error(error.message); return; }
    toast.success(t("inc.status_updated"));
    qc.invalidateQueries({ queryKey: ["incidents"] });
    qc.invalidateQueries({ queryKey: ["incident-counts"] });
  };

  const openCount = counts.data?.open ?? 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{t("inc.title")}</h1>
          <p className="text-sm text-muted-foreground">
            {openCount > 0
              ? t("inc.open_count", { count: openCount })
              : t("inc.all_clear")}
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => refetch()}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> {t("common2.refresh")}
          </Button>
          <Button size="sm" onClick={() => setShowForm((s) => !s)}>
            <Plus className="mr-1.5 h-4 w-4" /> {t("inc.submit_btn")}
          </Button>
        </div>
      </div>

      {/* Summary cards */}
      {counts.data && (
        <div className="grid gap-3 sm:grid-cols-4">
          {(Object.entries(STATUS_CFG) as [StatusKey, typeof STATUS_CFG[StatusKey]][]).map(([k, cfg]) => (
            <button
              key={k}
              onClick={() => setStatusFilter(statusFilter === k ? "all" : k)}
              className={cn(
                "rounded-xl border bg-card p-4 shadow-sm text-left transition-all hover:shadow-md",
                statusFilter === k ? "ring-2 ring-primary" : "border-border"
              )}
            >
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{cfg.label}</p>
              <p className={cn("mt-1 text-3xl font-bold", cfg.badge.split(" ").find(c => c.startsWith("text-")))}>
                {counts.data![k]}
              </p>
            </button>
          ))}
        </div>
      )}

      {/* Report form */}
      {showForm && (
        <div className="rounded-xl border border-border bg-card p-5 shadow-sm space-y-4 animate-in fade-in slide-in-from-top-2 duration-200">
          <h2 className="font-semibold text-destructive flex items-center gap-2">
            <AlertOctagon className="h-4 w-4" /> {t("inc.form_title")}
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>{t("inc.field_type")} <span className="text-destructive">*</span></Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {INCIDENT_TYPES.map((it) => (
                    <SelectItem key={it.value} value={it.value}>{it.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{t("inc.field_severity")} <span className="text-destructive">*</span></Label>
              <Select value={severity} onValueChange={(v) => setSeverity(v as SeverityKey)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(SEVERITY_CFG).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="sm:col-span-2 space-y-1.5">
              <Label>{t("inc.field_title")} <span className="text-destructive">*</span></Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("inc.title_ph")} autoFocus />
            </div>
            <div className="sm:col-span-2 space-y-1.5">
              <Label>{t("inc.field_desc")} <span className="text-destructive">*</span></Label>
              <textarea
                value={desc}
                onChange={(e) => setDesc(e.target.value)}
                placeholder={t("inc.desc_ph")}
                rows={4}
                className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-none"
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t("inc.field_location")}</Label>
              <Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder={t("inc.location_ph")} />
            </div>
            <div className="space-y-1.5">
              <Label>{t("inc.field_persons")}</Label>
              <Input value={persons} onChange={(e) => setPersons(e.target.value)} placeholder={t("inc.persons_ph")} />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" onClick={() => setShowForm(false)}>{t("common.cancel")}</Button>
            <Button
              onClick={report}
              disabled={busy || !title.trim() || !desc.trim()}
              className="bg-destructive hover:bg-destructive/90 text-destructive-foreground"
            >
              {busy ? t("common.loading") : t("inc.submit_btn")}
            </Button>
          </div>
        </div>
      )}

      {/* Status filter tabs */}
      <div className="flex gap-1 rounded-lg border border-border bg-secondary p-1 w-fit">
        {([
          ["all",          t("common2.all")],
          ["open",         t("inc.status_open")],
          ["under_review", t("inc.status_review")],
          ["resolved",     t("inc.status_resolved")],
          ["closed",       t("inc.status_closed")],
        ] as const).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setStatusFilter(k)}
            className={cn(
              "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
              statusFilter === k ? "bg-card shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Incident list */}
      {isLoading ? (
        <div className="py-12 text-center text-sm text-muted-foreground">{t("common.loading")}</div>
      ) : (incidents ?? []).length === 0 ? (
        <div className="rounded-xl border border-border bg-card py-16 text-center">
          <ShieldAlert className="mx-auto mb-3 h-10 w-10 text-muted-foreground/25" />
          <p className="text-sm font-medium text-muted-foreground">
            {statusFilter === "all" ? t("inc.empty") : t("inc.empty_filtered", { status: STATUS_CFG[statusFilter as StatusKey]?.label ?? statusFilter })}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {(incidents ?? []).map((inc: any) => {
            const sevCfg  = SEVERITY_CFG[inc.severity as SeverityKey] ?? SEVERITY_CFG.medium;
            const staCfg  = STATUS_CFG[inc.status as StatusKey]       ?? STATUS_CFG.open;
            const typeLabel = INCIDENT_TYPES.find((it) => it.value === inc.type)?.label ?? inc.type;
            const isOpen    = expandedId === inc.id;

            return (
              <div key={inc.id} className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
                {/* Card header */}
                <button
                  className="flex w-full items-start gap-3 p-4 text-left hover:bg-secondary/30 transition-colors"
                  onClick={() => setExpandedId(isOpen ? null : inc.id)}
                >
                  <span className={cn("mt-1 h-2.5 w-2.5 shrink-0 rounded-full", sevCfg.dot)} />
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide", sevCfg.badge)}>
                        {sevCfg.label}
                      </span>
                      <span className="text-xs text-muted-foreground">{typeLabel}</span>
                      <span className={cn("ml-auto rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase", staCfg.badge)}>
                        {staCfg.label}
                      </span>
                    </div>
                    <p className="font-semibold text-sm">{inc.title}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" /> {new Date(inc.created_at).toLocaleString()}
                      </span>
                      {inc.reporter?.email && (
                        <span>{t("inc.reported_by")}: {inc.reporter.email}</span>
                      )}
                      {inc.location && (
                        <span className="flex items-center gap-1">
                          <MapPin className="h-3 w-3" /> {inc.location}
                        </span>
                      )}
                    </div>
                  </div>
                  {isOpen ? <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />}
                </button>

                {/* Expanded detail */}
                {isOpen && (
                  <div className="border-t border-border px-5 pb-5 pt-4 space-y-4 animate-in fade-in duration-150">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">{t("inc.field_desc")}</p>
                      <p className="text-sm whitespace-pre-wrap">{inc.description}</p>
                    </div>
                    {inc.persons_involved && (
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5 flex items-center gap-1.5">
                          <Users className="h-3 w-3" /> {t("inc.field_persons")}
                        </p>
                        <p className="text-sm">{inc.persons_involved}</p>
                      </div>
                    )}
                    {inc.admin_notes && (
                      <div className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2.5">
                        <p className="text-xs font-semibold uppercase tracking-wide text-primary mb-1">{t("inc.admin_notes")}</p>
                        <p className="text-sm">{inc.admin_notes}</p>
                        {inc.reviewer?.email && (
                          <p className="mt-1 text-xs text-muted-foreground">— {inc.reviewer.email}</p>
                        )}
                      </div>
                    )}

                    {/* Status controls */}
                    {(isAdmin || inc.reported_by === user?.id) && inc.status !== "closed" && (
                      <div className="border-t border-border pt-4 space-y-3">
                        {isAdmin && (
                          <div className="space-y-1.5">
                            <Label className="text-xs">{t("inc.admin_notes_label")}</Label>
                            <Input
                              value={adminNote[inc.id] ?? ""}
                              onChange={(e) => setAdminNote((prev) => ({ ...prev, [inc.id]: e.target.value }))}
                              placeholder={t("inc.admin_notes_ph")}
                              className="h-9 text-sm"
                            />
                          </div>
                        )}
                        <div className="flex flex-wrap gap-2">
                          {inc.status === "open" && (
                            <Button size="sm" variant="outline" onClick={() => updateStatus(inc.id, "under_review")} disabled={reviewBusy === inc.id}>
                              {t("inc.mark_review")}
                            </Button>
                          )}
                          {(inc.status === "open" || inc.status === "under_review") && (
                            <Button size="sm" className="bg-success hover:bg-success/90 text-success-foreground" onClick={() => updateStatus(inc.id, "resolved")} disabled={reviewBusy === inc.id}>
                              <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" /> {t("inc.mark_resolved")}
                            </Button>
                          )}
                          {isAdmin && inc.status === "resolved" && (
                            <Button size="sm" variant="outline" onClick={() => updateStatus(inc.id, "closed")} disabled={reviewBusy === inc.id}>
                              {t("inc.close_btn")}
                            </Button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
