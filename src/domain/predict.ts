import type { CategoryName, Rule } from './types';
import { UNCLASSIFIED } from './types';

/**
 * 店舗名からカテゴリを予測する。priority 降順で最初に一致したルールを採用。
 * 一致なしは UNCLASSIFIED。
 */
export function predictCategory(merchant: string, rules: readonly Rule[]): CategoryName {
  const sorted = [...rules].sort((a, b) => b.priority - a.priority);
  for (const r of sorted) {
    if (r.keyword && merchant.includes(r.keyword)) return r.category;
  }
  return UNCLASSIFIED;
}

/**
 * 手修正されたカテゴリから学習キーワードを導出する。
 * 店舗名の先頭の和名トークン（英数・記号・「店」以降を落とす）を採用。
 * 例: "セブンイレブン渋谷店" → "セブンイレブン", "Amazon.co.jp" → "Amazon"
 */
export function deriveKeyword(merchant: string): string {
  const trimmed = merchant.trim();
  // 全角/半角英数の連続、空白、括弧、ハイフン、"店"以降を除去
  const head = trimmed.replace(/[ -\/:-@\[-`{-~　（）()0-9A-Za-zＡ-Ｚａ-ｚ０-９店].*$/u, '');
  return head || trimmed.slice(0, 4);
}

/**
 * 手修正を受けてルール集合を更新する（純粋関数：新しい配列を返す）。
 * - 同一キーワードが既にあれば hitCount を加算しカテゴリを更新。
 * - なければ learned ルールとして追加。
 */
export function learnFromCorrection(
  rules: readonly Rule[],
  merchant: string,
  category: CategoryName,
): { rules: Rule[]; keyword: string } {
  const keyword = deriveKeyword(merchant);
  if (!keyword || category === UNCLASSIFIED) return { rules: [...rules], keyword };

  const idx = rules.findIndex((r) => r.keyword === keyword);
  if (idx >= 0) {
    const next = [...rules];
    const existing = next[idx];
    if (existing) {
      next[idx] = { ...existing, category, hitCount: existing.hitCount + 1, learned: true };
    }
    return { rules: next, keyword };
  }
  const maxPriority = rules.reduce((m, r) => Math.max(m, r.priority), 0);
  return {
    rules: [
      { keyword, category, priority: maxPriority + 1, hitCount: 1, learned: true },
      ...rules,
    ],
    keyword,
  };
}
