import { Router } from "express";
import { db, invoicesTable, customersTable, ordersTable, orderItemsTable, paymentsTable } from "@workspace/db";
import { eq, desc, and } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { generateFatturaPAXml } from "../lib/fatturaPA.js";
import { emettiFatturaCortesia, getFiscalPrinter } from "../lib/fiscal-printer.js";
import { cents, invoiceNumber, invoiceTotals, money, orderDue, orderInvoiceLines, transmissionId, type InvoiceLine } from "../lib/billing.js";

const router = Router();

async function getSettings(): Promise<Record<string, string>> {
  const rows = await db.execute(sql`SELECT key, value FROM app_settings`);
  const map: Record<string, string> = {};
  for (const row of rows.rows as { key: string; value: string }[]) {
    map[row.key] = row.value;
  }
  return map;
}

const describeInvoice = <T extends { id: number; numero: number; anno: number; sezionale?: string | null }>(inv: T) =>
  ({ ...inv, numeroDocumento: invoiceNumber(inv) });

async function xmlFilename(inv: { id: number }) {
  const settings = await getSettings();
  return `IT${settings.partita_iva}_${transmissionId(inv.id)}.xml`;
}

router.get("/", async (req, res) => {
  const invoices = await db.select({
    id: invoicesTable.id,
    numero: invoicesTable.numero,
    sezionale: invoicesTable.sezionale,
    anno: invoicesTable.anno,
    data: invoicesTable.data,
    customerId: invoicesTable.customerId,
    tipoDocumento: invoicesTable.tipoDocumento,
    totale: invoicesTable.totale,
    stato: invoicesTable.stato,
    createdAt: invoicesTable.createdAt,
    ragioneSociale: customersTable.ragioneSociale,
  })
    .from(invoicesTable)
    .leftJoin(customersTable, eq(invoicesTable.customerId, customersTable.id))
    .orderBy(desc(invoicesTable.createdAt));
  res.json(invoices.map(describeInvoice));
});

router.get("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const [inv] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, id));
  if (!inv) return res.status(404).json({ error: "Fattura non trovata" });
  return res.json(describeInvoice(inv));
});

router.get("/:id/xml", async (req, res) => {
  const id = Number(req.params.id);
  const [inv] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, id));
  if (!inv) return res.status(404).json({ error: "Fattura non trovata" });

  let xml = inv.xmlContent;
  if (!xml) {
    try { xml = await buildXml(inv); }
    catch (error) { return res.status(400).json({ error: (error as Error).message }); }
    await db.update(invoicesTable).set({ xmlContent: xml, stato: "emessa" }).where(eq(invoicesTable.id, id));
  }

  const fileName = await xmlFilename(inv);
  res.setHeader("Content-Type", "application/xml");
  res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
  return res.send(xml);
});

router.post("/", async (req, res) => {
  const body = req.body;
  try {
    const values = await invoiceValues(body);
    const [existing] = await db.select().from(invoicesTable).where(and(
      eq(invoicesTable.anno, values.anno), eq(invoicesTable.sezionale, values.sezionale), eq(invoicesTable.numero, values.numero),
    ));
    if (existing) {
      // Retrying a saved cashier draft must not allocate a different number.
      if (values.orderId && existing.orderId === values.orderId && existing.customerId === values.customerId) {
        return res.json(describeInvoice(existing));
      }
      return res.status(409).json({ error: `Fattura ${invoiceNumber(values)} già presente nell'anno ${values.anno}` });
    }
    if (values.orderId) {
      const [linked] = await db.select().from(invoicesTable).where(eq(invoicesTable.orderId, values.orderId));
      if (linked && linked.stato !== "annullata") return res.status(409).json({ error: `Questo conto ha già la fattura ${invoiceNumber(linked)}. Recuperala da Fatture.` });
    }
    const [inv] = await db.insert(invoicesTable).values(values).returning();
    return res.status(201).json(describeInvoice(inv));
  } catch (error) {
    if ((error as { code?: string }).code === "23505" || (error as { cause?: { code?: string } }).cause?.code === "23505") {
      return res.status(409).json({ error: "Sezionale e progressivo già utilizzati: scegliere un numero diverso" });
    }
    return res.status(400).json({ error: (error as Error).message });
  }
});

