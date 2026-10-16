import { createFileRoute, Link, Navigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/lib/auth-context";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { AbbLogo } from "@/components/AbbLogo";
import {
  ShieldCheck, ScanLine, Users, BarChart3, QrCode, Zap, Lock,
  Bell, Clock, UserCheck, Building2, ChevronRight, CheckCircle2,
  ArrowRight, Globe, Database, FileText,
} from "lucide-react";

export const Route = createFileRoute("/")({
  component: Landing,
});

// ── Sub-components ────────────────────────────────────────────────────────────

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="text-center">
      <p className="text-3xl font-extrabold text-primary-foreground md:text-4xl">{value}</p>
      <p className="mt-1 text-xs font-medium uppercase tracking-widest text-primary-foreground/65">{label}</p>
    </div>
  );
}

function FeatureCard({
  icon: Icon, title, body, accent = false,
}: { icon: React.ElementType; title: string; body: string; accent?: boolean }) {
  return (
    <div className={`group flex flex-col gap-4 rounded-2xl border p-6 shadow-sm transition-all duration-200 hover:-translate-y-1 hover:shadow-md ${
      accent ? "border-primary/20 bg-primary/5" : "border-border bg-card"
    }`}>
      <div className={`grid h-11 w-11 place-items-center rounded-xl ${
        accent ? "bg-primary/15 text-primary" : "bg-secondary text-primary"
      }`}>
        <Icon className="h-5 w-5" />
      </div>
      <div>
        <h3 className="font-semibold text-foreground">{title}</h3>
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{body}</p>
      </div>
    </div>
  );
}

