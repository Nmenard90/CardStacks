import { useEffect, useState } from "react";
import type { AppSession } from "../App.js";
import { Card } from "../components/ui/Card.js";
import { StatePanel } from "../components/ui/StatePanel.js";
import { NAVIGATION } from "../components/layout/navigation.js";
import { apiGet } from "../lib/api.js";
import { SearchPanel } from "../features/search/SearchPanel.js";
import { ImportPanel } from "../features/imports/ImportPanel.js";
import { LoginPanel } from "../features/auth/LoginPanel.js";
import { SetsPage } from "../pages/catalog/SetsPage.js";
import { SetDetailPage } from "../pages/catalog/SetDetailPage.js";
import { CardDetailPage } from "../pages/catalog/CardDetailPage.js";
import { SearchPage } from "../pages/search/SearchPage.js";

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

const unavailableCopy: Record<string, string> = {
  "/bulk-add": "Bulk Add",
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
    return (
      <SetDetailPage
        setId={decodeURIComponent(setDetailMatch[1])}
        onSelectCard={(cardId) => onNavigate(`/cards/${encodeURIComponent(cardId)}`)}
      />
    );
  }

  const cardDetailMatch = CARD_DETAIL_PATH.exec(path);
  if (cardDetailMatch) {
    return (
      <CardDetailPage
        cardId={decodeURIComponent(cardDetailMatch[1])}
        onSelectSet={(setId) => onNavigate(`/catalog/${encodeURIComponent(setId)}`)}
      />
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
    return (
      <>
        <section className="page-heading">
          <p className="eyebrow">Collection</p>
          <h1>Your cards</h1>
          <p>Track the cards and variants you own.</p>
        </section>
        <CollectionRoute />
      </>
    );
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

interface CollectionItemSummary {
  id: string;
  condition: string;
  quantity: number;
  card: { name: string; number: string; imageSmall?: string; set: { name: string } };
  variant: { displayName: string };
}

type CollectionState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "loaded"; items: CollectionItemSummary[] };

/**
 * Loads the signed-in user's collection through the existing generic API
 * client and renders real loading/error/empty/data states. Kept local to the
 * route (rather than mounting the legacy CollectionPanel) so these states are
 * genuinely reachable through normal routing instead of hard-coded page copy.
 */
function CollectionRoute() {
  const [state, setState] = useState<CollectionState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    setState({ status: "loading" });

    apiGet<CollectionItemSummary[]>("/api/v1/collection")
      .then((items) => {
        if (active) setState({ status: "loaded", items });
      })
      .catch((error: unknown) => {
        if (active) {
          setState({
            status: "error",
            message: error instanceof Error ? error.message : "Could not load your collection."
          });
        }
      });

    return () => {
      active = false;
    };
  }, [attempt]);

  if (state.status === "loading") {
    return <StatePanel kind="loading" title="Loading your collection" message="Fetching the cards you own." />;
  }

  if (state.status === "error") {
    return (
      <StatePanel
        kind="error"
        title="Could not load your collection"
        message={state.message}
        action={{ label: "Try again", onClick: () => setAttempt((value) => value + 1) }}
      />
    );
  }

  if (state.items.length === 0) {
    return (
      <StatePanel
        kind="empty"
        title="Your collection is empty"
        message="Use catalog search or Bulk Add to add your first card."
      />
    );
  }

  return (
    <div className="grid">
      {state.items.map((item) => (
        <Card
          key={item.id}
          title={item.card.name}
          subtitle={`${item.card.set.name} #${item.card.number}`}
          imageUrl={item.card.imageSmall}
          imageAlt={item.card.name}
        >
          <p>
            {item.variant.displayName} · {item.condition} · Qty {item.quantity}
          </p>
        </Card>
      ))}
    </div>
  );
}
