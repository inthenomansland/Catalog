const express    = require('express');
const fs         = require('fs');
const path       = require('path');
const jwt        = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const crypto     = require('crypto');
const rateLimit  = require('express-rate-limit');
const {
    renderInstantEmailHtml,
    renderDigestEmailHtml,
    renderApprovalEmailHtml,
    renderCompleteEmailHtml,
    renderGlassBrokenEmailHtml,
} = require('./email-templates');

const app = express();
app.use(express.json());

// One reverse proxy terminates TLS in front of this container, so without this
// every request looks like it came from the proxy and the rate limiters bucket
// the whole internet together. That matters most for break-glass: a stranger's
// failed guesses must not lock out someone in a real emergency.
app.set('trust proxy', 1);

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

// Break-glass sits on a public endpoint guarding a real licence key, so it gets
// a far tighter limit than the request forms: a handful of tries an hour is
// plenty for someone who has actually been given the password, and useless to
// anyone guessing. Successful breaks do not count against it — the cabinet
// locks itself after one anyway.
const breakGlassLimiter = rateLimit({
    windowMs:            60 * 60 * 1000,
    max:                 10,
    skipSuccessfulRequests: true,
    standardHeaders:     true,
    legacyHeaders:       false,
    message:             { error: 'Too many attempts. Emergency access is locked for an hour — contact the lab team on poc.lab@proav.com.' },
});

// Visitor sign-in runs on a tablet at the lab door, and a PoC can bring a group
// of a dozen through in a few minutes — all from the office's one egress IP.
// The request-form limit would turn the fourth visitor away, so this gets its
// own, much looser bucket.
const visitLimiter = rateLimit({
    windowMs:        15 * 60 * 1000,
    max:             60,
    standardHeaders: true,
    legacyHeaders:   false,
    message:         { error: 'Too many sign-ins from this device. Please ask a member of the lab team for help.' },
});

// Serve frontend static files
app.use(express.static(path.join(__dirname, 'public')));

// Short URL for the QR code on the lab door.
app.get('/visit', (req, res) => res.sendFile(path.join(__dirname, 'public', 'visit.html')));

const DATA_DIR          = '/app/data';
const DATA_FILE         = path.join(DATA_DIR, 'data.json');
const DEFAULT_DATA      = path.join(__dirname, 'data-default.json');
const GOTCHAS_FILE      = path.join(DATA_DIR, 'gotchas.json');
const SUBSCRIBERS_FILE  = path.join(DATA_DIR, 'subscribers.json');
const DIGEST_STATE_FILE = path.join(DATA_DIR, 'digest-state.json');
const REQUESTS_FILE     = path.join(DATA_DIR, 'requests.json');
const BREAKGLASS_FILE   = path.join(DATA_DIR, 'breakglass.json');
const ACCESS_LOG_FILE   = path.join(DATA_DIR, 'access-log.json');
const SITE_URL          = 'https://poc-lab.av.proav.cloud';

// Who the access log ignores. The log answers "which guests were in the lab,
// and when" — the lab team's own time in their own lab is not access worth
// auditing, and including it makes every export something to explain. Anyone
// not listed here is a guest. Emails match against every address on a request;
// names must match in full, so a visitor sharing a first name is still logged.
const LOG_EXCLUDE = (process.env.LOG_EXCLUDE ||
    'Ashton Lindemann, ashton.lindemann@proav.com, poc.lab@proav.com')
    .split(',').map(v => v.trim().toLowerCase()).filter(Boolean);

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const JWT_SECRET     = process.env.JWT_SECRET;

if (!ADMIN_PASSWORD) throw new Error('ADMIN_PASSWORD environment variable is required');
if (!JWT_SECRET)     throw new Error('JWT_SECRET environment variable is required');

// The break-glass password is deliberately NOT required to boot. It is a
// separate shared secret from ADMIN_PASSWORD, and if it is missing the cabinet
// simply reports itself unconfigured and hides — better than taking the whole
// dashboard down over a feature nobody may be using yet.
const BREAKGLASS_PASSWORD = process.env.BREAKGLASS_PASSWORD || null;
if (!BREAKGLASS_PASSWORD) console.log('BREAKGLASS_PASSWORD not set — emergency access is disabled');

// The emergency licence key cabinet. `armed` is the whole state machine: a key
// is handed out once and the cabinet locks, so a second person in the same
// emergency is told who already has it rather than quietly getting it too.
// `log` is append-only — arming, breaking and clearing all leave a trace.
const EMPTY_CABINET = {
    key:    null,
    label:  null,
    armed:  false,
    armedAt: null,
    brokenBy:     null,
    brokenReason: null,
    brokenAt:     null,
    log: [],
};

