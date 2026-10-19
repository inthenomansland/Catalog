// ── Site menu ─────────────────────────────────────────────────────────────
// One list of everything a visitor can do (#header-actions), shared by every
// public page. On mobile it is the slide-in drawer behind the hamburger; on
// desktop it drops down from the Menu button. Same markup, two presentations —
// see the header rules in style.css.
const MOBILE_NAV = window.matchMedia('(max-width: 640px)');

function setMenuExpanded(open) {
    ['nav-toggle', 'menu-toggle'].forEach(id => {
        const btn = document.getElementById(id);
        if (btn) btn.setAttribute('aria-expanded', String(open));
    });
}

// Collapses the menu without touching the page's scroll lock — used when an
// item opens a modal, which owns the lock from then on.
function collapseNav() {
    document.getElementById('header-actions').classList.remove('open');
    document.getElementById('drawer-backdrop').classList.remove('visible');
    setMenuExpanded(false);
}

function toggleNavDrawer() {
    const drawer   = document.getElementById('header-actions');
    const backdrop = document.getElementById('drawer-backdrop');
    const open     = drawer.classList.toggle('open');
    backdrop.classList.toggle('visible', open);
    // Only the full-height mobile drawer locks the page behind it. Locking it
    // for the desktop dropdown would make the scrollbar vanish and the page jump.
    if (MOBILE_NAV.matches) document.body.style.overflow = open ? 'hidden' : '';
    setMenuExpanded(open);
}

function closeNavDrawer() {
    collapseNav();
    document.body.style.overflow = '';
}

function toggleFilters() {
    const bar = document.getElementById('filters-bar');
    if (bar) bar.classList.toggle('open');
}

// Close the menu whenever one of its items is chosen.
document.getElementById('header-actions').addEventListener('click', (e) => {
    if (e.target.closest('.header-btn')) collapseNav();
});

// The desktop dropdown has no backdrop to click, so a click anywhere outside
// the menu and its button closes it.
document.addEventListener('click', (e) => {
    const menu = document.getElementById('header-actions');
    if (!menu.classList.contains('open') || MOBILE_NAV.matches) return;
    if (e.target.closest('#header-actions, #menu-toggle')) return;
    collapseNav();
});

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.getElementById('header-actions').classList.contains('open')) closeNavDrawer();
});
