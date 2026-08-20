import {
  beverageLineSupplyHistoryTable,
  beverageLinesTable,
  db,
} from "@workspace/db";

export type BeverageSupply = {
  beverageLineId: number;
  purchasePriceNet: string;
  sourceVolumeLiters: string;
  validFrom: string;
};

/**
 * Upgrade rows that existed before supply history was introduced. The original
 * line values are treated as the initial supply from the day the line was
 * configured, so historical calculations never fall back to mutable columns.
 */
export async function ensureLegacyBeverageSupplyHistory(): Promise<void> {
  const [lines, supplies] = await Promise.all([
    db.select().from(beverageLinesTable),
    db.select({ beverageLineId: beverageLineSupplyHistoryTable.beverageLineId }).from(beverageLineSupplyHistoryTable),
  ]);
  const lineIdsWithHistory = new Set(supplies.map((supply) => supply.beverageLineId));
  const legacySupplies = lines
    .filter((line) => !lineIdsWithHistory.has(line.id))
    .map((line) => ({
      beverageLineId: line.id,
      purchasePriceNet: line.purchasePriceNet,
      sourceVolumeLiters: line.sourceVolumeLiters,
      validFrom: line.createdAt.toISOString().slice(0, 10),
    }));

  if (legacySupplies.length) {
    await db.insert(beverageLineSupplyHistoryTable).values(legacySupplies).onConflictDoNothing();
  }
}

export function selectBeverageSupplyForDate<T extends BeverageSupply>(
  supplies: T[],
  beverageLineId: number,
  at: string,
): T | undefined {
  return supplies
    .filter((supply) => supply.beverageLineId === beverageLineId && supply.validFrom <= at)
    .sort((left, right) => right.validFrom.localeCompare(left.validFrom))[0];
}