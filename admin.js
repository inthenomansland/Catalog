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
    restoreSectionStates();
    loadEntries();
    loadRequests();
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

// ── Requests ──────────────────────────────────────────────────────────────
async function loadRequests() {
    const list = document.getElementById('requests-list');
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

        const pending  = requests.map((r, i) => ({ ...r, _idx: i })).filter(r => r.status === 'pending');
        const reviewed = requests.map((r, i) => ({ ...r, _idx: i })).filter(r => r.status !== 'pending');

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

        if (reviewed.length > 0) {
            if (pending.length > 0) {
                const d = document.createElement('p');
                d.style.cssText = 'font-size:0.78rem;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:0.5rem;margin-top:1rem;';
                d.textContent   = 'Reviewed';
                list.appendChild(d);
            }
            reviewed.forEach(r => list.appendChild(buildRequestRow(r, false)));
        }
    } catch {
        list.innerHTML = '<p style="color:#991b1b;font-size:0.85rem;">Failed to load requests.</p>';
    }
}

function buildRequestRow(r, isPending) {
    const wrap = document.createElement('div');
    wrap.id    = `request-row-${r._idx}`;

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

    wrap.innerHTML = `
        <div class="entry-row">
            <div class="entry-row-info">
                <span class="entry-row-title">${badge}${escapeHtml(r.jobName)}</span>
                <span class="entry-row-meta">${escapeHtml(r.submitterName)} · Submitted ${r.submittedDate || '—'}</span>
                ${dateRange}
            </div>
            <div class="entry-row-actions">
                <button class="entry-row-edit" onclick="toggleRequestDetail(${r._idx})">Details</button>
                ${isPending ? `<button class="entry-row-approve" onclick="approveRequest(${r._idx}, this)">Approve</button>
                <button class="entry-row-delete"  onclick="deleteRequest(${r._idx}, this)">Decline</button>` : `<button class="entry-row-delete" onclick="deleteRequest(${r._idx}, this)">Delete</button>`}
            </div>
        </div>
        <div id="request-detail-${r._idx}" class="hidden" style="background:#f8fafc;border:1px solid #e1e4e8;border-left:3px solid #6DC52D;border-radius:8px;padding:1.1rem;margin:0.25rem 0 0.5rem;">
            ${r.submitterEmail ? `<p style="font-size:0.82rem;margin-bottom:0.6rem;"><strong>Email:</strong> ${escapeHtml(r.submitterEmail)}</p>` : ''}
            ${r.persons        ? `<p style="font-size:0.82rem;margin-bottom:0.75rem;"><strong>Persons:</strong> ${escapeHtml(r.persons)}</p>` : ''}
            ${r.scope    ? `<div style="margin-bottom:0.75rem;"><p style="font-size:0.75rem;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.04em;margin-bottom:0.25rem;">Scope</p><p style="font-size:0.82rem;line-height:1.6;white-space:pre-wrap;">${escapeHtml(r.scope)}</p></div>` : ''}
            ${r.outcomes ? `<div style="margin-bottom:0.75rem;"><p style="font-size:0.75rem;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.04em;margin-bottom:0.25rem;">Expected outcomes</p><p style="font-size:0.82rem;line-height:1.6;white-space:pre-wrap;">${escapeHtml(r.outcomes)}</p></div>` : ''}
            ${r.kit      ? `<div><p style="font-size:0.75rem;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.04em;margin-bottom:0.25rem;">Kit / equipment required</p><p style="font-size:0.82rem;line-height:1.6;white-space:pre-wrap;">${escapeHtml(r.kit)}</p></div>` : ''}
        </div>
    `;
    return wrap;
}

function toggleRequestDetail(idx) {
    const detail = document.getElementById(`request-detail-${idx}`);
    const btn    = document.querySelector(`#request-row-${idx} .entry-row-edit`);
    const isNowHidden = detail.classList.toggle('hidden');
    btn.textContent   = isNowHidden ? 'Details' : 'Close';
}

async function approveRequest(idx, btn) {
    btn.disabled = true;
    try {
        const res = await fetch(`/api/requests/${idx}/approve`, {
            method:  'PUT',
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        if (res.status === 401) { logout(); return; }
        if (res.ok) loadRequests();
        else { alert('Failed to approve.'); btn.disabled = false; }
    } catch {
        alert('Network error.');
        btn.disabled = false;
    }
}

async function deleteRequest(idx, btn) {
    if (!confirm('Delete this request? This cannot be undone.')) return;
    btn.disabled = true;
    try {
        const res = await fetch(`/api/requests/${idx}`, {
            method:  'DELETE',
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        if (res.status === 401) { logout(); return; }
        if (res.ok) loadRequests();
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

        const labels = { instant: 'Every new report', weekly: 'Weekly digest', monthly: 'Monthly digest' };

        updateBadge('subscribers-count-badge', subs.length, true);
        updateBadge('sb-subscribers', subs.length, true);

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

// ── Section collapse & sidebar ────────────────────────────────────────────
function toggleSection(id) {
    const card   = document.getElementById(id);
    const body   = card.querySelector('.section-body');
    const toggle = card.querySelector('.section-toggle');
    const nowCollapsed = body.classList.toggle('collapsed');
    toggle.classList.toggle('collapsed', nowCollapsed);

    const state = JSON.parse(localStorage.getItem('poc-admin-sections') || '{}');
    state[id]   = nowCollapsed ? 'collapsed' : 'expanded';
    localStorage.setItem('poc-admin-sections', JSON.stringify(state));
}

function restoreSectionStates() {
    const state = JSON.parse(localStorage.getItem('poc-admin-sections') || '{}');
    Object.entries(state).forEach(([id, s]) => {
        const card = document.getElementById(id);
        if (!card || s !== 'collapsed') return;
        card.querySelector('.section-body')?.classList.add('collapsed');
        card.querySelector('.section-toggle')?.classList.add('collapsed');
    });
}

function scrollToSection(id) {
    const card = document.getElementById(id);
    if (!card) return;
    if (card.querySelector('.section-body').classList.contains('collapsed')) toggleSection(id);
    setTimeout(() => card.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);

    document.querySelectorAll('.sidebar-item').forEach(el => el.classList.remove('active'));
    const navEl = document.getElementById('nav-' + id.replace('section-', ''));
    if (navEl) navEl.classList.add('active');
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
    document.getElementById('gotcha-form').addEventListener('submit', submitGotcha);

    if (authToken) {
        showAdminForm();
    } else {
        showLoginForm();
    }
});
