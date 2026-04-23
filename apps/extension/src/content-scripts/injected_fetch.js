console.log('[SYNC] injected_fetch loaded in page context');
(function () {
  try {
    window.postMessage({ type: 'SYNC_INJECTED_READY', ts: Date.now() }, '*');
  } catch (e) {}

  function detectPlatform() {
    try {
      var h = (location.hostname || '').toLowerCase();
      if (h.indexOf('instagram.com') !== -1) return 'instagram';
      if (h.indexOf('twitter.com') !== -1) return 'twitter';
      if (h.indexOf('x.com') !== -1) return 'x';
      if (h.indexOf('facebook.com') !== -1) return 'facebook';
    } catch (e) {}
    return 'unknown';
  }

  function isRelevantAPI(u) {
    try {
      var url = new URL(u, location.href);
      var host = (url.hostname || '').toLowerCase();
      var path = (url.pathname || '').toLowerCase();
      if (host.indexOf('x.com') !== -1 || host.indexOf('twitter.com') !== -1) {
        if (path.indexOf('/i/api/graphql/') !== -1) return true;
        if (path.indexOf('/i/api/2/') !== -1) return true;
        return false;
      }
      if (host.indexOf('instagram.com') !== -1) {
        if (path.indexOf('/api') !== -1 || path.indexOf('graphql') !== -1 || path.indexOf('/ajax/') !== -1) return true;
      }
      if (host.indexOf('facebook.com') !== -1) {
        if (path.indexOf('/api') !== -1 || path.indexOf('graphql') !== -1) return true;
      }
      if (path.indexOf('/api') !== -1) return true;
    } catch (e) {}
    return false;
  }

  function postIntercept(kind, url, payload) {
    try {
      window.postMessage({
        source: 'SYNC_INJECTED',
        type: kind,
        url: url || '',
        platform: detectPlatform(),
        payload: payload
      }, '*');
    } catch (e) {}
  }

  try {
    var _fetch = window.fetch;
    if (typeof _fetch === 'function') {
      window.fetch = function () {
        var args = arguments;
        var url = '';
        try {
          var a0 = args[0];
          if (typeof a0 === 'string') url = a0;
          else if (a0 && typeof a0 === 'object' && a0.url) url = a0.url;
        } catch (e) {}
        return _fetch.apply(this, args).then(function (res) {
          try {
            try {
              if (res && res.status === 429) {
                postIntercept('HTTP_429_DETECTED', url, { status: 429, via: 'fetch' });
              }
            } catch (e) {}
            if (isRelevantAPI(url)) {
              try { if (detectPlatform() === 'x') console.log('[X Intercept] matched URL:', url); } catch (e) {}
              var clone = res.clone();
              clone.text().then(function (txt) {
                try {
                  var json = JSON.parse(txt);
                  postIntercept('FETCH_INTERCEPTED', url, json);
                } catch (e) {}
              }).catch(function () {});
            }
          } catch (e) {}
          return res;
        });
      };
    }
  } catch (e) {}

  try {
    var _open = XMLHttpRequest.prototype.open;
    var _send = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (m, u) {
      try { this.__sync_url = u; } catch (e) {}
      return _open.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function () {
      try {
        var self = this;
        var done = false;
        var onDone = function () {
          if (done) return;
          done = true;
          try {
            var u = self.__sync_url || '';
            try {
              if (self && self.status === 429) {
                postIntercept('HTTP_429_DETECTED', u, { status: 429, via: 'xhr' });
              }
            } catch (e) {}
            if (!isRelevantAPI(u)) return;
            try { if (detectPlatform() === 'x') console.log('[X Intercept] matched URL:', u); } catch (e) {}
            var txt = '';
            try { txt = self.responseText || ''; } catch (e) {}
            if (!txt) return;
            try {
              var json = JSON.parse(txt);
              postIntercept('XHR_INTERCEPTED', u, json);
            } catch (e) {}
          } catch (e) {}
        };
        this.addEventListener('load', onDone);
        this.addEventListener('readystatechange', function () {
          try { if (self.readyState === 4) onDone(); } catch (e) {}
        });
      } catch (e) {}
      return _send.apply(this, arguments);
    };
  } catch (e) {}
})(); 
