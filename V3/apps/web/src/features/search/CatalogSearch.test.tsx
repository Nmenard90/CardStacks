import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CatalogSearch } from "./CatalogSearch.js";
import { searchCards } from "./searchApi.js";

vi.mock("./searchApi.js", () => ({
  searchCards: vi.fn()
}));

const mockedSearchCards = vi.mocked(searchCards);

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
function setNativeInputValue(input: HTMLInputElement, value: string) {
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
});

function ambiguousCard(id: string, setId: string, setName: string) {
  return {
    id,
    setId,
    name: "Ambiguous Card",
    number: "080",
    imageSmall: undefined,
    imageLarge: undefined,
    set: { id: setId, name: setName, series: "Test Series" }
  };
}

describe("CatalogSearch ambiguous results pagination", () => {
  it("renders pagination controls for an ambiguous result and requests the next page", async () => {
    mockedSearchCards.mockResolvedValueOnce({
      items: [ambiguousCard("card-1", "set-a", "Set A"), ambiguousCard("card-2", "set-b", "Set B")],
      pageInfo: { page: 1, limit: 25, total: 60, totalPages: 3 },
      ambiguous: true
    });

    const view = await render(<CatalogSearch onSelectCard={vi.fn()} />);
    const numberInput = view.querySelector<HTMLInputElement>('[aria-label="Collector number"]')!;

    await act(async () => setNativeInputValue(numberInput, "080"));
    await act(async () => view.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));

    expect(view.textContent).toContain("Multiple sets share this number");
    const pagination = view.querySelector('[aria-label="Pagination"]');
    expect(pagination).not.toBeNull();
    expect(pagination!.textContent).toContain("Page 1 of 3");

    mockedSearchCards.mockResolvedValueOnce({
      items: [ambiguousCard("card-3", "set-c", "Set C")],
      pageInfo: { page: 2, limit: 25, total: 60, totalPages: 3 },
      ambiguous: true
    });

    const nextButton = [...pagination!.querySelectorAll("button")].find((button) => button.textContent === "Next")!;
    await act(async () => nextButton.click());

    expect(mockedSearchCards).toHaveBeenLastCalledWith(expect.objectContaining({ number: "080", page: 2 }));
    expect(view.textContent).toContain("Set C");
  });
});