// Bootstrap data volume on first run
if (!fs.existsSync(DATA_DIR))          fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(DATA_FILE))         { fs.copyFileSync(DEFAULT_DATA, DATA_FILE); console.log('Initialised data.json from bundled default'); }
if (!fs.existsSync(GOTCHAS_FILE))      fs.writeFileSync(GOTCHAS_FILE,     '[]', 'utf8');
if (!fs.existsSync(SUBSCRIBERS_FILE))  fs.writeFileSync(SUBSCRIBERS_FILE, '[]', 'utf8');
if (!fs.existsSync(DIGEST_STATE_FILE)) fs.writeFileSync(DIGEST_STATE_FILE, JSON.stringify({ lastWeekly: null, lastMonthly: null }), 'utf8');
if (!fs.existsSync(REQUESTS_FILE))     fs.writeFileSync(REQUESTS_FILE,     '[]', 'utf8');
if (!fs.existsSync(BREAKGLASS_FILE))   fs.writeFileSync(BREAKGLASS_FILE,   JSON.stringify(EMPTY_CABINET, null, 2), 'utf8');
if (!fs.existsSync(ACCESS_LOG_FILE))   fs.writeFileSync(ACCESS_LOG_FILE,   '[]', 'utf8');

function readData()             { return JSON.parse(fs.readFileSync(DATA_FILE,         'utf8')); }
function writeData(data)        { fs.writeFileSync(DATA_FILE,         JSON.stringify(data, null, 2), 'utf8'); }
function readGotchas()          { return JSON.parse(fs.readFileSync(GOTCHAS_FILE,      'utf8')); }
function writeGotchas(data)     { fs.writeFileSync(GOTCHAS_FILE,      JSON.stringify(data, null, 2), 'utf8'); }
function readSubscribers()      { return JSON.parse(fs.readFileSync(SUBSCRIBERS_FILE,  'utf8')); }
function writeSubscribers(data) { fs.writeFileSync(SUBSCRIBERS_FILE,  JSON.stringify(data, null, 2), 'utf8'); }

// Unsubscribing is a soft delete — the record stays in subscribers.json with
// unsubscribed:true so there is a record of who left and when. Everything that
// actually sends mail must go through this, never readSubscribers() directly.
function activeSubscribers()    { return readSubscribers().filter(s => !s.unsubscribed); }
function readDigestState()      { return JSON.parse(fs.readFileSync(DIGEST_STATE_FILE, 'utf8')); }
function writeDigestState(data) { fs.writeFileSync(DIGEST_STATE_FILE, JSON.stringify(data, null, 2), 'utf8'); }
function readRequests()         { return JSON.parse(fs.readFileSync(REQUESTS_FILE,     'utf8')); }
function writeRequests(data)    { fs.writeFileSync(REQUESTS_FILE,     JSON.stringify(data, null, 2), 'utf8'); }
function readCabinet()          { return { ...EMPTY_CABINET, ...JSON.parse(fs.readFileSync(BREAKGLASS_FILE, 'utf8')) }; }
function writeCabinet(data)     { fs.writeFileSync(BREAKGLASS_FILE,   JSON.stringify(data, null, 2), 'utf8'); }

// The access log is its own file rather than a view over requests.json on the
// fly, because requests get deleted once they are dealt with and the record of
// who was in the lab has to outlive the paperwork that produced it.
function readAccessLog()        { return JSON.parse(fs.readFileSync(ACCESS_LOG_FILE,  'utf8')); }
function writeAccessLog(data)   { fs.writeFileSync(ACCESS_LOG_FILE,   JSON.stringify(data, null, 2), 'utf8'); }

function generateToken() { return crypto.randomBytes(32).toString('hex'); }
function generateId()    { return crypto.randomBytes(8).toString('hex'); }

// Compares in constant time so the endpoint cannot be probed a character at a
// time. Unequal lengths short-circuit — timingSafeEqual throws on a mismatch,
// and password length is not the secret here.
function safeEqual(a, b) {
    const ab = Buffer.from(String(a || ''), 'utf8');
    const bb = Buffer.from(String(b || ''), 'utf8');
    if (ab.length !== bb.length) return false;
    return crypto.timingSafeEqual(ab, bb);
}

// Behind nginx the socket address is the proxy, so prefer the forwarded header.
function clientIp(req) {
    const fwd = req.headers['x-forwarded-for'];
    if (fwd) return String(fwd).split(',')[0].trim();
    return req.socket.remoteAddress || 'unknown';
}

// One-off migration. Requests predate stable ids and were addressed by array
// position, so a stale admin tab could act on the wrong row. Now that a report
// can be mailed to the person who raised a request, an off-by-one would send
// one colleague's report to another — so every request gets an id for life.
(function backfillRequestIds() {
    const requests = readRequests();
    const missing  = requests.filter(r => !r.id);
    if (missing.length === 0) return;
    missing.forEach(r => { r.id = generateId(); });
    writeRequests(requests);
    console.log(`Backfilled ids on ${missing.length} request(s)`);
})();

// ── Lab access log ────────────────────────────────────────────────────────
// A booking becomes a lab session at the moment it is approved: that is the
// point the dates are confirmed and the guest is told to come in. Pending
// requests are somebody's suggestion, not access, and never reach the log.