function Step({
  n, title, body,
}: { n: number; title: string; body: string }) {
  return (
    <div className="flex gap-5">
      <div className="flex flex-col items-center">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground shadow-sm">
          {n}
        </div>
        {n < 3 && <div className="mt-2 w-px flex-1 bg-border" />}
      </div>
      <div className="pb-8">
        <p className="font-semibold text-foreground">{title}</p>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{body}</p>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

function Landing() {
  const { t } = useTranslation();
  const { user, loading, isAdmin } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground">Loading…</p>
        </div>
      </div>
    );
  }
  if (user) return <Navigate to={isAdmin ? "/dashboard" : "/verify"} />;

  return (
    <div className="min-h-screen bg-background">

      {/* ═══════════════════════════════════════════
          STICKY HEADER
      ═══════════════════════════════════════════ */}
      <header className="sticky top-0 z-50 border-b border-border bg-card/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3.5">
          {/* Logo */}
          <div className="flex items-center gap-2.5">
            <AbbLogo className="h-8 w-[76px] shrink-0 object-contain" />
            <div className="leading-tight">
              <p className="text-sm font-bold tracking-tight">ABB</p>
              <p className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
                {t("landing.nav_verify")}
              </p>
            </div>
          </div>

          {/* Nav */}
          <nav className="hidden items-center gap-6 md:flex">
            <a href="#features" className="text-sm text-muted-foreground transition-colors hover:text-foreground">{t("landing.nav_features")}</a>
            <a href="#how-it-works" className="text-sm text-muted-foreground transition-colors hover:text-foreground">{t("landing.nav_how")}</a>
            <a href="#access" className="text-sm text-muted-foreground transition-colors hover:text-foreground">{t("landing.nav_access")}</a>
            <Link
              to="/check"
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              {t("landing.nav_check")}
            </Link>
          </nav>

          <LanguageSwitcher />
          <Link
            to="/login"
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition-opacity hover:opacity-90 active:scale-[0.97]"
          >
            {t("landing.nav_signin")} <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </header>

      <main>

        {/* ═══════════════════════════════════════════
            HERO
        ═══════════════════════════════════════════ */}
        <section
          className="relative overflow-hidden"
          style={{ background: "var(--gradient-hero)" }}
        >
          {/* Decorative circles */}
          <div className="pointer-events-none absolute -right-32 -top-32 h-96 w-96 rounded-full bg-white/5 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-24 left-0 h-72 w-72 rounded-full bg-white/5 blur-3xl" />

          <div className="relative mx-auto max-w-6xl px-6 pb-16 pt-20 md:pb-24 md:pt-28">
            {/* Badge */}
            <div className="inline-flex items-center gap-2 rounded-full border border-primary-foreground/20 bg-primary-foreground/10 px-3.5 py-1.5 text-xs font-semibold uppercase tracking-wider text-primary-foreground/80 backdrop-blur-sm">
              <span className="h-1.5 w-1.5 rounded-full bg-accent animate-pulse" />
              {t("landing.hero_badge")}
            </div>

            {/* Headline */}
            <h1 className="mt-5 max-w-3xl text-4xl font-extrabold leading-[1.1] tracking-tight text-primary-foreground md:text-5xl lg:text-6xl">
              {t("landing.hero_h1_1")}
              <br />
              <span className="opacity-80">{t("landing.hero_h1_2")}</span>
            </h1>

            {/* Sub-headline */}
            <p className="mt-5 max-w-2xl text-base leading-relaxed text-primary-foreground/80 md:text-lg">
              {t("landing.hero_sub")}
            </p>

            {/* CTAs */}
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link
                to="/login"
                className="inline-flex items-center gap-2 rounded-xl bg-card px-5 py-3 text-sm font-bold text-foreground shadow-lg transition-all hover:shadow-xl hover:-translate-y-0.5 active:scale-[0.97]"
              >
                <ShieldCheck className="h-4 w-4 text-primary" />
                {t("landing.hero_login")}
                <ArrowRight className="h-4 w-4 text-muted-foreground" />
              </Link>
              <Link
                to="/check"
                className="inline-flex items-center gap-2 rounded-xl border border-primary-foreground/30 px-5 py-3 text-sm font-semibold text-primary-foreground transition-all hover:bg-primary-foreground/10"
              >
                <QrCode className="h-4 w-4" />
                {t("landing.hero_check")}
              </Link>
            </div>

            {/* Stats bar */}
            <div className="mt-14 grid grid-cols-2 gap-6 border-t border-primary-foreground/15 pt-10 sm:grid-cols-4">
              <Stat value="< 1s"   label={t("landing.stat_scan")} />
              <Stat value="24 / 7" label={t("landing.stat_uptime")} />
              <Stat value="2"      label={t("landing.stat_modes")} />
              <Stat value="100%"   label={t("landing.stat_audit")} />
            </div>
          </div>
        </section>

        {/* ═══════════════════════════════════════════
            TRUST BAR
        ═══════════════════════════════════════════ */}
        <section className="border-b border-border bg-secondary/50">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-8 px-6 py-5 md:justify-between">
            {[
              { icon: CheckCircle2, text: t("landing.trust_1") },
              { icon: Database,     text: t("landing.trust_2") },
              { icon: Bell,         text: t("landing.trust_3") },
              { icon: FileText,     text: t("landing.trust_4") },
              { icon: Globe,        text: t("landing.trust_5") },
            ].map(({ icon: Icon, text }) => (
              <div key={text} className="flex items-center gap-2 text-sm text-muted-foreground">
                <Icon className="h-4 w-4 text-primary" />
                <span>{text}</span>
              </div>
            ))}
          </div>
        </section>

        {/* ═══════════════════════════════════════════
            FEATURES
        ═══════════════════════════════════════════ */}
        <section id="features" className="mx-auto max-w-6xl px-6 py-20">
          <div className="mb-12 text-center">
            <p className="text-xs font-bold uppercase tracking-widest text-primary">{t("landing.feat_label")}</p>
            <h2 className="mt-2 text-3xl font-extrabold tracking-tight md:text-4xl">
              {t("landing.feat_title")}
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-sm text-muted-foreground">
              {t("landing.feat_sub")}
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <FeatureCard accent icon={Zap}      title={t("landing.feat_1_title")} body={t("landing.feat_1_body")} />
            <FeatureCard accent icon={UserCheck} title={t("landing.feat_2_title")} body={t("landing.feat_2_body")} />
            <FeatureCard accent icon={Lock}      title={t("landing.feat_3_title")} body={t("landing.feat_3_body")} />
            <FeatureCard       icon={ScanLine}  title={t("landing.feat_4_title")} body={t("landing.feat_4_body")} />
            <FeatureCard       icon={Users}     title={t("landing.feat_5_title")} body={t("landing.feat_5_body")} />
            <FeatureCard       icon={BarChart3} title={t("landing.feat_6_title")} body={t("landing.feat_6_body")} />
            <FeatureCard       icon={Bell}      title={t("landing.feat_7_title")} body={t("landing.feat_7_body")} />
            <FeatureCard       icon={Clock}     title={t("landing.feat_8_title")} body={t("landing.feat_8_body")} />
            <FeatureCard       icon={Building2} title={t("landing.feat_9_title")} body={t("landing.feat_9_body")} />
          </div>
        </section>

        {/* ═══════════════════════════════════════════
            HOW IT WORKS
        ═══════════════════════════════════════════ */}
        <section id="how-it-works" className="border-y border-border bg-secondary/40">
          <div className="mx-auto max-w-6xl px-6 py-20">
            <div className="mb-12 text-center">
              <p className="text-xs font-bold uppercase tracking-widest text-primary">{t("landing.how_label")}</p>
              <h2 className="mt-2 text-3xl font-extrabold tracking-tight md:text-4xl">
                {t("landing.how_title")}
              </h2>
            </div>

            <div className="grid gap-10 md:grid-cols-2 md:gap-16">
              <div>
                <Step n={1} title={t("landing.step_1_title")} body={t("landing.step_1_body")} />
                <Step n={2} title={t("landing.step_2_title")} body={t("landing.step_2_body")} />
                <Step n={3} title={t("landing.step_3_title")} body={t("landing.step_3_body")} />
              </div>

              {/* Visual mock */}
              <div className="flex items-center justify-center">
                <div className="w-full max-w-sm overflow-hidden rounded-2xl border border-border bg-card shadow-xl">
                  {/* Mock header */}
                  <div className="flex items-center gap-2 border-b border-border bg-secondary/50 px-4 py-3">
                    <div className="h-3 w-3 rounded-full bg-destructive/60" />
                    <div className="h-3 w-3 rounded-full bg-warning/60" />
                    <div className="h-3 w-3 rounded-full bg-success/60" />
                    <span className="ml-2 text-xs text-muted-foreground">{t("landing.mock_gate")}</span>
                  </div>
                  {/* Mock allowed card */}
                  <div className="bg-success p-5 text-success-foreground">
                    <div className="flex items-center gap-3">
                      <CheckCircle2 className="h-7 w-7" />
                      <span className="text-xl font-extrabold tracking-wide">{t("landing.mock_granted")}</span>
                    </div>
                    <div className="mt-4 flex items-center gap-4">
                      <div className="h-16 w-16 rounded-xl bg-success-foreground/20 ring-2 ring-current/20 flex items-center justify-center">
                        <UserCheck className="h-8 w-8 opacity-70" />
                      </div>
                      <div>
                        <p className="text-lg font-bold">John M. Doe</p>
                        <p className="text-sm opacity-80 font-mono">ATC/CS/2024/042</p>
                        <p className="text-sm opacity-75">Computer Science · NTA 6 · Year 2</p>
                      </div>
                    </div>
                    <div className="mt-3 flex items-center gap-2">
                      <span className="rounded-md bg-success-foreground/20 px-2 py-0.5 text-xs font-bold uppercase">{t("landing.mock_entry")}</span>
                      <span className="text-xs opacity-70">Main Gate · {new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                    </div>
                  </div>
                  {/* Mock recent scans */}
                  <div className="divide-y divide-border">
                    {[
                      { name: "Mary A. Hassan",   code: "ATC/CE/2024/019", ok: true  },
                      { name: "Unknown code",      code: "9841203",        ok: false },
                      { name: "Peter W. Kimaro",  code: "ATC/IT/2023/088", ok: true  },
                    ].map(({ name, code, ok }) => (
                      <div key={code} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                        {ok
                          ? <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
                          : <span className="h-4 w-4 shrink-0 text-center text-destructive font-bold">✕</span>
                        }
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium text-foreground">{name}</p>
                          <p className="truncate text-xs text-muted-foreground font-mono">{code}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ═══════════════════════════════════════════
            ACCESS LEVELS
        ═══════════════════════════════════════════ */}
        <section id="access" className="mx-auto max-w-6xl px-6 py-20">
          <div className="mb-12 text-center">
            <p className="text-xs font-bold uppercase tracking-widest text-primary">{t("landing.access_label")}</p>
            <h2 className="mt-2 text-3xl font-extrabold tracking-tight md:text-4xl">
              {t("landing.access_title")}
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-sm text-muted-foreground">
              {t("landing.access_sub")}
            </p>
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            {/* Admin */}
            <div className="relative overflow-hidden rounded-2xl border-2 border-primary/25 bg-card p-7 shadow-sm">
              <div className="absolute right-0 top-0 h-28 w-28 -translate-y-1/3 translate-x-1/3 rounded-full bg-primary/8 blur-2xl" />
              <div className="relative">
                <div className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-xs font-bold uppercase tracking-wide text-primary">
                  <ShieldCheck className="h-3.5 w-3.5" /> {t("landing.admin_role")}
                </div>
                <h3 className="mt-4 text-xl font-bold">{t("landing.admin_title")}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{t("landing.admin_sub")}</p>
                <ul className="mt-5 space-y-2.5">
                  {[
                    t("landing.admin_feat_1"),
                    t("landing.admin_feat_2"),
                    t("landing.admin_feat_3"),
                    t("landing.admin_feat_4"),
                    t("landing.admin_feat_5"),
                    t("landing.admin_feat_6"),
                    t("landing.admin_feat_7"),
                    t("landing.admin_feat_8"),
                  ].map((item) => (
                    <li key={item} className="flex items-start gap-2 text-sm">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
                <Link
                  to="/login"
                  className="mt-7 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-2.5 text-sm font-bold text-primary-foreground shadow-sm transition-opacity hover:opacity-90"
                >
                  {t("landing.admin_btn")} <ChevronRight className="h-4 w-4" />
                </Link>
              </div>
            </div>

            {/* Gate operator */}
            <div className="relative overflow-hidden rounded-2xl border border-border bg-card p-7 shadow-sm">
              <div className="absolute right-0 top-0 h-28 w-28 -translate-y-1/3 translate-x-1/3 rounded-full bg-secondary blur-2xl" />
              <div className="relative">
                <div className="inline-flex items-center gap-2 rounded-full bg-secondary px-3 py-1 text-xs font-bold uppercase tracking-wide text-muted-foreground">
                  <ScanLine className="h-3.5 w-3.5" /> {t("landing.op_role")}
                </div>
                <h3 className="mt-4 text-xl font-bold">{t("landing.op_title")}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{t("landing.op_sub")}</p>
                <ul className="mt-5 space-y-2.5">
                  {[
                    t("landing.op_feat_1"),
                    t("landing.op_feat_2"),
                    t("landing.op_feat_3"),
                    t("landing.op_feat_4"),
                    t("landing.op_feat_5"),
                    t("landing.op_feat_6"),
                  ].map((item) => (
                    <li key={item} className="flex items-start gap-2 text-sm">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
                <Link
                  to="/login"
                  className="mt-7 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-border bg-secondary py-2.5 text-sm font-bold text-foreground transition-colors hover:bg-muted"
                >
                  {t("landing.op_btn")} <ChevronRight className="h-4 w-4" />
                </Link>
              </div>
            </div>
          </div>
        </section>

        {/* ═══════════════════════════════════════════
            CTA BANNER
        ═══════════════════════════════════════════ */}
        <section
          className="relative overflow-hidden border-y border-primary/20"
          style={{ background: "var(--gradient-hero)" }}
        >
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-white/5 to-transparent" />
          <div className="relative mx-auto flex max-w-6xl flex-col items-center gap-6 px-6 py-16 text-center md:flex-row md:justify-between md:text-left">
            <div>
              <h2 className="text-2xl font-extrabold text-primary-foreground md:text-3xl">
                {t("landing.cta_title")}
              </h2>
              <p className="mt-2 text-sm text-primary-foreground/75">
                {t("landing.cta_sub")}
              </p>
            </div>
            <div className="flex flex-wrap justify-center gap-3 md:justify-end">
              <Link
                to="/login"
                className="inline-flex items-center gap-2 rounded-xl bg-card px-6 py-3 text-sm font-bold text-foreground shadow-lg transition-all hover:-translate-y-0.5 hover:shadow-xl"
              >
                <ShieldCheck className="h-4 w-4 text-primary" /> {t("landing.cta_login")}
              </Link>
              <Link
                to="/check"
                className="inline-flex items-center gap-2 rounded-xl border border-primary-foreground/30 px-6 py-3 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary-foreground/10"
              >
                <QrCode className="h-4 w-4" /> {t("landing.cta_check")}
              </Link>
            </div>
          </div>
        </section>

      </main>

      {/* ═══════════════════════════════════════════
          FOOTER
      ═══════════════════════════════════════════ */}
      <footer className="border-t border-border bg-card">
        <div className="mx-auto max-w-6xl px-6 py-10">
          <div className="grid gap-8 md:grid-cols-2">

            {/* Brand */}
            <div>
              <div className="flex items-center gap-2.5">
                <AbbLogo className="h-8 w-[76px] shrink-0 object-contain" />
                <div>
                  <p className="text-sm font-bold">ABB</p>
                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground">{t("landing.nav_verify")}</p>
                </div>
              </div>
              <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                {t("landing.footer_tagline")}
              </p>
            </div>

            {/* Quick links */}
            <div>
              <p className="mb-3 text-xs font-bold uppercase tracking-wider text-muted-foreground">{t("landing.footer_links")}</p>
              <ul className="space-y-2">
                {[
                  { to: "/login", label: t("landing.footer_link_login") },
                  { to: "/check", label: t("landing.footer_link_check") },
                  { href: "#features",     label: t("landing.footer_link_feat") },
                  { href: "#how-it-works", label: t("landing.footer_link_how") },
                ].map((link) => (
                  <li key={link.label}>
                    {"to" in link ? (
                      <Link to={link.to} className="flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground">
                        <ChevronRight className="h-3.5 w-3.5" /> {link.label}
                      </Link>
                    ) : (
                      <a href={link.href} className="flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground">
                        <ChevronRight className="h-3.5 w-3.5" /> {link.label}
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </div>

          </div>

          <div className="mt-8 border-t border-border pt-6 text-center">
            <p className="text-xs text-muted-foreground">
              {t("landing.footer_copy", { year: new Date().getFullYear() })}
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
