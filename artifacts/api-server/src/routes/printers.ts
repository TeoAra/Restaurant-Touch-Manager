import { Router } from "express";
import { db } from "@workspace/db";
import { printersTable, insertPrinterSchema } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import net from "net";

const router = Router();

router.get("/", async (_req, res) => {
  const rows = await db.select().from(printersTable).orderBy(printersTable.name);
  res.json(rows);
});

router.post("/", async (req, res) => {
  const parsed = insertPrinterSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const [row] = await db.insert(printersTable).values(parsed.data).returning();
  res.status(201).json(row);
});

router.patch("/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  const parsed = insertPrinterSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const [row] = await db.update(printersTable).set(parsed.data).where(eq(printersTable.id, id)).returning();
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});

router.delete("/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  const [row] = await db.delete(printersTable).where(eq(printersTable.id, id)).returning();
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json({ success: true });
});

// Test TCP connectivity for a single printer
function testTcp(ip: string, port: number, timeoutMs = 4000): Promise<{ ok: boolean; ms?: number; error?: string }> {
  return new Promise(resolve => {
    const start = Date.now();
    const socket = new net.Socket();
    let done = false;
    const finish = (ok: boolean, error?: string) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(ok ? { ok: true, ms: Date.now() - start } : { ok: false, error });
    };
    socket.setTimeout(timeoutMs);
    socket.on("timeout", () => finish(false, "Timeout"));
    socket.on("error", (e) => finish(false, e.message));
    socket.connect(port, ip, () => finish(true));
  });
}

// Test all active printers
router.get("/test-all", async (_req, res) => {
  const printers = await db.select().from(printersTable).where(eq(printersTable.active, true));
  const results = await Promise.all(
    printers.map(async p => {
      const result = await testTcp(p.ip, p.port);
      return { id: p.id, name: p.name, ip: p.ip, port: p.port, isFiscale: p.isFiscale, ...result };
    })
  );
  res.json({ results });
});

export default router;
