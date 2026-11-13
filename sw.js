// Service Worker tối giản cho GitHub Pages: network-first cho trang, KHÔNG ép cập nhật.
// Chỉ để trang cài được lên màn hình chính. Chỉ xử lý GET CÙNG origin: request tới API (khác origin,
// Supabase) KHÔNG bị chặn và KHÔNG bao giờ được lưu vào cache — dữ liệu học viên không nằm ở đây.
const TEN_CACHE = 'tcdat-pages-v9';
const TAI_SAN = ['./icon-192.png', './icon-512.png', './manifest.json', './app.js', './app.css'];

self.addEventListener('install', (e) => {
    e.waitUntil(caches.open(TEN_CACHE).then((c) => c.addAll(TAI_SAN)).catch(() => {}));
});

self.addEventListener('activate', (e) => {
    // origin github.io dùng chung cho mọi repo Pages của một tài khoản → chỉ dọn cache CỦA MÌNH (tiền tố tcdat-)
    e.waitUntil(caches.keys().then((ks) =>
        Promise.all(ks.filter((k) => k.startsWith('tcdat-') && k !== TEN_CACHE)
            .map((k) => caches.delete(k)))));
});

self.addEventListener('fetch', (e) => {
    const req = e.request;
    if (req.method !== 'GET') return;
    const url = new URL(req.url);
    if (url.origin !== self.location.origin) return;      // API / CDN: đi thẳng, không cache
    e.respondWith(fetch(req).catch(() => caches.match(req)));
});
