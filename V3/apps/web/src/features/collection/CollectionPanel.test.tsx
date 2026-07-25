import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CollectionPanel } from "./CollectionPanel.js";
import { adjustCollectionQuantity, listOwnedCollection, removeCollectionItem, updateCollectionItem, type OwnedCollectionItem } from "./collectionApi.js";

vi.mock("./collectionApi.js", () => ({
  listOwnedCollection: vi.fn(),
  addToCollection: vi.fn(),
  updateCollectionItem: vi.fn(),
  adjustCollectionQuantity: vi.fn(),
  removeCollectionItem: vi.fn(),
  bulkAddToCollection: vi.fn()
}));

const mockedList = vi.mocked(listOwnedCollection);
const mockedUpdate = vi.mocked(updateCollectionItem);
const mockedAdjust = vi.mocked(adjustCollectionQuantity);
const mockedRemove = vi.mocked(removeCollectionItem);

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

function makeItem(overrides: Partial<OwnedCollectionItem> = {}): OwnedCollectionItem {
  return {
    id: "item-1",
    condition: "NEAR_MINT",
    quantity: 2,
    storageLocation: "default",
    notes: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    card: { id: "card-1", name: "Charizard", number: "004", set: { id: "sv1", name: "Scarlet & Violet" } },
    variant: { id: "variant-1", variantKey: "HOLOFOIL", displayName: "Holofoil", language: "EN" },
    ...overrides
  };
}

afterEach(async () => {
  await act(async () => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
  mockedList.mockReset();
  mockedUpdate.mockReset();
  mockedAdjust.mockReset();
  mockedRemove.mockReset();
});

describe("CollectionPanel", () => {
  it("loads and renders owned items", async () => {
    mockedList.mockResolvedValueOnce({
      items: [makeItem()],
      pageInfo: { page: 1, limit: 24, total: 1, totalPages: 1 }
    });

    const view = await render(<CollectionPanel />);
    await act(async () => {});

    expect(view.textContent).toContain("Charizard");
    expect(view.textContent).toContain("Scarlet & Violet #004");
    expect(view.textContent).toContain("Qty 2");
  });

  it("shows an error state with the backend message", async () => {
    mockedList.mockRejectedValueOnce(new Error("Backend unavailable"));

    const view = await render(<CollectionPanel />);
    await act(async () => {});

    expect(view.querySelector(".state-panel--error")).not.toBeNull();
    expect(view.textContent).toContain("Backend unavailable");
  });

  it("shows an empty state when no items match", async () => {
    mockedList.mockResolvedValueOnce({ items: [], pageInfo: { page: 1, limit: 24, total: 0, totalPages: 0 } });

    const view = await render(<CollectionPanel />);
    await act(async () => {});

    expect(view.textContent).toContain("No cards match these filters");
  });

  it("submits filter fields to the API", async () => {
    mockedList.mockResolvedValue({ items: [], pageInfo: { page: 1, limit: 24, total: 0, totalPages: 0 } });

    const view = await render(<CollectionPanel />);
    await act(async () => {});

    const setInput = view.querySelector<HTMLInputElement>('[aria-label="Filter by set id"]')!;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
    await act(async () => {
      setter.call(setInput, "sv1");
      setInput.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const form = [...view.querySelectorAll("form")][0];
    await act(async () => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));

    expect(mockedList).toHaveBeenLastCalledWith(expect.objectContaining({ setId: "sv1", page: 1 }));
  });

  it("increments quantity through the + control", async () => {
    mockedList.mockResolvedValue({ items: [makeItem({ quantity: 2 })], pageInfo: { page: 1, limit: 24, total: 1, totalPages: 1 } });
    mockedAdjust.mockResolvedValueOnce({ ...makeItem({ quantity: 3 }) });

    const view = await render(<CollectionPanel />);
    await act(async () => {});

    const incrementButton = view.querySelector<HTMLButtonElement>('[aria-label="Increase quantity for Charizard"]')!;
    await act(async () => incrementButton.click());

    expect(mockedAdjust).toHaveBeenCalledWith("item-1", 1);
    expect(mockedList).toHaveBeenCalledTimes(2);
  });

  it("decrements quantity and reports removal when it reaches zero", async () => {
    mockedList.mockResolvedValue({ items: [makeItem({ quantity: 1 })], pageInfo: { page: 1, limit: 24, total: 1, totalPages: 1 } });
    mockedAdjust.mockResolvedValueOnce({ deleted: true });

    const view = await render(<CollectionPanel />);
    await act(async () => {});

    const decrementButton = view.querySelector<HTMLButtonElement>('[aria-label="Decrease quantity for Charizard"]')!;
    await act(async () => decrementButton.click());

    expect(mockedAdjust).toHaveBeenCalledWith("item-1", -1);
    expect(view.textContent).toContain("Removed item (quantity reached zero).");
  });

  it("changes condition through the select control", async () => {
    mockedList.mockResolvedValue({ items: [makeItem()], pageInfo: { page: 1, limit: 24, total: 1, totalPages: 1 } });
    mockedUpdate.mockResolvedValueOnce(makeItem({ condition: "DAMAGED" }));

    const view = await render(<CollectionPanel />);
    await act(async () => {});

    const select = view.querySelector<HTMLSelectElement>('[aria-label="Condition for Charizard"]')!;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value")!.set!;
    setter.call(select, "DAMAGED");
    await act(async () => select.dispatchEvent(new Event("change", { bubbles: true })));

    expect(mockedUpdate).toHaveBeenCalledWith("item-1", { condition: "DAMAGED" });
  });

  it("requires a second confirmation click before removing an item (safe removal)", async () => {
    mockedList.mockResolvedValue({ items: [makeItem()], pageInfo: { page: 1, limit: 24, total: 1, totalPages: 1 } });

    const view = await render(<CollectionPanel />);
    await act(async () => {});

    const removeButton = [...view.querySelectorAll("button")].find((button) => button.textContent === "Remove")!;
    await act(async () => removeButton.click());

    expect(mockedRemove).not.toHaveBeenCalled();
    expect(view.textContent).toContain("Remove this item?");

    const cancelButton = [...view.querySelectorAll("button")].find((button) => button.textContent === "Cancel")!;
    await act(async () => cancelButton.click());

    expect(view.textContent).not.toContain("Remove this item?");
    expect(mockedRemove).not.toHaveBeenCalled();
  });

  it("removes the item after confirmation", async () => {
    mockedList.mockResolvedValue({ items: [makeItem()], pageInfo: { page: 1, limit: 24, total: 1, totalPages: 1 } });
    mockedRemove.mockResolvedValueOnce({ id: "item-1" });

    const view = await render(<CollectionPanel />);
    await act(async () => {});

    const removeButton = [...view.querySelectorAll("button")].find((button) => button.textContent === "Remove")!;
    await act(async () => removeButton.click());

    const confirmButton = [...view.querySelectorAll("button")].find((button) => button.textContent === "Confirm remove")!;
    await act(async () => confirmButton.click());

    expect(mockedRemove).toHaveBeenCalledWith("item-1");
    expect(view.textContent).toContain("Removed item.");
  });
});
