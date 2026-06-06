import type { Transaction, PointEntry, Category, Rule } from '../domain/types';
import { UNCLASSIFIED } from '../domain/types';
import {
  ensureWorkbook,
  loadAll,
  appendTransactions,
  appendPoints,
  setTransactionCategory,
  saveRules,
  saveCategories,
} from '../sheets/repo';
import { isSignedIn, signIn, signOut } from '../auth/gis';
import { parsePayPayCsv } from '../domain/csv';
import { predictCategory, learnFromCorrection } from '../domain/predict';
import {
  yearTotal,
  monthTotal,
  monthlySeries,
  categoryShares,
  sharesOf,
  topCategory,
  pointsYearTotal,
  pointsMonthTotal,
  pointsMonthlySeries,
} from '../domain/aggregate';
import { getDailyInsight, getGeminiKey, setGeminiKey, type AiSummary } from '../ai/gemini';
import { LS, DEFAULT_CATEGORIES, DEFAULT_RULES } from '../config';
import { yen, catStyle, esc, todayStr } from './format';

type TabId = 'home' | 'search' | 'points' | 'journal' | 'import' | 'settings';

interface State {
  id: string;
  tx: Transaction[];
  pts: PointEntry[];
  cats: Category[];
  rules: Rule[];
  tab: TabId;
  year: number;
}

const state: State = {
  id: '',
  tx: [],
  pts: [],
  cats: [],
  rules: [],
  tab: 'home',
  year: new Date().getFullYear(),
};

// インポートのステージング
interface StagedTx extends Transaction {
  dup: boolean;
}
interface StagedPt extends PointEntry {
  dup: boolean;
}
let staged: { tx: StagedTx[]; pts: StagedPt[] } = { tx: [], pts: [] };

// 一覧のページング（100件/ページ）
const PAGE = 100;
const pageState = { search: 0, journal: 0, points: 0 };

// 検索条件（年・月単位のシンプル検索）
interface SearchState {
  keyword: string;
  category: string;
  year: number;
  month: number; // 0 = すべて
}
const search: SearchState = { keyword: '', category: '', year: new Date().getFullYear(), month: 0 };

// ポイント履歴で表示中の年
let pointsYear = new Date().getFullYear();

const app = (): HTMLElement => {
  const el = document.getElementById('app');
  if (!el) throw new Error('#app not found');
  return el;
};

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

let charts: ChartInstance[] = [];
function destroyCharts(): void {
  for (const c of charts) c.destroy();
  charts = [];
}
function makeChart(id: string, config: ChartConfig): void {
  const el = document.getElementById(id);
  if (el instanceof HTMLCanvasElement) charts.push(new window.Chart(el, config));
}

let toastTimer = 0;
function toast(msg: string): void {
  let t = document.getElementById('toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'toast';
    t.className =
      'fixed bottom-24 left-1/2 -translate-x-1/2 px-5 py-3 rounded-2xl bg-slate-900 text-white text-sm font-semibold shadow-lg opacity-0 pointer-events-none transition z-50';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.style.opacity = '1';
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    if (t) t.style.opacity = '0';
  }, 2400);
}

// ============================ ユーティリティ（年/月・ページング） ============================

/** データに存在する年の一覧（降順、現在年は常に含む） */
function availableYears(dates: string[]): number[] {
  const set = new Set<number>();
  for (const d of dates) {
    const y = Number(d.slice(0, 4));
    if (y) set.add(y);
  }
  set.add(new Date().getFullYear());
  return [...set].sort((a, b) => b - a);
}

function yearOptions(years: number[], selected: number): string {
  return years.map((y) => `<option value="${y}" ${y === selected ? 'selected' : ''}>${y}年</option>`).join('');
}

function monthOptions(selected: number): string {
  const all = `<option value="0" ${selected === 0 ? 'selected' : ''}>すべて</option>`;
  const ms = Array.from({ length: 12 }, (_, i) => i + 1)
    .map((m) => `<option value="${m}" ${m === selected ? 'selected' : ''}>${m}月</option>`)
    .join('');
  return all + ms;
}

interface PageInfo<T> {
  items: T[];
  page: number;
  pages: number;
  total: number;
  start: number;
  end: number;
}
function paginate<T>(arr: T[], page: number): PageInfo<T> {
  const total = arr.length;
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const p = Math.min(Math.max(0, page), pages - 1);
  const start = p * PAGE;
  const end = Math.min(start + PAGE, total);
  return { items: arr.slice(start, end), page: p, pages, total, start, end };
}

type PagerKind = 'search' | 'journal' | 'points';
function pagerHtml(kind: PagerKind, info: PageInfo<unknown>): string {
  if (info.total <= PAGE) return '';
  const btn = (dir: number, label: string, disabled: boolean): string =>
    `<button data-pager="${kind}" data-dir="${dir}" class="px-3 py-1.5 rounded-lg bg-slate-100 text-slate-600 font-bold text-sm ${disabled ? 'opacity-40 pointer-events-none' : ''}">${label}</button>`;
  return `
    <div class="flex items-center justify-between px-1 py-2">
      ${btn(-1, '← 前', info.page <= 0)}
      <span class="text-xs text-slate-500">${info.start + 1}–${info.end} / ${info.total}（${info.page + 1}/${info.pages}）</span>
      ${btn(1, '次 →', info.page >= info.pages - 1)}
    </div>`;
}
function wirePager(): void {
  app()
    .querySelectorAll<HTMLElement>('[data-pager]')
    .forEach((b) =>
      b.addEventListener('click', () => {
        const kind = b.dataset.pager as PagerKind | undefined;
        const dir = Number(b.dataset.dir);
        if (kind) {
          pageState[kind] += dir;
          render();
        }
      }),
    );
}

// ============================ ブートストラップ ============================

export async function mount(): Promise<void> {
  if (!isSignedIn()) {
    renderLogin();
    return;
  }
  await bootstrap();
}

