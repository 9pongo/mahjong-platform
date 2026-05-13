// ════════════════════════════════════════
//  client/sw.js  —  Service Worker
//  - 靜態資源：Cache-First（離線可用）
//  - API / Socket.io：Network-Only（不快取）
// ════════════════════════════════════════

const CACHE_NAME = 'mahjong-v11';

// 安裝時預快取的靜態資源
const PRECACHE = [
  '/',
  '/index.html',
  '/pages/game.html',
  '/pages/solo.html',
  '/pages/social.html',
  '/pages/leaderboard.html',
  '/pages/profile.html',
  '/pages/history.html',
  '/pages/shop.html',
  '/pages/dojo.html',
  '/pages/player.html',
  '/pages/spectator.html',
  '/pages/events.html',
  '/pages/tournament.html',
  '/pages/achievements.html',
  '/js/auth.js',
  '/js/errorHandler.js',
  '/js/toast.js',
  '/js/dialog.js',
  '/js/pushClient.js',
  '/js/socket.js',
  '/js/gameClient.js',
  '/js/gameUI.js',
  '/js/soundManager.js',
  '/js/socialClient.js',
  '/js/userProfile.js',
  '/manifest.json',
];

// ── 安裝：預快取 ──────────────────────────
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      // 逐一嘗試快取，失敗不阻止安裝
      return Promise.allSettled(
        PRECACHE.map(url =>
          cache.add(url).catch(() => console.warn(`[SW] 無法快取 ${url}`))
        )
      );
    }).then(() => self.skipWaiting())
  );
});

// ── 啟動：清除舊快取 ──────────────────────
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ── Push 通知接收 ─────────────────────────
self.addEventListener('push', (e) => {
  let data = {};
  try { data = e.data?.json() || {}; } catch {}

  const title = data.title || '🀄 麻將平台';
  const opts  = {
    body:    data.body  || '',
    tag:     data.tag   || 'default',
    data:    data.data  || {},
    vibrate: [200, 100, 200],
    requireInteraction: false,
  };
  e.waitUntil(self.registration.showNotification(title, opts));
});

// ── 點擊通知 ──────────────────────────────
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = e.notification.data?.url || '/';
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      // 若已有開啟的頁面，聚焦並導航
      for (const client of list) {
        if ('focus' in client) {
          client.focus();
          if ('navigate' in client) client.navigate(url);
          return;
        }
      }
      // 否則開啟新視窗
      return clients.openWindow(url);
    })
  );
});

// ── Fetch 攔截 ────────────────────────────
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // API、socket.io → Network-Only（不快取動態資料）
  if (url.pathname.startsWith('/api/') ||
      url.pathname.startsWith('/socket.io/')) {
    e.respondWith(fetch(e.request));
    return;
  }

  // 靜態資源 → Cache-First（有快取直接回應，沒有再網路）
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;

      // 沒有快取 → 網路請求並順手存入快取
      return fetch(e.request).then(res => {
        if (!res || res.status !== 200 || res.type === 'opaque') return res;
        const clone = res.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
        return res;
      }).catch(() => {
        // 離線且無快取：若是 HTML 頁面，回傳首頁
        if (e.request.destination === 'document') {
          return caches.match('/');
        }
      });
    })
  );
});
