import { createFileRoute, useNavigate, useParams, Link, Navigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft, Trash2, Upload, IdCard, Camera, X,
  CheckCircle2, XCircle, AlertTriangle, Download,
  ArrowDownToLine, ArrowUpFromLine, User as UserIcon,
  BookOpen, ShieldAlert, Phone, FileText, CameraOff,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import { downloadIdCard } from "@/lib/idcard";
import jsPDF from "jspdf";

export const Route = createFileRoute("/_authenticated/students/$id")({
  component: StudentEditor,
});

// ─── Section wrapper ────────────────────────────────────────────────────────

function Section({
  icon: Icon, title, children, className = "",
}: {
  icon: React.ElementType;
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-xl border border-border bg-card shadow-sm overflow-hidden ${className}`}>
      <div className="flex items-center gap-3 border-b border-border bg-secondary/30 px-5 py-3">
        <div className="grid h-8 w-8 place-items-center rounded-lg bg-primary/10">
          <Icon className="h-4 w-4 text-primary" />
        </div>
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

// ─── Main component ─────────────────────────────────────────────────────────

function StudentEditor() {
  const { t } = useTranslation();
  const { id }         = useParams({ from: "/_authenticated/students/$id" });
  const { isAdmin, loading } = useAuth();
  const navigate       = useNavigate();
  const isNew          = id === "new";
  const [tab, setTab]  = useState<"details" | "history">("details");

  // ── Data queries ──
  const { data: student, refetch } = useQuery({
    queryKey: ["student", id],
    enabled:  !isNew,
    queryFn: async () => {
      const { data } = await supabase.from("students").select("*").eq("id", id).maybeSingle();
      return data;
    },
  });

  const { data: accessHistory } = useQuery({
    queryKey: ["student-history", id],
    enabled:  !isNew && tab === "history",
    queryFn: async () => {
      const { data } = await supabase
        .from("access_logs")
        .select("id,scanned_at,direction,decision,reason,gate_id,gates(name)")
        .eq("student_id", id)
        .order("scanned_at", { ascending: false })
        .limit(200);
      return data ?? [];
    },
  });

  // ── Form state ──
  const [form, setForm] = useState({
    admission_number:  "",
    barcode:           "",
    full_name:         "",
    programme:         "",
    nta_level:         "",
    year_of_study:     1,
    status:            "active" as "active" | "suspended" | "graduated",
    suspension_reason: "",
    suspended_until:   "",
    notes:             "",
    expires_at:        "",
    is_visitor:        false,
    parent_email:      "",
    parent_phone:      "",
  });

  const barcodeManualRef = useRef(false);
  const [errors, setErrors]     = useState<Record<string, string>>({});
  const [photoUrl,    setPhotoUrl]    = useState<string | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [uploading,   setUploading]   = useState(false);
  const [saving,      setSaving]      = useState(false);
  const [cameraMode,  setCameraMode]  = useState(false);

  const videoRef  = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Populate form when editing an existing student
  useEffect(() => {
    if (student) {
      barcodeManualRef.current = true;
      setForm({
        admission_number:  student.admission_number,
        barcode:           student.barcode,
        full_name:         student.full_name,
        programme:         student.programme         ?? "",
        nta_level:         String(student.nta_level  ?? ""),
        year_of_study:     student.year_of_study     ?? 1,
        status:            student.status as any,
        suspension_reason: (student as any).suspension_reason ?? "",
        suspended_until:   (student as any).suspended_until   ?? "",
        notes:             student.notes             ?? "",
        expires_at:        student.expires_at        ?? "",
        is_visitor:        student.is_visitor        ?? false,
        parent_email:      student.parent_email      ?? "",
        parent_phone:      student.parent_phone      ?? "",
      });
      setPhotoUrl(student.photo_url ?? null);
      if (student.photo_url) {
        supabase.storage.from("student-photos")
          .createSignedUrl(student.photo_url, 600)
          .then(({ data }) => setPhotoPreview(data?.signedUrl ?? null));
      }
    }
  }, [student]);

  // Clean up camera on unmount
  useEffect(() => () => { streamRef.current?.getTracks().forEach((t) => t.stop()); }, []);

  if (loading) return null;
  if (!isAdmin) return <Navigate to="/verify" replace />;

  // ── Helpers ──────────────────────────────────────────────────────────────

  const set = (key: keyof typeof form, val: unknown) =>
    setForm((f) => ({ ...f, [key]: val }));

  const clearErr = (key: string) =>
    setErrors((e) => { const n = { ...e }; delete n[key]; return n; });

  // ── Photo upload ──────────────────────────────────────────────────────────

  const uploadBlob = async (blob: Blob, ext = "jpg") => {
    setUploading(true);
    try {
      const path = `${crypto.randomUUID()}.${ext}`;
      const { error } = await supabase.storage.from("student-photos").upload(path, blob, {
        contentType: blob.type || "image/jpeg",
      });
      if (error) throw error;
      setPhotoUrl(path);
      const { data } = await supabase.storage.from("student-photos").createSignedUrl(path, 600);
      setPhotoPreview(data?.signedUrl ?? null);
      toast.success("Photo saved");
    } catch (e: any) {
      toast.error(e.message || "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const handlePhotoFile = (file: File) => uploadBlob(file, file.name.split(".").pop() ?? "jpg");

  // ── Webcam ────────────────────────────────────────────────────────────────

  const startCamera = async () => {
    // Camera requires HTTPS or localhost — navigator.mediaDevices is undefined on plain HTTP
    if (!navigator.mediaDevices?.getUserMedia) {
      toast.error(
        location.protocol === "http:" && location.hostname !== "localhost" && location.hostname !== "127.0.0.1"
          ? "Camera requires a secure connection (HTTPS). Please upload a photo file instead."
          : "Camera is not supported on this browser.",
        { duration: 6000 },
      );
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 640 } },
      });
      streamRef.current = stream;
      if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play(); }
      setCameraMode(true);
    } catch (e: any) {
      const msg = (e as any).name === "NotAllowedError"
        ? "Camera permission denied. Allow camera access in browser settings."
        : (e as any).name === "NotFoundError"
        ? "No camera found on this device."
        : e.message || "Camera unavailable";
      toast.error(msg, { duration: 6000 });
    }
  };

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCameraMode(false);
  };

  const capturePhoto = () => {
    const video  = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    const size   = Math.min(video.videoWidth, video.videoHeight) || 640;
    canvas.width = canvas.height = size;
    const ctx    = canvas.getContext("2d")!;
    ctx.drawImage(video, (video.videoWidth - size) / 2, (video.videoHeight - size) / 2, size, size, 0, 0, size, size);
    stopCamera();
    canvas.toBlob((blob) => { if (blob) uploadBlob(blob, "jpg"); }, "image/jpeg", 0.88);
  };

  // ── Validation & save ─────────────────────────────────────────────────────

  const validate = () => {
    const e: Record<string, string> = {};
    if (!form.admission_number.trim()) e.admission_number = "Admission number is required";
    if (!form.barcode.trim())          e.barcode = "Barcode is required";
    if (!form.full_name.trim())        e.full_name = "Full name is required";
    if (!form.programme.trim())        e.programme = "Programme / course is required";
    if (form.status === "suspended" && !form.suspension_reason.trim())
      e.suspension_reason = "Reason is required when status is Suspended";
    if (form.parent_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.parent_email))
      e.parent_email = "Enter a valid email address";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const save = async () => {
    if (!validate()) { toast.error("Please fix the highlighted fields before saving."); return; }
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        ...form,
        admission_number:  form.admission_number.trim(),
        barcode:           form.barcode.trim(),
        full_name:         form.full_name.trim(),
        photo_url:         photoUrl,
        year_of_study:     Number(form.year_of_study),
        expires_at:        form.expires_at        || null,
        parent_email:      form.parent_email      || null,
        parent_phone:      form.parent_phone      || null,
        suspension_reason: form.status === "suspended" ? (form.suspension_reason || null) : null,
        suspended_until:   form.status === "suspended" ? (form.suspended_until   || null) : null,
      };

      if (isNew) {
        const { data, error } = await supabase.from("students").insert(payload as any).select().single();
        if (error) {
          if (error.code === "23505") {
            if (error.message.includes("admission_number"))
              setErrors((e) => ({ ...e, admission_number: "This admission number is already registered" }));
            else if (error.message.includes("barcode"))
              setErrors((e) => ({ ...e, barcode: "This barcode is already registered" }));
            toast.error("Duplicate entry — see highlighted fields.");
          } else {
            toast.error(error.message || "Save failed");
          }
          return;
        }
        toast.success(t("sedit.toast_created"));
        navigate({ to: "/students/$id", params: { id: data.id } });
      } else {
        const { error } = await supabase.from("students").update(payload as any).eq("id", id);
        if (error) {
          if (error.code === "23505") {
            if (error.message.includes("admission_number"))
              setErrors((e) => ({ ...e, admission_number: "Already used by another student" }));
            else if (error.message.includes("barcode"))
              setErrors((e) => ({ ...e, barcode: "Already used by another student" }));
            toast.error("Duplicate value — see highlighted fields.");
          } else {
            toast.error(error.message || "Save failed");
          }
          return;
        }
        toast.success(t("sedit.toast_saved"));
        setErrors({});
        refetch();
      }
    } catch (e: any) {
      toast.error(e.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!confirm("Delete this student? This cannot be undone.")) return;
    const { error } = await supabase.from("students").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Deleted");
    navigate({ to: "/students" });
  };

  const printIdCard = async () => {
    let photoDataUrl: string | null = null;
    if (photoPreview) {
      try {
        const blob = await (await fetch(photoPreview)).blob();
        photoDataUrl = await new Promise<string>((res) => {
          const r = new FileReader(); r.onload = () => res(r.result as string); r.readAsDataURL(blob);
        });
      } catch {/* ignore */}
    }
    downloadIdCard({
      full_name: form.full_name, admission_number: form.admission_number,
      barcode: form.barcode, programme: form.programme,
      nta_level: form.nta_level, year_of_study: form.year_of_study,
      photoDataUrl, is_visitor: form.is_visitor, expires_at: form.expires_at || null,
    });
  };

  // ── Attendance helpers ────────────────────────────────────────────────────

  const attendanceDays = (withinDays: number) => {
    const since = new Date(Date.now() - withinDays * 86_400_000);
    const days  = new Set<string>();
    (accessHistory ?? [])
      .filter((l) => l.decision === "allowed" && new Date(l.scanned_at) >= since)
      .forEach((l) => days.add(l.scanned_at.slice(0, 10)));
    return days.size;
  };

  const exportHistoryPDF = () => {
    const rows = accessHistory ?? [];
    const doc  = new jsPDF({ unit: "mm", format: "a4" });
    doc.setFontSize(14); doc.setFont("helvetica", "bold");
    doc.text(`Access History: ${form.full_name}`, 14, 18);
    doc.setFontSize(9); doc.setFont("helvetica", "normal");
    doc.text(`Admission: ${form.admission_number}  ·  Exported: ${new Date().toLocaleString()}`, 14, 25);
    doc.setDrawColor(200); doc.line(14, 28, 196, 28);
    const colW = [52, 22, 22, 30, 60];
    let y = 34;
    doc.setFillColor(240, 245, 240); doc.rect(14, y - 4, 182, 7, "F");
    doc.setFont("helvetica", "bold"); doc.setFontSize(8);
    let x = 14;
    ["Date & Time", "Direction", "Decision", "Gate", "Reason"].forEach((h, i) => {
      doc.text(h, x + 1, y); x += colW[i];
    });
    y += 5; doc.setFont("helvetica", "normal");
    (rows as any[]).forEach((l) => {
      if (y > 270) { doc.addPage(); y = 20; }
      x = 14;
      [new Date(l.scanned_at).toLocaleString(), l.direction ?? "—", l.decision, l.gates?.name ?? "—", l.reason ?? "—"]
        .forEach((c, i) => { doc.text(String(c).slice(0, 35), x + 1, y); x += colW[i]; });
      y += 6;
    });
    doc.save(`access-history-${form.admission_number}-${new Date().toISOString().slice(0, 10)}.pdf`);
  };

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6 max-w-4xl">

      {/* ── Breadcrumb ── */}
      <div className="flex items-center gap-2">
        <Link to="/students" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="h-4 w-4" /> {t("sedit.breadcrumb")}
        </Link>
        <span className="text-muted-foreground/40">/</span>
        <span className="text-sm font-medium text-foreground">
          {isNew ? t("sedit.new_label") : form.full_name || t("sedit.edit_label")}
        </span>
      </div>

      {/* ── Page header ── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">
            {isNew ? t("sedit.new_title") : form.full_name || t("sedit.edit_label")}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("sedit.required_note")}
          </p>
        </div>
        {!isNew && (
          <div className="flex gap-2">
            <Button variant="outline" onClick={printIdCard}>
              <IdCard className="mr-2 h-4 w-4" /> {t("sedit.download_id")}
            </Button>
          </div>
        )}
      </div>

      {/* ── Tab bar (existing students only) ── */}
      {!isNew && (
        <div className="flex gap-1 rounded-lg border border-border bg-secondary p-1 w-fit">
          {([
            { key: "details", label: t("sedit.tab_details") },
            { key: "history", label: t("sedit.tab_history") },
          ] as const).map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`rounded-md px-4 py-1.5 text-sm font-medium capitalize transition-all ${
                tab === key ? "bg-card shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {/* ══════════════════════════════════════════
          DETAILS TAB
      ══════════════════════════════════════════ */}
      {tab === "details" && (
        <div className="space-y-5">

          {/* ── Photo + identity — top section ── */}
          <div className="grid gap-5 md:grid-cols-[220px_1fr]">

            {/* Photo panel */}
            <Section icon={UserIcon} title={t("sedit.sec_photo")} className="self-start">
              {/* Preview */}
              <div className="relative mb-3 aspect-square overflow-hidden rounded-xl border border-border bg-secondary">
                {cameraMode ? (
                  <video ref={videoRef} autoPlay playsInline muted className="h-full w-full object-cover" />
                ) : photoPreview ? (
                  <img src={photoPreview} alt="Student photo" className="h-full w-full object-cover" />
                ) : (
                  <div className="grid h-full place-items-center text-muted-foreground">
                    <div className="flex flex-col items-center gap-2">
                      <UserIcon className="h-12 w-12 opacity-25" />
                      <span className="text-xs">{t("sedit.no_photo")}</span>
                    </div>
                  </div>
                )}
                <canvas ref={canvasRef} className="hidden" />
                {uploading && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                    <RefreshCw className="h-6 w-6 animate-spin text-white" />
                  </div>
                )}
              </div>

              {/* Controls */}
              {cameraMode ? (
                <div className="space-y-2">
                  <Button className="w-full" onClick={capturePhoto} disabled={uploading}>
                    <Camera className="mr-2 h-4 w-4" />
                    {uploading ? t("common.loading") : t("sedit.capture_btn")}
                  </Button>
                  <Button variant="outline" className="w-full" onClick={stopCamera}>
                    <CameraOff className="mr-2 h-4 w-4" /> {t("sedit.stop_camera")}
                  </Button>
                </div>
              ) : (
                <div className="space-y-2">
                  <label className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-background px-3 py-2.5 text-sm font-medium hover:bg-secondary transition-colors">
                    <Upload className="h-4 w-4 text-muted-foreground" />
                    {uploading ? t("common.loading") : t("sedit.upload_label")}
                    <input
                      type="file" accept="image/*" className="hidden"
                      onChange={(e) => e.target.files?.[0] && handlePhotoFile(e.target.files[0])}
                      disabled={uploading}
                    />
                  </label>
                  {/* Webcam only available on HTTPS / localhost */}
                  {(window.isSecureContext ||
                    location.hostname === "localhost" ||
                    location.hostname === "127.0.0.1") && (
                    <Button variant="outline" className="w-full" onClick={startCamera} disabled={uploading}>
                      <Camera className="mr-2 h-4 w-4" /> {t("sedit.webcam_btn")}
                    </Button>
                  )}
                  {photoPreview && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full text-destructive hover:text-destructive"
                      onClick={() => { setPhotoUrl(null); setPhotoPreview(null); }}
                    >
                      <X className="mr-1 h-3.5 w-3.5" /> {t("sedit.remove_photo")}
                    </Button>
                  )}
                </div>
              )}
              <p className="mt-2.5 text-center text-xs text-muted-foreground">
                {t("sedit.photo_hint")}
              </p>
            </Section>

            {/* Identity fields */}
            <Section icon={FileText} title={t("sedit.sec_identity")}>
              <div className="grid gap-4 sm:grid-cols-2">

                {/* Admission number */}
                <div className="space-y-1.5">
                  <Label>{t("sedit.label_admission")} <span className="text-destructive">*</span></Label>
                  <Input
                    value={form.admission_number}
                    placeholder="e.g. 24050512001"
                    onChange={(e) => {
                      const v = e.target.value;
                      setForm((f) => ({
                        ...f,
                        admission_number: v,
                        barcode: barcodeManualRef.current ? f.barcode : v,
                      }));
                      clearErr("admission_number");
                    }}
                    className={errors.admission_number ? "border-destructive focus-visible:ring-destructive" : ""}
                  />
                  {errors.admission_number
                    ? <p className="text-xs text-destructive">{errors.admission_number}</p>
                    : <p className="text-xs text-muted-foreground">{t("sedit.hint_admission")}</p>
                  }
                </div>

                {/* Barcode */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label>{t("sedit.label_barcode")} <span className="text-destructive">*</span></Label>
                    {isNew && (
                      <button
                        type="button"
                        className="text-[11px] text-primary hover:underline"
                        onClick={() => {
                          barcodeManualRef.current = false;
                          setForm((f) => ({ ...f, barcode: f.admission_number }));
                          clearErr("barcode");
                        }}
                      >
                        {t("sedit.same_as_adm")}
                      </button>
                    )}
                  </div>
                  <Input
                    value={form.barcode}
                    placeholder="Auto-filled from admission number"
                    onChange={(e) => {
                      barcodeManualRef.current = true;
                      set("barcode", e.target.value);
                      clearErr("barcode");
                    }}
                    className={errors.barcode ? "border-destructive focus-visible:ring-destructive" : ""}
                  />
                  {errors.barcode
                    ? <p className="text-xs text-destructive">{errors.barcode}</p>
                    : <p className="text-xs text-muted-foreground">Printed on the ID card and scanned at the gate</p>
                  }
                </div>

                {/* Full name */}
                <div className="sm:col-span-2 space-y-1.5">
                  <Label>{t("sedit.label_fullname")} <span className="text-destructive">*</span></Label>
                  <Input
                    value={form.full_name}
                    placeholder="e.g. John Michael Doe"
                    onChange={(e) => { set("full_name", e.target.value); clearErr("full_name"); }}
                    className={`text-base ${errors.full_name ? "border-destructive focus-visible:ring-destructive" : ""}`}
                  />
                  {errors.full_name && <p className="text-xs text-destructive">{errors.full_name}</p>}
                </div>
              </div>
            </Section>
          </div>

          {/* ── Academic details ── */}
          <Section icon={BookOpen} title={t("sedit.sec_academic")}>
            <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3">

              {/* Programme */}
              <div className="sm:col-span-2 md:col-span-1 space-y-1.5">
                <Label>{t("sedit.label_programme")} <span className="text-destructive">*</span></Label>
                <Input
                  value={form.programme}
                  placeholder="e.g. Computer Science, Civil Engineering…"
                  onChange={(e) => { set("programme", e.target.value); clearErr("programme"); }}
                  className={errors.programme ? "border-destructive focus-visible:ring-destructive" : ""}
                />
                {errors.programme && <p className="text-xs text-destructive">{errors.programme}</p>}
              </div>

              {/* NTA level */}
              <div className="space-y-1.5">
                <Label>{t("sedit.label_nta")}</Label>
                <Select
                  value={form.nta_level || "none"}
                  onValueChange={(v) => set("nta_level", v === "none" ? "" : v)}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{t("sedit.nta_none")}</SelectItem>
                    {["4", "5", "6", "7", "8", "9"].map((l) => (
                      <SelectItem key={l} value={l}>{t("sedit.nta_level", { n: l })}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Year of study */}
              <div className="space-y-1.5">
                <Label>{t("sedit.label_year")}</Label>
                <Select
                  value={String(form.year_of_study)}
                  onValueChange={(v) => set("year_of_study", Number(v))}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {[1, 2, 3, 4, 5, 6].map((y) => (
                      <SelectItem key={y} value={String(y)}>{t("sedit.year_n", { n: y })}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </Section>

          {/* ── Access control ── */}
          <Section icon={ShieldAlert} title={t("sedit.sec_access")}>
            <div className="grid gap-4 sm:grid-cols-2">

              {/* Status */}
              <div className="space-y-1.5">
                <Label>{t("sedit.label_status")}</Label>
                <Select value={form.status} onValueChange={(v) => set("status", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">{t("sedit.status_active")}</SelectItem>
                    <SelectItem value="suspended">{t("sedit.status_suspended")}</SelectItem>
                    <SelectItem value="graduated">{t("sedit.status_graduated")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Card expiry */}
              <div className="space-y-1.5">
                <Label>{t("sedit.label_expiry")}</Label>
                <Input
                  type="date"
                  value={form.expires_at}
                  onChange={(e) => set("expires_at", e.target.value)}
                />
                <p className="text-xs text-muted-foreground">{t("sedit.expiry_hint")}</p>
              </div>

              {/* Suspension fields — only when suspended */}
              {form.status === "suspended" && (
                <>
                  <div className="sm:col-span-2 space-y-1.5">
                    <Label>{t("sedit.label_sus_reason")} <span className="text-destructive">*</span></Label>
                    <Textarea
                      value={form.suspension_reason}
                      onChange={(e) => { set("suspension_reason", e.target.value); clearErr("suspension_reason"); }}
                      placeholder={t("sedit.ph_sus_reason")}
                      rows={2}
                      className={errors.suspension_reason ? "border-destructive focus-visible:ring-destructive" : ""}
                    />
                    {errors.suspension_reason && (
                      <p className="text-xs text-destructive">{errors.suspension_reason}</p>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <Label>{t("sedit.label_sus_until")}</Label>
                    <Input
                      type="date"
                      value={form.suspended_until}
                      onChange={(e) => set("suspended_until", e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">{t("sedit.sus_until_hint")}</p>
                  </div>
                </>
              )}

              {/* Visitor toggle */}
              <div className="sm:col-span-2 flex items-center justify-between rounded-xl border border-border bg-secondary/40 px-4 py-3">
                <div>
                  <p className="text-sm font-medium">{t("sedit.visitor_label")}</p>
                  <p className="text-xs text-muted-foreground">{t("sedit.visitor_hint")}</p>
                </div>
                <Switch
                  checked={form.is_visitor}
                  onCheckedChange={(v) => set("is_visitor", v)}
                />
              </div>
            </div>
          </Section>

          {/* ── Parent / guardian contact ── */}
          <Section icon={Phone} title={t("sedit.sec_parent")}>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>{t("sedit.label_email")}</Label>
                <Input
                  type="email"
                  value={form.parent_email}
                  placeholder="parent@example.com"
                  onChange={(e) => { set("parent_email", e.target.value); clearErr("parent_email"); }}
                  className={errors.parent_email ? "border-destructive focus-visible:ring-destructive" : ""}
                />
                {errors.parent_email
                  ? <p className="text-xs text-destructive">{errors.parent_email}</p>
                  : <p className="text-xs text-muted-foreground">{t("sedit.email_hint")}</p>
                }
              </div>
              <div className="space-y-1.5">
                <Label>{t("sedit.label_phone")}</Label>
                <Input
                  type="tel"
                  value={form.parent_phone}
                  placeholder="+255 7XX XXX XXX"
                  onChange={(e) => set("parent_phone", e.target.value)}
                />
              </div>
            </div>
          </Section>

          {/* ── Notes ── */}
          <Section icon={FileText} title={t("sedit.sec_notes")}>
            <Textarea
              value={form.notes}
              placeholder={t("sedit.notes_ph")}
              onChange={(e) => set("notes", e.target.value)}
              rows={3}
            />
          </Section>

          {/* ── Action bar ── */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card px-5 py-4 shadow-sm">
            {!isNew && (
              <Button
                variant="outline"
                onClick={remove}
                className="text-destructive border-destructive/30 hover:bg-destructive/5 hover:text-destructive"
              >
                <Trash2 className="mr-2 h-4 w-4" /> {t("sedit.delete_btn")}
              </Button>
            )}
            <div className="ml-auto flex gap-3">
              <Button variant="outline" onClick={() => navigate({ to: "/students" })}>
                {t("common.cancel")}
              </Button>
              <Button onClick={save} disabled={saving} className="min-w-[140px]">
                {saving ? (
                  <span className="flex items-center gap-2">
                    <RefreshCw className="h-4 w-4 animate-spin" /> {t("sedit.saving")}
                  </span>
                ) : isNew ? t("sedit.create_btn") : t("sedit.save_btn")}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════
          ACCESS HISTORY TAB
      ══════════════════════════════════════════ */}
      {tab === "history" && (
        <div className="space-y-5">

          {/* Attendance summary */}
          <div className="grid gap-3 sm:grid-cols-3">
            {[
              { label: t("sedit.hist_7d"),    value: attendanceDays(7)  },
              { label: t("sedit.hist_30d"),   value: attendanceDays(30) },
              { label: t("sedit.hist_total"), value: (accessHistory ?? []).length },
            ].map(({ label, value }) => (
              <div key={label} className="rounded-xl border border-border bg-card p-4 shadow-sm">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
                <p className="mt-1 text-3xl font-bold text-primary">{value}</p>
              </div>
            ))}
          </div>

          {/* History table */}
          <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
            <div className="flex items-center justify-between border-b border-border px-5 py-3">
              <span className="text-sm font-semibold">{t("sedit.scan_log")}</span>
              <Button
                size="sm"
                variant="outline"
                onClick={exportHistoryPDF}
                disabled={!(accessHistory ?? []).length}
              >
                <Download className="mr-1.5 h-3.5 w-3.5" /> Export PDF
              </Button>
            </div>
            {!(accessHistory ?? []).length ? (
              <div className="px-5 py-12 text-center text-sm text-muted-foreground">
                {t("sedit.no_history")}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-secondary text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3 text-left">{t("sedit.col_datetime")}</th>
                      <th className="px-4 py-3 text-left">{t("sedit.col_direction")}</th>
                      <th className="px-4 py-3 text-left">{t("sedit.col_decision")}</th>
                      <th className="px-4 py-3 text-left">{t("sedit.col_gate")}</th>
                      <th className="px-4 py-3 text-left">{t("sedit.col_reason")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {(accessHistory ?? []).map((log: any) => (
                      <tr key={log.id} className="hover:bg-secondary/40">
                        <td className="px-4 py-2.5 text-xs font-mono">
                          {new Date(log.scanned_at).toLocaleString()}
                        </td>
                        <td className="px-4 py-2.5">
                          {log.direction === "in"
                            ? <span className="inline-flex items-center gap-1 text-xs text-success"><ArrowDownToLine className="h-3 w-3" /> {t("sedit.dir_entry")}</span>
                            : log.direction === "out"
                            ? <span className="inline-flex items-center gap-1 text-xs text-primary"><ArrowUpFromLine className="h-3 w-3" /> {t("sedit.dir_exit")}</span>
                            : <span className="text-xs text-muted-foreground">—</span>
                          }
                        </td>
                        <td className="px-4 py-2.5">
                          {log.decision === "allowed"
                            ? <Badge className="bg-success/15 text-success hover:bg-success/20"><CheckCircle2 className="mr-1 h-3 w-3" /> {t("sedit.dec_allowed")}</Badge>
                            : log.decision === "denied"
                            ? <Badge variant="destructive"><XCircle className="mr-1 h-3 w-3" /> {t("sedit.dec_denied")}</Badge>
                            : <Badge variant="secondary"><AlertTriangle className="mr-1 h-3 w-3" /> {t("sedit.dec_unknown")}</Badge>
                          }
                        </td>
                        <td className="px-4 py-2.5 text-xs text-muted-foreground">
                          {(log.gates as any)?.name ?? "—"}
                        </td>
                        <td className="px-4 py-2.5 text-xs text-muted-foreground">
                          {log.reason ?? "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
