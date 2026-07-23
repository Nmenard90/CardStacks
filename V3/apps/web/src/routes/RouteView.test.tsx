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
    let resolveCollection: (items: unknown[]) => void = () => {};
    mockedApiGet.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveCollection = resolve;
        })
    );

    const view = await render(<App session={makeSession()} initialPath="/collection" isAdmin={false} />);

    expect(view.textContent).toContain("Loading your collection");
    expect(view.querySelector(".state-panel--loading")?.getAttribute("role")).toBe("status");

    await act(async () => resolveCollection([]));

    expect(view.textContent).toContain("Your collection is empty");
  });

  it("renders the collection error state as an alert-colored panel with a retry action", async () => {
    const { App } = await import("../App.js");
    mockedApiGet.mockRejectedValueOnce(new Error("Backend unavailable"));
    mockedApiGet.mockResolvedValueOnce([]);

    const view = await render(<App session={makeSession()} initialPath="/collection" isAdmin={false} />);
    await act(async () => {});

    expect(view.textContent).toContain("Backend unavailable");
    expect(view.querySelector(".state-panel--error")?.getAttribute("role")).toBe("alert");

    const retryButton = [...view.querySelectorAll("button")].find((button) => button.textContent === "Try again")!;
    await act(async () => retryButton.click());

    expect(view.textContent).toContain("Your collection is empty");
  });

  it("renders real collection items returned by the API", async () => {
    const { App } = await import("../App.js");
    mockedApiGet.mockResolvedValueOnce([
      {
        id: "item-1",
        condition: "NEAR_MINT",
        quantity: 2,
        card: { name: "Charizard", number: "004", set: { name: "Base Set" } },
        variant: { displayName: "Holofoil" }
      }
    ]);

    const view = await render(<App session={makeSession()} initialPath="/collection" isAdmin={false} />);
    await act(async () => {});

    expect(view.textContent).toContain("Charizard");
    expect(view.textContent).toContain("Base Set #004");
    expect(view.textContent).toContain("Holofoil · NEAR_MINT · Qty 2");
  });
});
