import { Router } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

const router = Router();

// GET all settings as {key: value} object
router.get("/", async (_req, res) => {
  const rows = await db.execute(sql`SELECT key, value FROM app_settings`);
  const result: Record<string, string> = {};
  for (const row of rows.rows as { key: string; value: string }[]) {
    result[row.key] = row.value;
  }
  res.json(result);
});

// PATCH one setting: { key, value }
router.patch("/", async (req, res) => {
  const body = req.body as Record<string, unknown>;
  // Supporta sia il formato singolo {key, value} sia il batch {key1: value1, key2: value2}
  if (typeof body.key === "string" && body.value !== undefined) {
    const key = body.key;
    const value = String(body.value);
    await db.execute(
      sql`INSERT INTO app_settings (key, value) VALUES (${key}, ${value})
          ON CONFLICT (key) DO UPDATE SET value = ${value}`
    );
    return res.json({ key, value });
  }
  // Batch: ogni coppia key→value
  const entries = Object.entries(body).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return res.status(400).json({ error: "Nessuna impostazione fornita" });
  for (const [k, v] of entries) {
    const value = String(v);
    await db.execute(
      sql`INSERT INTO app_settings (key, value) VALUES (${k}, ${value})
          ON CONFLICT (key) DO UPDATE SET value = ${value}`
    );
  }
  return res.json({ updated: entries.length });
});

export default router;
