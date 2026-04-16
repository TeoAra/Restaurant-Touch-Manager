import { pgTable, text, serial, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const discountsTable = pgTable("discounts", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  type: text("type").notNull().default("percent"),
  value: text("value").notNull().default("0"),
  applicableTo: text("applicable_to").notNull().default("order"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertDiscountSchema = createInsertSchema(discountsTable).omit({ id: true, createdAt: true });
export type InsertDiscount = z.infer<typeof insertDiscountSchema>;
export type Discount = typeof discountsTable.$inferSelect;
