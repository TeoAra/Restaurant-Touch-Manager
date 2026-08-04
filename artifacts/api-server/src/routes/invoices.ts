import { Router } from "express";
import { db, invoicesTable, customersTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { buildInvoiceXml, emitInvoice, invoiceFileName, createInvoiceRecord } from "../lib/invoice-service.js";
import { getSettings } from "../lib/settings.js";

const router = Router();

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
  return res.json(inv);
});

router.get("/:id/xml", async (req, res) => {
  const id = Number(req.params.id);
  const [inv] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, id));
  if (!inv) return res.status(404).json({ error: "Fattura non trovata" });

  let xml = inv.xmlContent;
  if (!xml) {
    xml = await buildInvoiceXml(inv);
    await db.update(invoicesTable).set({ xmlContent: xml, stato: "emessa" }).where(eq(invoicesTable.id, id));
  }

  const fileName = invoiceFileName(inv, (await getSettings())["partita_iva"]);
  res.setHeader("Content-Type", "application/xml");
  res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
  return res.send(xml);
});

router.post("/", async (req, res) => {
  const body = req.body;
  const anno = body.anno ?? new Date().getFullYear();
  // Mantiene il comportamento storico della route standalone: numero manuale
  // già usato → 409 (il chiamante decide come riprovare).
  if (body.numero) {
    const numero = Number(body.numero);
    const existing = await db.execute(
      sql`SELECT id FROM invoices WHERE anno = ${anno} AND numero = ${numero} LIMIT 1`
    );
    if ((existing.rows as unknown[]).length > 0) {
      return res.status(409).json({ error: `Numero ${numero}/${anno} già utilizzato` });
    }
  }
  const { invoice } = await createInvoiceRecord(db, { ...body, anno });
  return res.status(201).json(invoice);
});

router.patch("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const body = req.body;
  const updateData: Record<string, unknown> = { ...body };
  if (body.righe && typeof body.righe !== "string") updateData.righe = JSON.stringify(body.righe);
  const [inv] = await db.update(invoicesTable).set(updateData as never).where(eq(invoicesTable.id, id)).returning();
  if (!inv) return res.status(404).json({ error: "Fattura non trovata" });
  return res.json(inv);
});

router.post("/:id/emit", async (req, res) => {
  const id = Number(req.params.id);
  const [inv] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, id));
  if (!inv) return res.status(404).json({ error: "Fattura non trovata" });

  const { invoice: updated, xml, rtOk, rtError, fileName } = await emitInvoice(inv);

  return res.json({ ...updated, xml, rtOk, rtError, fileName });
});

router.delete("/:id", async (req, res) => {
  const id = Number(req.params.id);
  await db.delete(invoicesTable).where(eq(invoicesTable.id, id));
  res.status(204).end();
});

export default router;
