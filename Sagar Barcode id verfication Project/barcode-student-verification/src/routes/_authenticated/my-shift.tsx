import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Timer, Play, Square, CheckCircle2, XCircle, ScanLine,
  UserPlus, Clock, DoorOpen, ChevronDown, ChevronUp, ClipboardList,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/my-shift")({
  component: MyShiftPage,
});

function formatDuration(ms: number) {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`;
  return `${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`;
}

function MyShiftPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const qc = useQueryClient();

  const [selectedGate,   setSelectedGate]   = useState<string>("");
  const [startBusy,      setStartBusy]       = useState(false);
  const [showEnd,        setShowEnd]         = useState(false);
  const [handoverNotes,  setHandoverNotes]   = useState("");
  const [endBusy,        setEndBusy]         = useState(false);
  const [elapsed,        setElapsed]         = useState(0); // ms since shift started
  const [showHistory,    setShowHistory]     = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Active shift ──
  const { data: activeShift, isLoading: shiftLoading } = useQuery({
    queryKey: ["active-shift", user?.id],
    enabled: !!user,
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data } = await supabase
        .from("shifts")
        .select("*, gate:gate_id(name)")
        .eq("operator_id", user!.id)
        .is("ended_at", null)
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data ?? null;
    },
  });

  // ── Live scan stats for active shift ──
  const { data: liveStats } = useQuery({
    queryKey: ["shift-live-stats", activeShift?.id],
    enabled: !!activeShift,
    refetchInterval: 15_000,
    queryFn: async () => {
      const { data } = await supabase
        .from("access_logs")
        .select("decision")
        .eq("scanned_by", user!.id)
        .gte("scanned_at", activeShift!.started_at);
      const all      = data ?? [];
      const allowed  = all.filter((r: any) => r.decision === "allowed").length;
      const denied   = all.filter((r: any) => r.decision === "denied").length;
      const visitors = await supabase
        .from("students")
        .select("id", { count: "exact", head: true })
        .eq("is_visitor", true)
        .gte("created_at", activeShift!.started_at);
      return {
        total:    all.length,
        allowed,
        denied,
        unknown:  all.length - allowed - denied,
        visitors: visitors.count ?? 0,
      };
    },
  });

  // ── Available gates ──
  const { data: gates } = useQuery({
    queryKey: ["active-gates"],
    queryFn: async () =>
      (await supabase.from("gates").select("id,name").eq("is_active", true).order("name")).data ?? [],
  });

  // ── Shift history ──
  const { data: history } = useQuery({
    queryKey: ["shift-history", user?.id],
    enabled: !!user && showHistory,
    queryFn: async () => {
      const { data } = await supabase
        .from("shifts")
        .select("*, gate:gate_id(name)")
        .eq("operator_id", user!.id)
        .not("ended_at", "is", null)
        .order("started_at", { ascending: false })
        .limit(10);
      return data ?? [];
    },
  });

  // Live timer
  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (activeShift) {
      const tick = () => setElapsed(Date.now() - new Date(activeShift.started_at).getTime());
      tick();
      timerRef.current = setInterval(tick, 1000);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [activeShift?.id, activeShift?.started_at]);

  const startShift = async () => {
    if (!user) return;
    setStartBusy(true);
    const { error } = await supabase.from("shifts").insert({
      operator_id: user.id,
      gate_id:     selectedGate || null,
      started_at:  new Date().toISOString(),
    });
    setStartBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success(t("shift.started_toast"));
    qc.invalidateQueries({ queryKey: ["active-shift"] });
  };

  const endShift = async () => {
    if (!activeShift) return;
    setEndBusy(true);
    const { error } = await supabase
      .from("shifts")
      .update({
        ended_at:       new Date().toISOString(),
        handover_notes: handoverNotes.trim() || null,
        scans_total:    liveStats?.total    ?? 0,
        scans_allowed:  liveStats?.allowed  ?? 0,
        scans_denied:   liveStats?.denied   ?? 0,
        visitors_issued: liveStats?.visitors ?? 0,
      })
      .eq("id", activeShift.id);
    setEndBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success(t("shift.ended_toast"));
    setShowEnd(false);
    setHandoverNotes("");
    qc.invalidateQueries({ queryKey: ["active-shift"] });
    qc.invalidateQueries({ queryKey: ["shift-history"] });
  };

  if (shiftLoading) return null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t("shift.title")}</h1>
        <p className="text-sm text-muted-foreground">
          {activeShift ? t("shift.active_sub") : t("shift.idle_sub")}
        </p>
      </div>

      {/* ── NO ACTIVE SHIFT ── */}
      {!activeShift && (
        <div className="max-w-md rounded-xl border border-border bg-card p-8 shadow-sm text-center space-y-6">
          <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-primary/10">
            <Timer className="h-8 w-8 text-primary" />
          </div>
          <div>
            <p className="text-lg font-bold">{t("shift.no_shift")}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("shift.no_shift_desc")}
            </p>
          </div>
          <div className="space-y-3 text-left">
            <label className="block text-sm font-medium">{t("shift.gate_assignment")}</label>
            <Select value={selectedGate || "none"} onValueChange={(v) => setSelectedGate(v === "none" ? "" : v)}>
              <SelectTrigger><SelectValue placeholder={t("shift.select_gate")} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t("shift.no_gate")}</SelectItem>
                {(gates ?? []).map((g: any) => (
                  <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button className="w-full" size="lg" onClick={startShift} disabled={startBusy}>
            <Play className="mr-2 h-5 w-5" />
            {startBusy ? t("common.loading") : t("shift.start_btn")}
          </Button>
        </div>
      )}

      {/* ── ACTIVE SHIFT ── */}
      {activeShift && (
        <div className="space-y-5">
          {/* Shift info bar */}
          <div className="flex flex-wrap items-center gap-4 rounded-xl border border-success/30 bg-success/5 px-5 py-4">
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-success animate-pulse" />
              <span className="text-sm font-semibold text-success">{t("shift.shift_active")}</span>
            </div>
            <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <Clock className="h-4 w-4" />
              <span className="font-mono font-semibold text-foreground">{formatDuration(elapsed)}</span>
            </div>
            {activeShift.gate && (
              <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <DoorOpen className="h-4 w-4" />
                <span>{(activeShift.gate as any).name}</span>
              </div>
            )}
            <div className="ml-auto">
              <span className="text-xs text-muted-foreground">
                Started {new Date(activeShift.started_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </span>
            </div>
          </div>

          {/* Live stats */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { label: t("shift.stat_total"),    value: liveStats?.total    ?? 0, icon: ScanLine,     color: "text-foreground",   bg: "bg-secondary"        },
              { label: t("shift.stat_granted"),  value: liveStats?.allowed  ?? 0, icon: CheckCircle2, color: "text-success",      bg: "bg-success/10"       },
              { label: t("shift.stat_denied"),   value: liveStats?.denied   ?? 0, icon: XCircle,      color: "text-destructive",  bg: "bg-destructive/10"   },
              { label: t("shift.stat_visitors"), value: liveStats?.visitors ?? 0, icon: UserPlus,     color: "text-primary",      bg: "bg-primary/10"       },
            ].map(({ label, value, icon: Icon, color, bg }) => (
              <div key={label} className={cn("rounded-xl border border-border bg-card p-5 shadow-sm")}>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
                  <div className={cn("grid h-7 w-7 place-items-center rounded-lg", bg)}>
                    <Icon className={cn("h-3.5 w-3.5", color)} />
                  </div>
                </div>
                <p className={cn("text-3xl font-bold", color)}>{value}</p>
              </div>
            ))}
          </div>

          {/* End shift button / form */}
          <div className="rounded-xl border border-border bg-card p-5 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-semibold">{t("shift.end_btn")}</p>
                <p className="text-xs text-muted-foreground">{t("shift.end_desc")}</p>
              </div>
              <Button
                variant={showEnd ? "outline" : "destructive"}
                size="sm"
                onClick={() => setShowEnd((s) => !s)}
              >
                {showEnd
                  ? <><ChevronUp className="mr-1.5 h-3.5 w-3.5" /> {t("common.cancel")}</>
                  : <><Square className="mr-1.5 h-3.5 w-3.5" /> {t("shift.end_btn")}</>
                }
              </Button>
            </div>

            {showEnd && (
              <div className="space-y-3 border-t border-border pt-4 animate-in fade-in slide-in-from-top-1 duration-150">
                <label className="block text-sm font-medium">
                  {t("shift.col_handover")} <span className="text-muted-foreground font-normal">({t("common.optional")})</span>
                </label>
                <textarea
                  value={handoverNotes}
                  onChange={(e) => setHandoverNotes(e.target.value)}
                  placeholder={t("shift.handover_ph")}
                  rows={3}
                  autoFocus
                  className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-none"
                />
                <div className="flex justify-end gap-2">
                  <Button variant="outline" size="sm" onClick={() => setShowEnd(false)}>{t("common.cancel")}</Button>
                  <Button
                    size="sm"
                    className="bg-destructive hover:bg-destructive/90 text-destructive-foreground"
                    onClick={endShift}
                    disabled={endBusy}
                  >
                    <Square className="mr-1.5 h-3.5 w-3.5" />
                    {endBusy ? t("common.loading") : t("shift.confirm_end")}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Shift history ── */}
      <div className="rounded-xl border border-border bg-card shadow-sm">
        <button
          onClick={() => setShowHistory((s) => !s)}
          className="flex w-full items-center justify-between px-5 py-4 text-left"
        >
          <div className="flex items-center gap-2">
            <ClipboardList className="h-4 w-4 text-muted-foreground" />
            <span className="font-semibold">{t("shift.history_title")}</span>
          </div>
          {showHistory ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
        </button>

        {showHistory && (
          <div className="border-t border-border animate-in fade-in duration-150">
            {!history || history.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-muted-foreground">{t("shift.no_history")}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-secondary text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3 text-left">{t("shift.col_date")}</th>
                      <th className="px-4 py-3 text-left">{t("shift.col_duration")}</th>
                      <th className="px-4 py-3 text-left">{t("shift.col_gate")}</th>
                      <th className="px-4 py-3 text-right">{t("shift.col_scans")}</th>
                      <th className="px-4 py-3 text-right">{t("shift.col_granted")}</th>
                      <th className="px-4 py-3 text-right">{t("shift.col_denied")}</th>
                      <th className="px-4 py-3 text-left">{t("shift.col_handover")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {history.map((s: any) => {
                      const dur = s.ended_at
                        ? formatDuration(new Date(s.ended_at).getTime() - new Date(s.started_at).getTime())
                        : "—";
                      return (
                        <tr key={s.id} className="hover:bg-secondary/30">
                          <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                            {new Date(s.started_at).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" })}<br />
                            <span className="font-mono">{new Date(s.started_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                          </td>
                          <td className="px-4 py-3 font-mono text-xs">{dur}</td>
                          <td className="px-4 py-3 text-xs">{s.gate?.name ?? "—"}</td>
                          <td className="px-4 py-3 text-right font-semibold">{s.scans_total}</td>
                          <td className="px-4 py-3 text-right text-success font-semibold">{s.scans_allowed}</td>
                          <td className="px-4 py-3 text-right text-destructive font-semibold">{s.scans_denied}</td>
                          <td className="px-4 py-3 text-xs text-muted-foreground max-w-[200px] truncate" title={s.handover_notes ?? ""}>
                            {s.handover_notes ?? <span className="italic opacity-50">{t("common.none")}</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