function renderLogin(): void {
  app().innerHTML = `
    <div class="app-shell flex flex-col items-center justify-center px-8 text-center gap-6" style="min-height:100vh">
      <div class="w-20 h-20 rounded-3xl bg-gradient-to-br from-brand-400 to-brand-600 grid place-items-center text-white text-4xl shadow-pop">💳</div>
      <div>
        <h1 class="text-2xl font-extrabold">CardLedger</h1>
        <p class="text-slate-500 text-sm mt-1">カード明細マネージャー</p>
      </div>
      <p class="text-sm text-slate-500 leading-relaxed">Google アカウントでログインすると、<br>あなたのスプレッドシートにデータを保存します。</p>
      <button id="loginBtn" class="px-6 py-3 rounded-2xl bg-brand-500 text-white font-bold shadow-pop hover:bg-brand-600">Google でログイン</button>
      <p id="loginErr" class="text-coral text-xs"></p>
    </div>`;
  document.getElementById('loginBtn')?.addEventListener('click', async () => {
    const errEl = document.getElementById('loginErr');
    try {
      await signIn();
      await bootstrap();
    } catch (e) {
      if (errEl) errEl.textContent = errMsg(e);
    }
  });
}

async function bootstrap(): Promise<void> {
  app().innerHTML = `<div class="app-shell grid place-items-center" style="min-height:100vh"><div class="text-slate-400 font-bold animate-pulse">データを読み込み中…</div></div>`;
  try {
    state.id = await ensureWorkbook();
    const wb = await loadAll(state.id);
    state.tx = wb.transactions.sort((a, b) => b.date.localeCompare(a.date));
    state.pts = wb.points.sort((a, b) => b.date.localeCompare(a.date));
    state.cats = wb.categories.sort((a, b) => a.sortOrder - b.sortOrder);
    state.rules = wb.rules;
    render();
  } catch (e) {
    app().innerHTML = `<div class="app-shell grid place-items-center px-8 text-center" style="min-height:100vh"><div class="text-coral font-bold">初期化に失敗しました<br><span class="text-xs font-normal text-slate-500">${esc(errMsg(e))}</span></div></div>`;
  }
}

// ============================ 全体描画 ============================

function render(): void {
  destroyCharts();
  app().innerHTML = `
    <div class="app-shell">
      ${header()}
      <main class="px-4 py-5 pb-28">${tabContent()}</main>
      ${bottomNav()}
    </div>`;
  wireTabs();
  switch (state.tab) {
    case 'home': wireHome(); break;
    case 'points': wirePoints(); break;
    case 'search': wireSearch(); break;
    case 'journal': wireJournal(); break;
    case 'import': wireImport(); break;
    case 'settings': wireSettings(); break;
  }
}

function header(): string {
  return `
    <header class="sticky top-0 z-30 backdrop-blur bg-white/80 border-b border-slate-200">
      <div class="px-4 h-14 flex items-center justify-between">
        <div class="flex items-center gap-2">
          <div class="w-9 h-9 rounded-2xl bg-gradient-to-br from-brand-400 to-brand-600 grid place-items-center text-white text-lg shadow-pop">💳</div>
          <div>
            <div class="font-extrabold text-base leading-none">CardLedger</div>
            <div class="text-[10px] text-slate-400 leading-none mt-0.5">カード明細マネージャー</div>
          </div>
        </div>
        <button data-action="tab" data-tab="settings" class="w-9 h-9 grid place-items-center text-slate-400 text-xl">⚙️</button>
      </div>
    </header>`;
}

const TABS: { id: TabId; ico: string; label: string }[] = [
  { id: 'home', ico: '🏠', label: 'ホーム' },
  { id: 'search', ico: '🔍', label: '検索' },
  { id: 'points', ico: '🪙', label: 'ポイント' },
  { id: 'journal', ico: '🏷️', label: '仕訳' },
  { id: 'import', ico: '📥', label: '取込' },
];

function bottomNav(): string {
  return `
    <nav class="bottomnav fixed bottom-0 inset-x-0 z-40 mx-auto" style="max-width:480px">
      <div class="bg-white/95 backdrop-blur border-t border-slate-200 grid grid-cols-5 px-1 pt-1.5 pb-1.5">
        ${TABS.map(
          (t) => `
          <button data-action="tab" data-tab="${t.id}" class="navbtn ${state.tab === t.id ? 'nav-active' : ''} flex flex-col items-center gap-0.5 py-1 rounded-xl transition">
            <span class="navico text-xl transition">${t.ico}</span>
            <span class="navlabel text-[10px] font-bold text-slate-400">${t.label}</span>
          </button>`,
        ).join('')}
      </div>
    </nav>`;
}

function tabContent(): string {
  switch (state.tab) {
    case 'home': return viewHome();
    case 'search': return viewSearch();
    case 'points': return viewPoints();
    case 'journal': return viewJournal();
    case 'import': return viewImport();
    case 'settings': return viewSettings();
  }
}

function wireTabs(): void {
  app()
    .querySelectorAll<HTMLElement>('[data-action="tab"]')
    .forEach((b) =>
      b.addEventListener('click', () => {
        const tab = b.dataset.tab as TabId | undefined;
        if (tab) {
          state.tab = tab;
          render();
        }
      }),
    );
}

// ============================ ホーム ============================

