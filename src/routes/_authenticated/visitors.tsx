import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Download, UserPlus, XCircle, RefreshCw, Printer, CheckCircle2,
  CalendarClock, Building2, Clock, UserCheck, ShieldCheck, ArrowRight,
} from "lucide-react";
import { toast } from "sonner";
import { downloadVisitorPass, printVisitorPass, type VisitorPassData } from "@/lib/idcard";

export const Route = createFileRoute("/_authenticated/visitors")({
  component: VisitorsPage,
});

interface CreatedPass {
  id: string;
  code: string;
  full_name: string;
  host: string;
  expires_at: string;
  phone: string | null;
}

function VisitorsPage() {
  const { t } = useTranslation();
  const { user, loading } = useAuth();
  const qc = useQueryClient();

  const todayStr = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [activeTab, setActiveTab] = useState<"walkin" | "appointments">("walkin");

  // Plant 3 scope
  const { data: plant3 } = useQuery({
    queryKey: ["plant-3-default"],
    queryFn: async () => {
      const { data } = await supabase.from("plants").select("id, name").eq("code", "plant-3").maybeSingle();
      return data;
    },
  });

  // ── Form State ────────────────────────────────────────────────────────
  const [form, setForm] = useState({
    full_name:        "",
    company_name:     "",
    parent_phone:     "",
    id_number:        "",
    host_name:        "",
    host_department:  "",
    purpose:          "",
    expires_at:       todayStr,
    expires_time:     "17:00",
    appointment_id:   null as string | null,
  });

  const [busy,    setBusy]    = useState(false);
  const [created, setCreated] = useState<CreatedPass | null>(null);

  // ── Today's pre-registered appointments ───────────────────────────────
  const { data: todayAppts, isLoading: apptsLoading } = useQuery({
    queryKey: ["visitors-today-appointments", todayStr],
    refetchInterval: 30_000,
    queryFn: async () => {
      const start = new Date(todayStr + "T00:00:00").toISOString();
      const end   = new Date(todayStr + "T23:59:59").toISOString();
      const { data } = await supabase
        .from("appointments")
        .select("*")
        .gte("expected_at", start)
        .lte("expected_at", end)
        .in("status", ["pending", "confirmed"])
        .order("expected_at", { ascending: true });
      return data ?? [];
    },
    enabled: !!user,
  });

  // ── Visitor history (last 14 days) ────────────────────────────────────
  const { data: history, isLoading: histLoading } = useQuery({
    queryKey: ["visitor-history"],
    queryFn: async () => {
      const since = new Date(Date.now() - 14 * 86_400_000).toISOString();
      const { data } = await supabase
        .from("students")
        .select("id, admission_number, full_name, company_name, programme, notes, expires_at, status, created_at, parent_phone")
        .eq("is_visitor", true)
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(100);
      return data ?? [];
    },
    enabled: !!user,
  });

  if (loading) return null;

  // ── Preset expiry time helpers ────────────────────────────────────────
  const applyPreset = (hoursFromNow: number) => {
    const d = new Date(Date.now() + hoursFromNow * 3600 * 1000);
    const dateStr = d.toISOString().slice(0, 10);
    const timeStr = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    setForm((f) => ({ ...f, expires_at: dateStr, expires_time: timeStr }));
  };

  const applyEndOfDay = () => {
    setForm((f) => ({ ...f, expires_at: todayStr, expires_time: "17:00" }));
  };

  // ── Issue Pass (Walk-in or Pre-registered) ───────────────────────────
  const issuePass = async (overrideData?: {
    full_name: string;
    phone?: string | null;
    company_name?: string | null;
    host_name: string;
    host_department?: string | null;
    purpose?: string | null;
    id_number?: string | null;
    expires_at_iso?: string | null;
    appointment_id?: string | null;
  }) => {
    const name    = overrideData ? overrideData.full_name : form.full_name.trim();
    const phone   = overrideData ? overrideData.phone : form.parent_phone.trim();
    const host    = overrideData ? overrideData.host_name : form.host_name.trim();
    const dept    = overrideData ? overrideData.host_department : form.host_department.trim();
    const purpose = overrideData ? overrideData.purpose : form.purpose.trim();
    const company = overrideData ? overrideData.company_name : form.company_name.trim();
    const idDoc   = overrideData ? overrideData.id_number : form.id_number.trim();
    const apptId  = overrideData ? overrideData.appointment_id : form.appointment_id;

    if (!name) return toast.error(t("vis.name_required"));
    if (!host) return toast.error(t("vis.host_required"));
    if (!purpose) return toast.error(t("vis.purpose_required"));

    setBusy(true);
    try {
      const now  = new Date();
      const year = now.getFullYear();
      const seq  = String(now.getTime()).slice(-5);
      const code = `VIS/${year}/${seq}`;
      const expiresAt = overrideData?.expires_at_iso || `${form.expires_at}T${form.expires_time || "17:00"}:00`;

      const noteParts = [
        `Host: ${host}${dept ? ` (${dept})` : ""}`,
        `Purpose: ${purpose}`,
      ];
      if (idDoc) noteParts.push(`Govt ID: ${idDoc}`);
      if (company) noteParts.push(`Org: ${company}`);
      const notes = noteParts.join(" | ");

      const { data, error } = await supabase.from("students").insert({
        admission_number: code,
        barcode:          code,
        full_name:        name,
        category:         "visitor",
        is_visitor:       true,
        company_name:     company || null,
        programme:        dept ? `${dept} — ${purpose}` : purpose,
        nta_level:        "—",
        year_of_study:    1,
        status:           "active",
        plant_id:         plant3?.id || null,
        expires_at:       new Date(expiresAt).toISOString(),
        parent_phone:     phone || null,
        notes,
      }).select().single();

      if (error) throw error;

      // If linked to an appointment, mark arrived and set student reference
      if (apptId) {
        await supabase.from("appointments").update({
          status:       "arrived",
          student_id:   data.id,
          confirmed_by: user?.id ?? null,
          confirmed_at: new Date().toISOString(),
          updated_at:   new Date().toISOString(),
        }).eq("id", apptId);
        qc.invalidateQueries({ queryKey: ["appointments"] });
        qc.invalidateQueries({ queryKey: ["visitors-today-appointments"] });
      }

      setCreated({
        id:         data.id,
        code,
        full_name:  data.full_name,
        host:       `${host}${dept ? ` (${dept})` : ""}`,
        expires_at: expiresAt,
        phone:      phone || null,
      });

      // Reset form
      setForm({
        full_name:       "",
        company_name:    "",
        parent_phone:    "",
        id_number:       "",
        host_name:       "",
        host_department: "",
        purpose:         "",
        expires_at:      todayStr,
        expires_time:    "17:00",
        appointment_id:  null,
      });

      qc.invalidateQueries({ queryKey: ["visitor-history"] });
      toast.success(apptId ? t("vis.linked_appt_toast") : t("vis.toast_created"));
    } catch (e: any) {
      toast.error(e.message || "Failed to issue visitor pass");
    } finally {
      setBusy(false);
    }
  };

  const passData = (pass: CreatedPass): VisitorPassData => ({
    full_name:   pass.full_name,
    code:        pass.code,
    host:        pass.host,
    valid_until: pass.expires_at,
    phone:       pass.phone,
  });

  // ── Revoke a visitor pass ───────────────────────────────────────────
  const revoke = async (id: string, name: string) => {
    if (!confirm(t("vis.confirm_revoke", { name }))) return;
    const nowIso = new Date().toISOString();
    const { error } = await supabase
      .from("students")
      .update({ status: "suspended", expires_at: nowIso })
      .eq("id", id);
    if (error) return toast.error(error.message);
    toast.success(t("vis.revoked"));
    qc.invalidateQueries({ queryKey: ["visitor-history"] });
  };

  const isExpired = (date: string | null) => {
    if (!date) return false;
    const parsed = date.length <= 10 ? new Date(`${date}T23:59:59`) : new Date(date);
    return parsed < new Date();
  };

  return (
    <div className="space-y-8">
      {/* ── Page Header ── */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold">{t("vis.title")}</h1>
            <Badge variant="outline" className="border-primary/30 bg-primary/10 text-primary font-semibold text-xs">
              ABB Plant 3
            </Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{t("vis.subtitle")}</p>
        </div>
      </div>

      {/* ── Mode Selection & Issuance Area ── */}
      <div className="grid gap-6 lg:grid-cols-[1fr_auto]">
        <div className="space-y-4">
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)}>
            <TabsList className="grid w-full grid-cols-2 max-w-md">
              <TabsTrigger value="walkin" className="gap-2">
                <UserPlus className="h-4 w-4" /> {t("vis.tab_walkin")}
              </TabsTrigger>
              <TabsTrigger value="appointments" className="gap-2">
                <CalendarClock className="h-4 w-4" /> {t("vis.tab_appointments")}
                {(todayAppts?.length ?? 0) > 0 && (
                  <Badge variant="secondary" className="ml-1 px-1.5 py-0 text-[10px] font-bold">
                    {todayAppts?.length}
                  </Badge>
                )}
              </TabsTrigger>
            </TabsList>

            {/* ── TAB 1: WALKIN PASS ── */}
            <TabsContent value="walkin" className="mt-4">
              <div className="rounded-xl border border-border bg-card p-6 shadow-sm space-y-4 max-w-2xl">
                <div className="grid gap-4 sm:grid-cols-2">
                  {/* Visitor Full Name */}
                  <div className="sm:col-span-2 space-y-1.5">
                    <Label>{t("vis.label_name")} <span className="text-destructive">*</span></Label>
                    <Input
                      value={form.full_name}
                      onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))}
                      placeholder={t("vis.ph_name")}
                      className="text-base"
                    />
                  </div>

                  {/* Company / Organization */}
                  <div className="space-y-1.5">
                    <Label>{t("vis.label_company")}</Label>
                    <Input
                      value={form.company_name}
                      onChange={(e) => setForm((f) => ({ ...f, company_name: e.target.value }))}
                      placeholder={t("vis.ph_company")}
                    />
                  </div>

                  {/* Visitor Phone */}
                  <div className="space-y-1.5">
                    <Label>{t("vis.label_phone")}</Label>
                    <Input
                      type="tel"
                      value={form.parent_phone}
                      onChange={(e) => setForm((f) => ({ ...f, parent_phone: e.target.value }))}
                      placeholder={t("vis.ph_phone")}
                    />
                  </div>

                  {/* Government ID / Passport Number */}
                  <div className="space-y-1.5">
                    <Label>{t("vis.label_id_doc")}</Label>
                    <Input
                      value={form.id_number}
                      onChange={(e) => setForm((f) => ({ ...f, id_number: e.target.value }))}
                      placeholder={t("vis.ph_id_doc")}
                    />
                  </div>

                  {/* Host Name */}
                  <div className="space-y-1.5">
                    <Label>{t("vis.label_host")} <span className="text-destructive">*</span></Label>
                    <Input
                      value={form.host_name}
                      onChange={(e) => setForm((f) => ({ ...f, host_name: e.target.value }))}
                      placeholder={t("vis.ph_host")}
                    />
                  </div>

                  {/* Host Department */}
                  <div className="space-y-1.5">
                    <Label>{t("vis.label_dept")}</Label>
                    <Input
                      value={form.host_department}
                      onChange={(e) => setForm((f) => ({ ...f, host_department: e.target.value }))}
                      placeholder={t("vis.ph_dept")}
                    />
                  </div>

                  {/* Purpose of Visit */}
                  <div className="space-y-1.5">
                    <Label>{t("vis.label_purpose")} <span className="text-destructive">*</span></Label>
                    <Input
                      value={form.purpose}
                      onChange={(e) => setForm((f) => ({ ...f, purpose: e.target.value }))}
                      placeholder={t("vis.ph_purpose")}
                    />
                  </div>

                  {/* Pass Validity & Presets */}
                  <div className="sm:col-span-2 space-y-2 rounded-lg border border-border bg-secondary/30 p-3.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <Label className="text-xs font-semibold">{t("vis.label_valid")}</Label>
                      <div className="flex gap-1.5">
                        <Button type="button" variant="outline" size="sm" className="h-6 text-[11px] px-2" onClick={() => applyPreset(4)}>
                          {t("vis.preset_4h")}
                        </Button>
                        <Button type="button" variant="outline" size="sm" className="h-6 text-[11px] px-2" onClick={() => applyPreset(8)}>
                          {t("vis.preset_8h")}
                        </Button>
                        <Button type="button" variant="outline" size="sm" className="h-6 text-[11px] px-2" onClick={applyEndOfDay}>
                          {t("vis.preset_eod")}
                        </Button>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Input
                        type="date"
                        value={form.expires_at}
                        className="flex-1"
                        onChange={(e) => setForm((f) => ({ ...f, expires_at: e.target.value }))}
                      />
                      <Input
                        type="time"
                        value={form.expires_time}
                        className="w-28"
                        onChange={(e) => setForm((f) => ({ ...f, expires_time: e.target.value }))}
                      />
                    </div>
                    <p className="text-[11px] text-muted-foreground">{t("vis.valid_hint")}</p>
                  </div>
                </div>

                <div className="flex justify-end pt-2">
                  <Button
                    onClick={() => issuePass()}
                    disabled={busy || !form.full_name.trim() || !form.host_name.trim() || !form.purpose.trim()}
                    className="min-w-[170px]"
                  >
                    {busy ? t("vis.creating") : <><UserPlus className="mr-2 h-4 w-4" /> {t("vis.create_btn")}</>}
                  </Button>
                </div>
              </div>
            </TabsContent>

            {/* ── TAB 2: PRE-REGISTERED APPOINTMENTS ── */}
            <TabsContent value="appointments" className="mt-4">
              <div className="rounded-xl border border-border bg-card p-6 shadow-sm space-y-4 max-w-2xl">
                <div className="flex items-center justify-between border-b border-border pb-3">
                  <div>
                    <h3 className="font-semibold text-foreground text-sm">{t("vis.tab_appointments")}</h3>
                    <p className="text-xs text-muted-foreground">Expected arrivals scheduled for today at Plant 3</p>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => qc.invalidateQueries({ queryKey: ["visitors-today-appointments"] })}>
                    <RefreshCw className="h-3.5 w-3.5" />
                  </Button>
                </div>

                {apptsLoading ? (
                  <div className="py-8 text-center text-xs text-muted-foreground">{t("common.loading")}</div>
                ) : (todayAppts ?? []).length === 0 ? (
                  <div className="py-8 text-center text-xs text-muted-foreground space-y-2">
                    <CalendarClock className="h-8 w-8 mx-auto opacity-30" />
                    <p>{t("vis.appt_none_today")}</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {(todayAppts ?? []).map((app: any) => (
                      <div
                        key={app.id}
                        className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-lg border border-border bg-secondary/30 p-3.5 hover:bg-secondary/50 transition-colors"
                      >
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-sm text-foreground">{app.visitor_name}</span>
                            {app.visitor_phone && (
                              <span className="text-xs font-mono text-muted-foreground">({app.visitor_phone})</span>
                            )}
                          </div>
                          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                            <span>Host: <strong>{app.host_name}</strong> {app.host_department ? `(${app.host_department})` : ""}</span>
                            <span>•</span>
                            <span>Arrival: {new Date(app.expected_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                          </div>
                          {app.purpose && (
                            <p className="text-xs text-muted-foreground/80 italic">{app.purpose}</p>
                          )}
                        </div>

                        <Button
                          size="sm"
                          onClick={() => issuePass({
                            full_name:       app.visitor_name,
                            phone:           app.visitor_phone,
                            company_name:    app.visitor_email || "Scheduled Visitor",
                            host_name:       app.host_name,
                            host_department: app.host_department,
                            purpose:         app.purpose || "Scheduled Appointment",
                            expires_at_iso:  app.expires_at,
                            appointment_id:  app.id,
                          })}
                          disabled={busy}
                          className="shrink-0 gap-1.5"
                        >
                          <UserCheck className="h-3.5 w-3.5" /> {t("vis.appt_checkin_btn")}
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </TabsContent>
          </Tabs>
        </div>

        {/* ── Pass preview panel (shown after creation) ── */}
        {created && (
          <div className="flex flex-col items-center gap-4 rounded-xl border border-primary/30 bg-primary/[0.03] p-6 shadow-sm text-center min-w-[260px] self-start">
            <div className="flex items-center gap-2 text-sm font-semibold text-success">
              <CheckCircle2 className="h-5 w-5" />
              {t("vis.pass_created")}
            </div>
            <div className="w-full space-y-1.5 py-2">
              <p className="text-lg font-bold text-foreground leading-tight">{created.full_name}</p>
              <Badge variant="secondary" className="font-mono text-xs">
                {created.code}
              </Badge>
              <p className="text-xs text-muted-foreground pt-1">
                <strong>Host:</strong> {created.host}
              </p>
              <p className="text-xs text-muted-foreground">
                <strong>{t("vis.valid_until_label")}</strong>{" "}
                {created.expires_at.length > 10
                  ? new Date(created.expires_at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
                  : created.expires_at}
              </p>
            </div>
            <div className="flex flex-col gap-2 w-full pt-1">
              <Button size="sm" onClick={() => downloadVisitorPass(passData(created), "ABB Plant 3 — Industrial Security Gate")}>
                <Download className="mr-2 h-3.5 w-3.5" /> {t("vis.download_btn")}
              </Button>
              <Button size="sm" variant="outline" onClick={() => printVisitorPass(passData(created), "ABB Plant 3 — Industrial Security Gate")}>
                <Printer className="mr-2 h-3.5 w-3.5" /> {t("vis.print_btn")}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setCreated(null)}>
                {t("vis.new_pass")}
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* ── Visitor history table (last 14 days) ── */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">{t("vis.history_title")}</h2>
            <p className="text-xs text-muted-foreground">{t("vis.history_sub")}</p>
          </div>
          <Button size="sm" variant="outline" onClick={() => qc.invalidateQueries({ queryKey: ["visitor-history"] })}>
            <RefreshCw className="mr-2 h-3.5 w-3.5" /> {t("common2.refresh")}
          </Button>
        </div>

        <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
          {histLoading ? (
            <div className="px-5 py-10 text-center text-sm text-muted-foreground">{t("common.loading")}</div>
          ) : (history ?? []).length === 0 ? (
            <div className="px-5 py-10 text-center text-sm text-muted-foreground">
              {t("vis.empty")}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-secondary text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 text-left">{t("vis.col_name")}</th>
                    <th className="px-4 py-3 text-left">{t("vis.col_code")}</th>
                    <th className="px-4 py-3 text-left hidden sm:table-cell">{t("vis.col_company")}</th>
                    <th className="px-4 py-3 text-left">{t("vis.col_host")}</th>
                    <th className="px-4 py-3 text-left">{t("vis.col_valid")}</th>
                    <th className="px-4 py-3 text-left">{t("vis.col_status")}</th>
                    <th className="px-4 py-3 text-right">{t("vis.col_actions")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {(history ?? []).map((v: any) => {
                    const expired = isExpired(v.expires_at);
                    const revoked = v.status === "suspended";
                    const active  = !expired && !revoked;
                    return (
                      <tr key={v.id} className="hover:bg-secondary/40 transition-colors">
                        <td className="px-4 py-3 font-medium">
                          {v.full_name}
                          {v.parent_phone && (
                            <p className="text-[11px] text-muted-foreground font-mono">{v.parent_phone}</p>
                          )}
                        </td>
                        <td className="px-4 py-3 font-mono text-xs font-semibold">{v.admission_number}</td>
                        <td className="px-4 py-3 text-muted-foreground text-xs hidden sm:table-cell">
                          {v.company_name || "—"}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground text-xs">{v.programme || "—"}</td>
                        <td className="px-4 py-3 text-xs font-mono">
                          {v.expires_at
                            ? v.expires_at.length > 10
                              ? new Date(v.expires_at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
                              : v.expires_at
                            : "—"}
                        </td>
                        <td className="px-4 py-3">
                          {revoked  ? <Badge variant="destructive">{t("vis.status_revoked")}</Badge>
                          : expired ? <Badge variant="secondary">{t("vis.status_expired")}</Badge>
                          :           <Badge className="bg-success text-success-foreground">{t("vis.status_active")}</Badge>}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex justify-end gap-1.5">
                            <Button
                              size="sm" variant="outline" title={t("vis.download_btn")}
                              onClick={() => downloadVisitorPass({
                                full_name:   v.full_name,
                                code:        v.admission_number,
                                host:        v.programme ?? "",
                                valid_until: v.expires_at ?? "",
                                phone:       v.parent_phone,
                              }, "ABB Plant 3 — Industrial Security Gate")}
                            >
                              <Download className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              size="sm" variant="outline" title={t("vis.print_btn")}
                              onClick={() => printVisitorPass({
                                full_name:   v.full_name,
                                code:        v.admission_number,
                                host:        v.programme ?? "",
                                valid_until: v.expires_at ?? "",
                                phone:       v.parent_phone,
                              }, "ABB Plant 3 — Industrial Security Gate")}
                            >
                              <Printer className="h-3.5 w-3.5" />
                            </Button>
                            {active && (
                              <Button
                                size="sm" variant="outline"
                                className="text-destructive hover:text-destructive"
                                title="Revoke Pass"
                                onClick={() => revoke(v.id, v.full_name)}
                              >
                                <XCircle className="h-3.5 w-3.5" />
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
