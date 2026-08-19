/**
 * Fixed-point arithmetic with BigInt, scale 1e6 (6 decimal places).
 * NO parseFloat, NO floating-point arithmetic in calculations.
 */

const SCALE = 1_000_000n;
const SCALE_N = 1_000_000; // for safe integer checks only

export class FixedDecimal {
  /** Internal representation: value * 1_000_000, as BigInt */
  readonly raw: bigint;

  private constructor(raw: bigint) {
    this.raw = raw;
  }

  // ── Factory ────────────────────────────────────────────────────────────────

  /**
   * Parse from string or number.
   * - string: must be a valid decimal literal (no scientific notation)
   * - number: must be safe integer or finite; converted via String(n)
   */
  static from(value: string | number): FixedDecimal {
    if (typeof value === "number") {
      if (!Number.isFinite(value)) {
        throw new RangeError(`FixedDecimal.from: non-finite number ${value}`);
      }
      if (!Number.isSafeInteger(value) && value !== Math.fround(value)) {
        // Convert via string to avoid floating-point representation issues
      }
      value = String(value);
    }

    return FixedDecimal._parseString(value);
  }

  private static _parseString(s: string): FixedDecimal {
    const trimmed = s.trim();
    if (trimmed === "") throw new SyntaxError("FixedDecimal.from: empty string");

    // Validate: optional sign, digits, optional dot + digits
    // No scientific notation, no trailing chars
    const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(trimmed);
    if (!match) {
      throw new SyntaxError(`FixedDecimal.from: invalid decimal string "${s}"`);
    }

    const sign = match[1] === "-" ? -1n : 1n;
    const intPart = BigInt(match[2]);
    const fracStr = match[3] ?? "";

    // Pad or truncate fraction to 6 digits
    let fracPadded: string;
    if (fracStr.length <= 6) {
      fracPadded = fracStr.padEnd(6, "0");
    } else {
      // Truncate (no rounding on parse — caller should provide precise values)
      fracPadded = fracStr.slice(0, 6);
    }

    const fracPart = BigInt(fracPadded);
    const raw = sign * (intPart * SCALE + fracPart);
    return new FixedDecimal(raw);
  }

  static zero(): FixedDecimal {
    return new FixedDecimal(0n);
  }

  static fromRaw(raw: bigint): FixedDecimal {
    return new FixedDecimal(raw);
  }

  // ── Arithmetic ─────────────────────────────────────────────────────────────

  add(other: FixedDecimal): FixedDecimal {
    return new FixedDecimal(this.raw + other.raw);
  }

  sub(other: FixedDecimal): FixedDecimal {
    return new FixedDecimal(this.raw - other.raw);
  }

  /**
   * Multiply two fixed-point values: (a * SCALE) * (b * SCALE) / SCALE
   * Uses half-away-from-zero rounding.
   */
  mul(other: FixedDecimal): FixedDecimal {
    const product = this.raw * other.raw;
    return new FixedDecimal(divHalfAwayFromZero(product, SCALE));
  }

  /**
   * Divide: (a * SCALE) / b  (keeping scale)
   * Uses half-away-from-zero rounding.
   */
  div(other: FixedDecimal): FixedDecimal {
    if (other.raw === 0n) throw new RangeError("FixedDecimal: division by zero");
    const numerator = this.raw * SCALE;
    return new FixedDecimal(divHalfAwayFromZero(numerator, other.raw));
  }

  /**
   * Compute percentage: this * percent / 100
   */
  percent(pct: FixedDecimal): FixedDecimal {
    const hundred = new FixedDecimal(100n * SCALE);
    return this.mul(pct).div(hundred);
  }

  isZero(): boolean {
    return this.raw === 0n;
  }

  isNegative(): boolean {
    return this.raw < 0n;
  }

  isPositive(): boolean {
    return this.raw > 0n;
  }

  greaterThan(other: FixedDecimal): boolean {
    return this.raw > other.raw;
  }

  lessThan(other: FixedDecimal): boolean {
    return this.raw < other.raw;
  }

  abs(): FixedDecimal {
    return new FixedDecimal(this.raw < 0n ? -this.raw : this.raw);
  }

  neg(): FixedDecimal {
    return new FixedDecimal(-this.raw);
  }

  // ── Formatting ─────────────────────────────────────────────────────────────

  /**
   * Format to exactly `decimals` decimal places (2 or 6 supported).
   * Rounding: half-away-from-zero.
   */
  toFixed(decimals: 2 | 6): string {
    const scaleFactor = 10n ** BigInt(decimals);
    const scaleRemainder = SCALE / scaleFactor; // how many sub-units per output unit

    const rounded = divHalfAwayFromZero(this.raw, scaleRemainder);
    const isNeg = rounded < 0n;
    const abs = isNeg ? -rounded : rounded;

    const intPart = abs / scaleFactor;
    const fracPart = abs % scaleFactor;

    const fracStr = fracPart.toString().padStart(decimals, "0");
    return `${isNeg ? "-" : ""}${intPart}.${fracStr}`;
  }

  toString(): string {
    return this.toFixed(6);
  }
}

/**
 * Integer division with half-away-from-zero rounding.
 * Works for both positive and negative values.
 */
export function divHalfAwayFromZero(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) throw new RangeError("divHalfAwayFromZero: division by zero");

  const sign = (numerator < 0n) !== (denominator < 0n) ? -1n : 1n;
  const absNum = numerator < 0n ? -numerator : numerator;
  const absDen = denominator < 0n ? -denominator : denominator;

  // Round half away from zero: add half of denominator before dividing
  const rounded = (absNum * 2n + absDen) / (absDen * 2n);
  return sign * rounded;
}
