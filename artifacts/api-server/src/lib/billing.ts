/** Money boundaries shared by invoicing, covers and recorded partial payments. */
export function cents(value: unknown): number {
  if (typeof value !== "string" && typeof value !== "number") throw new Error("Importo non valido");
  const text = String(value).trim().replace(",", ".");
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) throw new Error("Importo non valido");
  const result = Math.round(Number(text) * 100);
  if (!Number.isSafeInteger(result) || result < 0 || result > 99999999) throw new Error("Importo fuori limite");
  return result;
}

export const money = (value: number): string => (value / 100).toFixed(2);

export function invoiceNumber(inv: { numero: number; anno: number; sezionale?: string | null }): string {
  // Issued legacy documents must not be renumbered by a software update.
  return inv.sezionale ? `${inv.sezionale}/${inv.numero}` : `${inv.anno}/${String(inv.numero).padStart(4, "0")}`;
}

export function transmissionId(id: number): string {
  return id.toString(36).toUpperCase().padStart(5, "0");
}

export function effectiveCoverPrice(order: { coverPrice?: string | null }, settings: Record<string, string>): number {
  return cents(order.coverPrice ?? settings.cover_price ?? "0");
}

export function orderDue(order: { total: string; covers: number; coverPrice?: string | null }, settings: Record<string, string>): number {
  return cents(order.total) + order.covers * effectiveCoverPrice(order, settings);
}

export function validateRomana(input: {
  due: number; paid: number; amount: number; close: boolean; expectedPaid?: number;
}): { paid: number; remaining: number; close: boolean } {
  if (input.expectedPaid !== undefined && input.expectedPaid !== input.paid) throw new Error("Il conto è cambiato: aggiorna le quote prima di incassare");
  if (input.amount <= 0) throw new Error("La quota deve essere maggiore di zero");
  const remaining = input.due - input.paid;
  if (input.amount > remaining) throw new Error("La quota supera il residuo del conto");
  if (input.close && input.amount !== remaining) throw new Error("Per chiudere il tavolo occorre saldare tutto il residuo");
  return { paid: input.paid + input.amount, remaining: remaining - input.amount, close: input.close && input.amount === remaining };
}

export function normalizeLottery(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || !/^[A-Z0-9]{8}$/.test(value.trim().toUpperCase())) throw new Error("Il codice lotteria deve contenere 8 lettere o numeri");
  return value.trim().toUpperCase();
}

export type InvoiceLine = { descrizione: string; quantita: string; prezzoUnitario: string; importo: string; aliquotaIva: string };

export function invoiceTotals(lines: InvoiceLine[]) {
  const rates = new Map<string, number>();
  for (const line of lines) {
    const rate = Number(line.aliquotaIva);
    if (!Number.isFinite(rate) || rate <= 0 || rate > 100) throw new Error("Aliquota IVA non supportata: indicare un'aliquota positiva");
    const key = rate.toFixed(2);
    rates.set(key, (rates.get(key) ?? 0) + cents(line.importo));
  }
  const net = [...rates.values()].reduce((sum, n) => sum + n, 0);
  const vat = [...rates].reduce((sum, [rate, base]) => sum + Math.round(base * Number(rate) / 100), 0);
  return { imponibile: money(net), iva: money(vat), totale: money(net + vat) };
}

/** POS prices include IVA: split the gross amount, never add IVA a second time. */
export function orderInvoiceLines(
  items: { productName: string; quantity: number; unitPrice: string }[],
  order: { covers: number; coverPrice?: string | null; modalita?: string },
  settings: Record<string, string>,
): InvoiceLine[] {
  const rate = Number(settings[`iva_${order.modalita ?? "tavolo"}`] ?? settings.iva_tavolo ?? "10");
  if (!Number.isFinite(rate) || rate <= 0 || rate > 100) throw new Error("Configurare l'aliquota IVA dell'ordine");
  const grossRows = items.map(i => ({ name: i.productName, quantity: i.quantity, gross: cents(i.unitPrice) * i.quantity }));
  const cover = effectiveCoverPrice(order, settings);
  if (order.covers && cover) grossRows.unshift({ name: "Coperto", quantity: order.covers, gross: cover * order.covers });
  const grossTotal = grossRows.reduce((sum, r) => sum + r.gross, 0);
  const totalNet = Math.round(grossTotal / (1 + rate / 100));
  let allocated = 0;
  return grossRows.map((r, i) => {
    const net = i === grossRows.length - 1 ? totalNet - allocated : Math.round(r.gross / (1 + rate / 100));
    allocated += net;
    return { descrizione: r.name, quantita: r.quantity.toFixed(2), prezzoUnitario: (net / 100 / r.quantity).toFixed(8), importo: money(net), aliquotaIva: rate.toFixed(2) };
  });
}
