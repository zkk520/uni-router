import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}


function formatNumber(num: number | undefined, compare: number[], units: string[]): { value: string, unit: string } {
  if (num === undefined) return { value: "0.00", unit: units[0] };
  else if (num >= compare[0]) return { value: (num / compare[0]).toFixed(2), unit: units[1] };
  else if (num >= compare[1]) return { value: (num / compare[1]).toFixed(2), unit: units[2] };
  else if (num >= compare[2]) return { value: (num / compare[2]).toFixed(2), unit: units[3] };
  else if (num >= compare[3]) return { value: (num / compare[3]).toFixed(2), unit: units[4] };
  else return { value: (num).toFixed(2), unit: units[5] };
}

export function formatCount(num: number | undefined): { raw: number, formatted: { value: string, unit: string } } {
  return {
    raw: num ?? 0,
    formatted: formatNumber(num, [1000000000, 1000000, 1000, 1], ['', 'B', 'M', 'K', '', '']),
  };
}
export function formatMoney(num: number | undefined): { raw: number, formatted: { value: string, unit: string } } {
  return {
    raw: num ?? 0,
    formatted: formatNumber(num, [1000000000, 1000000, 1000, 1], ['¥', 'B¥', 'M¥', 'K¥', '¥', '¥']),
  };
}

export function formatMoneyWithSymbol(num: number | undefined, symbol = '$'): { raw: number, formatted: { value: string, unit: string } } {
  return {
    raw: num ?? 0,
    formatted: formatNumber(num, [1000000000, 1000000, 1000, 1], [symbol, `B${symbol}`, `M${symbol}`, `K${symbol}`, symbol, symbol]),
  };
}

export type CostCurrencyMetrics = {
  currency: string;
  currency_symbol: string;
  input_cost: number;
  output_cost: number;
  total_cost: number;
};

export function formatCurrencyCosts(
  costs: Record<string, CostCurrencyMetrics> | undefined,
  fallback?: number,
): ReturnType<typeof formatMoney> {
  const values = Object.values(costs ?? {}).filter((item) => Math.abs(item.total_cost) > 0);
  if (values.length === 0) {
    return formatMoney(fallback ?? 0);
  }
  const display = values
    .sort((a, b) => a.currency.localeCompare(b.currency))
    .map((item) => {
      const formatted = formatMoneyWithSymbol(item.total_cost, item.currency_symbol || item.currency);
      return `${formatted.formatted.value}${formatted.formatted.unit}`;
    })
    .join(' / ');
  return {
    raw: fallback ?? values.reduce((sum, item) => sum + item.total_cost, 0),
    formatted: { value: display, unit: '' },
  };
}

export function formatTime(ms: number | undefined): { raw: number, formatted: { value: string, unit: string } } {
  return {
    raw: ms ?? 0,
    formatted: formatNumber(ms, [86400000, 3600000, 60000, 1000], ['', 'd', 'h', 'm', 's', 'ms']),
  };
}
