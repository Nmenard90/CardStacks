import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BulkAddPanel } from "./BulkAddPanel.js";
import { loadCardVariants, lookupCardsByNumber, saveStagedRows } from "./bulkAddApi.js";

vi.mock("./bulkAddApi.js", () => ({
  lookupCardsByNumber: vi.fn(),
  loadCardVariants: vi.fn(),
  saveStagedRows: vi.fn()
}));

const mockedLookup = vi.mocked(lookupCardsByNumber);
const mockedVariants = vi.mocked(loadCardVariants);
const mockedSave = vi.mocked(saveStagedRows);

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

function makeCard(overrides: Partial<{ id: string; name: string; number: string; setId: string; setName: string }> = {}) {
  const { id = "card-1", name = "Charizard", number = "004", setId = "sv1", setName = "Scarlet & Violet" } = overrides;
  return { id, setId, name, number, set: { id: setId, name: setName, series: "SV" } };
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(async () => {
  await act(async () => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
  mockedLookup.mockReset();
  mockedVariants.mockReset();
  mockedSave.mockReset();
  window.localStorage.clear();
});

describe("BulkAddPanel", () => {
  it("stages a card after an unambiguous number lookup and clears the input for the next entry", async () => {
    mockedLookup.mockResolvedValueOnce({ ambiguous: false, matches: [makeCard()] });
    mockedVariants.mockResolvedValueOnce([{ id: "variant-1", displayName: "Holofoil" }]);

    const view = await render(<BulkAddPanel />);
    await act(async () => setInput(view, "Collector number", "004"));
    const form = view.querySelector("form")!;
    await act(async () => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));

    expect(mockedLookup).toHaveBeenCalledWith("004", undefined);
    expect(view.textContent).toContain("Charizard");
    expect(view.textContent).toContain("Scarlet & Violet");
    const numberInput = view.querySelector<HTMLInputElement>('[aria-label="Collector number"]')!;
    expect(numberInput.value).toBe("");
  });

  it("passes the set id filter through to a set-scoped lookup", async () => {
    mockedLookup.mockResolvedValueOnce({ ambiguous: false, matches: [makeCard()] });
    mockedVariants.mockResolvedValueOnce([{ id: "variant-1", displayName: "Holofoil" }]);

    const view = await render(<BulkAddPanel />);
    await act(async () => setInput(view, "Set id", "sv1"));
    await act(async () => setInput(view, "Collector number", "004"));
    const form = view.querySelector("form")!;
    await act(async () => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));

    expect(mockedLookup).toHaveBeenCalledWith("004", "sv1");
  });

  it("groups an ambiguous cross-set number lookup and stages the chosen card", async () => {
    mockedLookup.mockResolvedValueOnce({
      ambiguous: true,
      matches: [makeCard({ id: "sv1-80", number: "080", setId: "sv1", setName: "Set One" }), makeCard({ id: "swsh1-80", number: "080", setId: "swsh1", setName: "Set Two" })]
    });
    mockedVariants.mockResolvedValueOnce([{ id: "variant-2", displayName: "Reverse Holofoil" }]);

    const view = await render(<BulkAddPanel />);
    await act(async () => setInput(view, "Collector number", "080"));
    const form = view.querySelector("form")!;
    await act(async () => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));

    expect(view.textContent).toContain("Multiple cards share this number");
    expect(view.textContent).toContain("Set One");
    expect(view.textContent).toContain("Set Two");

    const selectButtons = [...view.querySelectorAll("button")].filter((button) => button.textContent === "Select");
    await act(async () => selectButtons[1].click());

    expect(mockedVariants).toHaveBeenCalledWith("swsh1-80");
    expect(view.textContent).toContain("Reverse Holofoil");
  });

  it("reports no card found instead of silently staging nothing", async () => {
    mockedLookup.mockResolvedValueOnce({ ambiguous: false, matches: [] });

    const view = await render(<BulkAddPanel />);
    await act(async () => setInput(view, "Collector number", "999"));
    const form = view.querySelector("form")!;
    await act(async () => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));

    expect(view.textContent).toContain('No card found for number "999"');
  });

  it("persists staged rows to localStorage and reloads them on remount (staged-row recovery)", async () => {
    mockedLookup.mockResolvedValueOnce({ ambiguous: false, matches: [makeCard()] });
    mockedVariants.mockResolvedValueOnce([{ id: "variant-1", displayName: "Holofoil" }]);

    const view = await render(<BulkAddPanel />);
    await act(async () => setInput(view, "Collector number", "004"));
    const form = view.querySelector("form")!;
    await act(async () => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));

    expect(view.textContent).toContain("Charizard");

    await act(async () => root?.unmount());
    const remounted = await render(<BulkAddPanel />);

    expect(remounted.textContent).toContain("Charizard");
    expect(mockedLookup).toHaveBeenCalledTimes(1);
  });

  it("keeps a failed row staged with its error and drops the successful row after a partial save failure", async () => {
    mockedLookup
      .mockResolvedValueOnce({ ambiguous: false, matches: [makeCard({ id: "card-1", name: "Charizard" })] })
      .mockResolvedValueOnce({ ambiguous: false, matches: [makeCard({ id: "card-2", name: "Pikachu", number: "025" })] });
    mockedVariants.mockResolvedValue([{ id: "variant-1", displayName: "Holofoil" }]);
    mockedSave.mockResolvedValueOnce({
      results: [
        { index: 0, ok: true, itemId: "item-1" },
        { index: 1, ok: false, error: { code: "CONFLICT", message: "Bucket already exists." } }
      ],
      savedCount: 1,
      failedCount: 1
    });

    const view = await render(<BulkAddPanel />);

    await act(async () => setInput(view, "Collector number", "004"));
    await act(async () => view.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));

    await act(async () => setInput(view, "Collector number", "025"));
    await act(async () => view.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));

    const saveButton = [...view.querySelectorAll("button")].find((button) => button.textContent?.startsWith("Save "))!;
    await act(async () => saveButton.click());

    expect(mockedSave).toHaveBeenCalledWith([
      expect.objectContaining({ cardId: "card-1" }),
      expect.objectContaining({ cardId: "card-2" })
    ]);
    expect(view.textContent).toContain("Saved 1 card");
    expect(view.textContent).toContain("1 row failed");
    expect(view.textContent).not.toContain("Charizard");
    expect(view.textContent).toContain("Pikachu");
    expect(view.textContent).toContain("Bucket already exists.");
  });

  it("leaves every staged row untouched when the whole save request fails", async () => {
    mockedLookup.mockResolvedValueOnce({ ambiguous: false, matches: [makeCard()] });
    mockedVariants.mockResolvedValueOnce([{ id: "variant-1", displayName: "Holofoil" }]);
    mockedSave.mockRejectedValueOnce(new Error("Network error"));

    const view = await render(<BulkAddPanel />);
    await act(async () => setInput(view, "Collector number", "004"));
    await act(async () => view.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));

    const saveButton = [...view.querySelectorAll("button")].find((button) => button.textContent?.startsWith("Save "))!;
    await act(async () => saveButton.click());

    expect(view.textContent).toContain("Network error");
    expect(view.textContent).toContain("Charizard");
  });

  it("removes a staged row without saving", async () => {
    mockedLookup.mockResolvedValueOnce({ ambiguous: false, matches: [makeCard()] });
    mockedVariants.mockResolvedValueOnce([{ id: "variant-1", displayName: "Holofoil" }]);

    const view = await render(<BulkAddPanel />);
    await act(async () => setInput(view, "Collector number", "004"));
    await act(async () => view.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));

    const removeButton = view.querySelector<HTMLButtonElement>('[aria-label="Remove staged row for Charizard"]')!;
    await act(async () => removeButton.click());

    expect(view.textContent).toContain("No staged rows yet");
    expect(mockedSave).not.toHaveBeenCalled();
  });
});
