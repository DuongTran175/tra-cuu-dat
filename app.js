// Mã giao diện Tra cứu DAT (tách khỏi index.html để CSP bỏ được 'unsafe-inline' trong script-src).
// Nạp SAU config.js (API_URL) và trước/cùng Alpine (defer) — app() phải có sẵn khi Alpine khởi động.
        const KHOA_TOKEN = 'tcdat_token';
        const KHOA_GHIM = 'tcdat_ghim';     // khóa thật = tcdat_ghim_<tên đăng nhập> (xem khoaGhim())
        const GIO_CU = 36;          // dữ liệu cũ hơn 36 giờ → cảnh báo
        // Địa chỉ Edge Function lấy từ config.js (không phải bí mật). Còn placeholder <...> = chưa cấu hình.
        const API_URL = String((window.TCDAT_CAU_HINH || {}).API_URL || '').replace(/\/+$/, '');
        const CHUA_CAU_HINH = !API_URL || API_URL.indexOf('<') >= 0;

        // Ảnh GV: fetch có Authorization → blob → URL cục bộ (token KHÔNG đi trong URL ảnh để khỏi lọt vào nhật ký).
        // Đệm ngoài đối tượng Alpine: '' nghĩa là GV không có ảnh (đã hỏi, 404). Đăng xuất → thu hồi hết.
        const ANH_GV = new Map();
        const DANG_TAI_ANH = new Set();
        const TOI_DA_GHI_CHU = 300;
        const TOI_DA_ANH_NHO = 8;      // hộp xe / hộp khóa: tối đa bấy nhiêu ảnh nhỏ mỗi lần mở (mỗi ảnh ăn 1 lượt xem)

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
                chon: { mo: false, loai: '', tim: '', ds: [], dich: '', nhan: {} },
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
                gv: { mo: false, loi: '', ds: [], luot: 0 },
                anhGv: {},              // khóa `trung_tâm|mã GV` → blob URL (bản sao phản ứng của ANH_GV)
                ghim: [],
                ghimTim: '', ghimTT: '', ghimHang: '',
                ghimMuc: 'dang',        // 'dang' = Đang chạy · 'xong' = Đã hoàn thành DAT
                // Danh sách "Đã chạy xong DAT" lấy từ cloud (khóa so khớp: trung_tâm|mã_kh|mã_đk)
                dsXong: { ds: [], khoa: {}, dang: false, loi: '' },
                // Tab Máy DAT
                may: { bien: '', dang: false, loi: '', co: false, kq: null },
                dsNguoi: [], daTaiNguoi: false,
                xn: { mo: false, r: {}, kieu: 'kho', den: 'KHO', denTen: '', ghiChu: '', dang: false, loi: '' },
                bg: { mo: false, bien: '', tu: 'KHO', tuTen: 'Kho', den: '', denTen: '', ghiChu: '', dang: false, loi: '' },
                an: { mo: false, id: 0, lyDo: '', dang: false, loi: '' },
                mangOk: navigator.onLine !== false,   // đèn Online/Offline ở đầu trang

                // ---------- khởi động ----------
                async khoiDong() {
                    window.addEventListener('online', () => { this.mangOk = true; });
                    window.addEventListener('offline', () => { this.mangOk = false; });
                    this.token = localStorage.getItem(KHOA_TOKEN) || '';
                    this.taiPhienBan();
                    if (this.token) { await this.nhanQuyen(); }
                    if ('serviceWorker' in navigator) {
                        navigator.serviceWorker.register('./sw.js').catch(() => {});
                    }
                },

                // ---------- gọi API ----------
                async api(duong, tham, tuyChon) {
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
                        const init = { headers: this.token ? { 'Authorization': 'Bearer ' + this.token } : {} };
                        if (tuyChon && tuyChon.body) {
                            init.method = 'POST';
                            init.headers['Content-Type'] = 'application/json';
                            init.body = JSON.stringify(tuyChon.body);
                        }
                        res = await fetch(url, init);
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
                    // Máy chủ bản cũ chưa có tuyến mới → báo nhẹ, không văng
                    if (res.status === 404 && d === 'Not Found') { msg = 'Máy chủ chưa cập nhật tính năng này, thử lại sau.'; }
                    // Chỉ lỗi "thiếu quyền Tra cứu DAT" mới khóa cả trang; 403 nghiệp vụ (không phải chủ hồ sơ...) chỉ báo tại chỗ
                    if (res.status === 403 && d && d.loai === 'thieu_quyen') { this.khongCoQuyen = msg; }
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
                        if (!this.khongCoQuyen) { this.taiGoiY(); this.taiXong(); }
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
                    this.thuHoiAnh();
                    this.user = { ndk_name: '', username: '', is_admin: false, quyen: [] };
                    this.token = '';
                    localStorage.removeItem(KHOA_TOKEN);
                    this.ketQua = { results: [], total: 0, bi_cat: 0, quyen: null };
                    this.dsXe = { xe: [], total: 0 };
                    this.dsKhoa = { khoa: [], trung_tam: [], total: 0 };
                    this.ctKhoa = this.ctKhoaRong();
                    this.ctXe.mo = false;
                    this.gv = { mo: false, loi: '', ds: [], luot: 0 };
                    this.chon = { mo: false, loai: '', tim: '', ds: [], dich: '', nhan: {} };
                    this.ghimMuc = 'dang';
                    this.dsXong = { ds: [], khoa: {}, dang: false, loi: '' };
                    this.may = { bien: '', dang: false, loi: '', co: false, kq: null };
                    this.dsNguoi = [];
                    this.daTaiNguoi = false;
                    this.xn = { mo: false, r: {}, kieu: 'kho', den: 'KHO', denTen: '', ghiChu: '', dang: false, loi: '' };
                    this.bg = { mo: false, bien: '', tu: 'KHO', tuTen: 'Kho', den: '', denTen: '', ghiChu: '', dang: false, loi: '' };
                    this.an = { mo: false, id: 0, lyDo: '', dang: false, loi: '' };
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
                    if (t === 'ghim' || t === 'may') { this.taiXong(); }      // đổi tab thì nạp lại danh sách đã xong
                },

                tieuDe() {
                    return { tim: 'Tra cứu DAT', xe: 'Theo xe', khoa: 'Khóa học', ghim: 'Ghim ghi nhớ', may: 'Máy DAT' }[this.tab] || '';
                },
                phuDe() {
                    return { tim: 'Tìm học viên để biết xe và giáo viên DAT',
                             xe: 'Tra nhanh một biển số và học viên trên xe',
                             khoa: 'Các khóa đã phân xe',
                             ghim: 'Học viên bạn đã ghim — lưu ngay trên máy này',
                             may: 'Ai đang giữ máy DAT, lịch sử bàn giao' }[this.tab] || '';
                },
                taiLai() { window.location.reload(); },

                // ---------- tiện ích văn bản ----------
                // 'đ' KHÔNG tách được bằng NFD nên phải đổi tay; dấu tổ hợp viết bằng mã \u03xx
                boDau(s) {
                    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
                        .replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();
                },
                // Giống boDauHs của máy chủ (HOA, gộp khoảng trắng, Đ→D) — để so tên chủ hồ sơ với tên người dùng
                boDauHs(s) {
                    return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
                        .replace(/\s+/g, ' ').trim().toUpperCase().replace(/Đ/g, 'D');
                },
                // Giờ hiển thị theo múi giờ Việt Nam (máy người dùng ở đâu cũng vậy)
                gioVn(iso) {
                    if (!iso) { return ''; }
                    const d = new Date(iso);
                    if (isNaN(d.getTime())) { return ''; }
                    try {
                        return new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit',
                            year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
                    } catch (e) { return String(iso); }
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
                // `dich` chỉ dùng cho loại nguoi_dung: ô nào nhận người được chọn ('xn.den' | 'bg.tu' | 'bg.den')
                moChon(loai, dich) {
                    const nguon = { khoa: this.goiY.khoa, bien_so: this.goiY.bien_so, may_bien: this.goiY.bien_so,
                                    giao_vien: this.goiY.giao_vien, nguoi_nop: this.goiY.nguoi_quan_ly };
                    let ds = nguon[loai] || [];
                    let nhan = {};
                    let timKem = {};
                    if (loai === 'nguoi_dung') {
                        // Nhãn CHỈ là tên người đăng ký (không hiện tên đăng nhập); gõ tên đăng nhập vẫn tìm ra (timKem)
                        ds = this.dsNguoi.map(n => {
                            let t = String(n.ten || 'Chưa đặt tên'), k = 1;
                            const goc = t;
                            while (nhan[t]) { k += 1; t = goc + ' (' + k + ')'; }      // phòng function cũ chưa khử trùng
                            nhan[t] = n;
                            timKem[t] = this.boDau(t + ' ' + n.username);
                            return t;
                        });
                    }
                    this.chon = { mo: true, loai: loai, tim: '', ds: ds, dich: dich || '', nhan: nhan, timKem: timKem };
                },
                tenChon() {
                    return { khoa: 'Chọn khóa', bien_so: 'Chọn biển số', giao_vien: 'Chọn giáo viên',
                             may_bien: 'Chọn biển số máy DAT', nguoi_dung: 'Chọn người',
                             nguoi_nop: 'Chọn người quản lý hồ sơ' }[this.chon.loai] || '';
                },
                chonXong(giaTri) {
                    const loai = this.chon.loai;
                    if (loai === 'may_bien') {
                        this.may.bien = giaTri;
                        this.chon.mo = false;
                        if (giaTri) { this.taiMay(); }
                        return;
                    }
                    if (loai === 'nguoi_dung') {
                        const n = this.chon.nhan[giaTri];
                        if (n) {
                            if (this.chon.dich === 'xn.den') { this.xn.den = n.username; this.xn.denTen = n.ten; }
                            if (this.chon.dich === 'bg.tu') { this.bg.tu = n.username; this.bg.tuTen = n.ten; }
                            if (this.chon.dich === 'bg.den') { this.bg.den = n.username; this.bg.denTen = n.ten; }
                        }
                        this.chon.mo = false;
                        return;
                    }
                    if (loai) { this.loc[loai] = giaTri; }
                    this.chon.mo = false;
                },
                get chonLoc() {
                    const q = this.boDau(this.chon.tim).trim();
                    const tk = this.chon.timKem || {};
                    const ds = q ? this.chon.ds.filter(g => (tk[g] || this.boDau(g)).indexOf(q) >= 0) : this.chon.ds;
                    return ds.slice(0, 200);       // 200 dòng đầu là đủ chọn; gõ thêm để thu hẹp
                },
                // Chữ người dùng gõ mà không có trong danh sách → cho "+ Dùng '…'"
                get chonDungRieng() {
                    if (this.chon.loai === 'nguoi_dung') { return ''; }      // người nhận phải là tài khoản có thật
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
                        this.napAnhNho(this.ctXe.khoa.map(k => [k.TrungTam || trungTam, k.MaGV]));
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
                        this.napAnhNho(this.ctKhoa.vehicles.map(v => [this.ctKhoa.khoa.TrungTam || k.TrungTam, v.MaGV]));
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

                // ---------- giáo viên: danh sách từ /chi-tiet (tên + mã), hồ sơ + ảnh từ /ho-so và /anh ----------
                async moGV(r, trungTam) {
                    const luot = this.gv.luot + 1;
                    this.gv = { mo: true, loi: '', ds: [], luot: luot };
                    try {
                        // Có mã GV thì tra theo mã; không có thì tra theo tên (máy chủ bỏ dấu để so)
                        const tham = { trung_tam: trungTam || r.TrungTam };
                        if (r.MaGV) { tham.ma = r.MaGV; } else { tham.ten = r.TenGV; }
                        const d = await this.api('/phanxe/giao-vien/chi-tiet', tham);
                        if (this.gv.luot !== luot) { return; }          // đã đóng / mở hộp khác
                        // Khai ĐỦ trường ngay từ đầu để Alpine theo dõi được
                        this.gv.ds = (d.giao_vien || []).map(g => Object.assign({}, g, {
                            NgaySinh: '', SoCCCD: '', anh: '', dangHoSo: false, hoSoLoi: '' }));
                    } catch (e) {
                        this.gv.loi = e.thongBao || 'Lỗi';
                        return;
                    }
                    // Hồ sơ đầy đủ chỉ lấy khi MỞ hộp, tối đa 3 người, lần lượt từng người (mỗi lượt có đếm giới hạn)
                    const n = Math.min(3, this.gv.ds.length);
                    for (let i = 0; i < n; i++) {
                        if (this.gv.luot !== luot) { return; }
                        await this.napHoSoGv(luot, i);
                    }
                },

                async napHoSoGv(luot, i) {
                    const g = this.gv.ds[i];
                    if (!g || !g.MaGV) { return; }
                    g.dangHoSo = true;
                    try {
                        const h = await this.api('/phanxe/giao-vien/ho-so', { trung_tam: g.TrungTam, ma: g.MaGV });
                        if (this.gv.luot !== luot) { return; }
                        g.NgaySinh = h.NgaySinh || '';
                        g.SoCCCD = h.SoCCCD || '';
                        if (h.CoAnh) {
                            const u = await this.taiAnhGv(g.TrungTam, g.MaGV);
                            if (this.gv.luot === luot && u) { g.anh = u; }
                        }
                    } catch (e) {
                        if (this.gv.luot === luot) {
                            g.hoSoLoi = e.ma === 404 ? 'Chưa có hồ sơ giáo viên trên bản Internet.' : (e.thongBao || 'Lỗi');
                        }
                    } finally { g.dangHoSo = false; }
                },

                // Trả blob URL của ảnh GV ('' nếu không có). Không bao giờ ném lỗi.
                async taiAnhGv(tt, ma) {
                    const k = tt + '|' + ma;
                    if (ANH_GV.has(k)) { return ANH_GV.get(k); }
                    if (DANG_TAI_ANH.has(k) || !this.token) { return ''; }
                    DANG_TAI_ANH.add(k);
                    const tokenLuc = this.token;                                       // để biết giữa chừng có đăng xuất không
                    try {
                        const q = new URLSearchParams({ trung_tam: tt, ma: ma });
                        const res = await fetch(API_URL + '/phanxe/giao-vien/anh?' + q.toString(),
                            { headers: { 'Authorization': 'Bearer ' + this.token } });
                        if (res.status === 401) { this.dangXuat(true); return ''; }
                        if (res.status === 404) { ANH_GV.set(k, ''); return ''; }     // không có ảnh: nhớ để khỏi hỏi lại
                        if (!res.ok) { return ''; }                                    // 429/503...: lần sau thử lại
                        const blob = await res.blob();
                        if (this.token !== tokenLuc) { return ''; }                    // đã đăng xuất/đổi tài khoản: bỏ, khỏi rò blob
                        const url = URL.createObjectURL(blob);
                        ANH_GV.set(k, url);
                        this.anhGv = Object.assign({}, this.anhGv, { [k]: url });
                        return url;
                    } catch (e) { return ''; }
                    finally { DANG_TAI_ANH.delete(k); }
                },

                // Ảnh nhỏ 32px ở hộp xe / hộp khóa: cặp [trung tâm, mã GV] khác nhau, tối đa TOI_DA_ANH_NHO
                async napAnhNho(cap) {
                    const thay = {};
                    const ds = [];
                    (cap || []).forEach(c => {
                        if (!c[0] || !c[1]) { return; }
                        const k = c[0] + '|' + c[1];
                        if (!thay[k]) { thay[k] = 1; ds.push(c); }
                    });
                    for (const c of ds.slice(0, TOI_DA_ANH_NHO)) { await this.taiAnhGv(c[0], c[1]); }
                },
                anhNho(tt, ma) { return this.anhGv[tt + '|' + ma] || null; },

                // Đăng xuất: thu hồi mọi blob URL (không để ảnh GV nằm lại trong bộ nhớ trang)
                thuHoiAnh() {
                    ANH_GV.forEach(u => { if (u) { try { URL.revokeObjectURL(u); } catch (e) { /* bỏ qua */ } } });
                    ANH_GV.clear();
                    DANG_TAI_ANH.clear();
                    this.anhGv = {};
                },

                // ---------- ghim (lưu trên máy này) ----------
                khoaGhim(r) { return [r.TrungTam || '', r.MaKH || '', r.MaDK || ''].join('|'); },

                daGhim(r) {
                    const k = this.khoaGhim(r);
                    return this.ghim.some(x => this.khoaGhim(x) === k);
                },

                // Bộ lọc dùng chung cho 2 mục Ghim: lấy danh sách trung tâm/hạng theo mục đang xem
                get ghimNguon() { return this.ghimMuc === 'xong' ? (this.dsXong.ds || []) : this.ghim; },
                get ghimDsTT() {
                    const t = {};
                    this.ghimNguon.forEach(r => { if (r.TrungTam) { t[r.TrungTam] = 1; } });
                    return Object.keys(t).sort();
                },
                get ghimDsHang() {
                    const t = {};
                    this.ghimNguon.forEach(r => { if (r.HangGPLX) { t[r.HangGPLX] = 1; } });
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

                // ---------- "Đã chạy xong DAT" (lưu trên cloud, dùng chung mọi máy) ----------
                async taiXong() {
                    if (!this.token || this.khongCoQuyen) { return; }
                    this.dsXong.dang = true;
                    try {
                        const d = await this.api('/dat-xong');
                        const khoa = {};
                        (d.danh_sach || []).forEach(x => { khoa[x.TrungTam + '|' + x.MaKH + '|' + x.MaDK] = 1; });
                        this.dsXong = { ds: d.danh_sach || [], khoa: khoa, dang: false, loi: '' };
                    } catch (e) {
                        this.dsXong.dang = false;
                        this.dsXong.loi = e.thongBao || 'Lỗi';
                    }
                },
                daXong(r) { return !!this.dsXong.khoa[this.khoaGhim(r)]; },
                // Chỉ để ẩn/hiện nút — máy chủ vẫn là bên quyết định (admin hoặc đúng chủ hồ sơ)
                coTheXacNhan(r) {
                    if (this.user.is_admin) { return true; }
                    const ten = this.boDauHs(this.user.ndk_name);
                    return !!(r.NguoiQuanLy && ten && this.boDauHs(r.NguoiQuanLy) === ten);
                },
                // "Đang chạy" = ghim trừ các khóa đã xong
                get dangChay() { return this.ghim.filter(r => !this.daXong(r)); },
                get dangChayLoc() {
                    const q = this.boDau(this.ghimTim).trim();
                    return this.dangChay.filter(r =>
                        (!this.ghimTT || r.TrungTam === this.ghimTT)
                        && (!this.ghimHang || r.HangGPLX === this.ghimHang)
                        && (!q || this.chiSo([r.HoVaTen, r.MaDK, r.SoCMT, r.BienSoXe, r.TenGV, r.TenKhoa]).indexOf(q) >= 0));
                },
                get xongLoc() {
                    const q = this.boDau(this.ghimTim).trim();
                    return (this.dsXong.ds || []).filter(r =>
                        (!this.ghimTT || r.TrungTam === this.ghimTT)
                        && (!this.ghimHang || r.HangGPLX === this.ghimHang)
                        && (!q || this.chiSo([r.HoVaTen, r.MaDK, r.BienSoXe, r.NguoiGhiTen]).indexOf(q) >= 0));
                },

                async moXacNhan(r) {
                    this.xn = { mo: true, r: r, kieu: 'kho', den: 'KHO', denTen: 'Về kho', ghiChu: '', dang: false, loi: '' };
                    await this.taiNguoi();
                },
                async taiNguoi() {
                    // Mỗi lần mở hộp tải lại (tài khoản mới hiện ngay); danh sách cũ vẫn dùng được trong lúc chờ
                    try {
                        const d = await this.api('/may-dat/nguoi-dung');
                        this.dsNguoi = Array.isArray(d) ? d : [];
                        this.daTaiNguoi = true;
                    } catch (e) { /* chưa tải được: ô "Giao cho" sẽ rỗng, thử lại lần mở sau */ }
                },
                chonKieuXn(k) {
                    this.xn.kieu = k;
                    if (k === 'kho') { this.xn.den = 'KHO'; this.xn.denTen = 'Về kho'; }
                    else { this.xn.den = ''; this.xn.denTen = ''; }
                },
                async guiXacNhan() {
                    if (this.xn.dang) { return; }
                    this.xn.loi = '';
                    if (this.xn.kieu === 'nguoi' && !this.xn.den) { this.xn.loi = 'Hãy chọn người nhận máy.'; return; }
                    if ([...this.xn.ghiChu].length > TOI_DA_GHI_CHU) { this.xn.loi = 'Ghi chú dài quá ' + TOI_DA_GHI_CHU + ' ký tự.'; return; }
                    this.xn.dang = true;
                    try {
                        await this.api('/dat-xong', {}, { body: {
                            trung_tam: this.xn.r.TrungTam, ma_kh: this.xn.r.MaKH, ma_dk: this.xn.r.MaDK,
                            den: this.xn.den, ghi_chu: this.xn.ghiChu } });
                        this.xn.mo = false;
                        this.bao('Đã ghi nhận chạy xong DAT');
                        await this.taiXong();
                        if (this.may.co) { this.taiMay(); }
                    } catch (e) {
                        this.xn.loi = e.thongBao || 'Lỗi';
                        if (e.ma === 409) { this.taiXong(); }
                    } finally { this.xn.dang = false; }
                },
                async boXacNhan(r) {
                    if (!window.confirm('Bỏ xác nhận "đã chạy xong" của ' + (r.HoVaTen || 'học viên này') + '?')) { return; }
                    try {
                        await this.api('/dat-xong/huy', {}, { body: { trung_tam: r.TrungTam, ma_kh: r.MaKH, ma_dk: r.MaDK } });
                        this.bao('Đã bỏ xác nhận');
                        await this.taiXong();
                        if (this.may.co) { this.taiMay(); }
                    } catch (e) { this.bao(e.thongBao || 'Lỗi'); }
                },

                // ---------- tab Máy DAT ----------
                mayRong() {
                    return { bien_so: '', dang_giu: { nguoi: 'KHO', ten: 'Kho', luc: null, chua_ro: true }, lich_su: [] };
                },
                async taiMay() {
                    const b = String(this.may.bien || '').trim();
                    if (!b) { return; }
                    this.may.dang = true;
                    this.may.loi = '';
                    try {
                        const d = await this.api('/may-dat/xe', { bien_so: b });
                        this.may.kq = Object.assign(this.mayRong(), d);
                        this.may.co = true;
                    } catch (e) {
                        this.may.loi = e.thongBao || 'Lỗi';
                        this.may.co = false;
                    } finally { this.may.dang = false; }
                },
                nhanLoai(l) {
                    return { chay_xong: 'Chạy xong', ban_giao: 'Bàn giao', hoan_tac: 'Hoàn tác' }[l] || l;
                },
                async moBanGiao() {
                    const g = (this.may.kq && this.may.kq.dang_giu) || {};
                    this.bg = { mo: true, bien: this.may.kq.bien_so || this.may.bien, tu: g.nguoi || 'KHO',
                                tuTen: g.ten || 'Kho', den: '', denTen: '', ghiChu: '', dang: false, loi: '' };
                    await this.taiNguoi();
                },
                async guiBanGiao() {
                    if (this.bg.dang) { return; }
                    this.bg.loi = '';
                    if (!this.bg.den) { this.bg.loi = 'Hãy chọn người nhận máy.'; return; }
                    if (this.bg.tu === this.bg.den) { this.bg.loi = 'Người giao và người nhận phải khác nhau.'; return; }
                    if ([...this.bg.ghiChu].length > TOI_DA_GHI_CHU) { this.bg.loi = 'Ghi chú dài quá ' + TOI_DA_GHI_CHU + ' ký tự.'; return; }
                    this.bg.dang = true;
                    try {
                        await this.api('/may-dat/ban-giao', {}, { body: {
                            bien_so: this.bg.bien, tu: this.bg.tu, den: this.bg.den, ghi_chu: this.bg.ghiChu } });
                        this.bg.mo = false;
                        this.bao('Đã ghi bàn giao');
                        this.taiMay();
                    } catch (e) { this.bg.loi = e.thongBao || 'Lỗi'; }
                    finally { this.bg.dang = false; }
                },
                moAn(h) { this.an = { mo: true, id: h.id, lyDo: '', dang: false, loi: '' }; },
                async guiAn() {
                    if (this.an.dang) { return; }
                    this.an.loi = '';
                    if ([...this.an.lyDo].length > 200) { this.an.loi = 'Lý do dài quá 200 ký tự.'; return; }
                    this.an.dang = true;
                    try {
                        await this.api('/may-dat/an', {}, { body: { id: this.an.id, ly_do: this.an.lyDo } });
                        this.an.mo = false;
                        this.bao('Đã ẩn bản ghi');
                        this.taiMay();
                    } catch (e) { this.an.loi = e.thongBao || 'Lỗi'; }
                    finally { this.an.dang = false; }
                },
            };
        }
