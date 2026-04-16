import { Router } from "express";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router = Router();

// POST /api/auth/login — validate PIN, return user (no JWT needed, session is client-side)
router.post("/login", async (req, res) => {
  const { pin } = req.body as { pin: string };
  if (!pin) return res.status(400).json({ error: "PIN richiesto" });

  const [user] = await db
    .select({ id: usersTable.id, name: usersTable.name, role: usersTable.role })
    .from(usersTable)
    .where(eq(usersTable.pin, pin));

  if (!user) return res.status(401).json({ error: "PIN non valido" });
  res.json(user);
});

// GET /api/auth/users — list users (admin only, enforced in frontend)
router.get("/users", async (_req, res) => {
  const users = await db
    .select({ id: usersTable.id, name: usersTable.name, role: usersTable.role, createdAt: usersTable.createdAt })
    .from(usersTable)
    .orderBy(usersTable.role, usersTable.name);
  res.json(users);
});

// POST /api/auth/users — create user
router.post("/users", async (req, res) => {
  const { name, pin, role } = req.body as { name: string; pin: string; role: string };
  const [user] = await db.insert(usersTable).values({ name, pin, role: role || "employee" }).returning({
    id: usersTable.id, name: usersTable.name, role: usersTable.role,
  });
  res.status(201).json(user);
});

// DELETE /api/auth/users/:id — delete user
router.delete("/users/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  await db.delete(usersTable).where(eq(usersTable.id, id));
  res.status(204).end();
});

// PATCH /api/auth/users/:id — update user pin/role/name
router.patch("/users/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  const { name, pin, role } = req.body as { name?: string; pin?: string; role?: string };
  const [user] = await db.update(usersTable).set({ ...(name && { name }), ...(pin && { pin }), ...(role && { role }) })
    .where(eq(usersTable.id, id)).returning({ id: usersTable.id, name: usersTable.name, role: usersTable.role });
  if (!user) return res.status(404).json({ error: "Utente non trovato" });
  res.json(user);
});

export default router;
