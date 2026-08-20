import { FixedDecimal } from "./fixed-decimal.js";

const ZERO = FixedDecimal.zero();
const HUNDRED = FixedDecimal.from("100");

export type DirectCostUnit = "g" | "kg" | "ml" | "l" | "pz";

export type DirectProductCostInput = {
  purchasePriceNet: string;
  purchaseQuantity: string;
  purchaseUnit: string;
  portionQuantity: string;
  portionUnit: string;
  wastePercentage: string;
};

export type DirectProductPortionCost = {
  materialCost: string;
  purchaseBaseQuantity: string;
  portionBaseQuantity: string;
  missingData: string[];
};

function amount(value: string | number | null | undefined): FixedDecimal {
  return FixedDecimal.from(value ?? "0");
}

export function isDirectCostUnit(value: unknown): value is DirectCostUnit {
  return value === "g" || value === "kg" || value === "ml" || value === "l" || value === "pz";
}

function family(unit: DirectCostUnit): "weight" | "volume" | "pieces" {
  if (unit === "g" || unit === "kg") return "weight";
  if (unit === "ml" || unit === "l") return "volume";
  return "pieces";
}

function toBase(value: string, unit: DirectCostUnit): FixedDecimal {
  const quantity = amount(value);
  if (unit === "kg" || unit === "l") return quantity.mul(FixedDecimal.from("1000"));
  return quantity;
}

/**
 * Cost of one sold portion for a ready or packaged product. The purchase price
 * is net of recoverable VAT; users may choose grams/kg, ml/l or pieces, but
 * the purchase and serving measurements must belong to the same family.
 */
export function calculateDirectProductPortionCost(input: DirectProductCostInput): DirectProductPortionCost {
  const missingData: string[] = [];
  if (!isDirectCostUnit(input.purchaseUnit)) missingData.push("DIRECT_COST_PURCHASE_UNIT_INVALID");
  if (!isDirectCostUnit(input.portionUnit)) missingData.push("DIRECT_COST_PORTION_UNIT_INVALID");
  if (!isDirectCostUnit(input.purchaseUnit) || !isDirectCostUnit(input.portionUnit)) {
    return { materialCost: ZERO.toString(), purchaseBaseQuantity: ZERO.toString(), portionBaseQuantity: ZERO.toString(), missingData };
  }
  if (family(input.purchaseUnit) !== family(input.portionUnit)) missingData.push("DIRECT_COST_UNIT_MISMATCH");

  const purchaseBaseQuantity = toBase(input.purchaseQuantity, input.purchaseUnit);
  const portionBaseQuantity = toBase(input.portionQuantity, input.portionUnit);
  const waste = amount(input.wastePercentage);
  if (!purchaseBaseQuantity.isPositive()) missingData.push("DIRECT_COST_PURCHASE_QUANTITY_INVALID");
  if (!portionBaseQuantity.isPositive()) missingData.push("DIRECT_COST_PORTION_QUANTITY_INVALID");
  if (waste.isNegative() || !waste.lessThan(HUNDRED)) missingData.push("DIRECT_COST_WASTE_INVALID");

  const materialCost = missingData.length === 0
    ? amount(input.purchasePriceNet)
      .div(purchaseBaseQuantity)
      .mul(portionBaseQuantity)
      .mul(HUNDRED.add(waste))
      .div(HUNDRED)
    : ZERO;
  return {
    materialCost: materialCost.toString(),
    purchaseBaseQuantity: purchaseBaseQuantity.toString(),
    portionBaseQuantity: portionBaseQuantity.toString(),
    missingData,
  };
}

export function selectDirectProductCostForDate<T extends { productId: number; validFrom: string; active: boolean }>(
  costs: T[],
  productId: number,
  at: string,
): T | undefined {
  return costs
    .filter((cost) => cost.productId === productId && cost.active && cost.validFrom <= at)
    .sort((left, right) => right.validFrom.localeCompare(left.validFrom))[0];
}