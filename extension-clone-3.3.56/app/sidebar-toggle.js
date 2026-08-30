(function(){
    const sidebar = document.getElementById('accordionSidebar');
    const overlay = document.getElementById('sidebar-overlay');
    if(!sidebar||!overlay) return;

    function open(){ sidebar.classList.add('is-open'); overlay.classList.add('is-visible'); }
    function close(){ sidebar.classList.remove('is-open'); overlay.classList.remove('is-visible'); }

    // ── Sidebar Toggle (event delegation — handles shell + mounted fragment buttons) ──
    document.addEventListener('click', function(e){
        const toggle = e.target.closest('.sidebar-toggle');
        if (!toggle) return;
        e.preventDefault();
        if (sidebar.classList.contains('is-open')) { close(); } else { open(); }
    });
    overlay.addEventListener('click', close);

    // ── Sidebar Collapse/Expand ──
    const collapseBtn = document.getElementById('sidebarCollapseBtn');
    if (collapseBtn && sidebar) {
        function toggleSidebar() {
            sidebar.classList.toggle('collapsed');
            const collapsed = sidebar.classList.contains('collapsed');
            collapseBtn.textContent = collapsed ? '›' : '‹';
            try { localStorage.setItem('sidebarCollapsed', collapsed); } catch(e) {}
        }
        collapseBtn.addEventListener('click', toggleSidebar);

        // Restore state on load
        try {
            const saved = localStorage.getItem('sidebarCollapsed');
            if (saved === 'true') {
                sidebar.classList.add('collapsed');
                collapseBtn.textContent = '›';
            }
        } catch(e) {}
    }

    // ── Profile Dropdown Menu ──
    const profileEl = document.querySelector('.sidebar__profile');
    const menu = document.getElementById('profileMenu');
    if (profileEl && menu) {
        profileEl.addEventListener('click', function(e) {
            e.stopPropagation();
            import('./modules/profile.js').then(m => m.refreshUI());
            const rect = profileEl.getBoundingClientRect();
            menu.style.left = Math.max(16, rect.left) + 'px';
            menu.style.bottom = (window.innerHeight - rect.top + 10) + 'px';
            menu.classList.toggle('active');
        });
        document.addEventListener('click', function() {
            menu.classList.remove('active');
        });
        menu.addEventListener('click', function(e) {
            e.stopPropagation();
        });
        window.addEventListener('scroll', function() {
            menu.classList.remove('active');
        });
    }
})();
