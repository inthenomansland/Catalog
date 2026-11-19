let allEntries = [];
let allGotchas = [];
let whatsOn    = [];
const TYPE_ORDER = ['Kit', 'Program', 'Concept'];

// ── Data loading ──────────────────────────────────────────────────────────
async function loadData() {
    // The page shows "Loading the catalogue…" (in index.html) until this
    // finishes; if the server can't be reached, say so instead of sitting blank.
    try {
        const [entriesRes, gotchasRes] = await Promise.all([
            fetch('/api/entries'),
            fetch('/api/gotchas')
        ]);
        if (!entriesRes.ok) throw new Error(`entries ${entriesRes.status}`);
        allEntries = await entriesRes.json();
        allGotchas = gotchasRes.ok ? await gotchasRes.json() : [];
    } catch (err) {
        console.error('Catalogue failed to load:', err);
        showLoadError('catalog-root', 'the catalogue', loadData);
        return;
    }
    allEntries.sort((a, b) => new Date(b.date) - new Date(a.date));
    populateFilters();
    render(allEntries, false);
    openReportFromLink();
    loadWhatsOn();
}

// Approved bench tests and PoCs, on now or coming up. Loaded after the
// catalogue so a slow or failed request never holds the reports back.
async function loadWhatsOn() {
    try {
        const res = await fetch('/api/whats-on');
        whatsOn = res.ok ? await res.json() : [];
    } catch {
        whatsOn = [];
    }
    if (whatsOn.length) applyFilters();
}

// ── Filters ───────────────────────────────────────────────────────────────
// See filterOptions in cards.js: "Video, Conferencing" counts as both Video
// and Conferencing, and "Crestron, Neat" as both Crestron and Neat.
const mfrKey = s => mfrSlug(s);

function populateFilters() {
    fillSelect(document.getElementById('filter-manufacturer'),
        filterOptions(allEntries.map(e => e.manufacturer), splitManufacturers, mfrKey));
    fillSelect(document.getElementById('filter-category'),
        filterOptions(allEntries.map(e => e.productCategory), splitCategories, categoryKey));
}

function getFilters() {
    return {
        search:       document.getElementById('search').value.toLowerCase().trim(),
        manufacturer: document.getElementById('filter-manufacturer').value,
        category:     document.getElementById('filter-category').value,
        type:         document.getElementById('filter-type').value
    };
}

function filterEntries(filters) {
    return allEntries.filter(entry => {
        if (filters.manufacturer && !valueHasKey(entry.manufacturer, filters.manufacturer, splitManufacturers, mfrKey)) return false;
        if (filters.category     && !categoryMatches(entry.productCategory, filters.category)) return false;
        if (filters.type         && entry.testType !== filters.type) return false;
        if (filters.search) {
            const haystack = [
                entry.title, entry.productName, entry.manufacturer,
                entry.productCategory, entry.summary, (entry.tags || []).join(' ')
            ].join(' ').toLowerCase();
            if (!haystack.includes(filters.search)) return false;
        }
        return true;
    });
}

// ── Helpers ───────────────────────────────────────────────────────────────
function badgeClass(type) {
    return { Kit: 'badge-kit', Program: 'badge-program', Concept: 'badge-concept' }[type] || '';
}

// ── Card ──────────────────────────────────────────────────────────────────
// Logo, date and recency helpers live in cards.js, shared with Product Updates.
// The summary is cut to a few lines here; clicking the card (or its title)
// opens the full report detail — see openReportDetail below.
function reportButtons(entry) {
    const front  = safeUrl(entry.frontPageDoc);
    const report = safeUrl(entry.fullReport);
    return (front  ? `<a href="${front}"  target="_blank" rel="noopener" class="btn btn-secondary">Front Page</a>`  : '') +
           (report ? `<a href="${report}" target="_blank" rel="noopener" class="btn btn-primary">Full Report</a>` : '');
}

function createCard(entry) {
    const card = document.createElement('div');
    card.className = `card card--${escapeHtml((entry.testType || 'kit').toLowerCase())} card--clickable`;
    card.dataset.trackTitle = entry.title || '';

    card.innerHTML = `
        <div class="card-topline">
            ${mfrLogo(entry.manufacturer)}
            <span class="badge ${badgeClass(entry.testType)}">${escapeHtml(entry.testType)}</span>
        </div>
        <button type="button" class="card-title card-title-btn">${escapeHtml(entry.title)}</button>
        <div class="card-meta">
            <span class="meta-item"><strong>Manufacturer</strong> ${escapeHtml(entry.manufacturer) || '—'}</span>
            <span class="meta-item"><strong>Product</strong> ${escapeHtml(entry.productName) || '—'}</span>
            <span class="meta-item"><strong>Category</strong> ${escapeHtml(entry.productCategory) || '—'}</span>
            <span class="meta-item"><strong>Date</strong> ${formatDate(entry.date)}</span>
        </div>
        <div class="card-summary">${escapeHtml(entry.summary)}</div>
        <span class="card-more" aria-hidden="true">More details →</span>
        <div class="card-actions">${reportButtons(entry)}</div>
    `;

    // Anywhere on the card opens the detail, except the report links themselves.
    card.addEventListener('click', e => {
        if (e.target.closest('a')) return;
        openReportDetail(entry.id);
    });
    return card;
}

// ── Report detail (and shareable link) ────────────────────────────────────
// The full summary, every detail and the report links in one view. Opening it
// puts #report=<id> in the address bar, so the link can be copied into Teams
// and opens straight onto this report.
function findEntry(id) { return allEntries.find(e => e.id === id); }

