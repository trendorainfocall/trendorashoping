// Trendora — Service Worker
// Versiyanı hər dəyişiklikdə artırın ki, köhnə keş təmizlənsin.
const CACHE_VERSION = 'trendora-v1';
const STATIC_CACHE = `${CACHE_VERSION}-static`;

// Tətbiqin işə düşməsi üçün minimum lazım olan "app shell" faylları.
const APP_SHELL = [
  '/',
  '/index.html',
  '/css/style.css',
  '/js/app.js',
  '/manifest.json',
  '/images/bg-photo.jpg',
  '/images/bg-pattern.png',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

// ---------- Quraşdırma: app shell-i keşə yaz ----------
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

// ---------- Aktivasiya: köhnə keşləri təmizlə ----------
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key.startsWith('trendora-') && key !== STATIC_CACHE)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// ---------- Fetch: API sorğuları üçün network-first, statik fayllar üçün cache-first ----------
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Yalnız GET sorğularını idarə et
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Başqa domenlərə (CDN və s.) toxunma — brauzerin öz davranışına burax
  if (url.origin !== self.location.origin) return;

  // API sorğuları: həmişə şəbəkədən al, uğursuz olsa keşdən (varsa) qaytar
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const clone = response.clone();
          caches.open(STATIC_CACHE).then((cache) => cache.put(request, clone));
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // Statik fayllar (HTML, CSS, JS, şəkillər, ikonlar): cache-first, arxa fonda yenilə
  event.respondWith(
    caches.match(request).then((cached) => {
      const networkFetch = fetch(request)
        .then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(STATIC_CACHE).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => cached);

      return cached || networkFetch;
    })
  );
});
