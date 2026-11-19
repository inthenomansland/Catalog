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
        <div class="card-logo${compact ? ' card-logo--sm' : ''}" title="${escapeHtml(name)}" style="--mono-bg:hsl(${hue},58%,94%);--mono-fg:hsl(${hue},42%,32%);">
            <span class="card-logo-mono">${escapeHtml(mfrMonogram(name))}</span>
            <img src="logos/${mfrSlug(name)}.png" alt="${escapeHtml(name)} logo" loading="lazy" onerror="this.style.display='none'">
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
        ? `<div class="card-logo card-logo--sm card-logo--more" title="${escapeHtml(names.slice(MAX_LOGO_TILES).join(', '))}">+${overflow}</div>`
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

// ── Loading / load failure ────────────────────────────────────────────────
// Each list page starts with a .load-state placeholder in its root ("Loading
// …") that render() clears. If the data can't be fetched, swap it for a plain
// explanation and a Try again button rather than leaving an empty page.
function showLoadError(rootId, what, retry) {
    const root = document.getElementById(rootId);
    if (!root) return;
    root.innerHTML = `
        <div class="load-state load-state--error" role="alert">
            <p><strong>Couldn't load ${what}.</strong></p>
            <p>The lab server may be restarting — give it a moment and try again.
               If it keeps happening, email <a href="mailto:poc.lab@proav.com">poc.lab@proav.com</a>.</p>
            <button type="button" class="load-retry">Try again</button>
        </div>`;
    root.querySelector('.load-retry').addEventListener('click', () => {
        root.innerHTML = '<div class="load-state" role="status"><span class="load-spinner" aria-hidden="true"></span>Loading…</div>';
        retry();
    });
}

// ── Safe output ───────────────────────────────────────────────────────────
// Everything on a card comes from the admin form (or, for known issues, a
// public suggestion), so it is escaped before going into the page — a title
// with "<" or "&" in it then shows as typed instead of breaking the card.
function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Only web links become buttons; anything else (a typo, "javascript:…") is dropped.
function safeUrl(url) {
    const u = String(url || '').trim();
    return /^https?:\/\//i.test(u) ? escapeHtml(u) : '';
}

// ── Filter options from combined values ───────────────────────────────────
// Reports often name several categories ("Video, Conferencing") or
// manufacturers ("Crestron, Neat"). The dropdowns list each one on its own,
// and picking one matches every report that includes it — so "Video" finds
// "Video, Conferencing" too. Spellings that differ only in capitals (or, for
// manufacturers, are aliases like Q-SYS/QSC) are merged under the most used one.
function splitCategories(value) {
    return String(value || '').split(/\s*[,/]\s*/).map(s => s.trim()).filter(Boolean);
}

const categoryKey = s => s.toLowerCase().replace(/\s+/g, ' ');

function filterOptions(values, split, keyOf) {
    const byKey = new Map();   // key → Map(label → count)
    values.forEach(v => split(v).forEach(part => {
        const key = keyOf(part);
        if (!key) return;
        if (!byKey.has(key)) byKey.set(key, new Map());
        const labels = byKey.get(key);
        labels.set(part, (labels.get(part) || 0) + 1);
    }));
    return [...byKey.entries()].map(([key, labels]) => {
        // Most used spelling; on a tie prefer one starting with a capital.
        const label = [...labels.entries()].sort((a, b) =>
            b[1] - a[1] || (/^[A-Z]/.test(b[0]) - /^[A-Z]/.test(a[0])) || a[0].localeCompare(b[0]))[0][0];
        return { key, label };
    }).sort((a, b) => a.label.localeCompare(b.label, 'en-GB', { sensitivity: 'base' }));
}

function valueHasKey(value, key, split, keyOf) {
    return split(value).some(part => keyOf(part) === key);
}

// Categories are broader: "Video" also matches "Video Conferencing" and
// "Network Video" (the word on its own, so "Audio" doesn't match "Audiovisual").
function categoryMatches(value, key) {
    const word = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re   = new RegExp(`(^|[^a-z0-9])${word}($|[^a-z0-9])`, 'i');
    return splitCategories(value).some(part => re.test(part));
}

function fillSelect(select, options) {
    options.forEach(({ key, label }) => {
        const opt = document.createElement('option');
        opt.value = key; opt.textContent = label;
        select.appendChild(opt);
    });
}
