/**
 * Tests for margin-calculator and fixed-decimal.
 * Runs with Node 24 built-in test runner and TypeScript type stripping.
 * Usage: node --experimental-strip-types src/lib/margin-calculator.test.ts
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { FixedDecimal } from "./fixed-decimal.js";
import { calculateBeveragePortionCost, utilityCostAfterDirectBeverage } from "./beverage-costs.js";
import { calculateMargin, type MarginCalculatorInput } from "./margin-calculator.js";

// ── FixedDecimal unit tests ────────────────────────────────────────────────

describe("FixedDecimal", () => {
  test("parse integer string", () => {
    const d = FixedDecimal.from("10");
    assert.equal(d.toFixed(2), "10.00");
    assert.equal(d.toFixed(6), "10.000000");
  });

  test("parse decimal string", () => {
    const d = FixedDecimal.from("3.14");
    assert.equal(d.toFixed(6), "3.140000");
    assert.equal(d.toFixed(2), "3.14");
  });

  test("parse negative string", () => {
    const d = FixedDecimal.from("-2.50");
    assert.equal(d.toFixed(2), "-2.50");
  });

  test("parse from safe integer number", () => {
    const d = FixedDecimal.from(42);
    assert.equal(d.toFixed(2), "42.00");
  });

  test("rejects Infinity", () => {
    assert.throws(() => FixedDecimal.from(Infinity), RangeError);
  });

  test("rejects NaN", () => {
    assert.throws(() => FixedDecimal.from(NaN), RangeError);
  });

  test("rejects empty string", () => {
    assert.throws(() => FixedDecimal.from(""), SyntaxError);
  });

  test("rejects scientific notation", () => {
    assert.throws(() => FixedDecimal.from("1e5"), SyntaxError);
  });

  test("addition", () => {
    const a = FixedDecimal.from("1.50");
    const b = FixedDecimal.from("2.75");
    assert.equal(a.add(b).toFixed(2), "4.25");
  });

  test("subtraction", () => {
    const a = FixedDecimal.from("5.00");
    const b = FixedDecimal.from("3.33");
    assert.equal(a.sub(b).toFixed(2), "1.67");
  });

  test("multiplication exact", () => {
    const a = FixedDecimal.from("2.50");
    const b = FixedDecimal.from("4.00");
    assert.equal(a.mul(b).toFixed(2), "10.00");
  });

  test("multiplication with fractional result", () => {
    const a = FixedDecimal.from("1.10");
    const b = FixedDecimal.from("3");
    assert.equal(a.mul(b).toFixed(2), "3.30");
  });

  test("division exact", () => {
    const a = FixedDecimal.from("10.00");
    const b = FixedDecimal.from("4.00");
    assert.equal(a.div(b).toFixed(2), "2.50");
  });

  test("division by zero throws", () => {
    const a = FixedDecimal.from("5");
    assert.throws(() => a.div(FixedDecimal.zero()), RangeError);
  });

  test("percent: 10% of 100", () => {
    const base = FixedDecimal.from("100");
    const pct = FixedDecimal.from("10");
    assert.equal(base.percent(pct).toFixed(2), "10.00");
  });

  test("percent: 1.5% of 200", () => {
    const base = FixedDecimal.from("200");
    const pct = FixedDecimal.from("1.5");
    assert.equal(base.percent(pct).toFixed(2), "3.00");
  });

  test("no floating-point drift: 0.1 + 0.2", () => {
    const a = FixedDecimal.from("0.1");
    const b = FixedDecimal.from("0.2");
    // In floating point 0.1 + 0.2 ≠ 0.3; with BigInt it must be exact
    assert.equal(a.add(b).toFixed(6), "0.300000");
  });

  test("no floating-point drift: 0.1 * 3", () => {
    const a = FixedDecimal.from("0.1");
    const b = FixedDecimal.from("3");
    assert.equal(a.mul(b).toFixed(6), "0.300000");
  });

  test("half-away-from-zero rounding (positive): 2.5 rounds to 3", () => {
    // 5/2 = 2.5 → rounds to 3
    const a = FixedDecimal.from("5");
    const b = FixedDecimal.from("2");
    // 5 / 2 = 2.5 → at 2-decimal display = 2.50, no rounding issue
    // Test half-away at the display level: 2.555 → "2.56" at 2 decimals
    const c = FixedDecimal.from("2.555");
    assert.equal(c.toFixed(2), "2.56");
  });

  test("half-away-from-zero rounding (negative): -2.555 rounds to -2.56", () => {
    const c = FixedDecimal.from("-2.555");
    assert.equal(c.toFixed(2), "-2.56");
  });
});

describe("calculateBeveragePortionCost", () => {
  test("birra piccola e media condividono il fusto e applicano la perdita", () => {
    const line = {
      lineType: "beer",
      purchasePriceNet: "100",
      sourceVolumeLiters: "50",
      lossPercentage: "10",
      dilutionWaterRatio: "0",
      co2CostPerLiter: "0.05",
      coolerKwhPerLiter: "0.02",
      cellarKwhPerLiter: "0.01",
    };
    const rates = { electricityCostPerKwh: "0.30" };
    const small = calculateBeveragePortionCost(line, "0.2", rates);
    const medium = calculateBeveragePortionCost(line, "0.4", rates);

    assert.equal(small.sourceCost, "0.444444");
    assert.equal(small.co2Cost, "0.010000");
    assert.equal(small.energyCost, "0.001800");
    assert.equal(medium.totalCost, "0.912488");
  });

  test("BIB calcola concentrato, acqua da bolletta, CO₂ ed energia", () => {
    const cost = calculateBeveragePortionCost({
      lineType: "bib",
      purchasePriceNet: "60",
      sourceVolumeLiters: "10",
      lossPercentage: "0",
      dilutionWaterRatio: "5",
      co2CostPerLiter: "0.02",
      coolerKwhPerLiter: "0.01",
      cellarKwhPerLiter: "0.005",
    }, "0.4", {
      waterCostPerLiter: "0.003",
      electricityCostPerKwh: "0.30",
    });

    assert.equal(cost.sourceLiters, "0.066667");
    assert.equal(cost.waterLiters, "0.333335");
    assert.equal(cost.sourceCost, "0.400002");
    assert.equal(cost.waterCost, "0.001000");
    assert.equal(cost.co2Cost, "0.008000");
    assert.equal(cost.energyCost, "0.001800");
    assert.equal(cost.totalCost, "0.410802");
    assert.deepEqual(cost.missingData, []);
  });

  test("BIB segnala l'assenza della bolletta acqua senza inventare un costo", () => {
    const cost = calculateBeveragePortionCost({
      lineType: "bib",
      purchasePriceNet: "50",
      sourceVolumeLiters: "10",
      lossPercentage: "0",
      dilutionWaterRatio: "4",
      co2CostPerLiter: "0",
      coolerKwhPerLiter: "0",
      cellarKwhPerLiter: "0",
    }, "0.2", {});

    assert.equal(cost.waterCost, "0.000000");
    assert.ok(cost.missingData.includes("BEVERAGE_WATER_BILL_MISSING"));
  });

  test("lo spreco BIB aumenta solo il concentrato, non l'acqua servita", () => {
    const cost = calculateBeveragePortionCost({
      lineType: "bib",
      purchasePriceNet: "60",
      sourceVolumeLiters: "10",
      lossPercentage: "10",
      dilutionWaterRatio: "5",
      co2CostPerLiter: "0",
      coolerKwhPerLiter: "0",
      cellarKwhPerLiter: "0",
    }, "0.6", { waterCostPerLiter: "0.003" });

    assert.equal(cost.sourceLiters, "0.111111");
    assert.equal(cost.waterLiters, "0.500000");
    assert.equal(cost.sourceCost, "0.666666");
    assert.equal(cost.waterCost, "0.001500");
  });

  test("la quota beverage diretta viene sottratta una sola volta dalla bolletta", () => {
    assert.equal(utilityCostAfterDirectBeverage("100", "60", "12"), "88.000000");
    // Se la stima diretta supera il variabile, canoni fissi e oneri rimangono
    // comunque allocati ai coperti senza produrre un costo negativo.
    assert.equal(utilityCostAfterDirectBeverage("100", "60", "75"), "40.000000");
  });
});

// ── calculateMargin tests ─────────────────────────────────────────────────

describe("calculateMargin", () => {
  // ── Test 1: Normal IVA 10% ─────────────────────────────────────────────
  test("normale IVA 10%: calcola net IVA e contribution corretti", () => {
    const input: MarginCalculatorInput = {
      actualGrossRevenue: "110.00",
      lines: [
        {
          productId: "pizza",
          grossRevenue: "110.00",
          quantity: "10",
          vatRate: "10",
          ingredientCostPerUnit: "3.00",
          packagingCostPerUnit: "0.20",
          fryerOilCostPerUnit: "0.00",
          energyCostPerUnit: "0.10",
          preparationMinutesPerUnit: "6",
          complete: true,
        },
      ],
      paymentFees: [],
      indirectCosts: [],
      laborHourlyCost: "12.00",
      fixedCostAllocation: "5.00",
      taxReservePercentage: "24",
    };

    const result = calculateMargin(input);

    // Gross = actual = 110.00
    assert.equal(result.grossRevenue, "110.00");

    // Net = 110 * 100 / 110 = 100.00
    assert.equal(result.netRevenue, "100.00");
    assert.equal(result.vatAmount, "10.00");

    // VAT breakdown
    assert.equal(result.vatBreakdown.length, 1);
    assert.equal(result.vatBreakdown[0].vatRate, "10.00");
    assert.equal(result.vatBreakdown[0].netRevenue, "100.00");

    // Ingredient cost = 3.00 * 10 = 30.00
    assert.equal(result.totalIngredientCost, "30.00");
    // Packaging cost = 0.20 * 10 = 2.00
    assert.equal(result.totalPackagingCost, "2.00");
    // Energy cost = 0.10 * 10 = 1.00
    assert.equal(result.totalEnergyCost, "1.00");
    // Fryer = 0
    assert.equal(result.totalFryerOilCost, "0.00");
    // Total variable = 33.00
    assert.equal(result.totalVariableCost, "33.00");

    // Contribution = 100.00 - 33.00 - 0 (no fees) = 67.00
    assert.equal(result.contributionMargin, "67.00");

    // Labor: 6min * 10 = 60min = 1h * 12 = 12.00
    assert.equal(result.totalLaborMinutes, "60.00");
    assert.equal(result.totalLaborCost, "12.00");

    // Management result = 67.00 - 12.00 - 0 - 5.00 = 50.00
    assert.equal(result.managementResult, "50.00");

    // Tax reserve = 24% of 50.00 = 12.00
    assert.equal(result.taxReserve, "12.00");

    // Net result = 50.00 - 12.00 = 38.00
    assert.equal(result.netResult, "38.00");

    // Completeness
    assert.equal(result.completeness, "complete");
    assert.equal(result.missingData.length, 0);

    // Margin per minute = 50.00 / 60 min = 0.83
    assert.notEqual(result.marginPerMinute, null);
    // 50 / 60 = 0.833... → 0.83
    assert.equal(result.marginPerMinute, "0.83");
  });

  // ── Test 2: Multiple VAT rates ─────────────────────────────────────────
  test("aliquote diverse: IVA 4%, 10%, 22%", () => {
    const input: MarginCalculatorInput = {
      actualGrossRevenue: "240.00",
      lines: [
        {
          productId: "pane",
          grossRevenue: "104.00",   // net = 104 * 100/104 = 100.00
          quantity: "10",
          vatRate: "4",
          complete: true,
        },
        {
          productId: "pizza",
          grossRevenue: "110.00",   // net = 110 * 100/110 = 100.00
          quantity: "10",
          vatRate: "10",
          complete: true,
        },
        {
          productId: "vino",
          grossRevenue: "26.00",    // net = 26 * 100/122 ≈ 21.31...
          quantity: "2",
          vatRate: "22",
          complete: true,
        },
      ],
      laborHourlyCost: "10.00",
      fixedCostAllocation: "0",
      taxReservePercentage: "0",
    };

    const result = calculateMargin(input);

    // Gross = actual = 240.00 (sum of lines = 104+110+26 = 240.00 ✓)
    assert.equal(result.grossRevenue, "240.00");

    // Check 4% bucket: 104 * 100/104 = 100.00
    const vat4 = result.vatBreakdown.find(v => v.vatRate === "4.00");
    assert.ok(vat4, "should have 4% bucket");
    assert.equal(vat4!.netRevenue, "100.00");
    assert.equal(vat4!.vatAmount, "4.00");

    // Check 10% bucket: 110 * 100/110 = 100.00
    const vat10 = result.vatBreakdown.find(v => v.vatRate === "10.00");
    assert.ok(vat10, "should have 10% bucket");
    assert.equal(vat10!.netRevenue, "100.00");
    assert.equal(vat10!.vatAmount, "10.00");

    // Check 22% bucket: 26 * 100/122 = 2600/122 = 21.31...
    const vat22 = result.vatBreakdown.find(v => v.vatRate === "22.00");
    assert.ok(vat22, "should have 22% bucket");
    // 2600000000 / 122 (in scale 1e6 units): 26*1e6*100*1e6 / (122*1e6) = 26*100*1e6/122
    // = 2600*1e6/122 = 21311475.409... → rounded to 21311475 → 21.311475
    // displayed at 2 decimals: 21.31
    assert.equal(vat22!.netRevenue, "21.31");

    // Total net should be 100 + 100 + 21.31 = 221.31
    assert.equal(result.netRevenue, "221.31");

    // No missing data (lines sum = 240 = actual)
    assert.ok(!result.missingData.includes("REVENUE_ALLOCATION_MISMATCH"));
  });

  // ── Test 3: Partial data (recipe incomplete) ───────────────────────────
  test("dati ricetta mancanti: completeness partial, missingData propagati", () => {
    const input: MarginCalculatorInput = {
      actualGrossRevenue: "55.00",
      lines: [
        {
          productId: "burger",
          grossRevenue: "55.00",
          quantity: "5",
          vatRate: "10",
          // No ingredient costs → incomplete
          complete: false,
        },
      ],
      laborHourlyCost: "12.00",
      fixedCostAllocation: "0",
      taxReservePercentage: "0",
      missingData: ["INGREDIENT_COST_MISSING"],
    };

    const result = calculateMargin(input);

    assert.equal(result.completeness, "partial");
    assert.ok(result.missingData.includes("INGREDIENT_COST_MISSING"));

    // Costs should be 0 since not provided
    assert.equal(result.totalIngredientCost, "0.00");
    assert.equal(result.totalVariableCost, "0.00");
  });

  // ── Test 4: Payment fees ───────────────────────────────────────────────
  test("commissione pagamento: percentage + fixedFee", () => {
    const input: MarginCalculatorInput = {
      actualGrossRevenue: "100.00",
      lines: [
        {
          productId: "item",
          grossRevenue: "100.00",
          quantity: "1",
          vatRate: "10",
          ingredientCostPerUnit: "20.00",
          complete: true,
        },
      ],
      paymentFees: [
        {
          name: "stripe",
          percentage: "1.5",   // 1.5% of 100 = 1.50
          fixedFee: "0.25",    // fixed 0.25
        },
      ],
      laborHourlyCost: "0",
      fixedCostAllocation: "0",
      taxReservePercentage: "0",
    };

    const result = calculateMargin(input);

    // Net = 100 * 100/110 = 90.909090...
    // ingredient = 20.00
    // fees = 1.5% * 100 + 0.25 = 1.50 + 0.25 = 1.75
    // contribution = net - ingredient - fees = 90.91 - 20.00 - 1.75 = 69.16
    assert.equal(result.totalPaymentFees, "1.75");

    // Net revenue at 6 decimal places internally: 90.909090...
    // Rounded to 2: 90.91
    assert.equal(result.netRevenue, "90.91");

    // Contribution = 90.909090... - 20.000000 - 1.75 = 69.159090... → 69.16
    assert.equal(result.contributionMargin, "69.16");
  });

  // ── Test 5: No floating-point drift in multi-line calculation ──────────
  test("valori decimali senza drift: 3 righe 0.1", () => {
    // 3 lines each with grossRevenue = 0.10 at VAT 10%
    // sum gross = 0.30, net = 0.30 * 100/110 = 0.272727...
    const input: MarginCalculatorInput = {
      actualGrossRevenue: "0.30",
      lines: [
        { productId: "a", grossRevenue: "0.10", quantity: "1", vatRate: "10", complete: true },
        { productId: "b", grossRevenue: "0.10", quantity: "1", vatRate: "10", complete: true },
        { productId: "c", grossRevenue: "0.10", quantity: "1", vatRate: "10", complete: true },
      ],
      laborHourlyCost: "0",
      fixedCostAllocation: "0",
      taxReservePercentage: "0",
    };

    const result = calculateMargin(input);

    // Net = 3 * (0.1 * 100/110). Each line: 0.1*1e6*100*1e6 / (110*1e6) = 10000000000/110 = 90909090.9090... → 90909091
    // 3 * 90909091 = 272727273 raw → 0.272727 at 6dp
    // At 2dp: 0.27
    assert.equal(result.netRevenue, "0.27");

    // No mismatch (lines sum = 0.30 = actual)
    assert.ok(!result.missingData.includes("REVENUE_ALLOCATION_MISMATCH"));

    // Gross is still the actual
    assert.equal(result.grossRevenue, "0.30");
  });

  // ── Test 6: Margin per minute = null when no prep minutes ─────────────
  test("margine per minuto null se minuti totali = 0", () => {
    const input: MarginCalculatorInput = {
      actualGrossRevenue: "50.00",
      lines: [
        {
          productId: "wine",
          grossRevenue: "50.00",
          quantity: "2",
          vatRate: "22",
          // No preparationMinutesPerUnit
          complete: true,
        },
      ],
      laborHourlyCost: "15.00",
      fixedCostAllocation: "0",
      taxReservePercentage: "0",
    };

    const result = calculateMargin(input);

    assert.equal(result.marginPerMinute, null);
    assert.equal(result.totalPreparationMinutes, "0.00");
    assert.equal(result.totalLaborCost, "0.00");
  });

  // ── Test 7: Revenue allocation mismatch detection ─────────────────────
  test("REVENUE_ALLOCATION_MISMATCH se gross differisce da somma linee oltre 1 centesimo", () => {
    const input: MarginCalculatorInput = {
      actualGrossRevenue: "100.00",
      lines: [
        {
          productId: "item1",
          grossRevenue: "60.00",
          quantity: "1",
          vatRate: "10",
          complete: true,
        },
        {
          productId: "item2",
          grossRevenue: "30.00",  // sum = 90, mismatch vs 100
          quantity: "1",
          vatRate: "10",
          complete: true,
        },
      ],
      laborHourlyCost: "0",
      fixedCostAllocation: "0",
      taxReservePercentage: "0",
    };

    const result = calculateMargin(input);
    assert.ok(result.missingData.includes("REVENUE_ALLOCATION_MISMATCH"));
    // Output grossRevenue is still the actualGrossRevenue
    assert.equal(result.grossRevenue, "100.00");
  });

  // ── Test 8: Revenue allocation within 1 cent (no mismatch) ───────────
  test("nessun REVENUE_ALLOCATION_MISMATCH se differenza <= 1 centesimo", () => {
    const input: MarginCalculatorInput = {
      actualGrossRevenue: "100.00",
      lines: [
        {
          productId: "item",
          grossRevenue: "100.00",
          quantity: "1",
          vatRate: "10",
          complete: true,
        },
      ],
      laborHourlyCost: "0",
      fixedCostAllocation: "0",
      taxReservePercentage: "0",
    };

    const result = calculateMargin(input);
    assert.ok(!result.missingData.includes("REVENUE_ALLOCATION_MISMATCH"));
  });

  // ── Test 9: Tax reserve only on positive management result ────────────
  test("tax reserve = 0 quando il risultato è negativo", () => {
    const input: MarginCalculatorInput = {
      actualGrossRevenue: "10.00",
      lines: [
        {
          productId: "item",
          grossRevenue: "10.00",
          quantity: "1",
          vatRate: "10",
          ingredientCostPerUnit: "20.00",  // cost > revenue → loss
          complete: true,
        },
      ],
      laborHourlyCost: "0",
      fixedCostAllocation: "0",
      taxReservePercentage: "24",
    };

    const result = calculateMargin(input);
    assert.equal(result.taxReserve, "0.00");
    // Management result is negative
    assert.ok(parseFloat(result.managementResult) < 0);
  });

  // ── Test 10: missingData deduplication ────────────────────────────────
  test("missingData deduplicati", () => {
    const input: MarginCalculatorInput = {
      actualGrossRevenue: "100.00",
      lines: [
        {
          productId: "a",
          grossRevenue: "50.00",
          quantity: "1",
          vatRate: "10",
          complete: false,
        },
        {
          productId: "b",
          grossRevenue: "50.00",
          quantity: "1",
          vatRate: "10",
          complete: false,
        },
      ],
      laborHourlyCost: "0",
      fixedCostAllocation: "0",
      taxReservePercentage: "0",
      missingData: ["FOO", "FOO", "BAR"],
    };

    const result = calculateMargin(input);
    const fooCount = result.missingData.filter(x => x === "FOO").length;
    assert.equal(fooCount, 1, "FOO should appear only once");
  });

  // ── Test 11: Indirect costs breakdown ────────────────────────────────
  test("indirect costs: somma e sources correttamente mappati", () => {
    const input: MarginCalculatorInput = {
      actualGrossRevenue: "100.00",
      lines: [
        {
          productId: "item",
          grossRevenue: "100.00",
          quantity: "1",
          vatRate: "10",
          complete: true,
        },
      ],
      indirectCosts: [
        { code: "RENT", amount: "10.00", source: "affitto mensile / 30", reliabilityLevel: "exact" },
        { code: "UTIL", amount: "3.50", source: "bolletta / ore lavoro", reliabilityLevel: "estimated" },
      ],
      laborHourlyCost: "0",
      fixedCostAllocation: "0",
      taxReservePercentage: "0",
    };

    const result = calculateMargin(input);
    assert.equal(result.totalIndirectCosts, "13.50");
    assert.equal(result.indirectCostSources.length, 2);
    assert.equal(result.indirectCostSources[0].code, "RENT");
    assert.equal(result.indirectCostSources[0].amount, "10.00");
    assert.equal(result.indirectCostSources[1].reliabilityLevel, "estimated");
  });
});
