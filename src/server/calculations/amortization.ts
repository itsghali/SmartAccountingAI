import Decimal from "decimal.js";

export interface AmortizationLine {
  year: number;
  periodStart: Date;
  periodEnd: Date;
  openingValue: Decimal;
  dotation: Decimal;
  cumulative: Decimal;
  closingNetValue: Decimal;
  isProrata: boolean;
}

export interface AmortizationInput {
  acquisitionValue: Decimal;
  residualValue: Decimal;
  commissioningDate: Date;
  usefulLifeYears: number;
  method: "LINEAR" | "DEGRESSIVE";
  degressiveCoefficient?: Decimal;
  fiscalYearStart?: Date; // Usually Jan 1
}

function getMonthsInFirstYear(commissioningDate: Date): number {
  const month = commissioningDate.getMonth(); // 0-indexed
  return 12 - month;
}

export function calculateLinearAmortization(input: AmortizationInput): AmortizationLine[] {
  const lines: AmortizationLine[] = [];
  const amortizableBase = input.acquisitionValue.minus(input.residualValue);
  const annualDotation = amortizableBase.div(input.usefulLifeYears);

  const firstYearMonths = getMonthsInFirstYear(input.commissioningDate);
  const firstYearDotation = annualDotation.mul(firstYearMonths).div(12);

  let cumulative = new Decimal(0);
  let vnc = new Decimal(amortizableBase);

  const commYear = input.commissioningDate.getFullYear();

  // First year (prorata)
  cumulative = cumulative.plus(firstYearDotation);
  vnc = vnc.minus(firstYearDotation);
  lines.push({
    year: 1,
    periodStart: input.commissioningDate,
    periodEnd: new Date(commYear, 11, 31),
    openingValue: new Decimal(amortizableBase),
    dotation: firstYearDotation,
    cumulative: new Decimal(cumulative),
    closingNetValue: new Decimal(vnc),
    isProrata: firstYearMonths < 12,
  });

  // Full years
  for (let i = 2; i <= input.usefulLifeYears; i++) {
    const yearStart = new Date(commYear + i - 1, 0, 1);
    const yearEnd = new Date(commYear + i - 1, 11, 31);
    const openingValue = new Decimal(vnc);

    cumulative = cumulative.plus(annualDotation);
    vnc = vnc.minus(annualDotation);

    lines.push({
      year: i,
      periodStart: yearStart,
      periodEnd: yearEnd,
      openingValue,
      dotation: new Decimal(annualDotation),
      cumulative: new Decimal(cumulative),
      closingNetValue: Decimal.max(vnc, 0),
      isProrata: false,
    });
  }

  // Last year complement (if first year was prorated)
  if (firstYearMonths < 12) {
    const lastYearDotation = annualDotation.minus(firstYearDotation);
    const openingValue = new Decimal(vnc);
    cumulative = cumulative.plus(lastYearDotation);
    vnc = new Decimal(0);

    lines.push({
      year: input.usefulLifeYears + 1,
      periodStart: new Date(commYear + input.usefulLifeYears, 0, 1),
      periodEnd: new Date(commYear + input.usefulLifeYears, input.commissioningDate.getMonth() - 1, 31),
      openingValue,
      dotation: lastYearDotation,
      cumulative: new Decimal(cumulative),
      closingNetValue: new Decimal(0),
      isProrata: true,
    });
  }

  return lines;
}

export function calculateDegressiveAmortization(input: AmortizationInput): AmortizationLine[] {
  const lines: AmortizationLine[] = [];
  const amortizableBase = input.acquisitionValue.minus(input.residualValue);
  const coefficient = input.degressiveCoefficient || new Decimal("1.5");
  const degressiveRate = new Decimal(1).div(input.usefulLifeYears).mul(coefficient);

  let vnc = new Decimal(amortizableBase);
  let cumulative = new Decimal(0);

  const commYear = input.commissioningDate.getFullYear();
  const firstYearMonths = getMonthsInFirstYear(input.commissioningDate);

  for (let year = 1; year <= input.usefulLifeYears; year++) {
    const remainingYears = input.usefulLifeYears - year + 1;
    const degressiveDotation = vnc.mul(degressiveRate);
    const linearDotation = vnc.div(remainingYears);

    // Switch to linear when linear >= degressive
    let dotation = Decimal.max(degressiveDotation, linearDotation);

    // First year prorata
    if (year === 1 && firstYearMonths < 12) {
      dotation = dotation.mul(firstYearMonths).div(12);
    }

    // Don't exceed remaining value
    dotation = Decimal.min(dotation, vnc);

    const openingValue = new Decimal(vnc);
    cumulative = cumulative.plus(dotation);
    vnc = vnc.minus(dotation);

    lines.push({
      year,
      periodStart: year === 1 ? input.commissioningDate : new Date(commYear + year - 1, 0, 1),
      periodEnd: new Date(commYear + year - 1, 11, 31),
      openingValue,
      dotation,
      cumulative: new Decimal(cumulative),
      closingNetValue: Decimal.max(vnc, 0),
      isProrata: year === 1 && firstYearMonths < 12,
    });

    if (vnc.lte(0)) break;
  }

  return lines;
}
