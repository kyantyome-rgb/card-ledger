import { LS } from '../config';

const MODEL = 'gemini-2.0-flash';
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

/** 月次サマリー（集計結果から組み立てて渡す） */
export interface AiSummary {
  year: number;
  month: number;
  yearTotal: number;
  monthTotal: number;
  prevMonthTotal: number;
  topCategories: { category: string; amount: number; ratio: number }[];
  monthlySeries: number[];
  pointsYear: number;
  pointsMonth: number;
}

export function getGeminiKey(): string {
  return localStorage.getItem(LS.geminiKey) ?? '';
}
export function setGeminiKey(key: string): void {
  localStorage.setItem(LS.geminiKey, key.trim());
}

interface CachedComment {
  date: string;
  text: string;
}

function readCache(): CachedComment | null {
  const raw = localStorage.getItem(LS.aiComment);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === 'object' && parsed !== null &&
      'date' in parsed && 'text' in parsed
    ) {
      return parsed as CachedComment;
    }
  } catch {
    /* 壊れたキャッシュは無視 */
  }
  return null;
}

function buildPrompt(s: AiSummary): string {
  const yen = (n: number): string => '¥' + n.toLocaleString('ja-JP');
  const tops = s.topCategories
    .slice(0, 5)
    .map((c) => `${c.category} ${yen(c.amount)}(${Math.round(c.ratio * 100)}%)`)
    .join('、');
  return [
    'あなたは家計分析アシスタントです。以下のカード利用データから、利用傾向を日本語で簡潔にコメントしてください。',
    '条件: 3文以内。具体的な数値に触れ、節約や見直しの示唆を1つ含める。マークダウン記法や箇条書きは使わず、地の文のみ。',
    '',
    `対象: ${s.year}年${s.month}月時点`,
    `年間合計: ${yen(s.yearTotal)} / 当月: ${yen(s.monthTotal)} / 前月: ${yen(s.prevMonthTotal)}`,
    `カテゴリ上位: ${tops}`,
    `月別推移(1月〜): ${s.monthlySeries.map(yen).join(', ')}`,
    `獲得ポイント 年間: ${s.pointsYear}pt / 当月: ${s.pointsMonth}pt`,
  ].join('\n');
}

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
}

/** Gemini を呼び出してコメントを生成（キャッシュは扱わない素の生成） */
export async function generateInsight(summary: AiSummary): Promise<string> {
  const key = getGeminiKey();
  if (!key) throw new Error('Gemini API キーが未設定です（設定画面で入力してください）');

  const res = await fetch(`${ENDPOINT}?key=${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: buildPrompt(summary) }] }],
      generationConfig: { temperature: 0.7, maxOutputTokens: 256 },
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Gemini API ${res.status}: ${text}`);
  }
  const data = (await res.json()) as GeminiResponse;
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
  if (!text) throw new Error('Gemini からの応答が空でした');
  return text;
}

/**
 * 当日キャッシュがあればそれを返し、なければ生成して保存（1日1回）。
 * キー未設定やエラー時は null を返す（呼び出し側でフォールバック表示）。
 */
export async function getDailyInsight(
  today: string,
  summary: AiSummary,
): Promise<string | null> {
  const cached = readCache();
  if (cached && cached.date === today) return cached.text;
  if (!getGeminiKey()) return null;
  try {
    const text = await generateInsight(summary);
    localStorage.setItem(LS.aiComment, JSON.stringify({ date: today, text }));
    return text;
  } catch {
    return cached?.text ?? null;
  }
}
