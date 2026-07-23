import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Session } from "@supabase/supabase-js";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "./App.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function makeSession(): Session {
  return {
    access_token: "test-token",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: 4102444800,
    refresh_token: "test-refresh",
    user: {
      id: "test-user",
      aud: "authenticated",
      role: "authenticated",
      email: "collector@example.test",
      app_metadata: {},
      user_metadata: {},
      created_at: "2026-01-01T00:00:00.000Z"
    }
  };
}

let root: Root | undefined;
let container: HTMLDivElement | undefined;

async function renderApp(session: Session | null | "loading", initialPath = "/", isAdmin = false) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root?.render(<App session={session} initialPath={initialPath} isAdmin={isAdmin} />));
  return container;
}

function linkLabels(element: ParentNode) {
  return [...element.querySelectorAll("nav a")].map((link) => link.textContent);
}

afterEach(async () => {
  await act(async () => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
});

describe("application shell", () => {
  it("shows only public navigation to guests", async () => {
    const view = await renderApp(null);
    expect(linkLabels(view.querySelector(".sidebar")!)).toEqual(["Search / Catalog"]);
    expect(view.textContent).not.toContain("Quick Add");
    expect(view.textContent).not.toContain("Remove");
    expect(view.textContent).not.toContain("Upload and Import");
  });

  it("shows collector navigation to signed-in users but hides Admin", async () => {
    const view = await renderApp(makeSession());
    const labels = linkLabels(view.querySelector(".sidebar")!);
    expect(labels).toContain("Collection");
    expect(labels).toContain("Imports / Exports");
    expect(labels).toContain("Profile");
    expect(labels).not.toContain("Admin");
  });

  it("shows Admin navigation only to admins", async () => {
    const view = await renderApp(makeSession(), "/", true);
    expect(linkLabels(view.querySelector(".sidebar")!)).toContain("Admin");
  });

  it("opens, closes, and navigates from the mobile menu", async () => {
    const view = await renderApp(makeSession());
    const menuButton = view.querySelector<HTMLButtonElement>(".menu-button")!;

    await act(async () => menuButton.click());
    expect(menuButton.getAttribute("aria-expanded")).toBe("true");
    const mobileNav = view.querySelector(".mobile-navigation")!;
    const collectionLink = [...mobileNav.querySelectorAll("a")].find((link) => link.textContent === "Collection")!;

    await act(async () => collectionLink.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })));
    expect(view.querySelector(".mobile-navigation")).toBeNull();
    expect(view.textContent).toContain("Your collection is empty");

    await act(async () => menuButton.click());
    await act(async () => menuButton.click());
    expect(menuButton.getAttribute("aria-expanded")).toBe("false");
  });

  it.each([
    ["guest", null],
    ["signed-in user", makeSession()]
  ])("renders not-found for an unknown route as a %s", async (_label, session) => {
    const view = await renderApp(session, "/definitely-unknown");
    expect(view.textContent).toContain("Page not found");
  });
});
