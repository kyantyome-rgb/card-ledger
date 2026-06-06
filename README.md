# CardLedger — カード明細マネージャー

カード利用明細（PayPayカードのCSV）を Google スプレッドシートにデータベース化し、
**検索・仕訳別集計・期間別集計・獲得ポイント管理・AIによる利用傾向コメント**を行う
モバイルファーストの PWA です。

- 認証: Google OAuth（クライアント側 / Google Identity Services）
- データ保存: Google スプレッドシート（Sheets REST API を直接呼び出し。専用バックエンド不要）
- AI コメント: Gemini API（キーは端末の `localStorage` にのみ保存）
- 配信: PWA（Android のホーム画面に追加して利用）

---

## 1. 必要なもの

| 項目 | 内容 |
| --- | --- |
| Node.js | v18 以上（開発時の動作確認は v24） |
| Google アカウント | スプレッドシート保存・OAuth 用 |
| Google Cloud プロジェクト | OAuth クライアント ID 発行用（無料） |
| Gemini API キー（任意） | AI コメントを使う場合のみ。なくても定型文で動作 |

---

## 2. セットアップ

### 2-1. 依存パッケージのインストール

```bash
cd card-ledger
npm install
```

### 2-2. Google Cloud の設定（OAuth クライアント ID 発行）

> これを行わないとログインできません。所要 5〜10 分。

#### (a) プロジェクトを作成

