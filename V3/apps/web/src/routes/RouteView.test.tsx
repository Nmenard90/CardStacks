import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Session } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiGet } from "../lib/api.js";

vi.mock("../lib/api.js", () => ({
  apiGet: vi.fn(),
  apiSend: vi.fn(),
  apiUpload: vi.fn()
}));

const mockedApiGet = vi.mocked(apiGet);

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

async function render(element: React.ReactNode) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root?.render(element));
  return container;
}

afterEach(async () => {
  await act(async () => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
  mockedApiGet.mockReset();
});

describe("route-level states", () => {
  it("renders the session loading state", async () => {
    const { App } = await import("../App.js");
    const view = await render(<App session="loading" initialPath="/" />);
    expect(view.textContent).toContain("Loading PokéTracker");
    expect(view.querySelector(".state-panel--loading")?.getAttribute("role")).toBe("status");
  });

  it("renders the collection loading state, then the empty state, through the real route", async () => {
    const { App } = await import("../App.js");
    let resolveCollection: (result: unknown) => void = () => {};
    mockedApiGet.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveCollection = resolve;
        })
    );

    const view = await render(<App session={makeSession()} initialPath="/collection" isAdmin={false} />);

    expect(view.textContent).toContain("Loading your collection");
    expect(view.querySelector(".state-panel--loading")?.getAttribute("role")).toBe("status");

    await act(async () => resolveCollection({ items: [], pageInfo: { page: 1, limit: 24, total: 0, totalPages: 0 } }));

    expect(view.textContent).toContain("No cards match these filters");
  });

  it("renders the collection error state as an alert-colored panel", async () => {
    const { App } = await import("../App.js");
    mockedApiGet.mockRejectedValueOnce(new Error("Backend unavailable"));

    const view = await render(<App session={makeSession()} initialPath="/collection" isAdmin={false} />);
    await act(async () => {});

    expect(view.textContent).toContain("Backend unavailable");
    expect(view.querySelector(".state-panel--error")?.getAttribute("role")).toBe("alert");
  });

  it("renders the bulk-add page through the real route instead of the unavailable placeholder", async () => {
    const { App } = await import("../App.js");

    const view = await render(<App session={makeSession()} initialPath="/bulk-add" isAdmin={false} />);
    await act(async () => {});

    expect(view.textContent).toContain("Add many cards quickly");
    expect(view.textContent).toContain("No staged rows yet");
    expect(view.textContent).not.toContain("is not available yet");
  });

  it.each([
    ["a malformed card id escape", "/cards/%"],
    ["a malformed set id escape", "/catalog/%"]
  ])("renders not-found instead of throwing for %s", async (_label, path) => {
    const { App } = await import("../App.js");
    const view = await render(<App session={makeSession()} initialPath={path} isAdmin={false} />);

    expect(view.textContent).toContain("Page not found");
    expect(mockedApiGet).not.toHaveBeenCalled();
  });

  it("renders real collection items returned by the API", async () => {
    const { App } = await import("../App.js");
    mockedApiGet.mockResolvedValueOnce({
      items: [
        {
          id: "item-1",
          condition: "NEAR_MINT",
          quantity: 2,
          storageLocation: "default",
          notes: null,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
          card: { id: "card-1", name: "Charizard", number: "004", set: { id: "base1", name: "Base Set" } },
          variant: { id: "variant-1", variantKey: "HOLOFOIL", displayName: "Holofoil", language: "EN" }
        }
      ],
      pageInfo: { page: 1, limit: 24, total: 1, totalPages: 1 }
    });

    const view = await render(<App session={makeSession()} initialPath="/collection" isAdmin={false} />);
    await act(async () => {});

    expect(view.textContent).toContain("Charizard");
    expect(view.textContent).toContain("Base Set #004");
    expect(view.textContent).toContain("Qty 2");
  });
});
