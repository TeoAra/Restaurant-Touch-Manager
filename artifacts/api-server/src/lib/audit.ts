import { db, auditLogsTable } from "@workspace/db";
import type { Request } from "express";

export type AuditAction =
  | "order.delete_item"
  | "order.void_item"
  | "order.discount_apply"
  | "order.discount_remove"
  | "order.sospeso"
  | "order.sospeso_paid"
  | "order.cancel"
  | "order.merge"
  | "order.move_table"
  | "order.move_items"
  | "fiscal.receipt_void"
  | "fiscal.drawer_open"
  | "fiscal.z_report"
  | "fiscal.x_report"
  | "product.toggle_available"
  | "payment.create"
  | "payment.romana"
  | "auth.login"
  | "auth.logout";

export async function logAudit(opts: {
  req?: Request;
  action: AuditAction;
  entityType?: string;
  entityId?: number;
  details?: Record<string, unknown>;
}) {
  try {
    const session = (opts.req as unknown as { session?: { userId?: number; userName?: string } })?.session;
    await db.insert(auditLogsTable).values({
      userId: session?.userId ?? null,
      userName: session?.userName ?? null,
      action: opts.action,
      entityType: opts.entityType ?? null,
      entityId: opts.entityId ?? null,
      details: opts.details ?? null,
    });
  } catch (e) {
    console.error("[AUDIT] Errore registrazione:", e);
  }
}
