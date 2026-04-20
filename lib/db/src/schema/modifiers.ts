import { pgTable, text, serial } from "drizzle-orm/pg-core";

export const modifiersTable = pgTable("modifiers", {
  id: serial("id").primaryKey(),
  label: text("label").notNull(),
  type: text("type").notNull().default("note"),
  priceExtra: text("price_extra").notNull().default("0.00"),
});

export type Modifier = typeof modifiersTable.$inferSelect;
export type InsertModifier = typeof modifiersTable.$inferInsert;
