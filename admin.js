const STORAGE_KEY = 'poc-lab-gh-settings';

// ── Settings panel ──────────────────────────────────────────────────────────

const settingsToggle = document.getElementById('settings-toggle');
const settingsBody   = document.getElementById('settings-body');
const settingsSaved  = document.getElementById('settings-saved');

settingsToggle.addEventListener('click', () => {
    const isOpen = settingsBody.classList.toggle('open');
    settingsToggle.classList.toggle('open', isOpen);
});

function loadSettings() {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    if (saved.owner) document.getElementById('gh-owner').value = saved.owner;
    if (saved.repo)  document.getElementById('gh-repo').value  = saved.repo;
    if (saved.token) document.getElementById('gh-token').value = saved.token;

    const hasSettings = saved.owner && saved.repo && saved.token;
    if (!hasSettings) {
        settingsBody.classList.add('open');
        settingsToggle.classList.add('open');
    } else {
        settingsSaved.style.opacity = '1';
    }
}

document.getElementById('save-settings').addEventListener('click', () => {
    const owner = document.getElementById('gh-owner').value.trim();
    const repo  = document.getElementById('gh-repo').value.trim();
    const token = document.getElementById('gh-token').value.trim();

    if (!owner || !repo || !token) {
        showStatus('Please fill in all three GitHub settings fields.', 'error');
        return;
    }

    localStorage.setItem(STORAGE_KEY, JSON.stringify({ owner, repo, token }));
    settingsSaved.style.opacity = '1';
    settingsBody.classList.remove('open');
    settingsToggle.classList.remove('open');
    showStatus('GitHub settings saved.', 'success');
});

// ── Status helper ───────────────────────────────────────────────────────────

function showStatus(message, type) {
    const el = document.getElementById('status');
    el.textContent = message;
    el.className = `status ${type}`;
}

function clearStatus() {
    const el = document.getElementById('status');
    el.className = 'status';
    el.textContent = '';
}

// ── GitHub API ───────────────────────────────────────────────────────────────

async function fetchCurrentData(owner, repo, token) {
    const res = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/contents/data.json`,
        { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' } }
    );

    if (res.status === 401) throw new Error('Invalid token. Check your GitHub Personal Access Token in Settings.');
    if (res.status === 404) throw new Error('Repository or data.json not found. Check your username and repo name in Settings.');
    if (!res.ok) throw new Error(`GitHub API error: ${res.status}`);

    const file = await res.json();
    const content = atob(file.content.replace(/\n/g, ''));
    return { data: JSON.parse(content), sha: file.sha };
}

async function pushUpdatedData(owner, repo, token, data, sha, title) {
    const content = btoa(unescape(encodeURIComponent(JSON.stringify(data, null, 2))));

    const res = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/contents/data.json`,
        {
            method: 'PUT',
            headers: {
                Authorization: `Bearer ${token}`,
                Accept: 'application/vnd.github+json',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                message: `Add entry: ${title}`,
                content,
                sha
            })
        }
    );

    if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || `Push failed: ${res.status}`);
    }
}

// ── Form submission ──────────────────────────────────────────────────────────

document.getElementById('entry-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    clearStatus();

    const settings = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    if (!settings.owner || !settings.repo || !settings.token) {
        showStatus('GitHub settings are not configured. Open the Settings panel above and save your details first.', 'error');
        settingsBody.classList.add('open');
        settingsToggle.classList.add('open');
        return;
    }

    const title = document.getElementById('title').value.trim();
    if (!title) { showStatus('Title is required.', 'error'); return; }

    const newEntry = {
        title,
        manufacturer:    document.getElementById('manufacturer').value.trim(),
        productName:     document.getElementById('productName').value.trim(),
        productCategory: document.getElementById('productCategory').value.trim(),
        testType:        document.getElementById('testType').value,
        date:            document.getElementById('date').value,
        summary:         document.getElementById('summary').value.trim(),
        frontPageDoc:    document.getElementById('frontPageDoc').value.trim() || null,
        fullReport:      document.getElementById('fullReport').value.trim() || null,
        tags:            document.getElementById('tags').value
                            .split(',')
                            .map(t => t.trim())
                            .filter(Boolean)
    };

    const submitBtn = document.getElementById('submit-btn');
    submitBtn.disabled = true;
    showStatus('Submitting to GitHub…', 'loading');

    try {
        const { data, sha } = await fetchCurrentData(settings.owner, settings.repo, settings.token);
        data.unshift(newEntry);
        await pushUpdatedData(settings.owner, settings.repo, settings.token, data, sha, title);

        showStatus(`"${title}" has been added. The catalog will update in about 60 seconds.`, 'success');
        document.getElementById('entry-form').reset();

    } catch (err) {
        showStatus(err.message, 'error');
    } finally {
        submitBtn.disabled = false;
    }
});

// ── Init ─────────────────────────────────────────────────────────────────────

loadSettings();

// Default date to today
const today = new Date().toISOString().split('T')[0];
document.getElementById('date').value = today;
