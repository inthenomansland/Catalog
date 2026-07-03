const express    = require('express');
const fs         = require('fs');
const path       = require('path');
const jwt        = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const crypto     = require('crypto');

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

// Serve frontend static files
app.use(express.static(path.join(__dirname, 'public')));

const DATA_DIR          = '/app/data';
const DATA_FILE         = path.join(DATA_DIR, 'data.json');
const DEFAULT_DATA      = path.join(__dirname, 'data-default.json');
const GOTCHAS_FILE      = path.join(DATA_DIR, 'gotchas.json');
const SUBSCRIBERS_FILE  = path.join(DATA_DIR, 'subscribers.json');
const DIGEST_STATE_FILE = path.join(DATA_DIR, 'digest-state.json');
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

function readData()             { return JSON.parse(fs.readFileSync(DATA_FILE,         'utf8')); }
function writeData(data)        { fs.writeFileSync(DATA_FILE,         JSON.stringify(data, null, 2), 'utf8'); }
function readGotchas()          { return JSON.parse(fs.readFileSync(GOTCHAS_FILE,      'utf8')); }
function writeGotchas(data)     { fs.writeFileSync(GOTCHAS_FILE,      JSON.stringify(data, null, 2), 'utf8'); }
function readSubscribers()      { return JSON.parse(fs.readFileSync(SUBSCRIBERS_FILE,  'utf8')); }
function writeSubscribers(data) { fs.writeFileSync(SUBSCRIBERS_FILE,  JSON.stringify(data, null, 2), 'utf8'); }
function readDigestState()      { return JSON.parse(fs.readFileSync(DIGEST_STATE_FILE, 'utf8')); }
function writeDigestState(data) { fs.writeFileSync(DIGEST_STATE_FILE, JSON.stringify(data, null, 2), 'utf8'); }

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

// ── Shared email helper ───────────────────────────────────────────────────
async function sendEmail({ to, subject, text }) {
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
        });
        console.log(`Email sent to ${to}: ${subject}`);
    } catch (err) {
        console.error(`Failed to send email to ${to} (login: ${user}):`, err.message);
    }
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
app.post('/api/gotchas/suggest', async (req, res) => {
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
app.post('/api/subscribe', (req, res) => {
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
