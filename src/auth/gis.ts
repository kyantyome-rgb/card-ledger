import { GOOGLE_CLIENT_ID, OAUTH_SCOPES } from '../config';

// Google Identity Services（トークンモデル）による OAuth。
// アクセストークンはメモリ保持（リロードで再取得）。

let tokenClient: google.accounts.oauth2.TokenClient | null = null;
let accessToken: string | null = null;
let tokenExpiry = 0;

let resolvePending: ((token: string) => void) | null = null;
let rejectPending: ((err: Error) => void) | null = null;

/** gsi スクリプトの読み込みを待つ */
function waitForGoogle(timeoutMs = 10000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = (): void => {
      if (window.google?.accounts?.oauth2) {
        resolve();
        return;
      }
      if (Date.now() - start > timeoutMs) {
        reject(new Error('Google Identity Services の読み込みに失敗しました'));
        return;
      }
      window.setTimeout(tick, 50);
    };
    tick();
  });
}

async function ensureClient(): Promise<google.accounts.oauth2.TokenClient> {
  if (tokenClient) return tokenClient;
  if (!GOOGLE_CLIENT_ID) {
    throw new Error('VITE_GOOGLE_CLIENT_ID が未設定です（.env を確認してください）');
  }
  await waitForGoogle();
  tokenClient = window.google.accounts.oauth2.initTokenClient({
    client_id: GOOGLE_CLIENT_ID,
    scope: OAUTH_SCOPES,
    callback: (resp: google.accounts.oauth2.TokenResponse) => {
      if (resp.error) {
        rejectPending?.(new Error(resp.error_description || resp.error));
      } else {
        accessToken = resp.access_token;
        const ttl = Number(resp.expires_in) || 3600;
        tokenExpiry = Date.now() + (ttl - 60) * 1000; // 60秒の安全マージン
        resolvePending?.(accessToken);
      }
      resolvePending = null;
      rejectPending = null;
    },
  });
  return tokenClient;
}

function requestToken(prompt: '' | 'consent' | 'select_account'): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    resolvePending = resolve;
    rejectPending = reject;
    tokenClient!.requestAccessToken({ prompt });
  });
}

/** 現在有効なトークンを保持しているか */
export function isSignedIn(): boolean {
  return !!accessToken && Date.now() < tokenExpiry;
}

/** 明示的サインイン（アカウント選択を表示） */
export async function signIn(): Promise<void> {
  await ensureClient();
  await requestToken('select_account');
}

/** サインアウト（トークン破棄。再利用時は再同意が必要になる場合あり） */
export function signOut(): void {
  if (accessToken) {
    window.google?.accounts?.oauth2?.revoke(accessToken, () => {});
  }
  accessToken = null;
  tokenExpiry = 0;
}

/** 有効なアクセストークンを返す。期限切れなら静かに再取得を試みる */
export async function getAccessToken(): Promise<string> {
  if (isSignedIn() && accessToken) return accessToken;
  await ensureClient();
  return requestToken('');
}