function openReportDetail(id, fromLink) {
    const entry = findEntry(id);
    if (!entry) return;
    closeReportDetail(true);

    const tags = (entry.tags || []).filter(Boolean);
    const overlay = document.createElement('div');
    overlay.id = 'report-detail-overlay';
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
        <div class="modal report-detail" role="dialog" aria-modal="true" aria-labelledby="report-detail-title" data-track-title="${escapeHtml(entry.title)}">
            <div class="modal-header">
                <div>
                    <h2 id="report-detail-title">${escapeHtml(entry.title)}</h2>
                    <p>${escapeHtml(entry.manufacturer) || '—'} · ${escapeHtml(entry.testType) || '—'}</p>
                </div>
                <button type="button" class="modal-close" aria-label="Close">&times;</button>
            </div>
            <div class="modal-body report-detail-body">
                <div class="card-topline">
                    ${mfrLogo(entry.manufacturer)}
                    <span class="badge ${badgeClass(entry.testType)}">${escapeHtml(entry.testType)}</span>
                </div>
                <dl class="report-detail-meta">
                    <div><dt>Manufacturer</dt><dd>${escapeHtml(entry.manufacturer) || '—'}</dd></div>
                    <div><dt>Product</dt><dd>${escapeHtml(entry.productName) || '—'}</dd></div>
                    <div><dt>Category</dt><dd>${escapeHtml(entry.productCategory) || '—'}</dd></div>
                    <div><dt>Test date</dt><dd>${formatDate(entry.date)}</dd></div>
                </dl>
                <div class="report-detail-summary">${escapeHtml(entry.summary) || 'No summary yet.'}</div>
                ${tags.length ? `<div class="card-tags">${tags.map(t => `<span class="tag">${escapeHtml(t)}</span>`).join('')}</div>` : ''}
            </div>
            <div class="report-detail-actions">
                <button type="button" class="btn btn-secondary report-copy-link">Copy link</button>
                <span class="card-actions">${reportButtons(entry)}</span>
            </div>
        </div>`;

    overlay.addEventListener('click', e => { if (e.target === overlay) closeReportDetail(); });
    overlay.querySelector('.modal-close').addEventListener('click', () => closeReportDetail());
    overlay.querySelector('.report-copy-link').addEventListener('click', e => copyReportLink(entry.id, e.currentTarget));
    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';
    overlay.querySelector('.modal-close').focus();

    const hash = `#report=${encodeURIComponent(entry.id)}`;
    if (location.hash !== hash) history.replaceState(null, '', hash);
    if (!fromLink && window.track) track('action', 'Report details', 'clicked');
}

// quiet: just remove it (when another is about to open), leaving the address alone.
function closeReportDetail(quiet) {
    const overlay = document.getElementById('report-detail-overlay');
    if (overlay) {
        overlay.remove();
        if (!document.querySelector('.modal-overlay:not(.hidden)')) document.body.style.overflow = '';
    }
    if (!quiet && location.hash.startsWith('#report=')) history.replaceState(null, '', location.pathname + location.search);
}

function reportLink(id) {
    return `${location.origin}${location.pathname}#report=${encodeURIComponent(id)}`;
}

async function copyReportLink(id, btn) {
    const link = reportLink(id);
    let ok = false;
    try { await navigator.clipboard.writeText(link); ok = true; } catch { /* clipboard blocked */ }
    if (!ok) {
        // Older browsers / blocked clipboard: show the link so it can be copied by hand.
        window.prompt('Copy this link:', link);
        return;
    }
    const original = btn.textContent;
    btn.textContent = 'Link copied';
    setTimeout(() => { btn.textContent = original; }, 1800);
}

// A shared link: #report=<id> opens that report once the catalogue has loaded.
function openReportFromLink() {
    const m = location.hash.match(/^#report=([^&]+)/);
    if (!m) { closeReportDetail(true); return; }   // link removed (e.g. Back) — close the view
    const id = decodeURIComponent(m[1]);
    if (findEntry(id)) openReportDetail(id, true);
    else closeReportDetail();   // removed or mistyped: close anything open and tidy the address
}

window.addEventListener('hashchange', openReportFromLink);
document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && document.getElementById('report-detail-overlay')) closeReportDetail();
});

