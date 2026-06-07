import {
  SHEET,
  HEADERS,
  SPREADSHEET_TITLE,
  DEFAULT_CATEGORIES,
  DEFAULT_RULES,
  LS,
} from '../config';
import type { Transaction, PointEntry, Category, Rule } from '../domain/types';
import {
  getValues,
  appendValues,
  updateValues,
  clearValues,
  batchUpdateValues,
  createSpreadsheet,
  getSheetTitles,
  addSheets,
  type CellValue,
} from './client';

// ---- 値変換ヘルパ ----
const num = (v: CellValue | undefined): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const str = (v: CellValue | undefined): string => (v == null ? '' : String(v));
const bool = (v: CellValue | undefined): boolean => v === true || v === 'TRUE' || v === 'true';

// ---- 行 ↔ オブジェクト ----
const txToRow = (t: Transaction): CellValue[] => [
  t.txId, t.date, t.datetime, t.amount, t.merchant, t.card, t.payType, t.user, t.category,
];
const rowToTx = (r: CellValue[]): Transaction => ({
  txId: str(r[0]), date: str(r[1]), datetime: str(r[2]), amount: num(r[3]),
  merchant: str(r[4]), card: str(r[5]), payType: str(r[6]), user: str(r[7]), category: str(r[8]),
});

const ptToRow = (p: PointEntry): CellValue[] => [p.pid, p.date, p.merchant, p.points, p.source];
const rowToPt = (r: CellValue[]): PointEntry => ({
  pid: str(r[0]), date: str(r[1]), merchant: str(r[2]), points: num(r[3]), source: str(r[4]),
});

const catToRow = (c: Category): CellValue[] => [
  c.name, c.icon, c.color, c.sortOrder, c.active ? 'TRUE' : 'FALSE',
];
const rowToCat = (r: CellValue[]): Category => ({
  name: str(r[0]), icon: str(r[1]), color: str(r[2]), sortOrder: num(r[3]), active: bool(r[4]),
});

const ruleToRow = (r: Rule): CellValue[] => [
  r.keyword, r.category, r.priority, r.hitCount, r.learned ? 'TRUE' : 'FALSE',
];
const rowToRule = (r: CellValue[]): Rule => ({
  keyword: str(r[0]), category: str(r[1]), priority: num(r[2]), hitCount: num(r[3]), learned: bool(r[4]),
});

// ---- ワークブック初期化 ----

/** 必要なら新規スプレッドシートを作成・初期化し、ID を localStorage に保存して返す */
export async function ensureWorkbook(): Promise<string> {
  const stored = localStorage.getItem(LS.spreadsheetId);
  if (stored) {
    // 既存IDの健全性を確認し、不足タブがあれば追加
    const titles = await getSheetTitles(stored);
    const missing = Object.values(SHEET).filter((t) => !titles.includes(t));
    if (missing.length > 0) {
      await addSheets(stored, missing);
      await seedSheets(stored, missing);
    }
    return stored;
  }

  const all = Object.values(SHEET);
  const id = await createSpreadsheet(SPREADSHEET_TITLE, all);
  await seedSheets(id, all);
  localStorage.setItem(LS.spreadsheetId, id);
  return id;
}

/** 指定タブにヘッダと初期データを書き込む */
async function seedSheets(id: string, sheets: string[]): Promise<void> {
  const tasks: Promise<void>[] = [];
  if (sheets.includes(SHEET.transactions)) {
    tasks.push(updateValues(id, `${SHEET.transactions}!A1`, [[...HEADERS.transactions]]));
  }
  if (sheets.includes(SHEET.points)) {
    tasks.push(updateValues(id, `${SHEET.points}!A1`, [[...HEADERS.points]]));
  }
  if (sheets.includes(SHEET.categories)) {
    tasks.push(
      updateValues(id, `${SHEET.categories}!A1`, [
        [...HEADERS.categories],
        ...DEFAULT_CATEGORIES.map(catToRow),
      ]),
    );
  }
  if (sheets.includes(SHEET.rules)) {
    tasks.push(
      updateValues(id, `${SHEET.rules}!A1`, [[...HEADERS.rules], ...DEFAULT_RULES.map(ruleToRow)]),
    );
  }
  if (sheets.includes(SHEET.meta)) {
    tasks.push(updateValues(id, `${SHEET.meta}!A1`, [[...HEADERS.meta]]));
  }
  await Promise.all(tasks);
}

