import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useEffect, useRef, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { downloadCSV } from "@/lib/csv";
import { toast } from "sonner";
import {
  Utensils, ScanLine, RefreshCw, CheckCircle2, XCircle, AlertTriangle,
  Clock, Calendar, Users, HardHat, GraduationCap, ShieldAlert,
  Search, ArrowUpDown, Download, Filter, Coffee, Sun, Moon, Sparkles,
  Building2, ArrowLeft, History, ShieldCheck, X
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/canteen")({
  component: CanteenPage,
});

type MealType = "breakfast" | "lunch" | "dinner" | "night_snack";

interface CanteenPerson {
  id:               string;
  full_name:        string;
  admission_number: string;
  barcode:          string;
  category:         "worker" | "intern" | "visitor" | null;
  company_name:     string | null;
  institution:      string | null;
  plant_id:         string | null;
  photo_url:        string | null;
  status:           string | null;
  valid_from:       string | null;
  expires_at:       string | null;
  is_visitor:       boolean | null;
}

interface CanteenResult {
  id:            string;
  timestamp:     Date;
  code:          string;
  decision:      "allowed" | "denied";
  mealType:      MealType;
  person:        CanteenPerson | null;
  reason?:       string;
  priorClaimAt?: string;
}

interface CanteenLogRow {
  id:           string;
  student_id:   string | null;
  scanned_code: string;
  meal_type:    string;
  log_date:     string;
  decision:     "allowed" | "denied";
  reason:       string | null;
  created_at:   string;
  scanned_by:   string | null;
  plant_id:     string | null;
  students: {
    id:               string;
    full_name:        string;
    admission_number: string;
    category:         "worker" | "intern" | "visitor" | null;
    company_name:     string | null;
    institution:      string | null;
    photo_url:        string | null;
    is_visitor:       boolean | null;
  } | null;
}

// ── Audio Feedback Generator ────────────────────────────────────────────────
function playCanteenAudio(type: "granted" | "duplicate" | "denied") {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    if (ctx.state === "suspended") ctx.resume();

    if (type === "granted") {
      // Pleasant upbeat double chime
      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.type = "sine";
      osc1.frequency.setValueAtTime(659.25, ctx.currentTime); // E5
      gain1.gain.setValueAtTime(0.2, ctx.currentTime);
      gain1.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
      osc1.connect(gain1);
      gain1.connect(ctx.destination);
      osc1.start(ctx.currentTime);
      osc1.stop(ctx.currentTime + 0.15);

      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = "sine";
      osc2.frequency.setValueAtTime(880, ctx.currentTime + 0.1); // A5
      gain2.gain.setValueAtTime(0.25, ctx.currentTime + 0.1);
      gain2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.start(ctx.currentTime + 0.1);
      osc2.stop(ctx.currentTime + 0.35);
    } else {
      // Low dual buzzer for duplicate or denial
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(140, ctx.currentTime);
      osc.frequency.linearRampToValueAtTime(110, ctx.currentTime + 0.3);
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.35);
    }
  } catch {
    // Audio context unavailable or blocked
  }
}

function getInitials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function detectActiveMeal(): MealType {
  const hour = new Date().getHours();
  if (hour >= 6 && hour < 11)  return "breakfast";
  if (hour >= 11 && hour < 17) return "lunch";
  if (hour >= 17 && hour < 22) return "dinner";
  return "night_snack";
}

function mealTypeLabel(m: MealType): string {
  switch (m) {
    case "breakfast":   return "Breakfast";
    case "lunch":       return "Lunch";
    case "dinner":      return "Dinner";
    case "night_snack": return "Night Shift Snack";
  }
}

function mealTypeIcon(m: MealType) {
  switch (m) {
    case "breakfast":   return Coffee;
    case "lunch":       return Sun;
    case "dinner":      return Utensils;
    case "night_snack": return Moon;
  }
}

function CanteenPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const qc = useQueryClient();

  // ── Mode Tabs ────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<"scan" | "reports">("scan");

  // ── Scanner State ────────────────────────────────────────────────────────
  const [mealType, setMealType] = useState<MealType>(detectActiveMeal());
  const [barcodeInput, setBarcodeInput] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [latestResult, setLatestResult] = useState<CanteenResult | null>(null);
  const [recentScans, setRecentScans] = useState<CanteenResult[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  // ── Reports Filter State ─────────────────────────────────────────────────
  const [reportDateRange, setReportDateRange] = useState<"today" | "yesterday" | "7d" | "30d">("today");
  const [reportMealType, setReportMealType]   = useState<string>("all");
  const [reportDecision, setReportDecision]   = useState<string>("all");
  const [reportSearch, setReportSearch]       = useState("");

  // Keep input focused for barcode gun
  useEffect(() => {
    if (activeTab === "scan") {
      inputRef.current?.focus();
    }
  }, [activeTab, latestResult]);

  // ── Query Canteen Logs for Reports & Session Feed ────────────────────────
  const dateRangeISO = useMemo(() => {
    const now = new Date();
    const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);

    if (reportDateRange === "today") {
      return todayMidnight.toISOString().slice(0, 10);
    }
    if (reportDateRange === "yesterday") {
      const yesterday = new Date(todayMidnight);
      yesterday.setDate(yesterday.getDate() - 1);
      return yesterday.toISOString().slice(0, 10);
    }
    if (reportDateRange === "7d") {
      const past7 = new Date(todayMidnight);
      past7.setDate(past7.getDate() - 7);
      return past7.toISOString().slice(0, 10);
    }
    const past30 = new Date(todayMidnight);
    past30.setDate(past30.getDate() - 30);
    return past30.toISOString().slice(0, 10);
  }, [reportDateRange]);

  const {
    data: canteenLogs,
    isLoading: logsLoading,
    refetch: refetchLogs,
  } = useQuery({
    queryKey: ["canteen-logs", dateRangeISO],
    queryFn: async () => {
      let query = supabase
        .from("canteen_logs")
        .select(
          "id,student_id,scanned_code,meal_type,log_date,decision,reason,created_at,scanned_by,plant_id," +
          "students(id,full_name,admission_number,category,company_name,institution,photo_url,is_visitor)"
        )
        .gte("log_date", dateRangeISO)
        .order("created_at", { ascending: false });

      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as unknown as CanteenLogRow[];
    },
    refetchInterval: 15_000,
  });

  // ── Metrics from Logs ────────────────────────────────────────────────────
  const todayStr = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const todayMetrics = useMemo(() => {
    const logs = canteenLogs?.filter((l) => l.log_date === todayStr) ?? [];
    const totalAllowed = logs.filter((l) => l.decision === "allowed").length;
    const duplicatesBlocked = logs.filter((l) => l.decision === "denied" && l.reason?.toLowerCase().includes("duplicate")).length;

    const workerMeals = logs.filter(
      (l) => l.decision === "allowed" && (l.students?.category === "worker" || (!l.students?.category && !l.students?.is_visitor))
    ).length;

    const internMeals = logs.filter(
      (l) => l.decision === "allowed" && l.students?.category === "intern"
    ).length;

    const visitorMeals = logs.filter(
      (l) => l.decision === "allowed" && (l.students?.category === "visitor" || l.students?.is_visitor)
    ).length;

    return { totalAllowed, duplicatesBlocked, workerMeals, internMeals, visitorMeals };
  }, [canteenLogs, todayStr]);

  // ── Verification & Atomic Duplicate Prevention Engine ────────────────────
  const processMealScan = async (codeToVerify: string) => {
    const code = codeToVerify.trim();
    if (!code || isProcessing) return;

    setIsProcessing(true);
    setBarcodeInput("");

    try {
      const todayDate = new Date().toISOString().slice(0, 10);

      // 1. Identify person from students table by barcode, worker ID, or UUID
      const { data: personData, error: personError } = await supabase
        .from("students")
        .select(
          "id,full_name,admission_number,barcode,category,company_name,institution,plant_id,photo_url,status,valid_from,expires_at,is_visitor"
        )
        .or(`barcode.eq.${code},admission_number.eq.${code},id.eq.${code}`)
        .maybeSingle();

      if (personError) throw personError;

      if (!personData) {
        // Unknown barcode / credential
        const res: CanteenResult = {
          id: crypto.randomUUID(),
          timestamp: new Date(),
          code,
          decision: "denied",
          mealType,
          person: null,
          reason: "Unknown barcode or unregistered credential",
        };

        // Record unverified attempt in canteen_logs
        await supabase.from("canteen_logs").insert({
          scanned_code: code,
          meal_type:    mealType,
          log_date:     todayDate,
          decision:     "denied",
          reason:       res.reason,
          scanned_by:   user?.id,
        });

        playCanteenAudio("denied");
        setLatestResult(res);
        setRecentScans((prev) => [res, ...prev.slice(0, 9)]);
        return;
      }

      const person = personData as CanteenPerson;

      // 2. Validate person status
      if (person.status && person.status !== "active") {
        const res: CanteenResult = {
          id: crypto.randomUUID(),
          timestamp: new Date(),
          code,
          decision: "denied",
          mealType,
          person,
          reason: `Account is ${person.status.toUpperCase()} — meal entitlement disabled`,
        };

        await supabase.from("canteen_logs").insert({
          student_id:   person.id,
          scanned_code: code,
          meal_type:    mealType,
          log_date:     todayDate,
          decision:     "denied",
          reason:       res.reason,
          plant_id:     person.plant_id,
          scanned_by:   user?.id,
        });

        playCanteenAudio("denied");
        setLatestResult(res);
        setRecentScans((prev) => [res, ...prev.slice(0, 9)]);
        return;
      }

      // 3. Validate pass expiration
      if (person.expires_at && new Date(person.expires_at).getTime() < Date.now()) {
        const res: CanteenResult = {
          id: crypto.randomUUID(),
          timestamp: new Date(),
          code,
          decision: "denied",
          mealType,
          person,
          reason: `Pass expired on ${new Date(person.expires_at).toLocaleDateString()}`,
        };

        await supabase.from("canteen_logs").insert({
          student_id:   person.id,
          scanned_code: code,
          meal_type:    mealType,
          log_date:     todayDate,
          decision:     "denied",
          reason:       res.reason,
          plant_id:     person.plant_id,
          scanned_by:   user?.id,
        });

        playCanteenAudio("denied");
        setLatestResult(res);
        setRecentScans((prev) => [res, ...prev.slice(0, 9)]);
        return;
      }

      // 4. DUPLICATE CHECK: Query existing allowed claim for this person, date & meal type
      const { data: existingClaim, error: claimError } = await supabase
        .from("canteen_logs")
        .select("id,created_at,meal_type,scanned_code")
        .eq("student_id", person.id)
        .eq("log_date", todayDate)
        .eq("meal_type", mealType)
        .eq("decision", "allowed")
        .maybeSingle();

      if (claimError) throw claimError;

      if (existingClaim) {
        // DUPLICATE CLAIM ENCOUNTERED!
        const priorTimeStr = new Date(existingClaim.created_at).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        });

        const res: CanteenResult = {
          id: crypto.randomUUID(),
          timestamp: new Date(),
          code,
          decision: "denied",
          mealType,
          person,
          reason: `DUPLICATE CLAIM: Meal already received today at ${priorTimeStr}`,
          priorClaimAt: existingClaim.created_at,
        };

        // Record duplicate denial in audit trail
        await supabase.from("canteen_logs").insert({
          student_id:   person.id,
          scanned_code: code,
          meal_type:    mealType,
          log_date:     todayDate,
          decision:     "denied",
          reason:       res.reason,
          plant_id:     person.plant_id,
          scanned_by:   user?.id,
        });

        playCanteenAudio("duplicate");
        setLatestResult(res);
        setRecentScans((prev) => [res, ...prev.slice(0, 9)]);
        qc.invalidateQueries({ queryKey: ["canteen-logs"] });
        return;
      }

      // 5. ATOMIC MEAL ISSUANCE: Insert allowed claim protected by unique partial index
      const { error: insertError } = await supabase.from("canteen_logs").insert({
        student_id:   person.id,
        scanned_code: code,
        meal_type:    mealType,
        log_date:     todayDate,
        decision:     "allowed",
        reason:       `Eligible ${mealTypeLabel(mealType)} served`,
        plant_id:     person.plant_id,
        scanned_by:   user?.id,
      });

      if (insertError) {
        // Check if atomic unique index rejected race-condition duplicate
        if (insertError.code === "23505" || insertError.message.toLowerCase().includes("unique")) {
          const res: CanteenResult = {
            id: crypto.randomUUID(),
            timestamp: new Date(),
            code,
            decision: "denied",
            mealType,
            person,
            reason: `DUPLICATE CLAIM: Concurrent transaction already recorded meal claim for today`,
          };
          playCanteenAudio("duplicate");
          setLatestResult(res);
          setRecentScans((prev) => [res, ...prev.slice(0, 9)]);
          return;
        }
        throw insertError;
      }

      // SUCCESS: Meal granted!
      const res: CanteenResult = {
        id: crypto.randomUUID(),
        timestamp: new Date(),
        code,
        decision: "allowed",
        mealType,
        person,
        reason: `${mealTypeLabel(mealType)} approved and registered`,
      };

      playCanteenAudio("granted");
      setLatestResult(res);
      setRecentScans((prev) => [res, ...prev.slice(0, 9)]);
      qc.invalidateQueries({ queryKey: ["canteen-logs"] });
    } catch (err: any) {
      toast.error(err.message || "Failed to process canteen verification");
    } finally {
      setIsProcessing(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    processMealScan(barcodeInput);
  };

  // ── CSV Export for Cafeteria Accounting & Safety Audits ───────────────────
  const exportCanteenCSV = () => {
    if (!canteenLogs?.length) {
      toast.error("No canteen records available for export");
      return;
    }

    const rows = filteredLogs.map((l) => {
      const org = l.students?.company_name || l.students?.institution || "ABB Plant 3";
      const cat = l.students?.category || (l.students?.is_visitor ? "visitor" : "worker");
      return {
        "Log ID": l.id,
        "Date": l.log_date,
        "Timestamp": new Date(l.created_at).toLocaleString(),
        "Meal Type": l.meal_type.toUpperCase(),
        "Decision": l.decision.toUpperCase(),
        "Full Name": l.students?.full_name || "Unidentified / Visitor",
        "ID Number": l.students?.admission_number || l.scanned_code,
        "Classification": cat.toUpperCase(),
        "Organization / Contractor": org,
        "Scanned Code": l.scanned_code,
        "Reason / Notes": l.reason || "",
      };
    });

    const timestamp = new Date().toISOString().slice(0, 10);
    downloadCSV(`ABB-Plant3-Canteen-Audit-${timestamp}.csv`, rows);
  };

  // ── Filtered Logs for Tab 2 ──────────────────────────────────────────────
  const filteredLogs = useMemo(() => {
    let rows = canteenLogs ?? [];

    if (reportMealType !== "all") {
      rows = rows.filter((l) => l.meal_type === reportMealType);
    }
    if (reportDecision !== "all") {
      rows = rows.filter((l) => l.decision === reportDecision);
    }
    const q = reportSearch.trim().toLowerCase();
    if (q) {
      rows = rows.filter((l) =>
        l.scanned_code.toLowerCase().includes(q) ||
        l.students?.full_name.toLowerCase().includes(q) ||
        l.students?.admission_number.toLowerCase().includes(q) ||
        l.students?.company_name?.toLowerCase().includes(q) ||
        l.students?.institution?.toLowerCase().includes(q)
      );
    }
    return rows;
  }, [canteenLogs, reportMealType, reportDecision, reportSearch]);

  const ActiveMealIcon = mealTypeIcon(mealType);

  return (
    <div className="space-y-6">

      {/* ── Top Header ── */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link to="/verify">
            <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground hover:text-foreground">
              <ArrowLeft className="h-4 w-4" /> {t("nav.gate_scan", "Gate Scan")}
            </Button>
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
                <Utensils className="h-6 w-6 text-red-600" />
                Canteen Verification & Meal Tracking
              </h1>
              <Badge variant="outline" className="border-red-600/30 bg-red-600/10 text-red-600 font-semibold text-xs px-2 py-0.5">
                ABB Plant 3
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              Fast-turnstile meal entitlement validation with strict atomic duplicate claim prevention.
            </p>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-lg border border-border bg-secondary/50 p-1">
            <button
              onClick={() => setActiveTab("scan")}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-all ${
                activeTab === "scan"
                  ? "bg-foreground text-background shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <ScanLine className="h-3.5 w-3.5" /> Fast Scanner
            </button>
            <button
              onClick={() => setActiveTab("reports")}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-all ${
                activeTab === "reports"
                  ? "bg-foreground text-background shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <History className="h-3.5 w-3.5" /> Meal Logs & Audit
            </button>
          </div>

          <Button
            size="sm"
            variant="outline"
            onClick={() => refetchLogs()}
            disabled={logsLoading}
            className="gap-1.5 h-9"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${logsLoading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* ── KPI Stat Cards ── */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
        <div className="flex flex-col items-start gap-1 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-4 shadow-sm">
          <div className="flex w-full items-center justify-between">
            <span className="text-2xl font-extrabold text-emerald-600 dark:text-emerald-400">{todayMetrics.totalAllowed}</span>
            <Utensils className="h-4 w-4 text-emerald-600" />
          </div>
          <span className="text-xs font-semibold text-foreground">Total Meals Today</span>
          <span className="text-[11px] text-muted-foreground">Plant 3 Cafeteria</span>
        </div>

        <div className="flex flex-col items-start gap-1 rounded-xl border border-blue-500/20 bg-blue-500/5 p-4 shadow-sm">
          <div className="flex w-full items-center justify-between">
            <span className="text-2xl font-extrabold text-blue-600 dark:text-blue-400">{todayMetrics.workerMeals}</span>
            <HardHat className="h-4 w-4 text-blue-500" />
          </div>
          <span className="text-xs font-semibold text-foreground">Worker Meals</span>
          <span className="text-[11px] text-muted-foreground">Contractor staff</span>
        </div>

        <div className="flex flex-col items-start gap-1 rounded-xl border border-indigo-500/20 bg-indigo-500/5 p-4 shadow-sm">
          <div className="flex w-full items-center justify-between">
            <span className="text-2xl font-extrabold text-indigo-600 dark:text-indigo-400">{todayMetrics.internMeals}</span>
            <GraduationCap className="h-4 w-4 text-indigo-500" />
          </div>
          <span className="text-xs font-semibold text-foreground">Intern Meals</span>
          <span className="text-[11px] text-muted-foreground">College students</span>
        </div>

        <div className="flex flex-col items-start gap-1 rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 shadow-sm">
          <div className="flex w-full items-center justify-between">
            <span className="text-2xl font-extrabold text-amber-600 dark:text-amber-400">{todayMetrics.visitorMeals}</span>
            <ShieldAlert className="h-4 w-4 text-amber-500" />
          </div>
          <span className="text-xs font-semibold text-foreground">Visitor Meals</span>
          <span className="text-[11px] text-muted-foreground">Authorized guest passes</span>
        </div>

        <div className="flex flex-col items-start gap-1 rounded-xl border border-red-500/20 bg-red-500/10 p-4 shadow-sm col-span-2 sm:col-span-1">
          <div className="flex w-full items-center justify-between">
            <span className="text-2xl font-extrabold text-red-600 dark:text-red-400">{todayMetrics.duplicatesBlocked}</span>
            <AlertTriangle className="h-4 w-4 text-red-600" />
          </div>
          <span className="text-xs font-semibold text-foreground">Duplicates Blocked</span>
          <span className="text-[11px] text-red-700/80 dark:text-red-300">Prevented double claims</span>
        </div>
      </div>

      {/* ─────────────────────────────────────────────────────────────────── */}
      {/* TAB 1: SCANNER INTERFACE (Tasks 7.1 & 7.2)                         */}
      {/* ─────────────────────────────────────────────────────────────────── */}
      {activeTab === "scan" && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">

          {/* Left Column: Meal Selector & Scan Input (7 cols) */}
          <div className="lg:col-span-7 space-y-6">

            {/* Meal Type Selection Strip */}
            <div className="rounded-xl border border-border bg-card p-4 shadow-sm space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <ActiveMealIcon className="h-4 w-4 text-red-600" /> Current Meal Service
                </span>
                <span className="text-xs text-muted-foreground font-mono">
                  {new Date().toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {(["breakfast", "lunch", "dinner", "night_snack"] as MealType[]).map((m) => {
                  const Icon = mealTypeIcon(m);
                  const isSelected = mealType === m;
                  return (
                    <button
                      key={m}
                      onClick={() => setMealType(m)}
                      className={`flex flex-col items-center justify-center gap-1.5 rounded-lg border p-2.5 text-xs font-semibold transition-all ${
                        isSelected
                          ? "border-red-600 bg-red-600/10 text-red-600 shadow-sm"
                          : "border-border bg-secondary/40 text-muted-foreground hover:bg-secondary hover:text-foreground"
                      }`}
                    >
                      <Icon className={`h-4 w-4 ${isSelected ? "text-red-600" : "text-muted-foreground"}`} />
                      <span>{mealTypeLabel(m)}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Scan Gun Input Card */}
            <div className="rounded-xl border border-border bg-card p-6 shadow-sm space-y-4">
              <div className="space-y-1">
                <h2 className="text-lg font-bold tracking-tight text-foreground flex items-center gap-2">
                  <ScanLine className="h-5 w-5 text-red-600" />
                  Scan Worker / Intern / Visitor Pass
                </h2>
                <p className="text-xs text-muted-foreground">
                  Scan 1D barcode or enter Worker ID. Atomic duplicate checks enforce exactly 1 meal per person today.
                </p>
              </div>

              <form onSubmit={handleSubmit} className="flex gap-2">
                <div className="relative flex-1">
                  <ScanLine className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    ref={inputRef}
                    value={barcodeInput}
                    onChange={(e) => setBarcodeInput(e.target.value)}
                    placeholder="Scan pass or enter ID (e.g. WRK-2026-001, INT-102)…"
                    className="pl-11 h-12 text-base font-mono tracking-wide border-2 focus-visible:ring-red-600"
                    disabled={isProcessing}
                    autoFocus
                  />
                </div>
                <Button
                  type="submit"
                  disabled={!barcodeInput.trim() || isProcessing}
                  className="h-12 px-6 bg-red-600 hover:bg-red-700 text-white font-semibold text-sm"
                >
                  {isProcessing ? "Verifying…" : "Validate"}
                </Button>
              </form>

              <div className="flex items-center justify-between text-xs text-muted-foreground pt-1">
                <span className="flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                  Scanner gun ready (auto-submits on Enter)
                </span>
                <span className="font-medium text-foreground/80">
                  Target: <strong className="text-red-600">{mealTypeLabel(mealType)}</strong>
                </span>
              </div>
            </div>

            {/* High-Visibility Decision Result Banner (3-5m Distance Visibility) */}
            {latestResult && (
              <div
                className={`rounded-2xl border-2 p-6 shadow-md transition-all animate-in fade-in zoom-in-95 ${
                  latestResult.decision === "allowed"
                    ? "border-emerald-500 bg-emerald-500/10 text-emerald-950 dark:text-emerald-100"
                    : latestResult.priorClaimAt
                    ? "border-amber-500 bg-amber-500/15 text-amber-950 dark:text-amber-100"
                    : "border-red-600 bg-red-600/15 text-red-950 dark:text-red-100"
                }`}
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="flex items-start gap-4">
                    {/* Status Icon */}
                    <div className="mt-0.5">
                      {latestResult.decision === "allowed" ? (
                        <CheckCircle2 className="h-12 w-12 text-emerald-600" />
                      ) : latestResult.priorClaimAt ? (
                        <AlertTriangle className="h-12 w-12 text-amber-600 animate-bounce" />
                      ) : (
                        <XCircle className="h-12 w-12 text-red-600" />
                      )}
                    </div>

                    {/* Decision Text */}
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span
                          className={`text-2xl font-black tracking-tight ${
                            latestResult.decision === "allowed"
                              ? "text-emerald-700 dark:text-emerald-300"
                              : latestResult.priorClaimAt
                              ? "text-amber-800 dark:text-amber-300"
                              : "text-red-700 dark:text-red-300"
                          }`}
                        >
                          {latestResult.decision === "allowed"
                            ? "MEAL ENTITLEMENT APPROVED"
                            : latestResult.priorClaimAt
                            ? "DUPLICATE SCAN — ALREADY CLAIMED"
                            : "MEAL NOT AUTHORIZED"}
                        </span>
                        <Badge
                          className={`text-xs uppercase font-bold px-2 py-0.5 ${
                            latestResult.decision === "allowed"
                              ? "bg-emerald-600 text-white"
                              : latestResult.priorClaimAt
                              ? "bg-amber-600 text-white"
                              : "bg-red-600 text-white"
                          }`}
                        >
                          {mealTypeLabel(latestResult.mealType)}
                        </Badge>
                      </div>

                      <p className="text-sm font-semibold opacity-90">
                        {latestResult.reason}
                      </p>

                      {latestResult.priorClaimAt && (
                        <div className="mt-2 inline-flex items-center gap-2 rounded-lg border border-amber-600/30 bg-amber-600/15 px-3 py-1.5 text-xs font-bold text-amber-900 dark:text-amber-200">
                          <Clock className="h-3.5 w-3.5 text-amber-700 dark:text-amber-300" />
                          First registered at: {new Date(latestResult.priorClaimAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })} today
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Person Thumbnail / Initials */}
                  {latestResult.person && (
                    <div className="flex items-center gap-3 border-t sm:border-t-0 sm:border-l border-border/60 pt-3 sm:pt-0 sm:pl-4">
                      <div className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-full bg-secondary ring-2 ring-border">
                        {latestResult.person.photo_url ? (
                          <img
                            src={latestResult.person.photo_url}
                            alt={latestResult.person.full_name}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <span className="font-extrabold text-sm text-foreground">
                            {getInitials(latestResult.person.full_name)}
                          </span>
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="font-bold text-sm text-foreground leading-snug">
                          {latestResult.person.full_name}
                        </p>
                        <p className="text-xs font-mono text-muted-foreground">
                          {latestResult.person.admission_number}
                        </p>
                        <p className="text-xs text-muted-foreground truncate max-w-[150px]">
                          {latestResult.person.company_name || latestResult.person.institution || "ABB Plant 3"}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Right Column: Live Session Scans Feed (5 cols) */}
          <div className="lg:col-span-5 rounded-xl border border-border bg-card p-5 shadow-sm space-y-4">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div className="flex items-center gap-2">
                <History className="h-4 w-4 text-muted-foreground" />
                <h3 className="text-sm font-bold text-foreground">Recent Meal Scans</h3>
              </div>
              <span className="text-xs text-muted-foreground">This session</span>
            </div>

            {recentScans.length === 0 ? (
              <div className="py-16 text-center text-xs text-muted-foreground">
                <Utensils className="mx-auto h-8 w-8 text-muted-foreground/30 mb-2" />
                No scans recorded in this active window yet.
              </div>
            ) : (
              <div className="divide-y divide-border/60">
                {recentScans.map((scan) => {
                  const isAllowed = scan.decision === "allowed";
                  const isDuplicate = !!scan.priorClaimAt;

                  return (
                    <div key={scan.id} className="py-3 flex items-center justify-between gap-3 text-xs">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div
                          className={`grid h-7 w-7 shrink-0 place-items-center rounded-full ${
                            isAllowed
                              ? "bg-emerald-500/15 text-emerald-600"
                              : isDuplicate
                              ? "bg-amber-500/20 text-amber-600"
                              : "bg-red-500/15 text-red-600"
                          }`}
                        >
                          {isAllowed ? (
                            <CheckCircle2 className="h-4 w-4" />
                          ) : (
                            <XCircle className="h-4 w-4" />
                          )}
                        </div>

                        <div className="min-w-0">
                          <p className="font-semibold text-foreground truncate">
                            {scan.person ? scan.person.full_name : scan.code}
                          </p>
                          <p className="text-[11px] text-muted-foreground truncate">
                            {scan.person?.company_name || scan.person?.institution || "Unregistered"} • {mealTypeLabel(scan.mealType)}
                          </p>
                        </div>
                      </div>

                      <div className="flex flex-col items-end shrink-0">
                        <Badge
                          variant="outline"
                          className={`text-[10px] font-bold px-1.5 py-0 ${
                            isAllowed
                              ? "border-emerald-500/30 text-emerald-600 bg-emerald-500/5"
                              : isDuplicate
                              ? "border-amber-500/40 text-amber-600 bg-amber-500/10"
                              : "border-red-500/30 text-red-600 bg-red-500/5"
                          }`}
                        >
                          {isAllowed ? "ALLOWED" : isDuplicate ? "DUPLICATE" : "DENIED"}
                        </Badge>
                        <span className="text-[10px] text-muted-foreground mt-0.5">
                          {scan.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────────── */}
      {/* TAB 2: MEAL LOGS & AUDIT REPORTS (Task 7.3)                         */}
      {/* ─────────────────────────────────────────────────────────────────── */}
      {activeTab === "reports" && (
        <div className="space-y-4">

          {/* Filter Toolbar */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-4 shadow-sm">
            <div className="flex flex-wrap items-center gap-3 flex-1 min-w-[240px]">
              {/* Search */}
              <div className="relative flex-1 min-w-[200px]">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={reportSearch}
                  onChange={(e) => setReportSearch(e.target.value)}
                  placeholder="Filter by name, ID, contractor company…"
                  className="pl-9 h-9 text-xs"
                />
              </div>

              {/* Date Filter */}
              <Select value={reportDateRange} onValueChange={(v) => setReportDateRange(v as any)}>
                <SelectTrigger className="w-[140px] h-9 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="today">Today</SelectItem>
                  <SelectItem value="yesterday">Yesterday</SelectItem>
                  <SelectItem value="7d">Last 7 Days</SelectItem>
                  <SelectItem value="30d">Last 30 Days</SelectItem>
                </SelectContent>
              </Select>

              {/* Meal Type Filter */}
              <Select value={reportMealType} onValueChange={setReportMealType}>
                <SelectTrigger className="w-[150px] h-9 text-xs">
                  <SelectValue placeholder="All Meals" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Meal Types</SelectItem>
                  <SelectItem value="breakfast">Breakfast</SelectItem>
                  <SelectItem value="lunch">Lunch</SelectItem>
                  <SelectItem value="dinner">Dinner</SelectItem>
                  <SelectItem value="night_snack">Night Snack</SelectItem>
                </SelectContent>
              </Select>

              {/* Decision Filter */}
              <Select value={reportDecision} onValueChange={setReportDecision}>
                <SelectTrigger className="w-[140px] h-9 text-xs">
                  <SelectValue placeholder="All Decisions" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Decisions</SelectItem>
                  <SelectItem value="allowed">Allowed Only</SelectItem>
                  <SelectItem value="denied">Denied / Duplicate</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* CSV Export Button */}
            <Button
              size="sm"
              variant="outline"
              onClick={exportCanteenCSV}
              disabled={filteredLogs.length === 0}
              className="gap-1.5 h-9"
            >
              <Download className="h-3.5 w-3.5" /> Export Canteen CSV
            </Button>
          </div>

          {/* Audit Logs Table */}
          <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
            <div className="flex items-center justify-between border-b border-border bg-secondary/30 px-5 py-3">
              <span className="text-xs font-semibold text-foreground">
                Showing {filteredLogs.length} canteen logs
              </span>
              <span className="text-xs text-muted-foreground">
                ABB Plant 3 Cafeteria Audit
              </span>
            </div>

            {logsLoading ? (
              <div className="flex items-center justify-center py-16">
                <div className="h-7 w-7 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              </div>
            ) : filteredLogs.length === 0 ? (
              <div className="py-16 text-center text-xs text-muted-foreground">
                No canteen records found matching your filters.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-border bg-secondary/20 text-muted-foreground font-semibold">
                    <tr>
                      <th className="px-4 py-3">Time</th>
                      <th className="px-4 py-3">Person</th>
                      <th className="px-4 py-3">Category</th>
                      <th className="px-4 py-3">Company / Dept</th>
                      <th className="px-4 py-3">Meal</th>
                      <th className="px-4 py-3">Decision</th>
                      <th className="px-4 py-3">Reason / Details</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {filteredLogs.map((log) => {
                      const isAllowed = log.decision === "allowed";
                      const isDuplicate = !isAllowed && log.reason?.toLowerCase().includes("duplicate");
                      const category = log.students?.category || (log.students?.is_visitor ? "visitor" : "worker");

                      return (
                        <tr key={log.id} className="hover:bg-secondary/30 transition-colors">
                          <td className="px-4 py-3 font-mono text-muted-foreground whitespace-nowrap">
                            {new Date(log.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                            <span className="block text-[10px] opacity-75">{log.log_date}</span>
                          </td>

                          <td className="px-4 py-3 font-semibold text-foreground whitespace-nowrap">
                            {log.students ? (
                              <div>
                                <p>{log.students.full_name}</p>
                                <span className="font-mono text-[10px] text-muted-foreground font-normal">
                                  {log.students.admission_number}
                                </span>
                              </div>
                            ) : (
                              <span className="font-mono">{log.scanned_code}</span>
                            )}
                          </td>

                          <td className="px-4 py-3">
                            <Badge
                              variant="outline"
                              className={`text-[10px] font-semibold uppercase ${
                                category === "intern"
                                  ? "border-indigo-500/30 bg-indigo-500/10 text-indigo-600"
                                  : category === "visitor"
                                  ? "border-amber-500/30 bg-amber-500/10 text-amber-600"
                                  : "border-blue-500/30 bg-blue-500/10 text-blue-600"
                              }`}
                            >
                              {category}
                            </Badge>
                          </td>

                          <td className="px-4 py-3 text-muted-foreground">
                            {log.students?.company_name || log.students?.institution || "ABB Plant 3"}
                          </td>

                          <td className="px-4 py-3 font-medium text-foreground">
                            {mealTypeLabel(log.meal_type as MealType)}
                          </td>

                          <td className="px-4 py-3">
                            <Badge
                              className={`text-[10px] font-bold ${
                                isAllowed
                                  ? "bg-emerald-600 text-white"
                                  : isDuplicate
                                  ? "bg-amber-600 text-white"
                                  : "bg-red-600 text-white"
                              }`}
                            >
                              {isAllowed ? "ALLOWED" : isDuplicate ? "DUPLICATE" : "DENIED"}
                            </Badge>
                          </td>

                          <td className="px-4 py-3 text-muted-foreground max-w-xs truncate" title={log.reason || ""}>
                            {log.reason || "—"}
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
      )}
    </div>
  );
}
