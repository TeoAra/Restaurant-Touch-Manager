import { pgTable, text, serial, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const printersTable = pgTable("printers", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  ip: text("ip").notNull(),
  port: integer("port").notNull().default(9100),
  model: text("model"),
  departmentId: integer("department_id"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertPrinterSchema = createInsertSchema(printersTable).omit({ id: true, createdAt: true });
export type InsertPrinter = z.infer<typeof insertPrinterSchema>;
export type Printer = typeof printersTable.$inferSelect;
