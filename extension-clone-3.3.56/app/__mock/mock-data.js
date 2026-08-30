/* ================================================================
   WISTORIX CLONE — MOCK DATA
   Sinh bộ file Google Drive giả lập, ổn định giữa các lần load.
   Chỉ dùng cho bản clone tĩnh, không có trong extension thật.
   ================================================================ */
(function () {
    'use strict';

    // PRNG có seed → dữ liệu không đổi mỗi lần refresh
    function rng(seed) {
        let s = seed >>> 0;
        return function () {
            s = (s * 1664525 + 1013904223) >>> 0;
            return s / 4294967296;
        };
    }

    const rand = rng(20260829);
    const pick = (arr) => arr[Math.floor(rand() * arr.length)];
    const int = (min, max) => min + Math.floor(rand() * (max - min + 1));

    const OWNER = {
        displayName: 'Phạm Việt Hùng',
        emailAddress: 'demo@wistorix.dev',
        photoLink: '',
        me: true
    };
    const OTHERS = [
        { displayName: 'Trần Minh Anh', emailAddress: 'minhanh@congty.vn', photoLink: '', me: false },
        { displayName: 'Lê Thu Hà',     emailAddress: 'thuha@congty.vn',   photoLink: '', me: false },
        { displayName: 'Design Team',   emailAddress: 'design@congty.vn',  photoLink: '', me: false }
    ];

    const TYPES = [
        { mime: 'application/pdf',              ext: '.pdf',  min: 120e3,  max: 18e6 },
        { mime: 'image/jpeg',                   ext: '.jpg',  min: 200e3,  max: 12e6 },
        { mime: 'image/png',                    ext: '.png',  min: 80e3,   max: 8e6 },
        { mime: 'video/mp4',                    ext: '.mp4',  min: 20e6,   max: 900e6 },
        { mime: 'application/zip',              ext: '.zip',  min: 2e6,    max: 400e6 },
        { mime: 'audio/mpeg',                   ext: '.mp3',  min: 2e6,    max: 30e6 },
        { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', ext: '.docx', min: 30e3, max: 4e6 },
        { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',       ext: '.xlsx', min: 40e3, max: 9e6 },
        { mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', ext: '.pptx', min: 1e6, max: 60e6 },
        { mime: 'application/vnd.google-apps.document',    ext: '', min: 0, max: 0 },
        { mime: 'application/vnd.google-apps.spreadsheet', ext: '', min: 0, max: 0 }
    ];

    const NOUNS = [
        'Báo cáo doanh thu', 'Hợp đồng dịch vụ', 'Kế hoạch marketing', 'Biên bản họp',
        'Đề xuất ngân sách', 'Thiết kế landing page', 'Ảnh sự kiện khai trương',
        'Video giới thiệu sản phẩm', 'Danh sách khách hàng', 'Bảng lương nhân sự',
        'Tài liệu onboarding', 'Kịch bản telesale', 'Bộ nhận diện thương hiệu',
        'Phân tích đối thủ', 'Checklist bàn giao', 'Hồ sơ năng lực', 'Ảnh chụp màn hình lỗi',
        'Backup cơ sở dữ liệu', 'Bản nháp nội dung', 'Sao kê thanh toán'
    ];
    const SUFFIX = ['2024', '2025', '2026', 'final', 'v2', 'v3', 'bản cuối', 'copy', 'draft', 'Q1', 'Q2', 'Q3', 'Q4'];

    const FOLDERS = [
        { id: 'fld_root_work',    name: '01_Công việc' },
        { id: 'fld_root_design',  name: '02_Thiết kế' },
        { id: 'fld_root_finance', name: '03_Tài chính' },
        { id: 'fld_root_media',   name: '04_Media' },
        { id: 'fld_root_archive', name: '05_Lưu trữ' }
    ];

    function isoDaysAgo(days) {
        return new Date(Date.now() - days * 86400000).toISOString();
    }

    function makePermissions(kind) {
        const base = [{ id: 'owner', type: 'user', role: 'owner', emailAddress: OWNER.emailAddress, displayName: OWNER.displayName, photoLink: '' }];
        if (kind === 'public') {
            base.push({ id: 'anyoneWithLink', type: 'anyone', role: 'reader', emailAddress: '', displayName: '', photoLink: '' });
        } else if (kind === 'domain') {
            base.push({ id: 'domainAll', type: 'domain', role: 'reader', domain: 'congty.vn', emailAddress: '', displayName: '', photoLink: '' });
        } else if (kind === 'user') {
            const u = pick(OTHERS);
            base.push({ id: 'u_' + u.emailAddress, type: 'user', role: 'writer', emailAddress: u.emailAddress, displayName: u.displayName, photoLink: '' });
        }
        return base;
    }

    const files = [];

    // ── Thư mục gốc ────────────────────────────────────────────
    FOLDERS.forEach((f, i) => {
        files.push({
            id: f.id,
            name: f.name,
            mimeType: 'application/vnd.google-apps.folder',
            size: 0,
            md5Checksum: null,
            createdTime: isoDaysAgo(700 - i * 30),
            modifiedTime: isoDaysAgo(int(1, 120)),
            webViewLink: 'https://drive.google.com/drive/folders/' + f.id,
            ownedByMe: true,
            parents: [],
            trashed: false,
            shared: i === 1,
            owners: [OWNER],
            permissions: makePermissions(i === 1 ? 'domain' : 'private'),
            capabilities: { canDownload: true, canEdit: true, canCopy: true, canShare: true, canTrash: true },
            contentRestrictions: []
        });
    });

    // Thư mục rỗng (cho card "File / Folder rỗng")
    files.push({
        id: 'fld_empty_01', name: '06_Thư mục rỗng', mimeType: 'application/vnd.google-apps.folder',
        size: 0, md5Checksum: null, createdTime: isoDaysAgo(400), modifiedTime: isoDaysAgo(400),
        webViewLink: 'https://drive.google.com/drive/folders/fld_empty_01', ownedByMe: true,
        parents: [], trashed: false, shared: false, owners: [OWNER], permissions: makePermissions('private'),
        capabilities: { canDownload: true, canEdit: true, canCopy: true, canShare: true, canTrash: true },
        contentRestrictions: []
    });

    // ── File thường ────────────────────────────────────────────
    const DUPE_HASHES = ['d0000000000000000000000000000001', 'd0000000000000000000000000000002', 'd0000000000000000000000000000003'];

    for (let i = 0; i < 150; i++) {
        const type = pick(TYPES);
        const isGoogleDoc = type.mime.indexOf('google-apps') !== -1;
        const name = pick(NOUNS) + ' ' + pick(SUFFIX) + type.ext;

        // Phân bố trạng thái
        let shareKind = 'private';
        const r = rand();
        if (r < 0.10) shareKind = 'public';
        else if (r < 0.20) shareKind = 'domain';
        else if (r < 0.32) shareKind = 'user';

        const stale = rand() < 0.35;
        const trashed = rand() < 0.08;
        const orphan = rand() < 0.07;
        const empty = !isGoogleDoc && rand() < 0.05;
        const notMine = rand() < 0.12;

        // Trùng lặp: 18% file dùng chung một md5 → tạo nhóm duplicate
        let md5 = null;
        let size = isGoogleDoc || empty ? 0 : int(type.min, type.max);
        if (!isGoogleDoc && !empty) {
            if (rand() < 0.18) {
                md5 = pick(DUPE_HASHES);
                size = 4 * 1024 * 1024 + DUPE_HASHES.indexOf(md5) * 1024;
            } else {
                md5 = 'h' + (10000000 + i).toString(16).padStart(31, '0');
            }
        }

        const created = int(30, 900);
        const modified = stale ? int(400, created) : int(0, Math.min(60, created));

        files.push({
            id: 'file_' + String(i).padStart(4, '0'),
            name: name,
            mimeType: type.mime,
            size: size,
            md5Checksum: md5,
            createdTime: isoDaysAgo(created),
            modifiedTime: isoDaysAgo(modified),
            webViewLink: 'https://drive.google.com/file/d/file_' + String(i).padStart(4, '0') + '/view',
            ownedByMe: !notMine,
            parents: orphan ? [] : [pick(FOLDERS).id],
            trashed: trashed,
            shared: shareKind !== 'private',
            owners: notMine ? [pick(OTHERS)] : [OWNER],
            permissions: makePermissions(notMine ? 'user' : shareKind),
            capabilities: { canDownload: true, canEdit: !notMine, canCopy: true, canShare: !notMine, canTrash: !notMine },
            contentRestrictions: []
        });
    }

    window.WistorixMockData = {
        owner: OWNER,
        files: files,
        storageQuota: {
            limit: String(15 * 1024 * 1024 * 1024),
            usage: String(files.reduce(function (s, f) { return s + (Number(f.size) || 0); }, 0) + 1.2 * 1024 * 1024 * 1024),
            usageInDrive: String(files.reduce(function (s, f) { return s + (Number(f.size) || 0); }, 0)),
            usageInDriveTrash: String(files.filter(function (f) { return f.trashed; }).reduce(function (s, f) { return s + (Number(f.size) || 0); }, 0))
        }
    };
})();