function viewHome(): string {
  const y = state.year;
  const total = yearTotal(state.tx, y);
  const month = new Date().getMonth() + 1;
  const mtotal = monthTotal(state.tx, y, month);
  const prev = monthTotal(state.tx, y, month - 1);
  const top = topCategory(state.tx, y);
  const count = state.tx.filter((t) => t.date.startsWith(String(y))).length;
  const diff = prev ? Math.round(((mtotal - prev) / prev) * 1000) / 10 : 0;
  const ptY = pointsYearTotal(state.pts, y);
  const ptM = pointsMonthTotal(state.pts, y, month);

  return `
    <section class="space-y-5 animate-pop">
      <div>
        <h1 class="text-2xl font-extrabold">こんにちは 👋</h1>
        <p class="text-slate-500 text-sm">${y}年の利用実績サマリー</p>
      </div>
      <div class="grid grid-cols-2 gap-3">
        ${kpi('💴', '年間合計', yen(total), 'bg-brand-100')}
        ${kpi('📅', '今月', yen(mtotal), 'bg-amber-100', diff >= 0 ? `▲ 先月比 +${diff}%` : `▼ 先月比 ${diff}%`, diff >= 0 ? 'text-coral' : 'text-brand-600')}
        ${kpi('🧾', '件数', `${count}<span class="text-sm text-slate-400 font-medium">件</span>`, 'bg-sky/20')}
        ${kpi('🎯', '最多カテゴリ', top ? esc(top.category) : '—', 'bg-grape/20', top ? `${yen(top.amount)} (${Math.round(top.ratio * 100)}%)` : '')}
      </div>

      <div class="rounded-3xl p-4 bg-gradient-to-r from-amber-400 to-amber-500 text-white shadow-pop flex items-center justify-between gap-3">
        <div class="flex items-center gap-3">
          <div class="w-11 h-11 rounded-2xl bg-white/25 grid place-items-center text-2xl">🪙</div>
          <div><div class="text-xs font-bold text-white/80">獲得ポイント</div><div class="text-[11px] text-white/70">カード利用特典</div></div>
        </div>
        <div class="flex items-center gap-4">
          <div><div class="text-[11px] text-white/80 font-bold">今年</div><div class="text-xl font-extrabold">${ptY.toLocaleString()} <span class="text-xs">pt</span></div></div>
          <div class="w-px h-8 bg-white/30"></div>
          <div><div class="text-[11px] text-white/80 font-bold">今月</div><div class="text-xl font-extrabold">${ptM.toLocaleString()} <span class="text-xs">pt</span></div></div>
        </div>
      </div>

      <div class="rounded-3xl p-5 text-white bg-gradient-to-br from-brand-500 via-brand-600 to-emerald-700 shadow-pop relative overflow-hidden">
        <div class="absolute -right-6 -top-6 text-8xl opacity-20">✨</div>
        <div class="flex items-center gap-2 font-bold mb-2"><span class="text-lg">🤖</span> AI 利用傾向コメント</div>
        <p id="aiComment" class="text-sm leading-relaxed text-white/95">分析中…</p>
      </div>

      <div class="card p-4">
        <div class="font-bold mb-2">月別利用額の推移</div>
        <canvas id="chartMonthly" height="130"></canvas>
      </div>
      <div class="card p-4">
        <div class="font-bold mb-2">カテゴリ別構成</div>
        <canvas id="chartCategory" height="180"></canvas>
      </div>

      <div class="card p-4">
        <div class="flex items-center justify-between mb-2">
          <div class="font-bold">最近の利用</div>
          <button data-action="tab" data-tab="search" class="text-sm text-brand-600 font-bold">すべて見る →</button>
        </div>
        <div class="divide-y divide-slate-100">
          ${state.tx.slice(0, 6).map(txRow).join('') || emptyNote('まだ明細がありません。インポートから取り込んでください。')}
        </div>
      </div>
    </section>`;
}

function kpi(ico: string, label: string, value: string, bg: string, sub = '', subColor = 'text-slate-400'): string {
  return `
    <div class="card p-4">
      <div class="flex items-center gap-2 text-slate-400 text-xs font-bold"><span class="w-7 h-7 rounded-xl ${bg} grid place-items-center">${ico}</span>${label}</div>
      <div class="text-2xl font-extrabold mt-2">${value}</div>
      ${sub ? `<div class="text-[11px] ${subColor} font-bold mt-1">${sub}</div>` : ''}
    </div>`;
}

function txRow(t: Transaction): string {
  const s = catStyle(t.category, state.cats);
  return `
    <div class="flex items-center gap-3 py-2.5">
      <div class="w-9 h-9 rounded-xl grid place-items-center text-lg" style="background:${s.color}22">${s.icon}</div>
      <div class="min-w-0 flex-1"><div class="font-semibold truncate">${esc(t.merchant)}</div><div class="text-xs text-slate-400">${t.date} ・ ${esc(t.category)}</div></div>
      <div class="font-bold">${yen(t.amount)}</div>
    </div>`;
}

function emptyNote(msg: string): string {
  return `<div class="text-center text-slate-400 text-sm py-6">${esc(msg)}</div>`;
}

function wireHome(): void {
  const y = state.year;
  const monthly = monthlySeries(state.tx, y);
  makeChart('chartMonthly', {
    type: 'bar',
    data: {
      labels: ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'],
      datasets: [{ data: monthly, backgroundColor: '#34d399', borderRadius: 8, hoverBackgroundColor: '#059669' }],
    },
    options: {
      plugins: { legend: { display: false } },
      scales: { y: { ticks: { callback: (v: number) => '¥' + v / 1000 + 'k' }, grid: { color: '#f1f5f9' } }, x: { grid: { display: false } } },
    },
  });
  const shares = categoryShares(state.tx, y);
  makeChart('chartCategory', {
    type: 'doughnut',
    data: {
      labels: shares.map((s) => s.category),
      datasets: [
        {
          data: shares.map((s) => s.amount),
          backgroundColor: shares.map((s) => catStyle(s.category, state.cats).color),
          borderWidth: 2,
          borderColor: '#fff',
        },
      ],
    },
    options: { plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 10 } } } }, cutout: '62%' },
  });
  void fillAiComment();
}

