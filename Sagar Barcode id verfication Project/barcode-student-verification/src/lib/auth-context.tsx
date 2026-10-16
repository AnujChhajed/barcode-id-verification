import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export type AppRole = "admin" | "gate";

interface AuthState {
  user: User | null;
  session: Session | null;
  roles: AppRole[];
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error?: string }>;
  signUp: (email: string, password: string, fullName: string) => Promise<{ error?: string }>;
  signOut: () => Promise<void>;
  hasRole: (role: AppRole) => boolean;
  isAdmin: boolean;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser]       = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [roles, setRoles]     = useState<AppRole[]>([]);
  const [loading, setLoading] = useState(true);

  // Tracks whether initial session resolution is complete.
  const initializedRef = useRef(false);
  // Tracks whether a user is currently signed in (ref, not state — avoids stale
  // closure bug inside onAuthStateChange which is created once and never re-bound).
  // Used to tell apart a fresh login (user was null) from a silent token refresh
  // (user was already logged in) so we only show the loading spinner for new logins.
  const hasUserRef = useRef(false);

  // ── Role loader with hard 6 s timeout ────────────────────────────────────
  // Returns the roles array instead of calling setRoles directly, so callers
  // can batch setRoles + setLoading(false) in ONE React update — preventing
  // an intermediate render where loading=false but roles=[] (isAdmin=false).
  const loadRoles = async (userId: string): Promise<AppRole[]> => {
    try {
      const query    = supabase.from("user_roles").select("role").eq("user_id", userId);
      const timeout  = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("loadRoles timeout")), 6_000),
      );
      const { data } = await Promise.race([query, timeout]) as Awaited<typeof query>;
      return (data ?? []).map((r) => r.role as AppRole);
    } catch {
      // Fail-safe: never leave the app stuck because of a role query hang
      return [];
    }
  };

  useEffect(() => {
    let mounted = true;

    // ── Safety net: if nothing resolves within 8 s, unblock the app ─────────
    const safetyTimer = setTimeout(() => {
      if (mounted && !initializedRef.current) {
        console.warn("[Auth] Initialization timed out — clearing loading state");
        initializedRef.current = true;
        setLoading(false);
      }
    }, 8_000);

    // ── Auth-state change stream ─────────────────────────────────────────────
    const { data: sub } = supabase.auth.onAuthStateChange(async (event, sess) => {
      if (!mounted) return;

      // INITIAL_SESSION fires on every page load/reload in Supabase JS v2.
      // This is the primary initialization path.
      if (event === "INITIAL_SESSION") {
        setSession(sess);
        setUser(sess?.user ?? null);
        const newRoles = sess?.user ? await loadRoles(sess.user.id) : [];
        if (mounted) {
          // Batch roles + loading=false together — prevents a render where
          // loading=false but roles=[] which would show wrong role label / navigate wrongly.
          setRoles(newRoles);
          setLoading(false);
          hasUserRef.current    = !!sess?.user;
          initializedRef.current = true;
        }
        return;
      }

      if (event === "SIGNED_IN") {
        if (!initializedRef.current) {
          // SIGNED_IN can also fire on first load in older SDK builds where
          // INITIAL_SESSION is absent. Handle it the same way — no second spinner.
          setSession(sess);
          setUser(sess?.user ?? null);
          const newRoles = sess?.user ? await loadRoles(sess.user.id) : [];
          if (mounted) {
            setRoles(newRoles);
            setLoading(false);
            hasUserRef.current    = !!sess?.user;
            initializedRef.current = true;
          }
        } else if (!hasUserRef.current) {
          // Explicit NEW login — user was null, now has a session.
          // Show loading briefly so routing decisions (isAdmin check) wait for roles.
          setLoading(true);
          setSession(sess);
          setUser(sess?.user ?? null);
          const newRoles = sess?.user ? await loadRoles(sess.user.id) : [];
          // Atomically commit roles + clear loading in one React batch.
          // This prevents an intermediate render with loading=false, roles=[]
          // which would cause login.tsx to navigate to /verify instead of /dashboard.
          if (mounted) {
            setRoles(newRoles);
            setLoading(false);
            hasUserRef.current = true;
          }
        } else {
          // Silent token refresh / re-auth — user was ALREADY logged in.
          // Supabase fires SIGNED_IN on every token refresh and on window focus.
          // Do NOT touch loading (avoids the full-page spinner flash when switching
          // back to the window). Roles haven't changed — no need to re-query them.
          if (mounted && sess) {
            setSession(sess);
            setUser(sess.user ?? null);
          }
        }
        return;
      }

      if (event === "SIGNED_OUT") {
        setSession(null);
        setUser(null);
        setRoles([]);
        hasUserRef.current = false;
        // Don't touch loading here — sign-out navigates away immediately
        return;
      }

      // TOKEN_REFRESHED, USER_UPDATED, PASSWORD_RECOVERY — keep session in sync silently
      if (sess) {
        setSession(sess);
        setUser(sess.user ?? null);
      }
    });

    return () => {
      mounted = false;
      clearTimeout(safetyTimer);
      sub.subscription.unsubscribe();
    };
  }, []);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return error ? { error: error.message } : {};
  };

  const signUp = async (email: string, password: string, fullName: string) => {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/`,
        data: { full_name: fullName },
      },
    });
    return error ? { error: error.message } : {};
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  const hasRole = (role: AppRole) => roles.includes(role);

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        roles,
        loading,
        signIn,
        signUp,
        signOut,
        hasRole,
        isAdmin: roles.includes("admin"),
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
