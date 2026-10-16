import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import ScannerStatus from "@/components/ScannerStatus";
import {
  CheckCircle2, XCircle, ScanLine, AlertTriangle, User as UserIcon,
  WifiOff, Wifi, RefreshCw, ArrowDownToLine, ArrowUpFromLine,
  ChevronDown, ChevronUp, Upload, Clock, QrCode, Keyboard,
  Search, ShieldOff, ShieldAlert, UserPlus, Activity,
  Maximize2, Minimize2, X, AlertOctagon, Eye, Pencil, Flag,
} from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Quagga from "@ericblade/quagga2";
import {
  cacheStudents, findCachedStudent, cachedStudentCount,
  enqueueScan, pendingQueue, clearQueueItem,
  type CachedStudent, type QueuedScan,
} from "@/lib/offline";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/verify")({
  component: VerifyPage,
});

type Decision  = "allowed" | "denied" | "unknown";
type Direction = "in" | "out";
type ScanMode  = "scanner" | "camera" | "lookup";

interface WatchlistHit {
  alert_level:  string;
  full_name:    string;
  reason:       string;
  description?: string | null;
  photo_url?:   string | null;
  photoSrc?:    string | null; // resolved signed URL
}

interface Result {
  decision:      Decision;
  reason?:       string;
  student?:      CachedStudent;
  photoUrl?:     string | null;
  scannedCode:   string;
  scannedAt:     Date;
  direction:     Direction;
  logId?:        string | null;
  watchlistHit?: WatchlistHit;
}

interface SessionStats {
  allowed:   number;
  denied:    number;
  unknown:   number;
  overrides: number;
}

// ─── Modal shell ────────────────────────────────────────────────────────────

