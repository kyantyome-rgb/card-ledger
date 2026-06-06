import type { ParseResult, Transaction, PointEntry } from './types';
import { UNCLASSIFIED } from './types';

/** 引用符対応のCSV1行パーサ（カンマ入り金額 "2,164" に対応） */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        cur += c;
      }
    } else if (c === ',') {
      out.push(cur);
      cur = '';
    } else if (c === '"') {
      quoted = true;
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out;
}

/** "2,164" / " 30 " / "-" → 数値（空や非数は0） */
export function toNumber(s: string | undefined): number {
  if (!s) return 0;
  const n = Number(s.replace(/[,\s]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

/** PayPayカード明細CSVの列マッピング */
interface ColumnMap {
  date: number;
  out: number;
  in: number;
  type: number;
  merchant: number;
  method: number;
  payType: number;
  user: number;
  txId: number;
}

const FALLBACK: ColumnMap = {
  date: 0,
  out: 1,
  in: 2,
  type: 7,
  merchant: 8,
  method: 9,
  payType: 10,
  user: 11,
  txId: 12,
};

/** ヘッダ行から列位置を特定。1つでも欠ければ固定インデックスにフォールバック */
function resolveColumns(header: string[]): { map: ColumnMap; fallback: boolean } {
  const find = (pred: (h: string) => boolean): number => header.findIndex(pred);
  const map: ColumnMap = {
    date: find((h) => h.includes('取引日')),
    out: find((h) => h.includes('出金金額') && !h.includes('海外')),
    in: find((h) => h.includes('入金金額')),
    type: find((h) => h.includes('取引内容')),
    merchant: find((h) => h.includes('取引先')),
    method: find((h) => h.includes('取引方法')),
    payType: find((h) => h.includes('支払') && h.includes('区分')),
    user: find((h) => h.includes('利用者')),
    txId: find((h) => h.includes('取引番号')),
  };
  const ok = Object.values(map).every((i) => i >= 0);
  return ok ? { map, fallback: false } : { map: FALLBACK, fallback: true };
}

const clean = (s: string | undefined): string => (s ?? '').trim();

/** 取引内容が「支払い」かどうか */
const isPayment = (type: string): boolean => type.includes('支払');

/** 取引内容がポイント/残高の獲得かどうか */
const isPointGain = (type: string): boolean => type.includes('ポイント') || type.includes('獲得');

/**
 * PayPayカード明細CSVを解析する。
 * - 「支払い」行のみ Transaction に。
 * - 「ポイント、残高の獲得」行は PointEntry に（入金金額をポイントとして取込）。
 * - ファイル内の取引番号重複は除去（最初の1件を採用）。
 * カテゴリ予測は呼び出し側で適用する（ここでは UNCLASSIFIED 固定）。
 */
export function parsePayPayCsv(text: string): ParseResult {
  const lines = text.replace(/^﻿/, '').trim().split(/\r?\n/);
  if (lines.length <= 1) return { transactions: [], points: [], usedFallback: false };

  const header = splitCsvLine(lines[0] ?? '');
  const { map, fallback } = resolveColumns(header);

  const transactions: Transaction[] = [];
  const points: PointEntry[] = [];
  const seenTx = new Set<string>();
  const seenPt = new Set<string>();

  for (let i = 1; i < lines.length; i++) {
    const raw = lines[i];
    if (!raw || !raw.trim()) continue;
    const c = splitCsvLine(raw);
    const type = clean(c[map.type]);
    const rawDate = clean(c[map.date]);
    const date = rawDate.slice(0, 10).replace(/\//g, '-');
    const txId = clean(c[map.txId]);

    if (isPayment(type)) {
      if (!txId || seenTx.has(txId)) continue;
      seenTx.add(txId);
      transactions.push({
        txId,
        date,
        datetime: rawDate.replace(/\//g, '-'),
        amount: toNumber(c[map.out]),
        merchant: clean(c[map.merchant]),
        card: clean(c[map.method]),
        payType: clean(c[map.payType]),
        user: clean(c[map.user]) === '' || clean(c[map.user]) === '-' ? '本人' : clean(c[map.user]),
        category: UNCLASSIFIED,
      });
    } else if (isPointGain(type)) {
      const pts = toNumber(c[map.in]);
      if (pts <= 0 || !txId || seenPt.has(txId)) continue;
      seenPt.add(txId);
      points.push({
        pid: txId,
        date,
        merchant: clean(c[map.merchant]),
        points: pts,
        source: clean(c[map.method]),
      });
    }
  }

  return { transactions, points, usedFallback: fallback };
}
