import { cents, money } from "./billing.ts";

export type BillRow = { id: number; quantity: number; unitPrice: string };
export type SelectedQuantity = { itemId: number; quantity: number };

/** Only persisted unit prices and explicitly selected quantities determine the receipt. */
export function selectedBill<T extends BillRow>(
  rows: T[],
  input: { selectedItems?: unknown; itemIds?: unknown; coversCount?: unknown; amount: unknown },
  covers: number,
  coverPriceCents: number,
) {
  const requested = input.selectedItems !== undefined ? input.selectedItems
    : Array.isArray(input.itemIds) ? input.itemIds.map(id => ({
      itemId: id, quantity: rows.find(row => row.id === id)?.quantity,
    })) : [];
  if (!Array.isArray(requested) || requested.length > 5000) throw new Error("Selezione articoli non valida");
  const seen = new Set<number>();
  const selected = requested.map(value => {
    if (!value || !Number.isInteger(value.itemId) || !Number.isInteger(value.quantity) || value.quantity <= 0) {
      throw new Error("Quantità selezionata non valida");
    }
    if (seen.has(value.itemId)) throw new Error("Articolo selezionato due volte");
    seen.add(value.itemId);
    const row = rows.find(row => row.id === value.itemId);
    if (!row || value.quantity > row.quantity) throw new Error("Il conto è cambiato: aggiorna la selezione");
    return { ...row, quantity: value.quantity };
  });
  const coversCount = input.coversCount ?? 0;
  if (typeof coversCount !== "number" || !Number.isInteger(coversCount) || coversCount < 0 || coversCount > covers) {
    throw new Error("Numero di coperti selezionati non valido");
  }
  if (selected.length === 0 && coversCount === 0) throw new Error("Seleziona almeno una voce");
  const amountCents = selected.reduce((sum, row) => sum + cents(row.unitPrice) * row.quantity, 0)
    + coversCount * coverPriceCents;
  if (amountCents <= 0 || !Number.isSafeInteger(amountCents)) throw new Error("Importo selezionato non valido");
  if (cents(input.amount) !== amountCents) {
    throw new Error("Importo diverso dalle quantità selezionate: aggiorna il conto prima di incassare");
  }
  const remaining = rows.map(row => ({
    ...row, quantity: row.quantity - (selected.find(chosen => chosen.id === row.id)?.quantity ?? 0),
  })).filter(row => row.quantity > 0);
  const remainingCovers = covers - coversCount;
  const remainingItemsCents = remaining.reduce((sum, row) => sum + cents(row.unitPrice) * row.quantity, 0);
  return {
    selected, remaining, remainingCovers, remainingItemsCents,
    amount: money(amountCents), coversCount,
    closed: remaining.length === 0 && remainingCovers === 0,
  };
}

/** Preserve kitchen state, notes, modifiers, price and insertion time on each unit. */
export function individualUnits<T extends { quantity: number; unitPrice: string; subtotal: string }>(row: T): T[] {
  if (!Number.isInteger(row.quantity) || row.quantity < 1 || row.quantity > 5000) throw new Error("Quantità non separabile");
  return Array.from({ length: row.quantity }, () => ({ ...row, quantity: 1, subtotal: money(cents(row.unitPrice)) }));
}

export function selectedFiscalDocument(
  bill: { amount: string; coversCount: number; selected: Array<{ productName: string; quantity: number; unitPrice: string }> },
  method: string, coverPriceCents: number, aliquotaIva: string,
) {
  const righe = bill.selected.map(row => ({
    desc: row.productName, qta: row.quantity, prezzoUnitario: row.unitPrice, aliquotaIva,
  }));
  if (bill.coversCount > 0) righe.unshift({
    desc: "COPERTO", qta: bill.coversCount, prezzoUnitario: money(coverPriceCents), aliquotaIva,
  });
  const fiscalCents = righe.reduce((sum, row) => sum + cents(row.prezzoUnitario) * row.qta, 0);
  if (fiscalCents !== cents(bill.amount)) throw new Error("Le righe fiscali non coincidono con l’importo selezionato");
  return { importo: bill.amount, metodoPagamento: method, righe };
}