router.patch("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const [current] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, id));
  if (!current) return res.status(404).json({ error: "Fattura non trovata" });
  if (current.stato !== "bozza") return res.status(409).json({ error: "Una fattura emessa non può essere rinumerata o modificata" });
  try {
    const values = await invoiceValues({ ...current, ...req.body });
    const [inv] = await db.update(invoicesTable).set({ ...values, xmlContent: null }).where(eq(invoicesTable.id, id)).returning();
    return res.json(describeInvoice(inv));
  } catch (error) {
    const duplicate = (error as { cause?: { code?: string } }).cause?.code === "23505" || (error as { code?: string }).code === "23505";
    return res.status(duplicate ? 409 : 400).json({ error: duplicate ? "Sezionale e progressivo già utilizzati" : (error as Error).message });
  }
});

router.post("/:id/emit", async (req, res) => {
  const id = Number(req.params.id);
  const [inv] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, id));
  if (!inv) return res.status(404).json({ error: "Fattura non trovata" });

  let xml = inv.xmlContent;
  if (!xml) {
    try { xml = await buildXml(inv); }
    catch (error) { return res.status(400).json({ error: (error as Error).message }); }
  }
  const settings = await getSettings();

  const [updated] = await db.update(invoicesTable)
    .set({ xmlContent: xml, stato: "emessa" })
    .where(eq(invoicesTable.id, id))
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
        numero: invoiceNumber(inv),
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
          qta: parseFloat(r.quantita) || 1,
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

  const fileName = await xmlFilename(inv);

  return res.json({ ...describeInvoice(updated), xml, xmlContent: xml, rtOk, rtError, fileName });
});

router.delete("/:id", async (req, res) => {
  const id = Number(req.params.id);
  await db.delete(invoicesTable).where(eq(invoicesTable.id, id));
  res.status(204).end();
});

async function invoiceValues(body: Record<string, unknown>) {
  const sezionale = String(body.sezionale ?? "").trim();
  const numero = Number(body.numero);
  const anno = Number(body.anno ?? new Date().getFullYear());
  if (!/^[A-Za-z0-9.-]{1,10}$/.test(sezionale)) throw new Error("Indicare un sezionale valido (es. 1)");
  if (!Number.isSafeInteger(numero) || numero < 1 || numero > 999999999) throw new Error("Indicare il progressivo della fattura (es. 23)");
  if (!Number.isInteger(anno) || anno < 2000 || anno > 2100) throw new Error("Anno fattura non valido");
  const data = String(body.data ?? new Date().toISOString().slice(0, 10));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data) || Number.isNaN(Date.parse(data)) || new Date(data).toISOString().slice(0, 10) !== data) throw new Error("Data fattura non valida");
  if (Number(data.slice(0, 4)) !== anno) throw new Error("L'anno deve corrispondere alla data della fattura");
  const customerId = Number(body.customerId);
  if (!Number.isInteger(customerId) || customerId < 1) throw new Error("Selezionare un cliente");
  const [customer] = await db.select({ id: customersTable.id }).from(customersTable).where(eq(customersTable.id, customerId));
  if (!customer) throw new Error("Cliente non trovato");
  const tipoDocumento = String(body.tipoDocumento ?? "TD01");
  if (!["TD01", "TD04", "TD07"].includes(tipoDocumento)) throw new Error("Tipo documento non valido");
  const settings = await getSettings();
  const orderId = body.orderId == null ? null : Number(body.orderId);
  let lines: InvoiceLine[];
  let gross: number | undefined;
  if (orderId !== null) {
    if (!Number.isInteger(orderId) || orderId < 1) throw new Error("Ordine non valido");
    const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, orderId));
    if (!order) throw new Error("Ordine non trovato");
    const items = await db.select().from(orderItemsTable).where(eq(orderItemsTable.orderId, orderId));
    lines = orderInvoiceLines(items, order, settings);
    gross = orderDue(order, settings);
  } else {
    const rows = typeof body.righe === "string" ? JSON.parse(body.righe) : body.righe;
    if (!Array.isArray(rows) || rows.length > 500) throw new Error("Righe fattura non valide");
    lines = rows.map((row: Record<string, unknown>) => {
      const descrizione = String(row.descrizione ?? "").trim();
      const quantity = Number(row.quantita);
      const price = Number(row.prezzoUnitario);
      if (!descrizione || !Number.isFinite(quantity) || quantity <= 0 || quantity > 99999 || !Number.isFinite(price) || price < 0 || price > 999999) throw new Error("Descrizione, quantità o prezzo della riga non validi");
      return { descrizione: descrizione.slice(0, 1000), quantita: quantity.toFixed(2), prezzoUnitario: price.toFixed(8), importo: (Math.round(quantity * price * 100) / 100).toFixed(2), aliquotaIva: Number(row.aliquotaIva ?? body.aliquotaIva ?? 22).toFixed(2) };
    });
  }
  if (!lines.length) throw new Error("La fattura non contiene righe");
  const totals = invoiceTotals(lines);
  return {
    numero, sezionale, anno, data, customerId, orderId, tipoDocumento,
    ...totals, ...(gross !== undefined ? { totale: money(gross) } : {}),
    aliquotaIva: lines[0].aliquotaIva, righe: JSON.stringify(lines),
    stato: "bozza", note: body.note == null ? null : String(body.note).slice(0, 2000),
  };
}

