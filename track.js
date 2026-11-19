// ── Anonymous usage analytics ─────────────────────────────────────────────
// Sends small "this happened" events to our own server (/api/track) for the
// admin Analytics tab. No cookies, nothing stored in the browser, nothing sent
// anywhere else, and no names or emails — only what was used, e.g. "Full
// Report opened on <report title>". See the Analytics section in server.js.
//
// Mostly hooks in by listening to the page (clicks, search box, filters), so
// the page code only calls track() in the few places where a form is actually
// sent successfully.
(function () {
    // The lab team's own browsing would swamp the numbers, so nothing is sent
    // from a browser that is logged in to the admin page.
    let isAdmin = false;
    try { isAdmin = !!localStorage.getItem('poc-admin-token'); } catch { /* private mode */ }

    function track(type, label, detail) {
        if (isAdmin) return;
        const body = JSON.stringify({ type, label: label || '', detail: detail || '', page: location.pathname });
        try {
            // sendBeacon survives the page being left straight after a click
            // (e.g. opening a report link).
            if (navigator.sendBeacon && navigator.sendBeacon('/api/track', new Blob([body], { type: 'application/json' }))) return;
            fetch('/api/track', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {});
        } catch { /* analytics must never break the page */ }
    }
    window.track = track;

    // Page visit, with phone vs desktop.
    track('view', '', window.matchMedia('(max-width: 768px)').matches ? 'mobile' : 'desktop');

    document.addEventListener('click', (e) => {
        // Report / deck links on the cards.
        const link = e.target.closest('.card-actions a');
        if (link) {
            const title = (link.closest('.card')?.querySelector('.card-title')?.textContent || '').trim();
            const kind  = link.textContent.trim();
            if (kind === 'View Deck') track('open_deck', title);
            else track('open_report', title, kind);   // "Full Report" or "Front Page"
            return;
        }
        // Header menu buttons (Get Notified, Request a PoC, Product Updates, …).
        const btn = e.target.closest('.header-btn');
        if (btn && !btn.classList.contains('menu-btn')) {
            track('action', btn.textContent.trim(), 'clicked');
            return;
        }
        if (e.target.closest('.gotchas-toggle')) track('action', 'Known Issues list', 'clicked');
    });

    // Search box: record what was typed once the person pauses, and whether
    // anything matched — "searched but found nothing" shows gaps in the catalogue.
    const search = document.getElementById('search');
    if (search) {
        let timer, last = '';
        search.addEventListener('input', () => {
            clearTimeout(timer);
            timer = setTimeout(() => {
                const term = search.value.trim().toLowerCase();
                if (term.length < 3 || term === last) return;
                last = term;
                const none = document.getElementById('no-results');
                track('search', term, none && !none.classList.contains('hidden') ? 'none' : 'results');
            }, 1500);
        });
    }

    // Filter dropdowns: "Manufacturer: Crestron", "Test Type: Kit", …
    const FILTER_NAMES = { 'filter-manufacturer': 'Manufacturer', 'filter-category': 'Category', 'filter-type': 'Test Type' };
    Object.keys(FILTER_NAMES).forEach(id => {
        const sel = document.getElementById(id);
        if (!sel) return;
        sel.addEventListener('change', () => { if (sel.value) track('filter', `${FILTER_NAMES[id]}: ${sel.value}`); });
    });
})();
