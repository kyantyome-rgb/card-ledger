import type { Category } from '../domain/types';
import { UNCLASSIFIED } from '../domain/types';
import { UNCLASSIFIED_STYLE } from '../config';

export const yen = (n: number): string => '¥' + Math.round(n).toLocaleString('ja-JP');

export interface CatStyle {
  icon: string;
  color: string;
}

/** カテゴリ名から表示スタイルを引く（未知/未分類はフォールバック） */
export function catStyle(name: string, categories: readonly Category[]): CatStyle {
  if (name === UNCLASSIFIED) return UNCLASSIFIED_STYLE;
  const c = categories.find((x) => x.name === name);
  return c ? { icon: c.icon, color: c.color } : UNCLASSIFIED_STYLE;
}

/** HTML エスケープ（店舗名など外部由来文字列の埋め込み用） */
export function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 今日の YYYY-MM-DD（ローカル） */
export function todayStr(): string {
  const d = new Date();
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
