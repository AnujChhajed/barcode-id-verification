import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Download, UserPlus, XCircle, RefreshCw, Printer, CheckCircle } from "lucide-react";
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

  const defaultDate = () => new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  const [form, setForm] = useState({
    full_name:    "",
    reason:       "",
    parent_phone: "",
    expires_at:   defaultDate(),
    expires_time: "17:00",
  });
  const [busy,    setBusy]    = useState(false);
  const [created, setCreated] = useState<CreatedPass | null>(null);

  // ── Visitor history (last 14 days) ────────────────────────────────────
  const { data: history, isLoading: histLoading } = useQuery({
    queryKey: ["visitor-history"],
    queryFn: async () => {
      const since = new Date(Date.now() - 14 * 86_400_000).toISOString();
      const { data } = await supabase
        .from("students")
        .select("id, admission_number, full_name, programme, expires_at, status, created_at, parent_phone")
        .eq("is_visitor", true)
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(100);
      return data ?? [];
    },
    enabled: !!user,
  });

  if (loading) return null;

  // ── Create pass ───────────────────────────────────────────────────────
  const create = async () => {
    if (!form.full_name.trim()) return toast.error(t("vis.name_required"));
    setBusy(true);
    const now  = new Date();
    const year = now.getFullYear();
    const seq  = String(now.getTime()).slice(-5);
    const code = `VIS/${year}/${seq}`;
    const expiresAt = `${form.expires_at}T${form.expires_time || "23:59"}`;
    const { data, error } = await supabase.from("students").insert({
      admission_number: code,
      barcode:          code,
      full_name:        form.full_name.trim(),
      programme:        form.reason || "Visitor",
      nta_level:        "—",
      year_of_study:    1,
      status:           "active",
      is_visitor:       true,
      expires_at:       expiresAt,
      parent_phone:     form.parent_phone || null,
      notes:            form.reason || null,
    }).select().single();
    setBusy(false);
    if (error) return toast.error(error.message);

    setCreated({
      id:         data.id,
      code,
      full_name:  data.full_name,
      host:       form.reason,
      expires_at: expiresAt,
      phone:      form.parent_phone || null,
    });

    // Reset form
    setForm({ full_name: "", reason: "", parent_phone: "", expires_at: defaultDate(), expires_time: "17:00" });
    qc.invalidateQueries({ queryKey: ["visitor-history"] });
    toast.success(t("vis.pass_created"));
  };

  const passData = (pass: CreatedPass): VisitorPassData => ({
    full_name:   pass.full_name,
    code:        pass.code,
    host:        pass.host,
    valid_until: pass.expires_at,
    phone:       pass.phone,
  });

  // ── Revoke a visitor pass (set status=suspended + expires_at=today) ──
  const revoke = async (id: string, name: string) => {
    if (!confirm(t("vis.confirm_revoke", { name }))) return;
    const today = new Date().toISOString().slice(0, 10);
    const { error } = await supabase
      .from("students")
      .update({ status: "suspended", expires_at: today })
      .eq("id", id);
    if (error) return toast.error(error.message);
    toast.success(t("vis.revoked"));
    qc.invalidateQueries({ queryKey: ["visitor-history"] });
  };

  const isExpired = (date: string | null) => {
    if (!date) return false;
    // Date-only strings (YYYY-MM-DD) expire at end of that day in local time.
    const parsed = date.length <= 10 ? new Date(`${date}T23:59:59`) : new Date(date);
    return parsed < new Date();
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">{t("vis.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("vis.subtitle")}</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_auto]">

        {/* ── Creation form ── */}
        <div className="max-w-xl space-y-4 rounded-xl border border-border bg-card p-6 shadow-sm">
          <div className="space-y-1.5">
            <Label>{t("vis.field_name")} <span className="text-destructive">*</span></Label>
            <Input value={form.full_name} onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))}
              placeholder={t("vis.name_ph")} />
          </div>
          <div className="space-y-1.5">
            <Label>{t("vis.field_reason")}</Label>
            <Input value={form.reason} onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
              placeholder={t("vis.reason_ph")} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>{t("vis.field_phone")}</Label>
              <Input value={form.parent_phone}
                onChange={(e) => setForm((f) => ({ ...f, parent_phone: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>{t("vis.field_valid_until")}</Label>
              <div className="flex gap-2">
                <Input type="date" value={form.expires_at} className="flex-1"
                  onChange={(e) => setForm((f) => ({ ...f, expires_at: e.target.value }))} />
                <Input type="time" value={form.expires_time} className="w-28"
                  onChange={(e) => setForm((f) => ({ ...f, expires_time: e.target.value }))} />
              </div>
            </div>
          </div>
          <div className="flex justify-end pt-2">
            <Button onClick={create} disabled={busy || !form.full_name.trim()}>
              {busy ? t("common.loading") : <><UserPlus className="mr-2 h-4 w-4" /> {t("vis.create_btn")}</>}
            </Button>
          </div>
        </div>

        {/* ── QR preview panel (shown after creation) ── */}
        {created && (
          <div className="flex flex-col items-center gap-4 rounded-xl border border-border bg-card p-6 shadow-sm text-center min-w-[240px]">
            <div className="flex items-center gap-2 text-sm font-semibold text-success">
              <CheckCircle className="h-4 w-4" />
              {t("vis.pass_created")}
            </div>
            <div className="w-full space-y-1">
              <p className="font-semibold text-foreground">{created.full_name}</p>
              <p className="font-mono text-xs text-muted-foreground">{created.code}</p>
              <p className="text-xs text-muted-foreground">
                {t("vis.valid_until_label")}:{" "}
                {created.expires_at.length > 10
                  ? new Date(created.expires_at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
                  : created.expires_at}
              </p>
            </div>
            <div className="flex flex-col gap-2 w-full">
              <Button size="sm" onClick={() => downloadVisitorPass(passData(created))}>
                <Download className="mr-2 h-3.5 w-3.5" /> {t("vis.download_btn")}
              </Button>
              <Button size="sm" variant="outline" onClick={() => printVisitorPass(passData(created))}>
                <Printer className="mr-2 h-3.5 w-3.5" /> {t("vis.print_btn")}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setCreated(null)}>
                {t("vis.new_pass")}
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* ── Visitor history ─────────────────────────────────────────────── */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">{t("vis.history_title")}</h2>
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
            <table className="w-full text-sm">
              <thead className="bg-secondary text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 text-left">{t("common.name")}</th>
                  <th className="px-4 py-3 text-left">{t("vis.col_code")}</th>
                  <th className="px-4 py-3 text-left">{t("vis.col_host")}</th>
                  <th className="px-4 py-3 text-left">{t("vis.field_valid_until")}</th>
                  <th className="px-4 py-3 text-left">{t("common.status")}</th>
                  <th className="px-4 py-3 text-right">{t("common.actions")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {(history ?? []).map((v) => {
                  const expired  = isExpired(v.expires_at);
                  const revoked  = v.status === "suspended";
                  const active   = !expired && !revoked;
                  return (
                    <tr key={v.id} className="hover:bg-secondary/40">
                      <td className="px-4 py-3 font-medium">{v.full_name}</td>
                      <td className="px-4 py-3 font-mono text-xs">{v.admission_number}</td>
                      <td className="px-4 py-3 text-muted-foreground text-xs">{v.programme || "—"}</td>
                      <td className="px-4 py-3 text-xs">
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
                        <div className="flex justify-end gap-2">
                          <Button
                            size="sm" variant="outline" title={t("vis.download_btn")}
                            onClick={() => downloadVisitorPass({
                              full_name:   v.full_name,
                              code:        v.admission_number,
                              host:        v.programme ?? "",
                              valid_until: v.expires_at ?? "",
                              phone:       v.parent_phone,
                            })}
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
                            })}
                          >
                            <Printer className="h-3.5 w-3.5" />
                          </Button>
                          {active && (
                            <Button
                              size="sm" variant="outline"
                              className="text-destructive hover:text-destructive"
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
          )}
        </div>
      </div>
    </div>
  );
}
