const express    = require('express');
const fs         = require('fs');
const path       = require('path');
const jwt        = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const crypto     = require('crypto');
const rateLimit  = require('express-rate-limit');

const app = express();
app.use(express.json());

// Security headers
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=(), payment=()');
    res.setHeader('Content-Security-Policy',
        "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self';"
    );
    next();
});

// Rate limiter for public submission endpoints
const submitLimiter = rateLimit({
    windowMs:        15 * 60 * 1000,
    max:             10,
    standardHeaders: true,
    legacyHeaders:   false,
    message:         { error: 'Too many submissions. Please try again in a few minutes.' },
});

// Serve frontend static files
app.use(express.static(path.join(__dirname, 'public')));

const DATA_DIR          = '/app/data';
const DATA_FILE         = path.join(DATA_DIR, 'data.json');
const DEFAULT_DATA      = path.join(__dirname, 'data-default.json');
const GOTCHAS_FILE      = path.join(DATA_DIR, 'gotchas.json');
const SUBSCRIBERS_FILE  = path.join(DATA_DIR, 'subscribers.json');
const DIGEST_STATE_FILE = path.join(DATA_DIR, 'digest-state.json');
const REQUESTS_FILE     = path.join(DATA_DIR, 'requests.json');
const SITE_URL          = 'https://poc-lab.av.proav.cloud';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const JWT_SECRET     = process.env.JWT_SECRET;

if (!ADMIN_PASSWORD) throw new Error('ADMIN_PASSWORD environment variable is required');
if (!JWT_SECRET)     throw new Error('JWT_SECRET environment variable is required');

// Bootstrap data volume on first run
if (!fs.existsSync(DATA_DIR))          fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(DATA_FILE))         { fs.copyFileSync(DEFAULT_DATA, DATA_FILE); console.log('Initialised data.json from bundled default'); }
if (!fs.existsSync(GOTCHAS_FILE))      fs.writeFileSync(GOTCHAS_FILE,     '[]', 'utf8');
if (!fs.existsSync(SUBSCRIBERS_FILE))  fs.writeFileSync(SUBSCRIBERS_FILE, '[]', 'utf8');
if (!fs.existsSync(DIGEST_STATE_FILE)) fs.writeFileSync(DIGEST_STATE_FILE, JSON.stringify({ lastWeekly: null, lastMonthly: null }), 'utf8');
if (!fs.existsSync(REQUESTS_FILE))     fs.writeFileSync(REQUESTS_FILE,     '[]', 'utf8');

function readData()             { return JSON.parse(fs.readFileSync(DATA_FILE,         'utf8')); }
function writeData(data)        { fs.writeFileSync(DATA_FILE,         JSON.stringify(data, null, 2), 'utf8'); }
function readGotchas()          { return JSON.parse(fs.readFileSync(GOTCHAS_FILE,      'utf8')); }
function writeGotchas(data)     { fs.writeFileSync(GOTCHAS_FILE,      JSON.stringify(data, null, 2), 'utf8'); }
function readSubscribers()      { return JSON.parse(fs.readFileSync(SUBSCRIBERS_FILE,  'utf8')); }
function writeSubscribers(data) { fs.writeFileSync(SUBSCRIBERS_FILE,  JSON.stringify(data, null, 2), 'utf8'); }
function readDigestState()      { return JSON.parse(fs.readFileSync(DIGEST_STATE_FILE, 'utf8')); }
function writeDigestState(data) { fs.writeFileSync(DIGEST_STATE_FILE, JSON.stringify(data, null, 2), 'utf8'); }
function readRequests()         { return JSON.parse(fs.readFileSync(REQUESTS_FILE,     'utf8')); }
function writeRequests(data)    { fs.writeFileSync(REQUESTS_FILE,     JSON.stringify(data, null, 2), 'utf8'); }

function generateToken() { return crypto.randomBytes(32).toString('hex'); }

