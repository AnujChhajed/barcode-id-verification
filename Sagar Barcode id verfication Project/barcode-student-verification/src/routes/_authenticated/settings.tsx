import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/settings")({
  component: SettingsPage,
});

function SettingsPage() {
  const { t } = useTranslation();
  const { isAdmin, loading } = useAuth();

  const DAYS = [
    { label: t("settings.day_su"), full: t("settings.day_sunday"),    value: 0 },
    { label: t("settings.day_mo"), full: t("settings.day_monday"),    value: 1 },
    { label: t("settings.day_tu"), full: t("settings.day_tuesday"),   value: 2 },
    { label: t("settings.day_we"), full: t("settings.day_wednesday"), value: 3 },
    { label: t("settings.day_th"), full: t("settings.day_thursday"),  value: 4 },
    { label: t("settings.day_fr"), full: t("settings.day_friday"),    value: 5 },
    { label: t("settings.day_sa"), full: t("settings.day_saturday"),  value: 6 },
  ];
  const { data, refetch } = useQuery({
    queryKey: ["settings"],
    enabled: isAdmin,
    queryFn: async () => (await supabase.from("settings").select("*")).data ?? [],
  });

  // ── General ─────────────────────────────────────────────────────────────
  const [collegeName,      setCollegeName]      = useState("");
  const [timeout_,         setTimeout_]         = useState("30");
  const [showPhoto,        setShowPhoto]         = useState(true);
  const [antiPassback,     setAntiPassback]      = useState("15");
  const [denialThreshold,  setDenialThreshold]   = useState("5");
  const [notifyParents,    setNotifyParents]      = useState(false);
  const [defaultDir,       setDefaultDir]        = useState<"in" | "out">("in");

  // ── Access hours ─────────────────────────────────────────────────────────
  const [accessEnabled,    setAccessEnabled]     = useState(false);
  const [accessStart,      setAccessStart]       = useState("06:00");
  const [accessEnd,        setAccessEnd]         = useState("22:00");
  const [accessDays,       setAccessDays]        = useState<number[]>([1, 2, 3, 4, 5, 6]);

  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!data) return;
    const get = (k: string) => data.find((s) => s.key === k)?.value;

    setCollegeName(String(get("college_name")            ?? "").replace(/^"|"$/g, ""));
    setTimeout_(String(get("session_timeout_minutes")    ?? "30"));
    setShowPhoto(get("show_photo_on_scan")               !== false);
    setAntiPassback(String(get("anti_passback_seconds")  ?? "15"));
    setDenialThreshold(String(get("denial_alert_threshold") ?? "5"));
    setNotifyParents(get("notify_parents_enabled")       === true);
    setDefaultDir((String(get("default_direction")       ?? '"in"').replace(/"/g, "") as "in" | "out") || "in");

    setAccessEnabled(get("access_hours_enabled")         === true);
    setAccessStart(String(get("access_hours_start")      ?? '"06:00"').replace(/"/g, ""));
    setAccessEnd(String(get("access_hours_end")          ?? '"22:00"').replace(/"/g, ""));
    const rawDays = get("access_days_of_week");
    if (Array.isArray(rawDays)) setAccessDays(rawDays as number[]);
  }, [data]);

  if (loading) return null;
  if (!isAdmin) return <Navigate to="/verify" />;

  const toggleDay = (day: number) =>
    setAccessDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort()
    );

  const save = async () => {
    setSaving(true);
    const tout = Number(timeout_);
    if (tout < 5 || tout > 480) {
      toast.error(t("settings.timeout_error"));
      setSaving(false);
      return;
    }
    const updates = [
      { key: "college_name",            value: JSON.stringify(collegeName) },
      { key: "session_timeout_minutes", value: tout },
      { key: "show_photo_on_scan",      value: showPhoto },
      { key: "anti_passback_seconds",   value: Number(antiPassback) },
      { key: "denial_alert_threshold",  value: Number(denialThreshold) },
      { key: "notify_parents_enabled",  value: notifyParents },
      { key: "default_direction",       value: JSON.stringify(defaultDir) },
      { key: "access_hours_enabled",    value: accessEnabled },
      { key: "access_hours_start",      value: JSON.stringify(accessStart) },
      { key: "access_hours_end",        value: JSON.stringify(accessEnd) },
      { key: "access_days_of_week",     value: accessDays },
    ];
    for (const u of updates) {
      await supabase.from("settings").upsert({ key: u.key, value: u.value as any });
    }
    toast.success(t("settings.saved"));
    setSaving(false);
    refetch();
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t("settings.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("settings.subtitle")}</p>
      </div>

      <div className="grid max-w-2xl gap-8">

        {/* ── General ── */}
        <section className="rounded-xl border border-border bg-card p-6 shadow-sm space-y-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{t("settings.sec_general")}</h2>

          <div className="space-y-1.5">
            <Label>{t("settings.label_college")}</Label>
            <Input value={collegeName} onChange={(e) => setCollegeName(e.target.value)} />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>{t("settings.label_timeout")}</Label>
              <Input type="number" min={5} max={480} value={timeout_}
                onChange={(e) => setTimeout_(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>{t("settings.label_default_dir")}</Label>
              <Select value={defaultDir} onValueChange={(v) => setDefaultDir(v as any)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="in">{t("common2.entry")}</SelectItem>
                  <SelectItem value="out">{t("common2.exit")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{t("settings.label_passback")}</Label>
              <Input type="number" min={0} max={300} value={antiPassback}
                onChange={(e) => setAntiPassback(e.target.value)} />
              <p className="text-xs text-muted-foreground">{t("settings.passback_hint")}</p>
            </div>
            <div className="space-y-1.5">
              <Label>{t("settings.label_denial_threshold")}</Label>
              <Input type="number" min={1} value={denialThreshold}
                onChange={(e) => setDenialThreshold(e.target.value)} />
              <p className="text-xs text-muted-foreground">{t("settings.denial_hint")}</p>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <Label>{t("settings.label_show_photo")}</Label>
              <p className="text-xs text-muted-foreground">{t("settings.show_photo_hint")}</p>
            </div>
            <Switch checked={showPhoto} onCheckedChange={setShowPhoto} />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <Label>{t("settings.label_notify_parents")}</Label>
              <p className="text-xs text-muted-foreground">{t("settings.notify_parents_hint")}</p>
            </div>
            <Switch checked={notifyParents} onCheckedChange={setNotifyParents} />
          </div>
        </section>

        {/* ── Access hours ── */}
        <section className="rounded-xl border border-border bg-card p-6 shadow-sm space-y-5">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                {t("settings.sec_hours")}
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                {t("settings.hours_hint")}
              </p>
            </div>
            <Switch checked={accessEnabled} onCheckedChange={setAccessEnabled} />
          </div>

          <div className={cn("space-y-5 transition-opacity duration-200", !accessEnabled && "pointer-events-none opacity-40")}>
            {/* Time range */}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>{t("settings.label_opens")}</Label>
                <Input type="time" value={accessStart}
                  onChange={(e) => setAccessStart(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>{t("settings.label_closes")}</Label>
                <Input type="time" value={accessEnd}
                  onChange={(e) => setAccessEnd(e.target.value)} />
              </div>
            </div>

            {/* Day-of-week picker */}
            <div className="space-y-2">
              <Label>{t("settings.label_days")}</Label>
              <div className="flex gap-1.5 flex-wrap">
                {DAYS.map((d) => {
                  const active = accessDays.includes(d.value);
                  return (
                    <button
                      key={d.value}
                      type="button"
                      title={d.full}
                      onClick={() => toggleDay(d.value)}
                      className={cn(
                        "h-9 w-9 rounded-lg text-xs font-semibold border transition-all duration-150",
                        active
                          ? "bg-primary text-primary-foreground border-primary"
                          : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground"
                      )}
                    >
                      {d.label}
                    </button>
                  );
                })}
              </div>
              <p className="text-xs text-muted-foreground">
                {accessDays.length === 0
                  ? t("settings.no_days_warning")
                  : `${accessDays.map((d) => DAYS[d].full).join(", ")}`}
              </p>
            </div>

            <div className="rounded-lg bg-muted px-4 py-3 text-sm text-muted-foreground">
              <span className="font-medium text-foreground">{t("settings.preview_label")}: </span>
              {t("settings.preview_text", {
                start: accessStart,
                end:   accessEnd,
                days:  accessDays.length === 7
                  ? t("settings.every_day")
                  : accessDays.map((d) => DAYS[d].label).join(", "),
              })}
            </div>
          </div>
        </section>

        <div className="flex justify-end">
          <Button onClick={save} disabled={saving}>{saving ? t("common.loading") : t("settings.save_btn")}</Button>
        </div>
      </div>
    </div>
  );
}
