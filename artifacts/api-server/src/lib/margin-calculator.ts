/**
 * Pure margin calculation engine.
 * No database, no network, no side effects.
 */

import { FixedDecimal } from "./fixed-decimal.js";

// ── Input types ────────────────────────────────────────────────────────────

export interface MarginProductLine {
  /** Product identifier (for breakdown labeling) */
  productId: string | number;
  /** Gross revenue for this line (with VAT) */
  grossRevenue: string | number;
  /** Number of units sold */
  quantity: string | number;
  /** VAT rate as percentage (e.g. 10 for 10%) */
  vatRate: string | number;
  /** Cost per unit: ingredient/food cost */
  ingredientCostPerUnit?: string | number;
  /** Cost per unit: packaging */
  packagingCostPerUnit?: string | number;
  /** Cost per unit: fryer oil */
  fryerOilCostPerUnit?: string | number;
  /** Cost per unit: energy */
  energyCostPerUnit?: string | number;
  /** Minutes of preparation per unit */
  preparationMinutesPerUnit?: string | number;
  /** Whether all cost data is present for this line */
  complete: boolean;
}

export interface PaymentFee {
  /** Fee name/identifier */
  name: string;
  /** Fixed amount already paid as fees */
  amount?: string | number;
  /** Percentage of gross revenue charged as fee */
  percentage?: string | number;
  /** Fixed per-transaction fee */
  fixedFee?: string | number;
}

export interface IndirectCost {
  /** Cost code/identifier */
  code: string;
  /** Amount of this indirect cost */
  amount: string | number;
  /** Source description */
  source: string;
  /** Reliability level of this cost estimate */
  reliabilityLevel: "exact" | "estimated" | "approximate";
}

export interface MarginCalculatorInput {
  /** Actual gross revenue received (from POS/payments) */
  actualGrossRevenue: string | number;
  /** Product lines with allocated revenues */
  lines: MarginProductLine[];
  /** Payment processing fees */
  paymentFees?: PaymentFee[];
  /** Indirect costs (utilities, rent share, etc.) */
  indirectCosts?: IndirectCost[];
  /** Hourly labor cost */
  laborHourlyCost: string | number;
  /** Fixed cost allocation for this period/shift */
  fixedCostAllocation: string | number;
  /** Tax reserve percentage (applied only when result is positive) */
  taxReservePercentage: string | number;
  /** Missing data items known before calculation */
  missingData?: string[];
}

// ── Output types ────────────────────────────────────────────────────────────

export interface VatBreakdownEntry {
  vatRate: string;
  grossRevenue: string;
  netRevenue: string;
  vatAmount: string;
}

export interface ProductLineResult {
  productId: string | number;
  grossRevenue: string;
  netRevenue: string;
  vatAmount: string;
  quantity: string;
  vatRate: string;
  ingredientCost: string;
  packagingCost: string;
  fryerOilCost: string;
  energyCost: string;
  totalVariableCost: string;
  contribution: string;
  laborMinutes: string;
  laborCost: string;
  preparationMinutesPerUnit: string;
}

export interface MarginCalculatorOutput {
  // ── Revenue ────────────────────────────────────────────────────────────────
  /** Actual gross revenue (from actualGrossRevenue input) */
  grossRevenue: string;
  /** Total net revenue (VAT excluded) */
  netRevenue: string;
  /** Total VAT amount */
  vatAmount: string;
  /** VAT breakdown by rate */
  vatBreakdown: VatBreakdownEntry[];

  // ── Costs ──────────────────────────────────────────────────────────────────
  totalIngredientCost: string;
  totalPackagingCost: string;
  totalFryerOilCost: string;
  totalEnergyCost: string;
  totalVariableCost: string;
  totalPaymentFees: string;
  totalLaborCost: string;
  totalLaborMinutes: string;
  totalIndirectCosts: string;
  fixedCostAllocation: string;