function requireAuth(req, res, next) {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorised' });
    try {
        jwt.verify(auth.slice(7), JWT_SECRET);
        next();
    } catch {
        res.status(401).json({ error: 'Invalid or expired token' });
    }
}

function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Shared email helper ───────────────────────────────────────────────────
async function sendEmail({ to, subject, text, html }) {
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    if (!user || !pass) return;

    const transporter = nodemailer.createTransport({
        host:   process.env.SMTP_HOST || 'smtp.gmail.com',
        port:   587,
        secure: false,
        auth:   { user, pass },
    });

    try {
        await transporter.sendMail({
            from:    `"PoC Lab Notifications" <${process.env.SMTP_FROM || user}>`,
            to, subject, text,
            ...(html ? { html } : {}),
        });
        console.log(`Email sent to ${to}: ${subject}`);
    } catch (err) {
        console.error(`Failed to send email to ${to} (login: ${user}):`, err.message);
    }
}

// ── Request admin notification ────────────────────────────────────────────
async function notifyNewRequest(r) {
    const typeName = r.type === 'bench' ? 'Bench Test' : 'PoC';
    await sendEmail({
        to:      'poc.lab@proav.com',
        subject: `New ${typeName} Request: ${r.jobName || 'Untitled'} — PoC Lab`,
        text: [
            `A new ${typeName} request has been submitted and is awaiting your review.`,
            '',
            `Submitted by: ${r.submitterName}${r.submitterEmail ? ` (${r.submitterEmail})` : ''}`,
            `Job Name:     ${r.jobName   || '—'}`,
            `Start Date:   ${r.dateStart || '—'}`,
            `End Date:     ${r.dateEnd   || '—'}`,
            `Persons:      ${r.persons   || '—'}`,
            '',
            'Scope:',
            r.scope    || '—',
            '',
            'Expected Outcomes:',
            r.outcomes || '—',
            '',
            'Kit / Equipment Required:',
            r.kit      || '—',
            '',
            'Log in to the admin panel to review:',
            `${SITE_URL}/admin.html`,
        ].join('\n'),
    });
}

// Adds N working days (Mon–Fri) to a YYYY-MM-DD date string.
function addWorkingDays(dateStr, days) {
    const d = new Date(`${dateStr}T00:00:00Z`);
    let added = 0;
    while (added < days) {
        d.setUTCDate(d.getUTCDate() + 1);
        const day = d.getUTCDay();
        if (day !== 0 && day !== 6) added++;
    }
    return d.toISOString().split('T')[0];
}

// ── Shared HTML email chrome ──────────────────────────────────────────────
// Table-based layout with inline styles throughout — this is what keeps it
// rendering correctly in Outlook desktop, which ignores <style> blocks and
// most modern CSS. All notification emails share this same header/footer
// shell so they read as one consistent brand.
function emailShell({ heading, intro, bodyHtml, footerHtml }) {
    return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
</head>
<body style="margin:0;padding:0;background:#f4f6f2;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f2;padding:32px 16px;">
<tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border:1px solid #dde2d8;border-radius:10px;overflow:hidden;">

    <tr><td style="background:#0d0d0d;padding:22px 28px;border-bottom:4px solid #6DC52D;">
        <span style="font:700 18px/1 Segoe UI,Arial,sans-serif;color:#ffffff;">pro<span style="color:#6DC52D;">AV</span></span>
        <span style="font:400 12px/1 Segoe UI,Arial,sans-serif;color:#9aa2a0;margin-left:10px;">PoC Lab Dashboard</span>
    </td></tr>

    <tr><td style="padding:28px;">
        ${heading ? `<p style="margin:0 0 4px;font:700 20px/1.3 Segoe UI,Arial,sans-serif;color:#0d0d0d;">${heading}</p>` : ''}
        ${intro   ? `<p style="margin:0 0 22px;font:400 14px/1.6 Segoe UI,Arial,sans-serif;color:#667085;">${intro}</p>` : ''}
        ${bodyHtml}
    </td></tr>

    <tr><td style="padding:16px 28px;background:#f7f8f6;border-top:1px solid #eceff0;">
        ${footerHtml}
    </td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}