async function fillAiComment(): Promise<void> {
  const el = document.getElementById('aiComment');
  if (!el) return;
  const y = state.year;
  const month = new Date().getMonth() + 1;
  const summary: AiSummary = {
    year: y,
    month,
    yearTotal: yearTotal(state.tx, y),
    monthTotal: monthTotal(state.tx, y, month),
    prevMonthTotal: monthTotal(state.tx, y, month - 1),
    topCategories: categoryShares(state.tx, y),
    monthlySeries: monthlySeries(state.tx, y),
    pointsYear: pointsYearTotal(state.pts, y),
    pointsMonth: pointsMonthTotal(state.pts, y, month),
  };
  const text = await getDailyInsight(todayStr(), summary);
  el.textContent = text ?? fallbackComment(summary);
  if (!getGeminiKey()) {
    el.insertAdjacentHTML(
      'beforeend',
      ` <button data-action="tab" data-tab="settings" class="underline text-white/80 text-xs">（設定でGeminiキーを登録するとAI分析が有効）</button>`,
    );
    document.querySelector('#aiComment [data-action="tab"]')?.addEventListener('click', () => {
      state.tab = 'settings';
      render();
    });
  }
}

function fallbackComment(s: AiSummary): string {
  const top = s.topCategories[0];
  const diff = s.prevMonthTotal ? Math.round(((s.monthTotal - s.prevMonthTotal) / s.prevMonthTotal) * 100) : 0;
  const trend = diff >= 0 ? `前月比 +${diff}%` : `前月比 ${diff}%`;
  return `${s.year}年の利用は${yen(s.yearTotal)}、当月は${yen(s.monthTotal)}（${trend}）です。${top ? `最も支出が多いのは「${top.category}」で${yen(top.amount)}。` : ''}獲得ポイントは年間${s.pointsYear}ptです。`;
}

// ============================ 検索 ============================

/** 検索条件にマッチする明細（新しい順） */
function searchResults(): Transaction[] {
  const kw = search.keyword.trim();
  const y = String(search.year);
  const mm = search.month ? String(search.month).padStart(2, '0') : '';
  return state.tx.filter(
    (t) =>
      t.date.startsWith(y) &&
      (!mm || t.date.slice(5, 7) === mm) &&
      (!kw || t.merchant.includes(kw)) &&
      (!search.category || t.category === search.category),
  );
}

