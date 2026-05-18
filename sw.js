// PWAインストール可能条件（ホーム画面追加）を満たすための、競合を100%回避する最小サービスワーカー
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  self.clients.claim();
});

// fetchイベントが存在することがPWAの必須要件です
self.addEventListener('fetch', (event) => {
  // すべてのリクエストをそのままネットワークから取得（Viteのホットリロードやキャッシュ競合を100%回避！）
  event.respondWith(fetch(event.request));
});
