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
  Maximize2, Minimize2, X, AlertOctagon, Eye, Pencil, Flag, Building2,
} from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Quagga from "@ericblade/quagga2";
import {
  cacheStudents, findCachedStudent, cachedStudentCount,
  cacheWatchlist, findCachedWatchlistHit, cachedWatchlistCount,
  enqueueScan, pendingQueue, clearQueueItem, markQueueItemFailed,
  type CachedStudent, type CachedWatchlistItem, type QueuedScan,
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
  const [cachedWlCount, setCachedWlCount] = useState(0);
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

  const plant3Gate = gates?.find((g) => g.name.toLowerCase().includes("plant 3")) ?? gates?.[0];

  useEffect(() => {
    if (plant3Gate && (!gateId || gateId !== plant3Gate.id)) {
      setGateId(plant3Gate.id);
    }
  }, [plant3Gate, gateId]);

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
    setCachedWlCount(await cachedWatchlistCount());
  };

  const syncStudents = async () => {
    toast.info("Caching personnel & active watchlist for offline use…");
    const [personnelRes, watchlistRes] = await Promise.all([
      supabase.from("students").select(
        "id,full_name,admission_number,barcode,programme,nta_level,year_of_study,status,photo_url,expires_at,is_visitor,parent_email,parent_phone,suspension_reason,suspended_until,category,company_name,institution,plant_id,valid_from",
      ),
      supabase.from("watchlist").select("*").eq("is_active", true),
    ]);

    let msg = "";
    if (personnelRes.data) {
      await cacheStudents(personnelRes.data as CachedStudent[]);
      msg += `Cached ${personnelRes.data.length} personnel`;
    }
    if (watchlistRes.data) {
      await cacheWatchlist(watchlistRes.data as CachedWatchlistItem[]);
      msg += (msg ? " & " : "Cached ") + `${watchlistRes.data.length} active watchlist items`;
    }
    toast.success(msg || "Offline cache updated");
    refreshOfflineCounts();
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
    toast.info(`Syncing ${items.length} queued offline scans…`);
    let synced = 0;
    let failed = 0;

    for (const item of items) {
      const syncNote = item.operator_note || `[OFFLINE_SYNC] Scanned offline at ${item.scanned_at} (Sync-ID: ${item.sync_id || "N/A"})`;
      const insertPayload = {
        scanned_code: item.scanned_code,
        student_id: item.student_id,
        decision: item.decision,
        reason: item.reason,
        scanned_by: item.scanned_by,
        scanned_at: item.scanned_at,
        direction: item.direction,
        gate_id: item.gate_id,
        operator_note: syncNote,
      };

      const { error } = await supabase.from("access_logs").insert(insertPayload as any);
      if (!error) {
        synced++;
        if (item.id) await clearQueueItem(item.id);
      } else {
        failed++;
        console.error("Failed to sync queued scan item:", error);
        if (item.id) await markQueueItemFailed(item.id, error.message);
      }
    }

    refreshOfflineCounts();
    if (failed > 0) {
      toast.warning(`Synced ${synced} scans; ${failed} failed and remain queued for retry.`);
    } else {
      toast.success(`Successfully synced all ${synced} offline scans to gate access logs.`);
    }
  };

  // ── Audio feedback ──
  const beep = (ok: boolean) => {
    try {
      audioCtxRef.current ||= new (window.AudioContext || (window as any).webkitAudioContext)();
      const ctx = audioCtxRef.current!;
      const now = ctx.currentTime;
      if (ok) {
        // High ascending double-chime for Access Granted
        const osc1 = ctx.createOscillator();
        const osc2 = ctx.createOscillator();
        const gain1 = ctx.createGain();
        const gain2 = ctx.createGain();

        osc1.type = "sine";
        osc1.frequency.setValueAtTime(659.25, now); // E5
        gain1.gain.setValueAtTime(0.2, now);
        gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
        osc1.connect(gain1);
        gain1.connect(ctx.destination);
        osc1.start(now);
        osc1.stop(now + 0.12);

        osc2.type = "sine";
        osc2.frequency.setValueAtTime(880, now + 0.12); // A5
        gain2.gain.setValueAtTime(0.25, now + 0.12);
        gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.32);
        osc2.connect(gain2);
        gain2.connect(ctx.destination);
        osc2.start(now + 0.12);
        osc2.stop(now + 0.32);
      } else {
        // Urgent low buzzer tone for Access Denied
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sawtooth";
        osc.frequency.setValueAtTime(160, now);
        gain.gain.setValueAtTime(0.3, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.45);
      }
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
      if (online) {
        // ── Authoritative Backend Verification RPC ────────────────────────────
        const targetGateId = gateId || plant3Gate?.id || null;
        const { data: rpcRes, error: rpcErr } = await supabase.rpc("verify_gate_access", {
          p_code: scanned,
          p_gate_id: targetGateId,
          p_direction: direction,
          p_operator_note: null,
        });

        if (rpcErr) {
          throw new Error(rpcErr.message || "Gate access verification RPC failed");
        }

        const res = rpcRes as any;
        const decision: Decision = (res?.decision as Decision) ?? "unknown";
        const reason: string | undefined = res?.reason ?? undefined;
        const logId: string | null = res?.log_id ?? null;
        const personData = res?.person ?? null;
        const wlData = res?.watchlist_hit ?? null;

        let photoUrl: string | null = null;
        if (personData?.photo_url) {
          const { data: signed } = await supabase.storage
            .from("student-photos")
            .createSignedUrl(personData.photo_url, 60);
          photoUrl = signed?.signedUrl ?? null;
        }

        let watchlistHit: WatchlistHit | undefined;
        if (wlData) {
          let photoSrc: string | null = null;
          if (wlData.photo_url) {
            const { data: signed } = await supabase.storage
              .from("student-photos")
              .createSignedUrl(wlData.photo_url, 120);
            photoSrc = signed?.signedUrl ?? null;
          }
          watchlistHit = {
            alert_level: wlData.alert_level,
            full_name:   wlData.full_name,
            reason:      wlData.reason,
            description: wlData.description ?? null,
            photo_url:   wlData.photo_url ?? null,
            photoSrc,
          };
        }

        const mappedStudent: CachedStudent | undefined = personData ? {
          id: personData.id,
          full_name: personData.full_name,
          admission_number: personData.admission_number,
          barcode: personData.barcode,
          programme: personData.company_name || personData.institution || personData.programme || "",
          nta_level: "",
          year_of_study: 1,
          status: personData.status,
          photo_url: personData.photo_url,
          expires_at: personData.expires_at,
          is_visitor: personData.is_visitor ?? (personData.category === "visitor"),
          parent_email: null,
          parent_phone: null,
          suspension_reason: null,
          suspended_until: null,
          category: personData.category,
          company_name: personData.company_name,
          institution: personData.institution,
          plant_id: personData.plant_id,
          valid_from: personData.valid_from,
        } : undefined;

        lastScanRef.current = { code: scanned, at: Date.now() };
        const r: Result = {
          decision,
          reason,
          student: mappedStudent,
          photoUrl,
          scannedCode: scanned,
          scannedAt: new Date(),
          direction,
          logId,
          watchlistHit,
        };
        setResult(r);
        setRecent((p) => [r, ...p].slice(0, 10));
        setSessionStats((s) => ({ ...s, [decision]: s[decision] + 1 }));
        beep(decision === "allowed");
      } else {
        // ── Offline fallback (Cached evaluation & offline queue) ─────────────
        const wlHit = await findCachedWatchlistHit(scanned);
        let watchlistHit: WatchlistHit | undefined;
        let decision: Decision = "unknown";
        let reason: string | undefined;
        let matchedStudent: CachedStudent | null = null;

        if (wlHit) {
          decision = "denied";
          reason = `WATCHLIST ALERT [${wlHit.alert_level.toUpperCase()}]: ${wlHit.reason}`;
          watchlistHit = {
            alert_level: wlHit.alert_level,
            full_name:   wlHit.full_name,
            reason:      wlHit.reason,
            description: wlHit.description ?? null,
            photo_url:   wlHit.photo_url ?? null,
            photoSrc:    null,
          };
        } else if (lockdown) {
          decision = "denied";
          reason = "Emergency lockdown — access suspended";
        } else {
          matchedStudent = await findCachedStudent(scanned);
          if (!matchedStudent) {
            decision = "unknown";
            reason = "Offline · Not in Plant 3 local cache";
          } else if (matchedStudent.plant_id && matchedStudent.plant_id !== "Plant 3") {
            decision = "denied";
            reason = `Plant access denied: Assigned to ${matchedStudent.plant_id}`;
          } else if (matchedStudent.status === "suspended") {
            const until = matchedStudent.suspended_until;
            if (until && new Date(until) < new Date()) {
              decision = "allowed";
            } else {
              decision = "denied";
              reason = matchedStudent.suspension_reason ? `Suspended: ${matchedStudent.suspension_reason}` : "Person is suspended";
              if (until) reason += ` · until ${until}`;
            }
          } else if (matchedStudent.status !== "active") {
            decision = "denied";
            reason = `Status is ${matchedStudent.status}`;
          } else if (matchedStudent.expires_at && new Date(matchedStudent.expires_at) < new Date()) {
            decision = "denied";
            reason = `Pass expired ${matchedStudent.expires_at}`;
          } else {
            decision = "allowed";
          }
        }

        const syncId = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `offline_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
        const logPayload: QueuedScan = {
          sync_id: syncId,
          scanned_code: scanned,
          student_id: matchedStudent?.id ?? null,
          decision,
          reason: reason ?? null,
          scanned_by: user?.id ?? null,
          scanned_at: new Date().toISOString(),
          direction,
          gate_id: gateId || plant3Gate?.id || null,
          is_offline: true,
          operator_note: `[OFFLINE GATE SCAN] Evaluated locally offline at Plant 3 Main Gate (Sync-ID: ${syncId})`,
          sync_status: "pending",
        };

        await enqueueScan(logPayload);
        refreshOfflineCounts();

        lastScanRef.current = { code: scanned, at: Date.now() };
        const r: Result = {
          decision,
          reason,
          student: matchedStudent ?? undefined,
          photoUrl: null,
          scannedCode: scanned,
          scannedAt: new Date(),
          direction,
          logId: null,
          watchlistHit,
        };

        setResult(r);
        setRecent((p) => [r, ...p].slice(0, 10));
        setSessionStats((s) => ({ ...s, [decision]: s[decision] + 1 }));
        beep(decision === "allowed");
      }
    } catch (err: any) {
      toast.error(err.message || "Verification failed");
    } finally {
      setBusy(false);
      setCode("");
      if (scanMode === "scanner") setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [online, user?.id, direction, gateId, plant3Gate?.id, antiPassbackSec, lockdown, scanMode]);

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
          <span className="rounded-full bg-secondary px-2.5 py-1 text-xs text-muted-foreground font-medium">
            {cachedCount} {t("verify.cached")}{cachedWlCount > 0 ? ` · ${cachedWlCount} watchlist` : ""}
          </span>
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

        {/* Plant 3 Single Gate Lock */}
        <div className="flex min-w-[220px] flex-1 items-center justify-between rounded-lg border border-border bg-secondary/40 px-3.5 py-2">
          <div className="flex items-center gap-2.5">
            <div className="grid h-8 w-8 place-items-center rounded-md bg-primary/10 text-primary">
              <Building2 className="h-4 w-4" />
            </div>
            <div>
              <p className="text-sm font-bold text-foreground">
                {plant3Gate?.name ?? "Plant 3 - Main Gate"}
              </p>
              <p className="text-[11px] text-muted-foreground">ABB Plant 3 Dedicated Gate</p>
            </div>
          </div>
          <span className="flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            Active
          </span>
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
                <div key={item.id ?? item.sync_id ?? i} className="flex items-center gap-3 px-5 py-2.5 text-sm">
                  {item.decision === "allowed"
                    ? <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
                    : item.decision === "denied"
                    ? <XCircle className="h-4 w-4 shrink-0 text-destructive" />
                    : <AlertTriangle className="h-4 w-4 shrink-0 text-warning" />
                  }
                  <span className="rounded bg-amber-500/15 text-amber-600 font-semibold px-1.5 py-0.5 text-[9px] uppercase tracking-wider">OFFLINE</span>
                  <span className="rounded bg-secondary px-1.5 text-[10px] uppercase font-bold text-muted-foreground">{item.direction ?? "—"}</span>
                  <span className="flex-1 min-w-0 truncate font-mono text-xs">{item.scanned_code}</span>
                  {item.reason && <span className="text-xs text-muted-foreground truncate max-w-[180px]">{item.reason}</span>}
                  {item.sync_status === "failed" && (
                    <span className="text-[10px] text-destructive bg-destructive/10 px-1.5 py-0.5 rounded font-medium truncate max-w-[120px]" title={item.sync_error || "Sync error"}>
                      Retry Pending
                    </span>
                  )}
                  <span className="shrink-0 text-xs text-muted-foreground font-mono">
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

      {/* ── High-Visibility Latest Decision Banner ── */}
      {recent.length > 0 && (() => {
        const latest = recent[0];
        const isOk = latest.decision === "allowed";
        const isDeny = latest.decision === "denied";
        const bannerBorder = isOk
          ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-950 dark:text-emerald-50"
          : isDeny
          ? "border-red-500/50 bg-red-500/10 text-red-950 dark:text-red-50"
          : "border-amber-500/50 bg-amber-500/10 text-amber-950 dark:text-amber-50";

        const badgeBg = isOk
          ? "bg-emerald-600 text-white"
          : isDeny
          ? "bg-red-600 text-white"
          : "bg-amber-600 text-white";

        const BannerIcon = isOk ? CheckCircle2 : isDeny ? XCircle : AlertTriangle;

        return (
          <div className={`overflow-hidden rounded-2xl border-2 p-5 shadow-lg transition-all animate-in fade-in ${bannerBorder}`}>
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className={`grid h-16 w-16 place-items-center rounded-2xl ${badgeBg} shadow-md shrink-0`}>
                  <BannerIcon className="h-10 w-10 text-white stroke-[2.5]" />
                </div>
                <div>
                  <div className="flex items-center gap-2.5 flex-wrap">
                    <span className={`rounded-md px-3 py-1 text-sm font-black uppercase tracking-wider ${badgeBg}`}>
                      {isOk ? "ACCESS GRANTED" : isDeny ? "ACCESS DENIED" : "UNABLE TO VERIFY"}
                    </span>
                    <span className="rounded bg-secondary/80 px-2 py-0.5 text-xs font-mono font-bold uppercase text-foreground">
                      {latest.direction === "in" ? "ENTRY (IN)" : "EXIT (OUT)"}
                    </span>
                    <span className="text-xs text-muted-foreground font-mono">
                      {latest.scannedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                    </span>
                  </div>

                  <p className="mt-2 text-xl sm:text-2xl font-black text-foreground">
                    {latest.student?.full_name ?? latest.scannedCode}
                  </p>

                  {latest.student && (
                    <div className="mt-1 flex items-center gap-3 text-xs sm:text-sm text-muted-foreground flex-wrap">
                      <span className="font-mono">{latest.student.admission_number}</span>
                      {latest.student.category === "worker" ? (
                        <span className="rounded bg-blue-500/15 px-2 py-0.5 text-xs font-bold uppercase text-blue-500">Contract Worker</span>
                      ) : latest.student.category === "intern" ? (
                        <span className="rounded bg-purple-500/15 px-2 py-0.5 text-xs font-bold uppercase text-purple-500">Internship Student</span>
                      ) : latest.student.is_visitor ? (
                        <span className="rounded bg-amber-500/15 px-2 py-0.5 text-xs font-bold uppercase text-amber-500">Temporary Visitor</span>
                      ) : null}
                      {latest.student.company_name && (
                        <span>· Contractor: <strong className="text-foreground">{latest.student.company_name}</strong></span>
                      )}
                      {latest.student.institution && (
                        <span>· Institution: <strong className="text-foreground">{latest.student.institution}</strong></span>
                      )}
                    </div>
                  )}

                  {isDeny && latest.reason && (
                    <p className="mt-2 text-sm sm:text-base font-extrabold text-red-600 dark:text-red-400">
                      Reason: {latest.reason}
                    </p>
                  )}
                </div>
              </div>

              <div className="flex sm:flex-col items-center sm:items-end gap-2 w-full sm:w-auto justify-between sm:justify-center shrink-0">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setResult(latest)}
                  className="font-semibold text-xs border-current/30 hover:bg-black/5 dark:hover:bg-white/5"
                >
                  <Eye className="mr-1.5 h-3.5 w-3.5" /> View Details
                </Button>
                {latest.logId && isDeny && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setResult(latest);
                      setShowOverride(true);
                    }}
                    className="font-semibold text-xs border-amber-500/40 text-amber-600 hover:bg-amber-500/10"
                  >
                    <Pencil className="mr-1.5 h-3.5 w-3.5" /> Override Access
                  </Button>
                )}
              </div>
            </div>
          </div>
        );
      })()}

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
      ? {
          icon: CheckCircle2,
          headline: "ACCESS GRANTED",
          subheadline: "ABB PLANT 3 · CLEARANCE APPROVED",
          headerBg: "bg-emerald-600 text-white",
          ring: "ring-4 ring-emerald-500/40",
          statusBadge: "bg-emerald-500/20 text-emerald-100 border-emerald-400/40",
          progressBar: "bg-emerald-500",
        }
      : result.decision === "denied"
      ? {
          icon: XCircle,
          headline: "ACCESS DENIED",
          subheadline: "ABB PLANT 3 · GATE ACCESS REFUSED",
          headerBg: "bg-red-600 text-white",
          ring: "ring-4 ring-red-500/40",
          statusBadge: "bg-red-500/20 text-red-100 border-red-400/40",
          progressBar: "bg-red-500",
        }
      : {
          icon: AlertTriangle,
          headline: "UNABLE TO VERIFY",
          subheadline: "UNREGISTERED CREDENTIAL · NOT IN DATABASE",
          headerBg: "bg-amber-600 text-white",
          ring: "ring-4 ring-amber-500/40",
          statusBadge: "bg-amber-500/20 text-amber-100 border-amber-400/40",
          progressBar: "bg-amber-500",
        };

  const Icon = cfg.icon;
  const s    = result.student;
  const progressPct = (secs / AUTO_CLOSE) * 100;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-3 sm:p-6 bg-black/75 backdrop-blur-sm animate-in fade-in duration-150">
      <div className={`w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden ring-2 ${cfg.ring} animate-in zoom-in-95 duration-200 bg-card border border-border`}>

        {/* ── High-Visibility Decision Header ── */}
        <div className={`flex items-center justify-between gap-4 px-6 py-5 ${cfg.headerBg} shadow-lg transition-colors`}>
          <div className="flex items-center gap-4">
            <div className="grid h-14 w-14 place-items-center rounded-2xl bg-white/20 backdrop-blur-sm shrink-0">
              <Icon className="h-9 w-9 text-white stroke-[2.5]" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-2xl sm:text-3xl font-black tracking-tight leading-none text-white">
                  {cfg.headline}
                </span>
                <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-extrabold uppercase tracking-wider ${cfg.statusBadge}`}>
                  {result.direction === "in" ? "ENTRY (IN)" : "EXIT (OUT)"}
                </span>
              </div>
              <p className="mt-1 text-xs sm:text-sm font-semibold tracking-wide text-white/90">
                {cfg.subheadline} · {result.scannedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
              </p>
            </div>
          </div>
          <button
            onClick={onDismiss}
            className="rounded-full p-2 hover:bg-white/20 transition-colors text-white shrink-0"
            title="Close"
          >
            <X className="h-6 w-6" />
          </button>
        </div>

        {/* ── Prominent Reason Callout Box ── */}
        {result.decision === "denied" && (
          <div className="mx-6 mt-5 rounded-2xl border-2 border-red-500/50 bg-red-500/10 p-4 animate-in fade-in slide-in-from-top-1 duration-200">
            <div className="flex items-start gap-3">
              <div className="grid h-8 w-8 place-items-center rounded-lg bg-red-600 text-white shrink-0 mt-0.5">
                <ShieldAlert className="h-5 w-5" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-bold uppercase tracking-wider text-red-600 dark:text-red-400">
                  Denial Reason (Enforced by Plant 3 Security)
                </p>
                <p className="mt-0.5 text-base sm:text-lg font-black text-red-700 dark:text-red-300">
                  {result.reason || "Access denied by security verification rules"}
                </p>
              </div>
            </div>
          </div>
        )}

        {result.decision === "allowed" && (
          <div className="mx-6 mt-5 rounded-2xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 animate-in fade-in duration-200">
            <div className="flex items-center gap-2.5 text-emerald-800 dark:text-emerald-200 text-sm font-bold">
              <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
              <span>Plant 3 Clearance Granted — Single Gate Authorized</span>
            </div>
          </div>
        )}

        {result.decision === "unknown" && (
          <div className="mx-6 mt-5 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 animate-in fade-in duration-200">
            <div className="flex items-start gap-3">
              <div className="grid h-8 w-8 place-items-center rounded-lg bg-amber-600 text-white shrink-0 mt-0.5">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-bold uppercase tracking-wider text-amber-700 dark:text-amber-300">
                  Unrecognized Barcode or Pass
                </p>
                <p className="mt-0.5 text-sm sm:text-base font-bold text-amber-800 dark:text-amber-200 font-mono">
                  {result.scannedCode}
                </p>
                <p className="mt-1 text-xs text-amber-700/90 dark:text-amber-300/90">
                  No registered contractor worker, intern, or visitor matches this credential. Use Walk-in Registration or Manual Lookup.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* ── Student / Personnel details ── */}
        <div className="flex flex-col sm:flex-row gap-5 p-6 bg-card">
          {/* Photo */}
          <div className="shrink-0 h-32 w-32 sm:h-36 sm:w-36 mx-auto sm:mx-0 overflow-hidden rounded-2xl bg-secondary/80 ring-2 ring-border shadow-md flex items-center justify-center">
            {result.photoUrl ? (
              <img src={result.photoUrl} alt={s?.full_name ?? "Personnel"} className="h-full w-full object-cover" />
            ) : s?.full_name ? (
              <div className="grid h-full w-full place-items-center bg-primary/10 text-primary font-black text-3xl sm:text-4xl select-none">
                {s.full_name
                  .split(" ")
                  .map((p) => p[0])
                  .filter(Boolean)
                  .slice(0, 2)
                  .join("")
                  .toUpperCase()}
              </div>
            ) : (
              <UserIcon className="h-16 w-16 text-muted-foreground/30" />
            )}
          </div>

          {/* Info */}
          <div className="flex-1 min-w-0 space-y-2">
            {s ? (
              <>
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-xl sm:text-2xl font-black text-foreground tracking-tight">{s.full_name}</h3>
                  {s.category === "worker" ? (
                    <span className="shrink-0 rounded-md bg-blue-600 px-2.5 py-0.5 text-xs font-bold uppercase text-white shadow-sm">
                      Contract Worker
                    </span>
                  ) : s.category === "intern" ? (
                    <span className="shrink-0 rounded-md bg-purple-600 px-2.5 py-0.5 text-xs font-bold uppercase text-white shadow-sm">
                      Internship Student
                    </span>
                  ) : s.is_visitor || s.category === "visitor" ? (
                    <span className="shrink-0 rounded-md bg-amber-600 px-2.5 py-0.5 text-xs font-bold uppercase text-white shadow-sm">
                      Temporary Visitor
                    </span>
                  ) : null}
                </div>
                <div className="flex items-center gap-3 text-xs sm:text-sm text-muted-foreground font-mono">
                  <span className="font-bold text-foreground">ID: {s.admission_number}</span>
                  {s.barcode && s.barcode !== s.admission_number && (
                    <span>· Barcode: {s.barcode}</span>
                  )}
                </div>
                {s.company_name && (
                  <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                    <Building2 className="h-4 w-4 text-primary shrink-0" />
                    <span>Contractor: <strong className="text-foreground">{s.company_name}</strong></span>
                  </div>
                )}
                {s.institution && (
                  <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                    <Building2 className="h-4 w-4 text-primary shrink-0" />
                    <span>Institution: <strong className="text-foreground">{s.institution}</strong></span>
                  </div>
                )}
                {!s.company_name && !s.institution && s.programme && (
                  <p className="text-sm text-foreground">{s.programme}</p>
                )}
                <div className="flex items-center gap-3 flex-wrap pt-1 text-xs">
                  {(s.valid_from || s.expires_at) && (
                    <span className="rounded bg-secondary px-2 py-1 text-muted-foreground font-mono">
                      Validity: {s.valid_from ? s.valid_from.slice(0, 10) : "Immediate"} – {s.expires_at ? s.expires_at.slice(0, 10) : "Open"}
                    </span>
                  )}
                  <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold uppercase ${
                    s.status === "active"    ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" :
                    s.status === "suspended" ? "bg-red-500/15 text-red-600 dark:text-red-400" :
                                              "bg-secondary text-muted-foreground"
                  }`}>{s.status}</span>
                </div>
              </>
            ) : (
              <div className="space-y-1.5 py-2">
                <p className="text-lg font-bold text-muted-foreground">{t("verify.result_no_record")}</p>
                <p className="text-xs font-mono text-muted-foreground">{result.scannedCode}</p>
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

