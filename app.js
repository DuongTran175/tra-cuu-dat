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
                // Ghi nhớ đăng nhập MẶC ĐỊNH TẮT: token sống lâu trên máy có thể là máy dùng chung
                dn: { username: '', password: '', ghiNho: false, loi: '', dang: false },
                tab: 'tim',
                ngan: false,            // ngăn kéo (màn hẹp)
                hienMK: false,          // hiện/ẩn mật khẩu ở màn đăng nhập
                danhThuc: false,
                thongBao: '',
                khongCoQuyen: '',
                dongBoLuc: '',
                cu: false,
                daiDuLieu: '',
                goiY: { hang: [], trung_tam: [], nguoi_quan_ly: [], khoa: [], bien_so: [], giao_vien: [] },
                loc: { q: '', ho_ten: '', cccd: '', bien_so: '', giao_vien: '', khoa: '',
                       ma_dk: '', hang: '', trung_tam: '', nguoi_nop: '' },
                // Bảng chọn DÙNG CHUNG (Khóa / Biển số / Giáo viên / Người quản lý) — thay <datalist> (iOS không hiện gợi ý)
                chon: { mo: false, loai: '', tim: '', ds: [] },
                ketQua: { results: [], total: 0, bi_cat: 0, quyen: null },
                daTim: false, dangTai: false, loiTim: '',
                locXe: { trung_tam: '', hang: '' },    // biển số lọc TẠI MÁY qua xeTim, không gửi API
                xeTim: '',
                dsXe: { xe: [], total: 0 },
                daTaiXe: false, dangTaiXe: false, loiXe: '',
                dsKhoa: { khoa: [], trung_tam: [], total: 0 },
                locKhoa: { trung_tam: '', tim: '' },
                daTaiKhoa: false, dangTaiKhoa: false, loiKhoa: '',
                ctKhoa: { mo: false, dang: false, loi: '', khoa: {}, vehicles: [], total_hv: 0, quyen: null },
                ctXe: { mo: false, dang: false, loi: '', bien_so: '', trung_tam: '',
                        khoa: [], khoa_an: 0 },
                gv: { mo: false, loi: '', ds: [] },
                ghim: [],
                ghimTim: '', ghimTT: '', ghimHang: '',

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
                    this.dsKhoa = { khoa: [], trung_tam: [], total: 0 };
                    this.ctKhoa = this.ctKhoaRong();
                    this.ctXe.mo = false;
                    this.gv.mo = false;
                    this.chon = { mo: false, loai: '', tim: '', ds: [] };
                    this.locXe = { trung_tam: '', hang: '' };
                    this.locKhoa = { trung_tam: '', tim: '' };
                    this.xeTim = '';
                    this.ghimTim = '';
                    this.ghimTT = '';
                    this.ghimHang = '';
                    this.tab = 'tim';
                    this.ngan = false;
                    this.hienMK = false;
                    this.daTim = false;
                    this.daTaiXe = false;
                    this.daTaiKhoa = false;
                    this.loiKhoa = '';
                    this.khongCoQuyen = '';
                    if (!imLang) { this.dn.loi = ''; }
                },

                async taiGoiY() {
                    try {
                        const d = await this.api('/phanxe/goi-y');
                        this.goiY = { hang: d.hang || [], trung_tam: d.trung_tam || [],
                                      nguoi_quan_ly: d.nguoi_quan_ly || [],
                                      khoa: d.khoa || [], bien_so: d.bien_so || [],
                                      giao_vien: d.giao_vien || [] };
                        // Tab Theo xe: mặc định trung tâm ĐẦU TIÊN (không có mục "tất cả")
                        if (!this.locXe.trung_tam && this.goiY.trung_tam.length) {
                            this.locXe.trung_tam = this.goiY.trung_tam[0];
                        }
                    } catch (e) { /* không có gợi ý vẫn tra cứu được */ }
                },

                // ---------- điều hướng ----------
                doiTab(t) {
                    this.tab = t;
                    this.ngan = false;
                    window.scrollTo(0, 0);
                    if (this.khongCoQuyen) { return; }
                    if (t === 'xe' && !this.daTaiXe && !this.dangTaiXe) { this.taiXe(); }
                    if (t === 'khoa' && !this.daTaiKhoa && !this.dangTaiKhoa) { this.taiKhoa(); }
                },

                tieuDe() {
                    return { tim: 'Tra cứu DAT', xe: 'Theo xe', khoa: 'Khóa học', ghim: 'Ghim ghi nhớ' }[this.tab] || '';
                },
                phuDe() {
                    return { tim: 'Tìm học viên, xe, giáo viên', xe: 'Danh sách xe và số học viên',
                             khoa: 'Khóa đã phân xe', ghim: 'Lưu trên máy này' }[this.tab] || '';
                },

                // ---------- tiện ích văn bản ----------
                // 'đ' KHÔNG tách được bằng NFD nên phải đổi tay; dấu tổ hợp viết bằng mã \u03xx
                boDau(s) {
                    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
                        .replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();
                },
                // Gộp nhiều trường thành một chuỗi đã bỏ dấu để so khớp "chứa"
                chiSo(cac) { return this.boDau((cac || []).join(' ')); },
                chuCaiDau(ten) {
                    const t = String(ten || '').trim().split(/\s+/).filter(x => x);
                    if (!t.length) { return '?'; }
                    const a = t[0].charAt(0);
                    return (t.length > 1 ? a + t[t.length - 1].charAt(0) : a).toUpperCase();
                },

                // Câu giải thích vì sao thiếu học viên: tách "của người khác" (đúng thiết kế) với "chưa ghi người nộp"
                lyDoAn() {
                    const q = this.ketQua.quyen || {};
                    const n = q.da_an || 0;
                    const khac = q.an_nguoi_khac;
                    const chuaRo = q.an_chua_ro_chu;
                    if (!n) { return ''; }
                    const coKhac = khac !== null && khac !== undefined;
                    const coChuaRo = chuaRo !== null && chuaRo !== undefined;
                    // Máy chủ bản cũ chưa trả 2 con số này → giữ câu chung
                    if (!coKhac && !coChuaRo) { return 'Đã ẩn ' + n + ' học viên không do bạn quản lý.'; }
                    const ve = [];
                    if (khac) { ve.push(khac + ' của người khác'); }
                    if (chuaRo) { ve.push(chuaRo + ' chưa ghi người nộp hồ sơ'); }
                    return 'Đã ẩn ' + n + ' học viên' + (ve.length ? ' (' + ve.join(', ') + ').' : '.');
                },

                // Xe chạy phiên (dùng chung cả khóa): sắp xếp theo số để dễ đọc
                dsPhien(r) {
                    return (r.XePhien || []).slice().sort((a, b) =>
                        String(a).localeCompare(String(b), 'vi', { numeric: true }));
                },

                // ---------- bảng chọn dùng chung ----------
                moChon(loai) {
                    const nguon = { khoa: this.goiY.khoa, bien_so: this.goiY.bien_so,
                                    giao_vien: this.goiY.giao_vien, nguoi_nop: this.goiY.nguoi_quan_ly };
                    this.chon = { mo: true, loai: loai, tim: '', ds: nguon[loai] || [] };
                },
                tenChon() {
                    return { khoa: 'Chọn khóa', bien_so: 'Chọn biển số', giao_vien: 'Chọn giáo viên',
                             nguoi_nop: 'Chọn người quản lý hồ sơ' }[this.chon.loai] || '';
                },
                chonXong(giaTri) {
                    if (this.chon.loai) { this.loc[this.chon.loai] = giaTri; }
                    this.chon.mo = false;
                },
                get chonLoc() {
                    const q = this.boDau(this.chon.tim).trim();
                    const ds = q ? this.chon.ds.filter(g => this.boDau(g).indexOf(q) >= 0) : this.chon.ds;
                    return ds.slice(0, 200);       // 200 dòng đầu là đủ chọn; gõ thêm để thu hẹp
                },
                // Chữ người dùng gõ mà không có trong danh sách → cho "+ Dùng '…'"
                get chonDungRieng() {
                    const t = String(this.chon.tim || '').trim();
                    return t && this.chon.ds.indexOf(t) < 0 ? t : '';
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
                vaoTabXe() { this.doiTab('xe'); },

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

                // Lọc biển số TẠI MÁY (gõ liền, không dấu cách/gạch đều khớp) — không gọi API mỗi phím
                get xeLoc() {
                    const q = this.boDau(this.xeTim).replace(/[^a-z0-9]/g, '');
                    if (!q) { return this.dsXe.xe || []; }
                    return (this.dsXe.xe || []).filter(x =>
                        this.boDau(x.BienSoXe).replace(/[^a-z0-9]/g, '').indexOf(q) >= 0);
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

                // ---------- tab Khóa ----------
                async taiKhoa() {
                    this.loiKhoa = '';
                    this.dangTaiKhoa = true;
                    try {
                        this.dsKhoa = await this.api('/phanxe/khoa', { trung_tam: this.locKhoa.trung_tam });
                        this.daTaiKhoa = true;
                    } catch (e) {
                        this.loiKhoa = e.thongBao || 'Lỗi';
                    } finally { this.dangTaiKhoa = false; }
                },

                get khoaLoc() {
                    const q = this.boDau(this.locKhoa.tim).trim();
                    if (!q) { return this.dsKhoa.khoa || []; }
                    return (this.dsKhoa.khoa || []).filter(k =>
                        this.chiSo([k.TenKhoa, k.HangGPLX, k.MaKH]).indexOf(q) >= 0);
                },

                ctKhoaRong() {
                    return { mo: false, dang: false, loi: '', khoa: {}, vehicles: [], total_hv: 0, quyen: null };
                },

                async moKhoa(k) {
                    this.ctKhoa = this.ctKhoaRong();
                    this.ctKhoa.mo = true;
                    this.ctKhoa.dang = true;
                    // Hiện ngay phần đầu khóa từ thẻ vừa bấm, chi tiết xe/học viên đến sau
                    this.ctKhoa.khoa = { MaKH: k.MaKH, TrungTam: k.TrungTam, TenKhoa: k.TenKhoa,
                                         HangGPLX: k.HangGPLX, NgayKG: k.NgayKG, NgayBG: k.NgayBG,
                                         XePhien: k.XePhien || [], XePhienNhan: k.XePhienNhan || '' };
                    try {
                        // Mã khóa có thể chứa "/", khoảng trắng, dấu tiếng Việt → bắt buộc encodeURIComponent
                        const d = await this.api('/phanxe/khoa/' + encodeURIComponent(k.MaKH),
                            { trung_tam: k.TrungTam });
                        this.ctKhoa.khoa = d.khoa || this.ctKhoa.khoa;
                        this.ctKhoa.vehicles = d.vehicles || [];
                        this.ctKhoa.total_hv = d.total_hv || 0;
                        this.ctKhoa.quyen = d.quyen || null;
                    } catch (e) {
                        this.ctKhoa.loi = e.thongBao || 'Lỗi';
                    } finally { this.ctKhoa.dang = false; }
                },

                // Học viên trong chi tiết khóa không mang thông tin khóa → ghép vào để ghim như thẻ thường
                hvKhoa(h) {
                    const k = this.ctKhoa.khoa || {};
                    return Object.assign({}, h, { TrungTam: k.TrungTam, MaKH: k.MaKH, TenKhoa: k.TenKhoa,
                                                  HangGPLX: k.HangGPLX, NgayKG: k.NgayKG, NgayBG: k.NgayBG });
                },

                // ---------- giáo viên (bản Internet: không có hồ sơ chi tiết) ----------
                async moGV(r, trungTam) {
                    this.gv = { mo: true, loi: '', ds: [] };
                    try {
                        // Có mã GV thì tra theo mã; không có thì tra theo tên (máy chủ bỏ dấu để so)
                        const tham = { trung_tam: trungTam || r.TrungTam };
                        if (r.MaGV) { tham.ma = r.MaGV; } else { tham.ten = r.TenGV; }
                        const d = await this.api('/phanxe/giao-vien/chi-tiet', tham);
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

                get ghimDsTT() {
                    const t = {};
                    this.ghim.forEach(r => { if (r.TrungTam) { t[r.TrungTam] = 1; } });
                    return Object.keys(t).sort();
                },
                get ghimDsHang() {
                    const t = {};
                    this.ghim.forEach(r => { if (r.HangGPLX) { t[r.HangGPLX] = 1; } });
                    return Object.keys(t).sort();
                },
                get ghimLoc() {
                    const q = this.boDau(this.ghimTim).trim();
                    return this.ghim.filter(r =>
                        (!this.ghimTT || r.TrungTam === this.ghimTT)
                        && (!this.ghimHang || r.HangGPLX === this.ghimHang)
                        && (!q || this.chiSo([r.HoVaTen, r.MaDK, r.SoCMT, r.BienSoXe, r.TenGV, r.TenKhoa]).indexOf(q) >= 0));
                },

                luuGhim() {
                    try {
                        const k = this.khoaLuuGhim();
                        if (k) { localStorage.setItem(k, JSON.stringify(this.ghim)); }
                    }
                    catch (e) { this.bao('Máy đã hết chỗ lưu, hãy bớt bản ghim'); }
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
                    this.luuGhim();
                },

                xoaHetGhim() {
                    if (!this.ghim.length) { return; }
                    if (!window.confirm('Bỏ ghim tất cả ' + this.ghim.length + ' học viên khỏi máy này?')) { return; }
                    this.ghim = [];
                    this.luuGhim();
                    this.bao('Đã xóa hết bản ghim');
                },
            };
        }
