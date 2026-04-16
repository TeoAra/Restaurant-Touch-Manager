import { pgTable, text, serial, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const tablesTable = pgTable("tables", {
  id: serial("id").primaryKey(),
  number: integer("number").notNull(),
  name: text("name").notNull(),
  seats: integer("seats").notNull().default(4),
  status: text("status").notNull().default("free"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertTableSchema = createInsertSchema(tablesTable).omit({ id: true, createdAt: true });
export type InsertTable = z.infer<typeof insertTableSchema>;
export type Table = typeof tablesTable.$inferSelect;
