import { pgTable, text, serial, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const happyHourTable = pgTable("happy_hour", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  startTime: text("start_time").notNull().default("17:00"),
  endTime: text("end_time").notNull().default("19:00"),
  daysOfWeek: text("days_of_week").notNull().default("1,2,3,4,5"),
  priceList: text("price_list").notNull().default("2"),
  discountPercent: text("discount_percent").notNull().default("0"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertHappyHourSchema = createInsertSchema(happyHourTable).omit({ id: true, createdAt: true });
export type InsertHappyHour = z.infer<typeof insertHappyHourSchema>;
export type HappyHour = typeof happyHourTable.$inferSelect;