function isLabOwner(name, email) {
    const n = String(name || '').trim().toLowerCase();
    if (n && LOG_EXCLUDE.includes(n)) return true;
    // submitterEmail can hold several comma-separated addresses; if the lab
    // team is on it at all, the booking is theirs.
    return String(email || '')
        .split(',')
        .map(e => e.trim().toLowerCase())
        .filter(Boolean)
        .some(e => LOG_EXCLUDE.includes(e));
}

// Upsert, not append: approving twice (to correct an access code, say) must
// amend the one session rather than record the guest as having visited twice.
function recordLabAccess(r) {
    if (isLabOwner(r.submitterName, r.submitterEmail)) {
        console.log(`[access-log] skipped — "${r.jobName}" is a lab team booking`);
        return null;
    }

    const log   = readAccessLog();
    const entry = {
        id:        generateId(),
        requestId: r.id,
        type:      r.type,
        jobName:   r.jobName,
        name:      r.submitterName || null,
        email:     r.submitterEmail || null,
        persons:   r.persons || null,
        dateStart: r.dateStart || null,
        dateEnd:   r.dateEnd || null,
        bookedOn:  r.submittedDate || null,
        approvedAt: new Date().toISOString(),
        // The code itself stays out of the log. An export of this file is meant
        // to be shareable, and a spreadsheet of live door codes is not.
        accessCodeIssued: Boolean(r.accessCode),
    };

    // Visitor sign-ins carry the requestId of the booking they came for, so
    // they must be skipped here or re-approving would overwrite a visit.
    const existing = log.findIndex(e => e.requestId === r.id && e.source !== 'visit');
    if (existing === -1) log.push(entry);
    else log[existing] = { ...log[existing], ...entry, id: log[existing].id, approvedAt: log[existing].approvedAt };

    writeAccessLog(log);
    console.log(`[access-log] ${existing === -1 ? 'logged' : 'updated'}: ${entry.name} — "${entry.jobName}"`);
    return entry;
}

// One-off migration for bookings approved before the log existed. Without it
// the log starts empty and reads as though nobody had ever used the lab.
(function backfillAccessLog() {
    const log = readAccessLog();
    if (log.length > 0) return;

    const approved = readRequests().filter(r =>
        ['approved', 'completed'].includes(r.status) && !isLabOwner(r.submitterName, r.submitterEmail));
    if (approved.length === 0) return;

    writeAccessLog(approved.map(r => ({
        id:        generateId(),
        requestId: r.id,
        type:      r.type,
        jobName:   r.jobName,
        name:      r.submitterName || null,
        email:     r.submitterEmail || null,
        persons:   r.persons || null,
        dateStart: r.dateStart || null,
        dateEnd:   r.dateEnd || null,
        bookedOn:  r.submittedDate || null,
        // These predate the log, so the approval time is genuinely unknown —
        // recorded as null rather than backdated to a time nobody observed.
        approvedAt: null,
        accessCodeIssued: Boolean(r.accessCode),
    })));
    console.log(`Backfilled access log with ${approved.length} previously approved booking(s)`);
})();

// Excel on Windows needs both of these or it opens the export as a single
// column and mangles any accented name in it.
const BOM  = String.fromCharCode(0xFEFF);
const CRLF = String.fromCharCode(13, 10);

// A cell beginning =, +, - or @ is run as a formula when the CSV is opened in
// Excel, and these names come off a public form. Prefixing a quote makes the
// cell inert without changing what it reads as.
function csvCell(value) {
    if (value === null || value === undefined) return '';
    let s = String(value);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return `"${s.replace(/"/g, '""')}"`;
}

// The container runs on UTC, but "today" and a sign-in time have to mean what
// they meant at the lab door — an hour out for half the year otherwise.
function londonDate(d = new Date()) {
    return d.toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
}

function londonTime(iso) {
    if (!iso) return '';
    return new Date(iso).toLocaleTimeString('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit' });
}

function accessLogToCsv(rows) {
    const header = ['Date in', 'Date out', 'Source', 'Guest', 'Company', 'Email', 'Phone',
                    'Others attending', 'Booking', 'Type', 'Reason for visit', 'Meeting',
                    'Signed in', 'Terms accepted', 'Booked on', 'Approved on', 'Access code issued'];
    const lines = [header.map(csvCell).join(',')];
    rows.forEach(e => {
        const visit = e.source === 'visit';
        lines.push([
            e.dateStart, e.dateEnd || e.dateStart,
            visit ? 'Visitor sign-in' : 'Booking approval',
            e.name, e.company, e.email, e.phone, e.persons,
            e.jobName, e.type ? (e.type === 'bench' ? 'Bench Test' : 'PoC') : '',
            e.purpose, e.host,
            londonTime(e.signedInAt),
            visit ? (e.termsAccepted ? `Yes (v${e.termsVersion || '?'})` : 'No') : '',
            e.bookedOn, e.approvedAt ? e.approvedAt.split('T')[0] : '',
            visit ? '' : (e.accessCodeIssued ? 'Yes' : 'No'),
        ].map(csvCell).join(','));
    });
    return BOM + lines.join(CRLF) + CRLF;
}

