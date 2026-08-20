import { FixedDecimal } from "./fixed-decimal.js";

const ZERO = FixedDecimal.zero();
const HUNDRED = FixedDecimal.from("100");
const ONE = FixedDecimal.from("1");

export type BeverageLineCostInput = {
  lineType: string;
  purchasePriceNet: string;
  sourceVolumeLiters: string;
  lossPercentage: string;
  dilutionWaterRatio: string;
  co2CostPerLiter: string;
  coolerKwhPerLiter: string;
  cellarKwhPerLiter: string;
};

export type BeverageCostRates = {
  waterCostPerLiter?: string;
  electricityCostPerKwh?: string;
};

export type BeveragePortionCost = {
  sourceCost: string;
  waterCost: string;
  co2Cost: string;
  energyCost: string;
  totalCost: string;
  sourceLiters: string;
  waterLiters: string;
  energyKwh: string;
  missingData: string[];
};

function amount(value: string | number | null | undefined): FixedDecimal {
  return FixedDecimal.from(value ?? "0");
}

/**
 * Leaves fixed charges in the generic bill allocation while removing only the
 * direct beverage amount from its variable component. This keeps the same
 * water/electricity from being attributed both to a sold drink and to covers.
 */
export function utilityCostAfterDirectBeverage(
  totalCost: string | number,
  variableCost: string | number,
  directBeverageCost: string | number,
): string {
  const direct = amount(directBeverageCost);
  const variable = amount(variableCost);
  const attributableDirectCost = direct.greaterThan(variable) ? variable : direct;
  return amount(totalCost).sub(attributableDirectCost).toString();
}

/**
 * Calculates direct cost for one sold beverage portion. The purchase price is
 * net of recoverable VAT; loss applies to the source liquid only. For a BIB,
 * the configured ratio is litres of water per litre of concentrate.
 */
export function calculateBeveragePortionCost(
  line: BeverageLineCostInput,
  servingVolumeLiters: string | number,
  rates: BeverageCostRates,
): BeveragePortionCost {
  const missingData: string[] = [];
  const volume = amount(servingVolumeLiters);
  const sourceVolume = amount(line.sourceVolumeLiters);
  const loss = amount(line.lossPercentage);
  const waterRatio = amount(line.dilutionWaterRatio);
  const energyKwh = amount(line.coolerKwhPerLiter).add(amount(line.cellarKwhPerLiter)).mul(volume);

  if (!volume.isPositive()) missingData.push("BEVERAGE_SERVING_VOLUME_INVALID");
  if (!sourceVolume.isPositive()) missingData.push("BEVERAGE_SOURCE_VOLUME_INVALID");
  if (loss.isNegative() || !loss.lessThan(HUNDRED)) missingData.push("BEVERAGE_LOSS_INVALID");
  if (line.lineType !== "beer" && line.lineType !== "bib") missingData.push("BEVERAGE_LINE_TYPE_INVALID");

  const lossMultiplier = loss.isNegative() || !loss.lessThan(HUNDRED)
    ? ONE
    : ONE.div(ONE.sub(loss.div(HUNDRED)));
  const finalVolumeDivisor = line.lineType === "bib" ? ONE.add(waterRatio) : ONE;
  const servedSourceLiters = volume.isPositive() && finalVolumeDivisor.isPositive()
    ? volume.div(finalVolumeDivisor)
    : ZERO;
  // Loss affects the purchased liquid only. The water component represents the
  // volume actually served and is consequently not inflated by a lost portion
  // of concentrate.
  const sourceLiters = servedSourceLiters.mul(lossMultiplier);
  const waterLiters = line.lineType === "bib" ? servedSourceLiters.mul(waterRatio) : ZERO;
  const sourceCost = sourceVolume.isPositive()
    ? amount(line.purchasePriceNet).div(sourceVolume).mul(sourceLiters)
    : ZERO;

  let waterCost = ZERO;
  if (waterLiters.isPositive()) {
    if (rates.waterCostPerLiter == null) {
      missingData.push("BEVERAGE_WATER_BILL_MISSING");
    } else {
      waterCost = waterLiters.mul(amount(rates.waterCostPerLiter));
    }
  }

  let energyCost = ZERO;
  if (energyKwh.isPositive()) {
    if (rates.electricityCostPerKwh == null) {
      missingData.push("BEVERAGE_ELECTRICITY_RATE_MISSING");
    } else {
      energyCost = energyKwh.mul(amount(rates.electricityCostPerKwh));
    }
  }

  const co2Cost = amount(line.co2CostPerLiter).mul(volume);
  return {
    sourceCost: sourceCost.toString(),
    waterCost: waterCost.toString(),
    co2Cost: co2Cost.toString(),
    energyCost: energyCost.toString(),
    totalCost: sourceCost.add(waterCost).add(co2Cost).add(energyCost).toString(),
    sourceLiters: sourceLiters.toString(),
    waterLiters: waterLiters.toString(),
    energyKwh: energyKwh.toString(),
    missingData,
  };
}