let allEntries = [];
let allGotchas = [];
const TYPE_ORDER = ['Kit', 'Program', 'Concept'];

// ── Data loading ──────────────────────────────────────────────────────────
async function loadData() {
    const [entriesRes, gotchasRes] = await Promise.all([
        fetch('/api/entries'),
        fetch('/api/gotchas')
    ]);
    allEntries = await entriesRes.json();
    allGotchas = await gotchasRes.json();
    allEntries.sort((a, b) => new Date(b.date) - new Date(a.date));
    populateFilters();
    render(allEntries, false);
}

// ── Filters ───────────────────────────────────────────────────────────────
function populateFilters() {
    const manufacturers = [...new Set(allEntries.map(e => e.manufacturer).filter(Boolean))].sort();
    const categories    = [...new Set(allEntries.map(e => e.productCategory).filter(Boolean))].sort();

    const mfgSelect = document.getElementById('filter-manufacturer');
    manufacturers.forEach(m => {
        const opt = document.createElement('option');
        opt.value = m; opt.textContent = m;
        mfgSelect.appendChild(opt);
    });

    const catSelect = document.getElementById('filter-category');
    categories.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c; opt.textContent = c;
        catSelect.appendChild(opt);
    });
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
        if (filters.manufacturer && entry.manufacturer !== filters.manufacturer) return false;
        if (filters.category     && entry.productCategory !== filters.category)  return false;
        if (filters.type         && entry.testType !== filters.type)              return false;
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
function isRecent(dateStr) {
    if (!dateStr) return false;
    return (new Date() - new Date(dateStr)) / (1000 * 60 * 60 * 24) <= 28;
}

function badgeClass(type) {
    return { Kit: 'badge-kit', Program: 'badge-program', Concept: 'badge-concept' }[type] || '';
}

function formatDate(dateStr) {
    if (!dateStr) return '—';
    return new Date(dateStr).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

// ── Card ──────────────────────────────────────────────────────────────────
function createCard(entry) {
    const card = document.createElement('div');
    card.className = 'card';

    const frontBtn  = entry.frontPageDoc
        ? `<a href="${entry.frontPageDoc}" target="_blank" rel="noopener" class="btn btn-secondary">Front Page</a>` : '';
    const reportBtn = entry.fullReport
        ? `<a href="${entry.fullReport}"   target="_blank" rel="noopener" class="btn btn-primary">Full Report</a>`  : '';

    card.innerHTML = `
        <div class="card-header">
            <div class="card-title">${entry.title}</div>
            <span class="badge ${badgeClass(entry.testType)}">${entry.testType}</span>
        </div>
        <div class="card-meta">
            <span class="meta-item"><strong>Manufacturer</strong> ${entry.manufacturer || '—'}</span>
            <span class="meta-item"><strong>Product</strong> ${entry.productName || '—'}</span>
            <span class="meta-item"><strong>Category</strong> ${entry.productCategory || '—'}</span>
            <span class="meta-item"><strong>Date</strong> ${formatDate(entry.date)}</span>
        </div>
        <div class="card-summary">${entry.summary || ''}</div>
        <div class="card-actions">${frontBtn}${reportBtn}</div>
    `;
    return card;
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
                    <div class="gotcha-issue">${g.issue}</div>
                    <div class="gotcha-workaround"><strong>Workaround:</strong> ${g.workaround}</div>
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
function buildGroupedSection(entries) {
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
                    <h2 class="group-title">${type}</h2>
                </div>
                <span class="group-count">${typeEntries.length} report${typeEntries.length !== 1 ? 's' : ''}</span>
            </div>
        `;

        const grid = document.createElement('div');
        grid.className = 'catalog-grid';
        typeEntries.forEach(e => grid.appendChild(createCard(e)));
        group.appendChild(grid);

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
        if (recent.length > 0) root.appendChild(buildWhatsNewSection(recent));
    }

    root.appendChild(buildGroupedSection(entries));
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

    window.location.href = `mailto:poc.lab@proav.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

    document.getElementById('submit-modal-overlay').classList.add('hidden');
    document.body.style.overflow = '';
    document.getElementById('submit-form').reset();
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
    const msg            = document.getElementById('bench-msg');

    if (!submitterName || !jobName) {
        msg.style.cssText = 'display:block;padding:0.75rem 1rem;border-radius:7px;font-size:0.875rem;background:#fee2e2;color:#991b1b;border:1px solid #fca5a5;';
        msg.textContent   = 'Please fill in your name and a job name.';
        return;
    }

    msg.style.cssText = 'display:block;padding:0.75rem 1rem;border-radius:7px;font-size:0.875rem;background:#ede9fe;color:#5b21b6;border:1px solid #c4b5fd;';
    msg.textContent   = 'Submitting...';

    try {
        const res = await fetch('/api/requests', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ type: 'bench', submitterName, submitterEmail, jobName, scope, outcomes, kit, dateStart, dateEnd, persons, _hp: document.getElementById('hp-bench').value }),
        });

        if (res.ok) {
            msg.style.cssText = 'display:block;padding:0.75rem 1rem;border-radius:7px;font-size:0.875rem;background:#d1fae5;color:#065f46;border:1px solid #6ee7b7;';
            msg.textContent   = 'Request submitted! The team will be in touch to confirm your dates.';
            setTimeout(() => {
                document.getElementById('bench-modal-overlay').classList.add('hidden');
                document.body.style.overflow = '';
                document.getElementById('bench-form').reset();
                msg.style.display = 'none';
            }, 2500);
        } else {
            msg.style.cssText = 'display:block;padding:0.75rem 1rem;border-radius:7px;font-size:0.875rem;background:#fee2e2;color:#991b1b;border:1px solid #fca5a5;';
            msg.textContent   = 'Failed to submit — please try again.';
        }
    } catch {
        msg.style.cssText = 'display:block;padding:0.75rem 1rem;border-radius:7px;font-size:0.875rem;background:#fee2e2;color:#991b1b;border:1px solid #fca5a5;';
        msg.textContent   = 'Network error. Please try again.';
    }
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
    const msg            = document.getElementById('poc-msg');

    if (!submitterName || !jobName) {
        msg.style.cssText = 'display:block;padding:0.75rem 1rem;border-radius:7px;font-size:0.875rem;background:#fee2e2;color:#991b1b;border:1px solid #fca5a5;';
        msg.textContent   = 'Please fill in your name and a job name.';
        return;
    }

    msg.style.cssText = 'display:block;padding:0.75rem 1rem;border-radius:7px;font-size:0.875rem;background:#ede9fe;color:#5b21b6;border:1px solid #c4b5fd;';
    msg.textContent   = 'Submitting...';

    try {
        const res = await fetch('/api/requests', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ type: 'poc', submitterName, submitterEmail, jobName, scope, outcomes, kit, dateStart, dateEnd, persons, _hp: document.getElementById('hp-poc').value }),
        });

        if (res.ok) {
            msg.style.cssText = 'display:block;padding:0.75rem 1rem;border-radius:7px;font-size:0.875rem;background:#d1fae5;color:#065f46;border:1px solid #6ee7b7;';
            msg.textContent   = 'Request submitted! The team will be in touch to confirm your dates.';
            setTimeout(() => {
                document.getElementById('poc-modal-overlay').classList.add('hidden');
                document.body.style.overflow = '';
                document.getElementById('poc-form').reset();
                msg.style.display = 'none';
            }, 2500);
        } else {
            msg.style.cssText = 'display:block;padding:0.75rem 1rem;border-radius:7px;font-size:0.875rem;background:#fee2e2;color:#991b1b;border:1px solid #fca5a5;';
            msg.textContent   = 'Failed to submit — please try again.';
        }
    } catch {
        msg.style.cssText = 'display:block;padding:0.75rem 1rem;border-radius:7px;font-size:0.875rem;background:#fee2e2;color:#991b1b;border:1px solid #fca5a5;';
        msg.textContent   = 'Network error. Please try again.';
    }
}

