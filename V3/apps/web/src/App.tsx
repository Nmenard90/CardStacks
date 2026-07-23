import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { AppShell } from "./components/layout/AppShell.js";
import { RouteView, normalizePath } from "./routes/RouteView.js";
import { getSupabase } from "./lib/supabase.js";
import { apiGet } from "./lib/api.js";
import "./styles/global.css";

export type AppSession = "loading" | Session | null;

interface AppProps {
  session?: AppSession;
  initialPath?: string;
  isAdmin?: boolean;
}

function useBrowserSession(override: AppSession | undefined): AppSession {
  const [session, setSession] = useState<AppSession>(override ?? "loading");

  useEffect(() => {
    if (override !== undefined) {
      setSession(override);
      return;
    }

    let active = true;
    const supabase = getSupabase();

    void supabase.auth.getSession().then(({ data }) => {
      if (active) setSession(data.session);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (active) setSession(nextSession);
    });

    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, [override]);

  return session;
}

/**
 * Admin status is authoritative server-side (packages/db AppUser.role, set from
 * an admin-email allowlist) and is never mirrored onto the Supabase auth
 * session. Resolve it from `/api/v1/me` rather than guessing from session claims.
 */
function useIsAdmin(session: AppSession, override: boolean | undefined): boolean {
  const [isAdmin, setIsAdmin] = useState(override ?? false);

  useEffect(() => {
    if (override !== undefined) {
      setIsAdmin(override);
      return;
    }

    if (session === "loading" || session === null) {
      setIsAdmin(false);
      return;
    }

    // Reset before resolving the new session's role so a stale "true" from a
    // previous admin session never lingers on screen while this lookup is
    // in flight (e.g. after one admin signs out and another user signs in).
    setIsAdmin(false);

    let active = true;
    apiGet<{ role: string }>("/api/v1/me")
      .then((me) => {
        if (active) setIsAdmin(me.role === "ADMIN");
      })
      .catch(() => {
        if (active) setIsAdmin(false);
      });

    return () => {
      active = false;
    };
  }, [session, override]);

  return isAdmin;
}

export function App({ session: sessionOverride, initialPath, isAdmin: isAdminOverride }: AppProps) {
  const session = useBrowserSession(sessionOverride);
  const isAdmin = useIsAdmin(session, isAdminOverride);
  const [path, setPath] = useState(() => normalizePath(initialPath ?? window.location.pathname));

  useEffect(() => {
    if (initialPath !== undefined) return;
    const handlePopState = () => setPath(normalizePath(window.location.pathname));
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [initialPath]);

  function navigate(nextPath: string) {
    const normalized = normalizePath(nextPath);
    if (initialPath === undefined) window.history.pushState({}, "", normalized);
    setPath(normalized);
  }

  return (
    <AppShell path={path} session={session} isAdmin={isAdmin} onNavigate={navigate}>
      <RouteView path={path} session={session} isAdmin={isAdmin} onNavigate={navigate} />
    </AppShell>
  );
}
