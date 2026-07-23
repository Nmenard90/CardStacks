import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { Card } from "./Card.js";

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

describe("Card image fallback", () => {
  it("shows the image when a URL is provided", async () => {
    const view = await render(<Card title="Pikachu" imageUrl="https://example.test/pikachu.png" imageAlt="Pikachu card" />);
    expect(view.querySelector("img")).not.toBeNull();
    expect(view.querySelector('[role="img"]')).toBeNull();
  });

  it("replaces a failed image with an accessible fallback", async () => {
    const view = await render(<Card title="Pikachu" imageUrl="https://example.test/missing.png" imageAlt="Pikachu card" />);
    const image = view.querySelector<HTMLImageElement>("img")!;

    await act(async () => image.dispatchEvent(new Event("error")));

    expect(view.querySelector("img")).toBeNull();
    expect(view.querySelector('[role="img"]')?.getAttribute("aria-label")).toBe("Pikachu card");
    expect(view.textContent).toContain("Image unavailable");
  });

  it("shows the fallback immediately when no image URL is given", async () => {
    const view = await render(<Card title="Pikachu" />);
    expect(view.querySelector('[role="img"]')).not.toBeNull();
    expect(view.textContent).toContain("Image unavailable");
  });
});
