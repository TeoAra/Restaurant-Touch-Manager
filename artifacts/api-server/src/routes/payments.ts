import { Router } from "express";
import { db, paymentsTable, ordersTable, tablesTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { CreatePaymentBody, GetPaymentParams } from "@workspace/api-zod";

const router = Router();

router.get("/", async (req, res) => {
  const payments = await db.select().from(paymentsTable).orderBy(paymentsTable.createdAt);
  res.json(payments.reverse());
});

router.post("/", async (req, res) => {
  const body = CreatePaymentBody.parse(req.body);

  const [payment] = await db.insert(paymentsTable).values({
    orderId: body.orderId,
    method: body.method,
    amount: body.amount,
    change: body.change ?? null,
  }).returning();

  // Mark order as paid
  const [order] = await db.update(ordersTable).set({ status: "paid" }).where(eq(ordersTable.id, body.orderId)).returning();

  // Free the table if no other open orders
  if (order?.tableId) {
    const openOrders = await db.select().from(ordersTable)
      .where(and(eq(ordersTable.tableId, order.tableId), eq(ordersTable.status, "open")));
    if (openOrders.length === 0) {
      await db.update(tablesTable).set({ status: "free" }).where(eq(tablesTable.id, order.tableId));
    }
  }

  res.status(201).json(payment);
});

router.get("/:id", async (req, res) => {
  const { id } = GetPaymentParams.parse({ id: Number(req.params.id) });
  const [payment] = await db.select().from(paymentsTable).where(eq(paymentsTable.id, id));
  if (!payment) return res.status(404).json({ error: "Payment not found" });
  res.json(payment);
});

export default router;