// ── What's On section ─────────────────────────────────────────────────────
// Approved bench tests and PoCs that are on now or coming up, so colleagues
// know when there is something to come and see. Only the kit being tested,
// the type and dates are public (see /api/whats-on) — never the job name
// (which can name a client) or who booked it.
function buildWhatsOnSection(items) {
    const today = new Date().toLocaleDateString('en-CA');   // yyyy-mm-dd, local
    const day   = d => new Date(d + 'T00:00:00');
    const short = d => day(d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
    const section = document.createElement('section');
    section.className = 'whats-on-section';
    section.innerHTML = `
        <div class="whats-on-header">
            <h2 class="whats-on-title">What's On in the lab</h2>
            <p class="whats-on-sub">Approved bench tests and PoCs — come along and see what's being tested.</p>
        </div>
        <ul class="whats-on-list">
            ${items.map(i => {
                const end   = i.dateEnd || i.dateStart;
                const onNow = i.dateStart <= today && end >= today;
                const when  = end !== i.dateStart ? `${short(i.dateStart)} – ${short(end)}` : short(i.dateStart);
                const d     = day(i.dateStart);
                return `
                <li class="whats-on-item${onNow ? ' whats-on-item--now' : ''}">
                    <div class="whats-on-date" aria-hidden="true">
                        <span class="whats-on-day">${d.getDate()}</span>
                        <span class="whats-on-month">${d.toLocaleDateString('en-GB', { month: 'short' })}</span>
                    </div>
                    <div class="whats-on-info">
                        <div class="whats-on-name">
                            ${onNow ? '<span class="whats-on-now">On now</span>' : ''}
                            <span class="whats-on-type whats-on-type--${i.type === 'bench' ? 'bench' : 'poc'}">${i.type === 'bench' ? 'Bench Test' : 'PoC'}</span>
                            <strong>${i.kit ? escapeHtml(i.kit) : '<span class="whats-on-tbc">Kit to be confirmed</span>'}</strong>
                        </div>
                        <div class="whats-on-when">${when}</div>
                    </div>
                </li>`;
            }).join('')}
        </ul>`;
    return section;
}

// ── What's New section ────────────────────────────────────────────────────
function buildWhatsNewSection(entries) {
    const section = document.createElement('section');
    section.className = 'whats-new-section';

    const header = document.createElement('div');
    header.className = 'whats-new-header';
    header.innerHTML = `<h2 class="whats-new-title">What's New</h2>`;
    section.appendChild(header);

    const grid = document.createElement('div');
    grid.className = 'catalog-grid';
    entries.forEach(e => grid.appendChild(createCard(e)));
    section.appendChild(grid);

    return section;
}

// ── Gotchas section ───────────────────────────────────────────────────────
function buildGotchasSection(gotchas) {
    const isOpen = localStorage.getItem('gotchas-open') === 'true';
    const section = document.createElement('div');
    section.className = 'gotchas-section';
    section.innerHTML = `
        <div class="gotchas-toggle" onclick="toggleGotchas()">
            <div class="gotchas-toggle-left">
                <span class="gotchas-icon">&#9888;</span>
                <span class="gotchas-title">Known Issues</span>
                <span class="gotchas-count">${gotchas.length} item${gotchas.length !== 1 ? 's' : ''}</span>
            </div>
            <span class="gotchas-chevron" id="gotchas-chevron">${isOpen ? '▲' : '▼'}</span>
        </div>
        <div class="gotchas-list${isOpen ? '' : ' hidden'}" id="gotchas-list">
            ${gotchas.map(g => `
                <div class="gotcha-item">
                    <div class="gotcha-issue">${escapeHtml(g.issue)}</div>
                    <div class="gotcha-workaround"><strong>Workaround:</strong> ${escapeHtml(g.workaround)}</div>
                </div>
            `).join('')}
        </div>
    `;
    return section;
}

function toggleGotchas() {
    const list    = document.getElementById('gotchas-list');
    const chevron = document.getElementById('gotchas-chevron');
    const isNowOpen = list.classList.toggle('hidden') === false;
    chevron.textContent = isNowOpen ? '▲' : '▼';
    localStorage.setItem('gotchas-open', isNowOpen);
}

// ── Grouped catalog ───────────────────────────────────────────────────────
function buildGroupedSection(entries, filtersActive) {
    const wrapper = document.createElement('div');
    wrapper.className = 'catalog-grouped';

    const groups = {};
    TYPE_ORDER.forEach(t => { groups[t] = []; });

    entries.forEach(entry => {
        if (groups[entry.testType] !== undefined) {
            groups[entry.testType].push(entry);
        } else {
            if (!groups['Other']) groups['Other'] = [];
            groups['Other'].push(entry);
        }
    });

    const types = [...TYPE_ORDER, ...(groups['Other'] ? ['Other'] : [])];

    types.forEach(type => {
        const typeEntries = groups[type];
        if (!typeEntries || typeEntries.length === 0) return;

        typeEntries.sort((a, b) => a.title.localeCompare(b.title));

        const group = document.createElement('div');
        group.className = 'type-group';
        group.innerHTML = `
            <div class="group-header">
                <div class="group-header-left">
                    <span class="group-accent"></span>
                    <h2 class="group-title">${escapeHtml(type)}</h2>
                </div>
                <span class="group-count">${typeEntries.length} report${typeEntries.length !== 1 ? 's' : ''}</span>
            </div>
        `;

        const grid = document.createElement('div');
        grid.className = 'catalog-grid';
        typeEntries.forEach(e => grid.appendChild(createCard(e)));
        group.appendChild(grid);
        makeGroupCollapsible(group, 'reports', type, filtersActive);

        wrapper.appendChild(group);
    });

    return wrapper;
}

// ── Main render ───────────────────────────────────────────────────────────
function render(entries, filtersActive) {
    const root      = document.getElementById('catalog-root');
    const noResults = document.getElementById('no-results');
    const count     = document.getElementById('results-count');

    root.innerHTML = '';

    if (entries.length === 0) {
        noResults.classList.remove('hidden');
        count.textContent = '0 results';
        return;
    }

    noResults.classList.add('hidden');
    count.textContent = filtersActive ? `${entries.length} result${entries.length !== 1 ? 's' : ''}` : '';

    if (!filtersActive) {
        const recent = entries.filter(e => isRecent(e.date));
        if (allGotchas.length > 0) root.appendChild(buildGotchasSection(allGotchas));
        if (whatsOn.length > 0) root.appendChild(buildWhatsOnSection(whatsOn));
        if (recent.length > 0) root.appendChild(buildWhatsNewSection(recent));
    }

    root.appendChild(buildGroupedSection(entries, filtersActive));
}

function applyFilters() {
    const filters = getFilters();
    const active  = !!(filters.search || filters.manufacturer || filters.category || filters.type);
    render(filterEntries(filters), active);
}

// ── Event listeners ───────────────────────────────────────────────────────
document.getElementById('search').addEventListener('input', applyFilters);
document.getElementById('filter-manufacturer').addEventListener('change', applyFilters);
document.getElementById('filter-category').addEventListener('change', applyFilters);
document.getElementById('filter-type').addEventListener('change', applyFilters);

document.getElementById('clear-filters').addEventListener('click', () => {
    document.getElementById('search').value = '';
    document.getElementById('filter-manufacturer').value = '';
    document.getElementById('filter-category').value = '';
    document.getElementById('filter-type').value = '';
    render(allEntries, false);
});

loadData();

// ── Placeholder buttons ───────────────────────────────────────────────────
function comingSoon(btn) {
    const original = btn.textContent;
    btn.textContent = 'Coming soon';
    btn.disabled = true;
    btn.style.opacity = '0.6';
    setTimeout(() => {
        btn.textContent = original;
        btn.disabled = false;
        btn.style.opacity = '';
    }, 2000);
}

// ── Submit Report Modal ───────────────────────────────────────────────────
// TODO (Docker migration): Replace mailto approach with a proper file upload
// backend. The form should POST to an API endpoint that:
//   - Accepts the report metadata + attached document(s)
//   - Stores files to SharePoint / company storage
//   - Creates a draft entry in data.json pending admin review/approval
//   - Sends a notification email to poc.lab@proav.com
// For now, mailto opens Outlook and the user attaches documents manually.

function openSubmitModal() {
    document.getElementById('submit-modal-overlay').classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    document.getElementById('report-title').focus();
    document.getElementById('report-date').value = new Date().toISOString().split('T')[0];
}

function closeSubmitModal(event) {
    if (event && event.target !== document.getElementById('submit-modal-overlay')) return;
    document.getElementById('submit-modal-overlay').classList.add('hidden');
    document.body.style.overflow = '';
    document.getElementById('submit-form').reset();
}

function submitReport(event) {
    event.preventDefault();

    const title     = document.getElementById('report-title').value.trim();
    const mfr       = document.getElementById('report-manufacturer').value.trim();
    const product   = document.getElementById('report-product').value.trim();
    const category  = document.getElementById('report-category').value.trim();
    const type      = document.getElementById('report-type').value;
    const date      = document.getElementById('report-date').value;
    const summary   = document.getElementById('report-summary').value.trim();
    const submitter = document.getElementById('report-submitter').value.trim();

    const subject = title ? `Report Submission: ${title}` : 'New Report Submission';

    const body = [
        'REPORT SUBMISSION',
        '=================',
        '',
        `Report Title:     ${title     || 'Not provided'}`,
        `Manufacturer:     ${mfr       || 'Not provided'}`,
        `Product Name:     ${product   || 'Not provided'}`,
        `Category:         ${category  || 'Not provided'}`,
        `Test Type:        ${type      || 'Not provided'}`,
        `Date of Test:     ${date      || 'Not provided'}`,
        `Submitted By:     ${submitter || 'Not provided'}`,
        '',
        'SUMMARY',
        '-------',
        summary || 'Not provided',
        '',
        '---',
        '⚠ IMPORTANT: Please attach your report document(s) to this email before sending.',
        '',
        'Submitted via proAV PoC Lab Catalogue',
    ].join('\n');

    if (window.track) track('action', 'Submit Report', 'sent');
    window.location.href = `mailto:poc.lab@proav.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

    document.getElementById('submit-modal-overlay').classList.add('hidden');
    document.body.style.overflow = '';
    document.getElementById('submit-form').reset();
}

// Prefers the server's own explanation ("Not a valid email address: ...") over
// a generic failure, so a rejected address tells the user which one.
async function serverError(res, fallback) {
    try {
        const body = await res.json();
        return body && body.error ? body.error : fallback;
    } catch {
        return fallback;
    }
}

// ── Multi-address email fields ────────────────────────────────────────────
// The request forms take a list so an approval — and later the published
// report — reaches everyone who needs it. `multiple` only recognises commas,
// but Outlook and Teams hand out address lists separated by semicolons, so
// swap those as they are typed or pasted rather than failing validation on
// something the user has every reason to think is a valid list.
['bench-submitter-email', 'poc-submitter-email'].forEach(id => {
    const field = document.getElementById(id);
    if (!field) return;
    field.addEventListener('input', () => {
        if (!field.value.includes(';')) return;
        const caret = field.selectionStart;
        field.value = field.value.replace(/;/g, ',');
        field.setSelectionRange(caret, caret);
    });
});

// ── Date pickers ──────────────────────────────────────────────────────────
// The end-date calendar starts from the chosen start date, so an end date
// before the start can't be picked by accident (typing one is still caught
// on submit by requestFormProblem).
['bench', 'poc'].forEach(prefix => {
    const start = document.getElementById(`${prefix}-date-start`);
    const end   = document.getElementById(`${prefix}-date-end`);
    if (!start || !end) return;
    const sync = () => { end.min = start.value || ''; };
    start.addEventListener('input', sync);
    start.addEventListener('change', sync);
});

// ── Terms & conditions ────────────────────────────────────────────────────
// Bump data-version on the terms content in index.html whenever the wording
// changes — every request (and visitor sign-in, which reads the same markup)
// stores the version its submitter agreed to, so an acceptance on file always
// points at the text that was actually on screen at the time.
const TERMS_VERSION = document.querySelector('.terms-content').dataset.version;

document.addEventListener('DOMContentLoaded', () => {
    const label = document.getElementById('terms-version-label');
    if (label) label.textContent = TERMS_VERSION;
});

// Opens over the request modal rather than replacing it, so a half-completed
// form is still there when the reader closes the terms again.
function openTermsModal() {
    document.getElementById('terms-modal-overlay').classList.remove('hidden');
    document.body.style.overflow = 'hidden';
}

function closeTermsModal(event) {
    if (event && event.target !== document.getElementById('terms-modal-overlay')) return;
    document.getElementById('terms-modal-overlay').classList.add('hidden');
    // A request modal is usually still open underneath — only release the page
    // scroll once nothing is left on top of it.
    if (!document.querySelector('.modal-overlay:not(.hidden)')) document.body.style.overflow = '';
}

// ── Request Bench Test Modal ──────────────────────────────────────────────
function openBenchModal() {
    document.getElementById('bench-modal-overlay').classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    document.getElementById('bench-date-start').value = new Date().toISOString().split('T')[0];
    document.getElementById('bench-job-name').focus();
}

function closeBenchModal(event) {
    if (event && event.target !== document.getElementById('bench-modal-overlay')) return;
    document.getElementById('bench-modal-overlay').classList.add('hidden');
    document.body.style.overflow = '';
    document.getElementById('bench-form').reset();
    const msg = document.getElementById('bench-msg');
    msg.style.display = 'none'; msg.textContent = '';
}

async function submitBenchRequest(event) {
    event.preventDefault();

    const submitterName  = document.getElementById('bench-submitter-name').value.trim();
    const submitterEmail = document.getElementById('bench-submitter-email').value.trim();
    const jobName        = document.getElementById('bench-job-name').value.trim();
    const scope          = document.getElementById('bench-scope').value.trim();
    const outcomes       = document.getElementById('bench-outcomes').value.trim();
    const kit            = document.getElementById('bench-kit').value.trim();
    const dateStart      = document.getElementById('bench-date-start').value;
    const dateEnd        = document.getElementById('bench-date-end').value;
    const persons        = document.getElementById('bench-persons').value.trim();
    const termsAccepted  = document.getElementById('bench-terms').checked;
    const subscribe      = document.getElementById('bench-subscribe').checked;
    const msg            = document.getElementById('bench-msg');

    const problem = requestFormProblem('bench', { submitterName, jobName, dateStart, dateEnd, termsAccepted });
    if (problem) {
        msg.style.cssText = 'display:block;padding:0.75rem 1rem;border-radius:7px;font-size:0.875rem;background:#fee2e2;color:#991b1b;border:1px solid #fca5a5;';
        msg.textContent   = problem.text;
        flagField(problem.field);
        return;
    }

    msg.style.cssText = 'display:block;padding:0.75rem 1rem;border-radius:7px;font-size:0.875rem;background:#ede9fe;color:#5b21b6;border:1px solid #c4b5fd;';
    msg.textContent   = 'Submitting...';
    const submitBtn   = event.target.querySelector('[type="submit"]');
    submitBtn.disabled = true;

    try {
        const res = await fetch('/api/requests', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ type: 'bench', submitterName, submitterEmail, jobName, scope, outcomes, kit, dateStart, dateEnd, persons, termsAccepted, termsVersion: TERMS_VERSION, subscribe, _hp: document.getElementById('hp-bench').value }),
        });

        if (res.ok) {
            if (window.track) track('action', 'Bench Test', 'sent');
            msg.style.cssText = 'display:block;padding:0.75rem 1rem;border-radius:7px;font-size:0.875rem;background:#d1fae5;color:#065f46;border:1px solid #6ee7b7;';
            msg.textContent   = 'Request submitted! The team will be in touch to confirm your dates.';
            if (subscribe && submitterEmail) setNotifyPromptState('subscribed');
            setTimeout(() => {
                document.getElementById('bench-modal-overlay').classList.add('hidden');
                document.body.style.overflow = '';
                document.getElementById('bench-form').reset();
                msg.style.display = 'none';
                submitBtn.disabled = false;
            }, 2500);
        } else {
            msg.style.cssText = 'display:block;padding:0.75rem 1rem;border-radius:7px;font-size:0.875rem;background:#fee2e2;color:#991b1b;border:1px solid #fca5a5;';
            msg.textContent   = await serverError(res, 'Failed to submit — please try again.');
            submitBtn.disabled = false;
        }
    } catch {
        msg.style.cssText = 'display:block;padding:0.75rem 1rem;border-radius:7px;font-size:0.875rem;background:#fee2e2;color:#991b1b;border:1px solid #fca5a5;';
        msg.textContent   = 'Network error. Please try again.';
        submitBtn.disabled = false;
    }
}

// Checks shared by the Bench Test and PoC forms. Returns the first problem and
// the field to send the user to, so the message says exactly what to fix.
function requestFormProblem(prefix, v) {
    if (!v.submitterName) return { field: `${prefix}-submitter-name`, text: 'Please enter your name.' };
    if (!v.jobName)       return { field: `${prefix}-job-name`,       text: 'Please give the job a name.' };
    if (v.dateStart && v.dateEnd && v.dateEnd < v.dateStart)
        return { field: `${prefix}-date-end`, text: 'The end date is before the start date — please check your dates.' };
    if (!v.termsAccepted) return { field: `${prefix}-terms`, text: 'Please read and accept the terms and conditions before submitting.' };
    return null;
}

// Outlines the field in red and moves the cursor to it; the outline clears as
// soon as the user changes it.
function flagField(id) {
    const field = document.getElementById(id);
    if (!field) return;
    field.classList.add('field-error');
    field.addEventListener(field.type === 'checkbox' ? 'change' : 'input',
        () => field.classList.remove('field-error'), { once: true });
    field.focus();
}

// ── Request a PoC Modal ───────────────────────────────────────────────────
function openPoCModal() {
    document.getElementById('poc-modal-overlay').classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    document.getElementById('poc-date-start').value = new Date().toISOString().split('T')[0];
    document.getElementById('poc-job-name').focus();
}

function closePoCModal(event) {
    if (event && event.target !== document.getElementById('poc-modal-overlay')) return;
    document.getElementById('poc-modal-overlay').classList.add('hidden');
    document.body.style.overflow = '';
    document.getElementById('poc-form').reset();
    const msg = document.getElementById('poc-msg');
    msg.style.display = 'none'; msg.textContent = '';
}

async function submitPoCRequest(event) {
    event.preventDefault();

    const submitterName  = document.getElementById('poc-submitter-name').value.trim();
    const submitterEmail = document.getElementById('poc-submitter-email').value.trim();
    const jobName        = document.getElementById('poc-job-name').value.trim();
    const scope          = document.getElementById('poc-scope').value.trim();
    const outcomes       = document.getElementById('poc-outcomes').value.trim();
    const kit            = document.getElementById('poc-kit').value.trim();
    const dateStart      = document.getElementById('poc-date-start').value;
    const dateEnd        = document.getElementById('poc-date-end').value;
    const persons        = document.getElementById('poc-persons').value.trim();
    const termsAccepted  = document.getElementById('poc-terms').checked;
    const subscribe      = document.getElementById('poc-subscribe').checked;
    const msg            = document.getElementById('poc-msg');

    const problem = requestFormProblem('poc', { submitterName, jobName, dateStart, dateEnd, termsAccepted });
    if (problem) {
        msg.style.cssText = 'display:block;padding:0.75rem 1rem;border-radius:7px;font-size:0.875rem;background:#fee2e2;color:#991b1b;border:1px solid #fca5a5;';
        msg.textContent   = problem.text;
        flagField(problem.field);
        return;
    }

    msg.style.cssText = 'display:block;padding:0.75rem 1rem;border-radius:7px;font-size:0.875rem;background:#ede9fe;color:#5b21b6;border:1px solid #c4b5fd;';
    msg.textContent   = 'Submitting...';
    const submitBtn   = event.target.querySelector('[type="submit"]');
    submitBtn.disabled = true;

    try {
        const res = await fetch('/api/requests', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ type: 'poc', submitterName, submitterEmail, jobName, scope, outcomes, kit, dateStart, dateEnd, persons, termsAccepted, termsVersion: TERMS_VERSION, subscribe, _hp: document.getElementById('hp-poc').value }),
        });

        if (res.ok) {
            if (window.track) track('action', 'Request a PoC', 'sent');
            msg.style.cssText = 'display:block;padding:0.75rem 1rem;border-radius:7px;font-size:0.875rem;background:#d1fae5;color:#065f46;border:1px solid #6ee7b7;';
            msg.textContent   = 'Request submitted! The team will be in touch to confirm your dates.';
            if (subscribe && submitterEmail) setNotifyPromptState('subscribed');
            setTimeout(() => {
                document.getElementById('poc-modal-overlay').classList.add('hidden');
                document.body.style.overflow = '';
                document.getElementById('poc-form').reset();
                msg.style.display = 'none';
                submitBtn.disabled = false;
            }, 2500);
        } else {
            msg.style.cssText = 'display:block;padding:0.75rem 1rem;border-radius:7px;font-size:0.875rem;background:#fee2e2;color:#991b1b;border:1px solid #fca5a5;';
            msg.textContent   = await serverError(res, 'Failed to submit — please try again.');
            submitBtn.disabled = false;
        }
    } catch {
        msg.style.cssText = 'display:block;padding:0.75rem 1rem;border-radius:7px;font-size:0.875rem;background:#fee2e2;color:#991b1b;border:1px solid #fca5a5;';
        msg.textContent   = 'Network error. Please try again.';
        submitBtn.disabled = false;
    }
}

// ── Unsubscribe handler ───────────────────────────────────────────────────
// The link in notification emails lands here. Loading the page only *offers* to
// unsubscribe — the removal itself needs a deliberate click. Mail scanners,
// Outlook/Teams link previews and browser prefetch all fetch these URLs on
// their own, and used to silently remove people who never clicked anything.
let pendingUnsubscribeToken = null;

function showUnsubscribeBanner(kind, text) {
    const banner = document.createElement('div');
    banner.style.cssText = 'position:fixed;top:1rem;left:50%;transform:translateX(-50%);padding:0.75rem 1.5rem;border-radius:8px;font-size:0.9rem;font-weight:500;z-index:9999;box-shadow:0 2px 8px rgba(0,0,0,0.15);';
    banner.style.background = kind === 'ok' ? '#d1fae5' : '#fee2e2';
    banner.style.color      = kind === 'ok' ? '#065f46' : '#991b1b';
    banner.textContent      = text;
    document.body.appendChild(banner);
    setTimeout(() => banner.remove(), 5000);
}

function closeUnsubscribeModal(event) {
    if (event && event.target !== document.getElementById('unsubscribe-modal-overlay')) return;
    document.getElementById('unsubscribe-modal-overlay').classList.add('hidden');
    document.body.style.overflow = '';
    pendingUnsubscribeToken = null;
}

async function confirmUnsubscribe() {
    if (!pendingUnsubscribeToken) return;
    const btn = document.getElementById('unsubscribe-confirm-btn');
    const msg = document.getElementById('unsubscribe-msg');
    btn.disabled = true;

    try {
        const res = await fetch('/api/unsubscribe', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ token: pendingUnsubscribeToken }),
        });

        if (res.ok) {
            pendingUnsubscribeToken = null;
            msg.style.cssText = 'display:block;padding:0.75rem 1rem;border-radius:7px;font-size:0.875rem;margin-bottom:1rem;background:#d1fae5;color:#065f46;border:1px solid #6ee7b7;';
            msg.textContent   = "You've been unsubscribed. You won't receive any further notification emails.";
            setTimeout(() => {
                document.getElementById('unsubscribe-modal-overlay').classList.add('hidden');
                document.body.style.overflow = '';
                msg.style.display = 'none';
                btn.disabled = false;
            }, 3000);
        } else {
            msg.style.cssText = 'display:block;padding:0.75rem 1rem;border-radius:7px;font-size:0.875rem;margin-bottom:1rem;background:#fee2e2;color:#991b1b;border:1px solid #fca5a5;';
            msg.textContent   = 'Could not unsubscribe — please try again.';
            btn.disabled = false;
        }
    } catch {
        msg.style.cssText = 'display:block;padding:0.75rem 1rem;border-radius:7px;font-size:0.875rem;margin-bottom:1rem;background:#fee2e2;color:#991b1b;border:1px solid #fca5a5;';
        msg.textContent   = 'Network error. Please try again.';
        btn.disabled = false;
    }
}

(async function checkUnsubscribe() {
    const token = new URLSearchParams(window.location.search).get('unsubscribe');
    if (!token) return;
    window.history.replaceState({}, '', window.location.pathname);

    try {
        const res = await fetch(`/api/unsubscribe/check?token=${encodeURIComponent(token)}`);
        if (!res.ok) {
            showUnsubscribeBanner('error', 'Unsubscribe link not recognised — you may already be unsubscribed.');
            return;
        }
        const info = await res.json();
        if (info.unsubscribed) {
            showUnsubscribeBanner('ok', `${info.email} is already unsubscribed.`);
            return;
        }
        pendingUnsubscribeToken = token;
        document.getElementById('unsubscribe-email').textContent = info.email;
        document.getElementById('unsubscribe-modal-overlay').classList.remove('hidden');
        document.body.style.overflow = 'hidden';
    } catch {
        showUnsubscribeBanner('error', 'Network error — please try again.');
    }
})();

// ── Get Notified Modal ────────────────────────────────────────────────────
function openSubscribeModal() {
    document.getElementById('subscribe-modal-overlay').classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    document.getElementById('subscribe-email').focus();
}

function closeSubscribeModal(event) {
    if (event && event.target !== document.getElementById('subscribe-modal-overlay')) return;
    document.getElementById('subscribe-modal-overlay').classList.add('hidden');
    document.body.style.overflow = '';
    document.getElementById('subscribe-form').reset();
    const msg = document.getElementById('subscribe-msg');
    msg.style.display = 'none';
    msg.textContent   = '';
}

async function submitSubscription(event) {
    event.preventDefault();
    const email     = document.getElementById('subscribe-email').value.trim();
    const frequency = document.getElementById('subscribe-frequency').value;
    const msg       = document.getElementById('subscribe-msg');

    if (!email) {
        msg.style.cssText = 'display:block;padding:0.75rem 1rem;border-radius:7px;font-size:0.875rem;background:#fee2e2;color:#991b1b;border:1px solid #fca5a5;';
        msg.textContent   = 'Please enter your email address.';
        return;
    }

    msg.style.cssText = 'display:block;padding:0.75rem 1rem;border-radius:7px;font-size:0.875rem;background:#ede9fe;color:#5b21b6;border:1px solid #c4b5fd;';
    msg.textContent   = 'Saving...';

    try {
        const res = await fetch('/api/subscribe', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ email, frequency, _hp: document.getElementById('hp-subscribe').value }),
        });

        if (res.ok) {
            if (window.track) track('action', 'Get Notified', 'sent');
            const labels = { instant: "everything new as it's published", weekly: 'weekly digest', monthly: 'monthly digest' };
            msg.style.cssText = 'display:block;padding:0.75rem 1rem;border-radius:7px;font-size:0.875rem;background:#d1fae5;color:#065f46;border:1px solid #6ee7b7;';
            msg.textContent   = `Subscribed! You'll receive notifications for ${labels[frequency]}.`;
            setNotifyPromptState('subscribed');
            setTimeout(() => {
                document.getElementById('subscribe-modal-overlay').classList.add('hidden');
                document.body.style.overflow = '';
                document.getElementById('subscribe-form').reset();
                msg.style.display = 'none';
            }, 2500);
        } else {
            msg.style.cssText = 'display:block;padding:0.75rem 1rem;border-radius:7px;font-size:0.875rem;background:#fee2e2;color:#991b1b;border:1px solid #fca5a5;';
            msg.textContent   = 'Failed to subscribe — please try again.';
        }
    } catch {
        msg.style.cssText = 'display:block;padding:0.75rem 1rem;border-radius:7px;font-size:0.875rem;background:#fee2e2;color:#991b1b;border:1px solid #fca5a5;';
        msg.textContent   = 'Network error. Please try again.';
    }
}

