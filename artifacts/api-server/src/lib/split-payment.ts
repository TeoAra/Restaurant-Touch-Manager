export type SplitPayableItem = {
  id: number;
  quantity: number;
  unitPrice: string;
};

export type SplitSettlementLine = {
  id: number;
  originalQuantity: number;
  quantity: number;
  unitPrice: string;
};

export type SplitSelection = {
  lines: SplitSettlementLine[];
  selectedCents: number;
  remainingCents: number;
};

function toCents(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error("Prezzo articolo non valido");
  return Math.round(parsed * 100);
}

/**
 * Resolve the exact quantities of a split payment. A client can select one
 * unit from a row with quantity > 1; that must never turn into a full-row
 * fiscal receipt or deletion.
 */
export function resolveSplitSelection(
  items: SplitPayableItem[],
  itemIds: number[],
  requestedQuantities: Record<number, number>,
): SplitSelection {
  const selectedIds = new Set(itemIds);
  if (selectedIds.size !== itemIds.length) throw new Error("Un articolo è stato selezionato più di una volta");

  const itemById = new Map(items.map(item => [item.id, item]));
  const lines = itemIds.map((id) => {
    const item = itemById.get(id);
    if (!item) throw new Error("Un articolo del conto non è più disponibile");
    const quantity = requestedQuantities[id] ?? item.quantity;
    if (!Number.isInteger(quantity) || quantity <= 0 || quantity > item.quantity) {
      throw new Error("La quantità selezionata non è più disponibile");
    }
    return { id, originalQuantity: item.quantity, quantity, unitPrice: item.unitPrice };
  });

  const selectedById = new Map(lines.map(line => [line.id, line.quantity]));
  const selectedCents = lines.reduce((total, line) => total + toCents(line.unitPrice) * line.quantity, 0);
  const remainingCents = items.reduce((total, item) => {
    const remainingQuantity = item.quantity - (selectedById.get(item.id) ?? 0);
    return total + toCents(item.unitPrice) * remainingQuantity;
  }, 0);

  return { lines, selectedCents, remainingCents };
}