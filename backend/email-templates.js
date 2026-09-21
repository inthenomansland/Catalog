// ── HTML email templates ──────────────────────────────────────────────────
// Kept apart from server.js so they can be rendered with sample data in a
// browser while being designed. They are pure functions of their arguments:
// no I/O, no Node APIs.
//
// Built for Outlook desktop first, which renders HTML with Word: tables for
// layout, inline styles only, no <style> blocks, no flexbox, no padding on
// <a>. Buttons are table cells with a background colour, which is the one
// shape of button Outlook reliably draws. Everything else is kept plain on
// purpose — a heading, a few labelled facts, a paragraph, one clear action.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.EmailTemplates = factory();
})(typeof self !== 'undefined' ? self : this, function () {

const SITE_URL  = 'https://poc-lab.av.proav.cloud';
const LAB_EMAIL = 'poc.lab@proav.com';

const FONT  = "'Segoe UI', Helvetica, Arial, sans-serif";
const MONO  = "Consolas, 'Courier New', monospace";
const INK   = '#151515';
const INK_2 = '#45464a';
const INK_3 = '#74767b';
const RULE  = '#eceff0';
const PAPER = '#f4f6f2';
const GREEN = '#6DC52D';

// Test-type colours match the badges on the live dashboard.
const TYPE_COLORS = {
    Kit:     { bg: '#dbeafe', fg: '#1d4ed8' },
    Program: { bg: '#d1fae5', fg: '#065f46' },
    Concept: { bg: '#ede9fe', fg: '#5b21b6' },
};

function typePill(type) {
    const c = TYPE_COLORS[type] || { bg: '#e5e7eb', fg: '#374151' };
    return `<span style="display:inline-block;background:${c.bg};color:${c.fg};font:700 10px/1 ${FONT};text-transform:uppercase;letter-spacing:.6px;padding:5px 10px;border-radius:99px;">${escapeHtml(type)}</span>`;
}
const GREEN_INK = '#3d7a14';

function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// "2026-09-21" -> "21 September 2026". Anything that isn't a plain date is
// returned as-is rather than guessed at.
function formatLongDate(dateStr) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateStr || '');
    if (!m) return dateStr || '';
    const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    return `${Number(m[3])} ${months[Number(m[2]) - 1]} ${m[1]}`;
}

function formatDateRange(start, end) {
    if (start && end && start !== end) return `${formatLongDate(start)} to ${formatLongDate(end)}`;
    return formatLongDate(start || end) || '—';
}

// ── Building blocks ──────────────────────────────────────────────────────
function eyebrow(text, color) {
    return `<p style="margin:0 0 10px;font:600 11px/1.4 ${FONT};color:${color || GREEN_INK};text-transform:uppercase;letter-spacing:1.2px;">${text}</p>`;
}

function heading(text) {
    return `<h1 style="margin:0 0 14px;font:600 24px/1.3 ${FONT};color:${INK};">${text}</h1>`;
}

function paragraph(html, { size = 15, color = INK_2, margin = '0 0 20px' } = {}) {
    return `<p style="margin:${margin};font:400 ${size}px/1.65 ${FONT};color:${color};">${html}</p>`;
}

// Label / value rows between two hairlines. rows: [[label, valueHtml], ...]
function factTable(rows) {
    const body = rows.filter(r => r && r[1]).map(([label, value], i) => `
        <tr>
            <td valign="top" width="130" style="width:130px;padding:10px 12px 10px 0;${i ? `border-top:1px solid ${RULE};` : ''}font:400 13px/1.5 ${FONT};color:${INK_3};">${label}</td>
            <td valign="top" style="padding:10px 0;${i ? `border-top:1px solid ${RULE};` : ''}font:400 14px/1.5 ${FONT};color:${INK};">${value}</td>
        </tr>`).join('');
    return `
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top:2px solid ${GREEN};border-bottom:1px solid ${RULE};margin:0 0 24px;">
            ${body}
        </table>`;
}