// ── First-visit "Get notified" prompt ─────────────────────────────────────
// Shown once per browser, a few seconds after the page loads. Never again once
// they subscribe; after "No thanks" it stays away for NOTIFY_PROMPT_SNOOZE_DAYS.
// localStorage can be blocked or cleared — at worst they see the prompt again.
const NOTIFY_PROMPT_KEY          = 'notify-prompt';
const NOTIFY_PROMPT_SNOOZE_DAYS  = 90;
const NOTIFY_PROMPT_DELAY_MS     = 4000;

function setNotifyPromptState(state) {
    try { localStorage.setItem(NOTIFY_PROMPT_KEY, JSON.stringify({ state, at: Date.now() })); } catch {}
    document.getElementById('notify-prompt').classList.add('hidden');
}

function dismissNotifyPrompt() { setNotifyPromptState('dismissed'); }

function acceptNotifyPrompt() {
    // Snoozed rather than marked subscribed — if they cancel the modal, they
    // made a choice and shouldn't be asked again tomorrow.
    setNotifyPromptState('dismissed');
    openSubscribeModal();
}

(function initNotifyPrompt() {
    // Someone arriving from an unsubscribe link is the last person to ask.
    if (new URLSearchParams(window.location.search).has('unsubscribe')) return;
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(NOTIFY_PROMPT_KEY)); } catch {}
    if (saved && saved.state === 'subscribed') return;
    if (saved && Date.now() - saved.at < NOTIFY_PROMPT_SNOOZE_DAYS * 86400000) return;

    setTimeout(() => {
        // Don't pop up over a form they're already filling in.
        if (document.querySelector('.modal-overlay:not(.hidden)')) return;
        document.getElementById('notify-prompt').classList.remove('hidden');
    }, NOTIFY_PROMPT_DELAY_MS);
})();

