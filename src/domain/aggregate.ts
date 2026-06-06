import type { Transaction, PointEntry, CategoryName } from './types';
import { UNCLASSIFIED } from './types';

const yearOf = (date: string): number => Number(date.slice(0, 4));
const monthOf = (date: string): number => Number(date.slice(5, 7));

/** 期間・カテゴリ・キーワード・利用者による明細フィルタ条件 */
export interface SearchFilter {
  keyword?: string;
  category?: CategoryName;
  from?: string; // YYYY-MM-DD
  to?: string; // YYYY-MM-DD
  user?: string;
}

export function filterTransactions(txs: readonly Transaction[], f: SearchFilter): Transaction[] {
  return txs.filter((t) => {
    if (f.keyword && !t.merchant.includes(f.keyword)) return false;
    if (f.category && t.category !== f.category) return false;
    if (f.user && t.user !== f.user) return false;
    if (f.from && t.date < f.from) return false;
    if (f.to && t.date > f.to) return false;
    return true;
  });
}

export const sum = (txs: readonly Transaction[]): number => txs.reduce((s, t) => s + t.amount, 0);

export function yearTotal(txs: readonly Transaction[], year: number): number {
  return sum(txs.filter((t) => yearOf(t.date) === year));
}

export function monthTotal(txs: readonly Transaction[], year: number, month: number): number {
  return sum(txs.filter((t) => yearOf(t.date) === year && monthOf(t.date) === month));
}

/** 1〜12月の合計配列（指定年） */
export function monthlySeries(txs: readonly Transaction[], year: number): number[] {
  const arr = Array.from({ length: 12 }, () => 0);
  for (const t of txs) {
    if (yearOf(t.date) !== year) continue;
    const m = monthOf(t.date);
    if (m >= 1 && m <= 12) arr[m - 1] = (arr[m - 1] ?? 0) + t.amount;
  }
  return arr;
}

/** カテゴリ別合計（指定年。未分類は除外オプション） */
export function categoryTotals(
  txs: readonly Transaction[],
  year: number,
  includeUnclassified = false,
): Map<CategoryName, number> {
  const m = new Map<CategoryName, number>();
  for (const t of txs) {
    if (yearOf(t.date) !== year) continue;
    if (!includeUnclassified && t.category === UNCLASSIFIED) continue;
    m.set(t.category, (m.get(t.category) ?? 0) + t.amount);
  }
  return m;
}

export interface CategoryShare {
  category: CategoryName;
  amount: number;
  ratio: number;
}

/** 構成比（降順） */
export function categoryShares(txs: readonly Transaction[], year: number): CategoryShare[] {
  const totals = categoryTotals(txs, year);
  const grand = [...totals.values()].reduce((s, v) => s + v, 0);
  return [...totals.entries()]
    .map(([category, amount]) => ({ category, amount, ratio: grand ? amount / grand : 0 }))
    .sort((a, b) => b.amount - a.amount);
}

export function topCategory(txs: readonly Transaction[], year: number): CategoryShare | undefined {
  return categoryShares(txs, year)[0];
}

/** 任意の明細集合のカテゴリ構成比（年で絞らない。未分類は除外） */
export function sharesOf(txs: readonly Transaction[]): CategoryShare[] {
  const m = new Map<CategoryName, number>();
  for (const t of txs) {
    if (t.category === UNCLASSIFIED) continue;
    m.set(t.category, (m.get(t.category) ?? 0) + t.amount);
  }
  const grand = [...m.values()].reduce((s, v) => s + v, 0);
  return [...m.entries()]
    .map(([category, amount]) => ({ category, amount, ratio: grand ? amount / grand : 0 }))
    .sort((a, b) => b.amount - a.amount);
}

// ---- ポイント集計 ----

export const sumPoints = (pts: readonly PointEntry[]): number =>
  pts.reduce((s, p) => s + p.points, 0);

export function pointsYearTotal(pts: readonly PointEntry[], year: number): number {
  return sumPoints(pts.filter((p) => yearOf(p.date) === year));
}

export function pointsMonthTotal(pts: readonly PointEntry[], year: number, month: number): number {
  return sumPoints(pts.filter((p) => yearOf(p.date) === year && monthOf(p.date) === month));
}

export function pointsMonthlySeries(pts: readonly PointEntry[], year: number): number[] {
  const arr = Array.from({ length: 12 }, () => 0);
  for (const p of pts) {
    if (yearOf(p.date) !== year) continue;
    const m = monthOf(p.date);
    if (m >= 1 && m <= 12) arr[m - 1] = (arr[m - 1] ?? 0) + p.points;
  }
  return arr;
}