// Solid button. The colour lives on the <td> (bgcolor + style) so Outlook
// paints it; the padding lives there too because Outlook drops it from <a>.
// Returns a cell, so buttons() can lay several out in one row — Outlook
// ignores inline-block, so separate tables would stack.
function button(href, label, { primary = true } = {}) {
    const bg     = primary ? GREEN : '#0d0d0d';
    const fg     = primary ? '#0d0d0d' : '#ffffff';
    const border = bg;
    return `
                <td bgcolor="${bg}" style="background:${bg};border:1px solid ${border};border-radius:4px;padding:11px 20px;">
                    <a href="${escapeHtml(href)}" style="font:600 14px/1.2 ${FONT};color:${fg};text-decoration:none;display:inline-block;">${label}</a>
                </td>`;
}

function buttons(...cells) {
    const spaced = cells.filter(Boolean).join(`<td width="10" style="width:10px;font-size:0;line-height:0;">&nbsp;</td>`);
    return `
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 8px;">
            <tr>${spaced}</tr>
        </table>`;
}

function callout(label, innerHtml) {
    return `
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px;">
            <tr>
                <td bgcolor="#eef7e6" style="background:#eef7e6;border-left:4px solid ${GREEN};border-radius:6px;padding:18px 20px;">
                    <p style="margin:0 0 6px;font:600 11px/1.4 ${FONT};color:#2d6b0a;text-transform:uppercase;letter-spacing:1.2px;">${label}</p>
                    ${innerHtml}
                </td>
            </tr>
        </table>`;
}

const siteLabel = SITE_URL.replace(/^https?:\/\//, '');

function footer(note, token) {
    const unsubscribe = token
        ? `<p style="margin:8px 0 0;font:400 12px/1.6 ${FONT};color:${INK_3};">${note} <a href="${SITE_URL}/?unsubscribe=${escapeHtml(token)}" style="color:${INK_3};text-decoration:underline;">Unsubscribe</a></p>`
        : '';
    return `
        <p style="margin:0;font:400 12px/1.6 ${FONT};color:${INK_3};">
            proAV Proof of Concept Lab &nbsp;&middot;&nbsp;
            <a href="${SITE_URL}" style="color:${INK_3};text-decoration:underline;">${siteLabel}</a> &nbsp;&middot;&nbsp;
            <a href="mailto:${LAB_EMAIL}" style="color:${INK_3};text-decoration:underline;">${LAB_EMAIL}</a>
        </p>
        ${unsubscribe}`;
}

// ── Shell ────────────────────────────────────────────────────────────────
// preheader is the grey line most inboxes show after the subject; without
// one they fall back to the first text in the body, which is the header.
function shell({ preheader, bodyHtml, footerHtml }) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>PoC Lab</title>
</head>
<body style="margin:0;padding:0;background:${PAPER};">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${PAPER};">${escapeHtml(preheader || '')}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${PAPER}" style="background:${PAPER};">
<tr><td align="center" style="padding:32px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;">

    <tr><td bgcolor="#0d0d0d" style="background:#0d0d0d;padding:22px 36px;border-bottom:4px solid #6DC52D;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
            <td valign="middle"><img src="cid:proav-logo-mark" alt="proAV" width="92" height="22" style="display:block;width:92px;height:22px;border:0;"></td>
            <td valign="middle" align="right" style="font:500 12px/1 ${FONT};color:#b9bbbf;letter-spacing:.3px;">Proof of Concept Lab</td>
        </tr></table>
    </td></tr>

    <tr><td bgcolor="#ffffff" style="background:#ffffff;padding:36px 36px 32px;border:1px solid #dde2d8;border-top:0;">
        ${bodyHtml}
    </td></tr>

    <tr><td bgcolor="#f7f8f6" style="background:#f7f8f6;padding:18px 36px;border:1px solid #dde2d8;border-top:0;">
        ${footerHtml}
    </td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}

// ── Report facts, shared by every email about a published report ─────────
function reportFacts(entry) {
    return factTable([
        ['Manufacturer', escapeHtml(entry.manufacturer)],
        ['Product',      escapeHtml(entry.productName)],
        ['Category',     escapeHtml(entry.productCategory)],
        ['Test type',    escapeHtml(entry.testType)],
        ['Tested',       escapeHtml(formatLongDate(entry.date))],
    ]);
}

