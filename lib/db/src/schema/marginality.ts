import {
  pgTable,
  text,
  serial,
  integer,
  boolean,
  timestamp,
  date,
  numeric,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { sql } from "drizzle-orm";

// ---------------------------------------------------------------------------
// ingredients
// ---------------------------------------------------------------------------
export const ingredientsTable = pgTable(
  "ingredients",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    baseUnit: text("base_unit").notNull(),
    currentUnitCost: numeric("current_unit_cost", { precision: 18, scale: 6 }).notNull(),
    vatRate: numeric("vat_rate", { precision: 18, scale: 6 }).notNull(),
    // Peso dell'unità d'acquisto in grammi (es. 1000 per 1 kg).
    // Null = l'unità non è espressa in grammi (es. litri, pezzi).
    unitSizeG: numeric("unit_size_g", { precision: 18, scale: 6 }),
    // Peso di una singola fetta/pezzo in grammi (es. 20 per una fetta di edamer).
    // Significativo solo se unitSizeG è valorizzato.
    sliceWeightG: numeric("slice_weight_g", { precision: 18, scale: 6 }),
    active: boolean("active").notNull().default(true),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [uniqueIndex("ingredients_name_unique").on(t.name)],
);

export const insertIngredientSchema = createInsertSchema(ingredientsTable).omit({ id: true, updatedAt: true });
export type InsertIngredient = z.infer<typeof insertIngredientSchema>;
export type Ingredient = typeof ingredientsTable.$inferSelect;

// ---------------------------------------------------------------------------
// suppliers
// ---------------------------------------------------------------------------
export const suppliersTable = pgTable(
  "suppliers",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    vatNumber: text("vat_number"),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("suppliers_name_idx").on(t.name)],
);

export const insertSupplierSchema = createInsertSchema(suppliersTable).omit({ id: true, createdAt: true });
export type InsertSupplier = z.infer<typeof insertSupplierSchema>;
export type Supplier = typeof suppliersTable.$inferSelect;

