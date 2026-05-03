import { Router } from "express";
import { db, auditLogsTable } from "@workspace/db";
import { desc, gte, lte, and, eq } from "drizzle-orm";

const router = Router();

router.get("/", async (req, res) => {
  const { from, to, action, entityType, limit } = req.query as Record<string, string | undefined>;
  const conds = [];
  if (from)       conds.push(gte(auditLogsTable.createdAt, new Date(from)));
  if (to)         conds.push(lte(auditLogsTable.createdAt, new Date(to)));
  if (action)     conds.push(eq(auditLogsTable.action, action));
  if (entityType) conds.push(eq(auditLogsTable.entityType, entityType));

  const lim = Math.min(Number(limit ?? 200), 500);
  const rows = conds.length
    ? await db.select().from(auditLogsTable).where(and(...conds)).orderBy(desc(auditLogsTable.createdAt)).limit(lim)
    : await db.select().from(auditLogsTable).orderBy(desc(auditLogsTable.createdAt)).limit(lim);
  res.json(rows);
});

export default router;
