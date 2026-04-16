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
  const { key, value } = req.body as { key: string; value: string };
  if (!key || value === undefined) return res.status(400).json({ error: "key and value required" });
  await db.execute(
    sql`INSERT INTO app_settings (key, value) VALUES (${key}, ${value})
        ON CONFLICT (key) DO UPDATE SET value = ${value}`
  );
  res.json({ key, value });
});

export default router;
