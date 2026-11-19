let authToken      = localStorage.getItem('poc-admin-token');
let currentEntries = [];

// ── Visibility helpers ────────────────────────────────────────────────────
function showLoginForm() {
    document.getElementById('login-section').classList.remove('hidden');
    document.getElementById('admin-form-section').classList.add('hidden');
    document.getElementById('admin-sidebar').classList.remove('visible');
    document.getElementById('admin-password').focus();
}

function showAdminForm() {
    document.getElementById('login-section').classList.add('hidden');
    document.getElementById('admin-form-section').classList.remove('hidden');
    document.getElementById('admin-sidebar').classList.add('visible');
    let stored = localStorage.getItem('poc-admin-active-section');
    // "Add New Entry" and "Entries" were merged into Reports — send anyone who
    // last had one of those open to the new tab rather than the default.
    if (stored === 'section-add' || stored === 'section-entries') stored = 'section-reports';
    navigateTo(SECTIONS.includes(stored) ? stored : 'section-reports');
    loadEntries();
    loadUpdates();
    loadRequests();
    loadAccessLog();
    loadRequestOptions();
    loadSubscribers();
    loadGotchas();
    loadAnalytics();
}

// ── Auth ──────────────────────────────────────────────────────────────────
async function login(event) {
    event.preventDefault();
    const password = document.getElementById('admin-password').value;
    const errorEl  = document.getElementById('login-error');
    errorEl.textContent = '';

    try {
        const res = await fetch('/api/auth', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ password })
        });

        if (res.ok) {
            const { token } = await res.json();
            authToken = token;
            localStorage.setItem('poc-admin-token', token);
            document.getElementById('admin-password').value = '';
            showAdminForm();
        } else {
            errorEl.textContent = 'Incorrect password.';
            document.getElementById('admin-password').value = '';
            document.getElementById('admin-password').focus();
        }
    } catch {
        errorEl.textContent = 'Could not connect to server.';
    }
}

function logout() {
    authToken = null;
    localStorage.removeItem('poc-admin-token');
    showLoginForm();
}

