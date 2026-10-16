import { createFileRoute } from "@tanstack/react-router";
import { useState, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Flag, Plus, ShieldX, Clock, ScanLine,
  AlertTriangle, Info, RefreshCw, EyeOff,
  Camera, X, Upload, User,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/watchlist")({
  component: WatchlistPage,
});

type AlertLevel = "info" | "warn" | "deny" | "detain";

const ALERT_CFG: Record<AlertLevel, { label: string; badge: string; border: string; icon: any; pulse: boolean }> = {
  info:   { label: "Info",   badge: "bg-primary/10 text-primary",           border: "border-primary/20",      icon: Info,          pulse: false },
  warn:   { label: "Warn",   badge: "bg-warning/15 text-warning",           border: "border-warning/30",      icon: AlertTriangle, pulse: false },
  deny:   { label: "Deny",   badge: "bg-destructive/15 text-destructive",   border: "border-destructive/30",  icon: ShieldX,       pulse: false },
  detain: { label: "DETAIN", badge: "bg-destructive text-destructive-foreground", border: "border-destructive", icon: Flag,     pulse: true  },
};

function WatchlistPage() {
  const { t } = useTranslation();
  const { user, isAdmin } = useAuth();
  const qc = useQueryClient();

  const [levelFilter,  setLevelFilter]  = useState<"all" | AlertLevel>("all");
  const [showInactive, setShowInactive] = useState(false);
  const [showForm,     setShowForm]     = useState(false);
  const [busy,         setBusy]         = useState(false);
  const [deactivating, setDeactivating] = useState<string | null>(null);

  // Form state
  const [fullName,    setFullName]    = useState("");
  const [reason,      setReason]      = useState("");
  const [description, setDescription] = useState("");
  const [alertLevel,  setAlertLevel]  = useState<AlertLevel>("warn");
  const [barcode,     setBarcode]     = useState("");
  const [idNumber,    setIdNumber]    = useState("");
  const [expiresAt,   setExpiresAt]   = useState("");

  // Photo upload state
  const [photoFile,    setPhotoFile]    = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: entries, isLoading, refetch } = useQuery({
    queryKey: ["watchlist", levelFilter, showInactive],
    queryFn: async () => {
      let q = supabase
        .from("watchlist")
        .select("*, adder:added_by(email)")
        .order("alert_level", { ascending: false })
        .order("created_at", { ascending: false });

      if (!showInactive) {
        const now = new Date().toISOString();
        q = q.eq("is_active", true)
             .or(`expires_at.is.null,expires_at.gt.${now}`);
      }
      if (levelFilter !== "all") q = q.eq("alert_level", levelFilter);

      const { data } = await q;
      return data ?? [];
    },
  });

  // Resolve signed URLs for cards that have photos
  const { data: signedUrls } = useQuery({
    queryKey: ["watchlist-photos", entries?.map((e: any) => e.photo_url).filter(Boolean).join(",")],
    enabled: !!(entries?.some((e: any) => e.photo_url)),
    queryFn: async () => {
      const paths = (entries ?? []).map((e: any) => e.photo_url).filter(Boolean) as string[];
      const results: Record<string, string> = {};
      await Promise.all(
        paths.map(async (path) => {
          const { data } = await supabase.storage
            .from("student-photos")
            .createSignedUrl(path, 300);
          if (data?.signedUrl) results[path] = data.signedUrl;
        })
      );
      return results;
    },
  });

  // ── Photo file handling ──────────────────────────────────────────────────
  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) { toast.error("Please select an image file"); return; }
    if (file.size > 5 * 1024 * 1024) { toast.error("Image must be under 5 MB"); return; }
    setPhotoFile(file);
    const reader = new FileReader();
    reader.onload = (ev) => setPhotoPreview(ev.target?.result as string);
    reader.readAsDataURL(file);
  };

  const clearPhoto = () => {
    setPhotoFile(null);
    setPhotoPreview(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const onDropZone = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) {
      const fakeEvt = { target: { files: [file] } } as unknown as React.ChangeEvent<HTMLInputElement>;
      onFileChange(fakeEvt);
    }
  };

  // ── Add entry ────────────────────────────────────────────────────────────
  const add = async () => {
    if (!fullName.trim() || !reason.trim()) { toast.error("Name and reason are required"); return; }
    setBusy(true);
    try {
      let photoPath: string | null = null;

      // Upload photo if one was selected
      if (photoFile) {
        const ext  = photoFile.name.split(".").pop() ?? "jpg";
        const path = `watchlist/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
        const { error: uploadErr } = await supabase.storage
          .from("student-photos")
          .upload(path, photoFile, { upsert: false, contentType: photoFile.type });
        if (uploadErr) { toast.error(`Photo upload failed: ${uploadErr.message}`); setBusy(false); return; }
        photoPath = path;
      }

      const { error } = await supabase.from("watchlist").insert({
        full_name:   fullName.trim(),
        reason:      reason.trim(),
        description: description.trim() || null,
        alert_level: alertLevel,
        barcode:     barcode.trim()  || null,
        id_number:   idNumber.trim() || null,
        expires_at:  expiresAt       || null,
        added_by:    user?.id ?? null,
        photo_url:   photoPath,
      });

      if (error) { toast.error(error.message); return; }
      toast.success(t("wl.toast_added"));
      setFullName(""); setReason(""); setDescription(""); setAlertLevel("warn");
      setBarcode(""); setIdNumber(""); setExpiresAt("");
      clearPhoto();
      setShowForm(false);
      qc.invalidateQueries({ queryKey: ["watchlist"] });
    } finally {
      setBusy(false);
    }
  };

  const deactivate = async (id: string, name: string) => {
    if (!confirm(`Remove "${name}" from the active watchlist?`)) return;
    setDeactivating(id);
    const { error } = await supabase.from("watchlist").update({ is_active: false, updated_at: new Date().toISOString() }).eq("id", id);
    setDeactivating(null);
    if (error) { toast.error(error.message); return; }
    toast.success(t("wl.toast_removed"));
    qc.invalidateQueries({ queryKey: ["watchlist"] });
  };

  const active = (entries ?? []).filter((e: any) => e.is_active);
  const detainCount = active.filter((e: any) => e.alert_level === "detain").length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{t("wl.title")}</h1>
          <p className="text-sm text-muted-foreground">
            {t("wl.subtitle")}
            {detainCount > 0 && <span className="ml-1 font-semibold text-destructive">{t("wl.detain_count", { count: detainCount })}</span>}
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => refetch()}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> {t("common2.refresh")}
          </Button>
          {isAdmin && (
            <Button size="sm" onClick={() => setShowForm((s) => !s)}>
              <Plus className="mr-1.5 h-4 w-4" /> {t("wl.add_btn")}
            </Button>
          )}
        </div>
      </div>

      {/* Gate scan integration notice */}
      <div className="flex items-start gap-3 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm">
        <ScanLine className="h-4 w-4 shrink-0 text-primary mt-0.5" />
        <div>
          <span className="font-semibold text-primary">{t("wl.gate_notice")}</span>
          <span className="text-muted-foreground ml-1">
            {t("wl.gate_notice_sub")}
          </span>
        </div>
      </div>

      {/* DETAIN banner */}
      {detainCount > 0 && (
        <div className="flex items-center gap-3 rounded-xl bg-destructive px-5 py-3 text-destructive-foreground animate-in fade-in duration-300">
          <Flag className="h-5 w-5 shrink-0 animate-pulse" />
          <div>
            <span className="font-bold">{t("wl.detain_banner", { count: detainCount })}</span>
          </div>
        </div>
      )}

      {/* Add form */}
      {showForm && isAdmin && (
        <div className="rounded-xl border border-border bg-card p-5 shadow-sm space-y-4 animate-in fade-in slide-in-from-top-2 duration-200">
          <h2 className="font-semibold">{t("wl.form_title")}</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>{t("wl.label_name")} <span className="text-destructive">*</span></Label>
              <Input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder={t("wl.ph_name")} autoFocus />
            </div>
            <div className="space-y-1.5">
              <Label>{t("wl.label_level")} <span className="text-destructive">*</span></Label>
              <Select value={alertLevel} onValueChange={(v) => setAlertLevel(v as AlertLevel)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="info">{t("wl.level_info")}</SelectItem>
                  <SelectItem value="warn">{t("wl.level_warn")}</SelectItem>
                  <SelectItem value="deny">{t("wl.level_deny")}</SelectItem>
                  <SelectItem value="detain">{t("wl.level_detain")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="sm:col-span-2 space-y-1.5">
              <Label>{t("wl.label_reason")} <span className="text-destructive">*</span></Label>
              <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("wl.ph_reason")} />
            </div>
            <div className="sm:col-span-2 space-y-1.5">
              <Label>{t("wl.label_desc")}</Label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t("wl.ph_desc")}
                rows={3}
                className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-none"
              />
            </div>

            {/* ── Photo upload ── */}
            <div className="sm:col-span-2 space-y-1.5">
              <Label>{t("wl.label_photo")} <span className="text-muted-foreground font-normal">(optional)</span></Label>

              {photoPreview ? (
                /* Preview card */
                <div className="flex items-start gap-4">
                  <div className="relative h-32 w-28 shrink-0 overflow-hidden rounded-lg border border-border bg-secondary">
                    <img src={photoPreview} alt="Preview" className="h-full w-full object-cover" />
                    <button
                      type="button"
                      onClick={clearPhoto}
                      className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-white transition-colors hover:bg-destructive"
                      title="Remove photo"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                  <div className="flex-1 space-y-1 text-sm text-muted-foreground">
                    <p className="font-medium text-foreground truncate">{photoFile?.name}</p>
                    <p>{photoFile ? (photoFile.size / 1024).toFixed(0) : 0} KB</p>
                    <Button type="button" size="sm" variant="outline" onClick={() => fileInputRef.current?.click()}>
                      <Camera className="mr-1.5 h-3.5 w-3.5" /> {t("wl.change_photo")}
                    </Button>
                  </div>
                </div>
              ) : (
                /* Drop zone */
                <div
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={onDropZone}
                  onClick={() => fileInputRef.current?.click()}
                  className="flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-border bg-secondary/40 px-6 py-8 text-center transition-colors hover:border-primary/50 hover:bg-primary/5"
                >
                  <div className="grid h-12 w-12 place-items-center rounded-full bg-secondary">
                    <Upload className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground">{t("wl.drop_photo")}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{t("wl.drop_sub")}</p>
                  </div>
                </div>
              )}

              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={onFileChange}
              />
            </div>

            <div className="space-y-1.5">
              <Label>{t("wl.label_barcode")}</Label>
              <Input
                value={barcode}
                onChange={(e) => setBarcode(e.target.value)}
                placeholder={t("wl.ph_barcode")}
                className="font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t("wl.label_id")}</Label>
              <Input value={idNumber} onChange={(e) => setIdNumber(e.target.value)} placeholder={t("wl.ph_id")} />
            </div>
            <div className="space-y-1.5">
              <Label>{t("wl.label_expires")}</Label>
              <Input type="datetime-local" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" onClick={() => { setShowForm(false); clearPhoto(); }}>{t("common.cancel")}</Button>
            <Button
              onClick={add}
              disabled={busy || !fullName.trim() || !reason.trim()}
              className={alertLevel === "detain" ? "bg-destructive hover:bg-destructive/90 text-destructive-foreground" : ""}
            >
              {busy ? t("wl.adding") : t("wl.add_submit")}
            </Button>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1 rounded-lg border border-border bg-secondary p-1">
          {(["all", "info", "warn", "deny", "detain"] as const).map((l) => (
            <button
              key={l}
              onClick={() => setLevelFilter(l)}
              className={cn(
                "rounded-md px-3 py-1.5 text-xs font-medium capitalize transition-colors",
                levelFilter === l ? "bg-card shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {l === "all" ? t("common2.all") : ALERT_CFG[l].label}
            </button>
          ))}
        </div>
        <button
          onClick={() => setShowInactive((s) => !s)}
          className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          <EyeOff className="h-3.5 w-3.5" />
          {showInactive ? t("wl.hide_inactive") : t("wl.show_inactive")}
        </button>
      </div>

      {/* List */}
      {isLoading ? (
        <div className="py-12 text-center text-sm text-muted-foreground">{t("common.loading")}</div>
      ) : (entries ?? []).length === 0 ? (
        <div className="rounded-xl border border-border bg-card py-16 text-center">
          <ShieldX className="mx-auto mb-3 h-10 w-10 text-muted-foreground/25" />
          <p className="text-sm font-medium text-muted-foreground">
            {levelFilter === "all" ? t("wl.empty_all") : `No ${ALERT_CFG[levelFilter].label.toLowerCase()} entries.`}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {(entries ?? []).map((entry: any) => {
            const cfg       = ALERT_CFG[entry.alert_level as AlertLevel] ?? ALERT_CFG.warn;
            const Icon      = cfg.icon;
            const isExpired = entry.expires_at && new Date(entry.expires_at) < new Date();
            const photoSrc  = entry.photo_url ? signedUrls?.[entry.photo_url] : null;

            return (
              <div
                key={entry.id}
                className={cn(
                  "rounded-xl border bg-card shadow-sm transition-all",
                  cfg.border,
                  !entry.is_active && "opacity-50",
                  cfg.pulse && entry.is_active && "ring-1 ring-destructive/50"
                )}
              >
                <div className="flex items-start gap-3 p-5">
                  {/* Photo or icon avatar */}
                  <div className={cn(
                    "mt-0.5 shrink-0 overflow-hidden rounded-lg",
                    photoSrc ? "h-16 w-14" : "grid h-9 w-9 place-items-center rounded-lg",
                    !photoSrc && cfg.badge
                  )}>
                    {photoSrc ? (
                      <img src={photoSrc} alt={entry.full_name} className="h-full w-full object-cover" />
                    ) : (
                      <Icon className={cn("h-4 w-4", cfg.pulse && entry.is_active && "animate-pulse")} />
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide", cfg.badge)}>
                        {cfg.label}
                      </span>
                      {!entry.is_active && (
                        <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] text-muted-foreground uppercase">{t("wl.inactive_badge")}</span>
                      )}
                      {isExpired && (
                        <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] text-muted-foreground uppercase">{t("wl.expired_badge")}</span>
                      )}
                    </div>
                    <p className="font-semibold">{entry.full_name}</p>
                    <p className="mt-0.5 text-sm text-muted-foreground">{entry.reason}</p>
                    {entry.description && (
                      <p className="mt-1 text-xs text-muted-foreground italic">{entry.description}</p>
                    )}
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      {entry.barcode && (
                        <span className="flex items-center gap-1">
                          <ScanLine className="h-3 w-3" />
                          <span className="font-mono">{entry.barcode}</span>
                        </span>
                      )}
                      {entry.id_number && <span>ID: {entry.id_number}</span>}
                      {entry.expires_at && (
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {t("wl.expires_on", { date: new Date(entry.expires_at).toLocaleDateString() })}
                        </span>
                      )}
                      {entry.adder?.email && <span>{t("wl.added_by")} {entry.adder.email}</span>}
                    </div>
                  </div>

                  {/* No-photo placeholder indicator + deactivate button */}
                  <div className="flex shrink-0 flex-col items-end gap-2">
                    {!photoSrc && (
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-dashed border-border text-muted-foreground/40" title="No photo on file">
                        <User className="h-4 w-4" />
                      </div>
                    )}
                    {isAdmin && entry.is_active && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => deactivate(entry.id, entry.full_name)}
                        disabled={deactivating === entry.id}
                        className="text-xs"
                      >
                        {deactivating === entry.id ? "…" : t("wl.deactivate")}
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
