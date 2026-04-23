// Content script: inject external page script + forward events to background
console.log('[SYNC INTERCEPTOR V1] interceptor loaded');
(function () {
  try { console.log('[SYNC INTERCEPTOR V1] interceptor content loaded', window.location.href); } catch (e) {}

  try {
    var proto = (location && location.protocol) ? location.protocol : '';
    if (proto.indexOf('chrome') === 0 || proto.indexOf('chrome-extension') === 0 || proto.indexOf('about') === 0) {
      return;
    }
  } catch (e) {}

  var injUrl = '';

  // Inject page script as external file (CSP-safe vs inline text)
  try {
    var existing = document.getElementById("syncInjectedFetch");
    if (!existing) {
      injUrl = chrome.runtime.getURL('src/content-scripts/injected_fetch.js');
      try { console.log('[SYNC] Trying to inject from:', injUrl); } catch (e) {}
      var s = document.createElement('script');
      s.id = "syncInjectedFetch";
      s.src = injUrl;
      s.type = 'text/javascript';
      s.async = false;
      s.onload = function () {
        try { console.log('[SYNC] injected_fetch.js loaded into page context'); } catch (e) {}
        try { s.remove(); } catch (e) {}
      };
      s.onerror = function (err) {
        try { console.error('[SYNC] FAILED to inject page script', err); } catch (e) {}
      };
      var root = document.head || document.documentElement;
      if (root) root.appendChild(s);
    } else {
      try { console.log("[SYNC] injected_fetch already present"); } catch (e) {}
    }
  } catch (e) {}

  // Bridge page -> extension
  window.addEventListener('message', function (event) {
    try {
      if (event.source !== window) return;
      var msg = event.data;
      if (!msg) return;
      if (msg.source === 'SYNC_INJECTED') {
        try {
          var u = msg.url || '';
          try { console.log('[SYNC] Received intercepted data:', msg.type, (u || '').slice(0,80)); } catch (e) {}
          chrome.runtime.sendMessage({
            type: 'API_INTERCEPTED',
            intercept_kind: msg.type,
            url: u,
            data: msg.payload,
            platform: msg.platform,
            timestamp: Date.now()
          }, function () {});
        } catch (e) {}
        return;
      }
      if (msg.type === "SYNC_INJECTED_READY") {
        try { console.log("[SYNC] injected ready"); } catch (e) {}
        return;
      }
    } catch (e) {}
  }, false);
})();
