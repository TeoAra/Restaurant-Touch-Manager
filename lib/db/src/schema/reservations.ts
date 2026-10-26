import { pgTable, text, serial, integer, timestamp } from "drizzle-orm/pg-core";

export const reservationsTable = pgTable("reservations", {
  id: serial("id").primaryKey(),
  tableId: integer("table_id"),
  tableIds: text("table_ids"),  // JSON array "[1,2]" — multi-table support
  date: text("date").notNull(),
  time: text("time").notNull(),
  covers: integer("covers").notNull().default(2),
  guestName: text("guest_name").notNull(),
  phone: text("phone"),
  notes: text("notes"),
  status: text("status").notNull().default("confirmed"),
  durationMinutes: integer("duration_minutes").notNull().default(120),
  source: text("source").notNull().default("desk"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Reservation = typeof reservationsTable.$inferSelect;
export type InsertReservation = typeof reservationsTable.$inferInsert;