// Sessions in date order, oldest first, optionally clipped to a window. Falls
// back to the booked date so a session with no dates still lands somewhere
// sensible instead of vanishing from every filtered export. The window is
// matched on the day alone; sign-in time only orders visits within a day.
function accessLogRows({ from, to } = {}) {
    return readAccessLog()
        .map(e => ({ ...e, _day: e.dateStart || e.bookedOn || '' }))
        .filter(e => (!from || e._day >= from) && (!to || e._day <= to))
        .sort((a, b) => a._day.localeCompare(b._day) || (a.signedInAt || '').localeCompare(b.signedInAt || ''));
}

// ── Visitor sign-in ───────────────────────────────────────────────────────
// Bookings say who was expected; sign-ins say who actually walked in, which is
// the half of the record that matters in a fire roll call or a security query.
// Both live in the one access log, told apart by source: 'visit'.

// Bookings a visitor can say they are here for: approved, and running today.
// A day's grace either side covers dates that slipped after approval without
// the dropdown filling up with every booking the lab has ever taken.
function bookingsOpenForVisits() {
    const today     = londonDate();
    const yesterday = londonDate(new Date(Date.now() - 86400000));
    const tomorrow  = londonDate(new Date(Date.now() + 86400000));
    return readRequests()
        .filter(r => r.status === 'approved' && r.dateStart)
        .filter(r => r.dateStart <= tomorrow && (r.dateEnd || r.dateStart) >= yesterday)
        .sort((a, b) => {
            // Today's bookings first, then by name — the one they want is at the top.
            const aNow = a.dateStart <= today && (a.dateEnd || a.dateStart) >= today;
            const bNow = b.dateStart <= today && (b.dateEnd || b.dateStart) >= today;
            return (bNow - aNow) || String(a.jobName).localeCompare(String(b.jobName));
        });
}

// There is no sign-out: anyone signed in is taken to have left by the end of
// the day. So "signed in today" is the whole of what on-site means.
function visitsTodayFor(log, email) {
    const key = email.toLowerCase();
    return log.filter(e => e.source === 'visit' &&
        e.dateStart === londonDate() && String(e.email || '').toLowerCase() === key);
}

async function notifyVisitorArrived(v) {
    await sendEmail({
        to:      'poc.lab@proav.com',
        subject: `Visitor signed in: ${v.name}${v.company ? ` (${v.company})` : ''} — PoC Lab`,
        text: [
            `${v.name} has signed in at the PoC Lab at ${londonTime(v.signedInAt)}.`,
            '',
            `Company:  ${v.company || '—'}`,
            `Email:    ${v.email   || '—'}`,
            `Phone:    ${v.phone   || '—'}`,
            `Here for: ${v.jobName || v.purpose || '—'}`,
            `Meeting:  ${v.host    || '—'}`,
            '',
            'See who is on site in the admin panel:',
            `${SITE_URL}/admin.html`,
        ].join('\n'),
    });
}

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

// ── Recipient lists ───────────────────────────────────────────────────────
// submitterEmail can hold several addresses: a requester usually wants their
// PM or site lead copied on the approval and on the finished report. Stored as
// a comma-separated string, which is exactly what nodemailer's `to` accepts,
// so older single-address records pass through these helpers unchanged.
const EMAIL_RE = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;

function splitEmailList(value) {
    if (!value) return [];
    return String(value).split(/[,;]/).map(e => e.trim()).filter(Boolean);
}

// Returns { emails, invalid } — deduped case-insensitively, original casing kept.
function parseEmailList(value) {
    const seen    = new Set();
    const emails  = [];
    const invalid = [];
    for (const candidate of splitEmailList(value)) {
        if (!EMAIL_RE.test(candidate)) { invalid.push(candidate); continue; }
        const key = candidate.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        emails.push(candidate);
    }
    return { emails, invalid };
}

