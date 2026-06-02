// ════════════════════════════════════════
//  client/sw.js  —  Service Worker
//  - 靜態資源：Cache-First（離線可用）
//  - API / Socket.io：Network-Only（不快取）
// ════════════════════════════════════════

const CACHE_NAME = 'mahjong-v60';

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
  '/pages/reset-password.html',
  '/pages/login.html',
  '/pages/achievements.html',
  '/pages/battlepass.html',
  '/socket.io/socket.io.js',   // ★ 預快取：確保 Railway 重啟時本地備援可用
  '/js/auth.js',
  '/js/analytics.js',
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
  '/images/lobby/bg_lobby.jpg',
  '/images/lobby/bg_lobby_portrait.jpg',
  '/images/mahjong/table-bg.jpg',
  '/images/mahjong/table-frame.png',
  // 個別牌面 PNG
  '/images/tiles/tile_back.png',
  '/images/tiles/tile_man_1.png', '/images/tiles/tile_man_2.png', '/images/tiles/tile_man_3.png',
  '/images/tiles/tile_man_4.png', '/images/tiles/tile_man_5.png', '/images/tiles/tile_man_6.png',
  '/images/tiles/tile_man_7.png', '/images/tiles/tile_man_8.png', '/images/tiles/tile_man_9.png',
  '/images/tiles/tile_circle_1.png', '/images/tiles/tile_circle_2.png', '/images/tiles/tile_circle_3.png',
  '/images/tiles/tile_circle_4.png', '/images/tiles/tile_circle_5.png', '/images/tiles/tile_circle_6.png',
  '/images/tiles/tile_circle_7.png', '/images/tiles/tile_circle_8.png', '/images/tiles/tile_circle_9.png',
  '/images/tiles/tile_bamboo_1.png', '/images/tiles/tile_bamboo_2.png', '/images/tiles/tile_bamboo_3.png',
  '/images/tiles/tile_bamboo_4.png', '/images/tiles/tile_bamboo_5.png', '/images/tiles/tile_bamboo_6.png',
  '/images/tiles/tile_bamboo_7.png', '/images/tiles/tile_bamboo_8.png', '/images/tiles/tile_bamboo_9.png',
  '/images/tiles/tile_wind_east.png', '/images/tiles/tile_wind_south.png',
  '/images/tiles/tile_wind_west.png', '/images/tiles/tile_wind_north.png',
  '/images/tiles/tile_dragon_zhong.png', '/images/tiles/tile_dragon_fa.png', '/images/tiles/tile_dragon_bai.png',
  '/images/tiles/tile_flower_1.png', '/images/tiles/tile_flower_2.png', '/images/tiles/tile_flower_3.png',
  '/images/tiles/tile_flower_4.png', '/images/tiles/tile_flower_5.png', '/images/tiles/tile_flower_6.png',
  '/images/tiles/tile_flower_7.png', '/images/tiles/tile_flower_8.png',
  // UI 圖示
  '/images/ui/icon_coin.png', '/images/ui/icon_diamond.png', '/images/ui/avatar_default.png',
  '/images/ui/btn_chi.png', '/images/ui/btn_ting.png',
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

  const title = data.title || '🌕 月見麻將';
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

  // API + socket.io 動態連線 → Network-Only
  if (url.pathname.startsWith('/api/') ||
      (url.pathname.startsWith('/socket.io/') && !url.pathname.endsWith('.js'))) {
    e.respondWith(fetch(e.request));
    return;
  }

  // socket.io.js → Cache-First（靜態 library，避免 Railway 重啟時載入失敗造成 io 未定義）
  if (url.pathname === '/socket.io/socket.io.js') {
    e.respondWith(
      caches.match(e.request).then(cached => {
        if (cached) return cached;
        return fetch(e.request).then(res => {
          if (res && res.status === 200) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
          }
          return res;
        });
      })
    );
    return;
  }

  // HTML 頁面 → Network-First（配合 server no-cache，確保每次取最新版）
  if (e.request.destination === 'document') {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          if (res && res.status === 200) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
          }
          return res;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  // 靜態資源（JS/CSS/圖片）→ Cache-First
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
