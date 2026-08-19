/**
 * Tests for kitchen lifecycle logic:
 * - status transition validation
 * - idempotency of repeated transitions
 * - modifier cost exclusion parsing
 *
 * Runs with Node built-in test runner and TypeScript type stripping.
 * Usage: node --experimental-strip-types --loader ./src/lib/ts-node-loader.mjs --no-warnings src/lib/kitchen.test.ts
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  KITCHEN_STATUSES,
  calculateActualPrepMinutes,
  canAmendOrderItem,
  canDeleteOrderItem,
  isKitchenPrinter,
  isKitchenTransitionTarget,
  isValidKitchenTransition,
} from "./kitchen-domain.js";

// ── Transition validation tests ───────────────────────────────────────────────

describe("Kitchen status transitions", () => {
  test("draft → sent is valid", () => {
    assert.equal(isValidKitchenTransition("draft", "sent"), true);
  });

  test("sent → preparing is valid", () => {
    assert.equal(isValidKitchenTransition("sent", "preparing"), true);
  });

  test("preparing → ready is valid", () => {
    assert.equal(isValidKitchenTransition("preparing", "ready"), true);
  });

  test("ready → delivered is valid", () => {
    assert.equal(isValidKitchenTransition("ready", "delivered"), true);
  });

  test("delivered → anything is invalid", () => {
    for (const s of KITCHEN_STATUSES) {
      assert.equal(isValidKitchenTransition("delivered", s), false, `delivered → ${s} should be invalid`);
    }
  });

  test("skipping steps is invalid (sent → ready)", () => {
    assert.equal(isValidKitchenTransition("sent", "ready"), false);
  });

  test("skipping steps is invalid (sent → delivered)", () => {
    assert.equal(isValidKitchenTransition("sent", "delivered"), false);
  });

  test("backward transition is invalid (ready → preparing)", () => {
    assert.equal(isValidKitchenTransition("ready", "preparing"), false);
  });

  test("backward transition is invalid (preparing → sent)", () => {
    assert.equal(isValidKitchenTransition("preparing", "sent"), false);
  });

  test("unknown status returns false", () => {
    assert.equal(isValidKitchenTransition("unknown", "sent"), false);
    assert.equal(isValidKitchenTransition("sent", "unknown"), false);
  });

  test("public transition target rejects draft", () => {
    assert.equal(isKitchenTransitionTarget("draft"), false);
    assert.equal(isKitchenTransitionTarget("sent"), true);
    assert.equal(isKitchenTransitionTarget("preparing"), true);
    assert.equal(isKitchenTransitionTarget("ready"), true);
    assert.equal(isKitchenTransitionTarget("delivered"), true);
  });
});

// ── Idempotency: already in target status ─────────────────────────────────────

describe("Kitchen idempotency", () => {
  test("item already in target status should NOT require a transition", () => {
    // Simulates the idempotency check in PATCH /kitchen/items/:id/status
    function handleTransition(currentStatus: string, targetStatus: string): "already_in_status" | "transition" | "invalid" {
      if (currentStatus === targetStatus) return "already_in_status";
      if (!isValidKitchenTransition(currentStatus, targetStatus)) return "invalid";
      return "transition";
    }

    assert.equal(handleTransition("preparing", "preparing"), "already_in_status");
    assert.equal(handleTransition("sent", "sent"), "already_in_status");
    assert.equal(handleTransition("delivered", "delivered"), "already_in_status");
  });

  test("valid transition from different status returns transition", () => {
    function handleTransition(currentStatus: string, targetStatus: string): "already_in_status" | "transition" | "invalid" {
      if (currentStatus === targetStatus) return "already_in_status";
      if (!isValidKitchenTransition(currentStatus, targetStatus)) return "invalid";
      return "transition";
    }

    assert.equal(handleTransition("sent", "preparing"), "transition");
    assert.equal(handleTransition("preparing", "ready"), "transition");
  });
});

describe("Order-item amendments", () => {
  test("draft and sent rows may be amended only while order is open", () => {
    assert.equal(canAmendOrderItem("draft", "open"), true);
    assert.equal(canAmendOrderItem("sent", "open"), true);
    assert.equal(canAmendOrderItem("preparing", "open"), false);
    assert.equal(canAmendOrderItem("ready", "open"), false);
    assert.equal(canAmendOrderItem("sent", "paid"), false);
  });

  test("only unsent draft rows may be deleted", () => {
    assert.equal(canDeleteOrderItem("draft", "open"), true);
    assert.equal(canDeleteOrderItem("sent", "open"), false);
    assert.equal(canDeleteOrderItem("preparing", "open"), false);
    assert.equal(canDeleteOrderItem("draft", "paid"), false);
  });
});

describe("Kitchen printer routing", () => {
  test("only categories assigned to a kitchen department printer reach the kitchen board", () => {
    const kitchenPrinterIds = new Set([7, 12]);
    assert.equal(isKitchenPrinter(7, kitchenPrinterIds), true);
    assert.equal(isKitchenPrinter(12, kitchenPrinterIds), true);
    assert.equal(isKitchenPrinter(3, kitchenPrinterIds), false);
    assert.equal(isKitchenPrinter(null, kitchenPrinterIds), false);
    assert.equal(isKitchenPrinter(undefined, kitchenPrinterIds), false);
  });

  test("a mixed order exposes only kitchen-routed items to kitchen actions", () => {
    const kitchenPrinterIds = new Set([7]);
    const productCategoryIds = new Map([[101, 10], [202, 20]]);
    const categoryPrinterIds = new Map([[10, 7], [20, 3]]);
    const orderItems = [
      { id: 1, productId: 101, status: "sent" },
      { id: 2, productId: 202, status: "sent" },
    ];

    const kitchenItemIds = orderItems
      .filter(item => isKitchenPrinter(categoryPrinterIds.get(productCategoryIds.get(item.productId)!), kitchenPrinterIds))
      .map(item => item.id);

    assert.deepEqual(kitchenItemIds, [1]);
    assert.equal(kitchenItemIds.includes(2), false);
  });
});

// ── Modifier cost exclusion parsing ──────────────────────────────────────────

describe("Modifier cost exclusion", () => {
  function parseExcludedIngredientIds(modifiersSnapshot: string | null): Set<number> {
    const excluded = new Set<number>();
    if (!modifiersSnapshot) return excluded;
    try {
      const mods = JSON.parse(modifiersSnapshot) as Array<{
        type?: string;
        ingredientId?: number;
        source?: string;
      }>;
      for (const mod of mods) {
        if (mod.type === "minus" && typeof mod.ingredientId === "number" && mod.source === "recipe") {
          excluded.add(mod.ingredientId);
        }
      }
    } catch { /* ignore */ }
    return excluded;
  }

  test("null snapshot returns empty set", () => {
    const result = parseExcludedIngredientIds(null);
    assert.equal(result.size, 0);
  });

  test("empty array returns empty set", () => {
    const result = parseExcludedIngredientIds("[]");
    assert.equal(result.size, 0);
  });

  test("minus modifier with ingredientId and source=recipe is excluded", () => {
    const mods = JSON.stringify([
      { type: "minus", label: "Senza pomodoro", ingredientId: 42, source: "recipe" },
    ]);
    const result = parseExcludedIngredientIds(mods);
    assert.equal(result.has(42), true);
    assert.equal(result.size, 1);
  });

  test("minus modifier without ingredientId is NOT excluded", () => {
    const mods = JSON.stringify([
      { type: "minus", label: "Senza sale" },
    ]);
    const result = parseExcludedIngredientIds(mods);
    assert.equal(result.size, 0);
  });

  test("minus modifier with source != recipe is NOT excluded", () => {
    const mods = JSON.stringify([
      { type: "minus", label: "Senza olio", ingredientId: 7, source: "manual" },
    ]);
    const result = parseExcludedIngredientIds(mods);
    assert.equal(result.size, 0);
  });

  test("plus modifier is never excluded", () => {
    const mods = JSON.stringify([
      { type: "plus", label: "Extra mozzarella", ingredientId: 10, source: "recipe" },
    ]);
    const result = parseExcludedIngredientIds(mods);
    assert.equal(result.size, 0);
  });

  test("multiple modifiers: only minus+recipe ones excluded", () => {
    const mods = JSON.stringify([
      { type: "minus", label: "Senza pomodoro", ingredientId: 1, source: "recipe" },
      { type: "minus", label: "Senza cipolla", ingredientId: 2, source: "recipe" },
      { type: "plus", label: "Extra formaggio", ingredientId: 3, source: "recipe" },
      { type: "minus", label: "Senza olio", ingredientId: 4, source: "manual" },
      { type: "info", label: "Ben cotto" },
    ]);
    const result = parseExcludedIngredientIds(mods);
    assert.equal(result.has(1), true);
    assert.equal(result.has(2), true);
    assert.equal(result.has(3), false);
    assert.equal(result.has(4), false);
    assert.equal(result.size, 2);
  });

  test("malformed JSON returns empty set without throwing", () => {
    const result = parseExcludedIngredientIds("{not valid json}");
    assert.equal(result.size, 0);
  });
});

