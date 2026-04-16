import { pgTable, text, serial, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const promotionsTable = pgTable("promotions", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  type: text("type").notNull().default("discount_percent"),
  value: text("value").notNull().default("0"),
  minAmount: text("min_amount").notNull().default("0"),
  startDate: text("start_date"),
  endDate: text("end_date"),
  daysOfWeek: text("days_of_week"),
  startTime: text("start_time"),
  endTime: text("end_time"),
  categoryIds: text("category_ids"),
  productIds: text("product_ids"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertPromotionSchema = createInsertSchema(promotionsTable).omit({ id: true, createdAt: true });
export type InsertPromotion = z.infer<typeof insertPromotionSchema>;
export type Promotion = typeof promotionsTable.$inferSelect;
