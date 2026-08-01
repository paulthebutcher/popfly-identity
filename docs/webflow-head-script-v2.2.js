/**
 * Popfly attribution script v2.2 — Webflow head embed (spec §5: five edits).
 * REPLACES v2.1 in Webflow Site Settings → Custom Code → Head Code, wrapped
 * in <script>…</script>.
 *
 * DO NOT DEPLOY before the identity endpoint is live at popfly.com/e
 * (Build Plan Phase 3) — every network call here fails silently if the
 * endpoint is absent, but you'd be shipping dead weight.
 *
 * v2.2 changes over v2.1:
 *   1. gad_source, gad_campaignid, msclkid added to TRACKING_PARAMS.
 *   2. POST /e/v on load; adopts the server's visitor_id (durable HttpOnly
 *      cookie) and session_id (server owns session boundaries).
 *   3. Capture-phase submit → sendBeacon /e/collect (fetch keepalive
 *      fallback). Native Webflow submission untouched — email notifications
 *      keep working.
 *   4. Honeypot website_url injected into forms + form_age_ms; ?debug=pf now
 *      also logs the server's channel classification.
 *   5. rb2b_id captured from RB2B's _reb2buid (localStorage, cookie fallback).
 *
 * BEFORE PASTING: verify the hidden-field names on the /start/new form match
 * the keys produced by getFormValues() below (spec §3 says they match
 * v2.1's names; confirm nothing was renamed in the Webflow designer).
 */
