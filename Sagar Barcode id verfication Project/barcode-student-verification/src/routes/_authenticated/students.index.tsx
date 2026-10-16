import { createFileRoute, Link, Navigate } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Search, Plus, Users, Download, Upload, IdCard, Image as ImgIcon,
  FileSpreadsheet, CheckSquare, Square, GraduationCap, ShieldOff, X,
  Pencil, User as UserIcon,
} from "lucide-react";
import { downloadCSV } from "@/lib/csv";
import { downloadBulkIdCards, type IdCardStudent } from "@/lib/idcard";
import BulkImportDialog from "@/components/BulkImportDialog";
import { toast } from "sonner";
import jsPDF from "jspdf";

export const Route = createFileRoute("/_authenticated/students/")({
  component: StudentsPage,
});

function StudentsPage() {
  const { t } = useTranslation();
  const { isAdmin, loading } = useAuth();
  const [search, setSearch]               = useState("");
  const photoInputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy]                   = useState(false);
  const [importOpen, setImportOpen]       = useState(false);
  const [selected, setSelected]           = useState<Set<string>>(new Set());
  const [bulkSuspendReason, setBulkSuspendReason] = useState("");
  const [bulkSuspendOpen,   setBulkSuspendOpen]   = useState(false);

  const { data: students, isLoading, refetch } = useQuery({
    queryKey: ["students", search],
    queryFn: async () => {
      let q = supabase
        .from("students")
        .select("*")
        .eq("is_visitor", false)          // visitors are managed under the Visitors menu
        .order("created_at", { ascending: false })
        .limit(500);
      if (search.trim()) {
        const s = `%${search.trim()}%`;
        q = q.or(`full_name.ilike.${s},admission_number.ilike.${s},barcode.ilike.${s}`);
      }
      const { data } = await q;
      return data ?? [];
    },
  });

  if (loading) return null;
  if (!isAdmin) return <Navigate to="/verify" />;

  // ── CSV template ────────────────────────────────────────────────────────
  const downloadTemplate = () => {
    downloadCSV("students-template.csv", [{
      admission_number: "24050512001",
      barcode:          "24050512001",
      full_name:        "John Doe",
      programme:        "Computer Science",
      nta_level:        "6",
      year_of_study:    "1",
      status:           "active",
      expires_at:       "",
      is_visitor:       "false",
      parent_email:     "parent@example.com",
      parent_phone:     "+255700000000",
      notes:            "",
    }]);
  };

  const exportCSV = () => {
    if (!students?.length) return;
    downloadCSV(
      `students-${new Date().toISOString().slice(0, 10)}.csv`,
      students.map(({ id, photo_url, created_at, updated_at, ...rest }: any) => rest),
    );
  };

  // ── Bulk photo upload ───────────────────────────────────────────────────
  const bulkPhotos = async (files: FileList) => {
    setBusy(true);
    let ok = 0, miss = 0;
    for (const f of Array.from(files)) {
      const adm = f.name.replace(/\.[^.]+$/, "");
      const stu = students?.find((s: any) => s.admission_number === adm);
      if (!stu) { miss++; continue; }
      const ext  = f.name.split(".").pop();
      const path = `${crypto.randomUUID()}.${ext}`;
      const up   = await supabase.storage.from("student-photos").upload(path, f);
      if (!up.error) {
        await supabase.from("students").update({ photo_url: path }).eq("id", (stu as any).id);
        ok++;
      }
    }
    setBusy(false);
    toast.success(`Uploaded ${ok} photos${miss ? ` · ${miss} unmatched` : ""}`); // upload feedback kept as-is;
    refetch();
    if (photoInputRef.current) photoInputRef.current.value = "";
  };

  // ── Selection helpers ───────────────────────────────────────────────────
  const toggleOne = (id: string) =>
    setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const toggleAll = () =>
    setSelected((s) =>
      s.size === (students ?? []).length
        ? new Set()
        : new Set((students ?? []).map((s: any) => s.id)),
    );

  // ── Bulk operations ─────────────────────────────────────────────────────
  const bulkGraduate = async () => {
    if (!selected.size) return;
    if (!confirm(`Graduate ${selected.size} student(s)?`)) return;
    setBusy(true);
    const { error } = await supabase.from("students").update({ status: "graduated" }).in("id", [...selected]);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success(t("stu.toast_graduated", { count: selected.size }));
    setSelected(new Set());
    refetch();
  };

  const bulkSuspend = async () => {
    if (!bulkSuspendReason.trim()) { toast.error("Reason is required"); return; }
    setBusy(true);
    const { error } = await supabase
      .from("students")
      .update({ status: "suspended", suspension_reason: bulkSuspendReason.trim() })
      .in("id", [...selected]);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success(t("stu.toast_suspended", { count: selected.size }));
    setBulkSuspendOpen(false);
    setBulkSuspendReason("");
    setSelected(new Set());
    refetch();
  };

  const bulkExportCSV = () => {
    const rows = (students ?? [])
      .filter((s: any) => selected.has(s.id))
      .map(({ id, photo_url, created_at, updated_at, ...rest }: any) => rest);
    if (!rows.length) return;
    downloadCSV(`students-selection-${new Date().toISOString().slice(0, 10)}.csv`, rows);
  };

  // ── Roster PDF ──────────────────────────────────────────────────────────
  const printRoster = () => {
    if (!students?.length) return;
    const doc = new jsPDF({ unit: "mm", format: "a4" });
    const collegeName = "Arusha Technical College";
    const grouped = new Map<string, typeof students>();
    for (const s of students) {
      const prog = (s as any).programme || "—";
      if (!grouped.has(prog)) grouped.set(prog, []);
      grouped.get(prog)!.push(s);
    }
    let firstPage = true;
    for (const [prog, rows] of Array.from(grouped.entries()).sort(([a], [b]) => a.localeCompare(b))) {
      if (!firstPage) doc.addPage();
      firstPage = false;
      doc.setFillColor(20, 80, 50); doc.rect(0, 0, 210, 14, "F");
      doc.setTextColor(255); doc.setFontSize(10); doc.setFont("helvetica", "bold");
      doc.text(collegeName.toUpperCase(), 105, 9, { align: "center" });
      doc.setTextColor(30); doc.setFontSize(12); doc.setFont("helvetica", "bold");
      doc.text(`Programme: ${prog}`, 14, 24);
      doc.setFontSize(8); doc.setFont("helvetica", "normal"); doc.setTextColor(100);
      doc.text(`${rows.length} student${rows.length !== 1 ? "s" : ""}  ·  Generated: ${new Date().toLocaleString()}`, 14, 30);
      let y = 38;
      doc.setFillColor(240, 245, 240); doc.rect(14, y - 4, 182, 7, "F");
      doc.setFont("helvetica", "bold"); doc.setFontSize(8); doc.setTextColor(60);
      doc.text("#", 16, y); doc.text("Admission No", 22, y);
      doc.text("Full Name", 62, y); doc.text("Status", 150, y); doc.text("Expiry", 173, y);
      y += 7;
      doc.setFont("helvetica", "normal"); doc.setFontSize(8);
      rows.forEach((s: any, i) => {
        if (y > 278) { doc.addPage(); y = 20; }
        const isExpired = s.expires_at && new Date(s.expires_at) < new Date();
        const statusColor: [number, number, number] =
          s.status === "active" && !isExpired ? [22, 120, 60] :
          s.status === "suspended"            ? [200, 40, 40] : [100, 100, 100];
        if ((i + 1) % 2 === 0) { doc.setFillColor(248, 250, 248); doc.rect(14, y - 4.5, 182, 6.5, "F"); }
        doc.setTextColor(80); doc.text(String(i + 1), 16, y); doc.text(s.admission_number, 22, y);
        doc.text(s.full_name.slice(0, 34), 62, y);
        doc.setTextColor(...statusColor); doc.text(s.status, 150, y);
        doc.setTextColor(100); doc.text(s.expires_at?.slice(0, 10) ?? "—", 173, y);
        y += 6.5;
      });
      doc.setTextColor(160); doc.setFontSize(7);
      doc.text(`${prog} · Total ${rows.length}`, 105, 291, { align: "center" });
    }
    doc.save(`student-roster-${new Date().toISOString().slice(0, 10)}.pdf`);
    toast.success("Roster PDF downloaded");
  };

  // ── Print all ID cards ──────────────────────────────────────────────────
  const printAll = async () => {
    if (!students?.length) return;
    toast.info("Generating ID cards…");
    const cards: IdCardStudent[] = [];
    for (const s of students) {
      let photoDataUrl: string | null = null;
      if ((s as any).photo_url) {
        const { data } = await supabase.storage
          .from("student-photos")
          .createSignedUrl((s as any).photo_url, 60);
        if (data?.signedUrl) {
          try {
            const blob = await (await fetch(data.signedUrl)).blob();
            photoDataUrl = await new Promise<string>((res) => {
              const r = new FileReader();
              r.onload = () => res(r.result as string);
              r.readAsDataURL(blob);
            });
          } catch {}
        }
      }
      cards.push({ ...s, photoDataUrl } as any);
    }
    downloadBulkIdCards(cards);
  };

  // ── Status badge helper ─────────────────────────────────────────────────
  const statusBadge = (s: any) => {
    const expired = s.expires_at && new Date(s.expires_at) < new Date();
    return (
      <div className="flex flex-wrap items-center gap-1">
        <Badge
          variant={s.status === "active" ? "default" : s.status === "suspended" ? "destructive" : "secondary"}
          className={s.status === "active" && !expired ? "bg-success/15 text-success hover:bg-success/20 border-success/25" : ""}
        >
          {s.status}
        </Badge>
        {expired && (
          <Badge variant="destructive" className="text-[10px]">expired</Badge>
        )}
      </div>
    );
  };

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{t("stu.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("stu.subtitle")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={downloadTemplate} title="Download blank CSV template">
            <FileSpreadsheet className="mr-2 h-4 w-4" /> {t("stu.btn_template")}
          </Button>
          <Button variant="outline" size="sm" onClick={() => setImportOpen(true)} disabled={busy}>
            <Upload className="mr-2 h-4 w-4" /> {t("stu.btn_import")}
          </Button>
          <Button variant="outline" size="sm" onClick={exportCSV}>
            <Download className="mr-2 h-4 w-4" /> {t("stu.btn_export")}
          </Button>
          <Button variant="outline" size="sm" onClick={() => photoInputRef.current?.click()} disabled={busy}>
            <ImgIcon className="mr-2 h-4 w-4" /> {t("stu.btn_photos")}
          </Button>
          <input
            ref={photoInputRef} type="file" accept="image/*" multiple hidden
            onChange={(e) => e.target.files && bulkPhotos(e.target.files)}
          />
          <Button variant="outline" size="sm" onClick={printRoster}>
            <Download className="mr-2 h-4 w-4" /> {t("stu.btn_roster")}
          </Button>
          <Button variant="outline" size="sm" onClick={printAll}>
            <IdCard className="mr-2 h-4 w-4" /> {t("stu.btn_print_ids")}
          </Button>

          {/* ── NEW student button ── */}
          <Link to="/students/$id" params={{ id: "new" }}>
            <Button className="gap-2">
              <Plus className="h-4 w-4" /> {t("stu.btn_new")}
            </Button>
          </Link>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("stu.search_ph")}
          className="pl-9"
        />
      </div>

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3">
          <span className="text-sm font-semibold text-primary">{selected.size} selected</span>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => setBulkSuspendOpen(true)}>
              <ShieldOff className="mr-1.5 h-3.5 w-3.5 text-destructive" /> {t("stu.bulk_suspend")}
            </Button>
            <Button size="sm" variant="outline" onClick={bulkGraduate} disabled={busy}>
              <GraduationCap className="mr-1.5 h-3.5 w-3.5" /> {t("stu.bulk_graduate")}
            </Button>
            <Button size="sm" variant="outline" onClick={bulkExportCSV}>
              <Download className="mr-1.5 h-3.5 w-3.5" /> {t("stu.bulk_export")}
            </Button>
          </div>
          <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setSelected(new Set())}>
            <X className="mr-1 h-3.5 w-3.5" /> {t("common2.deselect_all")}
          </Button>
        </div>
      )}

      {/* Bulk suspend dialog */}
      {bulkSuspendOpen && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 space-y-3">
          <p className="text-sm font-semibold text-destructive">{t("stu.bulk_suspend_title", { count: selected.size })}</p>
          <Input
            placeholder={t("stu.suspend_ph")}
            value={bulkSuspendReason}
            onChange={(e) => setBulkSuspendReason(e.target.value)}
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="destructive"
              onClick={bulkSuspend}
              disabled={busy || !bulkSuspendReason.trim()}
            >
              {busy ? t("stu.suspending") : t("stu.confirm_suspend")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => { setBulkSuspendOpen(false); setBulkSuspendReason(""); }}
            >
              {t("common.cancel")}
            </Button>
          </div>
        </div>
      )}

      {/* Student table */}
      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <div className="flex flex-col items-center gap-3">
              <div className="h-7 w-7 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              <p className="text-sm text-muted-foreground">{t("stu.loading")}</p>
            </div>
          </div>
        ) : (students ?? []).length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-16">
            <Users className="h-12 w-12 text-muted-foreground/25" />
            <p className="font-semibold text-muted-foreground">{t("stu.empty")}</p>
            <p className="text-sm text-muted-foreground">{t("stu.empty_sub")}</p>
            <Link to="/students/$id" params={{ id: "new" }} className="mt-1">
              <Button>
                <Plus className="mr-2 h-4 w-4" /> {t("stu.add_first")}
              </Button>
            </Link>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-secondary/50 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="pl-4 pr-2 py-3 w-8">
                    <button
                      onClick={toggleAll}
                      className="text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {selected.size === (students ?? []).length && (students ?? []).length > 0
                        ? <CheckSquare className="h-4 w-4 text-primary" />
                        : <Square className="h-4 w-4" />
                      }
                    </button>
                  </th>
                  <th className="px-3 py-3 w-10"></th>
                  <th className="px-4 py-3 text-left">{t("stu.col_admission")}</th>
                  <th className="px-4 py-3 text-left">{t("stu.col_name")}</th>
                  <th className="px-4 py-3 text-left hidden md:table-cell">{t("stu.col_programme")}</th>
                  <th className="px-4 py-3 text-left hidden sm:table-cell">{t("stu.col_nta")}</th>
                  <th className="px-4 py-3 text-left">{t("stu.col_status")}</th>
                  <th className="px-4 py-3 text-right">{t("stu.col_action")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {(students ?? []).map((s: any) => (
                  <tr
                    key={s.id}
                    className={`group hover:bg-secondary/40 transition-colors ${selected.has(s.id) ? "bg-primary/5" : ""}`}
                  >
                    {/* Checkbox */}
                    <td className="pl-4 pr-2 py-3">
                      <button
                        onClick={() => toggleOne(s.id)}
                        className="text-muted-foreground hover:text-primary transition-colors"
                      >
                        {selected.has(s.id)
                          ? <CheckSquare className="h-4 w-4 text-primary" />
                          : <Square className="h-4 w-4" />
                        }
                      </button>
                    </td>

                    {/* Photo thumbnail */}
                    <td className="px-3 py-3">
                      <div className="grid h-8 w-8 overflow-hidden rounded-full bg-secondary ring-1 ring-border place-items-center">
                        <UserIcon className="h-4 w-4 text-muted-foreground" />
                      </div>
                    </td>

                    {/* Admission # */}
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                      {s.admission_number}
                    </td>

                    {/* Name */}
                    <td className="px-4 py-3">
                      <p className="font-semibold leading-tight">{s.full_name}</p>
                      {s.is_visitor && (
                        <Badge variant="outline" className="mt-0.5 text-[10px]">visitor</Badge>
                      )}
                    </td>

                    {/* Programme */}
                    <td className="px-4 py-3 text-muted-foreground hidden md:table-cell">
                      {s.programme || <span className="text-muted-foreground/40">—</span>}
                    </td>

                    {/* NTA / Year */}
                    <td className="px-4 py-3 text-muted-foreground text-xs hidden sm:table-cell">
                      {[s.nta_level && `NTA ${s.nta_level}`, s.year_of_study && `Yr ${s.year_of_study}`]
                        .filter(Boolean).join(" · ") || "—"}
                    </td>

                    {/* Status */}
                    <td className="px-4 py-3">{statusBadge(s)}</td>

                    {/* Edit action */}
                    <td className="px-4 py-3 text-right">
                      <Link to="/students/$id" params={{ id: s.id }}>
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <Pencil className="h-3.5 w-3.5" /> {t("stu.edit_btn")}
                        </Button>
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {/* Table footer */}
        {(students ?? []).length > 0 && (
          <div className="border-t border-border bg-secondary/20 px-5 py-2.5 text-xs text-muted-foreground">
            {t("stu.total", { count: (students ?? []).length })}
            {selected.size > 0 && <span className="ml-2 text-primary font-semibold">· {selected.size} selected</span>}
          </div>
        )}
      </div>

      <p className="text-xs text-muted-foreground">{t("stu.tip")}</p>

      {/* Bulk import (CSV / JSON file · paste · API link) */}
      <BulkImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        onImported={refetch}
      />
    </div>
  );
}
