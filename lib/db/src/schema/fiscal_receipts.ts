import { pgTable, text, serial, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const fiscalReceiptsTable = pgTable("fiscal_receipts", {
  id: serial("id").primaryKey(),
  numero: integer("numero").notNull(),
  anno: integer("anno").notNull(),
  data: text("data").notNull(),
  orderId: integer("order_id"),
  importo: text("importo").notNull().default("0"),
  iva: text("iva").notNull().default("0"),
  metodoPagamento: text("metodo_pagamento").notNull().default("contanti"),
  annullato: boolean("annullato").notNull().default(false),
  annullatoAt: timestamp("annullato_at", { withTimezone: true }),
  motivoAnnullo: text("motivo_annullo"),
  printerRef: text("printer_ref"),
  printerSerial: text("printer_serial"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertFiscalReceiptSchema = createInsertSchema(fiscalReceiptsTable).omit({ id: true, createdAt: true });
export type InsertFiscalReceipt = z.infer<typeof insertFiscalReceiptSchema>;
export type FiscalReceipt = typeof fiscalReceiptsTable.$inferSelect;
