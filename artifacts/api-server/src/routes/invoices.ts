import { Router } from "express";
import { db, invoicesTable, customersTable, appSettingsTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { generateFatturaPAXml } from "../lib/fatturaPA.js";

const router = Router();

async function getSettings(): Promise<Record<string, string>> {
  const rows = await db.execute(sql`SELECT key, value FROM app_settings`);
  const map: Record<string, string> = {};
  for (const row of rows.rows as { key: string; value: string }[]) {
    map[row.key] = row.value;
  }
  return map;
}

async function getNextInvoiceNumber(anno: number): Promise<number> {
  const rows = await db.execute(
    sql`SELECT COALESCE(MAX(numero), 0) + 1 AS next FROM invoices WHERE anno = ${anno}`
  );
  return Number((rows.rows[0] as { next: number }).next);
}

router.get("/", async (req, res) => {
  const invoices = await db.select({
    id: invoicesTable.id,
    numero: invoicesTable.numero,
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
  res.json(invoices);
});

router.get("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const [inv] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, id));
  if (!inv) return res.status(404).json({ error: "Fattura non trovata" });
  res.json(inv);
});

router.get("/:id/xml", async (req, res) => {
  const id = Number(req.params.id);
  const [inv] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, id));
  if (!inv) return res.status(404).json({ error: "Fattura non trovata" });

  let xml = inv.xmlContent;
  if (!xml) {
    xml = await buildXml(inv);
    await db.update(invoicesTable).set({ xmlContent: xml, stato: "emessa" }).where(eq(invoicesTable.id, id));
  }

  const fileName = `IT${(await getSettings()).partita_iva ?? "00000000000"}_${String(inv.anno).slice(-2)}${String(inv.numero).padStart(5, "0")}_001.xml`;
  res.setHeader("Content-Type", "application/xml");
  res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
  res.send(xml);
});

router.post("/", async (req, res) => {
  const body = req.body;
  const anno = body.anno ?? new Date().getFullYear();
  let numero: number;
  if (body.numero) {
    numero = Number(body.numero);
    const existing = await db.execute(
      sql`SELECT id FROM invoices WHERE anno = ${anno} AND numero = ${numero} LIMIT 1`
    );
    if ((existing.rows as unknown[]).length > 0) {
      return res.status(409).json({ error: `Numero ${numero}/${anno} già utilizzato` });
    }
  } else {
    numero = await getNextInvoiceNumber(anno);
  }
  const data = body.data ?? new Date().toISOString().slice(0, 10);
  const righe = JSON.stringify(body.righe ?? []);

  const [inv] = await db.insert(invoicesTable).values({
    numero,
    anno,
    data,
    customerId: body.customerId,
    orderId: body.orderId,
    tipoDocumento: body.tipoDocumento ?? "TD01",
    imponibile: body.imponibile ?? "0",
    aliquotaIva: body.aliquotaIva ?? "22",
    iva: body.iva ?? "0",
    totale: body.totale ?? "0",
    righe,
    stato: "bozza",
    note: body.note,
  }).returning();

  res.status(201).json(inv);
});

router.patch("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const body = req.body;
  const updateData: Record<string, unknown> = { ...body };
  if (body.righe && typeof body.righe !== "string") updateData.righe = JSON.stringify(body.righe);
  const [inv] = await db.update(invoicesTable).set(updateData as never).where(eq(invoicesTable.id, id)).returning();
  if (!inv) return res.status(404).json({ error: "Fattura non trovata" });
  res.json(inv);
});

router.post("/:id/emit", async (req, res) => {
  const id = Number(req.params.id);
  const [inv] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, id));
  if (!inv) return res.status(404).json({ error: "Fattura non trovata" });
  const xml = await buildXml(inv);
  const [updated] = await db.update(invoicesTable)
    .set({ xmlContent: xml, stato: "emessa" })
    .where(eq(invoicesTable.id, id))
    .returning();
  res.json({ ...updated, xml });
});

router.delete("/:id", async (req, res) => {
  const id = Number(req.params.id);
  await db.delete(invoicesTable).where(eq(invoicesTable.id, id));
  res.status(204).end();
});

async function buildXml(inv: typeof invoicesTable.$inferSelect): Promise<string> {
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
    const iva = (base * parseFloat(aliq) / 100);
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

export default router;
