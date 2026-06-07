import { getAccessToken } from '../auth/gis';

const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';

export class SheetsApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'SheetsApiError';
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const token = await getAccessToken();
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new SheetsApiError(`Sheets API ${res.status}: ${text}`, res.status);
  }
  return (await res.json()) as T;
}

/** 値は文字列・数値・真偽のいずれか（Sheets の cell value） */
export type CellValue = string | number | boolean;

interface ValueRange {
  range?: string;
  majorDimension?: string;
  values?: CellValue[][];
}

/** 単一範囲の値を取得（空なら []） */
export async function getValues(spreadsheetId: string, range: string): Promise<CellValue[][]> {
  const url = `${SHEETS_API}/${spreadsheetId}/values/${encodeURIComponent(range)}`;
  const data = await request<ValueRange>('GET', url);
  return data.values ?? [];
}

/** 範囲末尾に行を追記 */
export async function appendValues(
  spreadsheetId: string,
  range: string,
  rows: CellValue[][],
): Promise<void> {
  if (rows.length === 0) return;
  const url =
    `${SHEETS_API}/${spreadsheetId}/values/${encodeURIComponent(range)}:append` +
    `?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;
  await request('POST', url, { values: rows });
}

/** 範囲を上書き更新 */
export async function updateValues(
  spreadsheetId: string,
  range: string,
  rows: CellValue[][],
): Promise<void> {
  const url =
    `${SHEETS_API}/${spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=RAW`;
  await request('PUT', url, { values: rows });
}

/** 範囲をクリア */
export async function clearValues(spreadsheetId: string, range: string): Promise<void> {
  const url = `${SHEETS_API}/${spreadsheetId}/values/${encodeURIComponent(range)}:clear`;
  await request('POST', url, {});
}

/** 複数範囲を1リクエストで更新（一括カテゴリ変更などに使用） */
export async function batchUpdateValues(
  spreadsheetId: string,
  data: { range: string; values: CellValue[][] }[],
): Promise<void> {
  if (data.length === 0) return;
  const url = `${SHEETS_API}/${spreadsheetId}/values:batchUpdate`;
  await request('POST', url, { valueInputOption: 'RAW', data });
}

interface CreateResponse {
  spreadsheetId: string;
}

/** 指定タイトル・タブ群でスプレッドシートを新規作成し ID を返す */
export async function createSpreadsheet(title: string, sheetTitles: string[]): Promise<string> {
  const data = await request<CreateResponse>('POST', SHEETS_API, {
    properties: { title },
    sheets: sheetTitles.map((t) => ({ properties: { title: t } })),
  });
  return data.spreadsheetId;
}

interface SpreadsheetMeta {
  sheets?: { properties?: { title?: string } }[];
}

/** スプレッドシートが存在し読めるか確認し、含まれるタブ名一覧を返す */
export async function getSheetTitles(spreadsheetId: string): Promise<string[]> {
  const url = `${SHEETS_API}/${spreadsheetId}?fields=sheets.properties.title`;
  const data = await request<SpreadsheetMeta>('GET', url);
  return (data.sheets ?? []).map((s) => s.properties?.title ?? '').filter(Boolean);
}

/** 既存スプレッドシートにタブを追加 */
export async function addSheets(spreadsheetId: string, sheetTitles: string[]): Promise<void> {
  if (sheetTitles.length === 0) return;
  const url = `${SHEETS_API}/${spreadsheetId}:batchUpdate`;
  await request('POST', url, {
    requests: sheetTitles.map((t) => ({ addSheet: { properties: { title: t } } })),
  });
}