const emailFooterStandard = `
    <p style="margin:0;font:400 12px/1.6 Segoe UI,Arial,sans-serif;color:#9aa2a0;">
        proAV PoC Lab Team · <a href="${SITE_URL}" style="color:#9aa2a0;">${SITE_URL.replace(/^https?:\/\//, '')}</a>
    </p>`;

function emailFooterWithUnsubscribe(note, token) {
    return `
    <p style="margin:0 0 4px;font:400 12px/1.6 Segoe UI,Arial,sans-serif;color:#9aa2a0;">
        proAV PoC Lab Team · <a href="${SITE_URL}" style="color:#9aa2a0;">${SITE_URL.replace(/^https?:\/\//, '')}</a>
    </p>
    <p style="margin:0;font:400 11px/1.6 Segoe UI,Arial,sans-serif;color:#b7bdb5;">
        ${note} <a href="${SITE_URL}/?unsubscribe=${token}" style="color:#9aa2a0;">Unsubscribe</a>
    </p>`;
}

// A single report as a compact branded card — reused by the instant and
// digest subscriber emails. Test-type colours match the badges on the
// live dashboard (Kit blue, Program green, Concept purple).
function renderReportCardHtml(entry, { truncate } = {}) {
    const typeColors = {
        Kit:     { bg: '#dbeafe', fg: '#1d4ed8' },
        Program: { bg: '#d1fae5', fg: '#065f46' },
        Concept: { bg: '#ede9fe', fg: '#5b21b6' },
    };
    const tc = typeColors[entry.testType] || { bg: '#e5e7eb', fg: '#374151' };
    const rawSummary = entry.summary || '';
    const summary = truncate && rawSummary.length > 150
        ? rawSummary.slice(0, 150) + '…'
        : rawSummary;

    return `
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #eceff0;border-radius:8px;margin-bottom:14px;">
            <tr><td style="padding:16px 18px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
                    <td style="font:700 15px/1.4 Segoe UI,Arial,sans-serif;color:#0d0d0d;">${escapeHtml(entry.title)}</td>
                    <td align="right" style="white-space:nowrap;padding-left:10px;">
                        <span style="display:inline-block;background:${tc.bg};color:${tc.fg};font:700 10px/1 Segoe UI,Arial,sans-serif;text-transform:uppercase;letter-spacing:.04em;padding:4px 9px;border-radius:99px;">${escapeHtml(entry.testType)}</span>
                    </td>
                </tr></table>
                <p style="margin:6px 0 10px;font:400 12px/1.6 Segoe UI,Arial,sans-serif;color:#9aa2a0;">
                    ${escapeHtml(entry.manufacturer || '—')} &middot; ${escapeHtml(entry.productName || '—')} &middot; ${escapeHtml(entry.date || '—')}
                </p>
                <p style="margin:0;font:400 13px/1.6 Segoe UI,Arial,sans-serif;color:#3f4650;">${escapeHtml(summary)}</p>
            </td></tr>
        </table>`;
}

function dashboardButtonHtml(label) {
    return `<a href="${SITE_URL}" style="display:inline-block;background:#0d0d0d;color:#ffffff;text-decoration:none;font:600 13px/1 Segoe UI,Arial,sans-serif;padding:10px 18px;border-radius:6px;margin-top:2px;">${escapeHtml(label)}</a>`;
}

