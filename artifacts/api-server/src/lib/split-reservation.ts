export type SplitReservationState = string | null | undefined;

export function canClaimSplitReservation(
  state: SplitReservationState,
  storedToken: string | null | undefined,
  requestToken: string,
): boolean {
  return state == null || (state === "settled" && storedToken !== requestToken);
}

export function isSplitPaymentReplay(
  state: SplitReservationState,
  storedToken: string | null | undefined,
  paymentId: number | null | undefined,
  requestToken: string,
): paymentId is number {
  return state === "settled" && storedToken === requestToken && typeof paymentId === "number";
}