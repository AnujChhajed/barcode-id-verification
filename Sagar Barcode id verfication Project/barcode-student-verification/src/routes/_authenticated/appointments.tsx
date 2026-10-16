import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  CalendarClock, Plus, UserCheck, UserX, X, Clock,
  Phone, Mail, Building2, RefreshCw, CheckCircle2,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/appointments")({
  component: AppointmentsPage,
});

type AppStatus = "pending" | "confirmed" | "arrived" | "no_show" | "cancelled";

function localDateStr(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function AppointmentsPage() {
  const { t } = useTranslation();
  const { user, isAdmin } = useAuth();
  const qc = useQueryClient();

  const STATUS_CFG: Record<AppStatus, { label: string; badge: string }> = {
    pending:   { label: t("appt.status_pending"),   badge: "bg-secondary text-muted-foreground"   },
    confirmed: { label: t("appt.status_confirmed"),  badge: "bg-primary/10 text-primary"            },
    arrived:   { label: t("appt.status_arrived"),    badge: "bg-success/15 text-success"            },
    no_show:   { label: t("appt.status_noshow"),     badge: "bg-warning/15 text-warning"            },
    cancelled: { label: t("appt.status_cancelled"),  badge: "bg-destructive/15 text-destructive"    },
  };

  const todayStr = localDateStr(new Date());
  const [tab,        setTab]        = useState<"today" | "upcoming" | "past">("today");
  const [showForm,   setShowForm]   = useState(false);
  const [actionBusy, setActionBusy] = useState<string | null>(null);

  // Form state
  const [visitorName,   setVisitorName]   = useState("");
  const [visitorPhone,  setVisitorPhone]  = useState("");
  const [visitorEmail,  setVisitorEmail]  = useState("");
  const [hostName,      setHostName]      = useState("");
  const [hostDept,      setHostDept]      = useState("");
  const [purpose,       setPurpose]       = useState("");
  const [expectedAt,    setExpectedAt]    = useState("");
  const [expiresAt,     setExpiresAt]     = useState(todayStr);
  const [notes,         setNotes]         = useState("");
  const [formBusy,      setFormBusy]      = useState(false);

  const { data: appointments, isLoading, refetch } = useQuery({
    queryKey: ["appointments", tab],
    refetchInterval: tab === "today" ? 30_000 : undefined,
    queryFn: async () => {
      let q = supabase
        .from("appointments")
        .select("*, creator:created_by(email), confirmer:confirmed_by(email)")
        .order("expected_at", { ascending: tab !== "past" });

      if (tab === "today") {
        const start = new Date(todayStr + "T00:00:00").toISOString();
        const end   = new Date(todayStr + "T23:59:59").toISOString();
        q = q.gte("expected_at", start).lte("expected_at", end);
      } else if (tab === "upcoming") {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(0, 0, 0, 0);
        q = q.gte("expected_at", tomorrow.toISOString());
      } else {
        const todayStart = new Date(todayStr + "T00:00:00").toISOString();
        q = q.lt("expected_at", todayStart);
      }
      const { data } = await q.limit(100);
      return data ?? [];
    },
  });

  const todayCount  = useMemo(() => (appointments ?? []).filter((a: any) => a.status !== "cancelled").length, [appointments]);
  const pendingToday = useMemo(() => (appointments ?? []).filter((a: any) => a.status === "pending" || a.status === "confirmed").length, [appointments]);

  const createAppointment = async () => {
    if (!visitorName.trim() || !hostName.trim() || !expectedAt) {
      toast.error("Visitor name, host name, and expected arrival time are required");
      return;
    }
    setFormBusy(true);
    const { error } = await supabase.from("appointments").insert({
      visitor_name:    visitorName.trim(),
      visitor_phone:   visitorPhone.trim()  || null,
      visitor_email:   visitorEmail.trim()  || null,
      host_name:       hostName.trim(),
      host_department: hostDept.trim()      || null,
      purpose:         purpose.trim()       || null,
      expected_at:     new Date(expectedAt).toISOString(),
      expires_at:      new Date(expiresAt + "T23:59:59").toISOString(),
      notes:           notes.trim()         || null,
      created_by:      user?.id ?? null,
    });
    setFormBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success(t("appt.registered"));
    setVisitorName(""); setVisitorPhone(""); setVisitorEmail("");
    setHostName(""); setHostDept(""); setPurpose(""); setNotes("");
    setExpectedAt(""); setExpiresAt(todayStr);
    setShowForm(false);
    qc.invalidateQueries({ queryKey: ["appointments"] });
  };

  const confirmArrival = async (app: any) => {
    setActionBusy(app.id);
    try {
      // Issue a visitor pass
      const code = `VIS-${Date.now().toString(36).toUpperCase()}`;
      const { data: vis, error: visErr } = await supabase
        .from("students")
        .insert({
          admission_number:  code,
          barcode:           code,
          full_name:         app.visitor_name,
          programme:         app.purpose || "Visitor",
          nta_level:         "—",
          year_of_study:     1,
          status:            "active",
          is_visitor:        true,
          expires_at:        app.expires_at,
          parent_phone:      app.visitor_phone || null,
        })
        .select("id")
        .single();
      if (visErr) throw visErr;

      // Update appointment
      const { error } = await supabase
        .from("appointments")
        .update({
          status:       "arrived",
          confirmed_by: user?.id,
          confirmed_at: new Date().toISOString(),
          student_id:   vis.id,
          updated_at:   new Date().toISOString(),
        })
        .eq("id", app.id);
      if (error) throw error;

      toast.success(t("appt.pass_issued", { code }));
      qc.invalidateQueries({ queryKey: ["appointments"] });
    } catch (e: any) {
      toast.error(e.message || "Failed to confirm arrival");
    } finally {
      setActionBusy(null);
    }
  };

  const updateStatus = async (id: string, status: AppStatus) => {
    setActionBusy(id);
    const { error } = await supabase
      .from("appointments")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", id);
    setActionBusy(null);
    if (error) { toast.error(error.message); return; }
    toast.success("Updated");
    qc.invalidateQueries({ queryKey: ["appointments"] });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{t("appt.title")}</h1>
          <p className="text-sm text-muted-foreground">
            {tab === "today" && pendingToday > 0
              ? t("appt.pending_today", { count: pendingToday })
              : t("appt.subtitle")}
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => refetch()}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> {t("common2.refresh")}
          </Button>
          <Button size="sm" onClick={() => setShowForm((s) => !s)}>
            <Plus className="mr-1.5 h-4 w-4" /> {t("appt.register_btn")}
          </Button>
        </div>
      </div>

      {/* Today alert */}
      {tab === "today" && pendingToday > 0 && (
        <div className="flex items-center gap-3 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3 text-sm text-primary">
          <CalendarClock className="h-4 w-4 shrink-0" />
          <span>{t("appt.today_alert", { count: pendingToday })}</span>
        </div>
      )}

      {/* Create form */}
      {showForm && (
        <div className="rounded-xl border border-border bg-card p-5 shadow-sm space-y-4 animate-in fade-in slide-in-from-top-2 duration-200">
          <h2 className="font-semibold">{t("appt.register_btn")}</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>{t("appt.visitor_name")} <span className="text-destructive">*</span></Label>
              <Input value={visitorName} onChange={(e) => setVisitorName(e.target.value)} placeholder={t("common.name")} autoFocus />
            </div>
            <div className="space-y-1.5">
              <Label>{t("appt.host_name")} <span className="text-destructive">*</span></Label>
              <Input value={hostName} onChange={(e) => setHostName(e.target.value)} placeholder={t("appt.host_ph")} />
            </div>
            <div className="space-y-1.5">
              <Label>{t("appt.visitor_phone")}</Label>
              <Input value={visitorPhone} onChange={(e) => setVisitorPhone(e.target.value)} placeholder="+255 xxx xxx xxx" />
            </div>
            <div className="space-y-1.5">
              <Label>{t("appt.visitor_email")}</Label>
              <Input type="email" value={visitorEmail} onChange={(e) => setVisitorEmail(e.target.value)} placeholder="visitor@example.com" />
            </div>
            <div className="space-y-1.5">
              <Label>{t("appt.host_dept")}</Label>
              <Input value={hostDept} onChange={(e) => setHostDept(e.target.value)} placeholder={t("appt.host_dept_ph")} />
            </div>
            <div className="space-y-1.5">
              <Label>{t("appt.purpose")}</Label>
              <Input value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder={t("appt.purpose_ph")} />
            </div>
            <div className="space-y-1.5">
              <Label>{t("appt.expected_arrival")} <span className="text-destructive">*</span></Label>
              <Input type="datetime-local" value={expectedAt} onChange={(e) => setExpectedAt(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>{t("appt.pass_valid_until")}</Label>
              <Input type="date" value={expiresAt} min={todayStr} onChange={(e) => setExpiresAt(e.target.value)} />
            </div>
            <div className="sm:col-span-2 space-y-1.5">
              <Label>{t("appt.notes")}</Label>
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t("appt.notes_ph")} />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" onClick={() => setShowForm(false)}>{t("common.cancel")}</Button>
            <Button onClick={createAppointment} disabled={formBusy || !visitorName.trim() || !hostName.trim() || !expectedAt}>
              {formBusy ? t("common.loading") : t("appt.register_btn")}
            </Button>
          </div>
        </div>
      )}

      {/* Tab switcher */}
      <div className="flex gap-1 rounded-lg border border-border bg-secondary p-1 w-fit">
        {([
          { key: "today",    label: t("appt.tab_today") },
          { key: "upcoming", label: t("appt.tab_upcoming") },
          { key: "past",     label: t("appt.tab_past") },
        ] as const).map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={cn(
              "rounded-md px-4 py-1.5 text-xs font-medium capitalize transition-colors",
              tab === key ? "bg-card shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {/* List */}
      {isLoading ? (
        <div className="py-12 text-center text-sm text-muted-foreground">{t("common.loading")}</div>
      ) : (appointments ?? []).length === 0 ? (
        <div className="rounded-xl border border-border bg-card py-16 text-center">
          <CalendarClock className="mx-auto mb-3 h-10 w-10 text-muted-foreground/25" />
          <p className="text-sm font-medium text-muted-foreground">
            {tab === "today" ? t("appt.empty_today") : tab === "upcoming" ? t("appt.empty_upcoming") : t("appt.empty_past")}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {(appointments ?? []).map((app: any) => {
            const staCfg = STATUS_CFG[app.status as AppStatus] ?? STATUS_CFG.pending;
            const canAct = app.status === "pending" || app.status === "confirmed";
            return (
              <div key={app.id} className={cn(
                "rounded-xl border bg-card p-4 shadow-sm transition-all",
                app.status === "arrived"   && "border-success/30  bg-success/5",
                app.status === "no_show"   && "border-warning/30  opacity-70",
                app.status === "cancelled" && "border-border       opacity-50",
              )}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold">{app.visitor_name}</p>
                      <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide", staCfg.badge)}>
                        {staCfg.label}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {new Date(app.expected_at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
                      </span>
                      <span className="flex items-center gap-1">
                        <Building2 className="h-3 w-3" />
                        {app.host_name}{app.host_department ? ` · ${app.host_department}` : ""}
                      </span>
                      {app.visitor_phone && (
                        <span className="flex items-center gap-1">
                          <Phone className="h-3 w-3" /> {app.visitor_phone}
                        </span>
                      )}
                      {app.visitor_email && (
                        <span className="flex items-center gap-1">
                          <Mail className="h-3 w-3" /> {app.visitor_email}
                        </span>
                      )}
                      {app.purpose && <span>{t("appt.purpose")}: {app.purpose}</span>}
                    </div>
                    {app.confirmed_at && (
                      <p className="text-xs text-success flex items-center gap-1">
                        <CheckCircle2 className="h-3 w-3" />
                        Arrived {new Date(app.confirmed_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        {app.confirmer?.email && ` · by ${app.confirmer.email}`}
                      </p>
                    )}
                    {app.notes && <p className="text-xs text-muted-foreground italic">{app.notes}</p>}
                  </div>

                  {/* Actions */}
                  {canAct && (
                    <div className="flex flex-wrap gap-2 shrink-0">
                      <Button
                        size="sm"
                        className="bg-success hover:bg-success/90 text-success-foreground"
                        onClick={() => confirmArrival(app)}
                        disabled={actionBusy === app.id}
                      >
                        <UserCheck className="mr-1.5 h-3.5 w-3.5" />
                        {actionBusy === app.id ? "…" : t("appt.confirm_btn")}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => updateStatus(app.id, "no_show")}
                        disabled={actionBusy === app.id}
                        className="text-warning border-warning/40 hover:bg-warning/10"
                      >
                        <UserX className="mr-1.5 h-3.5 w-3.5" /> {t("appt.status_noshow")}
                      </Button>
                      {isAdmin && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => updateStatus(app.id, "cancelled")}
                          disabled={actionBusy === app.id}
                          className="text-destructive border-destructive/30 hover:bg-destructive/10"
                        >
                          <X className="mr-1.5 h-3.5 w-3.5" /> {t("common.cancel")}
                        </Button>
                      )}
                    </div>
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
