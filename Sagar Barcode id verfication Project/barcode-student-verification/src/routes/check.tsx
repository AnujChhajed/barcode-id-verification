/**
 * /check — Public card-status page (no login required).
 * Students / visitors can verify their own card status at a kiosk.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { AbbLogo } from "@/components/AbbLogo";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  CheckCircle2,
  XCircle,
  Clock,
  ScanLine,
  ArrowLeft,
  LayoutDashboard,
} from "lucide-react";

export const Route = createFileRoute("/check")({
  component: CardCheckPage,
});

type Access = "allowed" | "denied" | "expired";

type CheckResult = {
  found:             boolean;
  access?:           Access;
  message?:          string;
  full_name?:        string;
  admission_number?: string;
  programme?:        string;
  nta_level?:        string;
  year_of_study?:    number;
  is_visitor?:       boolean;
  expires_at?:       string | null;
  error?:            string;
};

function CardCheckPage() {
  const { t } = useTranslation();
  const { user, isAdmin } = useAuth();
  const [code,   setCode]   = useState("");
  const [busy,   setBusy]   = useState(false);
  const [result, setResult] = useState<CheckResult | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const check = async (raw = code) => {
    const trimmed = raw.trim();
    if (!trimmed) return;
    setBusy(true);
    setResult(null);
    try {
      // Uses a SECURITY DEFINER RPC so the anon role can read the safe subset
      // of student fields without opening the whole table to public reads.
      const { data, error } = await supabase.rpc("check_student_card", { p_code: trimmed });

      if (error) throw error;

      const student = Array.isArray(data) ? data[0] : data;

      if (!student) {
        setResult({ found: false, message: t("check.not_found_msg") });
        return;
      }

      // Determine access decision locally
      let access: Access = "allowed";
      let message: string | undefined;

      const now = new Date();

      if (student.expires_at && new Date(student.expires_at) < now) {
        access  = "expired";
        message = t("check.expired_on", { date: new Date(student.expires_at).toLocaleDateString() });
      } else if (student.status === "suspended") {
        const until = student.suspended_until;
        if (until && new Date(until) < now) {
          access = "allowed"; // suspension has ended
        } else {
          access  = "denied";
          message = student.suspension_reason
            ? t("check.suspended_prefix") + student.suspension_reason
            : t("check.suspended_bare");
          if (until) message += t("check.suspended_until", { date: new Date(until).toLocaleDateString() });
        }
      } else if (student.status !== "active") {
        access  = "denied";
        message = t("check.status_prefix") + student.status;
      }

      setResult({
        found:            true,
        access,
        message,
        full_name:        student.full_name,
        admission_number: student.admission_number,
        programme:        student.programme,
        nta_level:        student.nta_level,
        year_of_study:    student.year_of_study,
        is_visitor:       student.is_visitor,
        expires_at:       student.expires_at,
      });
    } catch (e: any) {
      setResult({ found: false, error: e.message ?? "An error occurred. Please try again." });
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setResult(null);
    setCode("");
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const cfg =
    !result         ? null :
    !result.found   ? { icon: XCircle,     label: t("check.not_found_label"), bg: "bg-muted",       fg: "text-foreground",              ring: "ring-border"         } :
    result.access === "allowed"  ? { icon: CheckCircle2, label: t("check.card_active"),    bg: "bg-success",     fg: "text-success-foreground",      ring: "ring-success/30"     } :
    result.access === "expired"  ? { icon: Clock,        label: t("check.pass_expired"),   bg: "bg-warning",     fg: "text-warning-foreground",      ring: "ring-warning/30"     } :
                                   { icon: XCircle,      label: t("check.access_denied"),  bg: "bg-destructive", fg: "text-destructive-foreground",  ring: "ring-destructive/30" };

  return (
    <div className="flex min-h-screen flex-col bg-background">

      {/* ── Header ── */}
      <header className="flex items-center gap-3 border-b border-border bg-card px-5 py-4 shadow-sm">
        <AbbLogo className="h-8 w-[76px] shrink-0 object-contain" />
        <div>
          <p className="text-sm font-bold leading-tight">{t("check.header_title")}</p>
          <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            {t("check.card_status")}
          </p>
        </div>

        <div className="ml-auto flex items-center gap-3">
          <LanguageSwitcher />
          {user ? (
            <Link
              to={isAdmin ? "/dashboard" : "/verify"}
              className="flex items-center gap-1.5 text-xs font-medium text-primary hover:underline transition-colors"
            >
              <LayoutDashboard className="h-3.5 w-3.5" />
              {isAdmin ? t("check.dashboard") : t("check.gate_scan")}
            </Link>
          ) : (
            <Link
              to="/login"
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft className="h-3.5 w-3.5" /> {t("check.staff_login")}
            </Link>
          )}
        </div>
      </header>

      <main className="flex flex-1 items-start justify-center px-4 py-10 sm:items-center">
        <div className="w-full max-w-md space-y-6">

          {/* ── Title ── */}
          <div className="text-center">
            <h1 className="text-xl font-bold">{t("check.title")}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("check.subtitle")}
            </p>
          </div>

          {/* ── Input form ── */}
          {!result && (
            <div className="space-y-3">
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <ScanLine className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    ref={inputRef}
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && check()}
                    placeholder={t("check.placeholder")}
                    autoFocus
                    autoComplete="off"
                    className="pl-9 h-12 text-base"
                    disabled={busy}
                  />
                </div>
                <Button
                  onClick={() => check()}
                  disabled={busy || !code.trim()}
                  className="h-12 px-6"
                >
                  {busy ? t("check.checking") : t("check.button")}
                </Button>
              </div>
              <p className="text-center text-xs text-muted-foreground">
                {t("check.public_note")}
              </p>
            </div>
          )}

          {/* ── Result card ── */}
          {result && cfg && (
            <div
              className={`rounded-2xl p-6 shadow-lg ring-2 ${cfg.bg} ${cfg.fg} ${cfg.ring} animate-in fade-in zoom-in-95 duration-200`}
            >
              <div className="flex items-center gap-3 mb-4">
                <cfg.icon className="h-8 w-8 shrink-0" />
                <h2 className="text-xl font-bold">{cfg.label}</h2>
              </div>

              {result.found && result.full_name ? (
                <div className="space-y-1.5">
                  <p className="text-2xl font-semibold leading-tight">{result.full_name}</p>
                  {result.admission_number && (
                    <p className="text-sm opacity-90 font-mono">{result.admission_number}</p>
                  )}
                  {result.programme && (
                    <p className="text-sm opacity-80">
                      {result.programme}
                      {result.nta_level    && ` · NTA ${result.nta_level}`}
                      {result.year_of_study && ` · Year ${result.year_of_study}`}
                    </p>
                  )}
                  {result.is_visitor && (
                    <span className="inline-block rounded-full bg-white/20 px-2.5 py-0.5 text-xs font-semibold">
                      {t("check.visitor_pass")}
                    </span>
                  )}
                  {result.expires_at && result.access === "allowed" && (
                    <p className="text-xs opacity-70">
                      {t("check.valid_until", { date: new Date(result.expires_at).toLocaleDateString() })}
                    </p>
                  )}
                  {result.message && (
                    <p className="mt-3 rounded-xl bg-white/15 px-3 py-2 text-sm font-medium">
                      {result.message}
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-sm opacity-90">
                  {result.error ?? result.message ?? "No student matches this code."}
                </p>
              )}

              <Button
                onClick={reset}
                className="mt-5 w-full"
                variant="secondary"
              >
                {t("check.check_another")}
              </Button>
            </div>
          )}
        </div>
      </main>

      <footer className="border-t border-border py-4 text-center text-xs text-muted-foreground">
        {t("check.footer")}
      </footer>
    </div>
  );
}