// Builds the branded HTML version of the approval email.
function renderApprovalEmailHtml(r, typeName, dueDate) {
    const name     = escapeHtml(r.submitterName || 'there');
    const jobName  = escapeHtml(r.jobName   || '—');
    const dateStart= escapeHtml(r.dateStart || '—');
    const dateEnd  = escapeHtml(r.dateEnd   || '—');
    const persons  = escapeHtml(r.persons   || '—');

    const detailRow = (label, value) => `
        <tr>
            <td style="padding:7px 0;font:600 12px/1.4 Segoe UI,Arial,sans-serif;color:#6b7280;text-transform:uppercase;letter-spacing:.04em;width:120px;vertical-align:top;">${label}</td>
            <td style="padding:7px 0;font:400 14px/1.5 Segoe UI,Arial,sans-serif;color:#14171b;">${value}</td>
        </tr>`;

    const accessCodeBlock = r.accessCode ? `
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0;">
            <tr>
                <td style="background:#eef7e6;border-left:4px solid #6DC52D;border-radius:6px;padding:18px 20px;">
                    <p style="margin:0 0 6px;font:700 11px/1.4 Segoe UI,Arial,sans-serif;color:#2d6b0a;text-transform:uppercase;letter-spacing:.06em;">Your access code</p>
                    <p style="margin:0 0 8px;font:700 26px/1.2 'Courier New',Consolas,monospace;color:#0d0d0d;letter-spacing:.06em;">${escapeHtml(r.accessCode)}</p>
                    <p style="margin:0;font:400 13px/1.5 Segoe UI,Arial,sans-serif;color:#3f5c2a;">Please keep this safe — you'll need it to access the lab for your session.</p>
                </td>
            </tr>
        </table>` : '';

    const reportDueBlock = `
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
            <tr>
                <td style="background:#eaf3ff;border-left:4px solid #4d7fc4;border-radius:6px;padding:18px 20px;">
                    <p style="margin:0 0 6px;font:700 11px/1.4 Segoe UI,Arial,sans-serif;color:#1d4ed8;text-transform:uppercase;letter-spacing:.06em;">Report due</p>
                    <p style="margin:0 0 8px;font:400 14px/1.6 Segoe UI,Arial,sans-serif;color:#1e293b;">
                        A short report covering the outcome of your session is due within
                        <strong>5 working days</strong> of your session end date.
                        ${dueDate ? `That means your report is due by <strong>${escapeHtml(dueDate)}</strong>.` : ''}
                    </p>
                    ${dashboardButtonHtml('Submit Report on the Dashboard')}
                </td>
            </tr>
        </table>`;

    const bodyHtml = `
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #eceff0;border-bottom:1px solid #eceff0;margin-bottom:4px;">
            ${detailRow('Job Name',   jobName)}
            ${detailRow('Start Date', dateStart)}
            ${detailRow('End Date',   dateEnd)}
            ${detailRow('Persons',    persons)}
        </table>
        ${accessCodeBlock}
        ${accessCodeBlock ? '' : '<div style="height:24px;"></div>'}
        ${reportDueBlock}
        <p style="margin:0 0 4px;font:400 13px/1.6 Segoe UI,Arial,sans-serif;color:#667085;">
            Questions, or need to make changes? Get in touch with the lab team:
            <a href="mailto:poc.lab@proav.com" style="color:#4c9a1a;">poc.lab@proav.com</a>
        </p>`;

    return emailShell({
        heading:  'Request approved',
        intro:    `Hi ${name}, your ${escapeHtml(typeName)} request has been reviewed and approved by the PoC Lab team.`,
        bodyHtml,
        footerHtml: emailFooterStandard,
    });
}

// Branded HTML for the "new report published" instant notification.
function renderInstantEmailHtml(entry, sub) {
    const bodyHtml = `
        ${renderReportCardHtml(entry, { truncate: false })}
        ${dashboardButtonHtml('View on Dashboard')}`;

    return emailShell({
        heading: 'New report published',
        intro:   `A new ${escapeHtml(entry.testType)} report has just been added to the PoC Lab Research Catalogue.`,
        bodyHtml,
        footerHtml: emailFooterWithUnsubscribe(
            "You're receiving this because you subscribed to instant report notifications.",
            sub.token
        ),
    });
}