function truncate(text, max) {
    const s = text || '';
    if (s.length <= max) return s;
    return s.slice(0, s.lastIndexOf(' ', max) > max * 0.6 ? s.lastIndexOf(' ', max) : max).replace(/[,.;:\s]+$/, '') + '…';
}

// ── New report (instant subscribers) ─────────────────────────────────────
function renderInstantEmailHtml(entry, sub) {
    const bodyHtml = `
        <p style="margin:0 0 12px;">${typePill(entry.testType)} &nbsp;<span style="font:600 11px/1 ${FONT};color:${GREEN_INK};text-transform:uppercase;letter-spacing:1.2px;">New report</span></p>
        ${heading(escapeHtml(entry.title))}
        ${reportFacts(entry)}
        ${paragraph(escapeHtml(entry.summary))}
        ${buttons(
            entry.fullReport ? button(entry.fullReport, 'Read the full report') : '',
            button(SITE_URL, 'Browse the catalogue', { primary: !entry.fullReport }),
        )}`;

    return shell({
        preheader: `${entry.manufacturer || ''} ${entry.productName || ''} — now in the PoC Lab catalogue.`.trim(),
        bodyHtml,
        footerHtml: footer("You're receiving this because you asked to hear about every new report.", sub.token),
    });
}

// ── Weekly / monthly digest ──────────────────────────────────────────────
function digestItem(entry, first) {
    const link  = entry.fullReport || SITE_URL;
    const meta  = [entry.manufacturer, formatLongDate(entry.date)].filter(Boolean).map(escapeHtml).join(' &nbsp;&middot;&nbsp; ');
    return `
        <tr><td style="padding:20px 0;${first ? '' : `border-top:1px solid ${RULE};`}">
            <p style="margin:0 0 6px;font:400 12px/1.5 ${FONT};color:${INK_3};">${typePill(entry.testType)} &nbsp;${meta}</p>
            <p style="margin:0 0 8px;font:600 17px/1.4 ${FONT};"><a href="${escapeHtml(link)}" style="color:${INK};text-decoration:none;">${escapeHtml(entry.title)}</a></p>
            <p style="margin:0;font:400 14px/1.6 ${FONT};color:${INK_2};">${escapeHtml(truncate(entry.summary, 220))}</p>
        </td></tr>`;
}

function renderDigestEmailHtml(entries, frequency, sub) {
    const period = frequency === 'weekly' ? 'this week' : 'this month';
    const n      = entries.length;
    const bodyHtml = `
        ${eyebrow(frequency === 'weekly' ? 'Weekly digest' : 'Monthly digest')}
        ${heading(`${n} new report${n !== 1 ? 's' : ''} ${period}`)}
        ${paragraph(`Here's what the lab has published ${period}. Each title links to the full report.`, { margin: '0 0 8px' })}
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top:2px solid ${GREEN};border-bottom:1px solid ${RULE};margin:0 0 28px;">
            ${entries.map((e, i) => digestItem(e, i === 0)).join('')}
        </table>
        ${buttons(button(SITE_URL, 'Browse the catalogue'))}`;

    return shell({
        preheader: entries.slice(0, 3).map(e => e.title).join(' · '),
        bodyHtml,
        footerHtml: footer(`You're receiving the ${frequency} digest because you subscribed to PoC Lab updates.`, sub.token),
    });
}