function viewSearch(): string {
  const cats = [UNCLASSIFIED, ...state.cats.map((c) => c.name)];
  const years = availableYears(state.tx.map((t) => t.date));
  const rows = searchResults();
  const total = rows.reduce((s, t) => s + t.amount, 0);
  const shares = sharesOf(rows);
  const pg = paginate(rows, pageState.search);
  return `
    <section class="space-y-4 animate-pop">
      <h1 class="text-2xl font-extrabold">履歴検索 🔍</h1>
      <div class="card p-4 grid grid-cols-2 gap-3">
        <div class="col-span-2">
          <label class="text-xs font-bold text-slate-400">キーワード（店舗名）</label>
          <input id="fKw" value="${esc(search.keyword)}" class="w-full mt-1 px-3 py-2 rounded-xl border border-slate-200 outline-none focus:border-brand-400" placeholder="例: スーパー / Amazon">
        </div>
        <div class="col-span-2">
          <label class="text-xs font-bold text-slate-400">カテゴリ</label>
          <select id="fCat" class="w-full mt-1 px-3 py-2 rounded-xl border border-slate-200 outline-none focus:border-brand-400">
            <option value="">すべて</option>
            ${cats.map((c) => `<option ${search.category === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}
          </select>
        </div>
        <div>
          <label class="text-xs font-bold text-slate-400">年</label>
          <select id="fYear" class="w-full mt-1 px-3 py-2 rounded-xl border border-slate-200 outline-none focus:border-brand-400">${yearOptions(years, search.year)}</select>
        </div>
        <div>
          <label class="text-xs font-bold text-slate-400">月</label>
          <select id="fMonth" class="w-full mt-1 px-3 py-2 rounded-xl border border-slate-200 outline-none focus:border-brand-400">${monthOptions(search.month)}</select>
        </div>
      </div>

      <div class="card p-4">
        <div class="flex items-center justify-between mb-2">
          <div class="font-bold">仕訳カテゴリ集計</div>
          <div class="text-sm text-slate-500">合計 <b class="text-slate-800">${yen(total)}</b> / ${rows.length}件</div>
        </div>
        ${
          shares.length
            ? `<canvas id="chartSearch" height="180"></canvas>`
            : emptyNote('該当する明細がありません。')
        }
      </div>

      ${
        rows.length
          ? `<div class="card overflow-hidden">
               <div class="divide-y divide-slate-100">${pg.items.map(searchRow).join('')}</div>
               ${pagerHtml('search', pg)}
             </div>`
          : ''
      }
    </section>`;
}

function searchRow(t: Transaction): string {
  const s = catStyle(t.category, state.cats);
  return `
    <div class="flex items-center gap-3 px-4 py-2.5">
      <div class="w-9 h-9 rounded-xl grid place-items-center text-base" style="background:${s.color}22">${s.icon}</div>
      <div class="min-w-0 flex-1">
        <div class="font-semibold truncate text-sm">${esc(t.merchant)}</div>
        <div class="text-[11px] text-slate-400">${t.date} ・ <span style="color:${s.color}">${esc(t.category)}</span>${t.user === '家族' ? ' ・👨‍👩‍👧家族' : ''}</div>
      </div>
      <div class="font-bold text-sm">${yen(t.amount)}</div>
    </div>`;
}

function wireSearch(): void {
  const onChange = (id: string, fn: (v: string) => void): void => {
    const el = document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null;
    el?.addEventListener('change', () => {
      fn(el.value);
      pageState.search = 0;
      render();
    });
  };
  // キーワードは入力確定（change）で反映
  onChange('fKw', (v) => (search.keyword = v.trim()));
  onChange('fCat', (v) => (search.category = v));
  onChange('fYear', (v) => (search.year = Number(v)));
  onChange('fMonth', (v) => (search.month = Number(v)));
  wirePager();
  // 結果のカテゴリ別円グラフ
  const shares = sharesOf(searchResults());
  if (shares.length) {
    makeChart('chartSearch', {
      type: 'doughnut',
      data: {
        labels: shares.map((s) => s.category),
        datasets: [
          {
            data: shares.map((s) => s.amount),
            backgroundColor: shares.map((s) => catStyle(s.category, state.cats).color),
            borderWidth: 2,
            borderColor: '#fff',
          },
        ],
      },
      options: { plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 10 } } } }, cutout: '60%' },
    });
  }
}

// ============================ ポイント ============================

function viewPoints(): string {
  const years = availableYears(state.pts.map((p) => p.date));
  const y = pointsYear;
  const yTotal = pointsYearTotal(state.pts, y);
  const yearPts = state.pts.filter((p) => p.date.startsWith(String(y)));
  const monthly = pointsMonthlySeries(state.pts, y);
  const activeMonths = monthly.filter((v) => v > 0).length;
  const avg = activeMonths ? Math.round(yTotal / activeMonths) : 0;
  const bestIdx = monthly.reduce((bi, v, i, a) => (v > (a[bi] ?? 0) ? i : bi), 0);
  const best = yTotal ? `${bestIdx + 1}月 (${(monthly[bestIdx] ?? 0).toLocaleString()}pt)` : '—';
  const pg = paginate(yearPts, pageState.points);
  return `
    <section class="space-y-4 animate-pop">
      <div class="flex items-center justify-between">
        <h1 class="text-2xl font-extrabold">ポイント履歴 🪙</h1>
        <select id="ptYearSel" class="card px-3 py-2 text-sm font-semibold text-slate-600 outline-none">${yearOptions(years, y)}</select>
      </div>
      <div class="grid grid-cols-2 gap-3">
        ${ptKpi(`${y}年の獲得`, `${yTotal.toLocaleString()} pt`, 'text-amber-500')}
        ${ptKpi('月平均', `${avg.toLocaleString()} pt`, '')}
        ${ptKpi('獲得件数', `${yearPts.length} 件`, '')}
        ${ptKpi('最多月', best, '')}
      </div>
      <div class="card p-4"><div class="font-bold mb-2">月別獲得ポイント（${y}年）</div><canvas id="chartPoints" height="120"></canvas></div>
      ${
        yearPts.length
          ? `<div class="card overflow-hidden">
               <div class="divide-y divide-slate-100">${pg.items.map(ptRowView).join('')}</div>
               ${pagerHtml('points', pg)}
             </div>`
          : `<div class="card">${emptyNote('この年のポイント履歴がありません。')}</div>`
      }
    </section>`;
}

function ptKpi(label: string, value: string, color: string): string {
  return `<div class="card p-4"><div class="text-xs font-bold text-slate-400">${label}</div><div class="text-2xl font-extrabold mt-1 ${color}">${value}</div></div>`;
}

function ptRowView(p: PointEntry): string {
  return `
    <div class="flex items-center gap-3 px-4 py-2.5">
      <div class="min-w-0 flex-1"><div class="font-semibold truncate text-sm">${esc(p.merchant)}</div><div class="text-[11px] text-slate-400">${p.date} ・ ${esc(p.source)}</div></div>
      <div class="font-bold text-amber-500 text-sm">+${p.points.toLocaleString()} pt</div>
    </div>`;
}

function wirePoints(): void {
  const sel = document.getElementById('ptYearSel') as HTMLSelectElement | null;
  sel?.addEventListener('change', () => {
    pointsYear = Number(sel.value);
    pageState.points = 0;
    render();
  });
  wirePager();
  const monthly = pointsMonthlySeries(state.pts, pointsYear);
  makeChart('chartPoints', {
    type: 'bar',
    data: {
      labels: ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'],
      datasets: [{ data: monthly, backgroundColor: '#fbbf24', borderRadius: 8, hoverBackgroundColor: '#f59e0b' }],
    },
    options: {
      plugins: { legend: { display: false } },
      scales: { y: { ticks: { callback: (v: number) => v + 'pt' }, grid: { color: '#f1f5f9' } }, x: { grid: { display: false } } },
    },
  });
}

// ============================ 仕訳編集 ============================

function viewJournal(): string {
  const uncats = state.tx.filter((t) => t.category === UNCLASSIFIED);
  const list = uncats.length ? uncats : state.tx;
  const pg = paginate(list, pageState.journal);
  const opts = (sel: string): string =>
    [UNCLASSIFIED, ...state.cats.map((c) => c.name)]
      .map((c) => `<option ${c === sel ? 'selected' : ''}>${esc(c)}</option>`)
      .join('');
  return `
    <section class="space-y-4 animate-pop">
      <h1 class="text-2xl font-extrabold">仕訳編集 🏷️</h1>
      <div class="card p-4">
        <div class="flex items-center justify-between mb-3">
          <div class="font-bold">${uncats.length ? '未分類・要確認' : 'すべての明細'}</div>
          <span class="chip bg-coral/15 text-coral">${uncats.length}件 未分類</span>
        </div>
        <div class="space-y-2">
          ${pg.items
            .map(
              (t) => `
            <div class="flex items-center gap-2 p-2 rounded-xl hover:bg-slate-50">
              <div class="w-8 h-8 rounded-lg grid place-items-center" style="background:${catStyle(t.category, state.cats).color}22">${catStyle(t.category, state.cats).icon}</div>
              <div class="flex-1 min-w-0"><div class="font-semibold truncate text-sm">${esc(t.merchant)}</div><div class="text-[11px] text-slate-400">${t.date} ・ ${yen(t.amount)}</div></div>
              <select data-cat-for="${esc(t.txId)}" class="px-2 py-1.5 rounded-lg border border-slate-200 text-sm outline-none focus:border-brand-400">${opts(t.category)}</select>
            </div>`,
            )
            .join('') || emptyNote('明細がありません。')}
        </div>
        ${pagerHtml('journal', pg)}
      </div>

      <div class="card p-4">
        <div class="font-bold mb-3">カテゴリマスタ</div>
        <div class="flex flex-wrap gap-2">${state.cats.map((c) => `<span class="chip" style="background:${c.color}22;color:${c.color}">${c.icon} ${esc(c.name)}</span>`).join('')}</div>
        <div class="flex gap-2 mt-3">
          <input id="newCat" class="flex-1 px-3 py-2 rounded-xl border border-slate-200 text-sm outline-none focus:border-brand-400" placeholder="新規カテゴリ名">
          <button id="addCatBtn" class="px-3 py-2 rounded-xl bg-brand-500 text-white font-bold text-sm">追加</button>
        </div>
      </div>

      <div class="card p-4">
        <div class="font-bold mb-1">予測ルール辞書</div>
        <p class="text-[11px] text-slate-400 mb-3">店舗名にキーワードが含まれると自動分類。手修正すると学習します。</p>
        <div class="space-y-1.5 text-sm max-h-60 overflow-y-auto pr-1">
          ${[...state.rules]
            .sort((a, b) => b.priority - a.priority)
            .slice(0, 60)
            .map(
              (r) =>
                `<div class="flex items-center justify-between"><span class="text-slate-600">「${esc(r.keyword)}」${r.learned ? '<span class="text-[10px] text-brand-600 ml-1">学習</span>' : ''}</span><span class="chip" style="background:${catStyle(r.category, state.cats).color}22;color:${catStyle(r.category, state.cats).color}">${esc(r.category)}</span></div>`,
            )
            .join('')}
        </div>
      </div>
    </section>`;
}

function wireJournal(): void {
  app()
    .querySelectorAll<HTMLSelectElement>('[data-cat-for]')
    .forEach((sel) =>
      sel.addEventListener('change', () => {
        const txId = sel.dataset.catFor;
        if (txId) void changeCategory(txId, sel.value);
      }),
    );
  document.getElementById('addCatBtn')?.addEventListener('click', () => {
    const input = document.getElementById('newCat') as HTMLInputElement | null;
    const name = input?.value.trim();
    if (name) void addCategory(name);
  });
  wirePager();
}

async function changeCategory(txId: string, category: string): Promise<void> {
  const t = state.tx.find((x) => x.txId === txId);
  if (!t) return;
  const merchant = t.merchant;
  t.category = category;
  const { rules, keyword } = learnFromCorrection(state.rules, merchant, category);
  state.rules = rules;
  render();
  try {
    await setTransactionCategory(state.id, txId, category);
    await saveRules(state.id, state.rules);
    toast(keyword ? `保存・学習: 「${keyword}」→ ${category}` : '保存しました');
  } catch (e) {
    toast('保存に失敗: ' + errMsg(e));
  }
}

async function addCategory(name: string): Promise<void> {
  if (state.cats.some((c) => c.name === name)) {
    toast('同名のカテゴリが既にあります');
    return;
  }
  const sortOrder = state.cats.reduce((m, c) => Math.max(m, c.sortOrder), 0) + 1;
  state.cats.push({ name, icon: '🏷️', color: '#64748b', sortOrder, active: true });
  render();
  try {
    await saveCategories(state.id, state.cats);
    toast('カテゴリを追加しました');
  } catch (e) {
    toast('保存に失敗: ' + errMsg(e));
  }
}

// ============================ インポート ============================

function viewImport(): string {
  const hasResult = staged.tx.length + staged.pts.length > 0 || importPreview.length > 0;
  return `
    <section class="space-y-4 animate-pop">
      <h1 class="text-2xl font-extrabold">データインポート 📥</h1>
      <div class="card p-5">
        <div class="flex items-center gap-2 mb-4"><span class="chip bg-brand-100 text-brand-700">PayPayカード</span><span class="text-xs text-slate-400">CSV形式を自動判別</span></div>
        <label class="border-2 border-dashed border-brand-300 rounded-2xl p-8 text-center bg-brand-50/40 cursor-pointer hover:bg-brand-50 transition block">
          <div class="text-5xl mb-2">📄</div>
          <div class="font-bold">CSVファイルを選択</div>
          <div class="text-sm text-slate-400">タップしてファイルを選ぶ</div>
          <input id="csvInput" type="file" accept=".csv,text/csv" class="hidden">
        </label>
        <div id="importResult" class="${hasResult ? '' : 'hidden'} mt-5">
          ${importResultHtml()}
        </div>
      </div>
    </section>`;
}

interface PreviewRow {
  kind: 'tx' | 'pt';
  date: string;
  merchant: string;
  amount: number;
  category: string;
  dup: boolean;
  sub: string;
}
let importPreview: PreviewRow[] = [];

function importResultHtml(): string {
  if (importPreview.length === 0) return '';
  const nNew = staged.tx.length;
  const nDup = importPreview.filter((r) => r.kind === 'tx' && r.dup).length;
  const nPred = staged.tx.filter((t) => t.category !== UNCLASSIFIED).length;
  const nPt = staged.pts.length;
  return `
    <div class="grid grid-cols-2 gap-3 mb-4">
      ${impStat(nNew, '新規取込', 'bg-brand-50 text-brand-600')}
      ${impStat(nDup, '重複スキップ', 'bg-amber-50 text-amber-500')}
      ${impStat(nPred, '自動分類', 'bg-grape/10 text-grape')}
      ${impStat(nPt, '獲得ポイント', 'bg-amber-50 text-amber-500')}
    </div>
    <div class="overflow-hidden border border-slate-100 rounded-xl divide-y divide-slate-100 max-h-80 overflow-y-auto">
      ${importPreview
        .map((r) => {
          const s = catStyle(r.category, state.cats);
          return `<div class="flex items-center gap-2 px-3 py-2 ${r.dup ? 'bg-amber-50/60 text-slate-400' : ''}">
            <span class="chip ${r.dup ? 'bg-amber-100 text-amber-600' : 'bg-brand-100 text-brand-700'}">${r.dup ? '重複' : '新規'}</span>
            <div class="flex-1 min-w-0"><div class="truncate text-sm">${esc(r.merchant)}</div><div class="text-[11px] text-slate-400">${r.date} ・ ${esc(r.sub)}</div></div>
            <div class="text-right text-sm font-bold">${r.kind === 'pt' ? '+' + r.amount + 'pt' : yen(r.amount)}</div>
            ${r.kind === 'tx' ? `<span class="chip" style="background:${s.color}22;color:${s.color}">${s.icon}</span>` : ''}
          </div>`;
        })
        .join('')}
    </div>
    <div class="flex items-center gap-2 mt-4">
      <button id="commitBtn" class="px-5 py-2.5 rounded-xl bg-brand-500 text-white font-bold shadow-pop">登録（新規のみ）</button>
      <button id="resetImportBtn" class="px-4 py-2.5 rounded-xl bg-slate-100 text-slate-600 font-bold">やり直す</button>
    </div>
    <p class="text-[11px] text-slate-400 mt-2">重複は <b>取引番号</b> で判定・ポイント獲得行は別途集計</p>`;
}

function impStat(n: number, label: string, cls: string): string {
  return `<div class="rounded-xl ${cls.split(' ')[0]} p-3 text-center"><div class="text-2xl font-extrabold ${cls.split(' ').slice(1).join(' ')}">${n}</div><div class="text-xs text-slate-500">${label}</div></div>`;
}

function wireImport(): void {
  document.getElementById('csvInput')?.addEventListener('change', (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      handleCsv(String(reader.result ?? ''));
      render();
    };
    reader.readAsText(file, 'shift_jis'); // PayPay CSV は Shift_JIS の場合が多い
  });
  document.getElementById('commitBtn')?.addEventListener('click', () => void commitImport());
  document.getElementById('resetImportBtn')?.addEventListener('click', () => {
    staged = { tx: [], pts: [] };
    importPreview = [];
    render();
  });
}

function handleCsv(text: string): void {
  const parsed = parsePayPayCsv(text);
  const existTx = new Set(state.tx.map((t) => t.txId));
  const existPt = new Set(state.pts.map((p) => p.pid));
  const txStaged: StagedTx[] = [];
  const ptStaged: StagedPt[] = [];
  importPreview = [];

  for (const t of parsed.transactions) {
    const category = predictCategory(t.merchant, state.rules);
    const dup = existTx.has(t.txId);
    const withCat: Transaction = { ...t, category };
    if (!dup) txStaged.push({ ...withCat, dup });
    importPreview.push({ kind: 'tx', date: t.date, merchant: t.merchant, amount: t.amount, category, dup, sub: t.card + (t.user === '家族' ? ' ・家族' : '') });
  }
  for (const p of parsed.points) {
    const dup = existPt.has(p.pid);
    if (!dup) ptStaged.push({ ...p, dup });
    importPreview.push({ kind: 'pt', date: p.date, merchant: p.merchant, amount: p.points, category: UNCLASSIFIED, dup, sub: p.source });
  }
  importPreview.sort((a, b) => b.date.localeCompare(a.date));
  staged = {
    tx: txStaged.map(({ dup: _dup, ...t }) => ({ ...t, dup: false })),
    pts: ptStaged.map(({ dup: _dup, ...p }) => ({ ...p, dup: false })),
  };
  toast(parsed.usedFallback ? 'ヘッダを認識できず既定列で解析しました' : 'CSVを解析しました');
}

async function commitImport(): Promise<void> {
  const newTx: Transaction[] = staged.tx.map(({ dup: _d, ...t }) => t);
  const newPts: PointEntry[] = staged.pts.map(({ dup: _d, ...p }) => p);
  if (newTx.length + newPts.length === 0) {
    toast('登録対象がありません');
    return;
  }
  try {
    await appendTransactions(state.id, newTx);
    await appendPoints(state.id, newPts);
    state.tx = [...state.tx, ...newTx].sort((a, b) => b.date.localeCompare(a.date));
    state.pts = [...state.pts, ...newPts].sort((a, b) => b.date.localeCompare(a.date));
    staged = { tx: [], pts: [] };
    importPreview = [];
    toast(`明細${newTx.length}件・ポイント${newPts.length}件を登録しました`);
    state.tab = 'home';
    render();
  } catch (e) {
    toast('登録に失敗: ' + errMsg(e));
  }
}

// ============================ 設定 ============================

function viewSettings(): string {
  const key = getGeminiKey();
  const masked = key ? key.slice(0, 4) + '••••••••' + key.slice(-4) : '';
  const sheetUrl = state.id ? `https://docs.google.com/spreadsheets/d/${state.id}` : '';
  return `
    <section class="space-y-4 animate-pop">
      <h1 class="text-2xl font-extrabold">設定 ⚙️</h1>
      <div class="card p-4 space-y-3">
        <div class="font-bold">Gemini API キー</div>
        <p class="text-[11px] text-slate-400">AI 利用傾向コメントに使用します。キーはこの端末（localStorage）にのみ保存され、外部には送信しません。</p>
        <input id="geminiKey" type="password" placeholder="${key ? esc(masked) : 'AIza...'}" class="w-full px-3 py-2 rounded-xl border border-slate-200 outline-none focus:border-brand-400">
        <div class="flex gap-2">
          <button id="saveKeyBtn" class="px-4 py-2 rounded-xl bg-brand-500 text-white font-bold text-sm">保存</button>
          ${key ? '<button id="clearKeyBtn" class="px-4 py-2 rounded-xl bg-slate-100 text-slate-600 font-bold text-sm">削除</button>' : ''}
        </div>
      </div>
      <div class="card p-4 space-y-2">
        <div class="font-bold">データ（スプレッドシート）</div>
        ${sheetUrl ? `<a href="${sheetUrl}" target="_blank" rel="noopener" class="text-brand-600 font-bold text-sm underline break-all">スプレッドシートを開く ↗</a>` : '<div class="text-sm text-slate-400">未接続</div>'}
        <div class="text-[11px] text-slate-400">明細 ${state.tx.length}件 ・ ポイント ${state.pts.length}件 ・ カテゴリ ${state.cats.length}種</div>
        ${
          state.id
            ? `<div class="mt-1">
                 <div class="text-[11px] font-bold text-slate-400">現在のスプレッドシートID</div>
                 <div class="flex gap-2 mt-1">
                   <input id="curSheetId" readonly value="${esc(state.id)}" class="flex-1 px-2 py-1.5 rounded-lg border border-slate-200 text-[11px] bg-slate-50 text-slate-600">
                   <button id="copyIdBtn" class="px-3 py-1.5 rounded-lg bg-slate-100 text-slate-600 font-bold text-xs">コピー</button>
                 </div>
               </div>`
            : ''
        }
      </div>

      <div class="card p-4 space-y-2">
        <div class="font-bold">別の端末と同じデータを使う</div>
        <p class="text-[11px] text-slate-400">端末ごとに別のスプレッドシートが作られます。同じデータを見るには、最初の端末の「スプレッドシートID」をここに貼り付けて接続してください（IDでもURLでもOK）。</p>
        <input id="linkSheetId" placeholder="スプレッドシートIDまたはURL" class="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm outline-none focus:border-brand-400">
        <button id="linkSheetBtn" class="px-4 py-2 rounded-xl bg-brand-500 text-white font-bold text-sm">このシートに接続</button>
      </div>
      <div class="card p-4">
        <button id="signOutBtn" class="px-4 py-2 rounded-xl bg-coral/10 text-coral font-bold text-sm">ログアウト</button>
      </div>
      <button data-action="tab" data-tab="home" class="text-brand-600 font-bold text-sm">← ホームへ戻る</button>
    </section>`;
}