// ── Actual prep minutes calculation ──────────────────────────────────────────

describe("Actual prep minutes", () => {
  test("calculates minutes from preparingAt to readyAt", () => {
    const preparingAt = new Date("2024-01-01T12:00:00Z");
    const readyAt = new Date("2024-01-01T12:18:00Z");
    const actualPrepMinutes = calculateActualPrepMinutes(preparingAt, readyAt);
    assert.equal(actualPrepMinutes, 18);
  });

  test("rounds to nearest minute", () => {
    const preparingAt = new Date("2024-01-01T12:00:00Z");
    const readyAt = new Date("2024-01-01T12:07:30Z");
    const actualPrepMinutes = calculateActualPrepMinutes(preparingAt, readyAt);
    assert.equal(actualPrepMinutes, 8); // 7.5 rounds to 8
  });

  test("falls back to expected recipe minutes when no actual data", () => {
    const actualPrepMinutes: number | null = null;
    const expectedRecipeMinutes = 15;
    const prepMinutes = actualPrepMinutes != null ? actualPrepMinutes : expectedRecipeMinutes;
    assert.equal(prepMinutes, 15);
  });

  test("uses actual when available, ignores expected", () => {
    const actualPrepMinutes: number | null = 22;
    const expectedRecipeMinutes = 15;
    const prepMinutes = actualPrepMinutes != null ? actualPrepMinutes : expectedRecipeMinutes;
    assert.equal(prepMinutes, 22);
  });
});