  // ── Results ────────────────────────────────────────────────────────────────
  /** Net revenue - variable costs - fees */
  contributionMargin: string;
  /** Contribution - labor - indirect - fixed */
  managementResult: string;
  /** Tax reserve (only if managementResult > 0) */
  taxReserve: string;
  /** Net result after tax reserve */
  netResult: string;

  // ── Ratios ─────────────────────────────────────────────────────────────────
  contributionMarginPercent: string;
  managementResultPercent: string;
  /** Margin per preparation minute, or null if total minutes = 0 */
  marginPerMinute: string | null;
  /** Total preparation minutes */
  totalPreparationMinutes: string;

  // ── Meta ───────────────────────────────────────────────────────────────────
  completeness: "complete" | "partial";
  missingData: string[];

  // ── Breakdowns ─────────────────────────────────────────────────────────────
  lineBreakdown: ProductLineResult[];
  indirectCostSources: Array<{ code: string; amount: string; source: string; reliabilityLevel: string }>;
}

// ── Constants ───────────────────────────────────────────────────────────────

const ZERO = FixedDecimal.zero();
const ONE_HUNDRED = FixedDecimal.from("100");
const SIXTY = FixedDecimal.from("60");
const CENT = FixedDecimal.from("0.01");

// ── Main function ───────────────────────────────────────────────────────────