// Comma-separated string ready for `to:`, or null when there is nobody to mail.
function emailListToHeader(value) {
    const { emails } = parseEmailList(value);
    return emails.length ? emails.join(', ') : null;
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

    // HTML emails reference the logo via cid:proav-logo-mark rather than a
    // hosted URL — Outlook (and most clients) block remote images by default,
    // but treat CID-embedded attachments as part of the message itself, so
    // the logo shows immediately with no "download images" prompt.
    const attachments = html ? [{
        filename: 'logo.png',
        path:     path.join(__dirname, 'public', 'logo-email.png'),
        cid:      'proav-logo-mark',
    }] : [];

    try {
        await transporter.sendMail({
            from:    `"PoC Lab Notifications" <${process.env.SMTP_FROM || user}>`,
            to, subject, text,
            ...(html ? { html, attachments } : {}),
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

// ── Request approval confirmation to submitter ────────────────────────────
async function notifyRequestApproved(r) {
    const to = emailListToHeader(r.submitterEmail);
    if (!to) return;
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
        to,
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

// ── Report ready, to the person who raised the request ────────────────────
// Transactional: this is a direct answer to something they asked the lab for,
// so it goes out regardless of whether they ever subscribed, and carries no
// unsubscribe link. Solving the "I can't make people subscribe" problem is the
// whole point of it.
async function notifyRequestComplete(r, entry) {
    const to = emailListToHeader(r.submitterEmail);
    if (!to) {
        console.log(`[complete] no email on record for request "${r.jobName}" — not notified`);
        return;
    }
    const typeName = r.type === 'bench' ? 'Bench Test' : 'PoC';

    await sendEmail({
        to,
        subject: `Your report is ready: ${entry.title} — PoC Lab`,
        text: [
            `Hi ${r.submitterName || 'there'},`,
            '',
            `The report from your ${typeName} request has been published on the PoC Lab Research Catalogue.`,
            '',
            `Your request: ${r.jobName || '—'}`,
            '',
            `Report:       ${entry.title}`,
            `Manufacturer: ${entry.manufacturer || '—'}`,
            `Product:      ${entry.productName || '—'}`,
            `Test type:    ${entry.testType || '—'}`,
            `Published:    ${entry.date || '—'}`,
            '',
            'Summary:',
            entry.summary || '—',
            ...(entry.fullReport ? ['', `Read the full report: ${entry.fullReport}`] : []),
            '',
            `View the catalogue: ${SITE_URL}`,
            '',
            'Any questions, get in touch with the lab team: poc.lab@proav.com',
            '',
            '— proAV PoC Lab Team',
        ].join('\n'),
        html: renderCompleteEmailHtml(r, entry, typeName),
    });
    console.log(`[complete] report "${entry.title}" notified to ${to} (request "${r.jobName}")`);
}

// ── Break-glass alert ────────────────────────────────────────────────────
// Sent the moment the cabinet is opened. This is the only thing that tells the
// lab team an emergency key is out in the wild while it is still happening.
// Failed password attempts are logged to the container log but not emailed —
// a public endpoint will attract idle guesses, and an alert that cries wolf
// gets muted, which would defeat the one alert that matters.
async function notifyGlassBroken(cabinet, who, reason, ip) {
    const when = new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC';

    await sendEmail({
        to:      'poc.lab@proav.com',
        subject: `BREAK GLASS USED: ${cabinet.label || 'emergency licence key'} released to ${who}`,
        text: [
            'The emergency licence key cabinet has been opened.',
            '',
            `Opened by: ${who}`,
            `Reason:    ${reason}`,
            `Key:       ${cabinet.label || 'Emergency licence key'}`,
            `Time:      ${when}`,
            `IP:        ${ip}`,
            '',
            'The cabinet is now LOCKED — nobody else can retrieve this key.',
            'To make emergency access available again, load a replacement key in',
            'the admin panel and re-arm it.',
            '',
            `${SITE_URL}/admin.html`,
        ].join('\n'),
        html: renderGlassBrokenEmailHtml({ cabinet, who, reason, when, ip }),
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
// skipEmail suppresses the generic notification for one address — used when
// that person is getting the tailored "your report is ready" email instead, so
// a requester who also subscribes doesn't receive two mails for one report.
// skipEmails is the request's recipient list — they have just had the fuller
// "your report is ready" email, so they should not also get the generic one.
async function notifyInstantSubscribers(entry, skipEmails) {
    const skip = new Set(splitEmailList(skipEmails).map(e => e.toLowerCase()));
    const subscribers = activeSubscribers()
        .filter(s => s.frequency === 'instant')
        .filter(s => !skip.has(s.email.trim().toLowerCase()));
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
    const subscribers = activeSubscribers().filter(s => s.frequency === frequency);
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

// ── Break glass ───────────────────────────────────────────────────────────
// Deliberately public and separate from admin auth: the whole point is that it
// works when the admin is unreachable. The password is a pre-agreed shared
// secret, which means it can prove someone is authorised but never who they
// are — so name and reason are mandatory, and they are what the audit trail is
// actually made of.

// Public status. Says whether the cabinet can be opened and, once used, who
// used it — never the key itself, and never whether a password would work.
app.get('/api/breakglass/status', (req, res) => {
    if (!BREAKGLASS_PASSWORD) return res.json({ configured: false });
    const c = readCabinet();
    res.json({
        configured: true,
        available:  Boolean(c.armed && c.key),
        label:      c.label || null,
        brokenBy:   c.brokenBy   || null,
        brokenAt:   c.brokenAt   || null,
    });
});

app.post('/api/breakglass', breakGlassLimiter, async (req, res) => {
    if (!BREAKGLASS_PASSWORD) return res.status(503).json({ error: 'Emergency access is not configured.' });

    const { password, name, reason } = req.body || {};
    const who    = (name   || '').trim();
    const why    = (reason || '').trim();

    if (!who) return res.status(400).json({ error: 'Please enter your name — emergency access is recorded against it.' });
    if (!why) return res.status(400).json({ error: 'Please give a brief reason for needing the key.' });

    if (!safeEqual(password, BREAKGLASS_PASSWORD)) {
        console.warn(`[breakglass] failed attempt by "${who}" from ${clientIp(req)}`);
        return res.status(401).json({ error: 'That is not the emergency password.' });
    }

    // Password is right — but the cabinet may already be empty. Say who has the
    // key rather than a bare refusal: in an emergency the useful answer is
    // which colleague to go and ask.
    const cabinet = readCabinet();
    if (!cabinet.armed || !cabinet.key) {
        return res.status(409).json({
            error: cabinet.brokenBy
                ? `This key was already taken by ${cabinet.brokenBy} on ${(cabinet.brokenAt || '').slice(0, 10)}. Contact them or the lab team on poc.lab@proav.com.`
                : 'There is no key loaded. Contact the lab team on poc.lab@proav.com.',
        });
    }

    const at = new Date().toISOString();
    const ip = clientIp(req);

    cabinet.armed        = false;
    cabinet.brokenBy     = who;
    cabinet.brokenReason = why;
    cabinet.brokenAt     = at;
    cabinet.log.push({ id: generateId(), action: 'broken', at, by: who, reason: why, ip, label: cabinet.label || null });
    writeCabinet(cabinet);

    console.warn(`[breakglass] OPENED by "${who}" from ${ip} — reason: ${why}`);
    res.json({ key: cabinet.key, label: cabinet.label || null });

    notifyGlassBroken(cabinet, who, why, ip).catch(err => console.error('[breakglass] alert failed:', err.message));
});

// Admin view — the key is included here so it can be confirmed before re-arming.
app.get('/api/breakglass', requireAuth, (req, res) => {
    const c = readCabinet();
    res.json({ ...c, configured: Boolean(BREAKGLASS_PASSWORD) });
});

// Load a key and arm the cabinet. Also the re-arm path after a break.
app.put('/api/breakglass', requireAuth, (req, res) => {
    const { key, label } = req.body || {};
    const trimmed = (key || '').trim();
    if (!trimmed) return res.status(400).json({ error: 'A licence key is required.' });

    const cabinet = readCabinet();
    const at      = new Date().toISOString();
    const rearmed = Boolean(cabinet.brokenAt);

    cabinet.key     = trimmed;
    cabinet.label   = (label || '').trim() || null;
    cabinet.armed   = true;
    cabinet.armedAt = at;
    // Cleared so status reads "available" again, but the break stays in the log
    // — the history of who took what is the point of the whole feature.
    cabinet.brokenBy     = null;
    cabinet.brokenReason = null;
    cabinet.brokenAt     = null;
    cabinet.log.push({ id: generateId(), action: rearmed ? 're-armed' : 'armed', at, by: 'admin', label: cabinet.label, ip: clientIp(req) });
    writeCabinet(cabinet);

    console.log(`[breakglass] cabinet ${rearmed ? 're-armed' : 'armed'}: ${cabinet.label || 'unlabelled key'}`);
    res.json({ armed: true, label: cabinet.label, armedAt: at });
});

// Empty the cabinet without handing the key out — for a key that expired or was
// replaced out of band. Leaves the log intact.
app.delete('/api/breakglass', requireAuth, (req, res) => {
    const cabinet = readCabinet();
    const at      = new Date().toISOString();
    cabinet.key   = null;
    cabinet.armed = false;
    cabinet.log.push({ id: generateId(), action: 'cleared', at, by: 'admin', label: cabinet.label, ip: clientIp(req) });
    writeCabinet(cabinet);
    console.log('[breakglass] cabinet cleared by admin');
    res.status(204).send();
});

// ── Entries (public read) ─────────────────────────────────────────────────
app.get('/api/entries', (req, res) => {
    res.json(readData());
});

// ── Entries (admin write) ─────────────────────────────────────────────────
// requestId is optional and is NOT part of the entry — it names the request this
// report answers, so the person who raised it gets told the moment it's live.
app.post('/api/entries', requireAuth, (req, res) => {
    const { requestId, ...entry } = req.body || {};

    const data = readData();
    data.unshift(entry);
    writeData(data);
    res.status(201).json(entry);

    let fulfilled = null;
    if (requestId) {
        const requests = readRequests();
        const r = requests.find(x => x.id === requestId);
        if (r) {
            r.status        = 'completed';
            r.completedDate = new Date().toISOString().split('T')[0];
            r.reportTitle   = entry.title;
            writeRequests(requests);
            fulfilled = r;
            notifyRequestComplete(r, entry).catch(err => console.error('[complete] send failed:', err.message));
        } else {
            console.warn(`[complete] requestId ${requestId} not found — nobody notified`);
        }
    }

    notifyInstantSubscribers(entry, fulfilled && fulfilled.submitterEmail);
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
        const sub = subs[existing];
        sub.frequency = frequency;
        // Someone who previously unsubscribed is signing up again — clear the
        // flag and issue a fresh token so the old link can't remove them twice.
        if (sub.unsubscribed) {
            delete sub.unsubscribed;
            delete sub.unsubscribedDate;
            sub.token          = generateToken();
            sub.subscribedDate = new Date().toISOString().split('T')[0];
            console.log(`[subscribe] resubscribed: ${email} (${frequency})`);
        }
        writeSubscribers(subs);
        return res.json({ message: 'Subscription updated' });
    }

    subs.push({ email, frequency, token: generateToken(), subscribedDate: new Date().toISOString().split('T')[0] });
    writeSubscribers(subs);
    console.log(`[subscribe] new: ${email} (${frequency})`);
    res.status(201).json({ message: 'Subscribed successfully' });
});

// Look up who a token belongs to so the confirmation page can name them.
// Read-only on purpose: mail scanners, link previewers and browser prefetch all
// issue GETs against the unsubscribe URL, and a GET must never remove anyone.
app.get('/api/unsubscribe/check', (req, res) => {
    const { token } = req.query;
    if (!token) return res.status(400).json({ error: 'token required' });

    const sub = readSubscribers().find(s => s.token === token);
    if (!sub) return res.status(404).json({ error: 'Token not found' });

    res.json({ email: sub.email, frequency: sub.frequency, unsubscribed: !!sub.unsubscribed });
});

// The actual removal — POST only, so it takes a deliberate click by a person.
// Deliberately not rate limited: the whole office shares one egress IP, and
// unsubscribing must never fail because a colleague filed a report first.
// The 32-byte token is unguessable, so there is nothing to brute force.
app.post('/api/unsubscribe', (req, res) => {
    const { token } = req.body || {};
    if (!token) return res.status(400).json({ error: 'token required' });

    const subs = readSubscribers();
    const sub  = subs.find(s => s.token === token);
    if (!sub) return res.status(404).json({ error: 'Token not found' });

    if (!sub.unsubscribed) {
        sub.unsubscribed     = true;
        sub.unsubscribedDate = new Date().toISOString();
        writeSubscribers(subs);
        console.log(`[unsubscribe] ${sub.email} (was ${sub.frequency}) at ${sub.unsubscribedDate}`);
    }
    res.json({ message: 'Unsubscribed successfully', email: sub.email });
});

// ── Subscriptions (admin) ─────────────────────────────────────────────────
app.get('/api/admin/subscribers', requireAuth, (req, res) => {
    res.json(readSubscribers());
});

// Keyed on token, not array position — a stale admin tab deleting by index
// removes whoever happens to sit at that index now, not the row that was clicked.
app.delete('/api/admin/subscribers/:token', requireAuth, (req, res) => {
    const subs = readSubscribers();
    const idx  = subs.findIndex(s => s.token === req.params.token);
    if (idx === -1) return res.status(404).json({ error: 'Not found' });
    const [removed] = subs.splice(idx, 1);
    writeSubscribers(subs);
    console.log(`[admin] subscriber deleted: ${removed.email}`);
    res.status(204).send();
});

// ── Requests (public submit) ──────────────────────────────────────────────
app.post('/api/requests', submitLimiter, async (req, res) => {
    if (req.body._hp) return res.status(200).json({ message: 'ok' });
    const { type, submitterName, submitterEmail, jobName, scope, outcomes, kit, dateStart, dateEnd, persons, termsAccepted, termsVersion } = req.body || {};
    if (!type || !['bench', 'poc'].includes(type)) return res.status(400).json({ error: 'type must be bench or poc' });
    if (!submitterName) return res.status(400).json({ error: 'submitterName is required' });
    if (!jobName)       return res.status(400).json({ error: 'jobName is required' });
    // Checked in the browser too, but the acceptance is the record that lab
    // access was granted on agreed terms — it cannot rest on a client tick.
    if (termsAccepted !== true) return res.status(400).json({ error: 'The terms and conditions must be accepted.' });

    // Email is optional, but a typo in it must not pass quietly — a dropped
    // address means the approval and the published report never arrive, and
    // nobody finds out until someone asks why they heard nothing.
    const { emails, invalid } = parseEmailList(submitterEmail);
    if (invalid.length) {
        return res.status(400).json({
            error: `Not a valid email address: ${invalid.join(', ')}. Separate multiple addresses with commas.`,
        });
    }

    const requests = readRequests();
    const entry = {
        id: generateId(),
        type, submitterName, submitterEmail: emails.length ? emails.join(', ') : null,
        jobName, scope: scope || null, outcomes: outcomes || null,
        kit: kit || null, dateStart: dateStart || null, dateEnd: dateEnd || null,
        persons: persons || null,
        termsAccepted: true,
        termsVersion: termsVersion ? String(termsVersion) : null,
        termsAcceptedAt: new Date().toISOString(),
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
// Keyed on id, not array position: these actions email the submitter, and a
// stale admin tab acting on an index would mail the wrong person.
app.put('/api/requests/:id/approve', requireAuth, async (req, res) => {
    const requests = readRequests();
    const r = requests.find(x => x.id === req.params.id);
    if (!r) return res.status(404).json({ error: 'Not found' });
    const accessCode = req.body && req.body.accessCode ? String(req.body.accessCode).trim() : '';
    r.status     = 'approved';
    r.accessCode = accessCode || null;
    writeRequests(requests);
    console.log(`[admin] request approved: "${r.jobName}" (${r.submitterEmail || 'no email'})`);
    recordLabAccess(r);
    notifyRequestApproved(r).catch(() => {});
    res.json(r);
});

// ── Lab access log (admin read) ───────────────────────────────────────────
app.get('/api/admin/access-log', requireAuth, (req, res) => {
    const { from, to } = req.query;
    res.json(accessLogRows({ from, to }).reverse());
});

// ── Visitor sign-in (public) ──────────────────────────────────────────────
// Only an id and a name go out — this endpoint is on the open internet, and
// who booked the lab, and when, is not for anyone passing by.
app.get('/api/visit/bookings', (req, res) => {
    res.json(bookingsOpenForVisits().map(r => ({
        id:      r.id,
        jobName: r.jobName,
        type:    r.type,
    })));
});

app.post('/api/visit/sign-in', visitLimiter, (req, res) => {
    if (req.body._hp) return res.status(200).json({ message: 'ok' });
    const clean = v => String(v || '').trim().slice(0, 200);
    const name      = clean(req.body.name);
    const company   = clean(req.body.company);
    const email     = clean(req.body.email);
    const phone     = clean(req.body.phone);
    const host      = clean(req.body.host);
    const purpose   = clean(req.body.purpose);
    const requestId = clean(req.body.requestId);

    if (!name)    return res.status(400).json({ error: 'Please enter your full name.' });
    if (!company) return res.status(400).json({ error: 'Please enter the company you are from.' });
    if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Please enter a valid email address.' });
    // Loose on purpose: visitors come from abroad and type numbers every which
    // way. The check is only that there is a number someone could ring.
    if (!/^\+?[\d\s()\-.]{7,20}$/.test(phone) || phone.replace(/\D/g, '').length < 7) {
        return res.status(400).json({ error: 'Please enter a valid phone number.' });
    }

    let booking = null;
    if (requestId) {
        booking = bookingsOpenForVisits().find(r => r.id === requestId);
        if (!booking) return res.status(400).json({ error: 'That booking is no longer open for sign-in. Please choose again.' });
    } else if (!purpose) {
        return res.status(400).json({ error: 'Please choose the booking you are here for, or tell us the reason for your visit.' });
    }

    // Same rule as bookings: being let into the lab rests on agreed terms, so
    // the tick is enforced here and the version agreed to is kept with the visit.
    if (req.body.termsAccepted !== true) return res.status(400).json({ error: 'The terms and conditions must be accepted.' });
    const termsVersion = clean(req.body.termsVersion) || null;

    // A second tap on the kiosk, or someone signing in again after lunch, must
    // not put them in the roll call twice.
    const log      = readAccessLog();
    const existing = visitsTodayFor(log, email)[0];
    if (existing) return res.json({ name: existing.name, signedInAt: existing.signedInAt, alreadySignedIn: true });

    const now   = new Date();
    const entry = {
        id:          generateId(),
        source:      'visit',
        requestId:   booking ? booking.id      : null,
        type:        booking ? booking.type    : null,
        jobName:     booking ? booking.jobName : null,
        purpose:     booking ? null : purpose,
        name, company, email, phone,
        host:        host || null,
        dateStart:   londonDate(now),
        dateEnd:     londonDate(now),
        signedInAt:  now.toISOString(),
        termsAccepted:   true,
        termsVersion,
        termsAcceptedAt: now.toISOString(),
    };
    log.push(entry);
    writeAccessLog(log);
    console.log(`[visit] signed in: ${entry.name} (${entry.company}) — ${entry.jobName || entry.purpose}`);
    res.status(201).json({ name: entry.name, signedInAt: entry.signedInAt });

    notifyVisitorArrived(entry).catch(err => console.error('[visit] alert failed:', err.message));
});

// ── Lab access log (admin export) ─────────────────────────────────────────
// Served as a download rather than JSON so it drops straight into Excel. The
// admin panel fetches it with the bearer token and saves the blob — this is
// behind requireAuth like everything else, so it is not a shareable link.
app.get('/api/admin/access-log.csv', requireAuth, (req, res) => {
    const { from, to } = req.query;
    const rows  = accessLogRows({ from, to });
    const stamp = new Date().toISOString().split('T')[0];
    const range = from || to ? `-${from || 'start'}_to_${to || stamp}` : '';
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="poc-lab-access-log${range || '-' + stamp}.csv"`);
    res.send(accessLogToCsv(rows));
});

// ── Requests (admin delete) ───────────────────────────────────────────────
app.delete('/api/requests/:id', requireAuth, (req, res) => {
    const requests = readRequests();
    const idx = requests.findIndex(x => x.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Not found' });
    const [removed] = requests.splice(idx, 1);
    writeRequests(requests);
    console.log(`[admin] request deleted: "${removed.jobName}"`);
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
