export const KITCHEN_STATUSES = ["draft", "sent", "preparing", "ready", "delivered"] as const;
export type KitchenStatus = (typeof KITCHEN_STATUSES)[number];

export const KITCHEN_TRANSITION_TARGETS = ["sent", "preparing", "ready", "delivered"] as const;

const TRANSITIONS: Record<KitchenStatus, readonly KitchenStatus[]> = {
  draft: ["sent"],
  sent: ["preparing"],
  preparing: ["ready"],
  ready: ["delivered"],
  delivered: [],
};

export function isKitchenTransitionTarget(status: string): status is (typeof KITCHEN_TRANSITION_TARGETS)[number] {
  return (KITCHEN_TRANSITION_TARGETS as readonly string[]).includes(status);
}

export function isValidKitchenTransition(from: string, to: string): boolean {
  const allowed = TRANSITIONS[from as KitchenStatus];
  return !!allowed && (allowed as readonly string[]).includes(to);
}

export function canAmendOrderItem(itemStatus: string, orderStatus: string): boolean {
  return orderStatus === "open" && (itemStatus === "draft" || itemStatus === "sent");
}

export function canDeleteOrderItem(itemStatus: string, orderStatus: string): boolean {
  return orderStatus === "open" && itemStatus === "draft";
}

export function isKitchenPrinter(printerId: number | null | undefined, kitchenPrinterIds: ReadonlySet<number>): boolean {
  return typeof printerId === "number" && kitchenPrinterIds.has(printerId);
}

export function calculateActualPrepMinutes(preparingAt: Date, readyAt: Date): number {
  return Math.max(0, Math.round((readyAt.getTime() - preparingAt.getTime()) / 60_000));
}