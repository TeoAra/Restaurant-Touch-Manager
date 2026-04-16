import { pgTable, text, serial, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const kpCommentsTable = pgTable("kp_comments", {
  id: serial("id").primaryKey(),
  text: text("text").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertKpCommentSchema = createInsertSchema(kpCommentsTable).omit({ id: true, createdAt: true });
export type InsertKpComment = z.infer<typeof insertKpCommentSchema>;
export type KpComment = typeof kpCommentsTable.$inferSelect;
