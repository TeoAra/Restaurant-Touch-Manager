import { createHmac, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const COOKIE_NAME = "hellotable_session";
const MAX_AGE_SECONDS = 12 * 60 * 60;

type SessionPayload = { userId: number; expiresAt: number };

function secret(): string {
  const value = process.env.SESSION_SECRET;
  if (!value) throw new Error("SESSION_SECRET non configurato");
  return value;
}

function sign(value: string): string {
  return createHmac("sha256", secret()).update(value).digest("base64url");
}

function readSession(req: Request): SessionPayload | null {
  const raw = req.cookies?.[COOKIE_NAME];
  if (typeof raw !== "string") return null;
  const [encoded, suppliedSignature] = raw.split(".");
  if (!encoded || !suppliedSignature) return null;
  const expectedSignature = sign(encoded);
  const supplied = Buffer.from(suppliedSignature);
  const expected = Buffer.from(expectedSignature);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as SessionPayload;
    return Number.isInteger(payload.userId) && payload.userId > 0 && payload.expiresAt > Date.now() ? payload : null;
  } catch {
    return null;
  }
}

export function setAuthenticatedSession(res: Response, userId: number): void {
  const payload: SessionPayload = { userId, expiresAt: Date.now() + MAX_AGE_SECONDS * 1000 };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  res.cookie(COOKIE_NAME, `${encoded}.${sign(encoded)}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: MAX_AGE_SECONDS * 1000,
    path: "/",
  });
}

export function clearAuthenticatedSession(res: Response): void {
  res.clearCookie(COOKIE_NAME, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/" });
}

export async function requireAdminSession(req: Request, res: Response, next: NextFunction): Promise<void> {
  const session = readSession(req);
  if (!session) {
    res.status(401).json({ error: "Autenticazione amministratore richiesta" });
    return;
  }
  const [user] = await db.select({ id: usersTable.id, name: usersTable.name, role: usersTable.role })
    .from(usersTable).where(eq(usersTable.id, session.userId)).limit(1);
  if (!user || user.role !== "admin") {
    res.status(403).json({ error: "Operazione riservata all'amministratore" });
    return;
  }
  (req as Request & { session?: { userId: number; userName: string; role: string } }).session = { userId: user.id, userName: user.name, role: user.role };
  next();
}

/**
 * Middleware for any authenticated session (kitchen, employee, admin).
 * Attaches req.session with userId, userName, role.
 */
export async function requireAuthenticatedSession(req: Request, res: Response, next: NextFunction): Promise<void> {
  const session = readSession(req);
  if (!session) {
    res.status(401).json({ error: "Autenticazione richiesta" });
    return;
  }
  const [user] = await db.select({ id: usersTable.id, name: usersTable.name, role: usersTable.role })
    .from(usersTable).where(eq(usersTable.id, session.userId)).limit(1);
  if (!user) {
    res.status(401).json({ error: "Sessione non valida" });
    return;
  }
  (req as Request & { session?: { userId: number; userName: string; role: string } }).session = { userId: user.id, userName: user.name, role: user.role };
  next();
}