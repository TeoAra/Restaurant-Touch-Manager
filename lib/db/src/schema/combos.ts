import { pgTable, text, serial, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const combosTable = pgTable("combos", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  price: text("price").notNull().default("0.00"),
  categoryId: integer("category_id"),
  available: boolean("available").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const comboItemsTable = pgTable("combo_items", {
  id: serial("id").primaryKey(),
  comboId: integer("combo_id").notNull(),
  productId: integer("product_id").notNull(),
  productName: text("product_name").notNull(),
  quantity: integer("quantity").notNull().default(1),
  priceOverride: text("price_override"),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const insertComboSchema = createInsertSchema(combosTable).omit({ id: true, createdAt: true });
export type InsertCombo = z.infer<typeof insertComboSchema>;
export type Combo = typeof combosTable.$inferSelect;
export type ComboItem = typeof comboItemsTable.$inferSelect;
