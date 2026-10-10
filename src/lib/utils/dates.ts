import { format, isWithinInterval, differenceInMonths } from "date-fns";
import { fr } from "date-fns/locale";

export function formatDate(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return format(d, "dd/MM/yyyy", { locale: fr });
}

export function formatDateLong(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return format(d, "dd MMMM yyyy", { locale: fr });
}

/** Affiche uniquement le mois et l'année — ex: "05/2026" */
export function formatMonth(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return format(d, "MM/yyyy", { locale: fr });
}

export function isDateInFiscalYear(
  date: Date,
  startDate: Date,
  endDate: Date
): boolean {
  return isWithinInterval(date, { start: startDate, end: endDate });
}

export function getFiscalYearDuration(startDate: Date, endDate: Date): number {
  return differenceInMonths(endDate, startDate) + 1;
}

export function getMonthlyPeriodDates(
  fiscalYearStart: Date,
  periodIndex: number // 1-12
): { startDate: Date; endDate: Date } {
  const year = fiscalYearStart.getFullYear();
  const month = fiscalYearStart.getMonth() + periodIndex - 1;
  const startDate = new Date(year, month, 1);
  const endDate = new Date(year, month + 1, 0); // Last day of month
  return { startDate, endDate };
}

export function getQuarterlyPeriodDates(
  fiscalYearStart: Date,
  periodIndex: number // 1-4
): { startDate: Date; endDate: Date } {
  const year = fiscalYearStart.getFullYear();
  const startMonth = fiscalYearStart.getMonth() + (periodIndex - 1) * 3;
  const startDate = new Date(year, startMonth, 1);
  const endDate = new Date(year, startMonth + 3, 0);
  return { startDate, endDate };
}
