import { pgTable, text, serial, integer, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const invoicesTable = pgTable("invoices", {
  id: serial("id").primaryKey(),
  numero: integer("numero").notNull(),
  sezionale: text("sezionale"),
  anno: integer("anno").notNull(),
  data: text("data").notNull(),
  customerId: integer("customer_id"),
  orderId: integer("order_id"),
  tipoDocumento: text("tipo_documento").notNull().default("TD01"),
  imponibile: text("imponibile").notNull().default("0"),
  aliquotaIva: text("aliquota_iva").notNull().default("22"),
  iva: text("iva").notNull().default("0"),
  totale: text("totale").notNull().default("0"),
  righe: text("righe").notNull().default("[]"),
  xmlContent: text("xml_content"),
  stato: text("stato").notNull().default("bozza"),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("invoices_year_series_number_unique").on(table.anno, table.sezionale, table.numero),
]);

export const insertInvoiceSchema = createInsertSchema(invoicesTable).omit({ id: true, createdAt: true });
export type InsertInvoice = z.infer<typeof insertInvoiceSchema>;
export type Invoice = typeof invoicesTable.$inferSelect;
