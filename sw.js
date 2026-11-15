// Service Worker tối giản cho GitHub Pages: network-first cho trang, KHÔNG ép cập nhật.
// Chỉ để trang cài được lên màn hình chính (+ nhận THÔNG BÁO ĐẨY nền về lệnh bàn giao máy DAT, GĐ2). Chỉ xử lý GET CÙNG origin: request tới API (khác origin,
// Supabase) KHÔNG bị chặn và KHÔNG bao giờ được lưu vào cache — dữ liệu học viên không nằm ở đây.
const TEN_CACHE = 'tcdat-pages-v14';
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

// ---------- Thông báo đẩy (Web Push) ----------
// QUAN TRỌNG (iOS): MỌI lượt push PHẢI hiện thông báo — không hiện là iOS thu hồi quyền. Vì vậy xuLyPush LUÔN gọi
// showNotification, kể cả khi payload hỏng (dùng câu mặc định). Payload chỉ có {t, b, n, u}: tiêu đề, nội dung,
// số lệnh đang chờ, đường dẫn mở; không có dữ liệu học viên.
function cat(s, toiDa) { return Array.from(String(s)).slice(0, toiDa).join(''); }

function xuLyPush(duLieu, reg, nav) {
    let t = 'Máy DAT chờ bạn xác nhận';
    let b = 'Mở ứng dụng để xem.';
    let n = -1;                                   // -1 = payload không nói số → không đụng tới số trên icon
    let u = './';
    let d = null;
    try { d = duLieu && typeof duLieu.json === 'function' ? duLieu.json() : null; } catch (e) { d = null; }
    if (d && typeof d === 'object') {
        if (typeof d.t === 'string' && d.t.trim()) { t = cat(d.t, 80); }
        if (typeof d.b === 'string') { b = cat(d.b, 200); }
        if (typeof d.n === 'number' && Number.isFinite(d.n)) { n = Math.max(0, Math.min(99, Math.trunc(d.n))); }
        if (typeof d.u === 'string' && (d.u.indexOf('./') === 0 || d.u.charAt(0) === '#')) { u = d.u; }
    }
    const hien = Promise.resolve(reg.showNotification(t, {
        body: b, tag: u.indexOf('#ghim') >= 0 ? 'tcdat-nho' : 'tcdat-cho', renotify: true,
        icon: './icon-192.png', badge: './icon-192.png', data: { u: u },
    }));
    return hien.then(() => {
        try {
            if (n > 0 && nav && typeof nav.setAppBadge === 'function') { return Promise.resolve(nav.setAppBadge(n)).catch(() => {}); }
            if (n === 0 && nav && typeof nav.clearAppBadge === 'function') { return Promise.resolve(nav.clearAppBadge()).catch(() => {}); }
        } catch (e) { /* trình duyệt không có Badging API: bỏ qua */ }
    });
}

self.addEventListener('push', (e) => {
    e.waitUntil(xuLyPush(e.data, self.registration, self.navigator));
});

// Bấm thông báo: có cửa sổ của ứng dụng thì đưa lên trước + báo nó mở hộp Máy DAT; không có thì mở mới.
async function moTuThongBao(u) {
    const dich = (typeof u === 'string' && (u.indexOf('./') === 0 || u.charAt(0) === '#')) ? u : './';
    const goc = self.registration.scope;
    const ds = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of ds) {
        if (c.url.indexOf(goc) === 0) {
            try { await c.focus(); } catch (e) { /* bỏ qua */ }
            c.postMessage({ loai: 'mo', u: dich });
            return;
        }
    }
    await self.clients.openWindow(new URL(dich, goc).href);
}

self.addEventListener('notificationclick', (e) => {
    e.notification.close();
    const u = e.notification.data && e.notification.data.u;
    e.waitUntil(moTuThongBao(u));
});