function Modal({
  children, onClose, title,
}: { children: React.ReactNode; onClose: () => void; title: string }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 animate-in fade-in duration-150">
      <div className="w-full max-w-md rounded-2xl bg-card shadow-xl border border-border animate-in zoom-in-95 duration-150">
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <h3 className="font-bold text-foreground">{title}</h3>
          <button
            onClick={onClose}
            className="rounded-full p-1.5 hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}

// ─── Main page ───────────────────────────────────────────────────────────────

function VerifyPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const qc = useQueryClient();

  // ── Camera availability (requires HTTPS or localhost) ──────────────────
  // Chrome/Android blocks navigator.mediaDevices on plain HTTP (non-secure context).
  const cameraAvailable =
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia &&
    (typeof window !== "undefined"
      ? window.isSecureContext ||
        location.hostname === "localhost" ||
        location.hostname === "127.0.0.1"
      : false);

  // ── Core UI state ──
  const [code,        setCode]       = useState("");
  const [result,      setResult]     = useState<Result | null>(null);
  const [busy,        setBusy]       = useState(false);
  const [recent,      setRecent]     = useState<Result[]>([]);
  const [direction,   setDirection]  = useState<Direction>("in");
  const [gateId,      setGateId]     = useState<string>("");
  const [scanMode,    setScanMode]   = useState<ScanMode>("scanner");
  const [online,      setOnline]     = useState(typeof navigator !== "undefined" ? navigator.onLine : true);
  const [queueCount,  setQueueCount] = useState(0);
  const [cachedCount, setCachedCount]= useState(0);
  const [queueOpen,   setQueueOpen]  = useState(false);
  const [queueItems,  setQueueItems] = useState<QueuedScan[]>([]);
  const [cameraFlash, setCameraFlash]= useState(false);

  // ── Gate operator features ──
  const [lockdown,         setLockdown]         = useState(false);
  const [lockdownBusy,     setLockdownBusy]     = useState(false);
  const [kioskMode,        setKioskMode]        = useState(false);
  const [showShiftSummary, setShowShiftSummary] = useState(false);
  const [sessionStats,     setSessionStats]     = useState<SessionStats>({ allowed: 0, denied: 0, unknown: 0, overrides: 0 });
  const sessionStart = useRef(new Date());

  // Visitor modal
  const [showVisitorModal, setShowVisitorModal] = useState(false);
  const [visitorName,      setVisitorName]      = useState("");
  const [visitorPhone,     setVisitorPhone]     = useState("");
  const [visitorPurpose,   setVisitorPurpose]   = useState("");
  const [visitorHost,      setVisitorHost]      = useState("");
  const defaultVisitorDate = () => new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  const [visitorValidUntil, setVisitorValidUntil] = useState(defaultVisitorDate);
  const [visitorValidTime,  setVisitorValidTime]  = useState("17:00");
  const [visitorBusy,      setVisitorBusy]      = useState(false);

  // Manual lookup (mode 3)
  const [lookupQuery,   setLookupQuery]   = useState("");
  const [lookupResults, setLookupResults] = useState<CachedStudent[]>([]);
  const [lookupBusy,    setLookupBusy]    = useState(false);

  // Override
  const [showOverride,   setShowOverride]   = useState(false);
  const [overrideReason, setOverrideReason] = useState("");
  const [overrideBusy,   setOverrideBusy]   = useState(false);

  // Panic / incident
  const [showPanic, setShowPanic] = useState(false);
  const [panicNote, setPanicNote] = useState("");
  const [panicBusy, setPanicBusy] = useState(false);

  // ── Refs ──
  const inputRef             = useRef<HTMLInputElement>(null);
  const audioCtxRef          = useRef<AudioContext | null>(null);
  const cameraContainerRef   = useRef<HTMLDivElement>(null);
  const cameraBusyRef        = useRef(false);        // debounce rapid re-detections
  const quaggaStartedRef     = useRef(false);        // track whether Quagga.start() was called
  const lastScanRef          = useRef<{ code: string; at: number } | null>(null);
  const verifyRef         = useRef<(raw: string) => Promise<void>>(async () => {});
  const lookupInputRef    = useRef<HTMLInputElement>(null);
  const lookupTimerRef    = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // ── Remote data ──
  const { data: gates } = useQuery({
    queryKey: ["active-gates"],
    queryFn: async () =>
      (await supabase.from("gates").select("id,name").eq("is_active", true).order("name")).data ?? [],
  });

  const { data: settings } = useQuery({
    queryKey: ["scan-settings"],
    queryFn: async () =>
      (await supabase.from("settings").select("key,value")).data ?? [],
    refetchInterval: 30_000,
  });

  const antiPassbackSec  = Number(settings?.find((s) => s.key === "anti_passback_seconds")?.value  ?? 15);
  const defaultDirection = (settings?.find((s) => s.key === "default_direction")?.value as Direction) ?? "in";
  const accessEnabled    = settings?.find((s) => s.key === "access_hours_enabled")?.value === true;
  const accessStart      = String(settings?.find((s) => s.key === "access_hours_start")?.value  ?? '"06:00"').replace(/"/g, "");
  const accessEnd        = String(settings?.find((s) => s.key === "access_hours_end")?.value    ?? '"22:00"').replace(/"/g, "");
  const accessDays       = (settings?.find((s) => s.key === "access_days_of_week")?.value as number[]) ?? [1,2,3,4,5,6];

  // Sync lockdown state from DB settings
  useEffect(() => {
    const val = settings?.find((s) => s.key === "lockdown_active")?.value;
    if (val !== undefined) setLockdown(val === "true" || val === true);
  }, [settings]);

  // ── Effects ──
  useEffect(() => { setDirection(defaultDirection); }, [defaultDirection]);

  useEffect(() => {
    inputRef.current?.focus();
    refreshOfflineCounts();
  }, []);

  useEffect(() => {
    const onOnline  = () => { setOnline(true);  flushQueue(); };
    const onOffline = () => setOnline(false);
    window.addEventListener("online",  onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online",  onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  useEffect(() => {
    if (scanMode === "scanner") setTimeout(() => inputRef.current?.focus(), 50);
    if (scanMode === "lookup")  setTimeout(() => lookupInputRef.current?.focus(), 50);
  }, [scanMode]);

  // Kiosk / fullscreen
  useEffect(() => {
    if (kioskMode) {
      document.documentElement.requestFullscreen?.().catch(() => {});
    } else {
      if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    }
  }, [kioskMode]);

  useEffect(() => {
    const onFsChange = () => { if (!document.fullscreenElement) setKioskMode(false); };
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  // ── Offline helpers ──
  const refreshOfflineCounts = async () => {
    const items = await pendingQueue();
    setQueueCount(items.length);
    setQueueItems(items);
    setCachedCount(await cachedStudentCount());
  };

  const syncStudents = async () => {
    toast.info("Caching students for offline use…");
    const { data } = await supabase.from("students").select(
      "id,full_name,admission_number,barcode,programme,nta_level,year_of_study,status,photo_url,expires_at,is_visitor,parent_email,parent_phone,suspension_reason,suspended_until",
    );
    if (data) {
      await cacheStudents(data as CachedStudent[]);
      toast.success(`Cached ${data.length} students offline`);
      refreshOfflineCounts();
    }
  };

  const toggleQueue = async () => {
    if (!queueOpen) {
      const items = await pendingQueue();
      setQueueItems(items);
      setQueueCount(items.length);
    }
    setQueueOpen((o) => !o);
  };

  const flushQueue = async () => {
    const items = await pendingQueue();
    if (!items.length) return;
    toast.info(`Syncing ${items.length} queued scans…`);
    for (const item of items) {
      const { id, ...payload } = item;
      const { error } = await supabase.from("access_logs").insert(payload as any);
      if (!error && id) await clearQueueItem(id);
    }
    refreshOfflineCounts();
    toast.success("Queue synced");
  };

  // ── Audio feedback ──
  const beep = (ok: boolean) => {
    try {
      audioCtxRef.current ||= new (window.AudioContext || (window as any).webkitAudioContext)();
      const ctx  = audioCtxRef.current!;
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.frequency.value = ok ? 880 : 220;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + (ok ? 0.18 : 0.4));
      osc.start(); osc.stop(ctx.currentTime + (ok ? 0.2 : 0.45));
    } catch {/* ignore */}
  };

  // ── Lockdown toggle ──
  const toggleLockdown = async () => {
    setLockdownBusy(true);
    const newVal = !lockdown;
    try {
      await supabase
        .from("settings")
        .upsert({ key: "lockdown_active", value: newVal }, { onConflict: "key" });
      setLockdown(newVal);
      qc.invalidateQueries({ queryKey: ["scan-settings"] });
      toast[newVal ? "error" : "success"](
        newVal ? "🔒 LOCKDOWN ACTIVE — all access denied" : "🔓 Lockdown lifted — access restored",
        { duration: 6000 },
      );
    } catch {
      toast.error("Failed to update lockdown state");
    } finally {
      setLockdownBusy(false);
    }
  };

  // ── Core verify ──
  const verify = useCallback(async (raw: string) => {
    const scanned = raw.trim();
    if (!scanned) return;

    // Anti-passback
    if (
      lastScanRef.current &&
      lastScanRef.current.code === scanned &&
      Date.now() - lastScanRef.current.at < antiPassbackSec * 1000
    ) {
      toast.warning(`Anti-passback: wait ${antiPassbackSec}s before re-scanning`);
      setCode(""); return;
    }

    setBusy(true);
    try {
      // ── Lockdown ──────────────────────────────────────────────────────────
      if (lockdown) {
        const lockReason = "Emergency lockdown — access suspended";
        const logPayload = {
          scanned_code: scanned, student_id: null, decision: "denied" as Decision,
          reason: lockReason, scanned_by: user?.id ?? null,
          scanned_at: new Date().toISOString(), direction, gate_id: gateId || null,
        };
        if (online) await supabase.from("access_logs").insert(logPayload as any);
        else        await enqueueScan(logPayload as any);
        lastScanRef.current = { code: scanned, at: Date.now() };
        const r: Result = { decision: "denied", reason: lockReason, scannedCode: scanned, scannedAt: new Date(), direction };
        setResult(r); setRecent((p) => [r, ...p].slice(0, 10));
        setSessionStats((s) => ({ ...s, denied: s.denied + 1 }));
        beep(false); return;
      }

      // ── Time-based access ─────────────────────────────────────────────────
      if (accessEnabled) {
        const now         = new Date();
        const day         = now.getDay();
        const currentTime = `${String(now.getHours()).padStart(2,"0")}:${String(now.getMinutes()).padStart(2,"0")}`;
        if (!accessDays.includes(day) || currentTime < accessStart || currentTime >= accessEnd) {
          const closedReason = `Gate closed · access hours ${accessStart}–${accessEnd}`;
          const logPayload   = {
            scanned_code: scanned, student_id: null, decision: "denied" as Decision,
            reason: closedReason, scanned_by: user?.id ?? null,
            scanned_at: new Date().toISOString(), direction, gate_id: gateId || null,
          };
          if (online) await supabase.from("access_logs").insert(logPayload as any);
          else        await enqueueScan(logPayload as any);
          lastScanRef.current = { code: scanned, at: Date.now() };
          const r: Result = { decision: "denied", reason: closedReason, scannedCode: scanned, scannedAt: new Date(), direction };
          setResult(r); setRecent((p) => [r, ...p].slice(0, 10));
          setSessionStats((s) => ({ ...s, denied: s.denied + 1 }));
          beep(false); return;
        }
      }

      // ── Student lookup ────────────────────────────────────────────────────
      let student: CachedStudent | null = null;
      if (online) {
        const { data } = await supabase
          .from("students")
          .select("*")
          .or(`barcode.eq.${scanned},admission_number.eq.${scanned}`)
          .maybeSingle();
        student = (data as CachedStudent | null) ?? null;
      } else {
        student = await findCachedStudent(scanned);
      }

      let decision: Decision = "unknown";
      let reason: string | undefined;
      let photoUrl: string | null = null;
      const isPassExpired = (exp: string) => {
        const parsed = exp.length <= 10 ? new Date(`${exp}T23:59:59`) : new Date(exp);
        return parsed < new Date();
      };

      if (!student) {
        decision = "unknown";
        reason   = online ? "No student matches this code" : "Offline · not in cache";
      } else if (student.status === "suspended") {
        const until = student.suspended_until;
        if (until && new Date(until) < new Date()) {
          decision = "allowed";
        } else {
          decision = "denied";
          reason   = student.suspension_reason ? `Suspended: ${student.suspension_reason}` : "Student is suspended";
          if (until) reason += ` · until ${until}`;
        }
      } else if (student.status !== "active") {
        decision = "denied";
        reason   = `Student is ${student.status}`;
      } else if (student.expires_at && isPassExpired(student.expires_at)) {
        decision = "denied";
        reason   = `Pass expired ${student.expires_at}`;
      } else {
        decision = "allowed";
      }

      // ── Watchlist check ───────────────────────────────────────────────────
      // Even if the student is otherwise allowed, a watchlist match may
      // override the decision (deny/detain) or add a visible warning (info/warn).
      let watchlistHit: WatchlistHit | undefined;
      if (online) {
        const now = new Date().toISOString();
        const { data: wl } = await supabase
          .from("watchlist")
          .select("alert_level,full_name,reason,description,photo_url")
          .eq("is_active", true)
          .or(`expires_at.is.null,expires_at.gt.${now}`)
          .or(`barcode.eq.${scanned},id_number.eq.${scanned}`)
          .limit(1)
          .maybeSingle();
        if (wl) {
          // Resolve signed URL for the photo if present
          let photoSrc: string | null = null;
          if (wl.photo_url) {
            const { data: signed } = await supabase.storage
              .from("student-photos")
              .createSignedUrl(wl.photo_url, 120);
            photoSrc = signed?.signedUrl ?? null;
          }
          watchlistHit = {
            alert_level: wl.alert_level,
            full_name:   wl.full_name,
            reason:      wl.reason,
            description: wl.description ?? null,
            photo_url:   wl.photo_url ?? null,
            photoSrc,
          };
          // deny / detain — force denial regardless of student status
          if (wl.alert_level === "deny" || wl.alert_level === "detain") {
            decision = "denied";
            reason   = `WATCHLIST (${wl.alert_level.toUpperCase()}): ${wl.reason}`;
          }
        }
      }

      if (online && student?.photo_url) {
        const { data: signed } = await supabase.storage
          .from("student-photos")
          .createSignedUrl(student.photo_url, 60);
        photoUrl = signed?.signedUrl ?? null;
      }

      const logPayload = {
        scanned_code: scanned, student_id: student?.id ?? null,
        decision, reason: reason ?? null,
        scanned_by: user?.id ?? null,
        scanned_at: new Date().toISOString(),
        direction, gate_id: gateId || null,
      };

      let insertedLogId: string | null = null;
      if (online) {
        const { data: logRow } = await supabase
          .from("access_logs")
          .insert(logPayload as any)
          .select("id")
          .single();
        insertedLogId = logRow?.id ?? null;

        if (decision === "denied" && student?.parent_email) {
          supabase.functions.invoke("notify-parent", {
            body: { student_id: student.id, log_id: insertedLogId, reason: reason ?? null, scanned_at: logPayload.scanned_at },
          }).catch(() => {});
        }
      } else {
        await enqueueScan(logPayload as any);
        refreshOfflineCounts();
      }

      lastScanRef.current = { code: scanned, at: Date.now() };
      const r: Result = {
        decision, reason, student: student ?? undefined,
        photoUrl, scannedCode: scanned, scannedAt: new Date(), direction,
        logId: insertedLogId, watchlistHit,
      };
      setResult(r);
      setRecent((p) => [r, ...p].slice(0, 10));
      setSessionStats((s) => ({ ...s, [decision]: s[decision] + 1 }));
      beep(decision === "allowed");
    } finally {
      setBusy(false);
      setCode("");
      if (scanMode === "scanner") setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [online, user?.id, direction, gateId, antiPassbackSec, accessEnabled, accessStart, accessEnd, accessDays, scanMode, lockdown]);

  useEffect(() => { verifyRef.current = verify; }, [verify]);

  // ── Camera scanning (Quagga2 — optimised for 1D barcodes from webcam) ──
  useEffect(() => {
    if (scanMode !== "camera") {
      // Stop Quagga if switching away from camera mode
      if (quaggaStartedRef.current) {
        try { Quagga.stop(); } catch { /* ignore */ }
        quaggaStartedRef.current = false;
      }
      return;
    }

    // Guard: camera requires a secure context (HTTPS or localhost)
    if (!cameraAvailable) {
      const isHttp = typeof location !== "undefined" && location.protocol === "http:";
      toast.error(
        isHttp
          ? "Camera blocked: browser requires HTTPS for camera access. Use the barcode scanner instead."
          : "Camera is not available on this device or browser.",
        { duration: 8000 },
      );
      setScanMode("scanner");
      return;
    }

    if (!cameraContainerRef.current) return;

    let stopped = false;

    const onDetected = (result: any) => {
      if (stopped || cameraBusyRef.current) return;
      const code: string | null = result?.codeResult?.code ?? null;
      if (!code) return;
      // 1.5 s debounce: suppress repeated detection of the same barcode
      cameraBusyRef.current = true;
      setTimeout(() => { cameraBusyRef.current = false; }, 1500);
      setCameraFlash(true);
      setTimeout(() => setCameraFlash(false), 600);
      verifyRef.current(code);
    };

    Quagga.init(
      {
        inputStream: {
          type:        "LiveStream",
          target:      cameraContainerRef.current,
          constraints: {
            width:      { ideal: 1280 },
            height:     { ideal: 720 },
            facingMode: "environment",   // rear camera if on a phone/tablet
          },
        },
        locate:       true,
        numOfWorkers: typeof navigator !== "undefined"
          ? Math.min(navigator.hardwareConcurrency ?? 2, 4)
          : 2,
        decoder: {
          // 1D formats only — Code 128 is the most common on student ID cards
          readers: [
            "code_128_reader",
            "code_39_reader",
            "code_93_reader",
            "ean_reader",
            "ean_8_reader",
            "i2of5_reader",
            "codabar_reader",
          ],
          debug: { drawBoundingBox: false, showFrequency: false, drawScanline: false, showPattern: false },
        },
      },
      (err: any) => {
        if (err) {
          const name = err?.name ?? "";
          const msg  = name === "NotAllowedError"
            ? "Camera permission denied. Please allow camera access in your browser settings."
            : name === "NotFoundError"
            ? "No camera found on this device."
            : name === "NotReadableError"
            ? "Camera is in use by another app. Close it and try again."
            : err?.message || String(err) || "Camera unavailable";
          toast.error(msg, { duration: 6000 });
          setScanMode("scanner");
          return;
        }
        if (!stopped) {
          Quagga.onDetected(onDetected);
          Quagga.start();
          quaggaStartedRef.current = true;
        }
      },
    );

    return () => {
      stopped = true;
      Quagga.offDetected(onDetected);
      if (quaggaStartedRef.current) {
        try { Quagga.stop(); } catch { /* ignore */ }
        quaggaStartedRef.current = false;
      }
    };
  }, [scanMode, cameraAvailable]);

  // ── Manual lookup ──
  const doLookup = useCallback(async (q: string) => {
    if (!q.trim()) { setLookupResults([]); return; }
    setLookupBusy(true);
    try {
      const { data } = await supabase
        .from("students")
        .select("id,full_name,admission_number,barcode,programme,nta_level,year_of_study,status,photo_url,expires_at,is_visitor,parent_email,parent_phone,suspension_reason,suspended_until")
        .or(`full_name.ilike.%${q}%,admission_number.ilike.%${q}%`)
        .limit(10);
      setLookupResults((data as CachedStudent[]) ?? []);
    } catch { setLookupResults([]); }
    finally   { setLookupBusy(false); }
  }, []);

  const onLookupChange = (val: string) => {
    setLookupQuery(val);
    clearTimeout(lookupTimerRef.current);
    lookupTimerRef.current = setTimeout(() => doLookup(val), 400);
  };

  // ── Visitor walk-in ──
  const registerVisitor = async () => {
    if (!visitorName.trim()) { toast.error("Visitor name is required"); return; }
    setVisitorBusy(true);
    const tomorrow = defaultVisitorDate();
    try {
      const now  = new Date();
      const year = now.getFullYear();
      const seq  = String(now.getTime()).slice(-5);
      const code = `VIS/${year}/${seq}`;
      const expiresAt = `${visitorValidUntil || tomorrow}T${visitorValidTime || "23:59"}`;
      const { data: vis, error } = await supabase
        .from("students")
        .insert({
          full_name:         visitorName.trim(),
          admission_number:  code,
          barcode:           code,
          is_visitor:        true,
          status:            "active",
          expires_at:        expiresAt,
          parent_phone:      visitorPhone || null,
          suspension_reason: visitorPurpose
            ? `Purpose: ${visitorPurpose}${visitorHost ? ` | Host: ${visitorHost}` : ""}`
            : null,
        } as any)
        .select("*")
        .single();
      if (error) throw error;
      // Log the walk-in entry directly — bypass access hours since the operator
      // is physically present and registering this visitor at the gate right now.
      await supabase.from("access_logs").insert({
        scanned_code: code,
        student_id:   vis?.id ?? null,
        decision:     "allowed",
        direction:    "in",
        reason:       "Visitor walk-in",
        scanned_by:   user?.id ?? null,
        scanned_at:   new Date().toISOString(),
        gate_id:      gateId || null,
      } as any);
      setShowVisitorModal(false);
      setVisitorName(""); setVisitorPhone(""); setVisitorPurpose(""); setVisitorHost("");
      setVisitorValidUntil(tomorrow); setVisitorValidTime("17:00");
      toast.success(t("verify.visitor_issued", { code }));
    } catch (e: any) {
      toast.error(e.message || "Failed to register visitor");
    } finally {
      setVisitorBusy(false);
    }
  };

  // ── Access override ──
  const doOverride = async () => {
    if (!result?.logId) { toast.error("No log entry to override"); return; }
    if (!overrideReason.trim()) { toast.error("Override reason is required"); return; }
    setOverrideBusy(true);
    try {
      await supabase
        .from("access_logs")
        .update({ decision: "allowed", overridden: true, operator_note: overrideReason.trim() } as any)
        .eq("id", result.logId);
      setResult((r) => r ? { ...r, decision: "allowed", reason: `Override: ${overrideReason}` } : r);
      setSessionStats((s) => ({
        ...s,
        denied:    Math.max(0, s.denied - 1),
        allowed:   s.allowed + 1,
        overrides: s.overrides + 1,
      }));
      beep(true);
      setShowOverride(false);
      setOverrideReason("");
      toast.success("Access overridden — entry logged with your identity");
    } catch (e: any) {
      toast.error(e.message || "Override failed");
    } finally {
      setOverrideBusy(false);
    }
  };

  // ── Panic / incident ──
  const triggerPanic = async () => {
    setPanicBusy(true);
    try {
      await supabase
        .from("access_logs")
        .insert({
          scanned_code: "INCIDENT",
          student_id:   null,
          decision:     "denied",
          reason:       `INCIDENT ALERT: ${panicNote || "Security incident at gate"}`,
          scanned_by:   user?.id ?? null,
          scanned_at:   new Date().toISOString(),
          direction,
          gate_id:      gateId || null,
        } as any);
      toast.error("🚨 Incident alert logged — admin has been notified", { duration: 8000 });
      setShowPanic(false);
      setPanicNote("");
    } catch {
      toast.error("Failed to log incident");
    } finally {
      setPanicBusy(false);
    }
  };

  const onSubmit = (e: React.FormEvent) => { e.preventDefault(); verify(code); };

  // (auto-clear is now handled inside ScanResultModal with countdown)

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className={`space-y-4 ${kioskMode ? "fixed inset-0 z-50 overflow-auto bg-background p-4" : ""}`}>

      {/* ── Emergency lockdown banner ── */}
      {lockdown && (
        <div className="flex items-center justify-between gap-3 rounded-xl bg-destructive px-5 py-3 text-destructive-foreground shadow-lg animate-in fade-in duration-300">
          <div className="flex items-center gap-2.5">
            <ShieldOff className="h-5 w-5 shrink-0 animate-pulse" />
            <span className="font-bold tracking-wide">{t("verify.lockdown_active")}</span>
            <span className="hidden sm:inline text-sm opacity-80">{t("verify.lockdown_sub")}</span>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="shrink-0 border-destructive-foreground/30 text-destructive-foreground hover:bg-destructive-foreground/10"
            onClick={toggleLockdown}
            disabled={lockdownBusy}
          >
            {lockdownBusy ? "…" : t("verify.lift_lockdown")}
          </Button>
        </div>
      )}

      {/* ── Page header ── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{t("verify.page_title")}</h1>
          <p className="text-sm text-muted-foreground">{t("verify.page_subtitle")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs ${online ? "bg-success/15 text-success" : "bg-warning/15 text-warning"}`}>
            {online ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
            {online ? t("verify.online") : t("verify.offline")}
          </span>
          {queueCount > 0 && (
            <button
              onClick={toggleQueue}
              className="inline-flex items-center gap-1 rounded-full bg-warning/15 px-2 py-1 text-xs text-warning hover:bg-warning/25 transition-colors"
            >
              {queueOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              {queueCount} {t("verify.queued")}
            </button>
          )}
          <span className="rounded-full bg-secondary px-2 py-1 text-xs text-muted-foreground">{cachedCount} {t("verify.cached")}</span>
          <Button size="sm" variant="outline" onClick={syncStudents} disabled={!online}>
            <RefreshCw className="mr-1 h-3 w-3" /> {t("verify.sync")}
          </Button>
          <Button
            size="sm"
            variant={kioskMode ? "default" : "outline"}
            onClick={() => setKioskMode((k) => !k)}
          >
            {kioskMode ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
          </Button>
        </div>
      </div>

      {/* ── Gate controls ── */}
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card p-4 shadow-sm">
        {/* Direction */}
        <div className="flex gap-1 rounded-md bg-secondary p-1">
          <button
            onClick={() => setDirection("in")}
            className={`flex items-center gap-1 rounded px-3 py-1.5 text-sm font-medium transition-colors ${direction === "in" ? "bg-success text-success-foreground" : "text-muted-foreground"}`}
          >
            <ArrowDownToLine className="h-4 w-4" /> {t("verify.entry")}
          </button>
          <button
            onClick={() => setDirection("out")}
            className={`flex items-center gap-1 rounded px-3 py-1.5 text-sm font-medium transition-colors ${direction === "out" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
          >
            <ArrowUpFromLine className="h-4 w-4" /> {t("verify.exit")}
          </button>
        </div>

        {/* Gate selector */}
        <div className="min-w-[180px] flex-1">
          <Select value={gateId || "none"} onValueChange={(v) => setGateId(v === "none" ? "" : v)}>
            <SelectTrigger><SelectValue placeholder={t("verify.select_gate")} /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">{t("verify.no_gate")}</SelectItem>
              {(gates ?? []).map((g) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        {/* Lockdown toggle */}
        <button
          onClick={toggleLockdown}
          disabled={lockdownBusy}
          className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold transition-all ${
            lockdown
              ? "border-destructive/50 bg-destructive/10 text-destructive hover:bg-destructive/20"
              : "border-border bg-card text-muted-foreground hover:border-destructive/40 hover:text-destructive"
          }`}
        >
          {lockdown ? <ShieldOff className="h-4 w-4" /> : <ShieldAlert className="h-4 w-4" />}
          {lockdown ? t("verify.locked_down") : t("verify.lockdown")}
        </button>

        {/* Shift summary toggle */}
        <button
          onClick={() => setShowShiftSummary((s) => !s)}
          className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-secondary transition-colors"
        >
          <Activity className="h-4 w-4" />
          {t("verify.summary")}
          {(sessionStats.allowed + sessionStats.denied + sessionStats.unknown) > 0 && (
            <span className="rounded-full bg-primary/15 px-1.5 text-xs text-primary">
              {sessionStats.allowed + sessionStats.denied + sessionStats.unknown}
            </span>
          )}
        </button>
      </div>

      {/* ── Shift summary panel ── */}
      {showShiftSummary && (
        <div className="rounded-xl border border-border bg-card p-5 shadow-sm animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-primary" />
              <span className="font-semibold">{t("verify.shift_summary")}</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs text-muted-foreground">
                {t("verify.shift_since", { time: sessionStart.current.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) })}
              </span>
              <button onClick={() => setShowShiftSummary(false)} className="text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: t("verify.shift_granted"),   value: sessionStats.allowed,   color: "text-success",    bg: "bg-success/10"    },
              { label: t("verify.shift_denied"),    value: sessionStats.denied,    color: "text-destructive", bg: "bg-destructive/10"},
              { label: t("verify.shift_unknown"),   value: sessionStats.unknown,   color: "text-warning",     bg: "bg-warning/10"    },
              { label: t("verify.shift_overrides"), value: sessionStats.overrides, color: "text-primary",     bg: "bg-primary/10"    },
            ].map(({ label, value, color, bg }) => (
              <div key={label} className={`flex flex-col items-center rounded-xl ${bg} py-4`}>
                <span className={`text-3xl font-bold ${color}`}>{value}</span>
                <span className="mt-1 text-xs font-medium text-muted-foreground">{label}</span>
              </div>
            ))}
          </div>
          <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground border-t border-border pt-3">
            <span>{t("verify.shift_total")} <strong className="text-foreground">{sessionStats.allowed + sessionStats.denied + sessionStats.unknown}</strong></span>
            <Link to="/inside" className="flex items-center gap-1 text-primary hover:underline font-medium">
              <Eye className="h-3 w-3" /> {t("verify.whos_inside")}
            </Link>
          </div>
        </div>
      )}

      {/* ── Gate operator tools ── */}
      {!kioskMode && (
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowVisitorModal(true)}>
            <UserPlus className="mr-1.5 h-3.5 w-3.5" /> {t("verify.visitor_walkin")}
          </Button>
          <Link to="/inside">
            <Button variant="outline" size="sm">
              <Eye className="mr-1.5 h-3.5 w-3.5" /> {t("verify.whos_inside")}
            </Button>
          </Link>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowPanic(true)}
            className="border-destructive/30 text-destructive hover:bg-destructive/10"
          >
            <AlertOctagon className="mr-1.5 h-3.5 w-3.5" /> {t("verify.incident_alert")}
          </Button>
        </div>
      )}

      {/* ══════════════════════════════════════════
          SCAN MODE SWITCHER — 3 cards
      ══════════════════════════════════════════ */}
      <div className="grid grid-cols-3 gap-3">
        {/* Card: Hardware barcode scanner */}
        <button
          onClick={() => setScanMode("scanner")}
          className={`group flex flex-col items-center gap-2.5 rounded-xl border-2 px-3 py-5 text-center transition-all duration-200 ${
            scanMode === "scanner"
              ? "border-primary bg-primary/5 shadow-sm"
              : "border-border bg-card text-muted-foreground hover:border-primary/40 hover:bg-primary/[0.03]"
          }`}
        >
          <div className={`grid h-11 w-11 place-items-center rounded-xl ${scanMode === "scanner" ? "bg-primary/15 text-primary" : "bg-secondary text-muted-foreground"}`}>
            <Keyboard className="h-5 w-5" />
          </div>
          <div>
            <p className={`text-sm font-semibold leading-tight ${scanMode === "scanner" ? "text-primary" : ""}`}>{t("verify.mode_scanner")}</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">{t("verify.mode_scanner_sub")}</p>
          </div>
          {scanMode === "scanner" && (
            <span className="rounded-full bg-primary/15 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-primary">{t("verify.mode_active")}</span>
          )}
        </button>

        {/* Card: Camera / QR */}
        <button
          onClick={() => {
            if (!cameraAvailable) {
              toast.error(
                location.protocol === "http:"
                  ? "Camera requires HTTPS. Use barcode scanner or access via HTTPS."
                  : "Camera not available on this device.",
                { duration: 6000 },
              );
              return;
            }
            setScanMode("camera");
          }}
          title={!cameraAvailable ? "Camera unavailable — requires HTTPS" : undefined}
          className={`group flex flex-col items-center gap-2.5 rounded-xl border-2 px-3 py-5 text-center transition-all duration-200 ${
            !cameraAvailable
              ? "border-border bg-card/50 opacity-50 cursor-not-allowed"
              : scanMode === "camera"
              ? "border-primary bg-primary/5 shadow-sm"
              : "border-border bg-card text-muted-foreground hover:border-primary/40 hover:bg-primary/[0.03]"
          }`}
        >
          <div className={`grid h-11 w-11 place-items-center rounded-xl ${
            !cameraAvailable ? "bg-secondary text-muted-foreground/50"
            : scanMode === "camera" ? "bg-primary/15 text-primary"
            : "bg-secondary text-muted-foreground"
          }`}>
            <QrCode className="h-5 w-5" />
          </div>
          <div>
            <p className={`text-sm font-semibold leading-tight ${
              !cameraAvailable ? "text-muted-foreground/60"
              : scanMode === "camera" ? "text-primary" : ""
            }`}>{t("verify.mode_camera")}</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {!cameraAvailable ? t("verify.mode_camera_https") : t("verify.mode_camera_sub")}
            </p>
          </div>
          {!cameraAvailable && (
            <span className="rounded-full bg-warning/15 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-warning">
              HTTPS only
            </span>
          )}
          {cameraAvailable && scanMode === "camera" && (
            <span className="flex items-center gap-1 rounded-full bg-primary/15 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-primary">
              <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" /> {t("common.live")}
            </span>
          )}
        </button>

        {/* Card: Manual lookup */}
        <button
          onClick={() => setScanMode("lookup")}
          className={`group flex flex-col items-center gap-2.5 rounded-xl border-2 px-3 py-5 text-center transition-all duration-200 ${
            scanMode === "lookup"
              ? "border-primary bg-primary/5 shadow-sm"
              : "border-border bg-card text-muted-foreground hover:border-primary/40 hover:bg-primary/[0.03]"
          }`}
        >
          <div className={`grid h-11 w-11 place-items-center rounded-xl ${scanMode === "lookup" ? "bg-primary/15 text-primary" : "bg-secondary text-muted-foreground"}`}>
            <Search className="h-5 w-5" />
          </div>
          <div>
            <p className={`text-sm font-semibold leading-tight ${scanMode === "lookup" ? "text-primary" : ""}`}>{t("verify.mode_lookup")}</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">{t("verify.mode_lookup_sub")}</p>
          </div>
          {scanMode === "lookup" && (
            <span className="rounded-full bg-primary/15 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-primary">{t("verify.mode_active")}</span>
          )}
        </button>
      </div>

      {/* ── Scanner device status (shown in scanner mode) ── */}
      {scanMode === "scanner" && <ScannerStatus />}

      {/* ══════════════════════════════════════════
          MODE 1 — HARDWARE BARCODE SCANNER
      ══════════════════════════════════════════ */}
      {scanMode === "scanner" && (
        <div className="overflow-hidden rounded-xl border-2 border-primary/20 bg-card shadow-sm animate-in fade-in duration-200">
          <div className="flex items-center gap-4 border-b border-border bg-primary/[0.03] px-5 py-4">
            <div className="relative shrink-0">
              <span className="absolute inset-0 rounded-full bg-primary/20 animate-ping" />
              <div className="relative grid h-12 w-12 place-items-center rounded-full bg-primary/10 ring-1 ring-primary/25">
                <ScanLine className="h-6 w-6 text-primary" />
              </div>
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-bold text-foreground">{t("verify.ready_title")}</p>
              <p className="text-xs text-muted-foreground">{t("verify.ready_sub")}</p>
            </div>
            {busy && (
              <span className="shrink-0 rounded-full bg-warning/15 px-2.5 py-1 text-xs font-semibold text-warning">{t("verify.verifying")}</span>
            )}
          </div>
          <form onSubmit={onSubmit} className="p-4">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <ScanLine className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  ref={inputRef}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && !busy && code.trim() && (e.preventDefault(), verify(code))}
                  placeholder={t("verify.scan_placeholder")}
                  autoFocus
                  autoComplete="off"
                  disabled={busy}
                  className="h-16 pl-12 text-xl font-mono tracking-wide"
                />
              </div>
              <Button type="submit" disabled={busy || !code.trim()} className="h-16 px-6 text-base">
                {busy ? "…" : t("verify.verify_btn")}
              </Button>
            </div>
            <p className="mt-2.5 text-center text-xs text-muted-foreground">
              {t("verify.enter_hint")}{" "}
              <kbd className="rounded border border-border bg-secondary px-1 py-0.5 font-mono text-[10px]">Enter</kbd>
            </p>
          </form>
        </div>
      )}

      {/* ══════════════════════════════════════════
          MODE 2 — CAMERA / QR CODE
      ══════════════════════════════════════════ */}
      {scanMode === "camera" && (
        <div className="overflow-hidden rounded-xl border-2 border-primary/20 bg-black shadow-sm animate-in fade-in duration-200">
          <div className="relative">
            {/* Quagga2 injects <video> + <canvas> into this div. The canvas (debug overlay)
                is hidden; the video is stretched to fill the container. */}
            <div
              ref={cameraContainerRef}
              className="block w-full aspect-video overflow-hidden bg-black [&_video]:w-full [&_video]:h-full [&_video]:object-cover [&_canvas]:hidden"
            />
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <div className="absolute inset-0" style={{ boxShadow: "inset 0 0 80px 30px rgba(0,0,0,0.65)" }} />
              {/* Wide rectangle — matches the aspect ratio of a 1D linear barcode */}
              <div className="relative z-10 h-20 w-72 sm:h-24 sm:w-96">
                <span className="absolute top-0    left-0  h-6 w-8 border-t-[3px] border-l-[3px] border-white rounded-tl-sm" />
                <span className="absolute top-0    right-0 h-6 w-8 border-t-[3px] border-r-[3px] border-white rounded-tr-sm" />
                <span className="absolute bottom-0 left-0  h-6 w-8 border-b-[3px] border-l-[3px] border-white rounded-bl-sm" />
                <span className="absolute bottom-0 right-0 h-6 w-8 border-b-[3px] border-r-[3px] border-white rounded-br-sm" />
                <div
                  className="absolute inset-x-0 h-0.5 rounded-full animate-scan-line"
                  style={{
                    background: "linear-gradient(to right, transparent, oklch(0.68 0.14 155), transparent)",
                    boxShadow:  "0 0 8px 2px oklch(0.68 0.14 155 / 0.6)",
                  }}
                />
                {cameraFlash && (
                  <div className="absolute inset-0 rounded-sm bg-success/40 animate-in fade-in zoom-in-95 duration-150" />
                )}
              </div>
              <div className="relative z-10 mt-5 flex items-center gap-2 rounded-full bg-black/60 px-4 py-1.5 backdrop-blur-sm">
                <span className="h-2 w-2 rounded-full bg-primary animate-pulse" />
                <span className="text-xs font-semibold text-white/90 tracking-wide">{t("verify.camera_scanning")}</span>
              </div>
            </div>
            {busy && (
              <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/60">
                <div className="flex flex-col items-center gap-3">
                  <div className="h-10 w-10 rounded-full border-2 border-primary border-t-transparent animate-spin" />
                  <p className="text-sm font-semibold text-white">{t("verify.verifying")}</p>
                </div>
              </div>
            )}
          </div>
          <div className="flex items-center justify-between gap-3 bg-card px-5 py-3">
            <div className="flex items-center gap-2.5">
              <QrCode className="h-4 w-4 shrink-0 text-muted-foreground" />
              <p className="text-xs text-muted-foreground leading-tight">{t("verify.camera_hint")}</p>
            </div>
            <Button size="sm" variant="ghost" onClick={() => setScanMode("scanner")} className="shrink-0 text-xs">
              <Keyboard className="mr-1.5 h-3.5 w-3.5" /> {t("verify.use_scanner")}
            </Button>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════
          MODE 3 — MANUAL STUDENT LOOKUP
      ══════════════════════════════════════════ */}
      {scanMode === "lookup" && (
        <div className="overflow-hidden rounded-xl border-2 border-primary/20 bg-card shadow-sm animate-in fade-in duration-200">
          <div className="border-b border-border bg-primary/[0.03] px-5 py-4">
            <div className="flex items-center gap-3">
              <div className="grid h-10 w-10 place-items-center rounded-full bg-primary/10">
                <Search className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="font-bold">{t("verify.lookup_title")}</p>
                <p className="text-xs text-muted-foreground">{t("verify.lookup_sub")}</p>
              </div>
            </div>
          </div>
          <div className="p-4 space-y-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                ref={lookupInputRef}
                value={lookupQuery}
                onChange={(e) => onLookupChange(e.target.value)}
                placeholder={t("verify.lookup_placeholder")}
                autoFocus
                className="h-12 pl-11"
              />
              {lookupBusy && (
                <div className="absolute right-4 top-1/2 -translate-y-1/2 h-4 w-4 rounded-full border-2 border-primary border-t-transparent animate-spin" />
              )}
            </div>

            {lookupResults.length > 0 && (
              <div className="divide-y divide-border rounded-lg border border-border overflow-hidden">
                {lookupResults.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => {
                      verify(s.barcode || s.admission_number);
                      setLookupQuery(""); setLookupResults([]);
                      setScanMode("scanner");
                    }}
                    disabled={busy}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-secondary transition-colors disabled:opacity-60"
                  >
                    <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-secondary">
                      <UserIcon className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm truncate">{s.full_name}</p>
                      <p className="text-xs text-muted-foreground">
                        {s.admission_number}{s.programme ? ` · ${s.programme}` : ""}
                      </p>
                    </div>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                      s.status === "active" ? "bg-success/15 text-success" : "bg-destructive/15 text-destructive"
                    }`}>
                      {s.status}
                    </span>
                  </button>
                ))}
              </div>
            )}

            {lookupQuery.length > 2 && lookupResults.length === 0 && !lookupBusy && (
              <p className="text-center text-sm text-muted-foreground py-6">
                {t("verify.lookup_no_results", { query: lookupQuery })}
              </p>
            )}
          </div>
        </div>
      )}

      {/* ── Offline queue viewer ── */}
      {queueOpen && (
        <div className="rounded-xl border border-warning/40 bg-warning/5 shadow-sm">
          <div className="flex items-center justify-between border-b border-warning/20 px-5 py-3">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-warning" />
              <span className="text-sm font-semibold">{t("verify.queue_title")}</span>
              <span className="rounded-full bg-warning/20 px-2 py-0.5 text-xs text-warning">{t("verify.queue_pending", { count: queueItems.length })}</span>
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={flushQueue} disabled={!online || queueItems.length === 0}>
                <Upload className="mr-1.5 h-3 w-3" /> {t("verify.queue_sync_now")}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setQueueOpen(false)}>
                <ChevronUp className="h-4 w-4" />
              </Button>
            </div>
          </div>
          {queueItems.length === 0 ? (
            <div className="px-5 py-6 text-center text-sm text-muted-foreground">{t("verify.queue_empty")}</div>
          ) : (
            <div className="divide-y divide-warning/10 max-h-72 overflow-y-auto">
              {queueItems.map((item, i) => (
                <div key={item.id ?? i} className="flex items-center gap-3 px-5 py-2.5 text-sm">
                  {item.decision === "allowed"
                    ? <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
                    : item.decision === "denied"
                    ? <XCircle className="h-4 w-4 shrink-0 text-destructive" />
                    : <AlertTriangle className="h-4 w-4 shrink-0 text-warning" />
                  }
                  <span className="rounded bg-secondary px-1.5 text-[10px] uppercase text-muted-foreground">{item.direction ?? "—"}</span>
                  <span className="flex-1 min-w-0 truncate font-mono text-xs">{item.scanned_code}</span>
                  {item.reason && <span className="text-xs text-muted-foreground truncate max-w-[180px]">{item.reason}</span>}
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {new Date(item.scanned_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>
              ))}
            </div>
          )}
          {!online && queueItems.length > 0 && (
            <div className="border-t border-warning/20 px-5 py-2 text-xs text-muted-foreground">
              <WifiOff className="mr-1 inline h-3 w-3" /> {t("verify.queue_restore_hint")}
            </div>
          )}
        </div>
      )}

      {/* ── Scan result popup modal ── */}
      {result && (
        <ScanResultModal
          result={result}
          onOverride={result.logId && result.decision === "denied" ? () => setShowOverride(true) : undefined}
          onDismiss={() => {
            setResult(null);
            if (scanMode === "scanner") setTimeout(() => inputRef.current?.focus(), 50);
          }}
        />
      )}

      {/* ── Recent scans ── */}
      {recent.length > 0 && !kioskMode && (
        <div className="rounded-xl border border-border bg-card shadow-sm">
          <div className="flex items-center justify-between border-b border-border px-5 py-3">
            <span className="text-sm font-semibold">{t("verify.recent_title")}</span>
            <span className="text-xs text-muted-foreground">{t("verify.recent_count", { count: recent.length })}</span>
          </div>
          <div className="divide-y divide-border">
            {recent.map((r, i) => (
              <div key={i} className="flex items-center gap-3 px-5 py-2 text-sm">
                {r.decision === "allowed"
                  ? <CheckCircle2 className="h-4 w-4 text-success" />
                  : r.decision === "denied"
                  ? <XCircle className="h-4 w-4 text-destructive" />
                  : <AlertTriangle className="h-4 w-4 text-warning" />
                }
                <span className="rounded bg-secondary px-1.5 text-[10px] uppercase text-muted-foreground">{r.direction}</span>
                <span className="flex-1 truncate">
                  {r.student?.full_name ?? r.scannedCode}
                  {r.reason && <span className="ml-2 text-xs text-muted-foreground">· {r.reason}</span>}
                </span>
                <span className="text-xs text-muted-foreground">{r.scannedAt.toLocaleTimeString()}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════
          MODALS
      ══════════════════════════════════════════ */}

      {/* Override modal */}
      {showOverride && (
        <Modal onClose={() => { setShowOverride(false); setOverrideReason(""); }} title={t("verify.override_title")}>
          <p className="text-sm text-muted-foreground mb-4">
            {t("verify.override_desc", { name: result?.student?.full_name ?? result?.scannedCode })}
          </p>
          <div className="space-y-2">
            <label className="block text-sm font-medium">
              {t("verify.override_reason")} <span className="text-destructive">*</span>
            </label>
            <Input
              value={overrideReason}
              onChange={(e) => setOverrideReason(e.target.value)}
              placeholder={t("verify.override_placeholder")}
              autoFocus
              onKeyDown={(e) => e.key === "Enter" && doOverride()}
            />
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="outline" onClick={() => { setShowOverride(false); setOverrideReason(""); }}>
              {t("common.cancel")}
            </Button>
            <Button
              onClick={doOverride}
              disabled={overrideBusy || !overrideReason.trim()}
              className="bg-success hover:bg-success/90 text-success-foreground"
            >
              {overrideBusy ? "…" : t("verify.override_grant")}
            </Button>
          </div>
        </Modal>
      )}

      {/* Visitor walk-in modal */}
      {showVisitorModal && (
        <Modal onClose={() => setShowVisitorModal(false)} title={t("verify.visitor_title")}>
          <p className="text-sm text-muted-foreground mb-4">{t("verify.visitor_desc")}</p>
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium mb-1">{t("verify.visitor_name")} <span className="text-destructive">*</span></label>
              <Input value={visitorName} onChange={(e) => setVisitorName(e.target.value)} placeholder={t("verify.visitor_name_ph")} autoFocus />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">{t("verify.visitor_phone")}</label>
              <Input value={visitorPhone} onChange={(e) => setVisitorPhone(e.target.value)} placeholder={t("verify.visitor_phone_ph")} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">{t("verify.visitor_purpose")}</label>
              <Input value={visitorPurpose} onChange={(e) => setVisitorPurpose(e.target.value)} placeholder={t("verify.visitor_purpose_ph")} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">{t("verify.visitor_host")}</label>
              <Input value={visitorHost} onChange={(e) => setVisitorHost(e.target.value)} placeholder={t("verify.visitor_host_ph")} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">{t("vis.field_valid_until")}</label>
              <div className="flex gap-2">
                <Input type="date" value={visitorValidUntil} min={new Date().toISOString().slice(0, 10)}
                  className="flex-1" onChange={(e) => setVisitorValidUntil(e.target.value)} />
                <Input type="time" value={visitorValidTime} className="w-28"
                  onChange={(e) => setVisitorValidTime(e.target.value)} />
              </div>
            </div>
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setShowVisitorModal(false)}>{t("common.cancel")}</Button>
            <Button onClick={registerVisitor} disabled={visitorBusy || !visitorName.trim()}>
              <UserPlus className="mr-1.5 h-4 w-4" />
              {visitorBusy ? t("verify.visitor_registering") : t("verify.visitor_issue")}
            </Button>
          </div>
        </Modal>
      )}

      {/* Panic / incident modal */}
      {showPanic && (
        <Modal onClose={() => setShowPanic(false)} title={t("verify.panic_title")}>
          <div className="mb-4 rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {t("verify.panic_desc")}
          </div>
          <div className="space-y-2">
            <label className="block text-sm font-medium">{t("verify.panic_label")}</label>
            <Input
              value={panicNote}
              onChange={(e) => setPanicNote(e.target.value)}
              placeholder={t("verify.panic_placeholder")}
              autoFocus
              onKeyDown={(e) => e.key === "Enter" && triggerPanic()}
            />
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setShowPanic(false)}>{t("common.cancel")}</Button>
            <Button
              onClick={triggerPanic}
              disabled={panicBusy}
              className="bg-destructive hover:bg-destructive/90 text-destructive-foreground"
            >
              <AlertOctagon className="mr-1.5 h-4 w-4" />
              {panicBusy ? t("verify.panic_sending") : t("verify.panic_send")}
            </Button>
          </div>
        </Modal>
      )}

    </div>
  );
}

// ─── Scan result popup modal ───────────────────────────────────────────────

function ScanResultModal({
  result, onOverride, onDismiss,
}: {
  result:      Result;
  onOverride?: () => void;
  onDismiss:   () => void;
}) {
  const { t } = useTranslation();
  const AUTO_CLOSE = 10;
  const [secs, setSecs] = useState(AUTO_CLOSE);
  const dismissRef = useRef(onDismiss);
  useEffect(() => { dismissRef.current = onDismiss; }, [onDismiss]);

  // Restart countdown whenever result changes (e.g. after override)
  useEffect(() => {
    setSecs(AUTO_CLOSE);
    const t = setInterval(() => {
      setSecs((s) => {
        if (s <= 1) { clearInterval(t); dismissRef.current(); return 0; }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [result]);

  const cfg =
    result.decision === "allowed"
      ? { icon: CheckCircle2,  label: t("verify.result_granted"), headerBg: "bg-success",     headerFg: "text-success-foreground",     ring: "ring-success/40"     }
      : result.decision === "denied"
      ? { icon: XCircle,       label: t("verify.result_denied"),  headerBg: "bg-destructive", headerFg: "text-destructive-foreground", ring: "ring-destructive/40" }
      : { icon: AlertTriangle, label: t("verify.result_unknown"), headerBg: "bg-warning",     headerFg: "text-warning-foreground",     ring: "ring-warning/40"     };

  const Icon = cfg.icon;
  const s    = result.student;
  const progressPct = (secs / AUTO_CLOSE) * 100;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-3 sm:p-6 bg-black/70 animate-in fade-in duration-150">
      <div className={`w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden ring-2 ${cfg.ring} animate-in zoom-in-95 duration-200`}>

        {/* ── Decision header ── */}
        <div className={`flex items-center justify-between gap-3 px-5 py-4 ${cfg.headerBg} ${cfg.headerFg}`}>
          <div className="flex items-center gap-3">
            <Icon className="h-7 w-7 shrink-0" />
            <div>
              <p className="text-xl font-extrabold tracking-tight leading-tight">{cfg.label}</p>
              <p className="text-sm opacity-80">{result.direction === "in" ? t("verify.result_entry") : t("verify.result_exit")} · {result.scannedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</p>
            </div>
          </div>
          <button
            onClick={onDismiss}
            className="rounded-full p-2 hover:bg-white/20 transition-colors shrink-0"
            title="Close (or wait for auto-close)"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* ── Student details ── */}
        <div className="flex gap-4 p-5 bg-card">
          {/* Photo */}
          <div className="shrink-0 h-28 w-28 sm:h-36 sm:w-36 overflow-hidden rounded-xl bg-secondary ring-1 ring-border flex items-center justify-center">
            {result.photoUrl
              ? <img src={result.photoUrl} alt={s?.full_name ?? "Student"} className="h-full w-full object-cover" />
              : <UserIcon className="h-14 w-14 text-muted-foreground/40" />
            }
          </div>

          {/* Info */}
          <div className="flex-1 min-w-0 space-y-1.5">
            {s ? (
              <>
                <div className="flex items-start gap-2 flex-wrap">
                  <p className="text-xl font-bold leading-tight">{s.full_name}</p>
                  {s.is_visitor && (
                    <span className="shrink-0 rounded-full bg-warning/15 px-2 py-0.5 text-[10px] font-bold uppercase text-warning">{t("verify.result_visitor")}</span>
                  )}
                </div>
                <p className="text-sm text-muted-foreground font-mono">{s.admission_number}</p>
                {s.programme && (
                  <p className="text-sm text-foreground">{s.programme}</p>
                )}
                {(s.nta_level || s.year_of_study) && (
                  <p className="text-xs text-muted-foreground">
                    {s.nta_level    && `NTA Level ${s.nta_level}`}
                    {s.nta_level && s.year_of_study && " · "}
                    {s.year_of_study && `Year ${s.year_of_study}`}
                  </p>
                )}
                <p className="text-xs">
                  <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${
                    s.status === "active"    ? "bg-success/15 text-success"     :
                    s.status === "suspended" ? "bg-destructive/15 text-destructive" :
                                              "bg-secondary text-muted-foreground"
                  }`}>{s.status}</span>
                </p>
              </>
            ) : (
              <div className="space-y-1">
                <p className="text-base font-semibold text-muted-foreground">{t("verify.result_no_record")}</p>
                <p className="text-xs font-mono text-muted-foreground">{result.scannedCode}</p>
              </div>
            )}

            {/* Reason */}
            {result.reason && (
              <div className={`mt-2 rounded-lg px-3 py-2 text-sm font-medium ${
                result.decision === "denied"  ? "bg-destructive/10 text-destructive" :
                result.decision === "unknown" ? "bg-warning/10 text-warning"         :
                                               "bg-success/10 text-success"
              }`}>
                {result.reason}
              </div>
            )}
          </div>
        </div>

        {/* ── Watchlist alert banner ── */}
        {result.watchlistHit && (() => {
          const wl = result.watchlistHit!;
          const isDetain = wl.alert_level === "detain";
          const isDeny   = wl.alert_level === "deny";
          const isWarn   = wl.alert_level === "warn";
          return (
            <div className={`flex items-start gap-4 px-5 py-4 border-t ${
              isDetain ? "bg-destructive text-destructive-foreground border-destructive"
              : isDeny ? "bg-destructive/15 text-destructive border-destructive/30"
              : isWarn ? "bg-warning/15 text-warning border-warning/30"
              :           "bg-primary/10 text-primary border-primary/20"
            }`}>
              {/* Person photo (if on file) */}
              {wl.photoSrc ? (
                <div className={`shrink-0 h-16 w-14 overflow-hidden rounded-lg border-2 ${isDetain ? "border-destructive-foreground/40" : "border-current/30"}`}>
                  <img src={wl.photoSrc} alt={wl.full_name} className="h-full w-full object-cover" />
                </div>
              ) : (
                <Flag className={`h-5 w-5 shrink-0 mt-0.5 ${isDetain ? "animate-pulse" : ""}`} />
              )}

              <div className="flex-1 min-w-0">
                <p className="font-bold text-sm uppercase tracking-wide">
                  {isDetain ? t("verify.wl_detain") :
                   isDeny   ? t("verify.wl_deny")   :
                   isWarn   ? t("verify.wl_warn")   :
                              t("verify.wl_info")}
                </p>
                <p className="mt-0.5 text-sm font-medium">{wl.full_name} — {wl.reason}</p>
                {wl.description && (
                  <p className="mt-1 text-xs opacity-80">{wl.description}</p>
                )}
                <p className="mt-1 text-[10px] uppercase font-bold tracking-wider opacity-70">
                  {t("verify.wl_alert_level", { level: wl.alert_level })}
                </p>
              </div>
            </div>
          );
        })()}

        {/* ── Footer: countdown + actions ── */}
        <div className="border-t border-border bg-secondary/30 px-5 py-4 space-y-3">
          {/* Progress bar */}
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-border">
            <div
              className={`h-full rounded-full transition-all duration-1000 ease-linear ${
                result.decision === "allowed" ? "bg-success" :
                result.decision === "denied"  ? "bg-destructive" : "bg-warning"
              }`}
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-muted-foreground">{t("verify.result_auto_close", { secs })}</span>
            <div className="flex gap-2">
              {onOverride && (
                <button
                  onClick={onOverride}
                  className="flex items-center gap-1.5 rounded-lg border border-warning/40 bg-warning/10 px-3 py-1.5 text-sm font-semibold text-warning transition-colors hover:bg-warning/20"
                >
                  <Pencil className="h-3.5 w-3.5" /> {t("verify.result_override_btn")}
                </button>
              )}
              <button
                onClick={onDismiss}
                className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-1.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
              >
                <X className="h-3.5 w-3.5" /> {t("verify.result_close")}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

