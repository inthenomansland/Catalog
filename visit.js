// ── Visitor sign-in kiosk ─────────────────────────────────────────────────
// Usually runs on a shared tablet at the lab door, so nothing a visitor types
// is remembered: the form resets itself after each person, and autocomplete is
// off so the next visitor is not offered the last one's email address.
//
// There is no sign-out. Everyone signed in is taken to have left by the end of
// the day, so the access log records arrivals only.

const OTHER_VALUE    = '__other';
const RESET_SECONDS  = 8;
let   resetTimer     = null;
let   termsVersion   = null;

function showMessage(id, text) {
    const el = document.getElementById(id);
    el.textContent = text;
    el.hidden      = !text;
}

async function serverError(res, fallback) {
    try {
        const body = await res.json();
        return body && body.error ? body.error : fallback;
    } catch {
        return fallback;
    }
}

// ── Bookings dropdown ─────────────────────────────────────────────────────
async function loadBookings() {
    const select = document.getElementById('visit-booking');
    let bookings = [];
    try {
        const res = await fetch('/api/visit/bookings');
        if (res.ok) bookings = await res.json();
    } catch { /* the "other" option still lets them sign in */ }

    select.innerHTML = '';
    select.appendChild(new Option(bookings.length ? 'Choose a booking...' : 'Choose...', ''));
    bookings.forEach(b => {
        const label = `${b.jobName} (${b.type === 'bench' ? 'Bench Test' : 'PoC'})`;
        select.appendChild(new Option(label, b.id));
    });
    select.appendChild(new Option('Not part of a booking / other', OTHER_VALUE));
    toggleOther();
}

function toggleOther() {
    const other = document.getElementById('visit-booking').value === OTHER_VALUE;
    document.getElementById('visit-purpose-field').hidden = !other;
}

// ── Terms & conditions ────────────────────────────────────────────────────
// Lifted from the dashboard page rather than duplicated, so a visitor agrees to
// exactly the wording — and version — that a booker does.
async function loadTerms() {
    const body = document.getElementById('terms-body');
    try {
        const res = await fetch('/');
        if (!res.ok) throw new Error('terms unavailable');
        const doc   = new DOMParser().parseFromString(await res.text(), 'text/html');
        const terms = doc.querySelector('#terms-modal-overlay .terms-content');
        if (!terms || !terms.dataset.version) throw new Error('terms not found');

        termsVersion = terms.dataset.version;
        body.innerHTML = terms.innerHTML;
        document.getElementById('terms-subtitle').textContent =
            `Version ${termsVersion} — please read before signing in.`;
    } catch {
        body.innerHTML = '<p>The terms could not be loaded. Please ask a member of the lab team, or email <a href="mailto:poc.lab@proav.com">poc.lab@proav.com</a>.</p>';
    }
}

function openTermsModal() {
    document.getElementById('terms-modal-overlay').classList.remove('hidden');
    document.body.style.overflow = 'hidden';
}

function closeTermsModal(event) {
    if (event && event.target !== document.getElementById('terms-modal-overlay')) return;
    document.getElementById('terms-modal-overlay').classList.add('hidden');
    document.body.style.overflow = '';
}

// ── Sign in ───────────────────────────────────────────────────────────────
async function submitSignIn(event) {
    event.preventDefault();

    const val     = id => document.getElementById(id).value.trim();
    const booking = document.getElementById('visit-booking').value;
    const accepted = document.getElementById('visit-terms').checked;
    const body    = {
        name:          val('visit-name'),
        company:       val('visit-company'),
        email:         val('visit-email'),
        phone:         val('visit-phone'),
        host:          val('visit-host'),
        requestId:     booking && booking !== OTHER_VALUE ? booking : '',
        purpose:       booking === OTHER_VALUE ? val('visit-purpose') : '',
        termsAccepted: accepted,
        termsVersion,
        _hp:           document.getElementById('hp-visit').value,
    };

    // Checked here for a quick answer; the server checks all of it again.
    const missing =
        !body.name    ? ['visit-name',    'Please enter your full name.'] :
        !body.company ? ['visit-company', 'Please enter the company you are from.'] :
        !body.email   ? ['visit-email',   'Please enter your email address.'] :
        !body.phone   ? ['visit-phone',   'Please enter your phone number.'] :
        !booking      ? ['visit-booking', 'Please choose what you are here for.'] :
        booking === OTHER_VALUE && !body.purpose ? ['visit-purpose', 'Please tell us the reason for your visit.'] :
        !accepted     ? ['visit-terms',   'Please read and accept the terms and conditions before signing in.'] :
        !termsVersion ? ['visit-terms',   'The terms could not be loaded, so sign-in is unavailable. Please ask a member of the lab team.'] :
        null;
    if (missing) {
        showMessage('signin-msg', missing[1]);
        document.getElementById(missing[0]).focus();
        return;
    }

    const btn = document.getElementById('signin-btn');
    btn.disabled    = true;
    btn.textContent = 'Signing in...';
    showMessage('signin-msg', '');

    try {
        const res = await fetch('/api/visit/sign-in', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify(body),
        });
        if (!res.ok) {
            showMessage('signin-msg', await serverError(res, 'Could not sign you in — please try again.'));
            // A booking that closed while the form was open: refresh the list.
            if (res.status === 400) loadBookings();
            return;
        }
        const data  = await res.json();
        const first = String(data.name || body.name).split(' ')[0];
        showDone(
            data.alreadySignedIn ? `You're already signed in, ${first}` : `Welcome, ${first}`,
            data.alreadySignedIn
                ? 'We already have you on the list for today.'
                : "You're signed in. Enjoy your visit to the PoC Lab."
        );
    } catch {
        showMessage('signin-msg', 'Network error — please try again.');
    } finally {
        btn.disabled    = false;
        btn.textContent = 'Sign in';
    }
}

// ── Confirmation + reset ──────────────────────────────────────────────────
function showDone(title, text) {
    document.getElementById('signin-form').hidden = true;
    document.getElementById('visit-done').hidden  = false;
    document.getElementById('visit-done-title').textContent = title;
    document.getElementById('visit-done-text').textContent  = text;

    let left = RESET_SECONDS;
    const countdown = document.getElementById('visit-done-countdown');
    countdown.textContent = `Returning to the start in ${left}s`;
    clearInterval(resetTimer);
    resetTimer = setInterval(() => {
        left -= 1;
        if (left <= 0) return resetKiosk();
        countdown.textContent = `Returning to the start in ${left}s`;
    }, 1000);
}

function resetKiosk() {
    clearInterval(resetTimer);
    document.getElementById('signin-form').reset();
    showMessage('signin-msg', '');
    loadBookings();
    document.getElementById('visit-done').hidden  = true;
    document.getElementById('signin-form').hidden = false;
    document.getElementById('visit-name').focus();
}

document.addEventListener('DOMContentLoaded', () => {
    loadBookings();
    loadTerms();
});
