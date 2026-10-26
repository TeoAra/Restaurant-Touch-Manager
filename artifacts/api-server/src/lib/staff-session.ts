import { randomBytes } from "node:crypto";
import type { Request, Response, NextFunction } from "express";

type Staff = { id: number; name: string; role: string };
const sessions = new Map<string, { user: Staff; expires: number }>();
const cookieName = "hellotable_staff";
function token(req: Request) {
  return req.headers.cookie?.split(";").map(v => v.trim()).find(v => v.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
}
export function staffUser(req: Request): Staff | null {
  const value = token(req);
  const session = value ? sessions.get(value) : undefined;
  if (!session || session.expires < Date.now()) { if (value) sessions.delete(value); return null; }
  return session.user;
}
export function startStaffSession(req: Request, res: Response, user: Staff) {
  for (const [key, session] of sessions) if (session.expires < Date.now()) sessions.delete(key);
  const previous = token(req);
  if (previous) sessions.delete(previous);
  const value = randomBytes(32).toString("hex");
  sessions.set(value, { user, expires: Date.now() + 12 * 3600_000 });
  res.cookie(cookieName, value, { httpOnly: true, sameSite: "strict", secure: req.secure || req.header("x-forwarded-proto") === "https", path: "/api", maxAge: 12 * 3600_000 });
}
export function endStaffSession(req: Request, res: Response) {
  const value = token(req);
  if (value) sessions.delete(value);
  res.clearCookie(cookieName, { path: "/api" });
}
export function requireStaff(req: Request, res: Response, next: NextFunction): void {
  if (!staffUser(req)) { res.status(401).json({ error: "Accedi nuovamente con il PIN per gestire le prenotazioni e le operazioni fiscali." }); return; }
  next();
}
export function requireStaffAdmin(req: Request, res: Response, next: NextFunction): void {
  const user = staffUser(req);
  if (!user) { res.status(401).json({ error: "Accedi nuovamente con il PIN" }); return; }
  if (user.role !== "admin") { res.status(403).json({ error: "Operazione riservata all’amministratore" }); return; }
  next();
}