// ── Report a Gotcha Modal ─────────────────────────────────────────────────
function openGotchaModal() {
    document.getElementById('gotcha-modal-overlay').classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    document.getElementById('gotcha-issue-input').focus();
}

function closeGotchaModal(event) {
    if (event && event.target !== document.getElementById('gotcha-modal-overlay')) return;
    document.getElementById('gotcha-modal-overlay').classList.add('hidden');
    document.body.style.overflow = '';
    document.getElementById('gotcha-report-form').reset();
    const msg = document.getElementById('gotcha-report-msg');
    msg.textContent = '';
    msg.style.color = '';
}

async function submitGotchaReport(event) {
    event.preventDefault();
    const submittedBy = document.getElementById('gotcha-submitter-input').value.trim();
    const issue       = document.getElementById('gotcha-issue-input').value.trim();
    const workaround  = document.getElementById('gotcha-workaround-input').value.trim();
    const msg         = document.getElementById('gotcha-report-msg');

    if (!submittedBy || !issue || !workaround) {
        msg.style.color = '#991b1b';
        msg.textContent = 'Please fill in all fields.';
        return;
    }

    msg.style.color = '#5b21b6';
    msg.textContent = 'Submitting...';

    try {
        const res = await fetch('/api/gotchas/suggest', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ submittedBy, issue, workaround, _hp: document.getElementById('hp-gotcha').value })
        });

        if (res.ok) {
            if (window.track) track('action', 'Known Issue', 'sent');
            msg.style.color = '#065f46';
            msg.textContent = 'Thanks! Your issue has been submitted for review.';
            document.getElementById('gotcha-submitter-input').value  = '';
            document.getElementById('gotcha-issue-input').value      = '';
            document.getElementById('gotcha-workaround-input').value = '';
            setTimeout(() => {
                document.getElementById('gotcha-modal-overlay').classList.add('hidden');
                document.body.style.overflow = '';
                msg.textContent = '';
                msg.style.color = '';
            }, 2200);
        } else {
            msg.style.color = '#991b1b';
            msg.textContent = 'Failed to submit — please try again.';
        }
    } catch {
        msg.style.color = '#991b1b';
        msg.textContent = 'Network error. Please try again.';
    }
}

// ── Opening a form from another page ──────────────────────────────────────
// The Product Updates page shares the menu but not these modals, so its form
// items link here as /?open=<form> and land with that form already open.
(function openFormFromLink() {
    const openers = { notify: openSubscribeModal, report: openSubmitModal, bench: openBenchModal, poc: openPoCModal, issue: openGotchaModal };
    const which   = new URLSearchParams(window.location.search).get('open');
    if (!openers[which]) return;
    window.history.replaceState({}, '', window.location.pathname);
    openers[which]();
})();

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        // The terms sit on top of a request form — the first Escape should
        // dismiss the reading pane, not discard what has been typed behind it.
        const terms = document.getElementById('terms-modal-overlay');
        if (terms && !terms.classList.contains('hidden')) {
            closeTermsModal();
            return;
        }
        document.getElementById('submit-modal-overlay').classList.add('hidden');
        document.getElementById('bench-modal-overlay').classList.add('hidden');
        document.getElementById('poc-modal-overlay').classList.add('hidden');
        document.getElementById('gotcha-modal-overlay').classList.add('hidden');
        document.getElementById('subscribe-modal-overlay').classList.add('hidden');
        closeNavDrawer();
        document.body.style.overflow = '';
    }
});
