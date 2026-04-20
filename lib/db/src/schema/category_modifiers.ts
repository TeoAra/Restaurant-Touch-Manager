import { pgTable, integer, primaryKey } from "drizzle-orm/pg-core";

export const categoryModifiersTable = pgTable("category_modifiers", {
  categoryId: integer("category_id").notNull(),
  modifierId: integer("modifier_id").notNull(),
}, t => [primaryKey({ columns: [t.categoryId, t.modifierId] })]);

export type CategoryModifier = typeof categoryModifiersTable.$inferSelect;
