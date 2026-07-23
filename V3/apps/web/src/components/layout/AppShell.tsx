import { useEffect, useState, type ReactNode } from "react";
import type { AppSession } from "../../App.js";
import { NAVIGATION } from "./navigation.js";

interface AppShellProps {
  children: ReactNode;
  path: string;
  session: AppSession;
  isAdmin: boolean;
  onNavigate: (path: string) => void;
}

export function AppShell({ children, path, session, isAdmin, onNavigate }: AppShellProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const signedIn = session !== null && session !== "loading";
  const visibleItems = NAVIGATION.filter(
    (item) => item.auth === "public" || (item.auth === "signed-in" && signedIn) || (item.auth === "admin" && isAdmin)
  );

  useEffect(() => setMenuOpen(false), [path]);

  function navigate(nextPath: string) {
    setMenuOpen(false);
    onNavigate(nextPath);
  }

  const navigation = (
    <nav aria-label="Primary navigation">
      {visibleItems.map((item) => (
        <a
          className={path === item.path ? "nav-link nav-link--active" : "nav-link"}
          href={item.path}
          key={item.path}
          aria-current={path === item.path ? "page" : undefined}
          onClick={(event) => {
            event.preventDefault();
            navigate(item.path);
          }}
        >
          {item.label}
        </a>
      ))}
    </nav>
  );

  return (
    <div className="app-shell">
      <header className="app-header">
        <a
          className="brand"
          href="/"
          onClick={(event) => {
            event.preventDefault();
            navigate("/");
          }}
        >
          <span className="brand-mark" aria-hidden="true">PT</span>
          <span>PokéTracker</span>
        </a>
        <div className="header-actions">
          <span className="session-label">
            {session === "loading" ? "Checking session…" : signedIn ? session.user.email ?? "Collector" : "Guest"}
          </span>
          <button
            className="menu-button"
            type="button"
            aria-expanded={menuOpen}
            aria-controls="mobile-navigation"
            aria-label={menuOpen ? "Close navigation menu" : "Open navigation menu"}
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? "Close" : "Menu"}
          </button>
        </div>
      </header>

      <aside className="sidebar">{navigation}</aside>
      {menuOpen ? <div className="mobile-navigation" id="mobile-navigation">{navigation}</div> : null}
      <main className="page-content">{children}</main>
    </div>
  );
}
