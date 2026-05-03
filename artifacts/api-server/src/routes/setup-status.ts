import { Router } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

const router = Router();

/**
 * GET /api/setup-status
 *
 * Restituisce lo stato di configurazione iniziale dell'installazione.
 * - completed=true se settings.onboarding_completed === "true"
 *   OPPURE se l'installazione risulta già configurata in modo retroattivo
 *   (almeno 1 admin + 1 sala + 1 categoria + 1 prodotto). In quel caso,
 *   il flag viene auto-settato per evitare future detection queries.
 *
 * Questo endpoint NON richiede auth perché è usato dal client al boot
 * per decidere se mostrare il wizard o no, e non espone dati sensibili.
 */
router.get("/", async (_req, res) => {
  const flagRow = await db.execute(
    sql`SELECT value FROM app_settings WHERE key = 'onboarding_completed' LIMIT 1`
  );
  const flagValue = (flagRow.rows[0] as { value?: string } | undefined)?.value;
  if (flagValue === "true") {
    return res.json({ completed: true, reason: "flag" as const });
  }

  const counts = await db.execute(sql`
    SELECT
      (SELECT COUNT(*)::int FROM users WHERE role = 'admin') AS admins,
      (SELECT COUNT(*)::int FROM rooms) AS rooms,
      (SELECT COUNT(*)::int FROM categories) AS categories,
      (SELECT COUNT(*)::int FROM products) AS products
  `);
  const row = counts.rows[0] as {
    admins: number;
    rooms: number;
    categories: number;
    products: number;
  };

  const detected =
    row.admins >= 1 && row.rooms >= 1 && row.categories >= 1 && row.products >= 1;

  if (detected) {
    await db.execute(
      sql`INSERT INTO app_settings (key, value) VALUES ('onboarding_completed', 'true')
          ON CONFLICT (key) DO UPDATE SET value = 'true'`
    );
    return res.json({
      completed: true,
      reason: "detected" as const,
      counts: row,
    });
  }

  return res.json({
    completed: false,
    reason: "fresh" as const,
    counts: row,
  });
});

export default router;
