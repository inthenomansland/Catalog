// ── Shared card helpers ───────────────────────────────────────────────────
// Used by both the reports dashboard (app.js) and the Product Updates page
// (product-updates.js), so a manufacturer logo or a date looks the same on
// every card on the site.

function isRecent(dateStr) {
    if (!dateStr) return false;
    return (new Date() - new Date(dateStr)) / (1000 * 60 * 60 * 24) <= 28;
}

function formatDate(dateStr) {
    if (!dateStr) return '—';
    return new Date(dateStr).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

// Manufacturer name -> logo filename slug (e.g. "Blackmagic Design" -> "blackmagicdesign").
// Drop a matching PNG into /logos (e.g. logos/sony.png) and it appears automatically;
// with no file, a coloured monogram tile is shown instead.
//
// Some manufacturers are known by more than one name in reports (rebrands,
// product-line names used interchangeably with the company name). Map the
// alternate spelling's slug to the canonical logo file's slug here so both
// resolve to the same image.
const MFR_SLUG_ALIASES = {
    qsys: 'qsc', // "Q-SYS" is QSC's product line — same company, same logo
    logi: 'logitech', // Logitech's "Logi" brand name
};

function mfrSlug(name) {
    const slug = (name || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
    return MFR_SLUG_ALIASES[slug] || slug;
}

function mfrMonogram(name) {
    const words = (name || '').trim().split(/\s+/).filter(Boolean);
    if (!words.length) return '?';
    if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
    return words[0].slice(0, 2).toUpperCase();
}

function mfrHue(name) {
    let h = 0;
    const s = name || '';
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return h % 360;
}

// Splits a manufacturer field into individual names when a report covers
// more than one, e.g. "Sony, Blackmagic Design" or "Cisco & Poly".
function splitManufacturers(name) {
    return (name || '')
        .split(/\s*(?:,|\/|&|\+|\band\b)\s*/i)
        .map(s => s.trim())
        .filter(Boolean);
}

const MAX_LOGO_TILES = 3;

function mfrLogoTile(name, compact) {
    const hue = mfrHue(name);
    return `
        <div class="card-logo${compact ? ' card-logo--sm' : ''}" title="${name}" style="--mono-bg:hsl(${hue},58%,94%);--mono-fg:hsl(${hue},42%,32%);">
            <span class="card-logo-mono">${mfrMonogram(name)}</span>
            <img src="logos/${mfrSlug(name)}.png" alt="${name} logo" loading="lazy" onerror="this.style.display='none'">
        </div>`;
}

function mfrLogo(rawName) {
    if (!rawName) return '';
    const names = splitManufacturers(rawName);
    if (names.length <= 1) return mfrLogoTile(rawName, false);

    const compact = names.length > 1;
    const shown    = names.slice(0, MAX_LOGO_TILES);
    const overflow = names.length - shown.length;
    const tiles    = shown.map(n => mfrLogoTile(n, compact)).join('');
    const more     = overflow > 0
        ? `<div class="card-logo card-logo--sm card-logo--more" title="${names.slice(MAX_LOGO_TILES).join(', ')}">+${overflow}</div>`
        : '';

    return `<div class="card-logo-group">${tiles}${more}</div>`;
}

// ── Collapsible groups ────────────────────────────────────────────────────
// A group heading (Kit / Program / Concept on the dashboard, a manufacturer on
// Product Updates) folds its cards away so the next group is one scroll off.
// Groups start open; what a visitor folds is remembered in their browser only.
// While a search or filter is active every group shows open, so a match is
// never hidden inside a folded group.
function collapsedGroups(page) {
    try { return new Set(JSON.parse(localStorage.getItem(`collapsed-groups:${page}`)) || []); }
    catch { return new Set(); }
}

function saveCollapsedGroups(page, names) {
    try { localStorage.setItem(`collapsed-groups:${page}`, JSON.stringify([...names])); } catch {}
}

function makeGroupCollapsible(group, page, name, filtersActive) {
    const header = group.querySelector('.group-header');
    const count  = header.querySelector('.group-count');

    const right = document.createElement('span');
    right.className = 'group-header-right';
    if (count) right.appendChild(count);
    right.insertAdjacentHTML('beforeend', '<span class="group-chevron" aria-hidden="true">▼</span>');
    header.appendChild(right);

    header.classList.add('group-header--toggle');
    header.setAttribute('role', 'button');
    header.setAttribute('tabindex', '0');

    const setCollapsed = collapsed => {
        group.classList.toggle('collapsed', collapsed);
        header.setAttribute('aria-expanded', String(!collapsed));
    };
    setCollapsed(!filtersActive && collapsedGroups(page).has(name));

    const toggle = () => {
        const collapsed = !group.classList.contains('collapsed');
        setCollapsed(collapsed);
        const names = collapsedGroups(page);
        collapsed ? names.add(name) : names.delete(name);
        saveCollapsedGroups(page, names);
    };
    header.addEventListener('click', toggle);
    header.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
    });
}
