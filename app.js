let allEntries = [];

async function loadData() {
    const res = await fetch('data.json');
    allEntries = await res.json();
    allEntries.sort((a, b) => new Date(b.date) - new Date(a.date));
    populateFilters();
    render(allEntries);
}

function populateFilters() {
    const manufacturers = [...new Set(allEntries.map(e => e.manufacturer).filter(Boolean))].sort();
    const categories = [...new Set(allEntries.map(e => e.productCategory).filter(Boolean))].sort();

    const mfgSelect = document.getElementById('filter-manufacturer');
    manufacturers.forEach(m => {
        const opt = document.createElement('option');
        opt.value = m;
        opt.textContent = m;
        mfgSelect.appendChild(opt);
    });

    const catSelect = document.getElementById('filter-category');
    categories.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c;
        opt.textContent = c;
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
        if (filters.category    && entry.productCategory !== filters.category)   return false;
        if (filters.type        && entry.testType !== filters.type)               return false;
        if (filters.search) {
            const haystack = [
                entry.title,
                entry.productName,
                entry.manufacturer,
                entry.productCategory,
                entry.summary,
                (entry.tags || []).join(' ')
            ].join(' ').toLowerCase();
            if (!haystack.includes(filters.search)) return false;
        }
        return true;
    });
}

function badgeClass(type) {
    const map = { Kit: 'badge-kit', Program: 'badge-program', Concept: 'badge-concept' };
    return map[type] || '';
}

function formatDate(dateStr) {
    if (!dateStr) return '—';
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function createCard(entry) {
    const card = document.createElement('div');
    card.className = 'card';

    const frontBtn = entry.frontPageDoc
        ? `<a href="${entry.frontPageDoc}" target="_blank" rel="noopener" class="btn btn-secondary">Front Page</a>`
        : '';

    const reportBtn = entry.fullReport
        ? `<a href="${entry.fullReport}" target="_blank" rel="noopener" class="btn btn-primary">Full Report</a>`
        : '';

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

function render(entries) {
    const catalog   = document.getElementById('catalog');
    const noResults = document.getElementById('no-results');
    const count     = document.getElementById('results-count');

    catalog.innerHTML = '';

    if (entries.length === 0) {
        noResults.classList.remove('hidden');
        count.textContent = '0 results';
    } else {
        noResults.classList.add('hidden');
        entries.forEach(e => catalog.appendChild(createCard(e)));
        count.textContent = `${entries.length} result${entries.length !== 1 ? 's' : ''}`;
    }
}

function applyFilters() {
    render(filterEntries(getFilters()));
}

document.getElementById('search').addEventListener('input', applyFilters);
document.getElementById('filter-manufacturer').addEventListener('change', applyFilters);
document.getElementById('filter-category').addEventListener('change', applyFilters);
document.getElementById('filter-type').addEventListener('change', applyFilters);

document.getElementById('clear-filters').addEventListener('click', () => {
    document.getElementById('search').value = '';
    document.getElementById('filter-manufacturer').value = '';
    document.getElementById('filter-category').value = '';
    document.getElementById('filter-type').value = '';
    render(allEntries);
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

// ── Request a PoC Modal ───────────────────────────────────────────────────
function openPoCModal() {
    document.getElementById('poc-modal-overlay').classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    document.getElementById('poc-job-name').focus();
}

function closePoCModal(event) {
    if (event && event.target !== document.getElementById('poc-modal-overlay')) return;
    document.getElementById('poc-modal-overlay').classList.add('hidden');
    document.body.style.overflow = '';
    document.getElementById('poc-form').reset();
}

function submitPoCRequest(event) {
    event.preventDefault();

    const jobName  = document.getElementById('poc-job-name').value.trim();
    const scope    = document.getElementById('poc-scope').value.trim();
    const outcomes = document.getElementById('poc-outcomes').value.trim();
    const dates    = document.getElementById('poc-dates').value.trim();
    const persons  = document.getElementById('poc-persons').value.trim();

    const subject = jobName ? `PoC Request: ${jobName}` : 'New PoC Request';

    const body = [
        'POC LAB REQUEST',
        '================',
        '',
        `Job Name:                 ${jobName  || 'Not provided'}`,
        `Proposed Dates:           ${dates    || 'Not provided'}`,
        `Persons Conducting Test:  ${persons  || 'Not provided'}`,
        '',
        'SCOPE',
        '-----',
        scope    || 'Not provided',
        '',
        'EXPECTED OUTCOMES',
        '-----------------',
        outcomes || 'Not provided',
        '',
        '---',
        'Submitted via proAV PoC Lab Catalogue',
    ].join('\n');

    window.location.href = `mailto:poc.lab@proav.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

    document.getElementById('poc-modal-overlay').classList.add('hidden');
    document.body.style.overflow = '';
    document.getElementById('poc-form').reset();
}

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        document.getElementById('poc-modal-overlay').classList.add('hidden');
        document.body.style.overflow = '';
    }
});