// ---------------------------------------------------------------------------
// supplierProducts
// ---------------------------------------------------------------------------
export const supplierProductsTable = pgTable(
  "supplier_products",
  {
    id: serial("id").primaryKey(),
    supplierId: integer("supplier_id").notNull(),
    ingredientId: integer("ingredient_id").notNull(),
    supplierDescription: text("supplier_description").notNull(),
    packageQuantity: numeric("package_quantity", { precision: 18, scale: 6 }).notNull(),
    packageUnit: text("package_unit").notNull(),
    packagePrice: numeric("package_price", { precision: 18, scale: 6 }).notNull(),
    normalizedUnitCost: numeric("normalized_unit_cost", { precision: 18, scale: 6 }).notNull(),
    lastPurchaseDate: date("last_purchase_date", { mode: "string" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    index("supplier_products_supplier_idx").on(t.supplierId),
    index("supplier_products_ingredient_idx").on(t.ingredientId),
  ],
);

export const insertSupplierProductSchema = createInsertSchema(supplierProductsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertSupplierProduct = z.infer<typeof insertSupplierProductSchema>;
export type SupplierProduct = typeof supplierProductsTable.$inferSelect;

// ---------------------------------------------------------------------------
// ingredientCostHistory
// ---------------------------------------------------------------------------
export const ingredientCostHistoryTable = pgTable(
  "ingredient_cost_history",
  {
    id: serial("id").primaryKey(),
    ingredientId: integer("ingredient_id").notNull(),
    supplierProductId: integer("supplier_product_id"),
    unitCost: numeric("unit_cost", { precision: 18, scale: 6 }).notNull(),
    source: text("source").notNull(),
    validFrom: date("valid_from", { mode: "string" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("ingredient_cost_history_ingredient_idx").on(t.ingredientId),
    index("ingredient_cost_history_valid_from_idx").on(t.validFrom),
  ],
);

export const insertIngredientCostHistorySchema = createInsertSchema(ingredientCostHistoryTable).omit({ id: true, createdAt: true });
export type InsertIngredientCostHistory = z.infer<typeof insertIngredientCostHistorySchema>;
export type IngredientCostHistory = typeof ingredientCostHistoryTable.$inferSelect;

// ---------------------------------------------------------------------------
// recipes
// ---------------------------------------------------------------------------
export const recipesTable = pgTable(
  "recipes",
  {
    id: serial("id").primaryKey(),
    productId: integer("product_id").notNull(),
    yieldQuantity: numeric("yield_quantity", { precision: 18, scale: 6 }).notNull(),
    preparationMinutes: integer("preparation_minutes").notNull(),
    packagingCostPerUnit: numeric("packaging_cost_per_unit", { precision: 18, scale: 6 }).notNull().default("0"),
    usesFryer: boolean("uses_fryer").notNull().default(false),
    fryerPortionsPerYield: numeric("fryer_portions_per_yield", { precision: 18, scale: 6 }),
    active: boolean("active").notNull().default(true),
    version: integer("version").notNull().default(1),
    validFrom: date("valid_from", { mode: "string" }).notNull(),
    validTo: date("valid_to", { mode: "string" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("recipes_product_version_unique").on(t.productId, t.version),
    index("recipes_product_idx").on(t.productId),
  ],
);

export const insertRecipeSchema = createInsertSchema(recipesTable).omit({ id: true, createdAt: true });
export type InsertRecipe = z.infer<typeof insertRecipeSchema>;
export type Recipe = typeof recipesTable.$inferSelect;

// ---------------------------------------------------------------------------
// recipeItems
// ---------------------------------------------------------------------------
export const recipeItemsTable = pgTable(
  "recipe_items",
  {
    id: serial("id").primaryKey(),
    recipeId: integer("recipe_id").notNull(),
    ingredientId: integer("ingredient_id").notNull(),
    quantity: numeric("quantity", { precision: 18, scale: 6 }).notNull(),
    wastePercentage: numeric("waste_percentage", { precision: 18, scale: 6 }).notNull().default("0"),
  },
  (t) => [
    uniqueIndex("recipe_items_recipe_ingredient_unique").on(t.recipeId, t.ingredientId),
    index("recipe_items_recipe_idx").on(t.recipeId),
  ],
);

export const insertRecipeItemSchema = createInsertSchema(recipeItemsTable).omit({ id: true });
export type InsertRecipeItem = z.infer<typeof insertRecipeItemSchema>;
export type RecipeItem = typeof recipeItemsTable.$inferSelect;

// ---------------------------------------------------------------------------
// costConfigurations
// ---------------------------------------------------------------------------
export const costConfigurationsTable = pgTable(
  "cost_configurations",
  {
    id: serial("id").primaryKey(),
    // Prezzo di emergenza da usare soltanto quando non è disponibile una bolletta
    // valida per il periodo. Il prezzo effettivo viene calcolato dalla bolletta.
    electricityCostPerKwh: numeric("electricity_cost_per_kwh", { precision: 18, scale: 6 }).notNull().default("0"),
    // Altri costi fissi mensili non coperti dalle voci dedicate qui sotto.
    fixedCostsMonthly: numeric("fixed_costs_monthly", { precision: 18, scale: 6 }).notNull().default("0"),
    rentMonthly: numeric("rent_monthly", { precision: 18, scale: 6 }).notNull().default("0"),
    taxRegisterAnnual: numeric("tax_register_annual", { precision: 18, scale: 6 }).notNull().default("0"),
    chamberFeeAnnual: numeric("chamber_fee_annual", { precision: 18, scale: 6 }).notNull().default("0"),
    // Materiale legato a ciascun coperto: tovaglietta, tovaglioli e busta posate.
    coverCostPerCover: numeric("cover_cost_per_cover", { precision: 18, scale: 6 }).notNull().default("0"),
    // Campo storico: non viene più chiesto né usato nell'allocazione.
    productiveHoursMonthly: numeric("productive_hours_monthly", { precision: 18, scale: 6 }).notNull().default("0"),
    ownerHourlyCost: numeric("owner_hourly_cost", { precision: 18, scale: 6 }).notNull(),
    taxReservePercentage: numeric("tax_reserve_percentage", { precision: 18, scale: 6 }).notNull(),
    cashFeePercentage: numeric("cash_fee_percentage", { precision: 18, scale: 6 }).notNull().default("0"),
    cardFeePercentage: numeric("card_fee_percentage", { precision: 18, scale: 6 }).notNull(),
    ticketFeePercentage: numeric("ticket_fee_percentage", { precision: 18, scale: 6 }).notNull().default("0"),
    otherFeePercentage: numeric("other_fee_percentage", { precision: 18, scale: 6 }).notNull().default("0"),
    paymentFixedFee: numeric("payment_fixed_fee", { precision: 18, scale: 6 }).notNull().default("0"),
    validFrom: date("valid_from", { mode: "string" }).notNull(),
    validTo: date("valid_to", { mode: "string" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("cost_configurations_valid_from_idx").on(t.validFrom)],
);

export const insertCostConfigurationSchema = createInsertSchema(costConfigurationsTable).omit({ id: true, createdAt: true });
export type InsertCostConfiguration = z.infer<typeof insertCostConfigurationSchema>;
export type CostConfiguration = typeof costConfigurationsTable.$inferSelect;

// ---------------------------------------------------------------------------
// coverCostItems
// ---------------------------------------------------------------------------
export const coverCostItemsTable = pgTable(
  "cover_cost_items",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    // Esempio: 100 tovaglioli, 50 porta-posate o 250 bustine di salsa.
    purchaseQuantity: numeric("purchase_quantity", { precision: 18, scale: 6 }).notNull(),
    purchaseUnit: text("purchase_unit").notNull().default("pz"),
    purchasePrice: numeric("purchase_price", { precision: 18, scale: 6 }).notNull(),
    // Quantità applicata per coperto oppure per comanda con fritti, in base allo scope.
    quantityPerCover: numeric("quantity_per_cover", { precision: 18, scale: 6 }).notNull().default("1"),
    applicationScope: text("application_scope").notNull().default("cover"),
    active: boolean("active").notNull().default(true),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [uniqueIndex("cover_cost_items_name_unique").on(t.name)],
);

export const insertCoverCostItemSchema = createInsertSchema(coverCostItemsTable).omit({ id: true, updatedAt: true });
export type InsertCoverCostItem = z.infer<typeof insertCoverCostItemSchema>;
export type CoverCostItem = typeof coverCostItemsTable.$inferSelect;

// ---------------------------------------------------------------------------
// equipment
// ---------------------------------------------------------------------------
export const equipmentTable = pgTable(
  "equipment",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    powerKw: numeric("power_kw", { precision: 18, scale: 6 }).notNull(),
    averageUtilizationPercentage: numeric("average_utilization_percentage", { precision: 18, scale: 6 }).notNull().default("100"),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("equipment_name_idx").on(t.name)],
);

export const insertEquipmentSchema = createInsertSchema(equipmentTable).omit({ id: true, createdAt: true });
export type InsertEquipment = z.infer<typeof insertEquipmentSchema>;
export type Equipment = typeof equipmentTable.$inferSelect;

// ---------------------------------------------------------------------------
// productEquipment
// ---------------------------------------------------------------------------
export const productEquipmentTable = pgTable(
  "product_equipment",
  {
    id: serial("id").primaryKey(),
    productId: integer("product_id").notNull(),
    equipmentId: integer("equipment_id").notNull(),
    usageMinutes: numeric("usage_minutes", { precision: 18, scale: 6 }).notNull(),
  },
  (t) => [
    uniqueIndex("product_equipment_product_equipment_unique").on(t.productId, t.equipmentId),
    index("product_equipment_product_idx").on(t.productId),
  ],
);

export const insertProductEquipmentSchema = createInsertSchema(productEquipmentTable).omit({ id: true });
export type InsertProductEquipment = z.infer<typeof insertProductEquipmentSchema>;
export type ProductEquipment = typeof productEquipmentTable.$inferSelect;

// ---------------------------------------------------------------------------
// beverageLines
// ---------------------------------------------------------------------------
// Una linea rappresenta la fonte fisica condivisa (fusto o BIB), non il
// pulsante venduto in cassa. Formati diversi possono quindi consumare la stessa
// linea, ciascuno con la propria dose in litri.
export const beverageLinesTable = pgTable(
  "beverage_lines",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    lineType: text("line_type").notNull(), // "beer" | "bib"
    // Prezzo imponibile della fonte acquistata, con IVA salvata separatamente
    // per trasparenza contabile. I costi di marginalità usano l'imponibile.
    purchasePriceNet: numeric("purchase_price_net", { precision: 18, scale: 6 }).notNull(),
    vatRate: numeric("vat_rate", { precision: 18, scale: 6 }).notNull().default("0"),
    // Litri nominali del fusto (birra) o di concentrato (BIB).
    sourceVolumeLiters: numeric("source_volume_liters", { precision: 18, scale: 6 }).notNull(),
    lossPercentage: numeric("loss_percentage", { precision: 18, scale: 6 }).notNull().default("0"),
    // Per BIB: litri d'acqua per ogni litro di concentrato (es. 5 = 1:5).
    dilutionWaterRatio: numeric("dilution_water_ratio", { precision: 18, scale: 6 }).notNull().default("0"),
    // Costo CO₂ già normalizzato per litro erogato, ricavabile dal gestore
    // della bombola senza richiedere misurazioni live in servizio.
    co2CostPerLiter: numeric("co2_cost_per_liter", { precision: 18, scale: 6 }).notNull().default("0"),
    // Consumo tecnico attribuibile al litro servito per le due apparecchiature.
    coolerKwhPerLiter: numeric("cooler_kwh_per_liter", { precision: 18, scale: 6 }).notNull().default("0"),
    cellarKwhPerLiter: numeric("cellar_kwh_per_liter", { precision: 18, scale: 6 }).notNull().default("0"),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("beverage_lines_name_unique").on(t.name),
    index("beverage_lines_type_active_idx").on(t.lineType, t.active),
  ],
);

export const insertBeverageLineSchema = createInsertSchema(beverageLinesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertBeverageLine = z.infer<typeof insertBeverageLineSchema>;
export type BeverageLine = typeof beverageLinesTable.$inferSelect;

// ---------------------------------------------------------------------------
// beverageLineSupplyHistory
// ---------------------------------------------------------------------------
// Il fusto/BIB è la stessa linea fisica, ma ogni fornitura può avere un
// imponibile e un volume diversi. La decorrenza consente di ricostruire il
// costo applicabile alla data della comanda senza alterare gli snapshot.
export const beverageLineSupplyHistoryTable = pgTable(
  "beverage_line_supply_history",
  {
    id: serial("id").primaryKey(),
    beverageLineId: integer("beverage_line_id").notNull().references(() => beverageLinesTable.id, { onDelete: "restrict" }),
    purchasePriceNet: numeric("purchase_price_net", { precision: 18, scale: 6 }).notNull(),
    sourceVolumeLiters: numeric("source_volume_liters", { precision: 18, scale: 6 }).notNull(),
    validFrom: date("valid_from", { mode: "string" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("beverage_line_supply_history_line_valid_from_unique").on(t.beverageLineId, t.validFrom),
    check(
      "beverage_line_supply_history_positive_supply_check",
      sql`${t.purchasePriceNet} > 0 AND ${t.sourceVolumeLiters} > 0`,
    ),
  ],
);

export const insertBeverageLineSupplyHistorySchema = createInsertSchema(beverageLineSupplyHistoryTable).omit({ id: true, createdAt: true });
export type InsertBeverageLineSupplyHistory = z.infer<typeof insertBeverageLineSupplyHistorySchema>;
export type BeverageLineSupplyHistory = typeof beverageLineSupplyHistoryTable.$inferSelect;

// ---------------------------------------------------------------------------
// beverageProductMappings
// ---------------------------------------------------------------------------
export const beverageProductMappingsTable = pgTable(
  "beverage_product_mappings",
  {
    id: serial("id").primaryKey(),
    productId: integer("product_id").notNull(),
    beverageLineId: integer("beverage_line_id").notNull(),
    servingVolumeLiters: numeric("serving_volume_liters", { precision: 18, scale: 6 }).notNull(),
    servingFormat: text("serving_format").notNull().default("other"), // "bottle" | "can" | "glass" | "other"
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("beverage_product_mappings_product_unique").on(t.productId),
    index("beverage_product_mappings_line_idx").on(t.beverageLineId),
  ],
);

export const insertBeverageProductMappingSchema = createInsertSchema(beverageProductMappingsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertBeverageProductMapping = z.infer<typeof insertBeverageProductMappingSchema>;
export type BeverageProductMapping = typeof beverageProductMappingsTable.$inferSelect;

// ---------------------------------------------------------------------------
// fryerOilCycles
// ---------------------------------------------------------------------------
export const fryerOilCyclesTable = pgTable(
  "fryer_oil_cycles",
  {
    id: serial("id").primaryKey(),
    openedAt: timestamp("opened_at", { withTimezone: true }).notNull(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    initialLiters: numeric("initial_liters", { precision: 18, scale: 6 }).notNull(),
    refillLiters: numeric("refill_liters", { precision: 18, scale: 6 }).notNull().default("0"),
    totalCost: numeric("total_cost", { precision: 18, scale: 6 }).notNull(),
    portionsProduced: integer("portions_produced").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("fryer_oil_cycles_opened_at_idx").on(t.openedAt)],
);

export const insertFryerOilCycleSchema = createInsertSchema(fryerOilCyclesTable).omit({ id: true, createdAt: true });
export type InsertFryerOilCycle = z.infer<typeof insertFryerOilCycleSchema>;
export type FryerOilCycle = typeof fryerOilCyclesTable.$inferSelect;

// ---------------------------------------------------------------------------
// utilityTypes
// ---------------------------------------------------------------------------
export const utilityTypesTable = pgTable(
  "utility_types",
  {
    id: serial("id").primaryKey(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    measurementUnit: text("measurement_unit").notNull(),
    allocationMethod: text("allocation_method").notNull(),
    active: boolean("active").notNull().default(true),
    reliabilityLevel: text("reliability_level").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("utility_types_code_unique").on(t.code)],
);

export const insertUtilityTypeSchema = createInsertSchema(utilityTypesTable).omit({ id: true, createdAt: true });
export type InsertUtilityType = z.infer<typeof insertUtilityTypeSchema>;
export type UtilityType = typeof utilityTypesTable.$inferSelect;

// ---------------------------------------------------------------------------
// utilityBills
// ---------------------------------------------------------------------------
export const utilityBillsTable = pgTable(
  "utility_bills",
  {
    id: serial("id").primaryKey(),
    utilityTypeId: integer("utility_type_id").notNull(),
    supplier: text("supplier"),
    periodStart: date("period_start", { mode: "string" }).notNull(),
    periodEnd: date("period_end", { mode: "string" }).notNull(),
    consumptionQuantity: numeric("consumption_quantity", { precision: 18, scale: 6 }).notNull(),
    variableCost: numeric("variable_cost", { precision: 18, scale: 6 }).notNull(),
    fixedCost: numeric("fixed_cost", { precision: 18, scale: 6 }).notNull(),
    taxesAndFees: numeric("taxes_and_fees", { precision: 18, scale: 6 }).notNull().default("0"),
    totalCost: numeric("total_cost", { precision: 18, scale: 6 }).notNull(),
    documentReference: text("document_reference"),
    importedAt: timestamp("imported_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("utility_bills_utility_type_idx").on(t.utilityTypeId),
    index("utility_bills_period_start_idx").on(t.periodStart),
  ],
);

export const insertUtilityBillSchema = createInsertSchema(utilityBillsTable).omit({ id: true, importedAt: true });
export type InsertUtilityBill = z.infer<typeof insertUtilityBillSchema>;
export type UtilityBill = typeof utilityBillsTable.$inferSelect;

// ---------------------------------------------------------------------------
// serviceSessions
// ---------------------------------------------------------------------------
export const serviceSessionsTable = pgTable(
  "service_sessions",
  {
    id: serial("id").primaryKey(),
    openedAt: timestamp("opened_at", { withTimezone: true }).notNull(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    grossRevenue: numeric("gross_revenue", { precision: 18, scale: 6 }).notNull().default("0"),
    netRevenue: numeric("net_revenue", { precision: 18, scale: 6 }).notNull().default("0"),
    orderCount: integer("order_count").notNull().default(0),
    covers: integer("covers").notNull().default(0),
    productiveMinutes: integer("productive_minutes").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("service_sessions_opened_at_idx").on(t.openedAt)],
);

export const insertServiceSessionSchema = createInsertSchema(serviceSessionsTable).omit({ id: true, createdAt: true });
export type InsertServiceSession = z.infer<typeof insertServiceSessionSchema>;
export type ServiceSession = typeof serviceSessionsTable.$inferSelect;

// ---------------------------------------------------------------------------
// serviceUtilityAllocations
// ---------------------------------------------------------------------------
export const serviceUtilityAllocationsTable = pgTable(
  "service_utility_allocations",
  {
    id: serial("id").primaryKey(),
    serviceSessionId: integer("service_session_id").notNull(),
    utilityTypeId: integer("utility_type_id").notNull(),
    calculatedCost: numeric("calculated_cost", { precision: 18, scale: 6 }).notNull(),
    calculationMethod: text("calculation_method").notNull(),
    calculationVersion: integer("calculation_version").notNull(),
    source: text("source").notNull(),
    reliabilityLevel: text("reliability_level").notNull(),
    calculatedAt: timestamp("calculated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("service_utility_allocations_session_utility_version_unique").on(
      t.serviceSessionId,
      t.utilityTypeId,
      t.calculationVersion,
    ),
    index("service_utility_allocations_session_idx").on(t.serviceSessionId),
  ],
);

export const insertServiceUtilityAllocationSchema = createInsertSchema(serviceUtilityAllocationsTable).omit({ id: true, calculatedAt: true });
export type InsertServiceUtilityAllocation = z.infer<typeof insertServiceUtilityAllocationSchema>;
export type ServiceUtilityAllocation = typeof serviceUtilityAllocationsTable.$inferSelect;

// ---------------------------------------------------------------------------
// orderIndirectCostAllocations
// ---------------------------------------------------------------------------
export const orderIndirectCostAllocationsTable = pgTable(
  "order_indirect_cost_allocations",
  {
    id: serial("id").primaryKey(),
    orderId: integer("order_id").notNull(),
    serviceSessionId: integer("service_session_id"),
    costType: text("cost_type").notNull(),
    allocatedAmount: numeric("allocated_amount", { precision: 18, scale: 6 }).notNull(),
    allocationBasis: text("allocation_basis").notNull(),
    calculationVersion: integer("calculation_version").notNull(),
    source: text("source").notNull(),
    reliabilityLevel: text("reliability_level").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("order_indirect_cost_allocations_order_costtype_version_unique").on(
      t.orderId,
      t.costType,
      t.calculationVersion,
    ),
    index("order_indirect_cost_allocations_order_idx").on(t.orderId),
  ],
);

export const insertOrderIndirectCostAllocationSchema = createInsertSchema(orderIndirectCostAllocationsTable).omit({ id: true, createdAt: true });
export type InsertOrderIndirectCostAllocation = z.infer<typeof insertOrderIndirectCostAllocationSchema>;
export type OrderIndirectCostAllocation = typeof orderIndirectCostAllocationsTable.$inferSelect;

// ---------------------------------------------------------------------------
// marginOrderItemFacts
// ---------------------------------------------------------------------------
export const marginOrderItemFactsTable = pgTable(
  "margin_order_item_facts",
  {
    id: serial("id").primaryKey(),
    orderId: integer("order_id").notNull(),
    orderItemId: integer("order_item_id").notNull(),
    productId: integer("product_id").notNull(),
    productName: text("product_name").notNull(),
    quantity: integer("quantity").notNull(),
    unitPrice: numeric("unit_price", { precision: 18, scale: 6 }).notNull(),
    subtotal: numeric("subtotal", { precision: 18, scale: 6 }).notNull(),
    vatRate: numeric("vat_rate", { precision: 18, scale: 6 }).notNull().default("0"),
    // JSON snapshot of structured modifiers at capture time for cost exclusion logic
    modifiersSnapshot: text("modifiers_snapshot"),
    // Actual prep elapsed minutes (from kitchen lifecycle; null if not yet delivered)
    actualPrepMinutes: integer("actual_prep_minutes"),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("margin_order_item_facts_order_item_unique").on(t.orderItemId),
    index("margin_order_item_facts_order_idx").on(t.orderId),
    index("margin_order_item_facts_product_idx").on(t.productId),
  ],
);

export const insertMarginOrderItemFactSchema = createInsertSchema(marginOrderItemFactsTable).omit({ id: true, capturedAt: true });
export type InsertMarginOrderItemFact = z.infer<typeof insertMarginOrderItemFactSchema>;
export type MarginOrderItemFact = typeof marginOrderItemFactsTable.$inferSelect;

// ---------------------------------------------------------------------------
// orderCostSnapshots
// ---------------------------------------------------------------------------
export const orderCostSnapshotsTable = pgTable(
  "order_cost_snapshots",
  {
    id: serial("id").primaryKey(),
    orderId: integer("order_id").notNull(),
    calculationVersion: integer("calculation_version").notNull(),
    grossRevenue: numeric("gross_revenue", { precision: 18, scale: 6 }).notNull(),
    vatAmount: numeric("vat_amount", { precision: 18, scale: 6 }).notNull(),
    netRevenue: numeric("net_revenue", { precision: 18, scale: 6 }).notNull(),
    ingredientCost: numeric("ingredient_cost", { precision: 18, scale: 6 }).notNull(),
    packagingCost: numeric("packaging_cost", { precision: 18, scale: 6 }).notNull().default("0"),
    fryerOilCost: numeric("fryer_oil_cost", { precision: 18, scale: 6 }).notNull().default("0"),
    energyCost: numeric("energy_cost", { precision: 18, scale: 6 }).notNull().default("0"),
    paymentFee: numeric("payment_fee", { precision: 18, scale: 6 }).notNull().default("0"),
    laborCost: numeric("labor_cost", { precision: 18, scale: 6 }).notNull().default("0"),
    indirectCost: numeric("indirect_cost", { precision: 18, scale: 6 }).notNull().default("0"),
    fixedCostAllocation: numeric("fixed_cost_allocation", { precision: 18, scale: 6 }).notNull().default("0"),
    contributionMargin: numeric("contribution_margin", { precision: 18, scale: 6 }).notNull(),
    estimatedManagementResult: numeric("estimated_management_result", { precision: 18, scale: 6 }).notNull(),
    taxReserve: numeric("tax_reserve", { precision: 18, scale: 6 }).notNull().default("0"),
    preparationMinutes: integer("preparation_minutes").notNull().default(0),
    completenessStatus: text("completeness_status").notNull(),
    missingData: text("missing_data"),
    costBreakdown: text("cost_breakdown"),
    sources: text("sources"),
    calculatedAt: timestamp("calculated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("order_cost_snapshots_order_version_unique").on(t.orderId, t.calculationVersion),
    index("order_cost_snapshots_order_idx").on(t.orderId),
    index("order_cost_snapshots_calculated_at_idx").on(t.calculatedAt),
  ],
);

export const insertOrderCostSnapshotSchema = createInsertSchema(orderCostSnapshotsTable).omit({ id: true, calculatedAt: true });
export type InsertOrderCostSnapshot = z.infer<typeof insertOrderCostSnapshotSchema>;
export type OrderCostSnapshot = typeof orderCostSnapshotsTable.$inferSelect;

// ---------------------------------------------------------------------------
// marginCalculationJobs
// ---------------------------------------------------------------------------
export const marginCalculationJobsTable = pgTable(
  "margin_calculation_jobs",
  {
    id: serial("id").primaryKey(),
    orderId: integer("order_id").notNull(),
    calculationVersion: integer("calculation_version").notNull(),
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("margin_calculation_jobs_order_version_unique").on(t.orderId, t.calculationVersion),
    index("margin_calculation_jobs_status_idx").on(t.status),
    index("margin_calculation_jobs_order_idx").on(t.orderId),
  ],
);

export const insertMarginCalculationJobSchema = createInsertSchema(marginCalculationJobsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertMarginCalculationJob = z.infer<typeof insertMarginCalculationJobSchema>;
export type MarginCalculationJob = typeof marginCalculationJobsTable.$inferSelect;