// ── Unsubscribe handler ───────────────────────────────────────────────────
(async function checkUnsubscribe() {
    const token = new URLSearchParams(window.location.search).get('unsubscribe');
    if (!token) return;
    const banner = document.createElement('div');
    banner.style.cssText = 'position:fixed;top:1rem;left:50%;transform:translateX(-50%);padding:0.75rem 1.5rem;border-radius:8px;font-size:0.9rem;font-weight:500;z-index:9999;box-shadow:0 2px 8px rgba(0,0,0,0.15);';
    try {
        const res = await fetch(`/api/unsubscribe?token=${encodeURIComponent(token)}`);
        if (res.ok) {
            banner.style.background = '#d1fae5';
            banner.style.color      = '#065f46';
            banner.textContent      = 'You have been unsubscribed successfully.';
        } else {
            banner.style.background = '#fee2e2';
            banner.style.color      = '#991b1b';
            banner.textContent      = 'Unsubscribe link not found — you may already be unsubscribed.';
        }
    } catch {
        banner.style.background = '#fee2e2';
        banner.style.color      = '#991b1b';
        banner.textContent      = 'Network error — please try again.';
    }
    document.body.appendChild(banner);
    setTimeout(() => banner.remove(), 5000);
    window.history.replaceState({}, '', window.location.pathname);
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
            const labels = { instant: 'every new report', weekly: 'weekly digest', monthly: 'monthly digest' };
            msg.style.cssText = 'display:block;padding:0.75rem 1rem;border-radius:7px;font-size:0.875rem;background:#d1fae5;color:#065f46;border:1px solid #6ee7b7;';
            msg.textContent   = `Subscribed! You'll receive notifications for ${labels[frequency]}.`;
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

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        document.getElementById('submit-modal-overlay').classList.add('hidden');
        document.getElementById('bench-modal-overlay').classList.add('hidden');
        document.getElementById('poc-modal-overlay').classList.add('hidden');
        document.getElementById('gotcha-modal-overlay').classList.add('hidden');
        document.getElementById('subscribe-modal-overlay').classList.add('hidden');
        document.body.style.overflow = '';
    }
});
