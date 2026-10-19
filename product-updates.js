let allUpdates = [];

// ── Data loading ──────────────────────────────────────────────────────────
async function loadUpdates() {
    const res  = await fetch('/api/product-updates');
    allUpdates = await res.json();
    allUpdates.sort((a, b) => new Date(b.meetingDate) - new Date(a.meetingDate));
    populateFilters();
    render(allUpdates, false);
}

// ── Filters ───────────────────────────────────────────────────────────────
// Same behaviour as the reports search: one box matching titles, products,
// manufacturers, summaries and tags, plus a manufacturer dropdown.
function populateFilters() {
    const manufacturers = [...new Set(allUpdates.map(u => u.manufacturer).filter(Boolean))].sort();
    const mfgSelect = document.getElementById('filter-manufacturer');
    manufacturers.forEach(m => {
        const opt = document.createElement('option');
        opt.value = m; opt.textContent = m;
        mfgSelect.appendChild(opt);
    });
}

function getFilters() {
    return {
        search:       document.getElementById('search').value.toLowerCase().trim(),
        manufacturer: document.getElementById('filter-manufacturer').value,
    };
}

function filterUpdates(filters) {
    return allUpdates.filter(u => {
        if (filters.manufacturer && u.manufacturer !== filters.manufacturer) return false;
        if (filters.search) {
            const haystack = [
                u.title, u.products, u.manufacturer, u.summary, (u.tags || []).join(' ')
            ].join(' ').toLowerCase();
            if (!haystack.includes(filters.search)) return false;
        }
        return true;
    });
}

// ── Card ──────────────────────────────────────────────────────────────────
// Same card as a report (see createCard in app.js), with the deck link in
// place of the report buttons. Values come from the admin form, so they are
// escaped before going into the markup.
function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function createUpdateCard(u) {
    const card = document.createElement('div');
    card.className = 'card card--update';

    const deckBtn = u.deckLink
        ? `<a href="${escapeHtml(u.deckLink)}" target="_blank" rel="noopener" class="btn btn-primary">View Deck</a>` : '';

    card.innerHTML = `
        <div class="card-topline">
            ${mfrLogo(u.manufacturer)}
            <span class="badge badge-update">Product Update</span>
        </div>
        <div class="card-title">${escapeHtml(u.title)}</div>
        <div class="card-meta">
            <span class="meta-item"><strong>Manufacturer</strong> ${escapeHtml(u.manufacturer) || '—'}</span>
            <span class="meta-item"><strong>Products</strong> ${escapeHtml(u.products) || '—'}</span>
            <span class="meta-item"><strong>Meeting</strong> ${formatDate(u.meetingDate)}</span>
        </div>
        <div class="card-summary">${escapeHtml(u.summary)}</div>
        <div class="card-actions">${deckBtn}</div>
    `;
    return card;
}

// ── What's New ────────────────────────────────────────────────────────────
// Same dark panel as the dashboard's, holding decks from meetings in the
// last 28 days.
function buildWhatsNewSection(updates) {
    const section = document.createElement('section');
    section.className = 'whats-new-section';
    section.innerHTML = `<div class="whats-new-header"><h2 class="whats-new-title">What's New</h2></div>`;

    const grid = document.createElement('div');
    grid.className = 'catalog-grid';
    updates.forEach(u => grid.appendChild(createUpdateCard(u)));
    section.appendChild(grid);
    return section;
}

// ── Grouped by manufacturer ───────────────────────────────────────────────
// One group per manufacturer, A–Z, newest meeting first inside each.
function buildGroupedSection(updates) {
    const wrapper = document.createElement('div');
    wrapper.className = 'catalog-grouped';

    const groups = new Map();
    updates.forEach(u => {
        const key = u.manufacturer || 'Other';
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(u);
    });

    [...groups.keys()].sort((a, b) => a.localeCompare(b)).forEach(name => {
        const items = groups.get(name)
            .sort((a, b) => new Date(b.meetingDate) - new Date(a.meetingDate));

        const group = document.createElement('div');
        group.className = 'type-group';
        group.innerHTML = `
            <div class="group-header">
                <div class="group-header-left">
                    <span class="group-accent"></span>
                    <h2 class="group-title">${escapeHtml(name)}</h2>
                </div>
                <span class="group-count">${items.length} update${items.length !== 1 ? 's' : ''}</span>
            </div>
        `;

        const grid = document.createElement('div');
        grid.className = 'catalog-grid';
        items.forEach(u => grid.appendChild(createUpdateCard(u)));
        group.appendChild(grid);
        wrapper.appendChild(group);
    });

    return wrapper;
}

// ── Main render ───────────────────────────────────────────────────────────
function render(updates, filtersActive) {
    const root      = document.getElementById('updates-root');
    const noResults = document.getElementById('no-results');
    const count     = document.getElementById('results-count');

    root.innerHTML = '';

    if (updates.length === 0) {
        noResults.textContent = filtersActive
            ? 'No product updates match your current filters.'
            : 'No product updates yet.';
        noResults.classList.remove('hidden');
        count.textContent = filtersActive ? '0 results' : '';
        return;
    }

    noResults.classList.add('hidden');
    count.textContent = filtersActive ? `${updates.length} result${updates.length !== 1 ? 's' : ''}` : '';

    if (!filtersActive) {
        const recent = updates.filter(u => isRecent(u.meetingDate));
        if (recent.length > 0) root.appendChild(buildWhatsNewSection(recent));
    }

    root.appendChild(buildGroupedSection(updates));
}

function applyFilters() {
    const filters = getFilters();
    const active  = !!(filters.search || filters.manufacturer);
    render(filterUpdates(filters), active);
}

// ── Event listeners ───────────────────────────────────────────────────────
document.getElementById('search').addEventListener('input', applyFilters);
document.getElementById('filter-manufacturer').addEventListener('change', applyFilters);

document.getElementById('clear-filters').addEventListener('click', () => {
    document.getElementById('search').value = '';
    document.getElementById('filter-manufacturer').value = '';
    render(allUpdates, false);
});

loadUpdates();
