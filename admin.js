let authToken = localStorage.getItem('poc-admin-token');

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
        status.className     = 'status error';
        status.textContent   = 'Please fill in all required fields.';
        return;
    }

    btn.disabled           = true;
    status.className       = 'status loading';
    status.textContent     = 'Saving...';

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
        const res     = await fetch('/api/entries');
        const entries = await res.json();

        if (entries.length === 0) {
            list.innerHTML = '<p style="color:#6b7280;font-size:0.85rem;">No entries yet.</p>';
            return;
        }

        list.innerHTML = '';
        entries.forEach((entry, idx) => {
            const row = document.createElement('div');
            row.className = 'entry-row';
            row.innerHTML = `
                <div class="entry-row-info">
                    <span class="entry-row-title">${entry.title}</span>
                    <span class="entry-row-meta">${entry.manufacturer} &middot; ${entry.testType} &middot; ${entry.date}</span>
                </div>
                <button class="entry-row-delete" onclick="deleteEntry(${idx}, this)">Delete</button>
            `;
            list.appendChild(row);
        });
    } catch {
        list.innerHTML = '<p style="color:#991b1b;font-size:0.85rem;">Failed to load entries.</p>';
    }
}

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

// ── Init ──────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('date').value = new Date().toISOString().split('T')[0];
    document.getElementById('login-form').addEventListener('submit', login);
    document.getElementById('entry-form').addEventListener('submit', submitEntry);

    if (authToken) {
        showAdminForm();
    } else {
        showLoginForm();
    }
});
