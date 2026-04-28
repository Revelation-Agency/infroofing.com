/* ════════════════════════════════════════════════
   INF Roofing — Consent Banner + Tracker Loader
   Loads Google Analytics + Meta Pixel only on
   explicit consent. Functional scripts (fonts,
   site.js, Zapier webhook) load regardless.
   Choice stored in localStorage as `consent.v1`.
   ════════════════════════════════════════════════ */

(function () {
  'use strict';

  var STORAGE_KEY = 'consent.v1';
  var GA_ID = 'G-X80HR36QTB';
  var FB_PIXEL_ID = '1010755291154748';

  var stored = null;
  try { stored = localStorage.getItem(STORAGE_KEY); } catch (e) { stored = null; }

  var listeners = [];
  var trackersLoaded = false;

  window.__consent = {
    status: stored,
    granted: stored === 'accepted',
    onChange: function (cb) { if (typeof cb === 'function') listeners.push(cb); },
    accept: function () { setStatus('accepted'); },
    decline: function () { setStatus('declined'); },
    reset: function () {
      try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
      window.__consent.status = null;
      window.__consent.granted = false;
      showBanner();
    }
  };

  function setStatus(value) {
    try { localStorage.setItem(STORAGE_KEY, value); } catch (e) {}
    window.__consent.status = value;
    window.__consent.granted = (value === 'accepted');
    if (value === 'accepted') loadTrackers();
    if (value === 'declined') clearTrackingCookies();
    hideBanner();
    listeners.forEach(function (cb) { try { cb(value); } catch (e) {} });
  }

  // Actively delete tracking cookies that may already exist on the device
  // from prior visits (before consent gating shipped). Targets:
  //   _fbp, _fbc           — Meta Pixel browser/click IDs
  //   _ga, _gid, _gat      — Google Analytics base cookies
  //   _ga_*  (e.g. _ga_X80HR36QTB)  — GA4 session cookies
  //   _gat_*               — GA throttle cookies
  // Cookies set by gtag.js / fbevents.js are typically scoped to the
  // registrable domain (e.g. `.infroofing.com`), but we sweep multiple
  // domain forms to be safe.
  function clearTrackingCookies() {
    var staticNames = ['_fbp', '_fbc', '_ga', '_gid', '_gat'];
    var hosts = [location.hostname, '.' + location.hostname];
    var parts = location.hostname.split('.');
    if (parts.length > 2) hosts.push('.' + parts.slice(-2).join('.'));

    var cookies = (document.cookie || '').split(';');
    for (var i = 0; i < cookies.length; i++) {
      var name = cookies[i].split('=')[0].trim();
      if (!name) continue;
      if (staticNames.indexOf(name) === -1 && !/^_ga_/.test(name) && !/^_gat_/.test(name)) continue;

      // Expire on each candidate domain scope...
      for (var j = 0; j < hosts.length; j++) {
        document.cookie = name + '=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; domain=' + hosts[j];
      }
      // ...and as a host-only cookie (no domain attribute).
      document.cookie = name + '=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
    }
  }

  function loadTrackers() {
    if (trackersLoaded) return;
    trackersLoaded = true;

    // Google Analytics (gtag.js)
    var ga = document.createElement('script');
    ga.async = true;
    ga.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA_ID;
    document.head.appendChild(ga);
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    window.gtag('js', new Date());
    window.gtag('config', GA_ID);

    // Meta Pixel
    window._pvEventId = 'pv_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9);
    !function (f, b, e, v, n, t, s) {
      if (f.fbq) return;
      n = f.fbq = function () { n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments); };
      if (!f._fbq) f._fbq = n;
      n.push = n; n.loaded = !0; n.version = '2.0'; n.queue = [];
      t = b.createElement(e); t.async = !0;
      t.src = v;
      s = b.getElementsByTagName(e)[0];
      s.parentNode.insertBefore(t, s);
    }(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');
    window.fbq('init', FB_PIXEL_ID);
    window.fbq('track', 'PageView', {}, { eventID: window._pvEventId });
  }

  // Banner
  function buildBanner() {
    var banner = document.createElement('div');
    banner.id = 'consent-banner';
    banner.setAttribute('role', 'dialog');
    banner.setAttribute('aria-live', 'polite');
    banner.setAttribute('aria-label', 'Cookie consent');
    banner.innerHTML =
      '<div class="consent-banner-inner">' +
        '<p class="consent-banner-text">We use cookies and similar technologies to improve the site, measure performance, and support marketing. You can accept or decline non-essential cookies. See our <a href="/privacy-policy/">Privacy Policy</a>.</p>' +
        '<div class="consent-banner-actions">' +
          '<button type="button" class="consent-btn" data-consent-action="decline">Decline</button>' +
          '<button type="button" class="consent-btn" data-consent-action="accept">Accept</button>' +
        '</div>' +
      '</div>';
    banner.querySelector('[data-consent-action="accept"]').addEventListener('click', function () { window.__consent.accept(); });
    banner.querySelector('[data-consent-action="decline"]').addEventListener('click', function () { window.__consent.decline(); });
    return banner;
  }

  function showBanner() {
    if (document.getElementById('consent-banner')) return;
    if (!document.body) return;
    document.body.appendChild(buildBanner());
  }

  function hideBanner() {
    var b = document.getElementById('consent-banner');
    if (b && b.parentNode) b.parentNode.removeChild(b);
  }

  function init() {
    if (window.__consent.granted) {
      // Previously-accepted users get trackers immediately
      loadTrackers();
    } else if (window.__consent.status === 'declined') {
      // Defensive: a returning decliner may still have tracking cookies
      // set during an earlier visit (before consent gating shipped, or
      // before they declined). Sweep them every page load.
      clearTrackingCookies();
    } else {
      // No decision yet — show banner
      showBanner();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
