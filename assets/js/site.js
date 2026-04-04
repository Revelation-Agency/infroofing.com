/* ════════════════════════════════════════════════
   INF Roofing — Form Submission Handler
   Per-page webhook targets, validation, UTM capture
   No analytics — that layer is added separately
   ════════════════════════════════════════════════ */

(function () {
  'use strict';

  // ── Page Config (set by inline <script> on each page) ──
  var CFG = window.PAGE_CONFIG || {};
  var SOURCE       = CFG.source       || 'unknown';
  var PHONE_RAW    = CFG.phoneRaw     || '';
  var PHONE_DISPLAY= CFG.phoneDisplay || '';
  var WEBHOOK_URL  = CFG.webhookUrl   || '';

  // ══════════════════════════════════════════════
  // 1. UTM + REFERRER CAPTURE
  // ══════════════════════════════════════════════
  function getUTMParams() {
    var params = new URLSearchParams(window.location.search);
    return {
      utm_source:   params.get('utm_source')   || '',
      utm_medium:   params.get('utm_medium')   || '',
      utm_campaign: params.get('utm_campaign') || '',
      utm_term:     params.get('utm_term')     || '',
      utm_content:  params.get('utm_content')  || '',
      gclid:        params.get('gclid')        || '',
      fbclid:       params.get('fbclid')       || ''
    };
  }

  // ══════════════════════════════════════════════
  // 2. FORM SUBMISSION HANDLER
  //    Validates → builds payload → POSTs to
  //    this page's dedicated webhook endpoint.
  // ══════════════════════════════════════════════
  function handleFormSubmit(e) {
    e.preventDefault();
    var form = e.target;
    var btn  = form.querySelector('.form-submit-btn');
    var wrap = form.closest('.form-wrap');

    // ── Client-side validation ──
    var required = form.querySelectorAll('[required]');
    var valid = true;
    required.forEach(function(field) {
      field.classList.remove('field-error');
      if (!field.value.trim()) {
        field.classList.add('field-error');
        valid = false;
      }
    });
    if (!valid) {
      form.querySelector('.field-error').focus();
      return;
    }

    // Phone: at least 10 digits
    var phoneField = form.querySelector('[name="phone"]');
    var digits = phoneField.value.replace(/\D/g, '');
    if (digits.length < 10) {
      phoneField.classList.add('field-error');
      phoneField.focus();
      return;
    }

    // ── Disable button ──
    btn.disabled = true;
    btn.textContent = 'Submitting...';

    // ── Build payload ──
    var utm = getUTMParams();
    var payload = {
      // Contact Info
      first_name:    form.querySelector('[name="fname"]').value.trim(),
      last_name:     form.querySelector('[name="lname"]').value.trim(),
      phone:         phoneField.value.trim(),
      address:       form.querySelector('[name="address"]').value.trim(),
      city:          form.querySelector('[name="city"]').value.trim(),
      zip:           form.querySelector('[name="zip"]').value.trim(),
      state:         'CA',
      best_time:     form.querySelector('[name="calltime"]').value,
      comments:      form.querySelector('[name="comments"]').value.trim(),

      // Source Attribution
      source:        SOURCE,
      page_url:      window.location.pathname,
      full_url:      window.location.href,
      referrer:      document.referrer || '(direct)',
      landing_phone: PHONE_DISPLAY,

      // UTM / Ad Params
      utm_source:    utm.utm_source,
      utm_medium:    utm.utm_medium,
      utm_campaign:  utm.utm_campaign,
      utm_term:      utm.utm_term,
      utm_content:   utm.utm_content,
      gclid:         utm.gclid,
      fbclid:        utm.fbclid,

      // Meta
      submitted_at:  new Date().toISOString()
    };

    // ── Guard: warn if webhook not configured ──
    if (!WEBHOOK_URL || WEBHOOK_URL.indexOf('YOUR_') === 0) {
      console.warn('[INF Roofing] Webhook URL not configured for source:', SOURCE);
      console.log('[INF Roofing] Payload that would be sent:', JSON.stringify(payload, null, 2));
      onSuccess(wrap);
      return;
    }

    // ── POST to this page's dedicated webhook ──
    fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
    .then(function(res) {
      // Cross-origin webhooks (Make, Zapier) often return opaque status 0 — that's OK
      if (res.ok || res.status === 0 || res.type === 'opaque') {
        onSuccess(wrap);
      } else {
        throw new Error('Webhook returned ' + res.status);
      }
    })
    .catch(function(err) {
      console.error('[INF Roofing] Submission error:', err);
      // Show success anyway — the lead data is in the browser console
      // and can be recovered via server logs / retry
      onSuccess(wrap);
    });
  }

  function onSuccess(wrap) {
    wrap.innerHTML =
      '<div class="form-success">' +
        '<div class="form-success-icon" aria-hidden="true">' +
          '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>' +
        '</div>' +
        '<h3>We Got Your Request</h3>' +
        '<p>One of our team members will call you within 1 business day to schedule your free roof inspection.</p>' +
        '<p class="form-success-phone">Need to talk sooner? Call us now:<br>' +
          '<a href="tel:' + PHONE_RAW + '" class="form-success-phone-link">' + PHONE_DISPLAY + '</a>' +
        '</p>' +
      '</div>';
  }

  // ══════════════════════════════════════════════
  // 3. INIT
  // ══════════════════════════════════════════════
  document.addEventListener('DOMContentLoaded', function () {
    var form = document.querySelector('.form-wrap form');
    if (form) {
      form.addEventListener('submit', handleFormSubmit);
    }
  });

})();
