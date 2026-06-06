import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// GitHub Pages のプロジェクトサイトはサブパス配下に置かれる。
// 例: https://<user>.github.io/card-ledger/  → base は '/card-ledger/'
// リポジトリ名を変える場合はここを合わせること。
const REPO_BASE = '/card-ledger/';

export default defineConfig({
  base: REPO_BASE,
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'icon-maskable.svg'],
      manifest: {
        name: 'CardLedger — カード明細マネージャー',
        short_name: 'CardLedger',
        description: 'カード利用明細をDB化し検索・仕訳集計・期間集計を行う家計管理アプリ',
        lang: 'ja',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#f8fafc',
        theme_color: '#10b981',
        icons: [
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: 'icon-maskable.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
        ],
      },
      workbox: {
        // 同一オリジン資産はキャッシュ。Google API/CDN はネットワーク優先。
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/(sheets|www)\.googleapis\.com\//,
            handler: 'NetworkOnly',
          },
        ],
      },
    }),
  ],
});
