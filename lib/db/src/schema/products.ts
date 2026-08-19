import { pgTable, text, serial, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const productsTable = pgTable("products", {
  id: serial("id").primaryKey(),
  categoryId: integer("category_id"),
  departmentId: integer("department_id"),
  name: text("name").notNull(),
  description: text("description"),
  price: text("price").notNull(),
  price2: text("price2").notNull().default("0.00"),
  price3: text("price3").notNull().default("0.00"),
  price4: text("price4").notNull().default("0.00"),
  iva: text("iva").notNull().default("10"),
  sku: text("sku"),
  barcode: text("barcode"),
  // Stato operativo unico: determina se il prodotto è proposto nel Front Office.
  visibleInFrontOffice: boolean("visible_in_front_office").notNull().default(true),
  // Allergeni: testo libero (lista separata da virgole), stampato in cucina
  allergeni: text("allergeni"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertProductSchema = createInsertSchema(productsTable).omit({ id: true, createdAt: true });
export type InsertProduct = z.infer<typeof insertProductSchema>;
export type Product = typeof productsTable.$inferSelect;
