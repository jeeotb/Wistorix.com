// ================================================================
// WISTORIX — Shared App State
// App Shell + Fragment Router hỗ trợ lưu giữ dữ liệu dùng chung
// giữa các page (không đổi schema storage hiện có).
// ================================================================

const AppState = (window.WistorixAppState = {
    // Files từ cache Drive — dùng chung để tránh đọc storage lặp lại
    filesCache: null,
    filesCacheLoaded: false,
    filesCacheLoading: null, // shared promise (tránh 2 page cùng gọi load)

    // Trạng thái navigation hiện tại
    currentRoute: null,
    currentPageEl: null,

    // Cache DOM fragment đã mount (root element per route)
    mountedPages: new Map(), // routeName -> { root, mounted }

    // Trạng thái UI dùng chung
    sidebarCollapsed: null,

    async getFiles(loadFilesFromCache, scanDrive) {
        if (this.filesCacheLoaded) return this.filesCache || [];
        if (this.filesCacheLoading) return this.filesCacheLoading;

        this.filesCacheLoading = (async () => {
            let files = await loadFilesFromCache();
            // Timestamp cache version 1 is written only after both canonical
            // Drive fields are persisted together. Older non-empty caches must
            // refresh once; otherwise they bypass scanDrive's repair path.
            const needsTimestampRefresh = files?.length > 0
                && files.some(file => file?.timestampCacheVersion !== 1);
            if (!files || files.length === 0 || needsTimestampRefresh) files = await scanDrive();
            this.filesCache = files || [];
            this.filesCacheLoaded = true;
            return this.filesCache;
        })();

        try {
            return await this.filesCacheLoading;
        } finally {
            this.filesCacheLoading = null;
        }
    },
});