// Branded HTML for the weekly/monthly digest.
function renderDigestEmailHtml(entries, frequency, sub) {
    const period = frequency === 'weekly' ? 'this week' : 'this month';
    const bodyHtml = `
        ${entries.map(e => renderReportCardHtml(e, { truncate: true })).join('')}
        ${dashboardButtonHtml('View Full Catalogue')}`;

    return emailShell({
        heading: `${entries.length} new report${entries.length !== 1 ? 's' : ''} ${period}`,
        intro:   `Here's what's been added to the PoC Lab Research Catalogue ${period}.`,
        bodyHtml,
        footerHtml: emailFooterWithUnsubscribe(
            `You're receiving this ${frequency} digest because you subscribed to PoC Lab updates.`,
            sub.token
        ),
    });
}

// ── Request approval confirmation to submitter ────────────────────────────
async function notifyRequestApproved(r) {
    if (!r.submitterEmail) return;
    const typeName = r.type === 'bench' ? 'Bench Test' : 'PoC';
    const dueDate  = r.dateEnd ? addWorkingDays(r.dateEnd, 5) : null;

    const accessCodeLines = r.accessCode
        ? [
            '',
            `Your PoC Lab access code: ${r.accessCode}`,
            'Please keep this safe — you\'ll need it to access the lab for your session.',
          ]
        : [];

    const reportDueLines = [
        '',
        'A short report covering the outcome of your session is due within 5 working days of your session end date.',
        dueDate ? `For this session, that means your report is due by ${dueDate}.` : null,
        'You can submit it via the "Submit Report" button on the PoC Lab Dashboard.',
    ].filter(Boolean);

    await sendEmail({
        to:      r.submitterEmail,
        subject: `Your ${typeName} Request Has Been Approved — PoC Lab`,
        text: [
            `Hi ${r.submitterName || 'there'},`,
            '',
            `Your ${typeName} request has been reviewed and approved by the PoC Lab team.`,
            '',
            `Job Name:   ${r.jobName   || '—'}`,
            `Start Date: ${r.dateStart || '—'}`,
            `End Date:   ${r.dateEnd   || '—'}`,
            `Persons:    ${r.persons   || '—'}`,
            ...accessCodeLines,
            ...reportDueLines,
            '',
            'If you have any questions or need to make changes, please get in touch with the lab team:',
            'poc.lab@proav.com',
            '',
            'You can view the PoC Lab Dashboard here:',
            `${SITE_URL}`,
            '',
            '— proAV PoC Lab Team',
        ].join('\n'),
        html: renderApprovalEmailHtml(r, typeName, dueDate),
    });
}

// ── Known issue admin notification ───────────────────────────────────────
async function notifyNewKnownIssue(entry) {
    await sendEmail({
        to:      'poc.lab@proav.com',
        subject: 'New Known Issue Submitted — PoC Lab',
        text: [
            'A new Known Issue has been submitted and is awaiting your approval.',
            '',
            `Submitted by: ${entry.submittedBy}`,
            `Issue:        ${entry.issue}`,
            `Workaround:   ${entry.workaround}`,
            '',
            'Log in to the admin panel to approve or reject:',
            `${SITE_URL}/admin.html`,
        ].join('\n'),
    });
}

// ── Subscriber notifications ──────────────────────────────────────────────
async function notifyInstantSubscribers(entry) {
    const subscribers = readSubscribers().filter(s => s.frequency === 'instant');
    for (const sub of subscribers) {
        await sendEmail({
            to:      sub.email,
            subject: `New Report: ${entry.title} — PoC Lab`,
            text: [
                `A new ${entry.testType} report has been published on the PoC Lab Research Catalogue.`,
                '',
                `Title:        ${entry.title}`,
                `Manufacturer: ${entry.manufacturer}`,
                `Product:      ${entry.productName || '—'}`,
                `Category:     ${entry.productCategory || '—'}`,
                `Date:         ${entry.date}`,
                '',
                'Summary:',
                entry.summary,
                '',
                `View the catalogue: ${SITE_URL}`,
                '',
                `To unsubscribe: ${SITE_URL}/?unsubscribe=${sub.token}`,
            ].join('\n'),
            html: renderInstantEmailHtml(entry, sub),
        });
    }
}

