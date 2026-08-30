// ================================================================
// WISTORIX — App Shell Fragment Router
// - Đọc route từ location.hash.
// - Lazy-load fragment một lần, giữ DOM (cache).
// - Mount controller một lần, gọi onShow/onHide khi đổi route.
// - Không reload toàn bộ document.
// ================================================================

(function () {
    'use strict';

    // ── Route map ───────────────────────────────────────────────
    const ROUTES = {
        '/dashboard':    { name: 'dashboard',    builtin: 'view-dashboard',    title: 'Dashboard' },
        '/mydrive':      { name: 'mydrive',      fragment: 'pages/mydrive-view.html',      controller: () => import('./mydrive.js'),      title: 'My Drive' },
        '/email-shared': { name: 'email-shared', fragment: 'pages/email-shared-view.html', controller: () => import('./email-shared.js'), title: 'Email được chia sẻ' },
        '/settings':     { name: 'settings',     fragment: 'pages/settings-view.html',     controller: () => import('./settings.js'),     title: 'Cài đặt' },
        '/invite':       { name: 'invite',       fragment: 'pages/invite-view.html',       controller: () => import('./invite.js'),       title: 'Mời bạn bè' },
        '/upgrade':      { name: 'upgrade',      fragment: 'pages/upgrade-view.html',      controller: () => import('./upgrade.js'),      title: 'Nâng cấp Pro' },
        '/cleanup':      { name: 'cleanup',      fragment: 'pages/cleanup-view.html',      controller: () => import('./invite.js'),       title: 'Lượt dọn dẹp' },
    };

    const DEFAULT_ROUTE = '/dashboard';

    // Legacy page URL → route (giữ tương thích link cũ)
    const LEGACY_MAP = {
        'dashboard.html': '/dashboard',
        'mydrive.html': '/mydrive',
        'email-shared.html': '/email-shared',
        'settings.html': '/settings',
        'invite.html': '/invite',
        'upgrade.html': '/upgrade',
        'cleanup.html': '/cleanup',
    };

    // ── Caches ──────────────────────────────────────────────────
    const appState = window.WistorixAppState;
    const fragmentCache = new Map(); // fragment path -> HTML string (response text)
    const loadPromises  = new Map(); // fragment path -> in-flight fetch promise
    const stylePromises = new Map(); // stylesheet URL -> in-flight load promise
    const mountedPages  = appState.mountedPages; // routeName -> { root, controller, mounted }

    let container = null;        // #app-content
    let started = false;
    let currentRoute = null;
    let navigationId = 0;

    // ── Helpers ─────────────────────────────────────────────────
    function parseHash() {
        let h = window.location.hash || '';
        if (h.charAt(0) === '#') h = h.slice(1);
        if (h.charAt(0) === '/') h = h.slice(1);
        h = h.split('?')[0].split('#')[0];
        const key = '/' + h;
        return ROUTES[key] ? key : DEFAULT_ROUTE;
    }

    function getShellViews() {
        return ['view-dashboard', 'view-scan-start', 'view-scan-progress', 'view-scan-result']
            .map(id => document.getElementById(id))
            .filter(Boolean);
    }

    function fragmentUrl(path) {
        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL) {
            return chrome.runtime.getURL(path);
        }
        return path;
    }

    async function loadFragment(path) {
        if (fragmentCache.has(path)) return fragmentCache.get(path);
        if (loadPromises.has(path)) return loadPromises.get(path);

        const p = fetch(fragmentUrl(path)).then(async (res) => {
            if (!res.ok) throw new Error('Fragment load failed: ' + path + ' (' + res.status + ')');
            const html = await res.text();
            fragmentCache.set(path, html);
            loadPromises.delete(path);
            return html;
        }).catch((err) => {
            loadPromises.delete(path);
            throw err;
        });

        loadPromises.set(path, p);
        return p;
    }

    function fragmentStyleUrls(html) {
        const urls = [];
        const pattern = /@import\s+(?:url\(\s*)?["']?([^"'\s)]+)["']?\s*\)?\s*;/gi;
        let match;
        while ((match = pattern.exec(html || ''))) urls.push(match[1]);
        return [...new Set(urls)];
    }

    function withoutFragmentStyleImports(html) {
        return String(html || '').replace(/@import\s+(?:url\(\s*)?["']?([^"'\s)]+)["']?\s*\)?\s*;/gi, '');
    }

    function absoluteStyleUrl(path) {
        return new URL(path, document.baseURI).href;
    }

    function ensureStylesheet(path) {
        const href = absoluteStyleUrl(path);
        if (stylePromises.has(href)) return stylePromises.get(href);
        const existing = [...document.querySelectorAll('link[rel="stylesheet"]')]
            .find(link => link.href === href);
        if (existing?.sheet || existing?.dataset.wistorixRouteStyleReady === 'true') {
            return Promise.resolve();
        }
        const link = existing || document.createElement('link');
        if (!existing) {
            link.rel = 'stylesheet';
            link.href = href;
            link.dataset.wistorixRouteStyle = href;
        }
        const promise = new Promise((resolve, reject) => {
            const done = () => {
                link.dataset.wistorixRouteStyleReady = 'true';
                resolve();
            };
            link.addEventListener('load', done, { once: true });
            link.addEventListener('error', () => reject(new Error('Stylesheet load failed: ' + path)), { once: true });
            if (link.sheet) done();
            else if (!existing) document.head.appendChild(link);
        }).catch(error => {
            stylePromises.delete(href);
            throw error;
        });
        stylePromises.set(href, promise);
        return promise;
    }

    function ensureFragmentStyles(html) {
        return Promise.all(fragmentStyleUrls(html).map(ensureStylesheet));
    }

    async function prepareRouteResources(route) {
        const fragmentPromise = loadFragment(route.fragment);
        const controllerPromise = route.controller ? route.controller() : Promise.resolve(null);
        const html = await fragmentPromise;
        const [controller] = await Promise.all([controllerPromise, ensureFragmentStyles(html)]);
        return { html: withoutFragmentStyleImports(html), controller };
    }

    function prefetchRoutes(routeKeys) {
        return Promise.allSettled((routeKeys || []).map(async (key) => {
            const route = ROUTES[key];
            if (!route?.fragment) return;
            await prepareRouteResources(route);
        }));
    }

    function createRouteWrapper(html) {
        const wrap = document.createElement('div');
        wrap.className = 'app-route';
        wrap.style.cssText = 'display:none;flex-direction:column;flex:1;min-height:0;';
        wrap.innerHTML = html;
        // Loại bỏ script nếu fragment vô tình có (CSP đã chặn, phòng hờ)
        wrap.querySelectorAll('script').forEach(s => s.remove());
        container.appendChild(wrap);
        return wrap;
    }

    // ── Sidebar active state ────────────────────────────────────
    function updateSidebar(routeKey) {
        document.querySelectorAll('.sidebar__nav-item').forEach((el) => {
            const target = (el.getAttribute('data-route') || '');
            el.classList.toggle('sidebar__nav-item--active', target === routeKey);
        });
    }

    // ── Shell (dashboard) route handling ────────────────────────
    function showShellDashboard() {
        const sv = window.ScanFlowController;
        if (sv && sv._isScanning) return;
        if (sv && typeof sv._showView === 'function') {
            // Restore controller state.  File count is not a view-state signal:
            // a completed first scan may legitimately contain zero files.
            sv._showView(sv._currentView || (sv._isFirstScan ? 'scanStart' : 'dashboard'));
        } else {
            const d = document.getElementById('view-dashboard');
            if (d) d.style.display = 'flex';
        }
    }

    function hideShellViews() {
        getShellViews().forEach(v => { v.style.display = 'none'; });
    }

    // ── Fragment route mounting ─────────────────────────────────
    function startControllerMount(entry, route) {
        if (entry.mounted || !entry.controller) return;
        entry.mounted = true;
        try {
            // Async controllers run synchronously until their first await.
            // That is the route critical setup boundary; remote hydration must
            // never delay or partially reveal the shell.
            entry.mountPromise = Promise.resolve(entry.controller.mount?.(entry.root, route.name));
            entry.mountPromise.catch(error => console.error('[router] mount ' + route.name, error));
        } catch (error) {
            entry.mountError = error;
            console.error('[router] mount ' + route.name, error);
        }
    }

    async function prepareFragment(route, isCurrent) {
        const existing = mountedPages.get(route.name);
        if (existing) {
            // A route is cacheable only while its wrapper remains owned by the
            // page host.  Reattach the existing subtree if another component
            // detached it; do not refetch or rebuild its page state.
            if (!existing.wrapper.isConnected || existing.wrapper.parentElement !== container) {
                container.appendChild(existing.wrapper);
            }
            return existing;
        }

        const { html, controller } = await prepareRouteResources(route);
        if (!isCurrent()) return null;

        const wrapper = createRouteWrapper(html);
        const root = wrapper.querySelector('.wix-view') || wrapper;
        const entry = { wrapper, root, controller, mounted: false, mountPromise: null, mountError: null };
        mountedPages.set(route.name, entry);
        startControllerMount(entry, route);
        return entry;
    }

    function hideFragmentRoutes(exceptName) {
        mountedPages.forEach((entry, name) => {
            if (name !== exceptName) {
                entry.wrapper.style.display = 'none';
                entry.controller?.onHide?.(entry.root, name);
            }
        });
    }

    function commitFragmentRoute(route, entry) {
        // No await between hiding old route and revealing prepared route.
        // Browser paints only this completed, styled route transition.
        hideShellViews();
        hideFragmentRoutes(route.name);
        if (container) container.style.display = 'flex';
        entry.wrapper.style.display = 'flex';
        Promise.resolve(entry.controller?.onShow?.(entry.root, route.name))
            .catch(error => console.error('[router] show ' + route.name, error));
    }

    async function prepareAndCommitRoute({ route, isCurrent, prepare = prepareFragment, commit = commitFragmentRoute }) {
        const entry = await prepare(route, isCurrent);
        if (!entry || !isCurrent()) return false;
        commit(route, entry);
        return true;
    }

    // ── Navigate ────────────────────────────────────────────────
    async function navigate() {
        const key = parseHash();
        const route = ROUTES[key];
        const scanFlow = window.ScanFlowController;
        // A scan owns the shell until it succeeds or fails.  Keep the current
        // progress view mounted even when a sidebar/hash navigation is fired.
        if (scanFlow && scanFlow._isScanning) {
            if (key !== '/dashboard') window.location.hash = '#/dashboard';
            return;
        }
        const id = ++navigationId;
        const isCurrent = () => id === navigationId && parseHash() === key;

        if (key === '/dashboard') {
            hideFragmentRoutes('dashboard');
            if (container) container.style.display = 'none';
            showShellDashboard();
        } else {
            try {
                // Keep current dashboard/route visible during cold fragment,
                // stylesheet, and controller-module preparation.
                await prepareAndCommitRoute({ route, isCurrent });
            } catch (err) {
                if (!isCurrent()) return;
                console.error('[router] navigate ' + key, err);
                // Không làm trắng app — về dashboard
                window.location.hash = '#/dashboard';
                return;
            }
        }

        if (!isCurrent()) return;
        currentRoute = route.name;
        appState.currentRoute = key;
        appState.currentPageEl = key === '/dashboard'
            ? document.getElementById('view-dashboard')
            : mountedPages.get(route.name)?.root || null;
        updateSidebar(key);
        document.title = (route && route.title) ? 'Wistorix — ' + route.title : 'Wistorix';
    }

    function onHashChange() {
        if (!started) return;
        navigate().catch(e => console.error('[router] hashchange', e));
    }

    // ── Intercept legacy links & tab buttons ────────────────────
    function installLinkInterceptor() {
        document.addEventListener('click', (e) => {
            if (window.ScanFlowController?._isScanning && e.target.closest('.sidebar__nav-item, .sidebar__card')) {
                e.preventDefault();
                e.stopPropagation();
                return;
            }
            const a = e.target.closest('a[href]');
            if (a) {
                const href = a.getAttribute('href') || '';
                const m = href.match(/([a-z0-9-]+\.html)(#[^)]*)?/i);
                if (m && LEGACY_MAP[m[1]]) {
                    e.preventDefault();
                    window.location.hash = '#' + LEGACY_MAP[m[1]];
                }
                return;
            }
            const btn = e.target.closest('[data-href]');
            if (btn) {
                const href = btn.getAttribute('data-href') || '';
                const m = href.match(/([a-z0-9-]+\.html)(#[^)]*)?/i);
                if (m && LEGACY_MAP[m[1]]) {
                    e.preventDefault();
                    e.stopPropagation();
                    window.location.hash = '#' + LEGACY_MAP[m[1]];
                }
            }
        });
    }

    // ── Init ────────────────────────────────────────────────────
    function init() {
        if (started) return;
        container = document.getElementById('app-content');
        if (!container) {
            console.warn('[router] #app-content missing');
            return;
        }
        // Fragments cannot live inside #view-dashboard: navigating away hides
        // that parent and leaves cached page nodes detached/blank.  Preserve
        // the same shell and move only router mount point beside dashboard.
        const shellContent = document.getElementById('content');
        if (shellContent && container.parentElement !== shellContent) {
            shellContent.appendChild(container);
        }
        started = true;
        installLinkInterceptor();
        window.addEventListener('hashchange', onHashChange);
        // Route ban đầu — xử lý sau khi shell/auth sẵn sàng
        navigate().catch(e => console.error('[router] init', e));
    }

    window.WistorixRouter = {
        init, navigate, prefetchRoutes, ROUTES, LEGACY_MAP, mountedPages,
        __test: { fragmentStyleUrls, withoutFragmentStyleImports, prepareAndCommitRoute, startControllerMount }
    };
})();
