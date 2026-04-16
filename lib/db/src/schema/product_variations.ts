import { pgTable, text, serial, integer, boolean } from "drizzle-orm/pg-core";

export const productVariationsTable = pgTable("product_variations", {
  id: serial("id").primaryKey(),
  productId: integer("product_id").notNull(),
  name: text("name").notNull(),
  options: text("options").notNull().default("[]"),
  required: boolean("required").notNull().default(false),
  sortOrder: integer("sort_order").notNull().default(0),
});

export type ProductVariation = typeof productVariationsTable.$inferSelect;
export type InsertProductVariation = typeof productVariationsTable.$inferInsert;
