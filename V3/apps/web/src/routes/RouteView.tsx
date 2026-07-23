import type { AppSession } from "../App.js";
import { Card } from "../components/ui/Card.js";
import { StatePanel } from "../components/ui/StatePanel.js";
import { NAVIGATION } from "../components/layout/navigation.js";

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
  "/imports-exports": "Imports / Exports",
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
          <p>The V3 catalog will make cards easy to find by name, set, or collector number.</p>
        </section>
        <StatePanel
          kind="unavailable"
          title="Catalog search is not available yet"
          message="The V3 catalog workflow has not been connected. No search or collection changes can be made from this screen."
        />
      </>
    );
  }

  if (path === "/collection") {
    return (
      <>
        <section className="page-heading">
          <p className="eyebrow">Collection</p>
          <h1>Your cards</h1>
          <p>Track the cards and variants you own.</p>
        </section>
        <StatePanel kind="empty" title="Your collection is empty" message="Use catalog search or Bulk Add to add your first card." />
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

export function RouteStatePreview({ state }: { state: "empty" | "error" }) {
  if (state === "error") {
    return <StatePanel kind="error" title="Something went wrong" message="We could not load this page. Please try again." />;
  }
  return <StatePanel kind="empty" title="Nothing here yet" message="There are no items to show." />;
}

export function CardPreview({ imageUrl }: { imageUrl?: string }) {
  return <Card title="Pikachu" subtitle="Base Set · #58" imageUrl={imageUrl} imageAlt="Pikachu card" />;
}