// ---- 読み込み ----

export interface Workbook {
  transactions: Transaction[];
  points: PointEntry[];
  categories: Category[];
  rules: Rule[];
  meta: Map<string, string>;
}

export async function loadAll(id: string): Promise<Workbook> {
  const [txRows, ptRows, catRows, ruleRows, metaRows] = await Promise.all([
    getValues(id, `${SHEET.transactions}!A2:I`),
    getValues(id, `${SHEET.points}!A2:E`),
    getValues(id, `${SHEET.categories}!A2:E`),
    getValues(id, `${SHEET.rules}!A2:E`),
    getValues(id, `${SHEET.meta}!A2:B`),
  ]);
  const meta = new Map<string, string>();
  for (const r of metaRows) meta.set(str(r[0]), str(r[1]));
  return {
    transactions: txRows.filter((r) => r[0]).map(rowToTx),
    points: ptRows.filter((r) => r[0]).map(rowToPt),
    categories: catRows.filter((r) => r[0]).map(rowToCat),
    rules: ruleRows.filter((r) => r[0]).map(rowToRule),
    meta,
  };
}

// ---- 書き込み ----

export async function appendTransactions(id: string, txs: Transaction[]): Promise<void> {
  await appendValues(id, `${SHEET.transactions}!A1`, txs.map(txToRow));
}

export async function appendPoints(id: string, pts: PointEntry[]): Promise<void> {
  await appendValues(id, `${SHEET.points}!A1`, pts.map(ptToRow));
}

/** 取引番号で行を特定し category 列（I列）を更新 */
export async function setTransactionCategory(
  id: string,
  txId: string,
  category: string,
): Promise<void> {
  const ids = await getValues(id, `${SHEET.transactions}!A2:A`);
  const idx = ids.findIndex((r) => str(r[0]) === txId);
  if (idx < 0) return;
  const rowNumber = idx + 2; // ヘッダ分+1、0始まり補正+1
  await updateValues(id, `${SHEET.transactions}!I${rowNumber}`, [[category]]);
}

/** 複数の取引のカテゴリを一括更新（取引番号→行を1回の読み取りで解決し batchUpdate） */
export async function setTransactionCategories(
  id: string,
  updates: { txId: string; category: string }[],
): Promise<void> {
  if (updates.length === 0) return;
  const ids = await getValues(id, `${SHEET.transactions}!A2:A`);
  const rowByTx = new Map<string, number>();
  ids.forEach((r, i) => {
    const v = str(r[0]);
    if (v) rowByTx.set(v, i + 2);
  });
  const data: { range: string; values: CellValue[][] }[] = [];
  for (const u of updates) {
    const row = rowByTx.get(u.txId);
    if (row) data.push({ range: `${SHEET.transactions}!I${row}`, values: [[u.category]] });
  }
  await batchUpdateValues(id, data);
}

/** ルール全体を書き換え（学習・追加の反映） */
export async function saveRules(id: string, rules: Rule[]): Promise<void> {
  await clearValues(id, `${SHEET.rules}!A2:E`);
  await updateValues(id, `${SHEET.rules}!A2`, rules.map(ruleToRow));
}

/** カテゴリマスタ全体を書き換え */
export async function saveCategories(id: string, categories: Category[]): Promise<void> {
  await clearValues(id, `${SHEET.categories}!A2:E`);
  await updateValues(id, `${SHEET.categories}!A2`, categories.map(catToRow));
}

export async function setMeta(id: string, key: string, value: string): Promise<void> {
  const rows = await getValues(id, `${SHEET.meta}!A2:A`);
  const idx = rows.findIndex((r) => str(r[0]) === key);
  if (idx >= 0) {
    await updateValues(id, `${SHEET.meta}!B${idx + 2}`, [[value]]);
  } else {
    await appendValues(id, `${SHEET.meta}!A1`, [[key, value]]);
  }
}
