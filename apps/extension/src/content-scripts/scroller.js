console.log('[SYNC SCROLLER V1] scroller loaded');

let syncDeepScanRunning = false;
let syncDeepScanStopRequested = false;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function randInt(min, max) {
  return Math.floor(min + Math.random() * (max - min + 1));
}

function requestBeforeScroll() {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage({ type: 'RL_BEFORE_SCROLL' }, (res) => {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, reason: 'bg_unreachable' });
        } else {
          resolve(res || { ok: false, reason: 'no_response' });
        }
      });
    } catch (e) {
      resolve({ ok: false, reason: 'bg_unreachable' });
    }
  });
}

async function stoppableSleep(totalMs) {
  const ms = Math.max(0, Number(totalMs || 0));
  const started = Date.now();
  while (true) {
    if (syncDeepScanStopRequested) return;
    const elapsed = Date.now() - started;
    if (elapsed >= ms) return;
    await sleep(100);
  }
}

async function runDeepScan(durationSeconds, maxScrolls) {
  const startedAt = Date.now();
  const durationMs = Math.max(1, Number(durationSeconds || 0)) * 1000;
  const max = Math.max(1, Number(maxScrolls || 0));

  let scrolls = 0;
  let totalPx = 0;
  let stopReason = null;

  while (true) {
    if (syncDeepScanStopRequested) break;
    const now = Date.now();
    if ((now - startedAt) >= durationMs) break;
    if (scrolls >= max) break;

    const rl = await requestBeforeScroll();
    if (!rl || rl.ok !== true) {
      stopReason = rl && rl.reason ? rl.reason : 'rate_limited';
      break;
    }

    const plan = rl.plan || {};
    const dist = Math.max(1, Number(plan.distancePx || randInt(300, 800)));
    const dir = (Number(plan.direction) < 0) ? -1 : 1;
    const px = dir * dist;

    try { window.scrollBy({ top: px, left: 0, behavior: 'smooth' }); } catch (e) { try { window.scrollBy(0, px); } catch (e2) { } }
    totalPx += Math.abs(px);
    scrolls += 1;

    const delayMs = Math.max(0, Number(plan.delayMs || randInt(2000, 6000)));
    const readingPauseMs = Math.max(0, Number(plan.readingPauseMs || 0));
    const longPauseMs = Math.max(0, Number(plan.longPauseMs || 0));
    await stoppableSleep(delayMs + readingPauseMs + longPauseMs);
  }

  const stopped = !!syncDeepScanStopRequested || !!stopReason;
  return { ok: true, done: true, stopped, stop_reason: stopReason || (syncDeepScanStopRequested ? 'manual_stop' : null), scrolls, total_px: totalPx };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.type) return;

  if (msg.type === 'STOP_DEEP_SCAN') {
    syncDeepScanStopRequested = true;
    sendResponse({ ok: true, stopped: true });
    return;
  }

  if (msg.type !== 'DEEP_SCAN_START') return;

  console.log('[SYNC SCROLLER V1] handling DEEP_SCAN_START');

  if (syncDeepScanRunning) {
    console.log('[SYNC SCROLLER V1] deep scan start failed: already_running');
    sendResponse({ ok: false, error: 'already_running' });
    return;
  }

  syncDeepScanRunning = true;
  syncDeepScanStopRequested = false;

  (async () => {
    try {
      const durationSeconds = msg.duration_seconds || 45;
      const maxScrolls = msg.max_scrolls || msg.totalScrolls || 30;
      const result = await runDeepScan(durationSeconds, maxScrolls);
      console.log('[SYNC SCROLLER V1] deep scan done, sending response');
      sendResponse(result);
    } catch (e) {
      console.log('[SYNC SCROLLER V1] deep scan error, sending response');
      sendResponse({ ok: false, error: e && e.message ? e.message : 'deep_scan_failed' });
    } finally {
      syncDeepScanRunning = false;
      syncDeepScanStopRequested = false;
    }
  })();

  return true;
});