async function buildXml(inv: typeof invoicesTable.$inferSelect): Promise<string> {
  const settings = await getSettings();
  let customer = null;
  if (inv.customerId) {
    const [c] = await db.select().from(customersTable).where(eq(customersTable.id, inv.customerId));
    customer = c ?? null;
  }
  if (inv.sezionale) {
    if (!settings.ragione_sociale || !/^\d{11}$/.test(settings.partita_iva ?? "") ||
      !settings.indirizzo || !settings.cap || !settings.comune) {
      throw new Error("Completare ragione sociale, P.IVA e indirizzo dell'azienda in Impostazioni prima di esportare XML");
    }
    if (!customer || (!customer.partitaIva && !customer.codiceFiscale) ||
      !customer.indirizzo || !customer.cap || !customer.comune) {
      throw new Error("Completare codice fiscale/P.IVA e indirizzo del cliente prima di esportare XML");
    }
  }

  let righe: Array<{ descrizione: string; quantita: string; prezzoUnitario: string; importo: string; aliquotaIva: string }> = [];
  try { righe = JSON.parse(inv.righe); } catch { righe = []; }

  if (righe.length === 0) {
    const aliq = inv.aliquotaIva ?? "22";
    const base = parseFloat(inv.imponibile ?? "0");
    const iva = (base * parseFloat(aliq) / 100);
    righe = [{
      descrizione: "Servizi ristorazione",
      quantita: "1.00",
      prezzoUnitario: base.toFixed(2),
      importo: base.toFixed(2),
      aliquotaIva: aliq,
    }];
  }

  const payments = inv.orderId ? await db.select().from(paymentsTable).where(eq(paymentsTable.orderId, inv.orderId)) : [];
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
      numero: invoiceNumber(inv),
      progressivoInvio: transmissionId(inv.id),
      data: inv.data,
      tipoDocumento: inv.tipoDocumento,
      aliquotaIva: inv.aliquotaIva,
      imponibile: inv.imponibile,
      iva: inv.iva,
      totale: inv.totale,
      righe,
      pagamenti: payments.filter(p => p.method === "cash" || p.method === "card")
        .map(p => ({ metodo: p.method as "cash" | "card", importo: p.amount })),
      note: inv.note ?? undefined,
    },
  });
}

export default router;
