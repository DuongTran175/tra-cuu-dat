// Mã giao diện Tra cứu DAT (tách khỏi index.html để CSP bỏ được 'unsafe-inline' trong script-src).
// Nạp SAU config.js (API_URL) và trước/cùng Alpine (defer) — app() phải có sẵn khi Alpine khởi động.
        const KHOA_TOKEN = 'tcdat_token';
        const KHOA_GHIM = 'tcdat_ghim';     // khóa thật = tcdat_ghim_<tên đăng nhập> (xem khoaGhim())
        const GIO_CU = 36;          // dữ liệu cũ hơn 36 giờ → cảnh báo
        // Địa chỉ Edge Function lấy từ config.js (không phải bí mật). Còn placeholder <...> = chưa cấu hình.
        const API_URL = String((window.TCDAT_CAU_HINH || {}).API_URL || '').replace(/\/+$/, '');
        const CHUA_CAU_HINH = !API_URL || API_URL.indexOf('<') >= 0;

        function app() {
            return {
                token: '',
                chuaCauHinh: CHUA_CAU_HINH,
                user: { ndk_name: '', username: '', is_admin: false, quyen: [] },
                dn: { username: '', password: '', ghiNho: true, loi: '', dang: false },
                tab: 'tim',
                danhThuc: false,
                thongBao: '',
                khongCoQuyen: '',
                dongBoLuc: '',
                cu: false,
                daiDuLieu: '',
                goiY: { hang: [], trung_tam: [], nguoi_quan_ly: [] },
                loc: { q: '', ho_ten: '', cccd: '', bien_so: '', giao_vien: '', khoa: '',
                       ma_dk: '', hang: '', trung_tam: '', nguoi_nop: '' },
                ketQua: { results: [], total: 0, bi_cat: 0, quyen: null },
                daTim: false, dangTai: false, loiTim: '',
                locXe: { trung_tam: '', hang: '', bien_so: '' },
                dsXe: { xe: [], total: 0 },
                daTaiXe: false, dangTaiXe: false, loiXe: '',
                ctXe: { mo: false, dang: false, loi: '', bien_so: '', trung_tam: '',
                        khoa: [], khoa_an: 0 },
                gv: { mo: false, loi: '', ds: [] },
                ghim: [],

                // ---------- khởi động ----------
                async khoiDong() {
                    this.token = localStorage.getItem(KHOA_TOKEN) || '';
                    this.taiPhienBan();
                    if (this.token) { await this.nhanQuyen(); }
                    if ('serviceWorker' in navigator) {
                        navigator.serviceWorker.register('./sw.js').catch(() => {});
                    }
                },

                // ---------- gọi API ----------
                async api(duong, tham) {
                    const q = new URLSearchParams();
                    Object.keys(tham || {}).forEach(k => {
                        const v = tham[k];
                        if (v !== '' && v !== null && v !== undefined) q.set(k, v);
                    });
                    const url = API_URL + duong + (q.toString() ? '?' + q.toString() : '');
                    // Hàm khởi động lạnh → request đầu có thể chậm: hiện màn hình "đang kết nối"
                    const hen = setTimeout(() => { this.danhThuc = true; }, 3500);
                    let res;
                    try {
                        res = await fetch(url, { headers: this.token
                            ? { 'Authorization': 'Bearer ' + this.token } : {} });
                    } catch (e) {
                        throw { thongBao: 'Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.' };
                    } finally {
                        clearTimeout(hen);
                        this.danhThuc = false;
                    }
                    let du = null;
                    try { du = await res.json(); } catch (e) { du = null; }
                    if (res.ok) return du;
                    if (res.status === 401) {
                        this.dangXuat(true);
                        throw { thongBao: 'Phiên đăng nhập đã hết hoặc tài khoản bị khóa. Hãy đăng nhập lại.' };
                    }
                    const d = du && du.detail;
                    let msg = typeof d === 'string' ? d : (d && d.thong_bao) || 'Lỗi ' + res.status;
                    if (res.status === 403) { this.khongCoQuyen = msg; }
                    throw { thongBao: msg, ma: res.status, chiTiet: d };
                },

                async taiPhienBan() {
                    try {
                        const r = await fetch(API_URL + '/version');
                        const d = await r.json();
                        this.dongBoLuc = d.dong_bo_luc || '';
                    } catch (e) { /* bỏ qua */ }
                    this.capNhatDai();
                },

                capNhatDai() {
                    if (!this.dongBoLuc) {
                        this.daiDuLieu = 'Chưa có thông tin thời điểm cập nhật dữ liệu';
                        this.cu = true;
                        return;
                    }
                    const d = new Date(this.dongBoLuc);
                    const p = (n) => String(n).padStart(2, '0');
                    this.daiDuLieu = 'Dữ liệu cập nhật lúc ' + p(d.getDate()) + '/' + p(d.getMonth() + 1)
                        + '/' + d.getFullYear() + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
                    this.cu = (Date.now() - d.getTime()) > GIO_CU * 3600 * 1000;
                    if (this.cu) { this.daiDuLieu += ' — đã cũ hơn ' + GIO_CU + ' giờ'; }
                },

                bao(noi) {
                    this.thongBao = noi;
                    setTimeout(() => { this.thongBao = ''; }, 2500);
                },

                // ---------- đăng nhập ----------
                async dangNhap() {
                    this.dn.loi = '';
                    this.dn.dang = true;
                    const hen = setTimeout(() => { this.danhThuc = true; }, 3500);
                    try {
                        const res = await fetch(API_URL + '/auth/login', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ username: this.dn.username,
                                                   password: this.dn.password,
                                                   remember_me: this.dn.ghiNho }),
                        });
                        const d = await res.json().catch(() => ({}));
                        if (!res.ok) {
                            this.dn.loi = typeof d.detail === 'string' ? d.detail : 'Lỗi ' + res.status;
                            return;
                        }
                        this.token = d.token;
                        localStorage.setItem(KHOA_TOKEN, d.token);
                        this.dn.password = '';
                        await this.nhanQuyen();
                        this.taiPhienBan();
                    } catch (e) {
                        this.dn.loi = 'Không kết nối được máy chủ.';
                    } finally {
                        clearTimeout(hen);
                        this.danhThuc = false;
                        this.dn.dang = false;
                    }
                },

                async nhanQuyen() {
                    try {
                        const d = await this.api('/auth/me');
                        this.user = d;
                        this.napGhim();
                        this.khongCoQuyen = (d.quyen || []).indexOf('TRACUU_DAT') < 0
                            ? 'Tài khoản của bạn chưa được cấp quyền Tra cứu biển số DAT.' : '';
                        if (!this.khongCoQuyen) { this.taiGoiY(); }
                    } catch (e) {
                        if (e && e.ma !== 403 && e.thongBao) { this.bao(e.thongBao); }
                    }
                },

                // Ghim chứa CCCD + ngày sinh học viên → lưu RIÊNG từng tài khoản (máy dùng chung)
                khoaLuuGhim() {
                    const ten = (this.user && this.user.username) || '';
                    return ten ? KHOA_GHIM + '_' + ten : '';
                },
                napGhim() {
                    try { localStorage.removeItem(KHOA_GHIM); } catch (e) { /* khóa cũ không gắn tên: bỏ */ }
                    const k = this.khoaLuuGhim();
                    try { this.ghim = k ? JSON.parse(localStorage.getItem(k) || '[]') : []; }
                    catch (e) { this.ghim = []; }
                },

                dangXuat(imLang) {
                    // Người dùng tự bấm Đăng xuất (không phải token hết hạn) → hỏi có xóa ghim khỏi máy không
                    if (!imLang && this.ghim.length && this.khoaLuuGhim()
                            && window.confirm('Xóa luôn các học viên đã ghim khỏi máy này?')) {
                        try { localStorage.removeItem(this.khoaLuuGhim()); } catch (e) { /* bỏ qua */ }
                    }
                    this.ghim = [];
                    this.user = { ndk_name: '', username: '', is_admin: false, quyen: [] };
                    this.token = '';
                    localStorage.removeItem(KHOA_TOKEN);
                    this.ketQua = { results: [], total: 0, bi_cat: 0, quyen: null };
                    this.dsXe = { xe: [], total: 0 };
                    this.daTim = false;
                    this.daTaiXe = false;
                    this.khongCoQuyen = '';
                    if (!imLang) { this.dn.loi = ''; }
                },

                async taiGoiY() {
                    try {
                        const d = await this.api('/phanxe/goi-y');
                        this.goiY = { hang: d.hang || [], trung_tam: d.trung_tam || [],
                                      nguoi_quan_ly: d.nguoi_quan_ly || [] };
                    } catch (e) { /* không có gợi ý vẫn tra cứu được */ }
                },

                // ---------- tab Tra cứu ----------
                async tim() {
                    this.loiTim = '';
                    this.dangTai = true;
                    try {
                        this.ketQua = await this.api('/phanxe/tim', this.loc);
                        this.daTim = true;
                    } catch (e) {
                        this.loiTim = e.thongBao || 'Lỗi';
                        this.ketQua = { results: [], total: 0, bi_cat: 0, quyen: null };
                    } finally { this.dangTai = false; }
                },

                xoaLoc() {
                    Object.keys(this.loc).forEach(k => { this.loc[k] = ''; });
                    this.ketQua = { results: [], total: 0, bi_cat: 0, quyen: null };
                    this.daTim = false;
                    this.loiTim = '';
                },

                // ---------- tab Theo xe ----------
                vaoTabXe() {
                    this.tab = 'xe';
                    if (!this.daTaiXe && !this.dangTaiXe && !this.khongCoQuyen) { this.taiXe(); }
                },

                async taiXe() {
                    this.loiXe = '';
                    this.dangTaiXe = true;
                    try {
                        this.dsXe = await this.api('/phanxe/xe', this.locXe);
                        this.daTaiXe = true;
                    } catch (e) {
                        this.loiXe = e.thongBao || 'Lỗi';
                    } finally { this.dangTaiXe = false; }
                },

                moXeTuHV(r) { this.moXe(r.BienSoXe, r.TrungTam, 2); },

                async moXe(bienSo, trungTam, soKhoa) {
                    this.ctXe = { mo: true, dang: true, loi: '', bien_so: bienSo,
                                  trung_tam: trungTam, khoa: [], khoa_an: 0 };
                    try {
                        const d = await this.api('/phanxe/xe/chi-tiet',
                            { bien_so: bienSo, trung_tam: trungTam, so_khoa: soKhoa });
                        this.ctXe.khoa = d.khoa || [];
                        this.ctXe.khoa_an = d.khoa_an || 0;
                    } catch (e) {
                        this.ctXe.loi = e.thongBao || 'Lỗi';
                    } finally { this.ctXe.dang = false; }
                },

                // ---------- giáo viên (bản Internet: không có hồ sơ chi tiết) ----------
                async moGV(r) {
                    this.gv = { mo: true, loi: '', ds: [] };
                    try {
                        const d = await this.api('/phanxe/giao-vien/chi-tiet',
                            { ma: r.MaGV, trung_tam: r.TrungTam });
                        this.gv.ds = d.giao_vien || [];
                    } catch (e) {
                        this.gv.loi = e.thongBao || 'Lỗi';
                    }
                },

                // ---------- ghim (lưu trên máy này) ----------
                khoaGhim(r) { return [r.TrungTam || '', r.MaKH || '', r.MaDK || ''].join('|'); },

                daGhim(r) {
                    const k = this.khoaGhim(r);
                    return this.ghim.some(x => this.khoaGhim(x) === k);
                },

                bamGhim(r) {
                    const k = this.khoaGhim(r);
                    const i = this.ghim.findIndex(x => this.khoaGhim(x) === k);
                    if (i >= 0) {
                        this.ghim.splice(i, 1);
                        this.bao('Đã bỏ ghim ' + (r.HoVaTen || ''));
                    } else {
                        const d = new Date();
                        const p = (n) => String(n).padStart(2, '0');
                        this.ghim.unshift(Object.assign({}, r, {
                            _ghim_luc: p(d.getDate()) + '/' + p(d.getMonth() + 1) + '/' + d.getFullYear(),
                        }));
                        this.bao('Đã ghim ' + (r.HoVaTen || ''));
                    }
                    try {
                        const k = this.khoaLuuGhim();
                        if (k) { localStorage.setItem(k, JSON.stringify(this.ghim)); }
                    }
                    catch (e) { this.bao('Máy đã hết chỗ lưu, hãy bớt bản ghim'); }
                },
            };
        }