(function () {
  "use strict";

  var ENDPOINT = "/e";
  var DEBUG = /[?&]debug=pf(&|$)/.test(location.search);
  var TRACKING_PARAMS = [
    "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term",
    "gclid", "gad_source", "gad_campaignid", "msclkid", "li_fat_id", "fbclid", "grsf",
  ];
  var LS_VISITOR = "_pf_visitor_id";
  var LS_FIRST = "_pf_first_touch";
  var SS_SESSION = "pf_session";
  var loadedAt = Date.now();

  function log() {
    if (DEBUG && window.console) console.log.apply(console, ["[pf v2.2]"].concat([].slice.call(arguments)));
  }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function ssGet(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } }
  function ssSet(k, v) { try { sessionStorage.setItem(k, v); } catch (e) {} }
  function readCookie(name) {
    var m = ("; " + document.cookie).split("; " + name + "=");
    return m.length === 2 ? decodeURIComponent(m.pop().split(";")[0]) : null;
  }
  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
    });
  }
  function currentParams() {
    var out = {};
    try {
      var sp = new URLSearchParams(location.search);
      for (var i = 0; i < TRACKING_PARAMS.length; i++) {
        var v = sp.get(TRACKING_PARAMS[i]);
        if (v) out[TRACKING_PARAMS[i]] = v;
      }
    } catch (e) {}
    return out;
  }

  // --- Visitor ID: localStorage for continuity; the server cookie is
  // authoritative and adopted below (write-through, spec §5 item 2).
  var visitorId = lsGet(LS_VISITOR);
  if (!visitorId || !/^v_[A-Za-z0-9-]{8,64}$/.test(visitorId)) {
    visitorId = "v_" + uuid();
    lsSet(LS_VISITOR, visitorId);
  }

  // --- First-touch object: kept for backward compat with the flat hidden
  // fields; the server-side touch log is the authoritative history.
  var firstTouch = null;
  try { firstTouch = JSON.parse(lsGet(LS_FIRST) || "null"); } catch (e) {}
  if (!firstTouch || !firstTouch.landing_page) {
    firstTouch = {
      landing_page: location.href,
      landing_timestamp: new Date().toISOString(),
      landing_referrer: document.referrer || "",
      params: currentParams(),
    };
    lsSet(LS_FIRST, JSON.stringify(firstTouch));
  }

  // --- GrowSurf: persist grsf as a cookie (v2.1 behavior, unchanged).
  (function () {
    var grsf = currentParams().grsf;
    if (grsf) document.cookie = "grsf=" + encodeURIComponent(grsf) + "; Path=/; Max-Age=7776000; SameSite=Lax";
  })();

  // --- RB2B hard-key capture (spec §5 item 5; 0b outcome).
  function rb2bId() {
    return lsGet("_reb2buid") || readCookie("_reb2buid") || null;
  }

  // --- 1 pageload = 1 POST /e/v: identify + touch + pageview server-side.
  // text/plain avoids a CORS preflight and matches what /e/collect accepts.
  function identify() {
    var body = {
      url: location.href,
      referrer: document.referrer || null,
      session_hint: ssGet(SS_SESSION),
      rb2b_id: rb2bId(),
    };
    fetch(ENDPOINT + "/v", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: JSON.stringify(body),
      credentials: "same-origin",
      keepalive: true,
    })
      .then(function (r) { return r.json(); })
      .then(function (ids) {
        if (ids && ids.visitor_id && ids.visitor_id !== visitorId) {
          visitorId = ids.visitor_id; // converge on the durable server ID
          lsSet(LS_VISITOR, visitorId);
        }
        if (ids && ids.session_id) ssSet(SS_SESSION, ids.session_id);
        log("identified", ids, "channel:", ids && ids.channel);
        fillForms();
      })
      .catch(function (e) { log("identify failed (endpoint down?)", e); });
  }

  // --- Public interface (v2.1 compatible) + flat first-touch fields.
  function getFormValues() {
    var first = firstTouch.params || {};
    var cur = currentParams();
    var values = {
      visitor_id: visitorId,
      session_id: ssGet(SS_SESSION) || "",
      landing_page: firstTouch.landing_page || "",
      landing_timestamp: firstTouch.landing_timestamp || "",
      landing_referrer: firstTouch.landing_referrer || "",
      conversion_page: location.pathname,
    };
    for (var i = 0; i < TRACKING_PARAMS.length; i++) {
      var k = TRACKING_PARAMS[i];
      values[k] = cur[k] || first[k] || "";
    }
    values.grsf = values.grsf || readCookie("grsf") || "";
    return values;
  }
  window.PopflyTracking = { getFormValues: getFormValues, version: "2.2" };

  // --- Populate hidden fields + inject honeypot into every form.
  function fillForms() {
    var values = getFormValues();
    var forms = document.querySelectorAll("form");
    for (var i = 0; i < forms.length; i++) {
      var form = forms[i];
      for (var key in values) {
        var input = form.querySelector('input[name="' + key + '"]');
        if (input) input.value = values[key];
      }
      if (!form.querySelector('input[name="website_url"]')) {
        var hp = document.createElement("input");
        hp.type = "text";
        hp.name = "website_url";
        hp.autocomplete = "off";
        hp.tabIndex = -1;
        hp.setAttribute("aria-hidden", "true");
        hp.style.cssText = "position:absolute;left:-9999px;width:1px;height:1px;opacity:0";
        form.appendChild(hp);
      }
    }
    log("forms filled", values);
  }

  // --- Capture-phase submit: repopulate, then beacon to /e/collect.
  // Native Webflow submission proceeds untouched (email notification only).
  document.addEventListener(
    "submit",
    function (ev) {
      var form = ev.target;
      if (!form || form.nodeName !== "FORM") return;

      var payload = getFormValues();
      for (var i = 0; i < form.elements.length; i++) {
        var el = form.elements[i];
        if (!el.name || el.type === "password" || el.type === "file" || el.type === "submit") continue;
        if ((el.type === "checkbox" || el.type === "radio") && !el.checked) continue;
        payload[el.name] = el.value;
      }
      // The endpoint requires an `email` key; Webflow field names vary
      // (Email, email-2, …), so normalize from the email-typed input.
      if (!payload.email) {
        var emailInput = form.querySelector('input[type="email"]');
        if (emailInput) payload.email = emailInput.value;
      }
      payload.form_id = form.getAttribute("data-name") || form.id || "unknown";
      payload.form_age_ms = Date.now() - loadedAt;
      payload.source = "identity_endpoint";

      var body = JSON.stringify(payload);
      var sent = false;
      if (navigator.sendBeacon) {
        try { sent = navigator.sendBeacon(ENDPOINT + "/collect", new Blob([body], { type: "text/plain" })); } catch (e) {}
      }
      if (!sent) {
        fetch(ENDPOINT + "/collect", {
          method: "POST",
          headers: { "content-type": "text/plain" },
          body: body,
          credentials: "same-origin",
          keepalive: true,
        }).catch(function () {});
      }
      log("collect beacon sent", payload);
    },
    true
  );

  identify();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", fillForms);
  } else {
    fillForms();
  }
})();