// ── Add entry ─────────────────────────────────────────────────────────────
async function submitEntry(event) {
    event.preventDefault();

    const btn    = document.getElementById('submit-btn');
    const status = document.getElementById('status');

    const tagsRaw = document.getElementById('tags').value.trim();
    const entry = {
        title:           document.getElementById('title').value.trim(),
        manufacturer:    document.getElementById('manufacturer').value.trim(),
        productName:     document.getElementById('productName').value.trim(),
        productCategory: document.getElementById('productCategory').value.trim(),
        testType:        document.getElementById('testType').value,
        date:            document.getElementById('date').value,
        summary:         document.getElementById('summary').value.trim(),
        frontPageDoc:    document.getElementById('frontPageDoc').value.trim() || null,
        fullReport:      document.getElementById('fullReport').value.trim() || null,
        tags:            tagsRaw ? tagsRaw.split(',').map(t => t.trim()).filter(Boolean) : []
    };

    if (!entry.title || !entry.manufacturer || !entry.testType || !entry.date || !entry.summary) {
        status.className   = 'status error';
        status.textContent = 'Please fill in all required fields.';
        return;
    }

    const requestSelect  = document.getElementById('entry-request-link');
    const requestId      = requestSelect ? requestSelect.value : '';
    const requesterLabel = requestId && requestSelect.selectedOptions.length
        ? requestSelect.selectedOptions[0].dataset.requester || 'the requester'
        : '';

    btn.disabled       = true;
    status.className   = 'status loading';
    status.textContent = 'Saving...';

    try {
        const res = await fetch('/api/entries', {
            method:  'POST',
            headers: {
                'Content-Type':  'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            // requestId travels alongside the entry but isn't part of it — the
            // backend strips it, marks that request complete and emails the
            // person who raised it.
            body: JSON.stringify({ ...entry, requestId: requestId || undefined })
        });

        if (res.status === 401) {
            logout();
            status.className   = 'status error';
            status.textContent = 'Session expired — please log in again.';
            return;
        }

        if (res.ok) {
            status.className   = 'status success';
            status.textContent = requestId
                ? `"${entry.title}" added — ${requesterLabel} has been emailed.`
                : `"${entry.title}" added to catalogue.`;
            document.getElementById('entry-form').reset();
            document.getElementById('date').value = new Date().toISOString().split('T')[0];
            loadEntries();
            loadRequests();
            loadRequestOptions();
        } else {
            status.className   = 'status error';
            status.textContent = 'Failed to save — please try again.';
        }
    } catch {
        status.className   = 'status error';
        status.textContent = 'Network error. Is the backend running?';
    } finally {
        btn.disabled = false;
    }
}

// ── Existing entries list ─────────────────────────────────────────────────
async function loadEntries() {
    const list = document.getElementById('entries-list');
    list.innerHTML = '<p style="color:#6b7280;font-size:0.85rem;">Loading...</p>';

    try {
        const res      = await fetch('/api/entries');
        currentEntries = await res.json();

        if (currentEntries.length === 0) {
            list.innerHTML = '<p style="color:#6b7280;font-size:0.85rem;">No entries yet.</p>';
            return;
        }

        updateBadge('entries-count-badge', currentEntries.length, true);
        updateBadge('sb-entries', currentEntries.length, true);

        list.innerHTML = '';
        currentEntries.forEach((entry, idx) => {
            const row = document.createElement('div');
            row.className = 'entry-row';
            row.id = `entry-row-${idx}`;
            row.innerHTML = `
                <div class="entry-row-info">
                    <span class="entry-row-title">${escapeHtml(entry.title)}</span>
                    <span class="entry-row-meta">${escapeHtml(entry.manufacturer)} &middot; ${entry.testType} &middot; ${entry.date}</span>
                </div>
                <div class="entry-row-actions">
                    <button class="entry-row-edit" onclick="openEditForm(${idx})">Edit</button>
                    <button class="entry-row-delete" onclick="deleteEntry(${idx}, this)">Delete</button>
                </div>
            `;
            list.appendChild(row);
        });
    } catch {
        list.innerHTML = '<p style="color:#991b1b;font-size:0.85rem;">Failed to load entries.</p>';
    }
}

// ── Edit entry ────────────────────────────────────────────────────────────
function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function openEditForm(idx) {
    // Close any other open edit forms
    document.querySelectorAll('.entry-edit-form').forEach(f => f.remove());
    document.querySelectorAll('.entry-row-edit').forEach(b => {
        b.textContent = 'Edit';
    });

    const entry  = currentEntries[idx];
    const row    = document.getElementById(`entry-row-${idx}`);
    const editBtn = row.querySelector('.entry-row-edit');
    editBtn.textContent = 'Close';
    editBtn.onclick = () => closeEditForm(idx);

    const form = document.createElement('div');
    form.className = 'entry-edit-form';
    form.id = `edit-form-${idx}`;
    form.innerHTML = `
        <div class="entry-edit-grid">
            <div class="form-group full">
                <label>Title</label>
                <input type="text" id="edit-title-${idx}" value="${escapeHtml(entry.title)}">
            </div>
            <div class="form-group">
                <label>Manufacturer</label>
                <input type="text" id="edit-manufacturer-${idx}" value="${escapeHtml(entry.manufacturer)}">
            </div>
            <div class="form-group">
                <label>Product Name</label>
                <input type="text" id="edit-productName-${idx}" value="${escapeHtml(entry.productName)}">
            </div>
            <div class="form-group">
                <label>Product Category</label>
                <input type="text" id="edit-productCategory-${idx}" value="${escapeHtml(entry.productCategory)}">
            </div>
            <div class="form-group">
                <label>Test Type</label>
                <select id="edit-testType-${idx}">
                    <option value="Kit"     ${entry.testType === 'Kit'     ? 'selected' : ''}>Kit</option>
                    <option value="Program" ${entry.testType === 'Program' ? 'selected' : ''}>Program</option>
                    <option value="Concept" ${entry.testType === 'Concept' ? 'selected' : ''}>Concept</option>
                </select>
            </div>
            <div class="form-group full">
                <label>Date</label>
                <input type="date" id="edit-date-${idx}" value="${entry.date || ''}">
            </div>
            <div class="form-group full">
                <label>Summary</label>
                <textarea id="edit-summary-${idx}">${escapeHtml(entry.summary)}</textarea>
            </div>
            <div class="form-group full">
                <label>Front Page Document (SharePoint link)</label>
                <input type="url" id="edit-frontPageDoc-${idx}" value="${entry.frontPageDoc || ''}">
            </div>
            <div class="form-group full">
                <label>Full Report (SharePoint link)</label>
                <input type="url" id="edit-fullReport-${idx}" value="${entry.fullReport || ''}">
            </div>
            <div class="form-group full">
                <label>Tags (comma-separated)</label>
                <input type="text" id="edit-tags-${idx}" value="${escapeHtml((entry.tags || []).join(', '))}">
            </div>
        </div>
        <div class="entry-edit-actions">
            <button class="btn-submit" onclick="saveEntry(${idx})" style="padding:0.5rem 1.25rem;font-size:0.85rem;">Save Changes</button>
            <button class="btn-logout" onclick="closeEditForm(${idx})">Cancel</button>
            <span class="entry-edit-status" id="edit-status-${idx}"></span>
        </div>
    `;

    row.after(form);
}

function closeEditForm(idx) {
    const form = document.getElementById(`edit-form-${idx}`);
    if (form) form.remove();
    const row = document.getElementById(`entry-row-${idx}`);
    if (row) {
        const editBtn = row.querySelector('.entry-row-edit');
        if (editBtn) {
            editBtn.textContent = 'Edit';
            editBtn.onclick = () => openEditForm(idx);
        }
    }
}

async function saveEntry(idx) {
    const statusEl = document.getElementById(`edit-status-${idx}`);
    statusEl.textContent  = 'Saving...';
    statusEl.style.color  = '#5b21b6';

    const tagsRaw = document.getElementById(`edit-tags-${idx}`).value.trim();
    const updated = {
        title:           document.getElementById(`edit-title-${idx}`).value.trim(),
        manufacturer:    document.getElementById(`edit-manufacturer-${idx}`).value.trim(),
        productName:     document.getElementById(`edit-productName-${idx}`).value.trim(),
        productCategory: document.getElementById(`edit-productCategory-${idx}`).value.trim(),
        testType:        document.getElementById(`edit-testType-${idx}`).value,
        date:            document.getElementById(`edit-date-${idx}`).value,
        summary:         document.getElementById(`edit-summary-${idx}`).value.trim(),
        frontPageDoc:    document.getElementById(`edit-frontPageDoc-${idx}`).value.trim() || null,
        fullReport:      document.getElementById(`edit-fullReport-${idx}`).value.trim() || null,
        tags:            tagsRaw ? tagsRaw.split(',').map(t => t.trim()).filter(Boolean) : []
    };

    try {
        const res = await fetch(`/api/entries/${idx}`, {
            method:  'PUT',
            headers: {
                'Content-Type':  'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify(updated)
        });

        if (res.status === 401) { logout(); return; }

        if (res.ok) {
            statusEl.textContent = 'Saved!';
            statusEl.style.color = '#065f46';
            setTimeout(() => { closeEditForm(idx); loadEntries(); }, 600);
        } else {
            statusEl.textContent = 'Failed to save.';
            statusEl.style.color = '#991b1b';
        }
    } catch {
        statusEl.textContent  = 'Network error.';
        statusEl.style.color  = '#991b1b';
    }
}

// ── Delete entry ──────────────────────────────────────────────────────────
async function deleteEntry(idx, btn) {
    if (!confirm('Delete this entry? This cannot be undone.')) return;
    btn.disabled = true;

    try {
        const res = await fetch(`/api/entries/${idx}`, {
            method:  'DELETE',
            headers: { 'Authorization': `Bearer ${authToken}` }
        });

        if (res.status === 401) { logout(); return; }
        if (res.ok) {
            loadEntries();
        } else {
            alert('Failed to delete. Please try again.');
            btn.disabled = false;
        }
    } catch {
        alert('Network error.');
        btn.disabled = false;
    }
}

// ── Product updates ───────────────────────────────────────────────────────
// Same flow as catalogue entries — add form behind "+ New product update",
// list with inline Edit below — but kept to their own store and addressed by
// id, not position.
let currentUpdates = [];

function readUpdateFields(prefix) {
    const val     = name => document.getElementById(`${prefix}${name}`).value.trim();
    const tagsRaw = val('tags');
    return {
        title:        val('title'),
        manufacturer: val('manufacturer'),
        products:     val('products') || null,
        meetingDate:  val('meetingDate'),
        summary:      val('summary'),
        deckLink:     val('deckLink'),
        tags:         tagsRaw ? tagsRaw.split(',').map(t => t.trim()).filter(Boolean) : []
    };
}

function missingUpdateFields(u) {
    return !u.title || !u.manufacturer || !u.meetingDate || !u.summary || !u.deckLink;
}

async function submitUpdate(event) {
    event.preventDefault();
    const btn    = document.getElementById('update-submit-btn');
    const status = document.getElementById('update-status');
    const update = readUpdateFields('update-');

    if (missingUpdateFields(update)) {
        status.className   = 'status error';
        status.textContent = 'Please fill in all required fields.';
        return;
    }

    btn.disabled       = true;
    status.className   = 'status loading';
    status.textContent = 'Saving...';

    try {
        const res = await fetch('/api/product-updates', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
            body:    JSON.stringify(update)
        });

        if (res.status === 401) {
            logout();
            status.className   = 'status error';
            status.textContent = 'Session expired — please log in again.';
            return;
        }

        if (res.ok) {
            status.className   = 'status success';
            status.textContent = `"${update.title}" added to Product Updates.`;
            document.getElementById('update-form').reset();
            document.getElementById('update-meetingDate').value = new Date().toISOString().split('T')[0];
            loadUpdates();
        } else {
            status.className   = 'status error';
            status.textContent = 'Failed to save — please try again.';
        }
    } catch {
        status.className   = 'status error';
        status.textContent = 'Network error. Is the backend running?';
    } finally {
        btn.disabled = false;
    }
}

async function loadUpdates() {
    const list = document.getElementById('updates-list');
    list.innerHTML = '<p style="color:#6b7280;font-size:0.85rem;">Loading...</p>';

    try {
        const res      = await fetch('/api/product-updates');
        currentUpdates = await res.json();
        currentUpdates.sort((a, b) => String(b.meetingDate).localeCompare(String(a.meetingDate)));

        updateBadge('updates-count-badge', currentUpdates.length, true);
        updateBadge('sb-updates',          currentUpdates.length, true);

        if (currentUpdates.length === 0) {
            list.innerHTML = '<p style="color:#6b7280;font-size:0.85rem;">No product updates yet.</p>';
            return;
        }

        list.innerHTML = '';
        currentUpdates.forEach(u => {
            const row = document.createElement('div');
            row.className = 'entry-row';
            row.id = `update-row-${u.id}`;
            row.innerHTML = `
                <div class="entry-row-info">
                    <span class="entry-row-title">${escapeHtml(u.title)}</span>
                    <span class="entry-row-meta">${escapeHtml(u.manufacturer)} &middot; Meeting ${escapeHtml(u.meetingDate)}</span>
                </div>
                <div class="entry-row-actions">
                    <button class="entry-row-edit" onclick="openUpdateEditForm('${u.id}')">Edit</button>
                    <button class="entry-row-delete" onclick="deleteUpdate('${u.id}', this)">Delete</button>
                </div>
            `;
            list.appendChild(row);
        });
    } catch {
        list.innerHTML = '<p style="color:#991b1b;font-size:0.85rem;">Failed to load product updates.</p>';
    }
}

function openUpdateEditForm(id) {
    document.querySelectorAll('.entry-edit-form').forEach(f => f.remove());
    document.querySelectorAll('#updates-list .entry-row-edit').forEach(b => {
        b.textContent = 'Edit';
        b.onclick = () => openUpdateEditForm(b.closest('.entry-row').id.replace('update-row-', ''));
    });

    const u       = currentUpdates.find(x => x.id === id);
    const row     = document.getElementById(`update-row-${id}`);
    const editBtn = row.querySelector('.entry-row-edit');
    editBtn.textContent = 'Close';
    editBtn.onclick = () => closeUpdateEditForm(id);

    const p    = `edit-update-${id}-`;
    const form = document.createElement('div');
    form.className = 'entry-edit-form';
    form.id = `edit-update-form-${id}`;
    form.innerHTML = `
        <div class="entry-edit-grid">
            <div class="form-group full">
                <label>Title</label>
                <input type="text" id="${p}title" value="${escapeHtml(u.title)}">
            </div>
            <div class="form-group">
                <label>Manufacturer</label>
                <input type="text" id="${p}manufacturer" value="${escapeHtml(u.manufacturer)}">
            </div>
            <div class="form-group">
                <label>Products Covered</label>
                <input type="text" id="${p}products" value="${escapeHtml(u.products)}">
            </div>
            <div class="form-group full">
                <label>Meeting Date</label>
                <input type="date" id="${p}meetingDate" value="${escapeHtml(u.meetingDate)}">
            </div>
            <div class="form-group full">
                <label>Summary</label>
                <textarea id="${p}summary">${escapeHtml(u.summary)}</textarea>
            </div>
            <div class="form-group full">
                <label>Deck (SharePoint link)</label>
                <input type="url" id="${p}deckLink" value="${escapeHtml(u.deckLink)}">
            </div>
            <div class="form-group full">
                <label>Tags (comma-separated)</label>
                <input type="text" id="${p}tags" value="${escapeHtml((u.tags || []).join(', '))}">
            </div>
        </div>
        <div class="entry-edit-actions">
            <button class="btn-submit" onclick="saveUpdate('${id}')" style="padding:0.5rem 1.25rem;font-size:0.85rem;">Save Changes</button>
            <button class="btn-logout" onclick="closeUpdateEditForm('${id}')">Cancel</button>
            <span class="entry-edit-status" id="edit-update-status-${id}"></span>
        </div>
    `;

    row.after(form);
}

function closeUpdateEditForm(id) {
    const form = document.getElementById(`edit-update-form-${id}`);
    if (form) form.remove();
    const row = document.getElementById(`update-row-${id}`);
    if (row) {
        const editBtn = row.querySelector('.entry-row-edit');
        editBtn.textContent = 'Edit';
        editBtn.onclick = () => openUpdateEditForm(id);
    }
}

async function saveUpdate(id) {
    const statusEl = document.getElementById(`edit-update-status-${id}`);
    const updated  = readUpdateFields(`edit-update-${id}-`);

    if (missingUpdateFields(updated)) {
        statusEl.textContent = 'Please fill in all required fields.';
        statusEl.style.color = '#991b1b';
        return;
    }

    statusEl.textContent = 'Saving...';
    statusEl.style.color = '#5b21b6';

    try {
        const res = await fetch(`/api/product-updates/${encodeURIComponent(id)}`, {
            method:  'PUT',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
            body:    JSON.stringify(updated)
        });

        if (res.status === 401) { logout(); return; }

        if (res.ok) {
            statusEl.textContent = 'Saved!';
            statusEl.style.color = '#065f46';
            setTimeout(() => { closeUpdateEditForm(id); loadUpdates(); }, 600);
        } else {
            statusEl.textContent = 'Failed to save.';
            statusEl.style.color = '#991b1b';
        }
    } catch {
        statusEl.textContent = 'Network error.';
        statusEl.style.color = '#991b1b';
    }
}

async function deleteUpdate(id, btn) {
    if (!confirm('Delete this product update? The deck on SharePoint is not affected.')) return;
    btn.disabled = true;

    try {
        const res = await fetch(`/api/product-updates/${encodeURIComponent(id)}`, {
            method:  'DELETE',
            headers: { 'Authorization': `Bearer ${authToken}` }
        });

        if (res.status === 401) { logout(); return; }
        if (res.ok) loadUpdates();
        else { alert('Failed to delete. Please try again.'); btn.disabled = false; }
    } catch {
        alert('Network error.');
        btn.disabled = false;
    }
}

// ── Link a report to an open request ──────────────────────────────────────
// Only requests that are still open AND have an email on record can be
// notified, so anything else would be a dead option.
async function loadRequestOptions() {
    const sel = document.getElementById('entry-request-link');
    if (!sel) return;

    try {
        const res = await fetch('/api/requests', {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        if (!res.ok) return;

        const open = (await res.json()).filter(r =>
            r.status !== 'completed' && r.submitterEmail && r.id
        );

        sel.innerHTML = '<option value="">No — don\'t notify anyone</option>';
        open.forEach(r => {
            const opt = document.createElement('option');
            opt.value = r.id;
            opt.dataset.requester = r.submitterName || r.submitterEmail;
            opt.textContent = `${r.jobName} — ${r.submitterName} (${r.type === 'bench' ? 'Bench Test' : 'PoC'})`;
            sel.appendChild(opt);
        });

        const hint = document.getElementById('entry-request-hint');
        if (hint) {
            hint.textContent = open.length === 0
                ? 'No open requests with an email address on record.'
                : `${open.length} open request${open.length === 1 ? '' : 's'} available.`;
        }
    } catch {
        /* dropdown just stays on its default option */
    }
}

// ── Access log ────────────────────────────────────────────────────────────
// Read-only by design. Entries are written by the backend when a booking is
// approved or a visitor signs in, so there is nothing to edit here — a record
// you can amend from a browser tab is not much of a record.

function accessLogRange() {
    const from = document.getElementById('accesslog-from').value;
    const to   = document.getElementById('accesslog-to').value;
    const qs   = new URLSearchParams();
    if (from) qs.set('from', from);
    if (to)   qs.set('to', to);
    return qs.toString();
}

function clearAccessLogRange() {
    document.getElementById('accesslog-from').value = '';
    document.getElementById('accesslog-to').value   = '';
    loadAccessLog();
}

async function loadAccessLog() {
    const list = document.getElementById('accesslog-list');
    list.innerHTML = '<p style="color:#6b7280;font-size:0.85rem;">Loading...</p>';

    try {
        const qs  = accessLogRange();
        const res = await fetch(`/api/admin/access-log${qs ? '?' + qs : ''}`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        if (res.status === 401) { logout(); return; }

        const rows = await res.json();
        updateBadge('accesslog-count-badge', rows.length, rows.length > 0);
        updateBadge('sb-accesslog',          rows.length, rows.length > 0);
        document.getElementById('accesslog-export').disabled = rows.length === 0;

        if (rows.length === 0) {
            list.innerHTML = qs
                ? '<p style="color:#6b7280;font-size:0.85rem;">No lab access in that date range.</p>'
                : '<p style="color:#6b7280;font-size:0.85rem;">No guest access logged yet. Approving a booking or a visitor signing in records it here.</p>';
        } else {
            list.innerHTML = '';
            rows.forEach(e => list.appendChild(buildAccessLogRow(e)));
        }
    } catch {
        list.innerHTML = '<p style="color:#991b1b;font-size:0.85rem;">Failed to load the access log.</p>';
    }

    loadOnSite();
}

// Local date, not UTC — the admin panel is used in the UK, and after midnight
// BST toISOString() would still be reporting yesterday.
function todayLocal() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function timeOf(iso) {
    return iso ? new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '';
}

// Always today, whatever dates the log below is filtered to — this panel is
// the answer to "who is in the building", not part of the search. Visitors do
// not sign out; everyone signed in today is assumed to be here until the day ends.
async function loadOnSite() {
    const list  = document.getElementById('onsite-list');
    const count = document.getElementById('onsite-count');
    try {
        const today = todayLocal();
        const res   = await fetch(`/api/admin/access-log?from=${today}&to=${today}`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        if (res.status === 401) { logout(); return; }

        const onSite = (await res.json()).filter(e => e.source === 'visit');
        count.textContent = onSite.length ? `${onSite.length} visitor${onSite.length === 1 ? '' : 's'}` : '';

        if (onSite.length === 0) {
            list.innerHTML = '<p style="color:#6b7280;font-size:0.82rem;margin-top:0.4rem;">Nobody has signed in today.</p>';
            return;
        }
        list.innerHTML = '';
        onSite.forEach(e => list.appendChild(buildAccessLogRow(e)));
    } catch {
        list.innerHTML = '<p style="color:#991b1b;font-size:0.82rem;margin-top:0.4rem;">Could not load today\'s visitors.</p>';
    }
}

// The admin panel often sits open on the lab PC, so keep the roll call current
// without a reload. Only while the section is actually on screen.
setInterval(() => {
    const section = document.getElementById('section-accesslog');
    if (authToken && section && !section.classList.contains('hidden')) loadOnSite();
}, 60 * 1000);

function buildAccessLogRow(e) {
    if (e.source === 'visit') return buildVisitRow(e);

    const wrap = document.createElement('div');

    const typeBg  = e.type === 'bench' ? '#dbeafe' : '#ede9fe';
    const typeFg  = e.type === 'bench' ? '#1d4ed8' : '#6d28d9';
    const typeStr = e.type === 'bench' ? 'Bench Test' : 'PoC';

    const dates = e.dateStart
        ? `${e.dateStart}${e.dateEnd && e.dateEnd !== e.dateStart ? ' → ' + e.dateEnd : ''}`
        : 'No dates given';

    // Backfilled rows predate the log and have no approval time. Saying so is
    // better than showing a date that was never actually recorded.
    const approved = e.approvedAt
        ? `Approved ${e.approvedAt.split('T')[0]}`
        : 'Approved before logging began';

    wrap.innerHTML = `
        <div class="entry-row">
            <div class="entry-row-info">
                <span class="entry-row-title">
                    <span style="display:inline-block;padding:1px 7px;border-radius:4px;font-size:0.72rem;font-weight:700;background:${typeBg};color:${typeFg};margin-right:0.4rem;">${typeStr}</span>
                    ${escapeHtml(e.name || 'Unknown')}
                </span>
                <span class="entry-row-meta">${escapeHtml(dates)} · ${escapeHtml(e.jobName || '—')}</span>
                <span class="entry-row-meta">${escapeHtml(e.email || 'No email')}${e.persons ? ' · With: ' + escapeHtml(e.persons) : ''}</span>
                <span class="entry-row-meta">Booked ${e.bookedOn || '—'} · ${approved}${e.accessCodeIssued ? ' · Access code issued' : ''}</span>
            </div>
        </div>`;
    return wrap;
}

function buildVisitRow(e) {
    const wrap = document.createElement('div');

    const here = e.jobName
        ? `${escapeHtml(e.jobName)} (${e.type === 'bench' ? 'Bench Test' : 'PoC'})`
        : escapeHtml(e.purpose || '—');

    const terms = e.termsAccepted
        ? `Terms v${escapeHtml(e.termsVersion || '?')} accepted`
        : '<span style="color:#c2410c;font-weight:600;">Terms not accepted</span>';

    wrap.innerHTML = `
        <div class="entry-row">
            <div class="entry-row-info">
                <span class="entry-row-title">
                    <span style="display:inline-block;padding:1px 7px;border-radius:4px;font-size:0.72rem;font-weight:700;background:#ecfccb;color:#3f7a12;margin-right:0.4rem;">Visitor</span>
                    ${escapeHtml(e.name || 'Unknown')}${e.company ? ` <span style="font-weight:400;color:#6b7280;">· ${escapeHtml(e.company)}</span>` : ''}
                </span>
                <span class="entry-row-meta">${escapeHtml(e.dateStart || '—')} · Signed in ${timeOf(e.signedInAt)} · ${terms}</span>
                <span class="entry-row-meta">Here for: ${here}${e.host ? ' · Meeting: ' + escapeHtml(e.host) : ''}</span>
                <span class="entry-row-meta">${escapeHtml(e.email || 'No email')} · ${escapeHtml(e.phone || 'No phone')}</span>
            </div>
        </div>`;
    return wrap;
}

// The export is behind the same bearer token as everything else, so it cannot
// be a plain link — fetch it, then hand the browser the blob to save.
async function exportAccessLog(btn) {
    const original = btn.textContent;
    btn.disabled    = true;
    btn.textContent = 'Exporting...';

    try {
        const qs  = accessLogRange();
        const res = await fetch(`/api/admin/access-log.csv${qs ? '?' + qs : ''}`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        if (res.status === 401) { logout(); return; }
        if (!res.ok) throw new Error('export failed');

        const disposition = res.headers.get('Content-Disposition') || '';
        const match       = disposition.match(/filename="([^"]+)"/);
        const blob        = await res.blob();
        const url         = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href     = url;
        a.download = match ? match[1] : 'poc-lab-access-log.csv';
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    } catch {
        alert('Could not export the access log. Please try again.');
    } finally {
        btn.disabled    = false;
        btn.textContent = original;
    }
}

// ── Requests ──────────────────────────────────────────────────────────────
async function loadRequests() {
    const list = document.getElementById('requests-list');
    // Keep the history open across reloads — Reopen and Delete inside it
    // refresh the list, and snapping it shut each time would be maddening.
    // Read before the Loading message below replaces it.
    const prevHistory = document.getElementById('requests-completed');
    const historyOpen = prevHistory ? prevHistory.open : false;
    list.innerHTML = '<p style="color:#6b7280;font-size:0.85rem;">Loading...</p>';

    try {
        const res = await fetch('/api/requests', {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        if (res.status === 401) { logout(); return; }

        const requests = await res.json();

        if (requests.length === 0) {
            list.innerHTML = '<p style="color:#6b7280;font-size:0.85rem;">No requests yet.</p>';
            updateBadge('requests-pending-badge', 0, false);
            updateBadge('sb-requests-pending',   0, false);
            return;
        }

        const pending   = requests.filter(r => r.status === 'pending');
        const active    = requests.filter(r => r.status !== 'pending' && r.status !== 'completed');
        // Most recently finished first — the history is read backwards from today.
        const completed = requests.filter(r => r.status === 'completed')
            .sort((a, b) => String(b.completedDate || '').localeCompare(String(a.completedDate || '')));

        updateBadge('requests-pending-badge', pending.length, pending.length > 0);
        updateBadge('sb-requests-pending',   pending.length, pending.length > 0);

        list.innerHTML = '';

        if (pending.length > 0) {
            const h = document.createElement('p');
            h.style.cssText = 'font-size:0.78rem;font-weight:700;color:#92400e;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:0.5rem;margin-top:0.25rem;';
            h.textContent   = `Pending (${pending.length})`;
            list.appendChild(h);
            pending.forEach(r => list.appendChild(buildRequestRow(r, true)));
        }

        if (active.length > 0) {
            const d = document.createElement('p');
            d.style.cssText = `font-size:0.78rem;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:0.5rem;margin-top:${pending.length ? '1rem' : '0.25rem'};`;
            d.textContent   = `Approved (${active.length})`;
            list.appendChild(d);
            active.forEach(r => list.appendChild(buildRequestRow(r, false)));
        }

        if (pending.length === 0 && active.length === 0) {
            list.insertAdjacentHTML('beforeend', '<p style="color:#6b7280;font-size:0.85rem;">No open requests.</p>');
        }

        if (completed.length > 0) {
            const history = document.createElement('details');
            history.id        = 'requests-completed';
            history.className = 'requests-history';
            history.open      = historyOpen;
            history.innerHTML = `<summary>Completed (${completed.length})</summary>`;
            completed.forEach(r => history.appendChild(buildRequestRow(r, false)));
            list.appendChild(history);
        }
    } catch {
        list.innerHTML = '<p style="color:#991b1b;font-size:0.85rem;">Failed to load requests.</p>';
    }
}

function buildRequestRow(r, isPending) {
    const wrap = document.createElement('div');
    wrap.id    = `request-row-${r.id}`;

    if (isPending) {
        wrap.style.cssText = 'border-left:3px solid #f97316;padding-left:0.6rem;background:#fff7ed;margin-bottom:0.25rem;border-radius:0 6px 6px 0;';
    }

    const typeBg  = r.type === 'bench' ? '#dbeafe' : '#ede9fe';
    const typeFg  = r.type === 'bench' ? '#1d4ed8' : '#6d28d9';
    const typeStr = r.type === 'bench' ? 'Bench Test' : 'PoC';
    const badge   = `<span style="display:inline-block;padding:1px 7px;border-radius:4px;font-size:0.72rem;font-weight:700;background:${typeBg};color:${typeFg};margin-right:0.4rem;">${typeStr}</span>`;

    const dateRange = r.dateStart
        ? `<span class="entry-row-meta">Dates: ${r.dateStart}${r.dateEnd ? ' → ' + r.dateEnd : ''}</span>`
        : '';

    const doneBadge = r.status === 'completed'
        ? `<span style="display:inline-block;padding:1px 7px;border-radius:4px;font-size:0.72rem;font-weight:700;background:#d1fae5;color:#065f46;margin-right:0.4rem;">${r.completedManually ? 'Completed' : 'Report sent'}</span>`
        : '';

    const doneMeta = r.status !== 'completed' ? ''
        : r.completedManually
            ? `<span class="entry-row-meta">Marked complete ${r.completedDate || '—'}</span>`
            : `<span class="entry-row-meta">Report "${escapeHtml(r.reportTitle || '—')}" published ${r.completedDate || '—'}${r.submitterEmail ? ' · emailed ' + escapeHtml(r.submitterEmail) : ''}</span>`;

    const statusActions = r.status === 'approved'
        ? `<button class="entry-row-complete" onclick="completeRequest('${r.id}', this)">Completed</button>`
        : r.status === 'completed' && r.completedManually
            ? `<button class="entry-row-edit" onclick="reopenRequest('${r.id}', this)">Reopen</button>`
            : '';

    wrap.innerHTML = `
        <div class="entry-row">
            <div class="entry-row-info">
                <span class="entry-row-title">${doneBadge}${badge}${escapeHtml(r.jobName)}</span>
                <span class="entry-row-meta">${escapeHtml(r.submitterName)} · Submitted ${r.submittedDate || '—'}</span>
                ${dateRange}
                ${doneMeta}
            </div>
            <div class="entry-row-actions">
                <button class="entry-row-edit" onclick="toggleRequestDetail('${r.id}')">Details</button>
                ${isPending ? `<input type="text" id="request-accesscode-${r.id}" placeholder="Access code (optional)" style="width:150px;padding:0.3rem 0.55rem;font-size:0.78rem;border:1px solid #d1d5db;border-radius:5px;">
                <button class="entry-row-approve" onclick="approveRequest('${r.id}', this)">Approve</button>
                <button class="entry-row-delete"  onclick="deleteRequest('${r.id}', this)">Decline</button>` : `${statusActions}
                <button class="entry-row-delete" onclick="deleteRequest('${r.id}', this)">Delete</button>`}
            </div>
        </div>
        <div id="request-detail-${r.id}" class="hidden" style="background:#f8fafc;border:1px solid #e1e4e8;border-left:3px solid #6DC52D;border-radius:8px;padding:1.1rem;margin:0.25rem 0 0.5rem;">
            ${r.accessCode      ? `<p style="font-size:0.82rem;margin-bottom:0.6rem;"><strong>Access Code Sent:</strong> ${escapeHtml(r.accessCode)}</p>` : ''}
            ${r.submitterEmail ? `<p style="font-size:0.82rem;margin-bottom:0.6rem;"><strong>Email:</strong> ${escapeHtml(r.submitterEmail)}</p>` : ''}
            ${r.persons        ? `<p style="font-size:0.82rem;margin-bottom:0.75rem;"><strong>Persons:</strong> ${escapeHtml(r.persons)}</p>` : ''}
            ${r.termsAccepted  ? `<p style="font-size:0.82rem;margin-bottom:0.75rem;"><strong>Terms accepted:</strong> ${escapeHtml(r.termsVersion || 'version not recorded')}${r.termsAcceptedAt ? ' on ' + escapeHtml(r.termsAcceptedAt.split('T')[0]) : ''}</p>` : ''}
            ${r.scope    ? `<div style="margin-bottom:0.75rem;"><p style="font-size:0.75rem;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.04em;margin-bottom:0.25rem;">Scope</p><p style="font-size:0.82rem;line-height:1.6;white-space:pre-wrap;">${escapeHtml(r.scope)}</p></div>` : ''}
            ${r.outcomes ? `<div style="margin-bottom:0.75rem;"><p style="font-size:0.75rem;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.04em;margin-bottom:0.25rem;">Expected outcomes</p><p style="font-size:0.82rem;line-height:1.6;white-space:pre-wrap;">${escapeHtml(r.outcomes)}</p></div>` : ''}
            ${r.kit      ? `<div><p style="font-size:0.75rem;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.04em;margin-bottom:0.25rem;">Kit / equipment required</p><p style="font-size:0.82rem;line-height:1.6;white-space:pre-wrap;">${escapeHtml(r.kit)}</p></div>` : ''}
        </div>
    `;
    return wrap;
}

function toggleRequestDetail(id) {
    const detail = document.getElementById(`request-detail-${id}`);
    const btn    = document.querySelector(`#request-row-${id} .entry-row-edit`);
    const isNowHidden = detail.classList.toggle('hidden');
    btn.textContent   = isNowHidden ? 'Details' : 'Close';
}

async function approveRequest(id, btn) {
    btn.disabled = true;
    const codeInput  = document.getElementById(`request-accesscode-${id}`);
    const accessCode = codeInput ? codeInput.value.trim() : '';
    try {
        const res = await fetch(`/api/requests/${encodeURIComponent(id)}/approve`, {
            method:  'PUT',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
            body:    JSON.stringify({ accessCode })
        });
        if (res.status === 401) { logout(); return; }
        // Approving is what writes the access log, so refresh it here too —
        // otherwise the log looks stale until the next full page load.
        if (res.ok) { loadRequests(); loadRequestOptions(); loadAccessLog(); }
        else { alert('Failed to approve.'); btn.disabled = false; }
    } catch {
        alert('Network error.');
        btn.disabled = false;
    }
}

// Shared by Completed and Reopen — both just flip the status and refresh.
async function setRequestStatus(id, action, btn, failMsg) {
    btn.disabled = true;
    try {
        const res = await fetch(`/api/requests/${encodeURIComponent(id)}/${action}`, {
            method:  'PUT',
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        if (res.status === 401) { logout(); return; }
        if (res.ok) { loadRequests(); loadRequestOptions(); }
        else { alert(failMsg); btn.disabled = false; }
    } catch {
        alert('Network error.');
        btn.disabled = false;
    }
}

function completeRequest(id, btn) { setRequestStatus(id, 'complete', btn, 'Failed to mark as completed.'); }
function reopenRequest(id, btn)   { setRequestStatus(id, 'reopen',   btn, 'Failed to reopen.'); }

async function deleteRequest(id, btn) {
    if (!confirm('Delete this request? This cannot be undone.')) return;
    btn.disabled = true;
    try {
        const res = await fetch(`/api/requests/${encodeURIComponent(id)}`, {
            method:  'DELETE',
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        if (res.status === 401) { logout(); return; }
        if (res.ok) { loadRequests(); loadRequestOptions(); }
        else { alert('Failed to delete.'); btn.disabled = false; }
    } catch {
        alert('Network error.');
        btn.disabled = false;
    }
}

// ── Subscribers ───────────────────────────────────────────────────────────
async function loadSubscribers() {
    const list = document.getElementById('subscribers-list');
    list.innerHTML = '<p style="color:#6b7280;font-size:0.85rem;">Loading...</p>';

    try {
        const res  = await fetch('/api/admin/subscribers', {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });

        if (res.status === 401) { logout(); return; }

        const subs = await res.json();

        if (subs.length === 0) {
            list.innerHTML = '<p style="color:#6b7280;font-size:0.85rem;">No subscribers yet.</p>';
            return;
        }

        const labels = { instant: 'Everything new', weekly: 'Weekly digest', monthly: 'Monthly digest' };

        // Unsubscribed people are kept on record but sorted below the active
        // list, so the badge counts reflect who is actually being emailed.
        const active = subs.filter(s => !s.unsubscribed);
        const gone   = subs.filter(s =>  s.unsubscribed);

        updateBadge('subscribers-count-badge', active.length, true);
        updateBadge('sb-subscribers', active.length, true);

        list.innerHTML = '';

        active.forEach(sub => {
            const row = document.createElement('div');
            row.className = 'entry-row';
            row.innerHTML = `
                <div class="entry-row-info">
                    <span class="entry-row-title">${escapeHtml(sub.email)}</span>
                    <span class="entry-row-meta">${labels[sub.frequency] || sub.frequency} &middot; Since ${sub.subscribedDate || '—'}</span>
                </div>
                <button class="entry-row-delete" onclick="deleteSubscriber('${escapeHtml(sub.token)}', this)">Remove</button>
            `;
            list.appendChild(row);
        });

        if (gone.length) {
            const heading = document.createElement('p');
            heading.style.cssText = 'margin:1.5rem 0 0.5rem;font-size:0.8rem;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.04em;';
            heading.textContent = `Unsubscribed (${gone.length})`;
            list.appendChild(heading);

            gone.forEach(sub => {
                const when = sub.unsubscribedDate ? sub.unsubscribedDate.split('T')[0] : '—';
                const row  = document.createElement('div');
                row.className = 'entry-row';
                row.style.opacity = '0.55';
                row.innerHTML = `
                    <div class="entry-row-info">
                        <span class="entry-row-title">${escapeHtml(sub.email)}</span>
                        <span class="entry-row-meta">Unsubscribed ${when} &middot; was ${labels[sub.frequency] || sub.frequency}</span>
                    </div>
                    <button class="entry-row-delete" onclick="deleteSubscriber('${escapeHtml(sub.token)}', this)">Delete</button>
                `;
                list.appendChild(row);
            });
        }
    } catch {
        list.innerHTML = '<p style="color:#991b1b;font-size:0.85rem;">Failed to load subscribers.</p>';
    }
}

async function deleteSubscriber(token, btn) {
    if (!confirm('Remove this subscriber?')) return;
    btn.disabled = true;

    try {
        const res = await fetch(`/api/admin/subscribers/${encodeURIComponent(token)}`, {
            method:  'DELETE',
            headers: { 'Authorization': `Bearer ${authToken}` }
        });

        if (res.status === 401) { logout(); return; }
        if (res.ok) loadSubscribers();
        else { alert('Failed to remove subscriber.'); btn.disabled = false; }
    } catch {
        alert('Network error.');
        btn.disabled = false;
    }
}

// ── Gotchas ───────────────────────────────────────────────────────────────
async function submitGotcha(event) {
    event.preventDefault();
    const btn      = document.getElementById('gotcha-submit-btn');
    const status   = document.getElementById('gotcha-status');
    const issue    = document.getElementById('gotcha-issue').value.trim();
    const workaround = document.getElementById('gotcha-workaround').value.trim();

    if (!issue || !workaround) {
        status.className   = 'status error';
        status.textContent = 'Please fill in both fields.';
        return;
    }

    btn.disabled       = true;
    status.className   = 'status loading';
    status.textContent = 'Saving...';

    try {
        const res = await fetch('/api/gotchas', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
            body:    JSON.stringify({ issue, workaround })
        });

        if (res.status === 401) { logout(); return; }

        if (res.ok) {
            status.className   = 'status success';
            status.textContent = 'Known issue added.';
            document.getElementById('gotcha-form').reset();
            loadGotchas();
        } else {
            status.className   = 'status error';
            status.textContent = 'Failed to save — please try again.';
        }
    } catch {
        status.className   = 'status error';
        status.textContent = 'Network error.';
    } finally {
        btn.disabled = false;
    }
}

async function loadGotchas() {
    const list = document.getElementById('gotchas-list');
    list.innerHTML = '<p style="color:#6b7280;font-size:0.85rem;">Loading...</p>';

    try {
        const res = await fetch('/api/gotchas/all', {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });

        if (res.status === 401) { logout(); return; }

        const gotchas = await res.json();

        if (gotchas.length === 0) {
            list.innerHTML = '<p style="color:#6b7280;font-size:0.85rem;">No known issues yet.</p>';
            return;
        }

        list.innerHTML = '';

        const pending  = gotchas.map((g, i) => ({ ...g, _idx: i })).filter(g => g.status === 'pending');
        const approved = gotchas.map((g, i) => ({ ...g, _idx: i })).filter(g => g.status !== 'pending');

        updateBadge('issues-pending-badge', pending.length, pending.length > 0);
        updateBadge('sb-issues-pending', pending.length, pending.length > 0);

        if (pending.length > 0) {
            const heading = document.createElement('p');
            heading.style.cssText = 'font-size:0.78rem;font-weight:700;color:#92400e;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:0.5rem;margin-top:0.25rem;';
            heading.textContent   = `Pending approval (${pending.length})`;
            list.appendChild(heading);

            pending.forEach(g => {
                const row = document.createElement('div');
                row.className = 'entry-row';
                row.style.cssText = 'border-left:3px solid #f97316;padding-left:0.6rem;background:#fff7ed;';
                row.innerHTML = `
                    <div class="entry-row-info">
                        <span class="entry-row-title">${escapeHtml(g.issue)}</span>
                        <span class="entry-row-meta">${escapeHtml(g.workaround)}</span>
                        ${g.submittedBy ? `<span class="entry-row-meta" style="color:#92400e;">Submitted by: ${escapeHtml(g.submittedBy)}</span>` : ''}
                    </div>
                    <div class="entry-row-actions">
                        <button class="entry-row-approve" onclick="approveGotcha(${g._idx}, this)">Approve</button>
                        <button class="entry-row-delete"  onclick="deleteGotcha(${g._idx}, this)">Reject</button>
                    </div>
                `;
                list.appendChild(row);
            });
        }

        if (approved.length > 0) {
            if (pending.length > 0) {
                const divider = document.createElement('p');
                divider.style.cssText = 'font-size:0.78rem;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:0.5rem;margin-top:1rem;';
                divider.textContent   = 'Live';
                list.appendChild(divider);
            }

            approved.forEach(g => {
                const row = document.createElement('div');
                row.className = 'entry-row';
                row.innerHTML = `
                    <div class="entry-row-info">
                        <span class="entry-row-title">${escapeHtml(g.issue)}</span>
                        <span class="entry-row-meta">${escapeHtml(g.workaround)}</span>
                        ${g.submittedBy ? `<span class="entry-row-meta" style="color:#6b7280;">Submitted by: ${escapeHtml(g.submittedBy)}</span>` : ''}
                    </div>
                    <button class="entry-row-delete" onclick="deleteGotcha(${g._idx}, this)">Delete</button>
                `;
                list.appendChild(row);
            });
        }
    } catch {
        list.innerHTML = '<p style="color:#991b1b;font-size:0.85rem;">Failed to load known issues.</p>';
    }
}

async function approveGotcha(idx, btn) {
    btn.disabled = true;

    try {
        const res = await fetch(`/api/gotchas/${idx}/approve`, {
            method:  'PUT',
            headers: { 'Authorization': `Bearer ${authToken}` }
        });

        if (res.status === 401) { logout(); return; }
        if (res.ok) loadGotchas();
        else { alert('Failed to approve.'); btn.disabled = false; }
    } catch {
        alert('Network error.');
        btn.disabled = false;
    }
}

async function deleteGotcha(idx, btn) {
    if (!confirm('Delete this known issue?')) return;
    btn.disabled = true;

    try {
        const res = await fetch(`/api/gotchas/${idx}`, {
            method:  'DELETE',
            headers: { 'Authorization': `Bearer ${authToken}` }
        });

        if (res.status === 401) { logout(); return; }
        if (res.ok) loadGotchas();
        else { alert('Failed to delete.'); btn.disabled = false; }
    } catch {
        alert('Network error.');
        btn.disabled = false;
    }
}

// ── Analytics ─────────────────────────────────────────────────────────────
// Anonymous usage counts collected by track.js on the public pages; the
// server sums them for the chosen period (see /api/admin/analytics).
let analyticsDays = 30;

async function loadAnalytics(days) {
    if (days) analyticsDays = days;
    document.querySelectorAll('.an-range button').forEach(b =>
        b.classList.toggle('active', Number(b.dataset.days) === analyticsDays));
    const body = document.getElementById('analytics-body');

    try {
        const res = await fetch(`/api/admin/analytics?days=${analyticsDays}`, { headers: { 'Authorization': `Bearer ${authToken}` } });
        if (res.status === 401) { logout(); return; }
        if (!res.ok) throw new Error(res.status);
        renderAnalytics(await res.json());
    } catch {
        body.innerHTML = '<p class="an-empty" style="color:#991b1b;">Couldn\'t load analytics — please try again.</p>';
    }
}

function renderAnalytics(a) {
    const body = document.getElementById('analytics-body');
    const fmt  = n => Number(n || 0).toLocaleString('en-GB');
    const day  = d => new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

    if (!a.totals.views) {
        body.innerHTML = `<p class="an-empty">No visits recorded in the last ${a.days} days yet. Numbers start appearing as soon as people use the dashboard.</p>`;
        return;
    }

    const tile = (value, label, hint) => `
        <div class="an-tile">
            <div class="an-tile-value">${fmt(value)}</div>
            <div class="an-tile-label">${label}</div>
            ${hint ? `<div class="an-tile-hint">${hint}</div>` : ''}
        </div>`;

    // Ranked list with a bar scaled to the top item.
    const list = (items, empty) => {
        if (!items.length) return `<p class="an-empty">${empty}</p>`;
        const max = items[0].count || 1;
        return `<ul class="an-list">${items.map(i => `
            <li>
                <div class="an-row-top">
                    <span class="an-row-label" title="${escapeHtml(i.label)}">${escapeHtml(i.label)}</span>
                    <span class="an-row-count">${fmt(i.count)}</span>
                </div>
                <div class="an-bar"><span style="width:${Math.max(3, Math.round(i.count / max * 100))}%"></span></div>
            </li>`).join('')}</ul>`;
    };
    const card = (title, sub, inner, warn) => `
        <div class="an-card${warn ? ' an-card--warn' : ''}">
            <h3>${title}</h3>
            <p class="an-card-sub">${sub}</p>
            ${inner}
        </div>`;

    const peak = Math.max(1, ...a.daily.map(d => d.views));
    const chart = `
        <div class="an-chart">${a.daily.map(d => `
            <div class="an-col" title="${day(d.date)}: ${fmt(d.visitors)} visitor${d.visitors === 1 ? '' : 's'}, ${fmt(d.views)} page view${d.views === 1 ? '' : 's'}">
                <div class="an-col-views"    style="height:${d.views / peak * 100}%"></div>
                <div class="an-col-visitors" style="height:${d.visitors / peak * 100}%"></div>
            </div>`).join('')}
        </div>
        <div class="an-axis"><span>${day(a.from)}</span><span>${day(a.to)}</span></div>
        <div class="an-legend"><span class="lg-visitors">Visitors</span><span class="lg-views">Page views</span></div>`;

    const PAGE_NAMES = { '/': 'Dashboard', '/index.html': 'Dashboard', '/product-updates': 'Product Updates',
                         '/product-updates.html': 'Product Updates', '/visit': 'Visitor sign-in', '/visit.html': 'Visitor sign-in' };
    const pages = Object.values(a.pages.reduce((acc, p) => {
        const name = PAGE_NAMES[p.label] || p.label;
        acc[name] = acc[name] || { label: name, count: 0 };
        acc[name].count += p.count;
        return acc;
    }, {})).sort((x, y) => y.count - x.count);
    const devices = a.devices.map(d => ({ label: d.label === 'mobile' ? 'Phone / tablet' : 'Desktop', count: d.count }));

    const actions = a.actions.length ? `
        <table class="an-table">
            <thead><tr><th>Button</th><th class="num">Clicked</th><th class="num">Sent</th></tr></thead>
            <tbody>${a.actions.map(r => `
                <tr>
                    <td>${escapeHtml(r.label)}</td>
                    <td class="num">${fmt(r.clicked)}</td>
                    <td class="num">${fmt(r.sent)}${r.clicked && r.sent ? ` <span class="an-rate">(${Math.round(r.sent / r.clicked * 100)}%)</span>` : ''}</td>
                </tr>`).join('')}
            </tbody>
        </table>` : '<p class="an-empty">No buttons used yet.</p>';

    body.innerHTML = `
        <div class="an-tiles">
            ${tile(a.totals.visitors,      'Visitors',        'approximate: different people per day')}
            ${tile(a.totals.views,         'Page views')}
            ${tile(a.totals.reportsOpened, 'Reports & decks opened')}
            ${tile(a.totals.searches,      'Searches')}
            ${tile(a.totals.formsSent,     'Forms sent',      'requests, reports, sign-ups')}
        </div>

        ${card('Visits per day', `Last ${a.days} days. Hover a day for its numbers.`, chart)}

        <div class="an-grid">
            ${card('Most opened reports', 'Full Report and Front Page clicks', list(a.reports, 'No reports opened yet.'))}
            ${card('Most viewed product decks', 'View Deck clicks on Product Updates', list(a.decks, 'No decks opened yet.'))}
            ${card('What people search for', 'Searches that found something', list(a.searches, 'No searches yet.'))}
            ${card('Searches that found nothing', 'Worth a look: things people expected to find', list(a.searchesNone, 'Every search found something.'), true)}
            ${card('Filters used', 'Dropdown choices on the dashboard', list(a.filters, 'No filters used yet.'))}
            ${card('Buttons and forms', 'How many opened a form vs actually sent it', actions)}
            ${card('Pages', 'Page views per page', list(pages, 'No page views yet.'))}
            ${card('Devices', 'Phone vs desktop visits', list(devices, 'No visits yet.'))}
        </div>`;
}

// ── Section navigation ────────────────────────────────────────────────────
const SECTIONS = ['section-reports', 'section-updates', 'section-requests', 'section-accesslog', 'section-analytics', 'section-subscribers', 'section-issues'];

function navigateTo(id) {
    SECTIONS.forEach(sid => document.getElementById(sid).classList.add('hidden'));
    document.getElementById(id).classList.remove('hidden');

    document.querySelectorAll('.sidebar-item').forEach(el => el.classList.remove('active'));
    const navEl = document.getElementById('nav-' + id.replace('section-', ''));
    if (navEl) navEl.classList.add('active');

    localStorage.setItem('poc-admin-active-section', id);
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Opens or closes the add form on the Reports / Product Updates tabs.
// kind is 'report' or 'update'; pass open to force a state, or omit to toggle.
const ADD_PANEL_LABELS = { report: '+ New report', update: '+ New product update' };

function toggleAddPanel(kind, open) {
    const panel = document.getElementById(`${kind}-add-panel`);
    const btn   = document.getElementById(`new-${kind}-btn`);
    if (open === undefined) open = panel.classList.contains('hidden');
    panel.classList.toggle('hidden', !open);
    btn.setAttribute('aria-expanded', String(open));
    btn.textContent = open ? 'Close form' : ADD_PANEL_LABELS[kind];
    if (open) {
        // Fresh form each time it opens, so an earlier "added" message doesn't linger.
        const status = panel.querySelector('.status');
        if (status) { status.className = 'status'; status.textContent = ''; }
        panel.querySelector('input, select, textarea').focus();
    }
}

function updateBadge(id, count, show) {
    const el = document.getElementById(id);
    if (!el) return;
    if (show && count > 0) { el.textContent = count; el.style.display = ''; }
    else { el.style.display = 'none'; }
}

// ── Init ──────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('date').value = new Date().toISOString().split('T')[0];
    document.getElementById('login-form').addEventListener('submit', login);
    document.getElementById('entry-form').addEventListener('submit', submitEntry);
    document.getElementById('update-form').addEventListener('submit', submitUpdate);
    document.getElementById('update-meetingDate').value = new Date().toISOString().split('T')[0];
    document.getElementById('gotcha-form').addEventListener('submit', submitGotcha);

    if (authToken) {
        showAdminForm();
    } else {
        showLoginForm();
    }
});
