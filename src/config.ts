import type { Category, Rule } from './domain/types';

// スプレッドシートの作成・読み書きのみ。最小権限に絞る。
export const OAUTH_SCOPES = 'https://www.googleapis.com/auth/spreadsheets';

export const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? '';
export const SPREADSHEET_TITLE = import.meta.env.VITE_SPREADSHEET_TITLE ?? 'CardLedger Data';

/** localStorage キー */
export const LS = {
  spreadsheetId: 'cardledger.spreadsheetId',
  geminiKey: 'cardledger.geminiKey',
  aiComment: 'cardledger.aiComment', // { date: 'YYYY-MM-DD', text: string }
} as const;

/** Sheets のタブ名 */
export const SHEET = {
  transactions: 'transactions',
  points: 'points',
  categories: 'categories',
  rules: 'rules',
  meta: 'meta',
} as const;

/** 各シートのヘッダ（列順＝この順で読み書きする） */
export const HEADERS = {
  transactions: ['txId', 'date', 'datetime', 'amount', 'merchant', 'card', 'payType', 'user', 'category'],
  points: ['pid', 'date', 'merchant', 'points', 'source'],
  categories: ['name', 'icon', 'color', 'sortOrder', 'active'],
  rules: ['keyword', 'category', 'priority', 'hitCount', 'learned'],
  meta: ['key', 'value'],
} as const;

/** 家計簿標準カテゴリ＋会社経費（初回シード） */
export const DEFAULT_CATEGORIES: Category[] = [
  { name: '食費', icon: '🍚', color: '#10b981', sortOrder: 1, active: true },
  { name: '日用品', icon: '🧺', color: '#38bdf8', sortOrder: 2, active: true },
  { name: '交通費', icon: '🚃', color: '#fbbf24', sortOrder: 3, active: true },
  { name: '趣味娯楽', icon: '🎮', color: '#a78bfa', sortOrder: 4, active: true },
  { name: '通信費', icon: '📶', color: '#fb7185', sortOrder: 5, active: true },
  { name: '光熱費', icon: '💡', color: '#f97316', sortOrder: 6, active: true },
  { name: '医療', icon: '💊', color: '#ef4444', sortOrder: 7, active: true },
  { name: '衣服', icon: '👕', color: '#ec4899', sortOrder: 8, active: true },
  { name: '交際費', icon: '🍻', color: '#14b8a6', sortOrder: 9, active: true },
  { name: 'サブスク', icon: '🔁', color: '#6366f1', sortOrder: 10, active: true },
  { name: '会社経費', icon: '💼', color: '#2563eb', sortOrder: 11, active: true },
  { name: 'その他', icon: '📦', color: '#94a3b8', sortOrder: 12, active: true },
];

/** 未分類表示用の色/アイコン */
export const UNCLASSIFIED_STYLE = { icon: '❓', color: '#cbd5e1' };

/** 予測ルール初期辞書 */
export const DEFAULT_RULES: Rule[] = (
  [
    ['セブンイレブン', '食費'], ['ローソン', '食費'], ['ファミリーマート', '食費'],
    ['スーパー', '食費'], ['マクドナルド', '食費'], ['スターバックス', '食費'],
    ['ドトール', '食費'], ['イオン', '食費'],
    ['ドラッグ', '日用品'], ['マツモトキヨシ', '日用品'], ['ニトリ', '日用品'], ['ダイソー', '日用品'],
    ['JR', '交通費'], ['ＥＴＣ', '交通費'], ['ENEOS', '交通費'], ['タクシー', '交通費'], ['Suica', '交通費'],
    ['Amazon', '趣味娯楽'], ['楽天', '趣味娯楽'], ['ヨドバシ', '趣味娯楽'], ['Steam', '趣味娯楽'],
    ['ドコモ', '通信費'], ['ソフトバンク', '通信費'],
    ['東京電力', '光熱費'], ['東京ガス', '光熱費'],
    ['薬局', '医療'], ['クリニック', '医療'], ['病院', '医療'],
    ['ユニクロ', '衣服'], ['GU', '衣服'], ['ZOZO', '衣服'],
    ['Netflix', 'サブスク'], ['Spotify', 'サブスク'], ['Adobe', 'サブスク'],
  ] as const
).map(([keyword, category], i, arr) => ({
  keyword,
  category,
  priority: arr.length - i,
  hitCount: 0,
  learned: false,
}));
