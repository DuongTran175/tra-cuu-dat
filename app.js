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
        // Ảnh XE: cùng cách (blob URL qua fetch có Authorization); '' = xe chưa có ảnh (404). Khóa `trung_tâm|biển chuẩn`.
        const ANH_XE = new Map();
        const DANG_TAI_ANH = new Set();
        const TOI_DA_GHI_CHU = 300;
        // Chọn nhanh tình trạng máy DAT cho ô ghi chú (máy chủ vẫn nhận ghi_chu là chuỗi tự do)
        const TINH_TRANG_MAY = [{ ma: 'binh_thuong', ten: 'Máy bình thường' }, { ma: 'hong', ten: 'Máy hỏng' }, { ma: 'loi', ten: 'Máy lỗi' }];
        const BO_PHAN_MAY = ['Định vị', 'Nguồn/pin', 'Màn hình', 'Camera', 'Thẻ nhớ/SIM', 'Khác'];
        // Ghép tình trạng + bộ phận + chữ tự do thành MỘT chuỗi ghi chú (hàm thuần, dùng chung 2 hộp)
        function ghepGhiChu(tinhTrang, boPhan, chu) {
            const tt = TINH_TRANG_MAY.find(function (t) { return t.ma === tinhTrang; });
            const phan = String(chu || '').trim();
            if (!tt) { return phan; }
            let kq = tt.ten;
            if (tt.ma !== 'binh_thuong' && boPhan && boPhan.length) {
                kq += ': ' + BO_PHAN_MAY.filter(function (b) { return boPhan.indexOf(b) >= 0; })
                    .map(function (b) { return b.toLowerCase(); }).join(', ');
            }
            return phan ? kq + ' — ' + phan : kq;
        }
        // Cảnh báo xe (14/11/2026): biển chuẩn hóa như chuanBien() của Edge Function (chỉ chữ + số, HOA)
        function chuanBienJs(b) { return String(b || '').replace(/[^\p{L}\p{N}]/gu, '').toUpperCase(); }
        // 'yyyy-mm-dd' → 'dd/mm/yyyy'
        function ngayViet(iso) {
            const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
            return m ? m[3] + '/' + m[2] + '/' + m[1] : '';
        }
        const TOI_DA_ANH_NHO = 8;      // hộp xe / hộp khóa: tối đa bấy nhiêu ảnh nhỏ mỗi lần mở (mỗi ảnh ăn 1 lượt xem)
        // Thông báo đẩy nền (GĐ2): đối tượng của trình duyệt (ServiceWorkerRegistration…) KHÔNG đặt vào state Alpine
        // (Proxy làm hỏng lời gọi) → giữ ở biến ngoài. Cờ `tcdat_tb_<tên đăng nhập>` = người này đã bật thông báo ở máy này.
        const KHOA_TB = 'tcdat_tb_';
        const CHO_SW_MS = 5000;
        let TB_REG = null;      // ServiceWorkerRegistration đã sẵn sàng
        let TB_KHOA = '';       // khóa công khai VAPID (base64url) lấy từ /push/khoa

        function b64uSangBytes(s) {
            const t = String(s).replace(/-/g, '+').replace(/_/g, '/');
            const raw = atob(t + '='.repeat((4 - (t.length % 4)) % 4));
            const o = new Uint8Array(raw.length);
            for (let i = 0; i < raw.length; i++) { o[i] = raw.charCodeAt(i); }
            return o;
        }
        // Chờ Service Worker sẵn sàng, tối đa CHO_SW_MS (chưa đăng ký được thì ready không bao giờ xong)
        function swSanSang() {
            if (!('serviceWorker' in navigator)) { return Promise.resolve(null); }
            return Promise.race([
                navigator.serviceWorker.ready,
                new Promise((xong) => setTimeout(() => xong(null), CHO_SW_MS)),
            ]).catch(() => null);
        }

        function app() {
            return {
                token: '',
                chuaCauHinh: CHUA_CAU_HINH,
                user: { ndk_name: '', username: '', is_admin: false, quyen: [], uy_quyen: [] },
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
                ctXe: { mo: false, dang: false, loi: '', bien_so: '', trung_tam: '',
                        khoa: [], khoa_an: 0, so_hv_khac: 0 },
                anhXe: { mo: false, dang: false, bien: '', url: '', khongCo: false, loi: '', luot: 0 },
                gv: { mo: false, loi: '', ds: [], luot: 0 },
                anhGv: {},              // khóa `trung_tâm|mã GV` → blob URL (bản sao phản ứng của ANH_GV)
                ghim: [],
                ghimTim: '', ghimTT: '', ghimHang: '',
                ghimMuc: 'dang',        // 'dang' = Đang chạy · 'xong' = Đã hoàn thành DAT · 'ho' = Nhờ dạy hộ
                // Nhờ giáo viên dạy hộ (lưu trên máy chủ): toi_nho = tôi nhờ người khác · nho_toi = người khác nhờ tôi
                nho: { bat: true, toi_nho: [], nho_toi: [], dang: false, loi: '' },
                hopNho: { mo: false, khoa: '', den: '', denTen: '', ghiChu: '', giaoMay: false, kiemMay: false, lyDoKhoa: '', dang: false, loi: '' },
                // Danh sách "Đã chạy xong DAT" lấy từ cloud (khóa so khớp: trung_tâm|mã_kh|mã_đk)
                dsXong: { ds: [], khoa: {}, dang: false, loi: '' },
                // Tab Máy DAT
                may: { bien: '', dang: false, loi: '', co: false, kq: null },
                dsNguoi: [], daTaiNguoi: false,
                xn: { mo: false, r: {}, kieu: 'nguoi', den: '', denTen: '', tinhTrang: '', boPhan: [], ghiChu: '', dang: false, loi: '' },
                bg: { mo: false, bien: '', kieu: 'giao', tu: '', tuTen: '', den: '', denTen: '', tinhTrang: '', boPhan: [], ghiChu: '', nkCuoi: null, dang: false, loi: '' },
                // Lệnh bàn giao chờ xác nhận (GĐ1 kho máy DAT): hộp "Chờ bạn xác nhận", chấm số, số trên icon
                cho: { cho_toi: [], toi_gui: [], so: 0, kho: null, dang: false },
                hopCho: { mo: false, tuChoiId: 0, lyDo: '', dangId: 0, loi: '' },
                // Trang Quản lý kho DAT (chỉ tài khoản có quyền QUANLY_KHO_DAT)
                kho: { dang: false, loi: '', ds: [], dem: {}, loc: 'tat_ca', tim: '', daTai: false },
                // Cảnh báo xe sát hạch / hết hạn GPXTL (chỉ cảnh báo, không chặn): `xe` khóa theo biển chuẩn, `dsXe` mọi xe
                cb: { xe: {}, dsXe: [], homNay: '' },
                // Lịch sát hạch (chỉ người kho): form nhập + danh sách sắp tới
                lich: { mo: false, dang: false, loi: '', ds: [], daTai: false, homNay: '',
                        ngay: '', tt: '', ghiChu: '', tim: '', chon: {}, dan: '', luu: false, loiLuu: '' },
                an: { mo: false, id: 0, lyDo: '', dang: false, loi: '' },
                mangOk: navigator.onLine !== false,   // đèn Online/Offline ở đầu trang
                // Cài đặt → khối "Thông báo": dang | ios | khong | maychu | chan | tat | bat
                tb: { trangThai: 'dang', dang: false, loi: '' },
                // Hộp Cài đặt: đổi mật khẩu
                cd: { mo: false, cu: '', moi: '', lai: '', hien: false, dang: false, loi: '', xong: false },

                // ---------- khởi động ----------
                async khoiDong() {
                    window.addEventListener('online', () => { this.mangOk = true; });
                    window.addEventListener('offline', () => { this.mangOk = false; });
                    this.theoDoiVungNhin();
                    // Hộp "Chờ bạn xác nhận": hỏi lại khi quay về trang và mỗi 60 giây lúc trang đang hiện
                    document.addEventListener('visibilitychange', () => {
                        if (document.visibilityState === 'visible') { this.taiCho(true); this.taiCanhBao(); }
                    });
                    // Cảnh báo xe: hỏi lại mỗi 10 phút lúc trang đang hiện (qua nửa đêm giờ VN thì "hôm nay" đổi)
                    setInterval(() => {
                        if (document.visibilityState === 'visible') { this.taiCanhBao(); }
                    }, 600000);
                    setInterval(() => {
                        if (document.visibilityState === 'visible') { this.taiCho(false); }
                    }, 60000);
                    // Bấm thông báo đẩy: SW báo cửa sổ đang mở chuyển sang tab Máy DAT; mở mới thì đường dẫn mang `#may`
                    window.addEventListener('hashchange', () => { this.moTheoHash(); });
                    if ('serviceWorker' in navigator) {
                        navigator.serviceWorker.addEventListener('message', (e) => {
                            const d = e.data;
                            if (d && d.loai === 'mo' && typeof d.u === 'string' && (d.u.indexOf('#may') >= 0 || d.u.indexOf('#ghim') >= 0)) {
                                const dich = d.u.indexOf('#ghim') >= 0 ? '#ghim' : '#may';
                                if (location.hash === dich) { this.moTheoHash(); } else { location.hash = dich; }
                            }
                        });
                    }
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
                        if (!this.khongCoQuyen) {
                            this.taiGoiY(); this.taiXong(); this.taiNho(); this.taiCho(true); this.taiCanhBao();
                            this.moTheoHash();
                            this.tuDangKyLaiTb();
                        }
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
                    // Thông báo đẩy: hủy đăng ký thiết bị này (token còn thì báo máy chủ; token hết hạn thì chỉ hủy tại máy)
                    this.huyPushKhiThoat(imLang ? '' : this.token);
                    // Người dùng tự bấm Đăng xuất (không phải token hết hạn) → hỏi có xóa ghim khỏi máy không
                    if (!imLang && this.ghim.length && this.khoaLuuGhim()
                            && window.confirm('Xóa luôn các học viên đã ghim khỏi máy này?')) {
                        try { localStorage.removeItem(this.khoaLuuGhim()); } catch (e) { /* bỏ qua */ }
                    }
                    this.ghim = [];
                    this.thuHoiAnh();
                    this.user = { ndk_name: '', username: '', is_admin: false, quyen: [], uy_quyen: [] };
                    this.token = '';
                    localStorage.removeItem(KHOA_TOKEN);
                    this.ketQua = { results: [], total: 0, bi_cat: 0, quyen: null };
                    this.ctXe.mo = false;
                    this.anhXe = { mo: false, dang: false, bien: '', url: '', khongCo: false, loi: '', luot: 0 };
                    this.gv = { mo: false, loi: '', ds: [], luot: 0 };
                    this.chon = { mo: false, loai: '', tim: '', ds: [], dich: '', nhan: {} };
                    this.ghimMuc = 'dang';
                    this.dsXong = { ds: [], khoa: {}, dang: false, loi: '' };
                    this.nho = { bat: true, toi_nho: [], nho_toi: [], dang: false, loi: '' };
                    this.hopNho = { mo: false, khoa: '', den: '', denTen: '', ghiChu: '', giaoMay: false, kiemMay: false, lyDoKhoa: '', dang: false, loi: '' };
                    this.may = { bien: '', dang: false, loi: '', co: false, kq: null };
                    this.dsNguoi = [];
                    this.daTaiNguoi = false;
                    this.xn = { mo: false, r: {}, kieu: 'nguoi', den: '', denTen: '', tinhTrang: '', boPhan: [], ghiChu: '', dang: false, loi: '' };
                    this.bg = { mo: false, bien: '', kieu: 'giao', tu: '', tuTen: '', den: '', denTen: '', tinhTrang: '', boPhan: [], ghiChu: '', nkCuoi: null, dang: false, loi: '' };
                    this.cho = { cho_toi: [], toi_gui: [], so: 0, kho: null, dang: false };
                    this.hopCho = { mo: false, tuChoiId: 0, lyDo: '', dangId: 0, loi: '' };
                    this.kho = { dang: false, loi: '', ds: [], dem: {}, loc: 'tat_ca', tim: '', daTai: false };
                    this.cb = { xe: {}, dsXe: [], homNay: '' };
                    this.lich = { mo: false, dang: false, loi: '', ds: [], daTai: false, homNay: '',
                                  ngay: '', tt: '', ghiChu: '', tim: '', chon: {}, dan: '', luu: false, loiLuu: '' };
                    this.capNhatHuy();
                    this.an = { mo: false, id: 0, lyDo: '', dang: false, loi: '' };
                    this.cd = { mo: false, cu: '', moi: '', lai: '', hien: false, dang: false, loi: '', xong: false };
                    this.tb = { trangThai: 'dang', dang: false, loi: '' };
                    this.ghimTim = '';
                    this.ghimTT = '';
                    this.ghimHang = '';
                    this.tab = 'tim';
                    this.ngan = false;
                    this.hienMK = false;
                    this.daTim = false;
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
                    } catch (e) { /* không có gợi ý vẫn tra cứu được */ }
                },

                // ---------- điều hướng ----------
                doiTab(t) {
                    this.tab = t;
                    this.ngan = false;
                    window.scrollTo(0, 0);
                    if (this.khongCoQuyen) { return; }
                    if (t === 'ghim' || t === 'may') { this.taiXong(); }      // đổi tab thì nạp lại danh sách đã xong
                    if (t === 'ghim') { this.taiNho(); }
                    if (t === 'may') { this.taiCho(false); }
                    if (t === 'kho') { this.taiKho(); this.taiCho(false); }
                },

                tieuDe() {
                    return { tim: 'Tra cứu DAT', ghim: 'Ghim ghi nhớ', may: 'Máy DAT', kho: 'Kho DAT' }[this.tab] || '';
                },
                phuDe() {
                    return { tim: 'Tìm học viên để biết xe và giáo viên DAT',
                             ghim: 'Học viên bạn đã ghim — lưu ngay trên máy này',
                             may: 'Ai đang giữ máy DAT, lịch sử bàn giao',
                             kho: 'Mọi máy DAT: ở kho, đang ở ai, đang chuyển' }[this.tab] || '';
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
                    const nguon = { khoa: this.goiY.khoa, bien_so: this.goiY.bien_so, may_bien: this.dsBienMay(),
                                    giao_vien: this.goiY.giao_vien, nguoi_nop: this.goiY.nguoi_quan_ly };
                    let ds = nguon[loai] || [];
                    let nhan = {};
                    let timKem = {};
                    if (loai === 'nguoi_dung') {
                        // Nhãn CHỈ là tên người đăng ký (không hiện tên đăng nhập); gõ tên đăng nhập vẫn tìm ra (timKem)
                        const nguonNguoi = dich === 'nho.den' ? this.dsNguoi.filter(n => n.username !== this.user.username) : this.dsNguoi;
                        ds = nguonNguoi.map(n => {
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
                            if (this.chon.dich === 'nho.den') { this.hopNho.den = n.username; this.hopNho.denTen = n.ten; }
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
                    // Đóng bàn phím ảo (nó che kết quả) rồi kéo dòng đếm kết quả vào vùng nhìn
                    try { if (document.activeElement && document.activeElement.blur) { document.activeElement.blur(); } } catch (x) { /* bỏ qua */ }
                    setTimeout(() => {      // chờ Alpine vẽ xong kết quả
                        const el = Array.from(document.querySelectorAll('.dem-ket-qua')).find(e => e.offsetParent !== null);
                        this.cuonVaoNhin(el);
                    }, 60);
                },

                xoaLoc() {
                    Object.keys(this.loc).forEach(k => { this.loc[k] = ''; });
                    this.ketQua = { results: [], total: 0, bi_cat: 0, quyen: null };
                    this.daTim = false;
                    this.loiTim = '';
                },

                moXeTuHV(r) { this.moXe(r.BienSoXe, r.TrungTam, 2); },

                async moXe(bienSo, trungTam, soKhoa) {
                    this.ctXe = { mo: true, dang: true, loi: '', bien_so: bienSo,
                                  trung_tam: trungTam, khoa: [], khoa_an: 0, so_hv_khac: 0 };
                    try {
                        // /ca-xe: HV của mình đủ trường, HV người khác chỉ tên + người quản lý (CuaBan=false)
                        const d = await this.api('/phanxe/xe/ca-xe',
                            { bien_so: bienSo, trung_tam: trungTam, so_khoa: soKhoa });
                        this.ctXe.khoa = d.khoa || [];
                        this.ctXe.khoa_an = d.khoa_an || 0;
                        this.ctXe.so_hv_khac = d.so_hv_khac || 0;
                        this.napAnhNho(this.ctXe.khoa.map(k => [k.TrungTam || trungTam, k.MaGV]));
                    } catch (e) {
                        this.ctXe.loi = e.thongBao || 'Lỗi';
                    } finally { this.ctXe.dang = false; }
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
                    ANH_XE.forEach(u => { if (u) { try { URL.revokeObjectURL(u); } catch (e) { /* bỏ qua */ } } });
                    ANH_XE.clear();
                    DANG_TAI_ANH.clear();
                    this.anhGv = {};
                },

                // ---------- ảnh XE: bấm vào biển số ở thẻ học viên / Ghim / Máy DAT / hộp xe ----------
                // Hộp ảnh đứng CUỐI DOM nên nổi trên hộp xe đang mở. 404 → "Xe chưa có ảnh"; 429/503 không nhớ (thử lại được).
                async moAnhXe(bienSo, trungTam) {
                    const bien = String(bienSo || '').trim();
                    if (!bien || !this.token) { return; }
                    const luot = (this.anhXe.luot || 0) + 1;
                    this.anhXe = { mo: true, dang: true, bien: bien, url: '', khongCo: false, loi: '', luot: luot };
                    const k = (trungTam || '') + '|' + this.boDau(bien).replace(/[^a-z0-9]/g, '');
                    if (ANH_XE.has(k)) {
                        const u = ANH_XE.get(k);
                        this.anhXe.url = u;
                        this.anhXe.khongCo = !u;
                        this.anhXe.dang = false;
                        return;
                    }
                    const tokenLuc = this.token;
                    try {
                        const q = new URLSearchParams({ bien_so: bien });
                        if (trungTam) { q.set('trung_tam', trungTam); }
                        const res = await fetch(API_URL + '/phanxe/xe/anh?' + q.toString(),
                            { headers: { 'Authorization': 'Bearer ' + this.token } });
                        if (this.anhXe.luot !== luot) { return; }
                        if (res.status === 401) { this.dangXuat(true); return; }
                        if (res.status === 404) {
                            ANH_XE.set(k, '');
                            this.anhXe.khongCo = true;
                        } else if (!res.ok) {
                            this.anhXe.loi = res.status === 429 ? 'Xem ảnh quá nhiều lần, thử lại sau ít phút.'
                                                                : 'Không tải được ảnh xe, thử lại sau.';
                        } else {
                            const blob = await res.blob();
                            if (this.token !== tokenLuc || this.anhXe.luot !== luot) { return; }
                            const url = URL.createObjectURL(blob);
                            ANH_XE.set(k, url);
                            this.anhXe.url = url;
                        }
                    } catch (e) {
                        if (this.anhXe.luot === luot) { this.anhXe.loi = 'Không kết nối được máy chủ.'; }
                    } finally {
                        if (this.anhXe.luot === luot) { this.anhXe.dang = false; }
                    }
                },

                // ---------- bàn phím ảo: bám theo VÙNG NHÌN THẬT (iOS không co 100vh khi bàn phím bật) ----------
                theoDoiVungNhin() {
                    const v = window.visualViewport;
                    const goc = document.documentElement;
                    if (v) {
                        const dat = () => {
                            goc.style.setProperty('--vvh', v.height + 'px');
                            goc.style.setProperty('--vvt', v.offsetTop + 'px');
                        };
                        v.addEventListener('resize', dat);
                        v.addEventListener('scroll', dat);
                        dat();
                    }
                    // Ô nhập trong hộp được bấm → cuộn cho nằm trong vùng nhìn (chờ bàn phím bật xong)
                    document.addEventListener('focusin', (e) => {
                        const el = e.target;
                        if (el && el.matches && el.matches('.chon-than textarea, .chon-than input')) {
                            setTimeout(() => { try { el.scrollIntoView({ block: 'nearest' }); } catch (x) { /* bỏ qua */ } }, 300);
                        }
                    });
                },
                // Kéo phần tử vào vùng nhìn nếu nó nằm DƯỚI mép vùng nhìn thật (bàn phím ảo / thanh dưới che mất).
                // Chỉ cuộn xuống, không cuộn ngược lên: người dùng đã tự cuộn đi chỗ khác thì thôi.
                cuonVaoNhin(el) {
                    if (!el) { return; }
                    const v = window.visualViewport;
                    const cao = v ? v.height : window.innerHeight;
                    const r = el.getBoundingClientRect();
                    if (r.bottom > cao - 70) { try { el.scrollIntoView({ block: 'nearest' }); } catch (x) { /* bỏ qua */ } }
                },
                cuonKetQuaGhim() {
                    setTimeout(() => {      // chờ Alpine lọc xong danh sách
                        const el = document.querySelector('#muc-ghim .hv-the');
                        this.cuonVaoNhin(el);
                    }, 60);
                },

                // ---------- ghim (lưu trên máy này) ----------
                khoaGhim(r) { return [r.TrungTam || '', r.MaKH || '', r.MaDK || ''].join('|'); },

                daGhim(r) {
                    const k = this.khoaGhim(r);
                    return this.ghim.some(x => this.khoaGhim(x) === k);
                },

                // Bộ lọc dùng chung cho 2 mục Ghim: lấy danh sách trung tâm/hạng theo mục đang xem
                get ghimNguon() { return this.ghimMuc === 'xong' ? this.xongCuaToi : this.ghim; },
                // Mục "Đã hoàn thành DAT": chỉ HV tài khoản này đã ghim hoặc chính mình xác nhận chạy xong
                get xongCuaToi() { return (this.dsXong.ds || []).filter(r => this.daGhim(r) || r.NguoiGhi === (this.user && this.user.username)); },
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
                    if (r && r.CuaBan === false) { return; }      // HV người khác (chỉ để xem) — không ghim
                    const k = this.khoaGhim(r);
                    const i = this.ghim.findIndex(x => this.khoaGhim(x) === k);
                    if (i >= 0) {
                        this.ghim.splice(i, 1);
                        this.bao('Đã bỏ ghim ' + (r.HoVaTen || ''));
                    } else {
                        const d = new Date();
                        const p = (n) => String(n).padStart(2, '0');
                        const ban = Object.assign({}, r, {
                            _ghim_luc: p(d.getDate()) + '/' + p(d.getMonth() + 1) + '/' + d.getFullYear(),
                        });
                        delete ban.CuaBan;
                        this.ghim.unshift(ban);
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
                        // chủ hồ sơ được xem hộ → hiện nút "Đã chạy xong" cho học viên của họ
                        this.user.uy_quyen = Array.isArray(d.uy_quyen) ? d.uy_quyen : [];
                    } catch (e) {
                        this.dsXong.dang = false;
                        this.dsXong.loi = e.thongBao || 'Lỗi';
                    }
                },
                daXong(r) { return !!this.dsXong.khoa[this.khoaGhim(r)]; },
                // Chỉ để ẩn/hiện nút — máy chủ vẫn là bên quyết định
                // (admin, đúng chủ hồ sơ, hoặc người được ủy quyền xem hộ hồ sơ của chủ đó)
                coTheXacNhan(r) {
                    if (r && r._nho) { return true; }      // thẻ trong "Chạy hộ" (lời nhờ còn hiệu lực) — máy chủ vẫn kiểm lại
                    if (this.user.is_admin) { return true; }
                    const chu = this.boDauHs(r.NguoiQuanLy);
                    if (!chu) { return false; }
                    const duoc = [this.user.ndk_name].concat(this.user.uy_quyen || [])
                        .map(t => this.boDauHs(t)).filter(Boolean);
                    return duoc.indexOf(chu) >= 0;
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
                    return this.xongCuaToi.filter(r =>
                        (!this.ghimTT || r.TrungTam === this.ghimTT)
                        && (!this.ghimHang || r.HangGPLX === this.ghimHang)
                        && (!q || this.chiSo([r.HoVaTen, r.MaDK, r.BienSoXe, r.NguoiGhiTen]).indexOf(q) >= 0));
                },

                async moXacNhan(r) {
                    if (r && r.CuaBan === false) { return; }      // HV người khác: server cũng từ chối, chặn sớm cho gọn
                    // tt: tình trạng máy lúc mở hộp — '' (chưa kiểm / không biển) | 'dang_kiem' | 'toi' | 'chua_ro' | 'nguoi_khac' | 'kho' | 'dang_chuyen' | 'loi'
                    this.xn = { mo: true, r: r, kieu: 'nguoi', den: '', denTen: '', tinhTrang: '', boPhan: [], ghiChu: '', dang: false, loi: '',
                                tt: '', giuTen: '', giuLuc: '', chuyenTu: '', chuyenDen: '' };
                    // Mặc định LUÔN là "Giao cho…" (Về kho / Tôi vẫn giữ máy là lựa chọn sau)
                    if (r && r.BienSoXe) { this.kiemMayXn(r); }
                    await this.taiNguoi();
                },
                // Hỏi tình trạng máy DAT của xe: chỉ NGƯỜI ĐANG GIỮ (hoặc máy chưa từng có ghi nhận) mới bàn giao được từ hộp này;
                // người khác giữ / máy ở kho / đang chuyển thì chỉ ghi nhận chạy xong (máy chủ cũng quyết như vậy)
                async kiemMayXn(r) {
                    const xn = this.xn;
                    xn.tt = 'dang_kiem';
                    try {
                        const d = await this.api('/may-dat/xe', { bien_so: r.BienSoXe });
                        if (this.xn !== xn || !xn.mo) { return; }      // đã đóng / mở hộp khác trong lúc chờ
                        const giu = d.dang_giu || {};
                        if (d.dang_chuyen) {
                            xn.tt = 'dang_chuyen';
                            xn.chuyenTu = d.dang_chuyen.tu_ten || 'người giữ';
                            xn.chuyenDen = d.dang_chuyen.den === 'KHO' ? 'Kho' : (d.dang_chuyen.den_ten || 'người nhận');
                        } else if (giu.chua_ro) { xn.tt = 'chua_ro'; }
                        else if (giu.nguoi === this.user.username) { xn.tt = 'toi'; }
                        else if (giu.nguoi === 'KHO') { xn.tt = 'kho'; xn.giuLuc = giu.luc || ''; }
                        else { xn.tt = 'nguoi_khac'; xn.giuTen = giu.ten || 'người khác'; xn.giuLuc = giu.luc || ''; }
                        if (xn.tt === 'nguoi_khac' || xn.tt === 'kho' || xn.tt === 'dang_chuyen') { this.chonKieuXn('giu'); }
                    } catch (e) {
                        if (this.xn === xn) { xn.tt = 'loi'; }
                    }
                },
                // Hộp chỉ ghi nhận (không đổi người giữ máy): ẩn 3 nút kiểu + ô chọn người
                xnChiGhiNhan() { return !!this.xn && (this.xn.tt === 'nguoi_khac' || this.xn.tt === 'kho' || this.xn.tt === 'dang_chuyen'); },
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
                    else if (k === 'giu') { this.xn.den = this.user.username; this.xn.denTen = 'Tôi'; }      // vẫn giữ máy: không tạo lệnh
                    else { this.xn.den = ''; this.xn.denTen = ''; }
                },
                // Chọn nhanh tình trạng máy: bấm lại nút đang chọn = bỏ chọn; về Bình thường/bỏ chọn thì xóa bộ phận
                tinhTrangMay: TINH_TRANG_MAY,
                boPhanMay: BO_PHAN_MAY,
                chonTinhTrang(dt, ma) {
                    const o = this[dt];
                    o.tinhTrang = o.tinhTrang === ma ? '' : ma;
                    if (o.tinhTrang !== 'hong' && o.tinhTrang !== 'loi') { o.boPhan = []; }
                },
                chonBoPhan(dt, b) {
                    const o = this[dt];
                    o.boPhan = o.boPhan.indexOf(b) >= 0 ? o.boPhan.filter(function (x) { return x !== b; }) : o.boPhan.concat([b]);
                },
                ghiChuGhep(dt) { const o = this[dt]; return ghepGhiChu(o.tinhTrang, o.boPhan, o.ghiChu); },
                async guiXacNhan() {
                    if (this.xn.dang) { return; }
                    this.xn.loi = '';
                    if (this.xn.kieu === 'nguoi' && !this.xn.den) { this.xn.loi = 'Hãy chọn người nhận máy.'; return; }
                    if ([...this.ghiChuGhep('xn')].length > TOI_DA_GHI_CHU) { this.xn.loi = 'Ghi chú dài quá ' + TOI_DA_GHI_CHU + ' ký tự.'; return; }
                    this.xn.dang = true;
                    try {
                        const d = await this.api('/dat-xong', {}, { body: {
                            trung_tam: this.xn.r.TrungTam, ma_kh: this.xn.r.MaKH, ma_dk: this.xn.r.MaDK,
                            den: this.xn.den, ghi_chu: this.ghiChuGhep('xn') } });
                        this.xn.mo = false;
                        // Giao cho người khác / về kho: máy CHƯA đổi tay cho tới khi bên kia bấm Nhận
                        const coLenh = !!(d && d.ket_qua && d.ket_qua.lenh_id);
                        const treoSan = !!(d && d.lenh_treo_san);
                        if (d && d.che_do === 'ghi_nhan') {
                            // Máy chủ chỉ ghi nhận (máy đã đổi tay giữa lúc mở hộp và lúc gửi cũng rơi vào đây)
                            this.bao('Đã ghi chạy xong — máy DAT ' + (d.ly_do === 'kho' ? 'đang ở kho'
                                     : d.ly_do === 'dang_chuyen' ? 'đang chuyển (chờ xác nhận)'
                                     : 'vẫn do ' + (d.nguoi_giu_ten || 'người đang giữ') + ' giữ')
                                     + ', không đổi người giữ');
                        } else this.bao(treoSan ? 'Đã ghi chạy xong — máy đang có lệnh chờ, không tạo lệnh mới'
                                 : coLenh ? 'Đã ghi chạy xong — chờ ' + (this.xn.den === 'KHO' ? 'Kho' : this.xn.denTen) + ' xác nhận nhận máy'
                                        : 'Đã ghi nhận chạy xong DAT');
                        await this.taiXong();
                        this.taiNho();
                        this.taiCho(false);
                        if (this.may.co) { this.taiMay(); }
                    } catch (e) {
                        this.xn.loi = e.thongBao || 'Lỗi';
                        if (e.ma === 409) { this.taiXong(); this.taiNho(); }
                    } finally { this.xn.dang = false; }
                },
                async boXacNhan(r) {
                    if (!window.confirm('Bỏ xác nhận "đã chạy xong" của ' + (r.HoVaTen || 'học viên này') + '?')) { return; }
                    try {
                        await this.api('/dat-xong/huy', {}, { body: { trung_tam: r.TrungTam, ma_kh: r.MaKH, ma_dk: r.MaDK } });
                        this.bao('Đã bỏ xác nhận');
                        await this.taiXong();
                        this.taiNho();
                        if (this.may.co) { this.taiMay(); }
                    } catch (e) { this.bao(e.thongBao || 'Lỗi'); }
                },

                // ---------- NHỜ GIÁO VIÊN DẠY HỘ (tab Ghim → mục "Nhờ dạy hộ") ----------
                async taiNho() {
                    if (!this.token || this.khongCoQuyen) { return; }
                    this.nho.dang = true;
                    try {
                        const d = await this.api('/nho-day');
                        this.nho = {
                            bat: d.bat !== false,
                            toi_nho: d.toi_nho || [],
                            nho_toi: (d.nho_toi || []).map(x => Object.assign({ _nho: true }, x)),
                            dang: false, loi: '',
                        };
                    } catch (e) {
                        this.nho.dang = false;
                        this.nho.loi = e.thongBao || 'Lỗi';
                    }
                },
                // Số học viên được nhờ mà CHƯA chạy xong (băng thông báo + số trên nút)
                get nhoToiChuaXong() { return this.nho.nho_toi.filter(r => !r.DaXong); },
                get nhoSoViec() {
                    return this.nho.nho_toi.filter(r => !r.DaXong).length + this.nho.toi_nho.filter(r => !r.DaXong).length;
                },
                // Thẻ "Đang chạy" của tôi: học viên này có đang nhờ ai không?
                nhoDangCua(r) {
                    const k = this.khoaGhim(r);
                    return this.nho.toi_nho.find(x => !x.DaXong && this.khoaGhim(x) === k) || null;
                },
                // Học viên tôi nhờ được: đang chạy + tôi có quyền xác nhận + chưa nhờ ai
                get dsHvNhoDuoc() { return this.dangChay.filter(r => this.coTheXacNhan(r) && !this.nhoDangCua(r)); },
                async moHopNho(r) {
                    this.hopNho = { mo: true, khoa: '', den: '', denTen: '', ghiChu: '', giaoMay: false, kiemMay: false, lyDoKhoa: '', dang: false, loi: '' };
                    const ds = this.dsHvNhoDuoc;
                    const chon = r && ds.find(x => this.khoaGhim(x) === this.khoaGhim(r)) || (ds.length === 1 ? ds[0] : null);
                    this.taiNguoi();
                    if (chon) { await this.datHvNho(this.khoaGhim(chon)); }
                },
                hvNhoDangChon() { return this.dsHvNhoDuoc.find(x => this.khoaGhim(x) === this.hopNho.khoa) || null; },
                // Chọn học viên trong hộp → kiểm máy DAT của xe học viên có đang do tôi giữ không (quyết định ô "Giao luôn máy")
                async datHvNho(khoa) {
                    this.hopNho.khoa = khoa;
                    this.hopNho.giaoMay = false;
                    this.hopNho.lyDoKhoa = '';
                    this.hopNho.loi = '';
                    const r = this.hvNhoDangChon();
                    if (!r) { return; }
                    if (!r.BienSoXe) { this.hopNho.lyDoKhoa = 'Học viên chưa có biển số xe nên không có máy DAT để giao kèm.'; return; }
                    this.hopNho.kiemMay = true;
                    try {
                        const d = await this.api('/may-dat/xe', { bien_so: r.BienSoXe });
                        if (this.hopNho.khoa !== khoa) { return; }      // đã đổi sang học viên khác trong lúc chờ
                        const giu = d.dang_giu || {};
                        if (d.dang_chuyen) { this.hopNho.lyDoKhoa = 'Máy DAT của xe ' + r.BienSoXe + ' đang có lệnh chờ xác nhận nên chưa giao kèm được.'; }
                        else if (giu.chua_ro || giu.nguoi !== this.user.username) {
                            this.hopNho.lyDoKhoa = 'Bạn không phải người đang giữ máy DAT của xe ' + r.BienSoXe
                                + (giu.chua_ro ? ' (chưa rõ ai giữ).' : ' (đang ở ' + (giu.ten || 'người khác') + ').');
                        } else { this.hopNho.giaoMay = true; }      // MẶC ĐỊNH BẬT khi tôi đang giữ máy
                    } catch (e) {
                        if (this.hopNho.khoa === khoa) { this.hopNho.lyDoKhoa = 'Chưa kiểm tra được máy DAT (' + (e.thongBao || 'lỗi') + ') nên chưa giao kèm được.'; }
                    } finally { if (this.hopNho.khoa === khoa) { this.hopNho.kiemMay = false; } }
                },
                async guiNho() {
                    const h = this.hopNho;
                    if (h.dang) { return; }
                    h.loi = '';
                    const r = this.hvNhoDangChon();
                    if (!r) { h.loi = 'Hãy chọn học viên cần nhờ chạy hộ.'; return; }
                    if (!h.den) { h.loi = 'Hãy chọn giáo viên được nhờ.'; return; }
                    if ([...h.ghiChu].length > TOI_DA_GHI_CHU) { h.loi = 'Ghi chú dài quá ' + TOI_DA_GHI_CHU + ' ký tự.'; return; }
                    h.dang = true;
                    try {
                        await this.api('/nho-day', {}, { body: {
                            trung_tam: r.TrungTam, ma_kh: r.MaKH, ma_dk: r.MaDK, nguoi_nhan: h.den,
                            ghi_chu: h.ghiChu, giao_may: !!h.giaoMay && !h.lyDoKhoa } });
                        h.mo = false;
                        this.bao('Đã nhờ ' + h.denTen + ' chạy hộ' + (h.giaoMay ? ' và giao kèm máy DAT' : ''));
                        this.ghimMuc = 'ho';
                        await this.taiNho();
                        if (this.may.co) { this.taiMay(); }
                    } catch (e) {
                        h.loi = e.thongBao || 'Lỗi';
                        if (e.ma === 409) { this.taiNho(); this.taiXong(); }
                    } finally { h.dang = false; }
                },
                // `hanhDong`: 'huy' (tôi nhờ → hủy) · 'tra_lai' (tôi được nhờ → trả lại)
                async dongNho(n, hanhDong) {
                    const hoi = hanhDong === 'huy' ? 'Hủy lời nhờ chạy hộ ' + (n.HoVaTen || 'học viên này') + '?'
                                                    : 'Trả lại lời nhờ chạy hộ ' + (n.HoVaTen || 'học viên này') + '?';
                    if (!window.confirm(hoi)) { return; }
                    try {
                        await this.api('/nho-day/dong', {}, { body: { id: n.id, hanh_dong: hanhDong } });
                        this.bao(hanhDong === 'huy' ? 'Đã hủy lời nhờ' : 'Đã trả lại lời nhờ');
                        await this.taiNho();
                    } catch (e) {
                        this.bao(e.thongBao || 'Lỗi');
                        this.taiNho();
                    }
                },

                // ---------- tab Máy DAT ----------
                mayRong() {
                    return { bien_so: '', dang_giu: { nguoi: 'KHO', ten: 'Kho', luc: null, chua_ro: true }, dang_chuyen: null, nk_cuoi: null, lich_su: [] };
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
                    return { chay_xong: 'Chạy xong', ban_giao: 'Bàn giao', hoan_tac: 'Hoàn tác',
                             lenh_de_nghi: 'Đề nghị', lenh_tu_choi: 'Từ chối', lenh_huy: 'Hủy lệnh',
                             chay_ghi_nhan: 'Chạy xong (không đổi người giữ)' }[l] || l;
                },
                // Khóa x-for cho dòng lịch sử: dòng nhật ký có id, sự kiện của lệnh không có id
                khoaNk(h) { return h.id ? 'n' + h.id : 'l' + h.lenh_id + '-' + h.loai; },

                // ---------- giao / nhận máy (tạo LỆNH, bên kia xác nhận) ----------
                // Các kiểu: giao · tra_kho · nhan_bu · (kho) kho_giao · (kho) kho_ghi_thay
                dsKieuBg() {
                    const ds = [{ ma: 'giao', ten: 'Giao cho…' }, { ma: 'tra_kho', ten: 'Trả về kho' },
                                { ma: 'nhan_bu', ten: 'Tôi đã nhận từ…' }];
                    if (this.coQuyenKho()) {
                        ds.push({ ma: 'kho_giao', ten: 'Kho giao cho…' }, { ma: 'kho_ghi_thay', ten: 'Kho ghi thay' });
                    }
                    return ds;
                },
                datKieuBg(k) {
                    const me = this.user.username;
                    const meTen = this.user.ndk_name || this.user.username;
                    const g = (this.may.kq && this.may.kq.dang_giu) || {};
                    this.bg.kieu = k;
                    this.bg.loi = '';
                    if (k === 'giao') { this.bg.tu = me; this.bg.tuTen = meTen; this.bg.den = ''; this.bg.denTen = ''; }
                    else if (k === 'tra_kho') { this.bg.tu = me; this.bg.tuTen = meTen; this.bg.den = 'KHO'; this.bg.denTen = 'Kho'; }
                    else if (k === 'nhan_bu') { this.bg.tu = ''; this.bg.tuTen = ''; this.bg.den = me; this.bg.denTen = meTen; }
                    else if (k === 'kho_giao') { this.bg.tu = 'KHO'; this.bg.tuTen = 'Kho'; this.bg.den = ''; this.bg.denTen = ''; }
                    else {      // kho_ghi_thay: mặc định từ người đang giữ
                        this.bg.tu = g.nguoi || 'KHO'; this.bg.tuTen = g.ten || 'Kho'; this.bg.den = ''; this.bg.denTen = '';
                    }
                },
                async moBanGiao(kieu) {
                    const g = (this.may.kq && this.may.kq.dang_giu) || {};
                    const toiGiu = g.chua_ro || g.nguoi === this.user.username;
                    const nk = this.may.kq ? this.may.kq.nk_cuoi : null;
                    this.bg = { mo: true, bien: (this.may.kq && this.may.kq.bien_so) || this.may.bien, kieu: '', tu: '', tuTen: '',
                                den: '', denTen: '', tinhTrang: '', boPhan: [], ghiChu: '', nkCuoi: typeof nk === 'number' ? nk : null, dang: false, loi: '' };
                    this.datKieuBg(kieu || (toiGiu ? 'giao' : 'nhan_bu'));
                    await this.taiNguoi();
                },
                // ---------- hộp "Chờ bạn xác nhận" + số đếm ----------
                coQuyenKho() { return (this.user.quyen || []).indexOf('QUANLY_KHO_DAT') >= 0; },
                // Số trên icon ứng dụng (khi trang đang mở). Safari tab thường không có → bỏ qua, không lỗi.
                capNhatHuy() {
                    const n = (this.cho && this.cho.so) || 0;
                    try {
                        if (n > 0 && 'setAppBadge' in navigator) { Promise.resolve(navigator.setAppBadge(n)).catch(() => {}); }
                        else if (n === 0 && 'clearAppBadge' in navigator) { Promise.resolve(navigator.clearAppBadge()).catch(() => {}); }
                    } catch (e) { /* trình duyệt không hỗ trợ: bỏ qua */ }
                },
                async taiCho(moHop) {
                    if (!this.token || this.khongCoQuyen || this.cho.dang) { return; }
                    this.cho.dang = true;
                    try {
                        const d = await this.api('/may-dat/cho-toi');
                        this.cho.cho_toi = d.cho_toi || [];
                        this.cho.toi_gui = d.toi_gui || [];
                        this.cho.so = d.so || 0;
                        this.cho.kho = d.kho || null;
                        this.capNhatHuy();
                        // Mở hộp khi đăng nhập / mở trang / quay lại trang; vòng hỏi 60 giây thì KHÔNG tự bật hộp
                        if (moHop && this.cho.so > 0 && !this.hopCho.mo) { this.moHopCho(); }
                    } catch (e) { /* tuyến phụ: lỗi mạng / máy chủ chưa cập nhật thì thôi, không báo */ }
                    finally { this.cho.dang = false; }
                },
                moHopCho() {
                    this.hopCho = { mo: true, tuChoiId: 0, lyDo: '', dangId: 0, loi: '' };
                },
                // Câu mô tả một lệnh cho người đọc
                moTaLenh(l) {
                    const den = l.den === 'KHO' ? 'Kho' : l.den_ten;
                    if (l.loai === 'chay_xong') { return l.tu_ten + ' đã chạy xong DAT, giao máy cho ' + den; }
                    if (l.loai === 'tra_kho') { return l.tu_ten + ' trả máy về kho'; }
                    if (l.loai === 'kho_giao') { return 'Kho giao máy cho ' + l.den_ten; }
                    if (l.nguoi_tao === l.tu) { return l.tu_ten + ' giao máy cho ' + den; }
                    return l.den_ten + ' khai đã nhận máy từ ' + l.tu_ten;
                },
                batDauTuChoi(l) { this.hopCho.tuChoiId = l.id; this.hopCho.lyDo = ''; this.hopCho.loi = ''; },
                async guiTuChoi(l) {
                    const ly = String(this.hopCho.lyDo || '').trim();
                    if (!ly) { this.hopCho.loi = 'Hãy ghi lý do từ chối.'; return; }
                    if ([...ly].length > TOI_DA_GHI_CHU) { this.hopCho.loi = 'Lý do dài quá ' + TOI_DA_GHI_CHU + ' ký tự.'; return; }
                    await this.xuLyLenh(l, 'tu_choi', ly);
                },
                // nhan | tu_choi | huy | kho_thay — máy chủ kiểm lại vai trò; lệnh đã đổi (409) thì nạp lại cho thấy hiện trạng
                async xuLyLenh(l, hanhDong, lyDo) {
                    if (this.hopCho.dangId) { return; }
                    this.hopCho.dangId = l.id;
                    this.hopCho.loi = '';
                    try {
                        await this.api('/may-dat/lenh/xu-ly', {}, { body: { id: l.id, hanh_dong: hanhDong, ly_do: lyDo || '' } });
                        this.bao({ nhan: 'Đã nhận máy', tu_choi: 'Đã từ chối', huy: 'Đã hủy lệnh', kho_thay: 'Đã xác nhận thay' }[hanhDong] || 'Đã xử lý');
                        this.hopCho.tuChoiId = 0;
                        this.hopCho.lyDo = '';
                        await this.taiCho(false);
                        if (this.may.co) { this.taiMay(); }
                        if (this.tab === 'kho') { this.taiKho(); }
                    } catch (e) {
                        this.hopCho.loi = e.thongBao || 'Lỗi';
                        this.bao(this.hopCho.loi);
                        if (e.ma === 409 || e.ma === 404) { this.taiCho(false); if (this.may.co) { this.taiMay(); } }
                    } finally { this.hopCho.dangId = 0; }
                },
                async huyLenhHoi(l) {
                    if (!window.confirm('Hủy lệnh bàn giao máy ' + (l.bien_so || '') + '?')) { return; }
                    await this.xuLyLenh(l, 'huy');
                },

                // ---------- trang Quản lý kho DAT ----------
                async taiKho() {
                    if (!this.coQuyenKho()) { return; }
                    this.kho.dang = true;
                    this.kho.loi = '';
                    try {
                        const d = await this.api('/kho-dat/may');
                        this.kho.ds = d.may || [];
                        this.kho.dem = d.dem || {};
                        this.kho.daTai = true;
                    } catch (e) { this.kho.loi = e.thongBao || 'Lỗi'; }
                    finally { this.kho.dang = false; }
                },
                demKho(loc) {
                    const d = this.kho.dem || {};
                    if (loc === 'tat_ca') { return this.kho.ds.length; }
                    if (loc === 'kho') { return (d.kho || 0) + (d.chua_ro || 0); }
                    if (loc === 'dang_o') { return d.dang_o || 0; }
                    if (loc === 'dang_chuyen') { return d.dang_chuyen || 0; }
                    if (loc === 'qua_han') { return d.qua_han || 0; }
                    if (loc === 'khong_chay') { return d.khong_chay || 0; }
                    return 0;
                },
                get khoLoc() {
                    const q = this.boDau(this.kho.tim).trim();
                    const loc = this.kho.loc;
                    return this.kho.ds.filter(m =>
                        (loc === 'tat_ca'
                            || (loc === 'kho' && (m.trang_thai === 'kho' || m.trang_thai === 'chua_ro'))
                            || (loc === 'dang_o' && m.trang_thai === 'dang_o')
                            || (loc === 'dang_chuyen' && m.trang_thai === 'dang_chuyen')
                            || (loc === 'qua_han' && m.qua_han)
                            || (loc === 'khong_chay' && this.cbMuc(m.canh_bao) === 'chan'))
                        && (!q || this.chiSo([m.bien_so, m.bien_chuan, m.ten, m.loai_xe, m.trung_tam]).indexOf(q) >= 0));
                },
                nhanTrangThaiMay(m) {
                    return { kho: 'Ở kho', chua_ro: 'Chưa rõ — coi như ở kho', dang_o: 'Đang ở ' + (m.ten || ''),
                             dang_chuyen: 'Đang chuyển' }[m.trang_thai] || m.trang_thai;
                },
                // Bấm thẻ máy → mở tab Máy DAT với lịch sử của máy đó (dùng lại hộp Máy DAT)
                khoMoMay(m) {
                    this.may.bien = m.bien_so;
                    this.doiTab('may');
                    this.taiMay();
                },
                async khoChuanBi(m) { this.may.bien = m.bien_so; await this.taiMay(); return this.may.co; },
                async khoGiaoTuKho(m) { if (await this.khoChuanBi(m)) { this.moBanGiao('kho_giao'); } },
                async khoGhiThay(m) { if (await this.khoChuanBi(m)) { this.moBanGiao('kho_ghi_thay'); } },
                // Kho đang cầm máy trong tay: ghi A → Kho, CÓ HIỆU LỰC NGAY
                async khoNhanVeKho(m) {
                    if (!window.confirm('Ghi nhận máy ' + m.bien_so + ' đã về kho (từ ' + (m.ten || '') + ')? Có hiệu lực ngay.')) { return; }
                    try {
                        const body = { bien_so: m.bien_so, loai: 'kho_ghi_thay', tu: m.nguoi, den: 'KHO', ghi_chu: 'Kho nhận về' };
                        if (m.nk_cuoi !== undefined && m.nk_cuoi !== null) { body.nk_cuoi = m.nk_cuoi; }      // thẻ cũ → máy chủ báo 409
                        await this.api('/may-dat/lenh', {}, { body: body });
                        this.bao('Máy đã về kho');
                        this.taiKho();
                        this.taiCho(false);
                    } catch (e) {
                        this.bao(e.thongBao || 'Lỗi');
                        if (e.ma === 409) { this.taiKho(); }      // thẻ đã cũ: nạp lại để thấy tình trạng mới
                    }
                },
                async khoXacNhanThay(m) {
                    if (!window.confirm('Kho xác nhận thay cho ' + (m.lenh.nguoi_xac_nhan === 'KHO' ? 'Kho' : m.lenh.nguoi_xac_nhan_ten) + '? Máy sẽ đổi người giữ ngay.')) { return; }
                    await this.xuLyLenh(m.lenh, 'kho_thay');
                },
                async khoHuyLenh(m) { await this.huyLenhHoi(m.lenh); },

                // ---------- cảnh báo xe: sát hạch / hết hạn GPXTL (chỉ CẢNH BÁO) ----------
                async taiCanhBao() {
                    if (this.khongCoQuyen || !this.token) { return; }
                    try {
                        const d = await this.api('/may-dat/canh-bao');
                        this.cb = { xe: d.xe || {}, dsXe: d.ds_xe || [], homNay: d.hom_nay || '' };
                    } catch (e) { /* không có cảnh báo vẫn dùng được các tab khác */ }
                },
                // Gợi ý biển ở ô chọn máy: biển trong phân xe ∪ MỌI xe của trung tâm (gồm cả xe vắng, xe chờ đào tạo)
                dsBienMay() {
                    const m = new Map();
                    (this.goiY.bien_so || []).forEach(b => { const c = chuanBienJs(b); if (c && !m.has(c)) { m.set(c, b); } });
                    (this.cb.dsXe || []).forEach(x => { if (x.bien_chuan && !m.has(x.bien_chuan)) { m.set(x.bien_chuan, x.bien_so || x.bien_chuan); } });
                    return [...m.values()];
                },
                cbXe(bien) { return (this.cb.xe || {})[chuanBienJs(bien)] || null; },
                // Danh sách huy hiệu `{muc: 'do'|'cam'|'xam', t}` từ MỘT mục cảnh báo (cả của /may-dat/canh-bao lẫn /may-dat/xe)
                cbDongTu(e) {
                    if (!e) { return []; }
                    const ra = [];
                    (e.ly_do || []).forEach(l => {
                        if (l === 'sat_hach_hom_nay') { ra.push({ muc: 'do', t: 'Xe sát hạch hôm nay' }); }
                        else if (l === 'sat_hach_sap_toi') { ra.push({ muc: 'cam', t: 'Sắp sát hạch ' + ngayViet(e.sat_hach_ngay).slice(0, 5) }); }
                        else if (l === 'het_han') {
                            ra.push({ muc: 'do', t: 'Hết hạn GPXTL (đăng kiểm) ' + ngayViet(e.han_gpxtl) + ' — báo bộ phận quản lý xe' });
                        } else if (l === 'sap_het_han') {
                            ra.push({ muc: 'cam', t: (e.so_ngay_han === 0 ? 'GPXTL (đăng kiểm) hết hạn hôm nay'
                                : 'Sắp hết hạn GPXTL (đăng kiểm): còn ' + e.so_ngay_han + ' ngày') + ' (' + ngayViet(e.han_gpxtl) + ')' });
                        }
                    });
                    if (e.la_xe_sat_hach) { ra.push({ muc: 'xam', t: 'Xe sát hạch' }); }
                    return ra;
                },
                cbDong(bien) { return this.cbDongTu(this.cbXe(bien)); },
                // Mức nặng nhất của một mục: 'chan' (đỏ) | 'canh_bao' (cam) | ''
                cbMuc(e) { return e && e.muc ? e.muc : ''; },
                cbChu(muc) { return muc === 'chan' ? 'Không nên chạy hôm nay' : muc === 'canh_bao' ? 'Cần lưu ý' : ''; },

                // ---------- lịch sát hạch (chỉ người kho) ----------
                hangDong(ds) { return (ds || []).slice().sort((a, b) => (b.loai_xe === 'Xe sát hạch') - (a.loai_xe === 'Xe sát hạch') || String(a.bien_chuan).localeCompare(String(b.bien_chuan))); },
                moLich() {
                    this.lich.mo = !this.lich.mo;
                    if (!this.lich.mo) { return; }
                    if (!this.lich.ngay) { this.lich.ngay = this.cb.homNay || ''; }
                    this.lichDatMacDinh();
                    this.taiLich();
                },
                // Mặc định tick sẵn MỌI xe 'Xe sát hạch' (của trung tâm đang chọn; rỗng = tất cả)
                lichDatMacDinh() {
                    const chon = {};
                    (this.cb.dsXe || []).forEach(x => {
                        if (x.loai_xe === 'Xe sát hạch' && (!this.lich.tt || x.trung_tam === this.lich.tt)) { chon[x.bien_chuan] = true; }
                    });
                    this.lich.chon = chon;
                },
                get lichDsTt() {
                    const t = {};
                    (this.cb.dsXe || []).forEach(x => { if (x.trung_tam) { t[x.trung_tam] = 1; } });
                    return Object.keys(t).sort();
                },
                // Xe hiện trong ô chọn: lọc theo trung tâm + ô tìm; "Xe sát hạch" xếp đầu; tối đa 80 dòng (gõ để thu hẹp)
                get lichXe() {
                    const q = this.boDau(this.lich.tim).trim();
                    return this.hangDong((this.cb.dsXe || []).filter(x =>
                        (!this.lich.tt || x.trung_tam === this.lich.tt)
                        && (!q || this.boDau((x.bien_so || '') + ' ' + (x.bien_chuan || '') + ' ' + (x.loai_xe || '')).indexOf(q) >= 0)
                    )).slice(0, 80);
                },
                get lichSoChon() { return Object.keys(this.lich.chon).filter(k => this.lich.chon[k]).length; },
                async taiLich() {
                    if (!this.coQuyenKho()) { return; }
                    this.lich.dang = true;
                    this.lich.loi = '';
                    try {
                        const d = await this.api('/kho-dat/lich-sat-hach');
                        this.lich.ds = d.lich || [];
                        this.lich.homNay = d.hom_nay || '';
                        this.lich.daTai = true;
                    } catch (e) { this.lich.loi = e.thongBao || 'Lỗi'; }
                    finally { this.lich.dang = false; }
                },
                // Danh sách lịch gộp theo NGÀY (mỗi ngày: các xe + ghi chú + người nhập)
                get lichNhom() {
                    const m = new Map();
                    (this.lich.ds || []).forEach(l => {
                        if (!m.has(l.ngay)) { m.set(l.ngay, { ngay: l.ngay, ds: [], ghi_chu: l.ghi_chu, ten: l.tao_boi_ten }); }
                        m.get(l.ngay).ds.push(l);
                    });
                    return [...m.values()];
                },
                // Gom thao tác: xe sát hạch bị bỏ tick → bo_bien; xe khác được tick → them_bien; cộng thêm biển dán vào
                async luuLich() {
                    if (this.lich.luu) { return; }
                    this.lich.loiLuu = '';
                    if (!this.lich.ngay) { this.lich.loiLuu = 'Hãy chọn ngày sát hạch.'; return; }
                    if ([...this.lich.ghiChu].length > TOI_DA_GHI_CHU) { this.lich.loiLuu = 'Ghi chú dài quá ' + TOI_DA_GHI_CHU + ' ký tự.'; return; }
                    const macDinh = new Set();
                    const dsTt = (this.cb.dsXe || []).filter(x => !this.lich.tt || x.trung_tam === this.lich.tt);
                    dsTt.forEach(x => { if (x.loai_xe === 'Xe sát hạch') { macDinh.add(x.bien_chuan); } });
                    const them = new Set();
                    const bo = [];
                    Object.keys(this.lich.chon).forEach(k => { if (this.lich.chon[k] && !macDinh.has(k)) { them.add(k); } });
                    macDinh.forEach(k => { if (!this.lich.chon[k]) { bo.push(k); } });
                    String(this.lich.dan || '').split(/[\n,;]+/).forEach(b => { const c = chuanBienJs(b); if (c) { them.add(c); } });
                    if (them.size > 60 || bo.length > 60) {
                        this.lich.loiLuu = 'Mỗi lần chỉ thêm/bỏ tối đa 60 xe so với danh sách xe sát hạch mặc định.';
                        return;
                    }
                    if (this.lichSoChon === 0 && !String(this.lich.dan || '').trim()) { this.lich.loiLuu = 'Chưa chọn xe nào.'; return; }
                    this.lich.luu = true;
                    try {
                        const d = await this.api('/kho-dat/lich-sat-hach', {}, { body: {
                            ngay: this.lich.ngay, trung_tam: this.lich.tt, ghi_chu: this.lich.ghiChu,
                            them_bien: [...them], bo_bien: bo } });
                        this.bao('Đã lưu lịch sát hạch ' + ngayViet(d.ngay) + ': ' + d.so_moi + ' xe mới'
                            + (d.so_trung ? ', ' + d.so_trung + ' xe đã có' : ''));
                        this.lich.dan = '';
                        await this.taiLich();
                        this.taiCanhBao();
                        this.taiKho();
                    } catch (e) { this.lich.loiLuu = e.thongBao || 'Lỗi'; }
                    finally { this.lich.luu = false; }
                },
                async huyLich(l) {
                    if (!window.confirm('Hủy lịch sát hạch ' + ngayViet(l.ngay) + ' của xe ' + (l.bien_so || '') + '?')) { return; }
                    try {
                        await this.api('/kho-dat/lich-sat-hach/huy', {}, { body: { id: l.id } });
                        this.bao('Đã hủy lịch');
                    } catch (e) { this.bao(e.thongBao || 'Lỗi'); }
                    await this.taiLich();
                    this.taiCanhBao();
                    this.taiKho();
                },
                // Hủy cả ngày: từng xe một (6 yêu cầu song song mỗi lượt), lỗi một xe không dừng các xe còn lại
                async huyLichNgay(nhom) {
                    if (!window.confirm('Hủy lịch sát hạch ngày ' + ngayViet(nhom.ngay) + ' của ' + nhom.ds.length + ' xe?')) { return; }
                    let loi = 0;
                    for (let i = 0; i < nhom.ds.length; i += 6) {
                        await Promise.all(nhom.ds.slice(i, i + 6).map(l =>
                            this.api('/kho-dat/lich-sat-hach/huy', {}, { body: { id: l.id } }).catch(() => { loi += 1; })));
                    }
                    this.bao(loi ? 'Đã hủy, còn ' + loi + ' xe chưa hủy được' : 'Đã hủy lịch ngày ' + ngayViet(nhom.ngay));
                    await this.taiLich();
                    this.taiCanhBao();
                    this.taiKho();
                },

                // ---------- Cài đặt: đổi mật khẩu ----------
                moCaiDat() {
                    this.ngan = false;
                    this.cd = { mo: true, cu: '', moi: '', lai: '', hien: false, dang: false, loi: '', xong: false };
                    this.kiemTb();
                },

                // ---------- Cài đặt: thông báo đẩy nền ----------
                laIos() {
                    return /iPad|iPhone|iPod/.test(navigator.userAgent || '')
                        || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
                },
                laStandalone() {
                    try {
                        return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches)
                            || navigator.standalone === true;
                    } catch (e) { return false; }
                },
                coHoTroPush() {
                    return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
                },
                coTb() {
                    try { return localStorage.getItem(KHOA_TB + ((this.user && this.user.username) || '')) === '1'; }
                    catch (e) { return false; }
                },
                datCoTb(bat) {
                    try {
                        const k = KHOA_TB + ((this.user && this.user.username) || '');
                        if (bat) { localStorage.setItem(k, '1'); } else { localStorage.removeItem(k); }
                    } catch (e) { /* bỏ qua */ }
                },
                // Mở hộp Cài đặt: xác định trạng thái + TẢI TRƯỚC khóa /push/khoa và chờ SW sẵn sàng,
                // để trong lúc bấm "Bật" lệnh await ĐẦU TIÊN là requestPermission (iOS đòi phải xin quyền từ cú bấm)
                async kiemTb() {
                    this.tb = { trangThai: 'dang', dang: false, loi: '' };
                    TB_REG = null;
                    TB_KHOA = '';
                    try {
                        if (this.laIos() && !this.laStandalone()) { this.tb.trangThai = 'ios'; return; }
                        if (!this.coHoTroPush()) { this.tb.trangThai = 'khong'; return; }
                        if (Notification.permission === 'denied') { this.tb.trangThai = 'chan'; return; }
                        const [reg, kh] = await Promise.all([
                            swSanSang(),
                            this.api('/push/khoa').catch(() => null),
                        ]);
                        if (!reg) { this.tb.trangThai = 'khong'; return; }
                        if (!kh || !kh.khoa) { this.tb.trangThai = 'maychu'; return; }
                        TB_REG = reg;
                        TB_KHOA = kh.khoa;
                        const sub = await reg.pushManager.getSubscription();
                        this.tb.trangThai = (sub && Notification.permission === 'granted' && this.coTb()) ? 'bat' : 'tat';
                    } catch (e) { this.tb.trangThai = 'khong'; }
                },
                // Khóa của đăng ký hiện có có khớp khóa VAPID hiện hành không (đổi khóa service → đổi khóa VAPID)
                khoaKhop(sub, khoa) {
                    const ask = sub && sub.options && sub.options.applicationServerKey;
                    if (!ask) { return true; }
                    const a = new Uint8Array(ask);
                    const b = b64uSangBytes(khoa);
                    if (a.length !== b.length) { return false; }
                    for (let i = 0; i < a.length; i++) { if (a[i] !== b[i]) { return false; } }
                    return true;
                },
                // Đăng ký (hoặc đăng ký lại) thiết bị với khóa hiện hành rồi gửi lên máy chủ — luôn gán đúng chủ là tài khoản đang dùng
                async dangKyThietBi(reg, khoa) {
                    let sub = await reg.pushManager.getSubscription();
                    if (sub && !this.khoaKhop(sub, khoa)) { await sub.unsubscribe(); sub = null; }
                    if (!sub) {
                        sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uSangBytes(khoa) });
                    }
                    const j = sub.toJSON ? sub.toJSON() : {};
                    const k = j.keys || {};
                    await this.api('/push/dang-ky', {}, { body: { endpoint: sub.endpoint, p256dh: k.p256dh, auth: k.auth, khoa: khoa } });
                    return sub;
                },
                async batTb() {
                    if (this.tb.dang) { return; }
                    this.tb.loi = '';
                    this.tb.dang = true;
                    try {
                        const quyen = await Notification.requestPermission();      // PHẢI là await đầu tiên của cú bấm
                        if (quyen === 'denied') { this.tb.trangThai = 'chan'; return; }
                        if (quyen !== 'granted') { this.tb.loi = 'Bạn chưa cho phép thông báo.'; return; }
                        if (!TB_REG || !TB_KHOA) { this.tb.loi = 'Chưa sẵn sàng, hãy đóng hộp này rồi mở lại sau giây lát.'; return; }
                        await this.dangKyThietBi(TB_REG, TB_KHOA);
                        this.datCoTb(true);
                        this.tb.trangThai = 'bat';
                    } catch (e) {
                        this.tb.loi = (e && e.thongBao) || 'Không bật được thông báo. Hãy thử lại.';
                    } finally { this.tb.dang = false; }
                },
                async tatTb() {
                    if (this.tb.dang) { return; }
                    this.tb.loi = '';
                    this.tb.dang = true;
                    try {
                        const reg = TB_REG || await swSanSang();
                        const sub = reg ? await reg.pushManager.getSubscription() : null;
                        if (sub) {
                            // Máy chủ không nhận được cũng thôi: endpoint chết sẽ tự bị xóa ở lần gửi sau (410)
                            try { await this.api('/push/huy', {}, { body: { endpoint: sub.endpoint } }); } catch (e) { /* bỏ qua */ }
                            await sub.unsubscribe();
                        }
                        this.datCoTb(false);
                        this.tb.trangThai = 'tat';
                    } catch (e) { this.tb.loi = 'Không tắt được thông báo. Hãy thử lại.'; }
                    finally { this.tb.dang = false; }
                },
                // Mở ứng dụng: người này đã bật thông báo ở máy này → làm mới đăng ký (khóa VAPID đổi thì đăng ký lại,
                // máy dùng chung thì gán đăng ký về đúng người đang đăng nhập). Chạy ngầm, lỗi thì thôi.
                async tuDangKyLaiTb() {
                    try {
                        if (!this.coHoTroPush() || Notification.permission !== 'granted' || !this.coTb()) { return; }
                        if (this.laIos() && !this.laStandalone()) { return; }
                        const reg = await swSanSang();
                        if (!reg) { return; }
                        const kh = await this.api('/push/khoa');
                        if (kh && kh.khoa) { await this.dangKyThietBi(reg, kh.khoa); }
                    } catch (e) { /* lặng lẽ */ }
                },
                // Đăng xuất: báo máy chủ xóa đăng ký (nếu còn token), rồi LUÔN hủy đăng ký tại máy
                huyPushKhiThoat(token) {
                    try {
                        if (!('serviceWorker' in navigator) || !('PushManager' in window)) { return; }
                        navigator.serviceWorker.getRegistration().then(async (reg) => {
                            if (!reg) { return; }
                            const sub = await reg.pushManager.getSubscription();
                            if (!sub) { return; }
                            if (token) {
                                fetch(API_URL + '/push/huy', {
                                    method: 'POST', keepalive: true,
                                    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ endpoint: sub.endpoint }),
                                }).catch(() => {});
                            }
                            await sub.unsubscribe();
                        }).catch(() => {});
                    } catch (e) { /* bỏ qua */ }
                },
                // Mở từ thông báo đẩy: `#may` → tab Máy DAT + hộp "Chờ bạn xác nhận"; xong thì xóa hash
                moTheoHash() {
                    if (!this.token || this.khongCoQuyen) { return; }
                    if (location.hash === '#ghim') {      // thông báo "Nhờ chạy DAT hộ": tab Ghim → mục Nhờ dạy hộ
                        this.doiTab('ghim');
                        this.ghimMuc = 'ho';
                        try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* bỏ qua */ }
                        return;
                    }
                    if (location.hash !== '#may') { return; }
                    this.taiCho(true);
                    this.doiTab('may');
                    try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* bỏ qua */ }
                },
                async doiMatKhau() {
                    if (this.cd.dang) { return; }
                    this.cd.loi = '';
                    this.cd.xong = false;
                    if (!this.cd.cu) { this.cd.loi = 'Hãy nhập mật khẩu hiện tại.'; return; }
                    if ([...this.cd.moi].length < 6) { this.cd.loi = 'Mật khẩu mới tối thiểu 6 ký tự.'; return; }
                    if (this.cd.moi !== this.cd.lai) { this.cd.loi = 'Hai lần nhập mật khẩu mới không khớp.'; return; }
                    if (this.cd.moi === this.cd.cu) { this.cd.loi = 'Mật khẩu mới phải khác mật khẩu hiện tại.'; return; }
                    this.cd.dang = true;
                    try {
                        // Sai mật khẩu hiện tại trả 400 (không phải 401) nên KHÔNG bị đăng xuất
                        const d = await this.api('/auth/doi-mat-khau', {}, { body: {
                            mat_khau_cu: this.cd.cu, mat_khau_moi: this.cd.moi } });
                        if (d && d.token) {
                            this.token = d.token;
                            localStorage.setItem(KHOA_TOKEN, d.token);
                        }
                        this.cd.cu = ''; this.cd.moi = ''; this.cd.lai = '';
                        this.cd.xong = true;
                        this.bao('Đã đổi mật khẩu');
                    } catch (e) { this.cd.loi = e.thongBao || 'Lỗi'; }
                    finally { this.cd.dang = false; }
                },
                async guiBanGiao() {
                    if (this.bg.dang) { return; }
                    this.bg.loi = '';
                    const k = this.bg.kieu;
                    if (['giao', 'kho_giao', 'kho_ghi_thay'].indexOf(k) >= 0 && !this.bg.den) { this.bg.loi = 'Hãy chọn người nhận máy.'; return; }
                    if (['nhan_bu', 'kho_ghi_thay'].indexOf(k) >= 0 && !this.bg.tu) { this.bg.loi = 'Hãy chọn người giao máy.'; return; }
                    if (this.bg.tu === this.bg.den) { this.bg.loi = 'Người giao và người nhận phải khác nhau.'; return; }
                    if ([...this.ghiChuGhep('bg')].length > TOI_DA_GHI_CHU) { this.bg.loi = 'Ghi chú dài quá ' + TOI_DA_GHI_CHU + ' ký tự.'; return; }
                    this.bg.dang = true;
                    try {
                        const body = { bien_so: this.bg.bien, loai: k, tu: this.bg.tu, den: this.bg.den, ghi_chu: this.ghiChuGhep('bg') };
                        if (this.bg.nkCuoi !== null) { body.nk_cuoi = this.bg.nkCuoi; }      // máy đổi tay giữa chừng → máy chủ báo 409
                        const d = await this.api('/may-dat/lenh', {}, { body: body });
                        this.bg.mo = false;
                        if (d && d.cho_xac_nhan === false) { this.bao('Đã ghi bàn giao'); }
                        else { this.bao('Đã gửi lệnh — chờ bên nhận xác nhận'); }
                        this.taiMay();
                        this.taiCho(false);
                        if (this.tab === 'kho') { this.taiKho(); }
                    } catch (e) {
                        this.bg.loi = e.thongBao || 'Lỗi';
                        if (e.ma === 409) { this.taiMay(); }      // lệnh đang chờ / máy vừa đổi: nạp lại để thấy tình trạng mới
                    }
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