async function sendDigest(frequency) {
    const subscribers = readSubscribers().filter(s => s.frequency === frequency);
    if (subscribers.length === 0) return;

    const state    = readDigestState();
    const sinceKey = frequency === 'weekly' ? 'lastWeekly' : 'lastMonthly';
    const since    = state[sinceKey];
    const period   = frequency === 'weekly' ? 'this week' : 'this month';

    const entries = readData().filter(e => !since || new Date(e.date) > new Date(since));
    if (entries.length === 0) {
        console.log(`No new entries for ${frequency} digest — skipping`);
        return;
    }

    const entryLines = entries.map(e => [
        `• ${e.title}`,
        `  ${e.manufacturer} | ${e.testType} | ${e.date}`,
        `  ${e.summary.substring(0, 150)}${e.summary.length > 150 ? '...' : ''}`,
    ].join('\n')).join('\n\n');

    const subject = `PoC Lab Digest — ${entries.length} new report${entries.length !== 1 ? 's' : ''} ${period}`;

    for (const sub of subscribers) {
        await sendEmail({
            to: sub.email,
            subject,
            text: [
                `Here's what's been added to the PoC Lab Research Catalogue ${period}:`,
                '',
                entryLines,
                '',
                `View the full catalogue: ${SITE_URL}`,
                '',
                `To unsubscribe: ${SITE_URL}/?unsubscribe=${sub.token}`,
            ].join('\n'),
            html: renderDigestEmailHtml(entries, frequency, sub),
        });
    }

    writeDigestState({ ...state, [sinceKey]: new Date().toISOString() });
    console.log(`${frequency} digest sent to ${subscribers.length} subscriber(s)`);
}

// ── Digest scheduler — checks every hour ──────────────────────────────────
function startDigestScheduler() {
    setInterval(() => {
        const now   = new Date();
        const day   = now.getDay();   // 0=Sun 1=Mon
        const date  = now.getDate();  // 1-31
        const hour  = now.getHours(); // 0-23 (UTC inside Docker)
        const state = readDigestState();

        // Weekly: Monday at 9am UTC
        if (day === 1 && hour === 9) {
            const last      = state.lastWeekly ? new Date(state.lastWeekly) : null;
            const daysSince = last ? (now - last) / 86400000 : 999;
            if (daysSince >= 6) sendDigest('weekly');
        }

        // Monthly: 1st of month at 9am UTC
        if (date === 1 && hour === 9) {
            const last      = state.lastMonthly ? new Date(state.lastMonthly) : null;
            const daysSince = last ? (now - last) / 86400000 : 999;
            if (daysSince >= 28) sendDigest('monthly');
        }
    }, 60 * 60 * 1000);
}

// ── Auth ──────────────────────────────────────────────────────────────────
app.post('/api/auth', (req, res) => {
    const { password } = req.body || {};
    if (!password || password !== ADMIN_PASSWORD) {
        return res.status(401).json({ error: 'Incorrect password' });
    }
    const token = jwt.sign({ admin: true }, JWT_SECRET, { expiresIn: '12h' });
    res.json({ token });
});

// ── Entries (public read) ─────────────────────────────────────────────────
app.get('/api/entries', (req, res) => {
    res.json(readData());
});

// ── Entries (admin write) ─────────────────────────────────────────────────
app.post('/api/entries', requireAuth, (req, res) => {
    const data = readData();
    data.unshift(req.body);
    writeData(data);
    res.status(201).json(req.body);
    notifyInstantSubscribers(req.body);
});

app.put('/api/entries/:index', requireAuth, (req, res) => {
    const idx  = parseInt(req.params.index, 10);
    const data = readData();
    if (isNaN(idx) || idx < 0 || idx >= data.length) return res.status(404).json({ error: 'Not found' });
    data[idx] = req.body;
    writeData(data);
    res.json(req.body);
});

