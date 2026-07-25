import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AddCardPanel } from "./AddCardPanel.js";
import { searchCards } from "../search/searchApi.js";
import { apiGet } from "../../lib/api.js";
import { addToCollection } from "./collectionApi.js";

vi.mock("../search/searchApi.js", () => ({
  searchCards: vi.fn()
}));

vi.mock("../../lib/api.js", () => ({
  apiGet: vi.fn(),
  apiSend: vi.fn(),
  apiUpload: vi.fn()
}));

vi.mock("./collectionApi.js", () => ({
  addToCollection: vi.fn()
}));

const mockedSearchCards = vi.mocked(searchCards);
const mockedApiGet = vi.mocked(apiGet);
const mockedAddToCollection = vi.mocked(addToCollection);

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

function setInput(view: HTMLElement, label: string, value: string) {
  const input = view.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

afterEach(async () => {
  await act(async () => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
  mockedSearchCards.mockReset();
  mockedApiGet.mockReset();
  mockedAddToCollection.mockReset();
});

describe("AddCardPanel", () => {
  it("stays collapsed until the user opts in", async () => {
    const view = await render(<AddCardPanel onAdded={vi.fn()} />);
    expect(view.textContent).toContain("Add a card with full details");
    expect(mockedSearchCards).not.toHaveBeenCalled();
  });

  it("searches, loads variants, and submits explicit add details", async () => {
    mockedSearchCards.mockResolvedValueOnce({
      items: [
        {
          id: "card-1",
          setId: "sv1",
          name: "Charizard",
          number: "004",
          set: { id: "sv1", name: "Scarlet & Violet", series: "SV" }
        }
      ],
      pageInfo: { page: 1, limit: 10, total: 1, totalPages: 1 },
      ambiguous: false
    });
    mockedApiGet.mockResolvedValueOnce({
      id: "card-1",
      setId: "sv1",
      name: "Charizard",
      number: "004",
      set: { id: "sv1", name: "Scarlet & Violet", series: "SV" },
      variants: [
        { id: "variant-1", displayName: "Holofoil" },
        { id: "variant-2", displayName: "Reverse Holofoil" }
      ]
    });
    mockedAddToCollection.mockResolvedValueOnce({} as never);

    const view = await render(<AddCardPanel onAdded={vi.fn()} />);

    const openButton = [...view.querySelectorAll("button")].find((button) => button.textContent === "Add a card with full details")!;
    await act(async () => openButton.click());

    await act(async () => setInput(view, "Card name", "Charizard"));
    const form = view.querySelector("form")!;
    await act(async () => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));

    const selectButton = [...view.querySelectorAll("button")].find((button) => button.textContent === "Select")!;
    await act(async () => selectButton.click());

    expect(mockedApiGet).toHaveBeenCalledWith("/api/v1/cards/card-1");
    expect(view.querySelector('[aria-label="Variant"]')).not.toBeNull();

    const detailForm = view.querySelector('[aria-label="Variant"]')!.closest("form")!;
    await act(async () => detailForm.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));

    expect(mockedAddToCollection).toHaveBeenCalledWith(
      expect.objectContaining({ cardId: "card-1", variantId: "variant-1", condition: "NEAR_MINT", quantity: 1 })
    );
    expect(view.textContent).toContain("Added Charizard to your collection.");
  });

  it("groups ambiguous number-only results by set", async () => {
    mockedSearchCards.mockResolvedValueOnce({
      items: [
        { id: "sv1-80", setId: "sv1", name: "Card A", number: "080", set: { id: "sv1", name: "Set One", series: "S" } },
        { id: "swsh1-80", setId: "swsh1", name: "Card B", number: "080", set: { id: "swsh1", name: "Set Two", series: "S" } }
      ],
      pageInfo: { page: 1, limit: 10, total: 2, totalPages: 1 },
      ambiguous: true
    });

    const view = await render(<AddCardPanel onAdded={vi.fn()} />);
    const openButton = [...view.querySelectorAll("button")].find((button) => button.textContent === "Add a card with full details")!;
    await act(async () => openButton.click());

    await act(async () => setInput(view, "Collector number", "080"));
    const form = view.querySelector("form")!;
    await act(async () => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));

    expect(view.textContent).toContain("Multiple sets share this number");
    expect(view.textContent).toContain("Set One");
    expect(view.textContent).toContain("Set Two");
  });
});
