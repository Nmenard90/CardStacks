import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SearchPanel } from "./SearchPanel.js";
import { searchCards } from "./searchApi.js";
import { apiGet, apiSend } from "../../lib/api.js";

vi.mock("./searchApi.js", () => ({
  searchCards: vi.fn()
}));

vi.mock("../../lib/api.js", () => ({
  apiGet: vi.fn(),
  apiSend: vi.fn(),
  apiUpload: vi.fn()
}));

const mockedSearchCards = vi.mocked(searchCards);
const mockedApiGet = vi.mocked(apiGet);
const mockedApiSend = vi.mocked(apiSend);

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

/**
 * Sets a controlled input's value through React's tracked native setter so
 * the component's onChange handler actually fires (a plain `input.value =`
 * assignment is silently swallowed by React's controlled-input tracking).
 */
function setInput(view: HTMLElement, label: string, value: string) {
  const input = view.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

async function submit(view: HTMLElement) {
  await act(async () => view.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
}

afterEach(async () => {
  await act(async () => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
  mockedSearchCards.mockReset();
  mockedApiGet.mockReset();
  mockedApiSend.mockReset();
});

describe("SearchPanel multi-field search", () => {
  it("sends a set-id-only query as setId, not folded into the name filter", async () => {
    mockedSearchCards.mockResolvedValueOnce({
      items: [],
      pageInfo: { page: 1, limit: 20, total: 0, totalPages: 0 },
      ambiguous: false
    });

    const view = await render(<SearchPanel />);
    await act(async () => setInput(view, "Set id", "sv1"));
    await submit(view);

    expect(mockedSearchCards).toHaveBeenCalledWith(
      expect.objectContaining({ q: "", setId: "sv1", setName: "", number: "" })
    );
  });

  it("sends a collector-number-only query as number, not name", async () => {
    mockedSearchCards.mockResolvedValueOnce({
      items: [],
      pageInfo: { page: 1, limit: 20, total: 0, totalPages: 0 },
      ambiguous: false
    });

    const view = await render(<SearchPanel />);
    await act(async () => setInput(view, "Collector number", "080"));
    await submit(view);

    expect(mockedSearchCards).toHaveBeenCalledWith(
      expect.objectContaining({ q: "", setId: "", setName: "", number: "080" })
    );
  });

  it("rejects an empty submission without calling the API", async () => {
    const view = await render(<SearchPanel />);
    await submit(view);

    expect(mockedSearchCards).not.toHaveBeenCalled();
    expect(view.textContent).toContain("Enter a card name, set id, set name, or collector number to search.");
  });

  it("quick-adds a result card using its first variant", async () => {
    mockedSearchCards.mockResolvedValueOnce({
      items: [
        {
          id: "card-1",
          setId: "sv1",
          name: "Charizard",
          number: "004",
          imageSmall: undefined,
          imageLarge: undefined,
          set: { id: "sv1", name: "Scarlet & Violet", series: "SV" }
        }
      ],
      pageInfo: { page: 1, limit: 20, total: 1, totalPages: 1 },
      ambiguous: false
    });
    mockedApiGet.mockResolvedValueOnce({
      id: "card-1",
      setId: "sv1",
      name: "Charizard",
      number: "004",
      set: { id: "sv1", name: "Scarlet & Violet", series: "SV" },
      variants: [{ id: "variant-1", displayName: "Holofoil" }]
    });
    mockedApiSend.mockResolvedValueOnce(undefined);

    const view = await render(<SearchPanel />);
    await act(async () => setInput(view, "Card name", "Charizard"));
    await submit(view);

    const quickAddButton = [...view.querySelectorAll("button")].find((button) => button.textContent === "Quick Add")!;
    await act(async () => quickAddButton.click());

    expect(mockedApiSend).toHaveBeenCalledWith(
      "/api/v1/collection/quick-add",
      "POST",
      expect.objectContaining({ cardId: "card-1", variantId: "variant-1" })
    );
    expect(view.textContent).toContain("Added Charizard.");
  });
});
