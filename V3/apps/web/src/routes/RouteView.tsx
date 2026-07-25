import type { AppSession } from "../App.js";
import { StatePanel } from "../components/ui/StatePanel.js";
import { NAVIGATION } from "../components/layout/navigation.js";
import { SearchPanel } from "../features/search/SearchPanel.js";
import { ImportPanel } from "../features/imports/ImportPanel.js";
import { LoginPanel } from "../features/auth/LoginPanel.js";
import { SetsPage } from "../pages/catalog/SetsPage.js";
import { SetDetailPage } from "../pages/catalog/SetDetailPage.js";
import { CardDetailPage } from "../pages/catalog/CardDetailPage.js";
import { SearchPage } from "../pages/search/SearchPage.js";
import { CollectionPage } from "../pages/collection/CollectionPage.js";
import { BulkAddPage } from "../pages/bulk-add/BulkAddPage.js";

const SET_DETAIL_PATH = /^\/catalog\/([^/]+)$/;
const CARD_DETAIL_PATH = /^\/cards\/([^/]+)$/;

interface RouteViewProps {
  path: string;
  session: AppSession;
  isAdmin: boolean;
  onNavigate: (path: string) => void;
}

export function normalizePath(path: string) {
  if (!path || path === "/") return "/";
  return `/${path.split("?")[0].split("#")[0].split("/").filter(Boolean).join("/")}`;
}

/**
 * Decodes a path segment, returning `null` for malformed percent-escapes
 * (e.g. `/cards/%`) instead of letting `decodeURIComponent` throw during
 * render.
 */
function safeDecodeSegment(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

const unavailableCopy: Record<string, string> = {
  "/binders": "Binders",
  "/master-sets": "Master Sets",
  "/trade-tools": "Trade Tools",
  "/convention": "Convention Mode",
  "/profile": "Profile",
  "/admin": "Admin"
};

export function RouteView({ path, session, isAdmin, onNavigate }: RouteViewProps) {
  if (session === "loading") {
    return <StatePanel kind="loading" title="Loading PokéTracker" message="Checking your session and preparing the catalog." />;
  }

  const signedIn = session !== null;

  const setDetailMatch = SET_DETAIL_PATH.exec(path);
  if (setDetailMatch) {
    const setId = safeDecodeSegment(setDetailMatch[1]);
    if (setId === null) {
      return <InvalidPathPanel onNavigate={onNavigate} />;
    }
    return (
      <SetDetailPage setId={setId} onSelectCard={(cardId) => onNavigate(`/cards/${encodeURIComponent(cardId)}`)} />
    );
  }

  const cardDetailMatch = CARD_DETAIL_PATH.exec(path);
  if (cardDetailMatch) {
    const cardId = safeDecodeSegment(cardDetailMatch[1]);
    if (cardId === null) {
      return <InvalidPathPanel onNavigate={onNavigate} />;
    }
    return (
      <CardDetailPage cardId={cardId} onSelectSet={(setId) => onNavigate(`/catalog/${encodeURIComponent(setId)}`)} />
    );
  }

  const route = NAVIGATION.find((item) => item.path === path);

  if (!route || (route.auth === "admin" && !isAdmin)) {
    return (
      <StatePanel
        kind="not-found"
        title="Page not found"
        message="That page does not exist or is not available to this account."
        action={{ label: "Back to catalog", onClick: () => onNavigate("/") }}
      />
    );
  }

  if (route.auth === "signed-in" && !signedIn) {
    return (
      <StatePanel
        title="Sign in required"
        message="Sign in to view and change your personal collection."
        action={{ label: "Browse the catalog", onClick: () => onNavigate("/") }}
      />
    );
  }

  if (path === "/") {
    return (
      <>
        <section className="page-heading">
          <p className="eyebrow">Search / Catalog</p>
          <h1>Find your next card</h1>
          <p>Search by name, set, or collector number, then add cards straight to your collection.</p>
        </section>
        {signedIn ? (
          <SearchPanel />
        ) : (
          <>
            <StatePanel
              title="Sign in to search and collect"
              message="Catalog search and quick add are only available to signed-in collectors. Sign in below to get started."
            />
            <LoginPanel />
          </>
        )}
      </>
    );
  }

  if (path === "/catalog") {
    return <SetsPage onSelectSet={(setId) => onNavigate(`/catalog/${encodeURIComponent(setId)}`)} />;
  }

  if (path === "/search") {
    return <SearchPage onSelectCard={(cardId) => onNavigate(`/cards/${encodeURIComponent(cardId)}`)} />;
  }

  if (path === "/collection") {
    return <CollectionPage />;
  }

  if (path === "/bulk-add") {
    // route.auth === "signed-in" already returned above when !signedIn, so
    // session is a real Session here; the null branch is defensive only.
    return <BulkAddPage userId={session !== null ? session.user.id : ""} />;
  }

  if (path === "/imports-exports") {
    return (
      <>
        <section className="page-heading">
          <p className="eyebrow">Imports / Exports</p>
          <h1>Move your collection in and out</h1>
        </section>
        <ImportPanel />
        <StatePanel
          kind="unavailable"
          title="Export is not available yet"
          message="Exporting your collection to CSV or XLSX is planned for V3, but it has not been implemented."
        />
      </>
    );
  }

  const title = unavailableCopy[path];
  return (
    <>
      <section className="page-heading">
        <p className="eyebrow">PokéTracker</p>
        <h1>{title}</h1>
      </section>
      <StatePanel
        kind="unavailable"
        title={`${title} is not available yet`}
        message="This workflow is planned for V3, but it has not been implemented. No changes can be made from this screen."
      />
    </>
  );
}

/** Not-found panel for a URL segment that could not be decoded (e.g. a malformed `%` escape). */
function InvalidPathPanel({ onNavigate }: { onNavigate: (path: string) => void }) {
  return (
    <StatePanel
      kind="not-found"
      title="Page not found"
      message="That link is not valid."
      action={{ label: "Back to catalog", onClick: () => onNavigate("/") }}
    />
  );
}