app.delete('/api/entries/:index', requireAuth, (req, res) => {
    const idx  = parseInt(req.params.index, 10);
    const data = readData();
    if (isNaN(idx) || idx < 0 || idx >= data.length) return res.status(404).json({ error: 'Not found' });
    data.splice(idx, 1);
    writeData(data);
    res.status(204).send();
});

// ── Gotchas (public read — approved only, submitter name stripped) ────────
app.get('/api/gotchas', (req, res) => {
    const approved = readGotchas().filter(g => g.status !== 'pending');
    res.json(approved.map(({ submittedBy, ...rest }) => rest));
});

// ── Gotchas (admin read — all including pending) ──────────────────────────
app.get('/api/gotchas/all', requireAuth, (req, res) => {
    res.json(readGotchas());
});

// ── Gotchas (public suggest — lands as pending) ───────────────────────────
app.post('/api/gotchas/suggest', submitLimiter, async (req, res) => {
    if (req.body._hp) return res.status(200).json({ message: 'ok' });
    const { submittedBy, issue, workaround } = req.body || {};
    if (!submittedBy || !issue || !workaround) return res.status(400).json({ error: 'submittedBy, issue and workaround are required' });
    const data  = readGotchas();
    const entry = { submittedBy, issue, workaround, date: new Date().toISOString().split('T')[0], status: 'pending' };
    data.push(entry);
    writeGotchas(data);
    res.status(201).json(entry);
    notifyNewKnownIssue(entry);
});

// ── Gotchas (admin write — goes live immediately) ─────────────────────────
app.post('/api/gotchas', requireAuth, (req, res) => {
    const { issue, workaround } = req.body || {};
    if (!issue || !workaround) return res.status(400).json({ error: 'issue and workaround are required' });
    const data  = readGotchas();
    const entry = { issue, workaround, date: new Date().toISOString().split('T')[0], status: 'approved' };
    data.unshift(entry);
    writeGotchas(data);
    res.status(201).json(entry);
});

// ── Gotchas (admin approve pending) ──────────────────────────────────────
app.put('/api/gotchas/:index/approve', requireAuth, (req, res) => {
    const idx  = parseInt(req.params.index, 10);
    const data = readGotchas();
    if (isNaN(idx) || idx < 0 || idx >= data.length) return res.status(404).json({ error: 'Not found' });
    data[idx].status = 'approved';
    writeGotchas(data);
    res.json(data[idx]);
});

app.delete('/api/gotchas/:index', requireAuth, (req, res) => {
    const idx  = parseInt(req.params.index, 10);
    const data = readGotchas();
    if (isNaN(idx) || idx < 0 || idx >= data.length) return res.status(404).json({ error: 'Not found' });
    data.splice(idx, 1);
    writeGotchas(data);
    res.status(204).send();
});

// ── Subscriptions (public) ────────────────────────────────────────────────
app.post('/api/subscribe', submitLimiter, (req, res) => {
    if (req.body._hp) return res.status(200).json({ message: 'ok' });
    const { email, frequency } = req.body || {};
    if (!email || !frequency) return res.status(400).json({ error: 'email and frequency required' });
    if (!['instant', 'weekly', 'monthly'].includes(frequency)) return res.status(400).json({ error: 'invalid frequency' });

    const subs     = readSubscribers();
    const existing = subs.findIndex(s => s.email === email);
    if (existing !== -1) {
        subs[existing].frequency = frequency;
        writeSubscribers(subs);
        return res.json({ message: 'Subscription updated' });
    }

    subs.push({ email, frequency, token: generateToken(), subscribedDate: new Date().toISOString().split('T')[0] });
    writeSubscribers(subs);
    res.status(201).json({ message: 'Subscribed successfully' });
});