// ── Request approved (to the requester) ──────────────────────────────────
function renderApprovalEmailHtml(r, typeName, dueDate) {
    const name = escapeHtml(r.submitterName || 'there');

    const accessCode = r.accessCode ? callout('Your access code', `
        <p style="margin:0 0 8px;font:600 26px/1.2 ${MONO};color:${INK};letter-spacing:3px;">${escapeHtml(r.accessCode)}</p>
        <p style="margin:0;font:400 13px/1.55 ${FONT};color:${INK_2};">You'll need this to get into the lab. It's issued to you personally, so please don't share or forward it.</p>`) : '';

    const reportDue = `
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px;">
            <tr>
                <td bgcolor="#eaf3ff" style="background:#eaf3ff;border-left:4px solid #4d7fc4;border-radius:6px;padding:18px 20px;">
                    <p style="margin:0 0 6px;font:600 11px/1.4 ${FONT};color:#1d4ed8;text-transform:uppercase;letter-spacing:1.2px;">Report due</p>
                    <p style="margin:0 0 14px;font:400 14px/1.6 ${FONT};color:#1e293b;">A short report on the outcome is due within <strong>5 working days</strong> of the session ending${dueDate ? `, which makes it due by <strong>${escapeHtml(formatLongDate(dueDate))}</strong>` : ''}. Nothing will chase you for it, so please treat this email as your reminder.</p>
                    ${buttons(button(SITE_URL, 'Submit a report on the dashboard', { primary: false }))}
                </td>
            </tr>
        </table>`;

    const bodyHtml = `
        ${eyebrow(`${escapeHtml(typeName)} request approved`)}
        ${heading(escapeHtml(r.jobName || 'Your request'))}
        ${paragraph(`Hi ${name}, the lab team has reviewed your ${escapeHtml(typeName.toLowerCase())} request and approved it for the dates below.`)}
        ${factTable([
            ['Dates',  escapeHtml(formatDateRange(r.dateStart, r.dateEnd))],
            ['People', escapeHtml(r.persons || '—')],
        ])}
        ${accessCode}
        ${reportDue}
        ${paragraph(`Need to change something? Email <a href="mailto:${LAB_EMAIL}" style="color:${INK};text-decoration:underline;">${LAB_EMAIL}</a> and we'll sort it out.`, { size: 14, color: INK_3, margin: '16px 0 0' })}`;

    return shell({
        preheader: `Approved for ${formatDateRange(r.dateStart, r.dateEnd)}.`,
        bodyHtml,
        footerHtml: footer(),
    });
}

// ── Report from your request is published (to the requester) ─────────────
function renderCompleteEmailHtml(r, entry, typeName) {
    const bodyHtml = `
        <p style="margin:0 0 12px;">${typePill(entry.testType)} &nbsp;<span style="font:600 11px/1 ${FONT};color:${GREEN_INK};text-transform:uppercase;letter-spacing:1.2px;">Your report is published</span></p>
        ${heading(escapeHtml(entry.title))}
        ${paragraph(`Hi ${escapeHtml(r.submitterName || 'there')}, the report from your ${escapeHtml(typeName.toLowerCase())} request <strong style="color:${INK};">${escapeHtml(r.jobName || '')}</strong> is now in the PoC Lab catalogue.`)}
        ${reportFacts(entry)}
        ${paragraph(escapeHtml(entry.summary))}
        ${buttons(
            entry.fullReport ? button(entry.fullReport, 'Read the full report') : '',
            button(SITE_URL, 'Browse the catalogue', { primary: !entry.fullReport }),
        )}`;

    return shell({
        preheader: `${entry.title} is now in the PoC Lab catalogue.`,
        bodyHtml,
        footerHtml: footer(),
    });
}

// ── Break glass used (to the lab team) ───────────────────────────────────
function renderGlassBrokenEmailHtml({ cabinet, who, reason, when, ip }) {
    const bodyHtml = `
        ${eyebrow('Security alert', '#b42318')}
        ${heading('Emergency licence key released')}
        ${paragraph(`The break-glass cabinet was opened and the key was released to <strong style="color:${INK};">${escapeHtml(who)}</strong>.`)}
        ${factTable([
            ['Opened by', escapeHtml(who)],
            ['Reason',    escapeHtml(reason)],
            ['Key',       escapeHtml((cabinet && cabinet.label) || 'Emergency licence key')],
            ['Time',      escapeHtml(when)],
            ['IP address', escapeHtml(ip)],
        ])}
        ${paragraph(`The cabinet is now <strong style="color:${INK};">locked</strong> and nobody else can retrieve this key. To make emergency access available again, load a replacement key in the admin panel and re-arm it.`)}
        ${buttons(button(`${SITE_URL}/admin.html`, 'Open the admin panel'))}`;

    return shell({
        preheader: `Released to ${who}: ${reason}`,
        bodyHtml,
        footerHtml: footer(),
    });
}

return {
    escapeHtml,
    formatLongDate,
    renderInstantEmailHtml,
    renderDigestEmailHtml,
    renderApprovalEmailHtml,
    renderCompleteEmailHtml,
    renderGlassBrokenEmailHtml,
};
});
