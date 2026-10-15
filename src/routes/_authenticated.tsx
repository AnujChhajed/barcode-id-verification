import {
  createFileRoute,
  Outlet,
  Link,
  Navigate,
  useRouter,
  useRouterState,
} from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { useIdleTimeout } from "@/lib/use-idle-timeout";
import { toast } from "sonner";
import {
  ShieldCheck,
  ScanLine,
  Users,
  ClipboardList,
  Settings,
  LogOut,
  UserCog,
  LayoutDashboard,
  DoorOpen,
  UserPlus,
  ChevronLeft,
  ChevronRight,
  Bell,
  BarChart2,
  Eye,
  Megaphone,
  Timer,
  AlertOctagon,
  CalendarClock,
  Flag,
  Menu,
  X,
  Utensils,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { AbbLogo } from "@/components/AbbLogo";

// ─── Nav definition ────────────────────────────────────────────────────────

const NAV_ITEMS = [
  { to: "/dashboard",     labelKey: "nav.dashboard",     icon: LayoutDashboard, adminOnly: true  },
  { to: "/verify",        labelKey: "nav.gate_scan",     icon: ScanLine,        adminOnly: false },
  { to: "/announcements", labelKey: "nav.announcements", icon: Megaphone,       adminOnly: false },
  { to: "/my-shift",      labelKey: "nav.my_shift",      icon: Timer,           adminOnly: false },
  { to: "/inside",        labelKey: "nav.whos_inside",   icon: Eye,             adminOnly: false },
  { to: "/canteen",       labelKey: "nav.canteen",       icon: Utensils,        adminOnly: false },
  { to: "/visitors",      labelKey: "nav.visitors",      icon: UserPlus,        adminOnly: false },
  { to: "/appointments",  labelKey: "nav.appointments",  icon: CalendarClock,   adminOnly: false },
  { to: "/incidents",     labelKey: "nav.incidents",     icon: AlertOctagon,    adminOnly: false },
  { to: "/watchlist",     labelKey: "nav.watchlist",     icon: Flag,            adminOnly: false },
  { to: "/logs",          labelKey: "nav.logs",          icon: ClipboardList,   adminOnly: false },
  { to: "/reports",       labelKey: "nav.reports",       icon: BarChart2,       adminOnly: false },
  { to: "/personnel",     labelKey: "nav.personnel",     icon: Users,           adminOnly: true  },
  { to: "/gates",         labelKey: "nav.gates",         icon: DoorOpen,        adminOnly: true  },
  { to: "/notifications", labelKey: "nav.notifications", icon: Bell,            adminOnly: true  },
  { to: "/users",         labelKey: "nav.users",         icon: UserCog,         adminOnly: true  },
  { to: "/settings",      labelKey: "nav.settings",      icon: Settings,        adminOnly: true  },
] as const;


// ─── Route ─────────────────────────────────────────────────────────────────

export const Route = createFileRoute("/_authenticated")({
  component: AuthenticatedLayout,
});

// ─── Layout ────────────────────────────────────────────────────────────────

function AuthenticatedLayout() {
  const { t } = useTranslation();
  const { user, loading, isAdmin, signOut } = useAuth();
  const router = useRouter();
  const { location } = useRouterState();

  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem("sidebar-collapsed") === "true"; }
    catch { return false; }
  });

  useEffect(() => {
    try { localStorage.setItem("sidebar-collapsed", String(collapsed)); }
    catch { /* ignore */ }
  }, [collapsed]);

  const [avatarMenuOpen,   setAvatarMenuOpen]   = useState(false);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  // Two separate refs because both desktop and mobile headers render simultaneously
  // (one hidden via CSS). A single ref would be overwritten by whichever mounts last,
  // making the outside-click handler fire immediately and close the menu on every click.
  const desktopAvatarRef = useRef<HTMLDivElement>(null);
  const mobileAvatarRef  = useRef<HTMLDivElement>(null);
  const mobileDrawerRef  = useRef<HTMLDivElement>(null);

  // Close avatar menu when clicking outside either header's avatar container
  useEffect(() => {
    if (!avatarMenuOpen) return;
    const handler = (e: MouseEvent) => {
      const t = e.target as Node;
      const insideDesktop = desktopAvatarRef.current?.contains(t);
      const insideMobile  = mobileAvatarRef.current?.contains(t);
      if (!insideDesktop && !insideMobile) setAvatarMenuOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [avatarMenuOpen]);

  // Close mobile drawer when clicking the backdrop (outside the panel)
  useEffect(() => {
    if (!mobileDrawerOpen) return;
    const handler = (e: MouseEvent) => {
      if (!mobileDrawerRef.current?.contains(e.target as Node)) {
        setMobileDrawerOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [mobileDrawerOpen]);

  // ── Sign out helper (defined before hooks that reference it) ──────────
  // Uses replace:true so the back button can't return to a protected page after logout.
  // No extra router.navigate needed — _authenticated renders <Navigate to="/login" replace />
  // when user becomes null, which handles the redirect without stacking history.
  const handleSignOut = async () => {
    await signOut();
    // Navigate is handled below by the `if (!user)` guard (replace:true)
  };

  // ── Session auto-logout — MUST be above early returns so hook count is stable ──
  const { data: timeoutSetting } = useQuery({
    queryKey: ["setting-timeout"],
    staleTime: 5 * 60_000,
    enabled:  !!user,
    queryFn: async () => {
      const { data } = await supabase
        .from("settings")
        .select("value")
        .eq("key", "session_timeout_minutes")
        .maybeSingle();
      return Number(data?.value ?? 30);
    },
  });

  // ── Unread announcements badge count ────────────────────────────────
  const { data: unreadAnnouncementCount } = useQuery({
    queryKey: ["announcements-unread", user?.id],
    enabled: !!user,
    refetchInterval: 60_000,
    queryFn: async () => {
      const now = new Date().toISOString();
      // All active (non-expired) announcements
      const { data: all } = await supabase
        .from("announcements")
        .select("id")
        .or(`expires_at.is.null,expires_at.gt.${now}`);
      if (!all || all.length === 0) return 0;
      // Which ones the user has already read
      const { data: reads } = await supabase
        .from("announcement_reads")
        .select("announcement_id")
        .eq("user_id", user!.id);
      const readIds = new Set((reads ?? []).map((r: any) => r.announcement_id as string));
      return all.filter((a: any) => !readIds.has(a.id)).length;
    },
  });

  const timeoutMs = (timeoutSetting ?? 30) * 60_000;

  useIdleTimeout({
    timeoutMs,
    enabled: !!user,
    onWarn: () => {
      toast.warning("Session expiring soon", {
        description: "You'll be signed out in 60 seconds due to inactivity.",
        duration: 55_000,
      });
    },
    onTimeout: async () => {
      toast.info("Signed out due to inactivity");
      await handleSignOut();
    },
  });

  // ── Loading / auth guards — after ALL hooks ───────────────────────────
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
  if (!user) return <Navigate to="/login" replace />;

  // ── Derived values ───────────────────────────────────────────────────
  const navItems = NAV_ITEMS.filter((i) => isAdmin || !i.adminOnly);
  const mobileNavItems = navItems.slice(0, 4);

  const pathname = location.pathname;
  const pageTitle =
    navItems.find(
      ({ to }) => pathname === to || pathname.startsWith(to + "/")
    )?.labelKey
      ? t(navItems.find(({ to }) => pathname === to || pathname.startsWith(to + "/"))!.labelKey)
      : "ABB";

  const initials = (user.email ?? "U").slice(0, 2).toUpperCase();
  const roleLabel = isAdmin ? t("common.admin") : t("common.operator");

  return (
    <div className="flex min-h-screen bg-background">

      {/* ═══════════════════════════════════════════
          DESKTOP SIDEBAR
      ═══════════════════════════════════════════ */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-30 hidden flex-col",
          "border-r border-sidebar-border bg-sidebar",
          "transition-[width] duration-200 ease-in-out",
          "md:flex",
          collapsed ? "w-[64px]" : "w-[240px]"
        )}
      >
        {/* Logo ── */}
        <div
          className={cn(
            "flex h-16 shrink-0 items-center border-b border-sidebar-border",
            collapsed ? "justify-center px-0" : "gap-3 px-5"
          )}
        >
          {collapsed ? (
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary shadow-sm text-primary-foreground">
              <ShieldCheck className="h-5 w-5" />
            </div>
          ) : (
            <AbbLogo className="h-8 w-[76px] shrink-0 object-contain" />
          )}
          {!collapsed && (
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <p className="truncate text-sm font-bold tracking-tight text-sidebar-foreground">
                  ABB
                </p>
                <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-primary">
                  Plant 3
                </span>
              </div>
              <p className="truncate text-[10px] text-sidebar-foreground/50 font-medium uppercase tracking-widest">
                Security System
              </p>
            </div>
          )}
        </div>

        {/* Nav links ── */}
        <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-2 py-3">
          {navItems.map(({ to, labelKey, icon: Icon }) => {
            const label = t(labelKey);
            const active = pathname === to || pathname.startsWith(to + "/");
            const badge = to === "/announcements" && (unreadAnnouncementCount ?? 0) > 0
              ? unreadAnnouncementCount
              : null;
            return (
              <Link
                key={to}
                to={to}
                title={collapsed ? (badge ? `${label} (${badge})` : label) : undefined}
                className={cn(
                  "group relative flex items-center gap-3 rounded-lg text-sm font-medium",
                  "transition-all duration-150",
                  collapsed ? "justify-center px-2 py-2.5" : "px-3 py-2.5",
                  active
                    ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-sm"
                    : "text-sidebar-foreground/65 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                )}
              >
                <span className="relative shrink-0">
                  <Icon className="h-[18px] w-[18px]" />
                  {collapsed && badge && (
                    <span className="absolute -right-1 -top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-destructive text-[8px] font-bold text-white">
                      {badge > 9 ? "9+" : badge}
                    </span>
                  )}
                </span>
                {!collapsed && <span className="truncate">{label}</span>}
                {!collapsed && badge && (
                  <span className="ml-auto flex h-5 min-w-[20px] items-center justify-center rounded-full bg-destructive px-1.5 text-[10px] font-bold text-white">
                    {badge > 99 ? "99+" : badge}
                  </span>
                )}
                {!collapsed && !badge && active && (
                  <span className="ml-auto h-1.5 w-1.5 rounded-full bg-current opacity-60 animate-pulse" />
                )}
              </Link>
            );
          })}
        </nav>

        {/* Collapse toggle ── */}
        <div className="px-2 py-1">
          <button
            onClick={() => setCollapsed((c) => !c)}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className={cn(
              "flex w-full items-center gap-2 rounded-lg px-3 py-2",
              "text-xs text-sidebar-foreground/40 transition-colors",
              "hover:bg-sidebar-accent hover:text-sidebar-foreground",
              collapsed && "justify-center px-2"
            )}
          >
            {collapsed
              ? <ChevronRight className="h-4 w-4" />
              : (<><ChevronLeft className="h-4 w-4" /><span>{t("common.collapse")}</span></>)
            }
          </button>
        </div>

        {/* User section ── */}
        <div
          className={cn(
            "flex items-center gap-3 border-t border-sidebar-border p-3",
            collapsed && "justify-center"
          )}
        >
          {/* Avatar */}
          <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary/15 text-xs font-bold text-primary">
            {initials}
          </div>

          {!collapsed && (
            <>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-semibold text-sidebar-foreground">
                  {user.email}
                </p>
                <p className="text-[10px] font-medium text-sidebar-foreground/50">
                  {roleLabel}
                </p>
              </div>
              <button
                onClick={handleSignOut}
                title="Sign out"
                className="rounded-lg p-1.5 text-sidebar-foreground/40 transition-colors hover:bg-sidebar-accent hover:text-destructive"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </>
          )}
        </div>
      </aside>

      {/* ═══════════════════════════════════════════
          MAIN AREA  (offset by sidebar width)
      ═══════════════════════════════════════════ */}
      <div
        className={cn(
          "flex min-h-screen flex-1 flex-col",
          "transition-[margin-left] duration-200 ease-in-out",
          "md:ml-[240px]",
          collapsed && "md:ml-[64px]"
        )}
      >

        {/* ── Desktop top header ─────────────────── */}
        <header className="sticky top-0 z-20 hidden h-14 items-center justify-between border-b border-border bg-card/80 px-6 backdrop-blur-md md:flex">
          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold text-foreground">{pageTitle}</span>
            {/* Live system status indicator */}
            <span className="flex items-center gap-1.5 rounded-full border border-success/30 bg-success/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-success">
              <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse" />
              {t("common.live")}
            </span>
          </div>
          <LanguageSwitcher className="mr-2" />

          {/* Avatar dropdown */}
          <div className="relative" ref={desktopAvatarRef}>
            <button
              onClick={() => setAvatarMenuOpen((o) => !o)}
              className="flex items-center gap-3 rounded-lg px-2 py-1 transition-colors hover:bg-accent"
              title="Account menu"
            >
              <span className="text-xs text-muted-foreground hidden lg:block">{user.email}</span>
              <div className={cn(
                "grid h-8 w-8 place-items-center rounded-full bg-primary/10 text-xs font-bold text-primary ring-2 transition-all duration-150",
                avatarMenuOpen ? "ring-primary scale-105" : "ring-primary/20 hover:scale-110"
              )}>
                {initials}
              </div>
            </button>

            {/* Dropdown panel */}
            {avatarMenuOpen && (
              <div className="absolute right-0 top-[calc(100%+8px)] z-50 w-56 rounded-xl border border-border bg-card shadow-lg ring-1 ring-black/5 animate-in fade-in slide-in-from-top-1 duration-150">
                {/* User info */}
                <div className="flex items-center gap-3 border-b border-border px-4 py-3">
                  <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary/10 text-sm font-bold text-primary">
                    {initials}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-xs font-semibold text-foreground">{user.email}</p>
                    <p className="text-[10px] text-muted-foreground">{roleLabel}</p>
                  </div>
                </div>

                {/* Actions */}
                <div className="p-1.5">
                  <button
                    onClick={() => { setAvatarMenuOpen(false); handleSignOut(); }}
                    className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-destructive transition-colors hover:bg-destructive/10"
                  >
                    <LogOut className="h-4 w-4" />
                    {t("common.sign_out")}
                  </button>
                </div>
              </div>
            )}
          </div>
        </header>

        {/* ── Mobile top header ──────────────────── */}
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-border bg-card/90 px-4 backdrop-blur-md md:hidden">
          <div className="flex items-center gap-2.5">
            {/* Hamburger menu button */}
            <button
              onClick={() => setMobileDrawerOpen((o) => !o)}
              className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
              title="All pages"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div>
              <div className="flex items-center gap-1.5">
                <p className="text-sm font-bold leading-tight tracking-tight">ABB</p>
                <span className="rounded bg-primary/10 px-1 py-0.2 text-[9px] font-bold uppercase tracking-wider text-primary">
                  Plant 3
                </span>
              </div>
              <p className="text-[10px] font-medium leading-tight text-muted-foreground">{pageTitle}</p>
            </div>
          </div>

          <LanguageSwitcher className="mx-auto" />

          {/* Mobile avatar dropdown */}
          <div className="relative" ref={mobileAvatarRef}>
            <button
              onClick={() => setAvatarMenuOpen((o) => !o)}
              className={cn(
                "flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold text-primary ring-2 transition-all duration-150",
                avatarMenuOpen ? "bg-primary/20 ring-primary scale-105" : "bg-primary/10 ring-primary/20"
              )}
              title="Account menu"
            >
              {initials}
            </button>

            {avatarMenuOpen && (
              <div className="absolute right-0 top-[calc(100%+8px)] z-50 w-56 rounded-xl border border-border bg-card shadow-lg ring-1 ring-black/5 animate-in fade-in slide-in-from-top-1 duration-150">
                {/* User info */}
                <div className="flex items-center gap-3 border-b border-border px-4 py-3">
                  <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary/10 text-sm font-bold text-primary">
                    {initials}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-xs font-semibold text-foreground">{user.email}</p>
                    <p className="text-[10px] text-muted-foreground">{roleLabel}</p>
                  </div>
                </div>

                {/* Actions */}
                <div className="p-1.5">
                  <button
                    onClick={() => { setAvatarMenuOpen(false); handleSignOut(); }}
                    className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-destructive transition-colors hover:bg-destructive/10"
                  >
                    <LogOut className="h-4 w-4" />
                    {t("common.sign_out")}
                  </button>
                </div>
              </div>
            )}
          </div>
        </header>

        {/* ── Page content ───────────────────────── */}
        <main className="flex-1 pb-24 md:pb-0">
          <div
            key={pathname}
            className="mx-auto max-w-6xl px-4 py-6 md:px-8 md:py-8 animate-in fade-in slide-in-from-bottom-3 duration-300 ease-out"
          >
            <Outlet />
          </div>
        </main>
      </div>

      {/* ═══════════════════════════════════════════
          MOBILE BOTTOM NAV BAR  (4 shortcuts + More)
      ═══════════════════════════════════════════ */}
      <nav className="fixed inset-x-0 bottom-0 z-30 flex border-t border-border bg-card/95 backdrop-blur-md md:hidden">
        {mobileNavItems.map(({ to, labelKey, icon: Icon }) => {
          const label = t(labelKey);
          const active = pathname === to || pathname.startsWith(to + "/");
          const badge = to === "/announcements" && (unreadAnnouncementCount ?? 0) > 0
            ? unreadAnnouncementCount
            : null;
          return (
            <Link
              key={to}
              to={to}
              className={cn(
                "flex flex-1 flex-col items-center justify-center gap-1 py-2.5 text-[10px] font-semibold uppercase tracking-wide transition-all duration-200",
                active
                  ? "text-primary"
                  : "text-muted-foreground hover:text-foreground active:scale-95"
              )}
            >
              <div className={cn(
                "relative flex h-7 w-7 items-center justify-center rounded-xl transition-all duration-200",
                active && "bg-primary/10 scale-110"
              )}>
                <Icon className="h-5 w-5" />
                {badge && (
                  <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-[8px] font-bold text-white">
                    {badge > 9 ? "9+" : badge}
                  </span>
                )}
              </div>
              <span className={cn(active && "font-bold")}>{label}</span>
            </Link>
          );
        })}

        {/* "More" button — opens the full drawer */}
        <button
          onClick={() => setMobileDrawerOpen(true)}
          className={cn(
            "flex flex-1 flex-col items-center justify-center gap-1 py-2.5 text-[10px] font-semibold uppercase tracking-wide transition-all duration-200",
            mobileDrawerOpen ? "text-primary" : "text-muted-foreground hover:text-foreground active:scale-95"
          )}
        >
          <div className={cn(
            "relative flex h-7 w-7 items-center justify-center rounded-xl transition-all duration-200",
            mobileDrawerOpen && "bg-primary/10 scale-110"
          )}>
            <Menu className="h-5 w-5" />
            {/* Dot if current page is in overflow (not in the 4 shortcuts) */}
            {!mobileNavItems.some(i => pathname === i.to || pathname.startsWith(i.to + "/")) && (
              <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-primary" />
            )}
          </div>
          <span>{t("common.all_pages")}</span>
        </button>
      </nav>

      {/* ═══════════════════════════════════════════
          MOBILE SLIDE-IN DRAWER  (all nav items)
      ═══════════════════════════════════════════ */}
      {mobileDrawerOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm animate-in fade-in duration-200" />

          {/* Drawer panel */}
          <div
            ref={mobileDrawerRef}
            className="absolute inset-y-0 left-0 flex w-72 flex-col bg-sidebar shadow-2xl animate-in slide-in-from-left duration-250"
          >
            {/* Drawer header */}
            <div className="flex h-14 shrink-0 items-center justify-between border-b border-sidebar-border px-4">
              <div className="flex items-center gap-2.5">
                <AbbLogo className="h-6 w-[58px] shrink-0 object-contain" />
                <div>
                  <div className="flex items-center gap-1.5">
                    <p className="text-sm font-bold text-sidebar-foreground">ABB</p>
                    <span className="rounded bg-primary/10 px-1 py-0.2 text-[9px] font-bold uppercase tracking-wider text-primary">
                      Plant 3
                    </span>
                  </div>
                  <p className="text-[10px] font-medium text-sidebar-foreground/50">{roleLabel}</p>
                </div>
              </div>
              <button
                onClick={() => setMobileDrawerOpen(false)}
                className="rounded-lg p-1.5 text-sidebar-foreground/40 hover:bg-sidebar-accent hover:text-sidebar-foreground transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Nav links */}
            <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-2 py-3">
              {navItems.map(({ to, labelKey, icon: Icon }) => {
                const label = t(labelKey);
                const active = pathname === to || pathname.startsWith(to + "/");
                const badge = to === "/announcements" && (unreadAnnouncementCount ?? 0) > 0
                  ? unreadAnnouncementCount
                  : null;
                return (
                  <Link
                    key={to}
                    to={to}
                    onClick={() => setMobileDrawerOpen(false)}
                    className={cn(
                      "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-150",
                      active
                        ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-sm"
                        : "text-sidebar-foreground/65 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                    )}
                  >
                    <span className="relative shrink-0">
                      <Icon className="h-[18px] w-[18px]" />
                      {badge && (
                        <span className="absolute -right-1 -top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-destructive text-[8px] font-bold text-white">
                          {badge > 9 ? "9+" : badge}
                        </span>
                      )}
                    </span>
                    <span className="flex-1 truncate">{label}</span>
                    {badge && (
                      <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-destructive px-1.5 text-[10px] font-bold text-white">
                        {badge > 99 ? "99+" : badge}
                      </span>
                    )}
                    {!badge && active && (
                      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-60 animate-pulse" />
                    )}
                  </Link>
                );
              })}
            </nav>

            {/* Drawer footer — user info + sign out */}
            <div className="flex items-center gap-3 border-t border-sidebar-border p-4">
              <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary/15 text-xs font-bold text-primary">
                {initials}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-semibold text-sidebar-foreground">{user.email}</p>
                <p className="text-[10px] font-medium text-sidebar-foreground/50">{roleLabel}</p>
              </div>
              <button
                onClick={() => { setMobileDrawerOpen(false); handleSignOut(); }}
                title={t("common.sign_out")}
                className="rounded-lg p-1.5 text-sidebar-foreground/40 hover:bg-sidebar-accent hover:text-destructive transition-colors"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