function wireSettings(): void {
  document.getElementById('saveKeyBtn')?.addEventListener('click', () => {
    const v = (document.getElementById('geminiKey') as HTMLInputElement | null)?.value.trim();
    if (v) {
      setGeminiKey(v);
      localStorage.removeItem(LS.aiComment); // 再生成させる
      toast('Gemini キーを保存しました');
      render();
    }
  });
  document.getElementById('clearKeyBtn')?.addEventListener('click', () => {
    localStorage.removeItem(LS.geminiKey);
    localStorage.removeItem(LS.aiComment);
    toast('Gemini キーを削除しました');
    render();
  });
  document.getElementById('copyIdBtn')?.addEventListener('click', () => {
    void navigator.clipboard?.writeText(state.id).then(() => toast('IDをコピーしました'));
  });
  document.getElementById('linkSheetBtn')?.addEventListener('click', () => {
    const v = (document.getElementById('linkSheetId') as HTMLInputElement | null)?.value;
    if (v) void switchSpreadsheet(v);
  });
  document.getElementById('signOutBtn')?.addEventListener('click', () => {
    signOut();
    location.reload();
  });
}

/** 指定スプレッドシート（IDまたはURL）に接続し直す */
async function switchSpreadsheet(input: string): Promise<void> {
  const raw = input.trim();
  const m = raw.match(/\/d\/([a-zA-Z0-9-_]+)/);
  const sid = m && m[1] ? m[1] : raw;
  if (!sid) return;
  const prev = localStorage.getItem(LS.spreadsheetId);
  try {
    localStorage.setItem(LS.spreadsheetId, sid);
    await bootstrap(); // ensureWorkbook で存在確認・不足シート補完 → loadAll → 再描画
    toast('スプレッドシートに接続しました');
  } catch (e) {
    // 失敗したら元のIDに戻す
    if (prev) localStorage.setItem(LS.spreadsheetId, prev);
    else localStorage.removeItem(LS.spreadsheetId);
    toast('接続に失敗: ' + errMsg(e));
  }
}

