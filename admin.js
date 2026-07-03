let authToken      = localStorage.getItem('poc-admin-token');
let currentEntries = [];

// ── Visibility helpers ────────────────────────────────────────────────────
function showLoginForm() {
    document.getElementById('login-section').classList.remove('hidden');
    document.getElementById('admin-form-section').classList.add('hidden');
    document.getElementById('admin-password').focus();
}

function showAdminForm() {
    document.getElementById('login-section').classList.add('hidden');
    document.getElementById('admin-form-section').classList.remove('hidden');
    loadEntries();
    loadSubscribers();
    loadGotchas();
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
            body: JSON.stringify(entry)
        });

        if (res.status === 401) {
            logout();
            status.className   = 'status error';
            status.textContent = 'Session expired — please log in again.';
            return;
        }

        if (res.ok) {
            status.className   = 'status success';
            status.textContent = `"${entry.title}" added to catalogue.`;
            document.getElementById('entry-form').reset();
            document.getElementById('date').value = new Date().toISOString().split('T')[0];
            loadEntries();
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

        const labels = { instant: 'Every new report', weekly: 'Weekly digest', monthly: 'Monthly digest' };

        list.innerHTML = '';
        subs.forEach((sub, idx) => {
            const row = document.createElement('div');
            row.className = 'entry-row';
            row.innerHTML = `
                <div class="entry-row-info">
                    <span class="entry-row-title">${escapeHtml(sub.email)}</span>
                    <span class="entry-row-meta">${labels[sub.frequency] || sub.frequency} &middot; Since ${sub.subscribedDate || '—'}</span>
                </div>
                <button class="entry-row-delete" onclick="deleteSubscriber(${idx}, this)">Remove</button>
            `;
            list.appendChild(row);
        });
    } catch {
        list.innerHTML = '<p style="color:#991b1b;font-size:0.85rem;">Failed to load subscribers.</p>';
    }
}

async function deleteSubscriber(idx, btn) {
    if (!confirm('Remove this subscriber?')) return;
    btn.disabled = true;

    try {
        const res = await fetch(`/api/admin/subscribers/${idx}`, {
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

// ── Init ──────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('date').value = new Date().toISOString().split('T')[0];
    document.getElementById('login-form').addEventListener('submit', login);
    document.getElementById('entry-form').addEventListener('submit', submitEntry);
    document.getElementById('gotcha-form').addEventListener('submit', submitGotcha);

    if (authToken) {
        showAdminForm();
    } else {
        showLoginForm();
    }
});
