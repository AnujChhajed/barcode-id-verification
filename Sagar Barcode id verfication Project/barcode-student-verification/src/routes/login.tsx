import { createFileRoute, useNavigate, Navigate } from "@tanstack/react-router";
import { useState, useEffect, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScanLine, Users, BarChart3 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { AbbLogo } from "@/components/AbbLogo";

export const Route = createFileRoute("/login")({
  component: LoginPage,
});

function LoginPage() {
  const { t } = useTranslation();
  const { signIn, signUp, user, loading, isAdmin } = useAuth();
  const navigate = useNavigate();

  const [mode,       setMode]       = useState<"signin" | "signup">("signin");
  const [email,      setEmail]      = useState("");
  const [password,   setPassword]   = useState("");
  const [fullName,   setFullName]   = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [didSubmit,  setDidSubmit]  = useState(false);

  // Bug fix: navigate only AFTER auth state settles (user + roles both ready).
  // Avoids the race where navigate fires while user is still null → brief /login flash.
  // Also handles the "already logged in → visiting /login" redirect.
  useEffect(() => {
    if (!loading && user) {
      navigate({ to: isAdmin ? "/dashboard" : "/verify", replace: true });
    }
  }, [loading, user, isAdmin, navigate, didSubmit]);

  const handle = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    const res =
      mode === "signin"
        ? await signIn(email, password)
        : await signUp(email, password, fullName);
    setSubmitting(false);
    if (res.error) {
      toast.error(res.error);
      return;
    }
    if (mode === "signup") toast.success(t("login.account_created"));
    // Trigger the useEffect to fire once auth state settles
    setDidSubmit(true);
  };

  const features = [
    { icon: ScanLine,  text: t("login.feat_instant") },
    { icon: Users,     text: t("login.feat_mgmt")    },
    { icon: BarChart3, text: t("login.feat_audit")   },
  ];

  return (
    <div className="flex min-h-screen bg-background">

      {/* ── Left branding panel (hidden on small screens) ── */}
      <div
        className="hidden w-[45%] flex-col justify-between border-r border-border bg-card p-10 text-foreground lg:flex"
      >
        {/* Logo */}
        <div className="flex items-center gap-3">
          <AbbLogo className="h-8 w-[78px] shrink-0 object-contain" />
          <div>
            <p className="text-base font-bold tracking-tight">ABB</p>
            <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
              {t("login.barcode_ver")}
            </p>
          </div>
        </div>

        {/* Headline */}
        <div className="max-w-md space-y-5">
          <p className="text-xs font-semibold uppercase tracking-widest text-primary">
            {t("login.brand_subtitle")}
          </p>
          <h1 className="text-4xl font-bold leading-tight tracking-tight whitespace-pre-line">
            {t("login.secure_campus")}
          </h1>
          <p className="max-w-xs text-sm leading-relaxed text-muted-foreground">
            {t("login.scan_desc")}
          </p>

          <ul className="space-y-3 pt-2">
            {features.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-3 text-sm">
                <div className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                  <Icon className="h-3.5 w-3.5" />
                </div>
                <span>{text}</span>
              </li>
            ))}
          </ul>
        </div>

        <p className="text-xs text-muted-foreground">{t("login.dept_footer")}</p>
      </div>

      {/* ── Right form panel ── */}
      <div className="flex flex-1 flex-col items-center justify-center bg-background px-5 py-10 sm:px-8 sm:py-12">

        {/* Mobile-only logo */}
        <div className="mb-8 flex items-center gap-3 lg:hidden">
          <AbbLogo className="h-8 w-[78px] shrink-0 object-contain" />
          <div>
            <p className="text-base font-bold">ABB</p>
            <p className="text-xs text-muted-foreground">{t("login.barcode_ver")}</p>
          </div>
        </div>

        <div className="w-full max-w-[420px] rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8">
          {/* Language switcher */}
          <div className="mb-6 flex justify-center">
            <LanguageSwitcher />
          </div>

          {/* Heading */}
          <div className="mb-8">
            <h2 className="text-2xl font-bold tracking-tight">
              {mode === "signin" ? t("login.welcome") : t("login.create_account")}
            </h2>
            <p className="mt-1.5 text-sm text-muted-foreground">
              {mode === "signin" ? t("login.sign_in_desc") : t("login.signup_desc")}
            </p>
          </div>

          {/* Form */}
          <form onSubmit={handle} className="space-y-4">
            {mode === "signup" && (
              <div className="space-y-1.5">
                <Label htmlFor="name">{t("login.full_name")}</Label>
                <Input
                  id="name"
                  required
                  autoComplete="name"
                  placeholder={t("login.full_name_ph")}
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                />
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="email">{t("login.email")}</Label>
              <Input
                id="email"
                type="email"
                required
                autoComplete="email"
                placeholder={t("login.email_ph")}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="password">{t("login.password")}</Label>
              <Input
                id="password"
                type="password"
                required
                minLength={6}
                autoComplete={mode === "signin" ? "current-password" : "new-password"}
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>

            <Button
              type="submit"
              className="mt-2 w-full"
              size="lg"
              disabled={submitting}
            >
              {submitting
                ? t("login.please_wait")
                : mode === "signin"
                ? t("login.sign_in")
                : t("login.create_account")}
            </Button>
          </form>

          {/* Toggle mode */}
          <p className="mt-5 text-center text-sm text-muted-foreground">
            {mode === "signin" ? (
              <>
                {t("login.no_account")}{" "}
                <button
                  type="button"
                  onClick={() => setMode("signup")}
                  className="font-semibold text-primary hover:underline"
                >
                  {t("login.create_one")}
                </button>
              </>
            ) : (
              <>
                {t("login.have_account")}{" "}
                <button
                  type="button"
                  onClick={() => setMode("signin")}
                  className="font-semibold text-primary hover:underline"
                >
                  {t("login.sign_in")}
                </button>
              </>
            )}
          </p>

          {/* Mode indicator dots */}
          <div className="mt-8 flex justify-center gap-1.5">
            {(["signin", "signup"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={cn(
                  "h-1.5 rounded-full transition-all",
                  mode === m ? "w-6 bg-primary" : "w-1.5 bg-border"
                )}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
