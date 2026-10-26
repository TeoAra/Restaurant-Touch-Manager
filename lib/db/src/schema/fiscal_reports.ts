import { pgTable, text, serial, integer, timestamp } from "drizzle-orm/pg-core";

export const fiscalReportsTable = pgTable("fiscal_reports", {
  id: serial("id").primaryKey(),
  type: text("type").notNull(),
  printerSerial: text("printer_serial").notNull(),
  numeroChiusura: integer("numero_chiusura").notNull(),
  status: text("status").notNull(),
  error: text("error"),
  response: text("response"),
  totalDb: text("total_db").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});
