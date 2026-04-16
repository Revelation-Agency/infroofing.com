/* ════════════════════════════════════════════════
   INF Roofing — Form Submission Handler
   Per-page webhook targets, validation, UTM capture
   Meta Pixel + CAPI event deduplication
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
  // 0. META CAPI HELPERS
  // ══════════════════════════════════════════════

  // Generates a unique event ID for browser↔server deduplication.
  // Same ID is passed to fbq() and the CAPI relay function.
  function generateEventId() {
    return 'evt_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9);
  }

  // Reads the _fbp cookie (Meta first-party cookie, auto-set by pixel).
  function getFbp() {
    var match = document.cookie.match(/(?:^|;\s*)_fbp=([^;]+)/);
    return match ? match[1] : '';
  }

  // Reads the _fbc cookie (set when visitor arrives via a Facebook ad click).
  // Falls back to constructing fbc from fbclid URL param if cookie is absent.
  function getFbc() {
    var match = document.cookie.match(/(?:^|;\s*)_fbc=([^;]+)/);
    if (match) return match[1];
    var fbclid = new URLSearchParams(window.location.search).get('fbclid');
    if (fbclid) return 'fb.1.' + Date.now() + '.' + fbclid;
    return '';
  }

  // Sends a server-side event to the CAPI relay. Fire-and-forget —
  // errors are logged but never shown to the visitor.
  function sendCAPIEvent(eventName, eventId, userData, customData) {
    var payload = {
      event_name:       eventName,
      event_id:         eventId,
      event_source_url: window.location.href,
      user_data:        userData  || {},
      custom_data:      customData || {}
    };
    fetch('/api/meta-capi', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload)
    }).catch(function (err) {
      console.warn('[CAPI] Failed to send ' + eventName + ':', err.message);
    });
  }

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

    // ── Generate event ID for Meta CAPI deduplication ──
    // Stored on the form element so onSuccess can access it.
    form._metaLeadEventId = generateEventId();

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
      email:         (form.querySelector('[name="email"]').value || '').trim(),
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
      onSuccess(wrap, form);
      return;
    }

    // ── POST to this page's dedicated webhook ──
    // We send as application/x-www-form-urlencoded via URLSearchParams.
    //
    // Why NOT application/json:
    //   "Content-Type: application/json" is not a CORS-safe header, so
    //   the browser must send an OPTIONS preflight to hooks.zapier.com.
    //   Zapier's preflight response is inconsistent — the browser may
    //   block the POST or strip the header, causing Zapier to see the
    //   body as an unparsed "querystring" blob with no field values.
    //
    // Why NOT text/plain (no Content-Type header):
    //   Zapier Catch Hook does NOT auto-detect JSON from a text/plain
    //   body.  The entire JSON string lands as a single "querystring"
    //   key with no value — all downstream fields are blank.
    //
    // Why application/x-www-form-urlencoded works:
    //   1. It is a CORS-safe "simple" Content-Type — no preflight.
    //   2. The browser sets the header automatically from URLSearchParams.
    //   3. Zapier Catch Hook parses every key=value pair into its own
    //      top-level field, exactly like flat JSON.
    //   4. Each field (first_name, last_name, phone, etc.) appears as
    //      an individual mapped field in the Zapier trigger output.
    var formBody = new URLSearchParams();
    Object.keys(payload).forEach(function (key) {
      formBody.append(key, payload[key] != null ? payload[key] : '');
    });

    fetch(WEBHOOK_URL, {
      method: 'POST',
      body:   formBody          // browser sets Content-Type automatically
    })
    .then(function(res) {
      if (res.ok || res.status === 0 || res.type === 'opaque') {
        onSuccess(wrap, form);
      } else {
        throw new Error('Webhook returned ' + res.status);
      }
    })
    .catch(function(err) {
      console.error('[INF Roofing] Submission error:', err);
      // For simple CORS requests the POST was still sent even if the
      // browser cannot read the response.  Show success to the visitor.
      console.log('[INF Roofing] Payload sent:', Object.fromEntries(formBody));
      onSuccess(wrap, form);
    });
  }

  function onSuccess(wrap, form) {
    var eventId = (form && form._metaLeadEventId) || generateEventId();

    // ── Meta Pixel: Lead (browser-side, with event ID for deduplication) ──
    if (typeof fbq === 'function') {
      fbq('track', 'Lead', {}, { eventID: eventId });
    }

    // ── CAPI: Lead (server-side mirror with same event ID) ──
    var f = form || {};
    var userData = {
      em:  (f.querySelector && f.querySelector('[name="email"]'))  ? f.querySelector('[name="email"]').value.trim()  : '',
      ph:  (f.querySelector && f.querySelector('[name="phone"]'))  ? f.querySelector('[name="phone"]').value.trim()  : '',
      fn:  (f.querySelector && f.querySelector('[name="fname"]'))  ? f.querySelector('[name="fname"]').value.trim()  : '',
      ln:  (f.querySelector && f.querySelector('[name="lname"]'))  ? f.querySelector('[name="lname"]').value.trim()  : '',
      ct:  (f.querySelector && f.querySelector('[name="city"]'))   ? f.querySelector('[name="city"]').value.trim()   : '',
      st:  'ca',
      zp:  (f.querySelector && f.querySelector('[name="zip"]'))    ? f.querySelector('[name="zip"]').value.trim()    : '',
      fbc: getFbc(),
      fbp: getFbp()
    };
    sendCAPIEvent('Lead', eventId, userData, { source: SOURCE });

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
    // ── CAPI: PageView — server-side mirror of the browser pixel PageView ──
    // The browser pixel fires fbq('track','PageView') in <head> with an event_id
    // stored as window._pvEventId.  We read that same ID here so both sides
    // share it and Meta can deduplicate correctly.
    var pageViewEventId = window._pvEventId || generateEventId();
    sendCAPIEvent('PageView', pageViewEventId, { fbc: getFbc(), fbp: getFbp() }, { source: SOURCE });

    var form = document.querySelector('.form-wrap form');
    if (form) {
      form.addEventListener('submit', handleFormSubmit);
    }

    // ── Meta Pixel + CAPI: Contact — fires on any tel: link click ──
    // Attached at the <a> level so nested SVG/span clicks bubble correctly.
    // Each click generates its own event ID for browser↔server deduplication.
    document.querySelectorAll('a[href^="tel:"]').forEach(function(link) {
      link.addEventListener('click', function() {
        var contactEventId = generateEventId();
        if (typeof fbq === 'function') {
          fbq('track', 'Contact', {}, { eventID: contactEventId });
        }
        sendCAPIEvent('Contact', contactEventId, { fbc: getFbc(), fbp: getFbp() }, { source: SOURCE });
      });
    });
  });

})();