// ============================ DEV デモ（OAuth/Sheets を使わず画面確認） ============================

/** DEV 限定: サンプルデータで UI を描画する（?demo=1）。永続化系はトーストでエラーになる想定 */
export function mountDemo(): void {
  state.id = '';
  state.cats = [...DEFAULT_CATEGORIES];
  state.rules = [...DEFAULT_RULES];
  const year = new Date().getFullYear();
  const merchants = [
    'セブンイレブン渋谷店', 'ローソン新宿', 'スーパーマルエツ', 'マクドナルド品川',
    'スターバックス銀座', 'Amazon.co.jp', 'JR東日本モバイルSuica', 'ENEOS環八SS',
    'ドコモ携帯料金', 'Netflix.com', '東京電力エナジー', 'マツモトキヨシ',
    'ユニクロ池袋', 'タクシー全国', '調剤薬局ウェルネス', '個人商店たなか',
  ];
  const rnd = (a: number, b: number): number => Math.floor(Math.random() * (b - a + 1)) + a;
  const p2 = (n: number): string => String(n).padStart(2, '0');
  const tx: Transaction[] = [];
  const pts: PointEntry[] = [];
  let id = 1;
  // 直近3年分（年セレクタ・年集計の確認用）
  for (const yr of [year - 2, year - 1, year]) {
    for (let m = 1; m <= 12; m++) {
      for (let i = 0; i < rnd(15, 26); i++) {
        const merchant = merchants[rnd(0, merchants.length - 1)] ?? '不明';
        const date = `${yr}-${p2(m)}-${p2(rnd(1, 28))}`;
        const category = merchant.includes('個人商店')
          ? UNCLASSIFIED
          : predictCategory(merchant, state.rules);
        tx.push({
          txId: `DEMO_${id}`, date, datetime: `${date}T12:00:00`, amount: rnd(3, 60) * 100,
          merchant, card: rnd(0, 4) === 0 ? 'PayPayカード ゴールド' : 'クレジット VISA 2170',
          payType: '一回払い', user: rnd(0, 3) === 0 ? '家族' : '本人', category,
        });
        id++;
      }
      for (let i = 0; i < rnd(8, 16); i++) {
        const date = `${yr}-${p2(m)}-${p2(rnd(1, 28))}`;
        pts.push({ pid: `DEMOPT_${id}`, date, merchant: merchants[rnd(0, merchants.length - 1)] ?? '不明', points: rnd(1, 50), source: 'PayPayポイント' });
        id++;
      }
    }
  }
  state.tx = tx.sort((a, b) => b.date.localeCompare(a.date));
  state.pts = pts.sort((a, b) => b.date.localeCompare(a.date));
  state.tab = 'home';
  render();
}

