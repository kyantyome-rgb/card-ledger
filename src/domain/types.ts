// ドメイン型定義。Sheets の各シート1行が各型1件に対応する。

/** 仕訳カテゴリ名（マスタで増減しうるため string 別名で表現） */
export type CategoryName = string;

/** 未分類を表す予約カテゴリ名 */
export const UNCLASSIFIED = '未分類' as const;

/** カード利用明細1件（取引内容="支払い"） */
export interface Transaction {
  /** 取引番号（PayPay CSV M列）＝ユニークキー */
  txId: string;
  /** 取引日 YYYY-MM-DD */
  date: string;
  /** 取引日時 ISO（時刻まで保持。集計は date を使用） */
  datetime: string;
  /** 利用額（円、出金金額） */
  amount: number;
  /** 取引先（店舗名） */
  merchant: string;
  /** 取引方法（例: クレジット VISA 2170 / PayPayカード ゴールド） */
  card: string;
  /** 支払い区分（例: 一回払い） */
  payType: string;
  /** 利用者（家族 / 本人） */
  user: string;
  /** 仕訳カテゴリ */
  category: CategoryName;
}

/** 獲得ポイント1件（取引内容="ポイント、残高の獲得"） */
export interface PointEntry {
  /** 取引番号＝ユニークキー */
  pid: string;
  /** 獲得日 YYYY-MM-DD */
  date: string;
  /** 獲得元（取引先） */
  merchant: string;
  /** 獲得ポイント（入金金額） */
  points: number;
  /** 種別（取引方法。例: PayPayポイント） */
  source: string;
}

/** 仕訳カテゴリマスタ */
export interface Category {
  name: CategoryName;
  icon: string;
  color: string;
  sortOrder: number;
  active: boolean;
}

/** カテゴリ予測ルール（キーワード部分一致） */
export interface Rule {
  /** 店舗名に含まれると一致するキーワード */
  keyword: string;
  category: CategoryName;
  /** 数値が大きいほど優先 */
  priority: number;
  /** 一致回数（学習の参考） */
  hitCount: number;
  /** 手修正により学習されたルールか */
  learned: boolean;
}

/** CSV解析結果 */
export interface ParseResult {
  transactions: Transaction[];
  points: PointEntry[];
  /** ヘッダから列を特定できず固定インデックスにフォールバックしたか */
  usedFallback: boolean;
}