1. [Google Cloud Console](https://console.cloud.google.com/) を開く。
2. 画面上部のプロジェクト選択 →「新しいプロジェクト」→ 任意の名前（例: `cardledger`）→「作成」。
3. 作成したプロジェクトを選択した状態にする。

#### (b) Google Sheets API を有効化

1. 左メニュー「API とサービス」→「ライブラリ」。
2. 「Google Sheets API」を検索 →「有効にする」。
   （Drive API の有効化は不要です。スプレッドシートの作成・読み書きは Sheets API だけで完結します）

#### (c) OAuth 同意画面を構成

1. 「API とサービス」→「OAuth 同意画面」。
2. User Type は **外部 (External)** を選択 →「作成」。
3. アプリ情報を入力（アプリ名 `CardLedger`、サポートメール、デベロッパー連絡先）。「保存して次へ」。
4. **スコープ**: ここでは追加不要（実行時にアプリが要求します）。「保存して次へ」。
5. **テストユーザー**: 自分の Google アカウントを追加。
   - 個人利用なら公開（本番公開・Google審査）は不要です。「テスト」状態のままでテストユーザーとして利用できます。
   - 家族と共有する場合は、その人のメールもテストユーザーに追加。
6. 「保存して次へ」→ 概要を確認して完了。

#### (d) OAuth クライアント ID を発行

1. 「API とサービス」→「認証情報」→「認証情報を作成」→「OAuth クライアント ID」。
2. アプリケーションの種類: **ウェブ アプリケーション**。
3. 名前: 任意（例 `CardLedger Web`）。
4. **承認済みの JavaScript 生成元** に以下を追加:
   - `http://localhost:5173` （ローカル開発用）
   - `https://<あなたのGitHubユーザー名>.github.io` （GitHub Pages 公開用。後で追加でも可）
   - ※ リダイレクト URI の登録は不要です（トークンモデルのため）。
5. 「作成」→ 表示された **クライアント ID**（`xxxx.apps.googleusercontent.com`）をコピー。

> **重要**: 「承認済みの JavaScript 生成元」はオリジン（スキーム + ホスト + ポート）のみ。
> パス（`/card-ledger/` など）は付けません。

### 2-3. 環境変数の設定

`env.example` を `.env` にコピーし、クライアント ID を設定します。

```bash
cp env.example .env
```

`.env`:
```
VITE_GOOGLE_CLIENT_ID=xxxx.apps.googleusercontent.com
VITE_SPREADSHEET_TITLE=CardLedger Data
```

> `.env` は `.gitignore` 済みでコミットされません。
> クライアント ID は秘密情報ではありません（公開しても問題ない種類）が、念のためコミット対象外にしています。

### 2-4. ローカルで起動

```bash
npm run dev
```

ブラウザで **`http://localhost:5173/card-ledger/`** を開く
（`base` がサブパスのため、末尾の `/card-ledger/` を忘れずに）。

1. 「Google でログイン」→ テストユーザーに追加したアカウントを選択。
2. 「CardLedger が Google スプレッドシートへのアクセスを求めています」を許可。
   - テスト中アプリのため「このアプリは確認されていません」と出ることがあります。
     自分のアプリなので「詳細」→「（安全でないページ）に移動」で進めます。
3. 初回ログイン時に自動でスプレッドシート `CardLedger Data` が作成され、
   `transactions / points / categories / rules / meta` の各シートが初期化されます。

---

## 3. 使い方

### 3-1. データインポート（📥 取込）

1. PayPayカードの「ご利用明細」CSV をダウンロード。
2. 取込画面で CSV を選択。
3. プレビューで **新規 / 重複 / 自動分類 / 獲得ポイント** を確認。
4. 「登録（新規のみ）」でスプレッドシートに保存。

- 重複は **取引番号** で判定し、既存と重複する行はスキップします。
- 取引内容「ポイント、残高の獲得」の行は明細ではなく **ポイント履歴** に分けて集計します。
- CSV は **Shift_JIS** として読み込みます（PayPay の書式に合わせています）。

### 3-2. 仕訳編集（🏷️ 仕訳）

- 「未分類」の明細にカテゴリを割り当てます。
- 手修正すると、店舗名のキーワードから **予測ルールを学習**し、次回以降自動分類されます。
- カテゴリの追加も可能（家計簿標準＋「会社経費」を初期搭載）。

### 3-3. AI コメント（🏠 ホーム）

- ⚙️ 設定画面で **Gemini API キー** を入力すると、月次集計をもとに利用傾向コメントを生成します。
- 生成は **1 日 1 回**（その日のキャッシュを再利用）。
- キー未設定時は集計値からの定型コメントを表示します。
- Gemini API キーは [Google AI Studio](https://aistudio.google.com/app/apikey) で取得できます。

---

## 4. ビルドと公開（GitHub Pages）

### 4-1. ビルド

```bash
npm run build      # tsc 型チェック + vite build（dist/ に出力、PWA の Service Worker も生成）
npm run preview    # 本番ビルドのローカル確認
```

### 4-2. GitHub Pages へ手動デプロイする場合

1. GitHub にリポジトリ `card-ledger` を作成（`base` を変える場合は `vite.config.ts` の `REPO_BASE` も合わせる）。
2. `dist/` の中身を `gh-pages` ブランチに公開、もしくは Settings → Pages で対象を設定。
3. ビルド時に `VITE_GOOGLE_CLIENT_ID` が必要です（`.env` を読みます）。
4. 公開後、OAuth の「承認済み JavaScript 生成元」に
   `https://<ユーザー名>.github.io` が登録済みであることを確認。

> GitHub Actions による自動デプロイのワークフローは別途用意できます（`.github/workflows/` への書き込みは
> プロジェクトのセキュリティ方針で確認が必要なため、ご依頼ください）。

---

## 5. データ構造（スプレッドシート）

初回ログイン時に自動生成される 5 シート。

| シート | 列 |
| --- | --- |
| `transactions` | txId, date, datetime, amount, merchant, card, payType, user, category |
| `points` | pid, date, merchant, points, source |
| `categories` | name, icon, color, sortOrder, active |
| `rules` | keyword, category, priority, hitCount, learned |
| `meta` | key, value（AIコメントキャッシュ等の予備領域） |

- `txId` / `pid` は PayPay の **取引番号**＝ユニークキー。重複取り込みを防ぎます。
- スプレッドシートを直接編集しても、再読み込みでアプリに反映されます。

---

## 6. 開発メモ

```
src/
  domain/      types / csv（PayPayパーサ）/ predict（予測・学習）/ aggregate（集計）  ← 純粋ロジック
  auth/gis.ts  Google Identity Services（トークン取得）
  sheets/      client.ts（Sheets REST）/ repo.ts（スキーマ初期化・読み書き）
  ai/gemini.ts 月次サマリー→コメント（日次キャッシュ）
  ui/          app.ts（5画面＋設定・ボトムタブ）/ format.ts
config.ts      スコープ・シート定義・初期カテゴリ/ルール
```

- 型チェック: `npm run typecheck`
- DEV 限定のサンプル表示: `http://localhost:5173/card-ledger/?demo=1`
  （OAuth/Sheets を使わずに UI を確認するためのフック。保存操作は失敗します）
- Tailwind / Chart.js は Play CDN を利用（個人用 PWA のため。必要ならビルド組込へ差し替え可）。

---

## 7. トラブルシューティング

| 症状 | 対処 |
| --- | --- |
| ログインボタンが反応しない / `VITE_GOOGLE_CLIENT_ID が未設定` | `.env` のクライアント ID を確認し dev サーバを再起動 |
| `redirect_uri_mismatch` / `origin is not allowed` | 「承認済み JavaScript 生成元」にアクセス中のオリジン（`http://localhost:5173` 等）を登録 |
| 「このアプリは確認されていません」 | テストユーザーに自分を追加済みか確認。自分のアプリなら「詳細」から続行可 |
| Sheets API のエラー | Cloud プロジェクトで Google Sheets API を有効化済みか確認 |
| 画面が真っ白 / 404 | URL 末尾の `/card-ledger/` を付けているか確認（base 設定のため） |
| 金額が文字化け/ずれる | CSV が PayPay 形式（Shift_JIS・13列）か確認 |

---

## 8. プライバシー / セキュリティ

- データは **あなた自身の Google スプレッドシート** に保存され、第三者のサーバーには送信されません。
- Gemini API キーは端末の `localStorage` にのみ保存されます（リポジトリやサーバーには保存しません）。
- OAuth スコープは `spreadsheets`（スプレッドシートの作成・読み書き）のみ。
