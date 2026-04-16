import { pgTable, text, serial, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const couriersTable = pgTable("couriers", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  phone: text("phone"),
  vehicle: text("vehicle").notNull().default("moto"),
  notes: text("notes"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertCourierSchema = createInsertSchema(couriersTable).omit({ id: true, createdAt: true });
export type InsertCourier = z.infer<typeof insertCourierSchema>;
export type Courier = typeof couriersTable.$inferSelect;
