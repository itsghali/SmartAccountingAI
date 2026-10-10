import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { calculateLinearAmortization, calculateDegressiveAmortization } from "./amortization";

describe("Amortization Calculations", () => {
  describe("Linear Amortization", () => {
    it("calculates full years correctly", () => {
      const input = {
        acquisitionValue: new Decimal(10000),
        residualValue: new Decimal(0),
        commissioningDate: new Date("2024-01-01"),
        usefulLifeYears: 5,
        method: "LINEAR" as const,
      };

      const lines = calculateLinearAmortization(input);
      expect(lines).toHaveLength(5);
      expect(lines[0]!.dotation.toNumber()).toBe(2000);
      expect(lines[0]!.isProrata).toBe(false);
      expect(lines[4]!.cumulative.toNumber()).toBe(10000);
      expect(lines[4]!.closingNetValue.toNumber()).toBe(0);
    });

    it("calculates prorata temporis correctly", () => {
      const input = {
        acquisitionValue: new Decimal(12000),
        residualValue: new Decimal(0),
        commissioningDate: new Date("2024-07-01"),
        usefulLifeYears: 5,
        method: "LINEAR" as const,
      };

      const lines = calculateLinearAmortization(input);
      expect(lines).toHaveLength(6); // 5 years + prorated last year
      expect(lines[0]!.dotation.toNumber()).toBe(1200); // 6 months (July-Dec) = 1/2 of 2400
      expect(lines[0]!.isProrata).toBe(true);
      expect(lines[5]!.dotation.toNumber()).toBe(1200); // Remaining 6 months
      expect(lines[5]!.closingNetValue.toNumber()).toBe(0);
    });
  });

  describe("Degressive Amortization", () => {
    it("switches to linear when linear > degressive", () => {
      const input = {
        acquisitionValue: new Decimal(10000),
        residualValue: new Decimal(0),
        commissioningDate: new Date("2024-01-01"),
        usefulLifeYears: 5,
        method: "DEGRESSIVE" as const,
        degressiveCoefficient: new Decimal(2),
      };

      const lines = calculateDegressiveAmortization(input);
      // Rate = (1/5) * 2 = 40%
      // Year 1: 10000 * 40% = 4000
      expect(lines[0]!.dotation.toNumber()).toBe(4000);
      
      // Year 2: VNC=6000. Degressive=2400, Linear=6000/4=1500 -> 2400
      expect(lines[1]!.dotation.toNumber()).toBe(2400);

      // Final closing value should be 0
      expect(lines[lines.length - 1]!.closingNetValue.toNumber()).toBe(0);
    });
  });
});