app.get('/api/unsubscribe', (req, res) => {
    const { token } = req.query;
    if (!token) return res.status(400).json({ error: 'token required' });

    const subs = readSubscribers();
    const idx  = subs.findIndex(s => s.token === token);
    if (idx === -1) return res.status(404).json({ error: 'Token not found' });

    subs.splice(idx, 1);
    writeSubscribers(subs);
    res.json({ message: 'Unsubscribed successfully' });
});

// ── Subscriptions (admin) ─────────────────────────────────────────────────
app.get('/api/admin/subscribers', requireAuth, (req, res) => {
    res.json(readSubscribers());
});

app.delete('/api/admin/subscribers/:index', requireAuth, (req, res) => {
    const idx  = parseInt(req.params.index, 10);
    const subs = readSubscribers();
    if (isNaN(idx) || idx < 0 || idx >= subs.length) return res.status(404).json({ error: 'Not found' });
    subs.splice(idx, 1);
    writeSubscribers(subs);
    res.status(204).send();
});

// ── Requests (public submit) ──────────────────────────────────────────────
app.post('/api/requests', submitLimiter, async (req, res) => {
    if (req.body._hp) return res.status(200).json({ message: 'ok' });
    const { type, submitterName, submitterEmail, jobName, scope, outcomes, kit, dateStart, dateEnd, persons } = req.body || {};
    if (!type || !['bench', 'poc'].includes(type)) return res.status(400).json({ error: 'type must be bench or poc' });
    if (!submitterName) return res.status(400).json({ error: 'submitterName is required' });
    if (!jobName)       return res.status(400).json({ error: 'jobName is required' });

    const requests = readRequests();
    const entry = {
        type, submitterName, submitterEmail: submitterEmail || null,
        jobName, scope: scope || null, outcomes: outcomes || null,
        kit: kit || null, dateStart: dateStart || null, dateEnd: dateEnd || null,
        persons: persons || null,
        submittedDate: new Date().toISOString().split('T')[0],
        status: 'pending',
    };
    requests.push(entry);
    writeRequests(requests);
    res.status(201).json(entry);
    notifyNewRequest(entry);
});

// ── Requests (admin read) ─────────────────────────────────────────────────
app.get('/api/requests', requireAuth, (req, res) => {
    res.json(readRequests());
});

// ── Requests (admin approve) ──────────────────────────────────────────────
app.put('/api/requests/:index/approve', requireAuth, async (req, res) => {
    const idx      = parseInt(req.params.index, 10);
    const requests = readRequests();
    if (isNaN(idx) || idx < 0 || idx >= requests.length) return res.status(404).json({ error: 'Not found' });
    const accessCode = req.body && req.body.accessCode ? String(req.body.accessCode).trim() : '';
    requests[idx].status     = 'approved';
    requests[idx].accessCode = accessCode || null;
    writeRequests(requests);
    notifyRequestApproved(requests[idx]).catch(() => {});
    res.json(requests[idx]);
});

// ── Requests (admin delete) ───────────────────────────────────────────────
app.delete('/api/requests/:index', requireAuth, (req, res) => {
    const idx      = parseInt(req.params.index, 10);
    const requests = readRequests();
    if (isNaN(idx) || idx < 0 || idx >= requests.length) return res.status(404).json({ error: 'Not found' });
    requests.splice(idx, 1);
    writeRequests(requests);
    res.status(204).send();
});

app.listen(3000, () => {
    console.log('PoC Lab backend running on port 3000');
    if (process.env.SMTP_USER && process.env.SMTP_PASS) {
        console.log(`Email notifications enabled — sending from ${process.env.SMTP_FROM || process.env.SMTP_USER} via ${process.env.SMTP_HOST || 'smtp.gmail.com'}`);
    } else {
        console.log('Email notifications disabled — SMTP_USER or SMTP_PASS not set');
    }
    startDigestScheduler();
    console.log('Digest scheduler started — weekly: Monday 9am UTC, monthly: 1st of month 9am UTC');
});
