import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

export async function getSettings(): Promise<Record<string, string>> {
  const rows = await db.execute(sql`SELECT key, value FROM app_settings`);
  const map: Record<string, string> = {};
  for (const row of rows.rows as { key: string; value: string }[]) {
    map[row.key] = row.value;
  }
  return map;
}