export function calculateMargin(input: MarginCalculatorInput): MarginCalculatorOutput {
  const missingData: string[] = [...(input.missingData ?? [])];

  // ── Parse actual gross revenue ─────────────────────────────────────────────
  const actualGrossRevenue = fd(input.actualGrossRevenue);

  // ── Process lines ──────────────────────────────────────────────────────────
  // VAT buckets: vatRate string → { gross, net, vat }
  const vatBuckets = new Map<string, { gross: FixedDecimal; net: FixedDecimal; vat: FixedDecimal }>();

  let sumLinesGross = ZERO;
  let totalIngredientCost = ZERO;
  let totalPackagingCost = ZERO;
  let totalFryerOilCost = ZERO;
  let totalEnergyCost = ZERO;
  let totalLaborMinutes = ZERO;
  let hasPartialLine = false;

  const lineBreakdown: ProductLineResult[] = [];

  for (const line of input.lines) {
    const grossRevenue = fd(line.grossRevenue);
    const quantity = fd(line.quantity);
    const vatRate = fd(line.vatRate);

    // Net = gross * 100 / (100 + vatRate)
    const divisor = ONE_HUNDRED.add(vatRate);
    const netRevenue = grossRevenue.mul(ONE_HUNDRED).div(divisor);
    const vatAmount = grossRevenue.sub(netRevenue);

    // Accumulate VAT buckets
    const vatKey = vatRate.toFixed(2);
    const existing = vatBuckets.get(vatKey);
    if (existing) {
      vatBuckets.set(vatKey, {
        gross: existing.gross.add(grossRevenue),
        net: existing.net.add(netRevenue),
        vat: existing.vat.add(vatAmount),
      });
    } else {
      vatBuckets.set(vatKey, { gross: grossRevenue, net: netRevenue, vat: vatAmount });
    }

    sumLinesGross = sumLinesGross.add(grossRevenue);

    // Unit costs × quantity
    const ingredientCost = line.ingredientCostPerUnit != null
      ? fd(line.ingredientCostPerUnit).mul(quantity)
      : ZERO;
    const packagingCost = line.packagingCostPerUnit != null
      ? fd(line.packagingCostPerUnit).mul(quantity)
      : ZERO;
    const fryerOilCost = line.fryerOilCostPerUnit != null
      ? fd(line.fryerOilCostPerUnit).mul(quantity)
      : ZERO;
    const energyCost = line.energyCostPerUnit != null
      ? fd(line.energyCostPerUnit).mul(quantity)
      : ZERO;

    // Labor minutes
    const prepMinutesPerUnit = line.preparationMinutesPerUnit != null
      ? fd(line.preparationMinutesPerUnit)
      : ZERO;
    const linePreparationMinutes = prepMinutesPerUnit.mul(quantity);

    // Line contribution = net - ingredient - packaging - oil - energy
    const lineVariableCost = ingredientCost.add(packagingCost).add(fryerOilCost).add(energyCost);
    const lineContribution = netRevenue.sub(lineVariableCost);

    // Labor cost for this line
    const lineLaborHours = linePreparationMinutes.div(SIXTY);
    const lineLaborCost = lineLaborHours.mul(fd(input.laborHourlyCost));

    totalIngredientCost = totalIngredientCost.add(ingredientCost);
    totalPackagingCost = totalPackagingCost.add(packagingCost);
    totalFryerOilCost = totalFryerOilCost.add(fryerOilCost);
    totalEnergyCost = totalEnergyCost.add(energyCost);
    totalLaborMinutes = totalLaborMinutes.add(linePreparationMinutes);

    if (!line.complete) {
      hasPartialLine = true;
    }

    lineBreakdown.push({
      productId: line.productId,
      grossRevenue: grossRevenue.toFixed(2),
      netRevenue: netRevenue.toFixed(2),
      vatAmount: vatAmount.toFixed(2),
      quantity: quantity.toFixed(2),
      vatRate: vatRate.toFixed(2),
      ingredientCost: ingredientCost.toFixed(2),
      packagingCost: packagingCost.toFixed(2),
      fryerOilCost: fryerOilCost.toFixed(2),
      energyCost: energyCost.toFixed(2),
      totalVariableCost: lineVariableCost.toFixed(2),
      contribution: lineContribution.toFixed(2),
      laborMinutes: linePreparationMinutes.toFixed(2),
      laborCost: lineLaborCost.toFixed(2),
      preparationMinutesPerUnit: prepMinutesPerUnit.toFixed(2),
    });
  }

  // ── Check revenue allocation mismatch ──────────────────────────────────────
  const mismatch = actualGrossRevenue.sub(sumLinesGross).abs();
  if (mismatch.greaterThan(CENT)) {
    addMissing(missingData, "REVENUE_ALLOCATION_MISMATCH");
  }

  // ── Totals from lines ──────────────────────────────────────────────────────
  let totalNetRevenue = ZERO;
  let totalVatAmount = ZERO;
  for (const bucket of vatBuckets.values()) {
    totalNetRevenue = totalNetRevenue.add(bucket.net);
    totalVatAmount = totalVatAmount.add(bucket.vat);
  }

  const totalVariableCost = totalIngredientCost
    .add(totalPackagingCost)
    .add(totalFryerOilCost)
    .add(totalEnergyCost);

  // ── Payment fees ──────────────────────────────────────────────────────────
  let totalPaymentFees = ZERO;
  for (const fee of (input.paymentFees ?? [])) {
    if (fee.amount != null) {
      totalPaymentFees = totalPaymentFees.add(fd(fee.amount));
    }
    if (fee.percentage != null) {
      // percentage of actual gross revenue
      totalPaymentFees = totalPaymentFees.add(actualGrossRevenue.mul(fd(fee.percentage)).div(ONE_HUNDRED));
    }
    if (fee.fixedFee != null) {
      totalPaymentFees = totalPaymentFees.add(fd(fee.fixedFee));
    }
  }

  // ── Contribution margin ────────────────────────────────────────────────────
  // contribution = netRevenue - variableCosts - paymentFees
  const contributionMargin = totalNetRevenue
    .sub(totalVariableCost)
    .sub(totalPaymentFees);

  // ── Labor cost ────────────────────────────────────────────────────────────
  const laborHourlyCost = fd(input.laborHourlyCost);
  const totalLaborCost = totalLaborMinutes.div(SIXTY).mul(laborHourlyCost);

  // ── Indirect costs ────────────────────────────────────────────────────────
  let totalIndirectCosts = ZERO;
  const indirectCostSources: MarginCalculatorOutput["indirectCostSources"] = [];
  for (const ic of (input.indirectCosts ?? [])) {
    const amount = fd(ic.amount);
    totalIndirectCosts = totalIndirectCosts.add(amount);
    indirectCostSources.push({
      code: ic.code,
      amount: amount.toFixed(2),
      source: ic.source,
      reliabilityLevel: ic.reliabilityLevel,
    });
  }

  // ── Fixed cost allocation ─────────────────────────────────────────────────
  const fixedCostAllocation = fd(input.fixedCostAllocation);

  // ── Management result ─────────────────────────────────────────────────────
  // managementResult = contribution - labor - indirect - fixed
  const managementResult = contributionMargin
    .sub(totalLaborCost)
    .sub(totalIndirectCosts)
    .sub(fixedCostAllocation);

  // ── Tax reserve (only if positive result) ────────────────────────────────
  const taxReservePercentage = fd(input.taxReservePercentage);
  let taxReserve = ZERO;
  if (managementResult.isPositive()) {
    taxReserve = managementResult.mul(taxReservePercentage).div(ONE_HUNDRED);
  }

  const netResult = managementResult.sub(taxReserve);

  // ── Percentages (of actual gross revenue) ────────────────────────────────
  let contributionMarginPercent = "0.00";
  let managementResultPercent = "0.00";
  if (!actualGrossRevenue.isZero()) {
    contributionMarginPercent = contributionMargin.mul(ONE_HUNDRED).div(actualGrossRevenue).toFixed(2);
    managementResultPercent = managementResult.mul(ONE_HUNDRED).div(actualGrossRevenue).toFixed(2);
  }

  // ── Margin per minute ─────────────────────────────────────────────────────
  let marginPerMinute: string | null = null;
  if (!totalLaborMinutes.isZero()) {
    marginPerMinute = managementResult.div(totalLaborMinutes).toFixed(2);
  }

  // ── Completeness ─────────────────────────────────────────────────────────
  const completeness: "complete" | "partial" = hasPartialLine ? "partial" : "complete";

  // ── VAT breakdown ─────────────────────────────────────────────────────────
  const vatBreakdown: VatBreakdownEntry[] = [];
  for (const [rate, bucket] of vatBuckets.entries()) {
    vatBreakdown.push({
      vatRate: rate,
      grossRevenue: bucket.gross.toFixed(2),
      netRevenue: bucket.net.toFixed(2),
      vatAmount: bucket.vat.toFixed(2),
    });
  }
  // Sort by vatRate ascending
  vatBreakdown.sort((a, b) => parseFloat(a.vatRate) - parseFloat(b.vatRate));

  return {
    grossRevenue: actualGrossRevenue.toFixed(2),
    netRevenue: totalNetRevenue.toFixed(2),
    vatAmount: totalVatAmount.toFixed(2),
    vatBreakdown,

    totalIngredientCost: totalIngredientCost.toFixed(2),
    totalPackagingCost: totalPackagingCost.toFixed(2),
    totalFryerOilCost: totalFryerOilCost.toFixed(2),
    totalEnergyCost: totalEnergyCost.toFixed(2),
    totalVariableCost: totalVariableCost.toFixed(2),
    totalPaymentFees: totalPaymentFees.toFixed(2),
    totalLaborCost: totalLaborCost.toFixed(2),
    totalLaborMinutes: totalLaborMinutes.toFixed(2),
    totalIndirectCosts: totalIndirectCosts.toFixed(2),
    fixedCostAllocation: fixedCostAllocation.toFixed(2),

    contributionMargin: contributionMargin.toFixed(2),
    managementResult: managementResult.toFixed(2),
    taxReserve: taxReserve.toFixed(2),
    netResult: netResult.toFixed(2),

    contributionMarginPercent,
    managementResultPercent,
    marginPerMinute,
    totalPreparationMinutes: totalLaborMinutes.toFixed(2),

    completeness,
    missingData: dedup(missingData),

    lineBreakdown,
    indirectCostSources,
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function fd(value: string | number): FixedDecimal {
  return FixedDecimal.from(value);
}

function addMissing(arr: string[], code: string): void {
  if (!arr.includes(code)) arr.push(code);
}

function dedup(arr: string[]): string[] {
  return [...new Set(arr)];
}
