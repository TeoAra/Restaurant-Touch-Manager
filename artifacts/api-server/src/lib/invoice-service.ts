import { db, invoicesTable, customersTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { generateFatturaPAXml } from "./fatturaPA.js";
import { emettiFatturaCortesia, getFiscalPrinter } from "./fiscal-printer.js";
import { getSettings } from "./settings.js";

// Tipo minimo per la transazione drizzle (db o tx condividono l'API usata qui)
type DbLike = Pick<typeof db, "insert" | "select" | "execute" | "update">;

export type InvoiceRiga = {
  descrizione: string;
  quantita: string | number;
  prezzoUnitario: string;
  importo?: string;
  aliquotaIva?: string;
  imponibile?: string;
};

export type CreateInvoiceInput = {
  customerId: number;
  orderId?: number;
  numero?: number;
  anno?: number;
  data?: string;
  tipoDocumento?: string;
  imponibile?: string;
  aliquotaIva?: string;
  iva?: string;
  totale?: string;
  righe?: InvoiceRiga[];
  note?: string;
};

export async function getNextInvoiceNumber(dbx: DbLike, anno: number): Promise<number> {
  const rows = await dbx.execute(
    sql`SELECT COALESCE(MAX(numero), 0) + 1 AS next FROM invoices WHERE anno = ${anno}`
  );
  return Number((rows.rows[0] as { next: number }).next);
}

/**
 * Inserisce la riga fattura (stato "bozza") DENTRO la transazione passata.
 * Se il numero manuale richiesto è già usato, ricade sulla numerazione
 * automatica invece di fallire: la priorità è NON perdere la fattura.
 */
export async function createInvoiceRecord(tx: DbLike, input: CreateInvoiceInput) {
  const anno = input.anno ?? new Date().getFullYear();
  let numero: number;
  let numeroFallback = false;
  if (input.numero) {
    numero = Number(input.numero);
    const existing = await tx.execute(
      sql`SELECT id FROM invoices WHERE anno = ${anno} AND numero = ${numero} LIMIT 1`
    );
    if ((existing.rows as unknown[]).length > 0) {
      numero = await getNextInvoiceNumber(tx, anno);
      numeroFallback = true;
    }
  } else {
    numero = await getNextInvoiceNumber(tx, anno);
  }

  const data = input.data ?? new Date().toISOString().slice(0, 10);
  const [inv] = await tx.insert(invoicesTable).values({
    numero,
    anno,
    data,
    customerId: input.customerId,
    orderId: input.orderId,
    tipoDocumento: input.tipoDocumento ?? "TD01",
    imponibile: input.imponibile ?? "0",
    aliquotaIva: input.aliquotaIva ?? "22",
    iva: input.iva ?? "0",
    totale: input.totale ?? "0",
    righe: JSON.stringify(input.righe ?? []),
    stato: "bozza",
    note: input.note,
  }).returning();

  return { invoice: inv, numeroFallback };
}

export async function buildInvoiceXml(inv: typeof invoicesTable.$inferSelect): Promise<string> {
  const settings = await getSettings();
  let customer = null;
  if (inv.customerId) {
    const [c] = await db.select().from(customersTable).where(eq(customersTable.id, inv.customerId));
    customer = c ?? null;
  }

  let righe: Array<{ descrizione: string; quantita: string; prezzoUnitario: string; importo: string; aliquotaIva: string }> = [];
  try { righe = JSON.parse(inv.righe); } catch { righe = []; }

  if (righe.length === 0) {
    const aliq = inv.aliquotaIva ?? "22";
    const base = parseFloat(inv.imponibile ?? "0");
    righe = [{
      descrizione: "Servizi ristorazione",
      quantita: "1.00",
      prezzoUnitario: base.toFixed(2),
      importo: base.toFixed(2),
      aliquotaIva: aliq,
    }];
  }

  return generateFatturaPAXml({
    cedente: {
      denominazione: settings["ragione_sociale"] ?? "Ristorante",
      partitaIva: settings["partita_iva"] ?? "00000000000",
      codiceFiscale: settings["codice_fiscale"],
      indirizzo: settings["indirizzo"] ?? "Via Roma 1",
      cap: settings["cap"] ?? "00000",
      comune: settings["comune"] ?? "Roma",
      provincia: settings["provincia"],
      nazione: "IT",
      regimeFiscale: settings["regime_fiscale"] ?? "RF01",
    },
    cessionario: {
      tipo: customer?.tipo ?? "privato",
      ragioneSociale: customer?.ragioneSociale ?? "CLIENTE GENERICO",
      nome: customer?.nome ?? undefined,
      cognome: customer?.cognome ?? undefined,
      codiceFiscale: customer?.codiceFiscale ?? undefined,
      partitaIva: customer?.partitaIva ?? undefined,
      codiceDestinatario: customer?.codiceDestinatario ?? "0000000",
      pec: customer?.pec ?? undefined,
      indirizzo: customer?.indirizzo ?? undefined,
      cap: customer?.cap ?? undefined,
      comune: customer?.comune ?? undefined,
      provincia: customer?.provincia ?? undefined,
      nazione: customer?.nazione ?? "IT",
    },
    documento: {
      numero: `${inv.anno}/${String(inv.numero).padStart(4, "0")}`,
      data: inv.data,
      tipoDocumento: inv.tipoDocumento,
      aliquotaIva: inv.aliquotaIva,
      imponibile: inv.imponibile,
      iva: inv.iva,
      totale: inv.totale,
      righe,
      note: inv.note ?? undefined,
    },
  });
}

export function invoiceFileName(inv: { anno: number; numero: number }, partitaIva?: string): string {
  return `IT${partitaIva ?? "00000000000"}_${String(inv.anno).slice(-2)}${String(inv.numero).padStart(5, "0")}_001.xml`;
}

export type EmitResult = {
  invoice: typeof invoicesTable.$inferSelect;
  xml: string;
  fileName: string;
  rtOk: boolean;
  rtError?: string;
};

/**
 * Emette una fattura già inserita: genera l'XML, marca "emessa" e stampa la
 * copia di cortesia sulla RT (best-effort, mai bloccante).
 */
export async function emitInvoice(inv: typeof invoicesTable.$inferSelect): Promise<EmitResult> {
  const xml = await buildInvoiceXml(inv);
  const settings = await getSettings();

  const [updated] = await db.update(invoicesTable)
    .set({ xmlContent: xml, stato: "emessa" })
    .where(eq(invoicesTable.id, inv.id))
    .returning();

  // ── Stampa gestionale RT (best-effort, non blocca la risposta) ────────────
  let rtOk = false;
  let rtError: string | undefined;
  try {
    const printer = await getFiscalPrinter();
    if (printer) {
      let customer = null;
      if (inv.customerId) {
        const [c] = await db.select().from(customersTable).where(eq(customersTable.id, inv.customerId));
        customer = c ?? null;
      }
      let righe: Array<{ descrizione: string; quantita: string; prezzoUnitario: string }> = [];
      try { righe = JSON.parse(inv.righe ?? "[]"); } catch { righe = []; }
      if (righe.length === 0) {
        righe = [{ descrizione: "Servizi ristorazione", quantita: "1", prezzoUnitario: inv.imponibile ?? "0" }];
      }
      // Denominazione cliente: ragione sociale (azienda) oppure nome+cognome (privato)
      const denominazione = customer?.ragioneSociale
        ?? ([customer?.nome, customer?.cognome].filter(Boolean).join(" ") || undefined);
      const rt = await emettiFatturaCortesia({
        numero: `${inv.anno}/${String(inv.numero).padStart(4, "0")}`,
        data: inv.data,
        cliente: customer ? {
          denominazione,
          partitaIva: customer.partitaIva,
          codiceFiscale: customer.codiceFiscale,
          indirizzo: customer.indirizzo,
          cap: customer.cap,
          comune: customer.comune,
          provincia: customer.provincia,
        } : null,
        righe: righe.map(r => ({
          desc: r.descrizione,
          qta: parseFloat(String(r.quantita)) || 1,
          prezzoUnitario: r.prezzoUnitario,
        })),
        imponibile: inv.imponibile,
        aliquotaIva: inv.aliquotaIva,
        iva: inv.iva,
        totale: inv.totale ?? "0",
        printer,
      });
      rtOk = rt.ok;
      rtError = rt.error;
    }
  } catch (e) {
    rtError = e instanceof Error ? e.message : String(e);
  }

  const fileName = invoiceFileName(inv, settings["partita_iva"]);
  return { invoice: updated ?? inv, xml, fileName, rtOk, rtError };
}
