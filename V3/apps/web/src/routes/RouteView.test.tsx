import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { CardPreview, RouteStatePreview } from "./RouteView.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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
});

describe("route-level states", () => {
  it("renders the empty state", async () => {
    const view = await render(<RouteStatePreview state="empty" />);
    expect(view.textContent).toContain("Nothing here yet");
  });

  it("renders the error state as an alert-colored panel", async () => {
    const view = await render(<RouteStatePreview state="error" />);
    expect(view.textContent).toContain("Something went wrong");
    expect(view.querySelector(".state-panel--error")?.getAttribute("role")).toBe("alert");
  });

  it("renders the route loading state", async () => {
    const { App } = await import("../App.js");
    const view = await render(<App session="loading" initialPath="/" />);
    expect(view.textContent).toContain("Loading PokéTracker");
    expect(view.querySelector(".state-panel--loading")?.getAttribute("role")).toBe("status");
  });
});

describe("card image fallback", () => {
  it("replaces a failed image with an accessible fallback", async () => {
    const view = await render(<CardPreview imageUrl="https://example.test/missing.png" />);
    const image = view.querySelector<HTMLImageElement>("img")!;

    await act(async () => image.dispatchEvent(new Event("error")));

    expect(view.querySelector("img")).toBeNull();
    expect(view.querySelector('[role="img"]')?.getAttribute("aria-label")).toBe("Pikachu card");
    expect(view.textContent).toContain("Image unavailable");
  });
});
