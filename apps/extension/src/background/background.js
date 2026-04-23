try { importScripts('/utils/rate-limiter.js'); } catch (e) { console.error("Failed to load /utils/rate-limiter.js", e); }

// Constants
const DEFAULT_API_BASE = 'http://127.0.0.1:8001';
const POLL_ALARM_NAME = 'task_poll_once';
const POLL_MIN_DELAY_MS = 25000;
const POLL_MAX_DELAY_MS = 45000;
const X_INTERCEPT_FRESHNESS_MS = 300000; // 5 minutes
const RUNNER_WATCHDOG_TIMEOUT_MS = 120000; // 2 minutes
const X_QUIET_WINDOW_MS = 8000; // Phase 3 Quiet Window
const INVESTIGATE_TARGET_POSTS = 30;
const INVESTIGATE_MAX_SCROLLS = 6;
const INVESTIGATE_SCROLL_WAIT_MS = 2500;
const IG_DEDUPE_WINDOW_MS = 10000;
const igProcessSeen = new Map(); // key -> lastTs
const xPrimedTabs = new Map(); // tabId -> { taskId, normalizedUrl, lastInterceptAt, lastCaptureAt, metrics }
const igPrimedTabs = new Map(); // tabId -> { saved, duplicate, seenPostIds }
const igApiBuffer = new Map(); // tabId -> Array of posts
const finalizingTasks = new Set(); // taskId

const activeCaptures = new Map(); // "tabId-taskId" -> count
const settleTimers = new Map(); // "tabId-taskId" -> timeoutId
const loadWatchdogTimers = new Map(); // "tabId-taskId" -> timeoutId

let runnerBusy = false;
let runnerStartTime = 0;
let runnerLastProgressAt = 0;
let pollAuditCounter = 0; // Tracks cycles for global orphan cleanup

function triggerSettleTimer(tabId, taskId) {
    if (!tabId || !taskId) return;
    const key = `${tabId}-${taskId}`;
    
    // 1. Clear existing
    if (settleTimers.has(key)) {
        clearTimeout(settleTimers.get(key));
    }

    // 2. Set new 5s debounce
    const timeoutId = setTimeout(async () => {
        const stats = xPrimedTabs.get(tabId);
        const reason_arg = (stats && stats.metrics && stats.metrics.rate_limited) ? "rate_limited" : "settle_timeout";
        const sub_reason = (stats && stats.metrics && stats.metrics.rate_limit_reason) ? stats.metrics.rate_limit_reason : null;
        
        console.log(`[X Settle] Settle window expired for key: ${key}. Reason: ${reason_arg}`);
        await maybeAutoFinalizeTask(taskId, tabId, reason_arg, sub_reason);
    }, X_QUIET_WINDOW_MS);
    
    settleTimers.set(key, timeoutId);
}

function clearSettleState(tabId, taskId) {
    if (tabId && taskId) {
        const key = `${tabId}-${taskId}`;
        if (settleTimers.has(key)) clearTimeout(settleTimers.get(key));
        settleTimers.delete(key);
        if (loadWatchdogTimers.has(key)) clearTimeout(loadWatchdogTimers.get(key));
        loadWatchdogTimers.delete(key);
        activeCaptures.delete(key);
    } else if (tabId) {
        // Cleanup all for this tab
        for (const [key, timerId] of settleTimers.entries()) {
            if (key.startsWith(`${tabId}-`)) {
                clearTimeout(timerId);
                settleTimers.delete(key);
                activeCaptures.delete(key);
            }
        }
        for (const [key, timerId] of loadWatchdogTimers.entries()) {
            if (key.startsWith(`${tabId}-`)) {
                clearTimeout(timerId);
                loadWatchdogTimers.delete(key);
            }
        }
    }
}

function triggerLoadWatchdog(tabId, taskId) {
    if (!tabId || !taskId) return;
    const key = `${tabId}-${taskId}`;
    if (loadWatchdogTimers.has(key)) clearTimeout(loadWatchdogTimers.get(key));

    const tid = setTimeout(async () => {
        console.warn(`[Load Watchdog] Page load/usability timeout (45s) for ${key}. Marking task as failed.`);
        await maybeAutoFinalizeTask(taskId, tabId, "page_load_failed", "load_timeout");
    }, 45000); // 45s load timeout
    
    loadWatchdogTimers.set(key, tid);
}

async function markRunnerProgress(tabId = null) {
    runnerLastProgressAt = Date.now();
    if (tabId) {
        const state = await getActiveState();
        if (state.active_task && state.active_tab_id === tabId) {
            triggerSettleTimer(tabId, state.active_task.id);
        }
    }
}

function normalizeXUrl(url) {
    if (!url) return '';
    try {
        const u = new URL(url);
        // Normalize host (twitter.com -> x.com)
        if (u.hostname === 'twitter.com') u.hostname = 'x.com';
        // Normalize path and remove trailing slash
        let path = u.pathname.toLowerCase();
        if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
        
        // Search needs the 'q' parameter, ignore others to avoid redundant reloads
        if (path === '/search') {
            const q = u.searchParams.get('q');
            return `https://x.com/search?q=${q ? encodeURIComponent(q) : ''}`;
        }
        
        // Profile/Timeline/Dashboard: ignore all query/hash to avoid redundant reloads
        return `https://x.com${path}`;
    } catch (e) {
        return url;
    }
}

function igCleanup(now) {
    try {
        const keys = Array.from(igProcessSeen.keys());
        for (let i = 0; i < keys.length; i++) {
            const k = keys[i];
            const ts = igProcessSeen.get(k);
            if (!ts || (now - ts) > IG_DEDUPE_WINDOW_MS) igProcessSeen.delete(k);
        }
    } catch (e) { }
}

function randInt(min, max) {
    return Math.floor(Math.ceil(min) + Math.random() * (Math.floor(max) - Math.ceil(min) + 1));
}

function scheduleNextPoll(reason) {
    const delayMs = randInt(POLL_MIN_DELAY_MS, POLL_MAX_DELAY_MS);
    const when = Date.now() + delayMs;
    try {
        chrome.alarms.create(POLL_ALARM_NAME, { when });
        chrome.storage.local.set({
            next_poll_at: new Date(when).toISOString(),
            next_poll_reason: reason || null
        });
    } catch (e) { }
}

try { if (self.RateLimiter && self.RateLimiter.initializeRateLimiterState) self.RateLimiter.initializeRateLimiterState(); } catch (e) { }

// Error helpers
function setTaskError(message) {
    try {
        chrome.storage.local.set({
            task_last_error: message || 'unknown',
            task_last_error_at: new Date().toISOString()
        });
    } catch (e) { }
}
function clearTaskError() {
    try {
        chrome.storage.local.set({
            task_last_error: null,
            task_last_error_at: null
        });
    } catch (e) { }
}
function setCaptureError(message) {
    try {
        chrome.storage.local.set({
            capture_last_error: message || 'unknown',
            capture_last_error_at: new Date().toISOString()
        });
    } catch (e) { }
}
function clearCaptureError() {
    try {
        chrome.storage.local.set({
            capture_last_error: null,
            capture_last_error_at: null
        });
    } catch (e) { }
}

// Helper: Get Base URL
async function getApiBase() {
    return new Promise(resolve => {
        chrome.storage.local.get(['backend_base_url'], (res) => {
            resolve(res.backend_base_url || DEFAULT_API_BASE);
        });
    });
}

// Helpers
function setEvent(eventString) {
    chrome.storage.local.set({
        last_event: eventString,
        last_event_at: new Date().toISOString()
    });
}

function setError(errorString, url = "") {
    chrome.storage.local.set({
        last_error: errorString,
        last_error_at: new Date().toISOString(),
        last_error_url: url,
        last_event: "CLAIM ERROR"
    });
}

async function patchStatus(taskId, status, resultSummary = {}) {
    if (!taskId) return false;
    try {
        const apiBase = await getApiBase();
        const url = `${apiBase}/api/tasks/${taskId}/status`;
        const payload = { status, result_summary: resultSummary };
        const res = await fetch(url, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!res.ok) {
            console.warn(`Failed to patch task ${taskId}`, res.status);
            return false;
        }
        return true;
    } catch (e) {
        const apiBase = await getApiBase(); // re-fetch for error path
        setError(`Patch Error: ${e.message}`, `${apiBase}/api/tasks/${taskId}/status`);
        return false;
    }
}

async function saveTrendingSnapshot(payload) {
    try {
        const apiBase = await getApiBase();
        const url = `${apiBase}/api/results/trending/snapshot`;
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!res.ok) {
            let detail = "";
            try {
                detail = await res.text();
            } catch (e) { }
            console.warn(`[Trending] Failed to save snapshot`, res.status, detail);
            return { ok: false, error: `${res.status}${detail ? `: ${detail}` : ""}` };
        }
        return await res.json();
    } catch (e) {
        console.error("[Trending] Save Error:", e);
        return { ok: false, error: e.message };
    }
}

async function maybeAutoFinalizeTask(taskId, tabId, reason, loadFailureReason = null) {
    if (!taskId || finalizingTasks.has(taskId)) return;
    
    // SCOPED BUSY CHECK (skip if it's an explicit load failure)
    const key = `${tabId}-${taskId}`;
    if (reason !== "page_load_failed") {
        const inFlight = activeCaptures.get(key) || 0;
        if (inFlight > 0) {
            console.log(`[Auto-Finalize] Task ${taskId} has ${inFlight} captures in flight. Rescheduling settle...`);
            triggerSettleTimer(tabId, taskId);
            return;
        }
    }

    finalizingTasks.add(taskId);

    try {
        // 1. Double check current task state matches session
        const state = await getActiveState();
        if (!state.active_task || state.active_task.id !== taskId || state.active_tab_id !== tabId) {
            console.log(`[Auto-Finalize] Session mismatch for task ${taskId} or tab ${tabId}. Aborting.`);
            finalizingTasks.delete(taskId);
            return;
        }

        // 3. Initialize Summary and Determine Outcome (Step 1.2 Truth Handling)
        const primed = xPrimedTabs.get(tabId);
        const saved = primed?.metrics?.saved || 0;
        const duplicate = primed?.metrics?.duplicate || 0;
        const total = saved + duplicate;
        const scrolls = primed?.scrollsAttempted || 0;
        const streak = primed?.noNewPostsStreak || 0;

        let status = 'completed';
        let summary = { 
            step: 'auto_finalize',
            reason: reason || 'session_settled',
            posts_captured: saved, // Backend usually expects newly saved count
            duplicates_seen: duplicate,
            scrolls_attempted: scrolls,
            no_new_posts_streak: streak,
            capture_target: INVESTIGATE_TARGET_POSTS,
            outcome: 'success'
        };

        // 2. Deep Capture Logic for investigate_user (Step 3)
        if (state.active_task.type === 'investigate_user' && reason !== "page_load_failed" && reason !== "manual_stop") {
            if (saved < INVESTIGATE_TARGET_POSTS && scrolls < INVESTIGATE_MAX_SCROLLS && streak < 2) {
                console.log(`[X Deep Capture] Target not reached (${saved}/${INVESTIGATE_TARGET_POSTS}). Triggering scroll ${scrolls + 1}/${INVESTIGATE_MAX_SCROLLS}...`);
                finalizingTasks.delete(taskId);
                
                await triggerControlledScroll(tabId, taskId, INVESTIGATE_MAX_SCROLLS - scrolls);
                return;
            }
            console.log(`[X Deep Capture] Capture goal reached or limit hit. Saved: ${saved}, Scrolls: ${scrolls}, Streak: ${streak}. Finalizing...`);
        }

        if (reason === "page_load_failed") {
            status = "failed";
            summary.outcome = loadFailureReason || "page_load_failed";
            summary.reason = loadFailureReason || "unknown_load_failure";
        } else if (reason === "stale_recovery") {
            status = "failed";
            summary.outcome = "stale_recovery";
            summary.reason = loadFailureReason || "task_stalled_or_worker_restarted";
        } else if (reason === "rate_limited") {
            // A rate limit block is a safety outcome, not a bug
            status = saved > 0 ? "completed" : "failed"; 
            summary.outcome = "rate_limited";
            summary.reason = loadFailureReason || "max_sessions_or_posts_per_session";
            summary.warning = "Safety limits reached - partial results saved.";
        } else if (saved === 0) {
            status = 'failed';
            summary.outcome = "zero_results";
            summary.last_zero_reason = primed?.lastZeroReason || 'no_posts_found';
        }

        console.log(`[Auto-Finalize] Task ${taskId} marked ${status} via ${reason}. (Full session metrics: Saved=${saved}, Duplicates=${duplicate})`);

        // 3. Patch Status
        const ok = await patchStatus(taskId, status, summary);
        
        // 4. Cleanup only on SUCCESS
        if (ok) {
            await new Promise(r => chrome.storage.local.remove(['active_task', 'active_task_claimed_at', 'active_tab_id'], r));
            chrome.action.setBadgeText({ text: '' });
            xPrimedTabs.delete(tabId); // Clear session metrics for this tab
            clearSettleState(tabId, taskId); // Cleanup timers
            setEvent(`AUTO-FINALIZED: ${status}`);
        } else {
            console.warn(`[Auto-Finalize] Patch failed for task ${taskId}. Keeping local state.`);
        }
    } catch (e) {
        console.error("[Auto-Finalize] Error during finalization", e);
    } finally {
        finalizingTasks.delete(taskId);
    }
}

async function clearActiveState() {
    const s = await getActiveState();
    if (s.active_task && s.active_tab_id) {
        clearSettleState(s.active_tab_id, s.active_task.id);
    }
    await new Promise(r => chrome.storage.local.remove(['active_task', 'active_task_claimed_at', 'active_tab_id'], r));
    chrome.action.setBadgeText({ text: '' });
    xPrimedTabs.clear(); // Clear all priming (Step 1.1d)
}

async function recoverStaleTasks() {
    const now = Date.now();
    const state = await getActiveState();
    
    // 1. Local Stale Recovery (15 mins)
    if (state.active_task && state.active_task_claimed_at) {
        const claimedAt = new Date(state.active_task_claimed_at).getTime();
        const diffMs = now - claimedAt;
        if (diffMs > 15 * 60 * 1000) { // 15 minutes
            console.warn(`[Recovery] Local task ${state.active_task.id} is stale (>15m). Finalizing as failed.`);
            await maybeAutoFinalizeTask(state.active_task.id, state.active_tab_id, "stale_recovery", "local_stale_timeout");
        }
    }

    // 2. Global Orphan Audit (Occasional - every 10 polls, 30 mins old)
    pollAuditCounter++;
    if (pollAuditCounter >= 10) {
        pollAuditCounter = 0;
        try {
            const apiBase = await getApiBase();
            const res = await fetch(`${apiBase}/api/tasks?status=in_progress&limit=20`);
            if (res.ok) {
                const data = await res.json();
                const tasks = data.items || [];
                for (const t of tasks) {
                    // Skip if it's our current active task
                    if (state.active_task && t.id === state.active_task.id) continue;
                    
                    const createdAt = new Date(t.created_at).getTime();
                    if (now - createdAt > 30 * 60 * 1000) { // 30 minutes
                        console.warn(`[Recovery] Global orphan task ${t.id} found stuck in_progress (>30m). Failing it.`);
                        await patchStatus(t.id, "failed", { 
                            outcome: "stale_recovery", 
                            reason: "stale_orphan_recovery",
                            step: "global_audit" 
                        });
                    }
                }
            }
        } catch (e) {
            console.warn("[Recovery] Global audit failed", e);
        }
    }
}

async function claimNextTask() {
    await recoverStaleTasks(); // Run health check before every claim attempt
    const apiBase = await getApiBase();
    const url = `${apiBase}/api/tasks/pending?limit=1`;
    try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`API Error: ${res.status}`);
        const data = await res.json();
        let tasks = [];
        if (Array.isArray(data)) tasks = data;
        else if (data.items && Array.isArray(data.items)) tasks = data.items;
        else if (data.tasks && Array.isArray(data.tasks)) tasks = data.tasks;

        // Ping success - update last success time
        chrome.storage.local.set({ last_api_success: new Date().toISOString() });
        clearTaskError();

        if (tasks.length === 0) return null;

        const nextTask = tasks[0];
        const claimed = await patchStatus(nextTask.id, 'in_progress', {
            step: 'claim',
            reason: 'extension_claim',
            claimed_at: new Date().toISOString()
        });

        if (!claimed) {
            setTaskError(`Claim Error: failed to promote task ${nextTask.id} to in_progress`);
            return null;
        }

        return nextTask;
    } catch (e) {
        setTaskError(`Claim Error: ${e.message || 'failed'}`);
        return null;
    }
}

function computeUrl(task) {
    if (!task) return null;
    const platform = (task.platform || '').toLowerCase().trim();
    const type = (task.type || '').toLowerCase().trim();
    const target = (task.target || '').trim();

    console.log(`[Compute URL] platform: "${platform}", type: "${type}", target: "${target}"`);

    let handle = target;
    if (handle.startsWith('@') || handle.startsWith('#')) {
        handle = handle.substring(1);
    }

    if (platform === 'twitter' || platform === 'x') {
        if (type === 'investigate_user') return `https://x.com/${handle}`;
        if (type === 'search_hashtag') return `https://x.com/search?q=%23${handle}&src=typed_query`;
        if (type === 'scrape_trending' || type === 'explore_trending') return `https://x.com/explore/tabs/trending`;
        if (type === 'explore_news') return `https://x.com/explore/tabs/news`;
    }
    if (platform === 'instagram') {
        if (type === 'investigate_user') return `https://www.instagram.com/${handle}/`;
        if (type === 'search_hashtag') return `https://www.instagram.com/explore/tags/${handle}/`;
        if (type === 'scrape_trending') return `https://www.instagram.com/explore/`;
    }
    if (platform === 'facebook') {
        if (type === 'investigate_user') return `https://www.facebook.com/${target}`;
        if (type === 'search_hashtag') return `https://www.facebook.com/hashtag/${handle}`;
        if (type === 'scrape_trending') return `https://www.facebook.com/watch/`;
    }
    return null;
}

async function openTab(url, cb) {
    const safeUrl = (url || '').toString();
    if (!safeUrl) {
        if (cb) cb({ ok: false, error: 'empty_url' });
        return;
    }

    const parse = (u) => {
        try {
            const nu = new URL(u);
            const host = (nu.hostname || '').toLowerCase();
            const path = (nu.pathname || '').toLowerCase();
            const seg = path.split('/').filter(Boolean);
            const first = seg.length > 0 ? seg[0] : '';
            return { host, path, first, url: nu.toString() };
        } catch (e) {
            return null;
        }
    };

    const wanted = parse(safeUrl);
    let candidate = null;

    try {
        const tabs = await chrome.tabs.query({});
        for (let i = 0; i < tabs.length; i++) {
            const t = tabs[i];
            if (!t || !t.url) continue;
            if (t.url === safeUrl) {
                candidate = t;
                break;
            }
            if (!wanted) continue;
            const current = parse(t.url);
            if (!current) continue;
            if (current.host !== wanted.host) continue;
            if (wanted.first && current.first && wanted.first === current.first) {
                candidate = t;
            }
        }
    } catch (e) { }

    const onOk = async (tabId) => {
        const tState = await getActiveState();
        if (tState.active_task) {
            triggerLoadWatchdog(tabId, tState.active_task.id);
        }

        chrome.storage.local.set({
            last_open_url: safeUrl,
            last_open_url_at: new Date().toISOString(),
            active_tab_id: tabId,
            last_tab_open_error: null,
            last_tab_open_error_at: null
        });
        if (cb) cb({ ok: true, tabId });
    };

    if (candidate && candidate.id) {
        try {
            await chrome.tabs.update(candidate.id, { url: safeUrl, active: true });
            await chrome.windows.update(candidate.windowId, { focused: true });
            onOk(candidate.id);
            return;
        } catch (e) { }
    }

    chrome.tabs.create({ url: safeUrl, active: true }, (tab) => {
        if (chrome.runtime.lastError) {
            const err = chrome.runtime.lastError.message;
            chrome.storage.local.set({
                last_tab_open_error: err,
                last_tab_open_error_at: new Date().toISOString()
            });
            setError(`Tab Open Error: ${err}`);
            if (cb) cb({ ok: false, error: err });
        } else {
            onOk(tab.id);
        }
    });
}

function getActiveState() {
    return new Promise((resolve) => {
        chrome.storage.local.get(['active_task', 'active_task_claimed_at', 'active_tab_id'], resolve);
    });
}

async function getActiveTask() {
    const state = await getActiveState();
    return state.active_task;
}

// Helper: Send Message with Retry
async function sendMessageWithRetry(tabId, msg, maxRetries = 3) {
    let lastError = null;

    for (let i = 0; i < maxRetries; i++) {
        try {
            // Wait for tab to be complete
            let tab = await chrome.tabs.get(tabId);
            if (tab.status !== 'complete') {
                await new Promise(r => setTimeout(r, 1000));
                tab = await chrome.tabs.get(tabId); // Refresh
            }

            // Attempt send
            const response = await new Promise(resolve => {
                chrome.tabs.sendMessage(tabId, msg, (res) => {
                    if (chrome.runtime.lastError) {
                        console.warn("[sendMessage] Error:", chrome.runtime.lastError.message);
                        resolve({ ok: false, error: chrome.runtime.lastError.message });
                    } else {
                        resolve(res || { ok: false, error: "No response from content script" });
                    }
                });
            });

            if (response && response.ok) return response;

            lastError = response ? response.error : "Unknown error";
            await new Promise(r => setTimeout(r, 800)); // Delay before retry

        } catch (e) {
            lastError = e.message;
            await new Promise(r => setTimeout(r, 800));
        }
    }

    return { ok: false, error: lastError || "Max retries exceeded" };
}

function resetDeepScanCaptureCounters() {
    try {
        chrome.storage.local.set({
            last_capture_debug: {
                attempted: 0,
                saved: 0,
                duplicate: 0,
                failed: 0,
                reset_at: new Date().toISOString()
            }
        });
    } catch (e) { }
}

async function sendStopToScroller(tabId) {
    const send = () => new Promise((resolve) => {
        chrome.tabs.sendMessage(tabId, { type: "STOP_DEEP_SCAN" }, (r) => {
            if (chrome.runtime.lastError) {
                resolve({ ok: false, error: chrome.runtime.lastError.message || "send_failed" });
            } else {
                resolve(r || { ok: false, error: "no_response" });
            }
        });
    });

    let res = await send();
    if (!res.ok) {
        const msgText = String(res.error || "");
        const missing =
            msgText.indexOf("Receiving end does not exist") !== -1 ||
            msgText.indexOf("Could not establish connection") !== -1;

        if (missing && chrome.scripting && chrome.scripting.executeScript) {
            try {
                await chrome.scripting.executeScript({
                    target: { tabId },
                    files: ["src/content-scripts/scroller.js"]
                });
            } catch (e) { }
            res = await send();
        }
    }

    return res;
}

chrome.tabs.onRemoved.addListener((tabId) => {
    console.log(`[Lifecycle] Tab removed: ${tabId}. Cleaning up scoped state.`);
    xPrimedTabs.delete(tabId);
    igPrimedTabs.delete(tabId);
    igApiBuffer.delete(tabId);
    clearSettleState(tabId);
});

// 6. Monitor Tabs for Active Task Loading
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    // 0. URL Change cleanup (Step 2.5 Logic)
    if (changeInfo.url) {
        const u = (changeInfo.url || '').toLowerCase();
        const isX = u.indexOf('twitter.com') !== -1 || u.indexOf('x.com') !== -1;
        if (isX) {
            const normalizedUrl = normalizeXUrl(changeInfo.url);

            // 0.a EXPLICIT FAIL on login/error redirects (Step 2.3)
            const lowUrl = changeInfo.url.toLowerCase();
            const isLogin = lowUrl.includes('/login') || lowUrl.includes('/i/flow/login') || lowUrl.includes('/error');
            if (isLogin) {
                const state = await getActiveState();
                if (state.active_task && state.active_tab_id === tabId) {
                    console.warn(`[X Lifecycle] Detected redirect to login/error: ${changeInfo.url}. Failing task.`);
                    await maybeAutoFinalizeTask(state.active_task.id, tabId, "page_load_failed", "restricted_or_login_required");
                    return;
                }
            }

            const primed = xPrimedTabs.get(tabId);
            if (primed && primed.normalizedUrl !== normalizedUrl) {
                const state = await getActiveState();
                if (state.active_task && state.active_task.type === 'investigate_user' && state.active_tab_id === tabId) {
                    const expectedHandle = (state.active_task.target || '').replace('@', '').trim().toLowerCase();
                    const urlObj = new URL(normalizedUrl);
                    const pathParts = urlObj.pathname.split('/').filter(Boolean);
                    const actualHandle = pathParts[0] ? pathParts[0].toLowerCase() : '';
                    
                    if (actualHandle !== expectedHandle && actualHandle !== 'home' && actualHandle !== '') {
                        console.warn(`[X Lifecycle] Profile redirect detected. Expected: ${expectedHandle}, Actual: ${actualHandle || 'home'}. Failing task.`);
                        await maybeAutoFinalizeTask(state.active_task.id, tabId, "page_load_failed", "profile_not_found_or_redirected");
                        return;
                    }
                }

                console.log(`[X Lifecycle] URL changed from ${primed.normalizedUrl} to ${normalizedUrl} for tab ${tabId}. Clearing old priming/timers.`);
                xPrimedTabs.delete(tabId);
                igPrimedTabs.delete(tabId);
                igApiBuffer.delete(tabId);
                clearSettleState(tabId);
            }
        }
    }

    if (changeInfo.status === 'complete') {
        const state = await getActiveState();
        if (state.active_task && state.active_tab_id === tabId) {
            // 0.b PROOF OF USABILITY (Clear Load Watchdog)
            const key = `${tabId}-${state.active_task.id}`;
            if (loadWatchdogTimers.has(key)) {
                console.log(`[X Lifecycle] Page usable (status: complete). Clearing load watchdog for ${key}.`);
                clearSettleState(tabId, state.active_task.id);
            }

            if (runnerBusy) {
                console.log("[BG] Runner busy, ignoring onUpdated");
                setEvent("RUNNER BUSY");
                return;
            }

            console.log("[TAB LOADED] Starting scrape...", tab.url);
            runnerBusy = true; // Lock
            runnerStartTime = Date.now();
            markRunnerProgress();

            // 0.c X EXPLORE SNAPSHOT (Phase 6)
            const u = (tab.url || '').toLowerCase();
            const isX = u.indexOf('twitter.com') !== -1 || u.indexOf('x.com') !== -1;
            
            if (isX && (state.active_task.type === 'explore_trending' || state.active_task.type === 'explore_news')) {
                setEvent("X EXPLORE SNAPSHOT START");
                const category = state.active_task.type === 'explore_trending' ? 'trending' : 'news';
                
                // Wait for page load settle
                await new Promise(r => setTimeout(r, 4000));
                
                const response = await sendMessageWithRetry(tabId, { 
                    type: "SCRAPE_X_EXPLORE_ITEMS",
                    task: state.active_task
                });
                
                if (response && response.ok && response.items) {
                    console.log(`[X Explore] Scraped ${response.items.length} items. Saving...`);
                    const saveRes = await saveTrendingSnapshot({
                        platform: 'twitter',
                        category: category,
                        items: response.items,
                        source_url: tab.url,
                        task_id: state.active_task.id
                    });
                    
                    if (saveRes && saveRes.status === 'ok') {
                        setEvent("X EXPLORE SNAPSHOT SAVED");
                        // Correct field names from backend response: saved_count, alerts_created
                        const savedCount = saveRes.saved_count ?? saveRes.saved ?? (response.items?.length || 0);
                        const alertsCreated = saveRes.alerts_created ?? saveRes.alerts ?? 0;
                        const skippedCount = saveRes.skipped_count ?? 0;

                        await patchStatus(state.active_task.id, 'completed', { 
                            saved: savedCount, 
                            alerts: alertsCreated,
                            skipped: skippedCount,
                            category: saveRes.category || category,
                            warnings: (saveRes.warnings || []).concat(response.debug?.warnings || []),
                            debug: response.debug
                        });
                        console.log(`[X Explore] Snapshot saved successfully. Saved: ${savedCount}, Skipped: ${skippedCount}, Alerts: ${alertsCreated}`);
                        await clearActiveState();
                        chrome.action.setBadgeText({ text: '' });
                    } else {
                        const err = saveRes ? saveRes.error : "Unknown backend error";
                        console.error(`[X Explore] Backend save failed: ${err}`);
                        await patchStatus(state.active_task.id, 'failed', { error: `Backend save failed: ${err}` });
                        await clearActiveState();
                        chrome.action.setBadgeText({ text: '' });
                    }
                } else {
                    const err = response ? response.error : "Scrape failed";
                    console.error(`[X Explore] Scrape failed: ${err}`);
                    await patchStatus(state.active_task.id, 'failed', { error: `Scrape failed: ${err}` });
                    await clearActiveState();
                    chrome.action.setBadgeText({ text: '' });
                }
                runnerBusy = false;
                return;
            }

            try {
                // INSTAGRAM NEW FLOW
                if (state.active_task.platform === 'instagram') {
                    setEvent("IG SCRAPE START");

                    // 1. Get URLs
                    const response = await sendMessageWithRetry(tabId, { type: "GET_FIRST_POST_URLS", task: state.active_task });

                    if (!response || !response.ok) {
                        const err = response ? response.error : "Unknown error";
                        console.log("[IG SCRAPE ERROR] Get URLs failed:", err);

                        // Debug storage
                        chrome.storage.local.set({
                            last_event: "GET_URLS_FAILED",
                            last_error: `Get URLs failed: ${err}`,
                            last_error_at: new Date().toISOString()
                        });

                        await patchStatus(state.active_task.id, 'failed', { error: `Get URLs failed: ${err}` });
                        console.log(`[IG Lifecycle] Task ${state.active_task.id} marked failed. Reason=get_urls_failed:${err}`);
                        chrome.storage.local.remove(['active_task', 'active_task_claimed_at', 'active_tab_id']);
                        chrome.action.setBadgeText({ text: '' });
                        runnerBusy = false;
                        return;
                    }

                    const postUrls = response.urls || [];
                    if (!Array.isArray(postUrls) || postUrls.length === 0) {
                        console.log("[IG SCRAPE] No posts found");
                        await patchStatus(state.active_task.id, 'failed', { error: "No visible posts found" });
                        console.log(`[IG Lifecycle] Task ${state.active_task.id} marked failed. Reason=no_visible_posts`);
                        setEvent("IG SCRAPE FAILED");
                        chrome.storage.local.remove(['active_task', 'active_task_claimed_at', 'active_tab_id']);
                        runnerBusy = false;
                        return;
                    }

                    const debug = response.debug || {};
                    chrome.storage.local.set({ last_scrape_debug: debug });
                    console.log(`[IG SCRAPE] Found ${postUrls.length} posts`);

                    const captureDebug = {
                        attempted: postUrls.length,
                        saved: 0,
                        duplicate: 0,
                        failed: 0,
                        sample_raw_text_preview: '',
                        last_http_status: 0
                    };

                    const apiBase = await getApiBase();
                    const capturedPostIds = []; const primed = xPrimedTabs.get(tabId); const sessionSeenIds = primed?.seenPostIds || new Set();

                    // 2. Loop URLs
                    for (let i = 0; i < postUrls.length; i++) {
                        const postUrl = postUrls[i];
                        if (!postUrl) continue;

                        try {
                            // Navigate
                            await chrome.tabs.update(tabId, { url: postUrl });

                            // Wait for load
                            await new Promise(resolve => {
                                const listener = (tid, info) => {
                                    if (tid === tabId && info.status === 'complete') {
                                        chrome.tabs.onUpdated.removeListener(listener);
                                        setTimeout(resolve, 2000); // 2s wait for meta
                                    }
                                };
                                chrome.tabs.onUpdated.addListener(listener);
                                // Safety timeout
                                setTimeout(() => {
                                    chrome.tabs.onUpdated.removeListener(listener);
                                    resolve();
                                }, 15000);
                            });

                            // Extract
                            const extRes = await sendMessageWithRetry(tabId, { type: "EXTRACT_POST_FROM_PAGE", task: state.active_task });

                            if (extRes && extRes.ok && extRes.post) {
                                const post = extRes.post;
                                if (i === 0) captureDebug.sample_raw_text_preview = (post.raw_text || '').substring(0, 120);

                                const allowed = self.RateLimiter ? await self.RateLimiter.canProceed('capture') : { ok: true };
                                if (!allowed.ok) {
                                    const reason = allowed.reason || 'rate_limited';
                                    setCaptureError(`Capture blocked: ${reason}`);
                                    setEvent(`CAPTURE BLOCKED: ${reason}`);
                                    break;
                                }
                                try { if (self.RateLimiter && self.RateLimiter.incrementPostsCaptured) await self.RateLimiter.incrementPostsCaptured(1); } catch (e) { }

                                // Send to Backend
                                markRunnerProgress();
                                const res = await fetch(`${apiBase}/api/posts/capture`, {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify(post)
                                });
                                captureDebug.last_http_status = res.status;

                                if (res.ok) {
                                    const json = await res.json().catch(() => ({}));
                                    if (json.deduped) captureDebug.duplicate++;
                                    else captureDebug.saved++;

                                    if (json && (typeof json.post_id === 'number' || typeof json.post_id === 'string')) {
                                        const idNum = Number(json.post_id);
                                        if (!Number.isNaN(idNum) && idNum > 0) capturedPostIds.push(idNum);
                                    }
                                } else {
                                    captureDebug.failed++;
                                }
                            } else {
                                captureDebug.failed++;
                            }
                        } catch (loopErr) {
                            console.error("[IG LOOP ERROR]", loopErr);
                            captureDebug.failed++;
                        }
                    }

                    // Done
                    chrome.storage.local.set({ last_capture_debug: captureDebug });
                    console.log(`[IG Capture] Batch complete. Saved=${captureDebug.saved}, Duplicates=${captureDebug.duplicate}, Failed=${captureDebug.failed}`);
                    const successCount = captureDebug.saved + captureDebug.duplicate;

                    if (successCount > 0) {
                        await patchStatus(state.active_task.id, 'completed', {
                            posts_captured: successCount,
                            platform: 'instagram',
                            target: state.active_task.target
                        });
                        console.log(`[IG Lifecycle] Task ${state.active_task.id} marked completed. Saved=${captureDebug.saved}, Duplicates=${captureDebug.duplicate}, Failed=${captureDebug.failed}`);
                        setEvent("IG CAPTURE COMPLETE");
                        chrome.storage.local.set({
                            last_scrape_summary: {
                                posts_captured: successCount,
                                platform: 'instagram',
                                timestamp: new Date().toISOString()
                            }
                        });
                    } else {
                        await patchStatus(state.active_task.id, 'failed', { error: "0 posts captured (IG)" });
                        console.log(`[IG Lifecycle] Task ${state.active_task.id} marked failed. Saved=0, Duplicates=0, Failed=${captureDebug.failed}, Reason=zero_results`);
                        setEvent("IG CAPTURE FAILED");
                    }

                    markRunnerProgress();
                    console.log(`[IG Capture] Triggering analysis for ${capturedPostIds.length} posts`);
                    await analyzeCapturedPosts(apiBase, capturedPostIds);

                    chrome.storage.local.remove(['active_task', 'active_task_claimed_at', 'active_tab_id']);
                    chrome.action.setBadgeText({ text: '' });
                    runnerBusy = false;
                    return;
                }

                // TWITTER / OTHER (Legacy Flow)
                setEvent("SCRAPE START");
                console.log(`[X Scrape] Triggering visibility scrape for Tab ${tabId}, Task: ${state.active_task?.id}`);

                const doScrapeWithRetry = async (attempt = 1) => {
                    return new Promise((resolve) => {
                        chrome.tabs.sendMessage(tabId, {
                            type: "SCRAPE_VISIBLE_POSTS",
                            task: state.active_task
                        }, async (response) => {
                            const err = chrome.runtime.lastError;
                            if (err) {
                                const msg = err.message || '';
                                const isConnectionError = msg.includes('message port closed') || msg.includes('Receiving end does not exist');
                                if (isConnectionError && attempt < 3) {
                                    console.log(`[X Scrape][Attempt ${attempt}] Connection failed: ${msg}. Retrying in 1s...`);
                                    setTimeout(() => resolve(doScrapeWithRetry(attempt + 1)), 1000);
                                } else {
                                    console.log(`[X Scrape][Attempt ${attempt}] Final Connection failure: ${msg}`);
                                    resolve({ ok: false, error: 'connection_failed', message: msg });
                                }
                            } else {
                                resolve(response || { ok: false, error: 'no_response' });
                            }
                        });
                    });
                };

                try {
                    // Wait a moment for page to settle after 'complete' status
                    await new Promise(r => setTimeout(r, 2000));
                    
                    const response = await doScrapeWithRetry(1);
                    
                    if (response && response.error === 'connection_failed') {
                        setError(`scrape_connection_failed: ${response.message}`);
                        markRunnerProgress(tabId); // Still heartbeat to allow settle/fail naturally
                        return;
                    }

                    if (response && response.ok) {
                        const posts = response.posts || [];
                        const debug = response.debug || {};
                        console.log(`[X Scrape] Result: Found ${posts.length} posts via DOM`, debug);
                        if (posts.length > 0) {
                            const p0 = posts[0];
                            console.log(`[X Scrape] Sample post 0: handle=@${p0.handle}, name=${p0.display_name || p0.name}, url=${p0.url}`);
                        }
                        chrome.storage.local.set({ last_scrape_debug: debug });

                        // REFACTORED TO USE CENTRAL HELPER (Step 3)
                        const captureDebug = await sendXCaptures(tabId, posts, tab.url, null, '[X Initial Scrape]');
                        
                        chrome.storage.local.set({ last_capture_debug: captureDebug });
                        console.log(`[X Lifecycle] Initial scrape complete. Saved: ${captureDebug.saved}, Total: ${captureDebug.saved + captureDebug.duplicate}`);

                        // IMMEDIATE DEEP SCAN TRIGGER (Requirement 1)
                        if (state.active_task.type === 'investigate_user') {
                            const primed = xPrimedTabs.get(tabId);
                            const saved = primed?.metrics?.saved || 0;
                            if (saved < INVESTIGATE_TARGET_POSTS) {
                                console.log(`[X Lifecycle] Target not reached after initial scrape (${saved}/${INVESTIGATE_TARGET_POSTS}). Starting deep scan immediately.`);
                                await triggerControlledScroll(tabId, state.active_task.id, INVESTIGATE_MAX_SCROLLS);
                                return;
                            }
                        }

                        console.log(`[X Lifecycle] Settle timer active for tab ${tabId}.`);
                    } else {
                        // Handle generic failure (ok: false from content script)
                        console.log(`[X Scrape] Content script returned error:`, response?.error || 'unknown');
                        markRunnerProgress(tabId);
                    }
                } catch (finallyErr) {
                    console.error("[X Scrape] Processing Error:", finallyErr);
                    markRunnerProgress(tabId);
                } finally {
                    runnerBusy = false;
                }

            } catch (e) {
                console.error("Runner Error", e);
                runnerBusy = false;
            }
        }
    }
});

// Listener for Debug Events
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    // Return true immediately to indicate async response
    const handleAsync = async () => {
        try {
            // API Interceptor event
            if (msg.type === "API_INTERCEPTED") {
                try {
                    const url = msg.url || '';
                    const rawTs = msg.timestamp || msg.ts || Date.now();
                    const ts = new Date(rawTs).toISOString();
                    try { console.log("[API_INTERCEPTED]", url); } catch (e) { }
                    let platform = (msg.platform || '').toString().trim();
                    const interceptKind = (msg.intercept_kind || msg.kind || '').toString();
                    try {
                        if (!platform) {
                            const host = (new URL(url)).hostname || '';
                            if (host.indexOf('twitter.com') !== -1 || host.indexOf('x.com') !== -1) platform = 'twitter';
                            else if (host.indexOf('instagram.com') !== -1) platform = 'instagram';
                            else if (host.indexOf('facebook.com') !== -1) platform = 'facebook';
                            else platform = host || 'unknown';
                        }
                    } catch (e) {
                        platform = 'unknown';
                    }

                    // (Removed broad [X Intercept] log from here - Phase 3 Audit Cleanup)

                    if (interceptKind === 'HTTP_429_DETECTED') {
                        const reason = 'http_429_rate_limited';
                        try {
                            if (self.RateLimiter && self.RateLimiter.setCooldownUntil) {
                                const until = Date.now() + (self.RateLimiter.LIMITS ? self.RateLimiter.LIMITS.cooldownBetweenSessionsMs : 300000);
                                await self.RateLimiter.setCooldownUntil(until, reason);
                            }
                            if (self.RateLimiter && self.RateLimiter.endSession) {
                                await self.RateLimiter.endSession(reason);
                            }
                        } catch (e) { }

                        try {
                            chrome.storage.local.set({
                                last_error: "Rate limited by platform (HTTP 429). Cooling down.",
                                last_error_at: new Date().toISOString(),
                                deep_scan_last_error: "Stopped: HTTP 429 detected",
                                last_event: "HTTP 429 DETECTED",
                                last_event_at: new Date().toISOString()
                            });
                        } catch (e) { }

                        try {
                            const st = await new Promise((resolve) => chrome.storage.local.get(['deep_scan_tab_id', 'active_tab_id'], resolve));
                            const tabId = (st && typeof st.deep_scan_tab_id === 'number') ? st.deep_scan_tab_id : ((st && typeof st.active_tab_id === 'number') ? st.active_tab_id : null);
                            if (tabId) await sendStopToScroller(tabId);
                        } catch (e) { }

                        try {
                            chrome.storage.local.set({
                                deep_scan_state: "STOPPED",
                                deep_scan_running: false,
                                deep_scan_finished_at: new Date().toISOString()
                            });
                        } catch (e) { }
                    }
                    chrome.storage.local.get(['intercept_count_total'], (res) => {
                        const count = (res && typeof res.intercept_count_total === 'number') ? res.intercept_count_total : 0;
                        chrome.storage.local.set({
                            intercept_count_total: count + 1,
                            intercept_last_url: url,
                            intercept_last_at: ts,
                            intercept_last_platform: platform,
                            last_event: "API INTERCEPTED"
                        }, () => {
                            sendResponse({ ok: true });
                        });
                    });

                    // BABY STEP 2: Instagram parsing + capture sending
                    try {
                        if (platform === 'instagram') {
                            const u = url || '';
                            const uLow = u.toLowerCase();
                            if (uLow.indexOf('/api/graphql') !== -1 || uLow.indexOf('/graphql/query') !== -1 || uLow.indexOf('/api/v1/') !== -1) {
                                const now = Date.now();
                                igCleanup(now);
                                const key = 'ig|' + u;
                                const last = igProcessSeen.get(key);
                                if (last && (now - last) < IG_DEDUPE_WINDOW_MS) {
                                    // Skip duplicate processing within window
                                } else {
                                    igProcessSeen.set(key, now);
                                    const payload = msg.data;
                                    if (payload) {
                                        const posts = extractInstagramPosts(payload, u);
                                        if (posts && posts.length > 0) {
                                            const activeTask = await getActiveTask();
                                            const st = await new Promise(r => chrome.storage.local.get(['deep_scan_tab_id', 'active_tab_id'], r));
                                            const tId = sender?.tab?.id || msg.tabId || st?.deep_scan_tab_id || st?.active_tab_id;
                                            
                                            // Buffer if deep scan is running
                                            const dsState = await new Promise(r => chrome.storage.local.get(['deep_scan_running'], r));
                                            if (dsState?.deep_scan_running && tId) {
                                                let buffer = igApiBuffer.get(tId) || [];
                                                posts.forEach(p => {
                                                    if (!buffer.some(bp => bp.platform_post_id === p.platform_post_id)) {
                                                        buffer.push(p);
                                                    }
                                                });
                                                igApiBuffer.set(tId, buffer);
                                                console.log(`[IG Intercept] Buffered ${posts.length} posts for tab ${tId}`);
                                            }

                                            sendInstagramCaptures(tId, posts, u, activeTask, "[IG Intercept]");
                                        }
                                    }
                                }
                            }
                        }
                    } catch (e) {
                        console.warn("IG intercept process error", e);
                    }

                    // BABY STEP 3 & 4: X/Twitter parsing + capture sending
                    try {
                        if (platform === 'x' || platform === 'twitter') {
                            const u = url || '';
                            const uLow = u.toLowerCase();

                            let opName = "";
                            const graphqlMatch = u.match(/\/api\/graphql\/[^\/]+\/([^\/\?]+)/i);
                            if (graphqlMatch && graphqlMatch[1]) {
                                opName = graphqlMatch[1];
                            } else if (uLow.indexOf('/hometimeline') !== -1) {
                                opName = 'HomeTimeline';
                            } else if (uLow.indexOf('/homelatesttimeline') !== -1) {
                                opName = 'HomeLatestTimeline';
                            }

                            if (opName === 'HomeTimeline' || opName === 'HomeLatestTimeline' ||
                                opName === 'UserTweets' || opName === 'UserTweetsAndReplies' ||
                                opName === 'SearchTimeline' || opName === 'UserByScreenName') {

                                console.log(`[X Parser] Matched operation: ${opName}`);

                                // Detect profile_not_found from UserByScreenName
                                if (opName === 'UserByScreenName') {
                                    const payload = msg.data;
                                    if (payload && payload.errors) {
                                        const isNotFound = payload.errors.some(err => err.code === 50 || err.code === 63 || (err.message && err.message.includes('User not found')));
                                        if (isNotFound) {
                                            const state = await getActiveState();
                                            if (state.active_task && state.active_tab_id === msg.tabId) {
                                                console.warn(`[X Parser] UserByScreenName returned "not found". Failing task.`);
                                                await maybeAutoFinalizeTask(state.active_task.id, msg.tabId, "page_load_failed", "profile_not_found");
                                                return;
                                            }
                                        }
                                    }
                                    // If not an error, we might still want to parse it for profile metadata, but for now we only care about failures.
                                    if (opName === 'UserByScreenName') return;
                                }
                                
                                // HEARTBEAT: Reset quiet window now that we have relevant X data (Phase 3)
                                if (msg.tabId) markRunnerProgress(msg.tabId);

                                // Mark as primed for this task/URL (Step 1.1d refinement)
                                if (msg.tabId) {
                                    markXTabUsable(msg.tabId, u, { intercepted: true });
                                }

                                let debugObj = {
                                    stage: "matched",
                                    operation_name: opName,
                                    matched_url: u,
                                    platform: "x",
                                    routed_to_parser: false,
                                    extracted_count: 0,
                                    send_called: false,
                                    saved: 0,
                                    duplicate: 0,
                                    failed: 0,
                                    sample_top_keys: [],
                                    sample_instruction_types: [],
                                    sample_entry_shapes: [],
                                    error: null,
                                    at: new Date().toISOString()
                                };
                                chrome.storage.local.set({ last_x_debug: debugObj });

                                const payload = msg.data;
                                if (payload) {
                                    debugObj.stage = "parser_called";
                                    debugObj.routed_to_parser = true;
                                    chrome.storage.local.set({ last_x_debug: debugObj });
                                    try {
                                        if (payload.data) {
                                            debugObj.sample_top_keys = Object.keys(payload.data);
                                        }
                                    } catch (e) { }

                                    let posts = [];
                                    let diag = null;
                                    if (opName === 'HomeTimeline' || opName === 'HomeLatestTimeline') {
                                        const res = extractXHomeTimelinePosts(payload, u);
                                        posts = res.posts;
                                        diag = res.diagnostic;
                                    } else if (opName === 'UserTweets' || opName === 'UserTweetsAndReplies') {
                                        const res = extractXProfilePosts(payload, u);
                                        posts = res.posts;
                                        diag = res.diagnostic;
                                    } else if (opName === 'SearchTimeline') {
                                        const res = extractXSearchPosts(payload, u);
                                        posts = res.posts;
                                        diag = res.diagnostic;
                                    }

                                    debugObj.extracted_count = posts ? posts.length : 0;
                                    debugObj.diagnostic = diag;
                                    debugObj.stage = "parsed";

                                    if (posts && posts.length > 0) {
                                        debugObj.stage = "capture_called";
                                        console.log(`[X Parser] Extracted ${posts.length} posts for ${opName} (Instruction Source: ${diag?.instruction_source})`);
                                        chrome.storage.local.set({ last_x_debug: debugObj });
                                        await sendXCaptures(msg.tabId, posts, u, debugObj, '[X Intercept]');
                                    } else {
                                        console.log(`[X Parser] Extracted 0 posts for ${opName}. Diagnostics:`, JSON.stringify(diag));
                                        // Signal zero result from parser (Step 1.2)
                                        if (msg.tabId) {
                                            markXTabUsable(msg.tabId, u, { zero_reason: 'parser_extracted_zero', isScrape: true });
                                        }
                                        if (diag?.fallback_attempted) {
                                            console.log(`[X Parser] Fallback was attempted but still found 0 posts.`);
                                        } else if (diag?.instruction_source === 'none') {
                                            console.log(`[X Parser] Primary path failed and no fallback found instructions.`);
                                        }
                                        chrome.storage.local.set({ last_x_debug: debugObj, last_capture_debug: debugObj });
                                    }
                                } else {
                                    debugObj.stage = "error";
                                    debugObj.error = "No payload";
                                    chrome.storage.local.set({ last_x_debug: debugObj, last_capture_debug: debugObj });
                                }
                            }
                        }
                    } catch (e) {
                        console.warn("X intercept process error", e);
                        chrome.storage.local.set({ last_x_debug: { stage: "error", error: e.message, at: new Date().toISOString() } });
                    }
                } catch (e) {
                    chrome.storage.local.set({
                        last_error: e && e.message ? e.message : 'Interceptor store error',
                        last_error_at: new Date().toISOString(),
                        last_event: "INTERCEPT ERROR"
                    }, () => {
                        sendResponse({ ok: false, error: 'store_error' });
                    });
                }
                return;
            }

            if (msg.type === "IG_DEBUG_EVENT") {
                setEvent(msg.event);
                sendResponse({ ok: true });
                return;
            }

            if (msg.type === "RL_BEFORE_SCROLL") {
                try {
                    if (self.RateLimiter && self.RateLimiter.resetDailyCountersIfNeeded) {
                        await self.RateLimiter.resetDailyCountersIfNeeded();
                    }
                    const allowed = self.RateLimiter ? await self.RateLimiter.canProceed('scroll') : { ok: true };
                    if (!allowed.ok) {
                        const reason = allowed.reason || 'rate_limited';
                        try {
                            if (self.RateLimiter && self.RateLimiter.endSession) await self.RateLimiter.endSession(reason);
                        } catch (e) { }
                        try {
                            chrome.storage.local.set({
                                deep_scan_state: "STOPPED",
                                deep_scan_running: false,
                                deep_scan_finished_at: new Date().toISOString(),
                                deep_scan_last_error: `Stopped: ${reason}`,
                                last_error: `Stopped: ${reason}`,
                                last_error_at: new Date().toISOString(),
                                last_event: `DEEP SCAN STOPPED: ${reason}`,
                                last_event_at: new Date().toISOString()
                            });
                        } catch (e) { }
                        sendResponse({ ok: false, reason });
                        return;
                    }

                    if (self.RateLimiter && self.RateLimiter.incrementScrolls) {
                        await self.RateLimiter.incrementScrolls(1);
                    }
                    const plan = self.RateLimiter && self.RateLimiter.getScrollStepPlan
                        ? self.RateLimiter.getScrollStepPlan()
                        : { distancePx: 600, direction: 1, delayMs: 1200, readingPauseMs: 0, longPauseMs: 0 };
                    sendResponse({ ok: true, plan });
                } catch (e) {
                    sendResponse({ ok: false, reason: 'rl_error' });
                }
                return;
            }

            // 1. POLL_NOW
            if (msg.type === "POLL_NOW") {
                try {
                    const allowed = self.RateLimiter ? await self.RateLimiter.canProceed('poll') : { ok: true };
                    if (!allowed.ok) {
                        const reason = allowed.reason || 'rate_limited';
                        chrome.storage.local.set({
                            last_error: `Poll blocked: ${reason}`,
                            last_error_at: new Date().toISOString(),
                            last_event: "POLL BLOCKED",
                            last_event_at: new Date().toISOString()
                        }, () => sendResponse({ ok: false, error: reason }));
                        return;
                    }
                } catch (e) { }
                const active_task = await getActiveTask();

                // Cleanup stale task (>10 mins old with no tab)
                if (active_task) {
                    const claimedAt = (await getActiveState()).active_task_claimed_at;
                    const isStale = claimedAt && (new Date() - new Date(claimedAt) > 10 * 60 * 1000);
                    const hasTab = (await getActiveState()).active_tab_id;

                    if (isStale && !hasTab) {
                        await new Promise(r => chrome.storage.local.remove(['active_task', 'active_task_claimed_at', 'active_tab_id'], r));
                        setEvent("STALE TASK CLEARED");
                        chrome.action.setBadgeText({ text: '' });
                        // Proceed to claim new
                    } else {
                        setEvent("ACTIVE TASK EXISTS (use Start/Resume)");
                        sendResponse({ ok: true });
                        return;
                    }
                }

                // Try Claim
                const nextTask = await claimNextTask();
                if (nextTask) {
                    await new Promise(r => chrome.storage.local.set({
                        active_task: nextTask,
                        active_task_claimed_at: new Date().toISOString(),
                        last_poll_at: new Date().toISOString()
                    }, r));
                    chrome.action.setBadgeText({ text: '1' });
                    setEvent("TASK CLAIMED");
                } else {
                    chrome.storage.local.set({ last_poll_at: new Date().toISOString() });
                    setEvent("NO PENDING TASKS");
                    chrome.action.setBadgeText({ text: '' });
                }
                sendResponse({ ok: true });
                return;
            }

            // 2. START_RESUME
            if (msg.type === "START_RESUME") {
                const state = await getActiveState();
                if (!state.active_task) {
                    sendResponse({ ok: false, error: "No active task" });
                    return;
                }

                // Check existing tab
                if (state.active_tab_id) {
                    try {
                        await chrome.tabs.get(state.active_tab_id);
                        // Tab exists
                        setEvent("TAB ALREADY OPEN");
                        sendResponse({ ok: true, tabId: state.active_tab_id });
                        return;
                    } catch (e) {
                        // Tab missing, clear ID and proceed to open new
                        await new Promise(r => chrome.storage.local.remove(['active_tab_id'], r));
                    }
                }

                // Open New Tab
                const url = computeUrl(state.active_task);
                console.log("[START_RESUME] computed URL:", url, "for task:", JSON.stringify(state.active_task));
                if (url) {
                    openTab(url, (res) => {
                        if (res.ok) {
                            setEvent("TAB OPENED");
                            sendResponse({ ok: true, tabId: res.tabId });
                        } else {
                            sendResponse({ ok: false, error: res.error });
                        }
                    });
                } else {
                    setError("Compute URL failed");
                    sendResponse({ ok: false, error: "Invalid URL" });
                }
                return;
            }

            // 3. RELOAD_ACTIVE_TAB
            if (msg.type === "RELOAD_ACTIVE_TAB") {
                const state = await getActiveState();
                if (state.active_tab_id) {
                    try {
                        await chrome.tabs.reload(state.active_tab_id);
                        setEvent("TAB RELOADED");
                        sendResponse({ ok: true });
                    } catch (e) {
                        setEvent("TAB MISSING");
                        sendResponse({ ok: false, error: "Tab missing" });
                    }
                } else {
                    sendResponse({ ok: false, error: "No active tab" });
                }
                return;
            }

            // 3b. DEEP_SCAN
            if (msg.type === "DEEP_SCAN") {
                const state = await getActiveState();
                let tabId = state.active_tab_id;

                try {
                    if (self.RateLimiter && self.RateLimiter.startSession) {
                        const started = await self.RateLimiter.startSession('deep_scan');
                        if (!started.ok) {
                            const reason = started.reason || 'rate_limited';
                            chrome.storage.local.set({
                                deep_scan_state: "FAILED",
                                deep_scan_running: false,
                                deep_scan_last_error: `Blocked: ${reason}`,
                                last_error: `Blocked: ${reason}`,
                                last_error_at: new Date().toISOString(),
                                last_event: `DEEP SCAN BLOCKED: ${reason}`,
                                last_event_at: new Date().toISOString()
                            }, () => sendResponse({ ok: false, error: reason }));
                            return;
                        }
                    }
                    resetDeepScanCaptureCounters();
                    chrome.storage.local.set({
                        deep_scan_state: "RUNNING",
                        deep_scan_running: true,
                        deep_scan_started_at: new Date().toISOString(),
                        deep_scan_last_error: null,
                        last_event: "DEEP SCAN RUNNING",
                        last_event_at: new Date().toISOString()
                    });
                } catch (e) { }

                if (tabId) {
                    try {
                        await chrome.tabs.get(tabId);
                    } catch (e) {
                        tabId = null;
                        try { await new Promise(r => chrome.storage.local.remove(['active_tab_id'], r)); } catch (e2) { }
                    }
                }

                if (!tabId) {
                    if (!state.active_task) {
                        sendResponse({ ok: false, error: "No active task" });
                        return;
                    }
                    const url = computeUrl(state.active_task);
                    if (!url) {
                        sendResponse({ ok: false, error: "Invalid URL" });
                        return;
                    }
                    const opened = await new Promise(resolve => {
                        openTab(url, (r) => resolve(r || { ok: false, error: "open_failed" }));
                    });
                    if (!opened.ok || !opened.tabId) {
                        sendResponse({ ok: false, error: opened.error || "open_failed" });
                        return;
                    }
                    tabId = opened.tabId;
                    await new Promise(resolve => {
                        const listener = (tid, info) => {
                            if (tid === tabId && info.status === 'complete') {
                                chrome.tabs.onUpdated.removeListener(listener);
                                setTimeout(resolve, 1000); // Longer wait for initial injection
                            }
                        };
                        chrome.tabs.onUpdated.addListener(listener);
                        setTimeout(() => {
                            chrome.tabs.onUpdated.removeListener(listener);
                            resolve();
                        }, 15000);
                    });
                } else {
                    // Control Reload for existing tabs
                    await ensureXInterceptReady(tabId, false);
                }

                const res = await sendMessageWithRetry(tabId, {
                    type: "DEEP_SCAN_START",
                    duration_seconds: 45,
                    max_scrolls: 80
                }, 3);

                if (res && res.ok) {
                    try {
                        const state2 = await new Promise((resolve) => chrome.storage.local.get(['deep_scan_state'], resolve));
                        const currentState = state2 ? state2.deep_scan_state : null;
                        if (currentState === "STOPPED") {
                            const stopReason = res && res.stop_reason ? String(res.stop_reason) : 'manual_stop';
                            try { if (self.RateLimiter && self.RateLimiter.endSession) await self.RateLimiter.endSession(stopReason || 'manual_stop'); } catch (e) { }
                            chrome.storage.local.set({
                                deep_scan_running: false,
                                deep_scan_finished_at: new Date().toISOString(),
                                deep_scan_result: res,
                                last_event: "DEEP SCAN STOPPED",
                                last_event_at: new Date().toISOString()
                            });
                        } else {
                            const stopReason = res && res.stop_reason ? String(res.stop_reason) : null;
                            try { if (self.RateLimiter && self.RateLimiter.endSession) await self.RateLimiter.endSession(stopReason || 'done'); } catch (e) { }
                            chrome.storage.local.set({
                                deep_scan_state: "DONE",
                                deep_scan_running: false,
                                deep_scan_finished_at: new Date().toISOString(),
                                deep_scan_result: res,
                                last_event: "DEEP SCAN DONE",
                                last_event_at: new Date().toISOString()
                            });
                        }
                    } catch (e) { }
                    sendResponse({ ok: true, result: res });
                } else {
                    const err = (res && res.error) ? res.error : "deep_scan_failed";
                    try { if (self.RateLimiter && self.RateLimiter.endSession) await self.RateLimiter.endSession(err); } catch (e) { }
                    try {
                        chrome.storage.local.set({
                            deep_scan_state: "FAILED",
                            deep_scan_running: false,
                            deep_scan_last_error: err,
                            deep_scan_finished_at: new Date().toISOString(),
                            last_event: `DEEP SCAN FAILED: ${err}`,
                            last_event_at: new Date().toISOString()
                        });
                    } catch (e) { }
                    sendResponse({ ok: false, error: err });
                }
                return;
            }

            // 3c. DEEP_SCAN_START (explicit tabId)
            if (msg.type === "DEEP_SCAN_START") {
                const tabId = msg.tabId;
                if (typeof tabId !== 'number' || tabId <= 0) {
                    const errMsg = "No supported active tab";
                    try {
                        chrome.storage.local.set({
                            deep_scan_state: "FAILED",
                            deep_scan_running: false,
                            deep_scan_last_error: errMsg,
                            deep_scan_finished_at: new Date().toISOString(),
                            last_event: `DEEP SCAN FAILED: ${errMsg}`,
                            last_event_at: new Date().toISOString()
                        });
                    } catch (e) { }
                    sendResponse({ ok: false, error: errMsg });
                    return;
                }

                let tab = null;
                try {
                    tab = await chrome.tabs.get(tabId);
                } catch (e) {
                    tab = null;
                }

                const tabUrl = (tab && tab.url) ? String(tab.url) : '';
                const u = tabUrl.toLowerCase();
                const supported = (u.indexOf('instagram.com') !== -1) || (u.indexOf('x.com') !== -1) || (u.indexOf('twitter.com') !== -1);
                if (!supported) {
                    const errMsg = "Open Instagram/X tab first";
                    try {
                        chrome.storage.local.set({
                            deep_scan_state: "FAILED",
                            deep_scan_running: false,
                            deep_scan_last_error: errMsg,
                            deep_scan_finished_at: new Date().toISOString(),
                            last_event: `DEEP SCAN FAILED: ${errMsg}`,
                            last_event_at: new Date().toISOString()
                        });
                    } catch (e) { }
                    sendResponse({ ok: false, error: errMsg });
                    return;
                }

                try {
                    if (self.RateLimiter && self.RateLimiter.startSession) {
                        const started = await self.RateLimiter.startSession('deep_scan');
                        if (!started.ok) {
                            const reason = started.reason || 'rate_limited';
                            chrome.storage.local.set({
                                deep_scan_state: "FAILED",
                                deep_scan_running: false,
                                deep_scan_last_error: `Blocked: ${reason}`,
                                last_error: `Blocked: ${reason}`,
                                last_error_at: new Date().toISOString(),
                                deep_scan_finished_at: new Date().toISOString(),
                                last_event: `DEEP SCAN BLOCKED: ${reason}`,
                                last_event_at: new Date().toISOString()
                            });
                            sendResponse({ ok: false, error: reason });
                            return;
                        }
                    }
                    resetDeepScanCaptureCounters();
                    chrome.storage.local.set({
                        deep_scan_state: "RUNNING",
                        deep_scan_running: true,
                        deep_scan_started_at: new Date().toISOString(),
                        deep_scan_last_error: null,
                        deep_scan_tab_id: tabId,
                        last_event: "DEEP SCAN RUNNING",
                        last_event_at: new Date().toISOString()
                    });
                } catch (e) { }

                // Controlled reload for starting manually on existing tab
                await ensureXInterceptReady(tabId, false);

                const sendToScroller = () => new Promise((resolve) => {
                    const sent_at = new Date().toISOString();
                    chrome.tabs.sendMessage(tabId, { type: "DEEP_SCAN_START", totalScrolls: 30 }, (r) => {
                        const err = chrome.runtime.lastError ? chrome.runtime.lastError.message : null;
                        const finalRes = r || { ok: false, error: err || 'no_response' };
                        chrome.storage.local.set({
                            last_deep_scan_route: {
                                tabId,
                                sent_at,
                                response: finalRes,
                                error: err,
                                source: "background_to_scroller"
                            }
                        });
                        resolve(finalRes);
                    });
                });

                let res = await sendToScroller();
                if (!res.ok) {
                    const msgText = String(res.error || '');
                    const missing = msgText.indexOf('Receiving end does not exist') !== -1 || msgText.indexOf('Could not establish connection') !== -1;
                    if (missing && chrome.scripting && chrome.scripting.executeScript) {
                        try {
                            await chrome.scripting.executeScript({
                                target: { tabId },
                                files: ["src/content-scripts/scroller.js"]
                            });
                        } catch (e) { }
                        res = await sendToScroller();
                    }
                }

                if (res && res.ok) {
                    try {
                        const tab = await chrome.tabs.get(tabId);
                        const tabUrl = tab?.url || '';
                        const isIG = tabUrl.includes('instagram.com');
                        const isX = tabUrl.includes('x.com') || tabUrl.includes('twitter.com');

                        const finishScan = async (finalRes, platform) => {
                            const state2 = await new Promise((resolve) => chrome.storage.local.get(['deep_scan_state', 'last_capture_debug'], resolve));
                            const currentState = state2 ? state2.deep_scan_state : null;
                            const cap = state2.last_capture_debug || { attempted: 0, saved: 0, duplicate: 0 };
                            
                            let finalStatus = "DONE";
                            if (cap.attempted > 0) {
                                if (cap.saved + cap.duplicate > 0) finalStatus = "DONE";
                                else finalStatus = "NO_SAVES";
                            } else {
                                finalStatus = "FAILED";
                            }

                            if (currentState === "STOPPED") {
                                const stopReason = finalRes && finalRes.stop_reason ? String(finalRes.stop_reason) : 'manual_stop';
                                try { if (self.RateLimiter && self.RateLimiter.endSession) await self.RateLimiter.endSession(stopReason || 'manual_stop'); } catch (e) { }
                                chrome.storage.local.set({
                                    deep_scan_running: false,
                                    deep_scan_finished_at: new Date().toISOString(),
                                    deep_scan_result: finalRes,
                                    last_event: `DEEP SCAN STOPPED (${platform})`,
                                    last_event_at: new Date().toISOString()
                                });
                            } else {
                                const stopReason = finalRes && finalRes.stop_reason ? String(finalRes.stop_reason) : null;
                                try { if (self.RateLimiter && self.RateLimiter.endSession) await self.RateLimiter.endSession(stopReason || 'done'); } catch (e) { }
                                chrome.storage.local.set({
                                    deep_scan_state: finalStatus,
                                    deep_scan_running: false,
                                    deep_scan_finished_at: new Date().toISOString(),
                                    deep_scan_result: finalRes,
                                    last_event: `DEEP SCAN ${finalStatus} (${platform})`,
                                    last_event_at: new Date().toISOString()
                                });
                            }
                        };

                        if (isIG) {
                            console.log('[IG Deep Scan] Scroller complete. Starting fallback...');
                            const activeTask = await getActiveTask();
                            const originalDeepScanUrl = tabUrl;
                            
                            // 3. Flush API Buffer first (might avoid navigation)
                            const buffer = igApiBuffer.get(tabId) || [];
                            igApiBuffer.delete(tabId);
                            console.log(`[IG Deep Scan] Initial buffer has ${buffer.length} posts`);

                            // 5a. Send initial buffer capture
                            let bufferDebug = null;
                            if (buffer.length > 0) {
                                bufferDebug = await sendInstagramCaptures(tabId, buffer, tabUrl, activeTask, "[IG Deep Scan Buffer]");
                            }

                            // 1 & 2. Visible Posts & Extract (Only if buffer was empty or insufficient)
                            const extractedPosts = [];
                            const skipNavigation = bufferDebug && (bufferDebug.saved + bufferDebug.duplicate > 0);
                            
                            if (skipNavigation) {
                                console.log('[IG Deep Scan] API buffer already captured posts. Skipping individual post navigation.');
                            } else {
                                const scrapeRes = await sendMessageWithRetry(tabId, { type: "GET_FIRST_POST_URLS", task: activeTask });
                                const visibleUrls = scrapeRes?.urls || [];
                                console.log(`[IG Deep Scan] Found ${visibleUrls.length} visible URLs for fallback navigation`);

                                for (const vUrl of visibleUrls) {
                                    // Guard: check if scan was stopped/finished
                                    const st = await new Promise(r => chrome.storage.local.get(['deep_scan_state'], r));
                                    const curState = st?.deep_scan_state;
                                    if (curState === 'DONE' || curState === 'STOPPED' || curState === 'FAILED') break;

                                    await chrome.tabs.update(tabId, { url: vUrl });
                                    await new Promise(r => setTimeout(r, 4000)); // wait for load
                                    const ext = await sendMessageWithRetry(tabId, { type: "EXTRACT_POST_FROM_PAGE", task: activeTask });
                                    if (ext?.ok && ext.post) extractedPosts.push(ext.post);
                                }
                                
                                // Restore original URL
                                if (visibleUrls.length > 0) {
                                    await chrome.tabs.update(tabId, { url: originalDeepScanUrl });
                                }
                            }

                            // 5b. Send any extractions
                            if (extractedPosts.length > 0) {
                                await sendInstagramCaptures(tabId, extractedPosts, tabUrl, activeTask, "[IG Deep Scan Extracted]");
                            } else if (!bufferDebug) {
                                // Update attempted for status logic if no posts found anywhere
                                chrome.storage.local.set({
                                    last_capture_debug: { attempted: 0, saved: 0, duplicate: 0, failed: 0, analyzed: 0 }
                                });
                            }

                            await finishScan(res, 'IG');

                        } else if (isX) {
                            console.log('[X Deep Scan] Scroller complete. Starting fallback...');
                            chrome.tabs.sendMessage(tabId, { type: "SCRAPE_VISIBLE_POSTS", task: { platform: "x" } }, async (scrapeRes) => {
                                if (!chrome.runtime.lastError && scrapeRes?.ok && scrapeRes.posts?.length > 0) {
                                    console.log(`[X Deep Scan] DOM scrape found ${scrapeRes.posts.length} posts`);
                                    await sendXCaptures(tabId, scrapeRes.posts, tabUrl, null, '[X Deep Scan]');
                                } else {
                                    markXTabUsable(tabId, tabUrl, { zero_reason: 'dom_found_zero', isScrape: true });
                                }
                                markRunnerProgress(tabId);
                                await finishScan(res, 'X');
                            });
                        } else {
                            // Other platform, just finish
                            await finishScan(res, 'Unknown');
                        }

                    } catch (e) {
                        console.error("[Deep Scan Completion Error]", e);
                        chrome.storage.local.set({ deep_scan_state: "FAILED", deep_scan_running: false });
                    }
                    sendResponse({ ok: true, result: res });
                } else {
                    const err = (res && res.error) ? res.error : "deep_scan_failed";
                    try { if (self.RateLimiter && self.RateLimiter.endSession) await self.RateLimiter.endSession(err); } catch (e) { }
                    try {
                        chrome.storage.local.set({
                            deep_scan_state: "FAILED",
                            deep_scan_running: false,
                            deep_scan_last_error: err,
                            deep_scan_finished_at: new Date().toISOString(),
                            last_event: `DEEP SCAN FAILED: ${err}`,
                            last_event_at: new Date().toISOString()
                        });
                    } catch (e) { }
                    try {
                        chrome.storage.local.set({
                            last_error: `Deep Scan failed: ${err}`,
                            last_error_at: new Date().toISOString()
                        });
                    } catch (e) { }
                    sendResponse({ ok: false, error: err });
                }
                return;
            }

            if (msg.type === "STOP_DEEP_SCAN") {
                const st = await new Promise((resolve) => chrome.storage.local.get(['deep_scan_tab_id', 'active_tab_id'], resolve));
                let tabId = (st && typeof st.deep_scan_tab_id === 'number') ? st.deep_scan_tab_id : null;
                if (!tabId) tabId = (st && typeof st.active_tab_id === 'number') ? st.active_tab_id : null;

                try {
                    chrome.storage.local.set({
                        deep_scan_state: "STOPPING",
                        deep_scan_running: true,
                        last_event: "DEEP SCAN STOPPING",
                        last_event_at: new Date().toISOString()
                    });
                } catch (e) { }

                if (!tabId) {
                    try {
                        chrome.storage.local.set({
                            deep_scan_state: "FAILED",
                            deep_scan_running: false,
                            deep_scan_last_error: "No active tab to stop",
                            last_event: "DEEP SCAN STOP FAILED",
                            last_event_at: new Date().toISOString()
                        });
                    } catch (e) { }
                    sendResponse({ ok: false, error: "no_tab" });
                    return;
                }

                const stopRes = await sendStopToScroller(tabId);
                if (stopRes && stopRes.ok) {
                    try { if (self.RateLimiter && self.RateLimiter.endSession) await self.RateLimiter.endSession('manual_stop'); } catch (e) { }
                    try {
                        chrome.storage.local.set({
                            deep_scan_state: "STOPPED",
                            deep_scan_running: false,
                            deep_scan_finished_at: new Date().toISOString(),
                            deep_scan_last_error: null,
                            last_event: "DEEP SCAN STOPPED",
                            last_event_at: new Date().toISOString()
                        });
                    } catch (e) { }
                    sendResponse({ ok: true });
                    return;
                }

                const err = stopRes && stopRes.error ? stopRes.error : "stop_failed";
                try {
                    chrome.storage.local.set({
                        deep_scan_state: "RUNNING",
                        deep_scan_running: true,
                        deep_scan_last_error: err,
                        last_event: "DEEP SCAN STOP FAILED",
                        last_event_at: new Date().toISOString()
                    });
                } catch (e) { }

                sendResponse({ ok: false, error: err });
                return;
            }

            // 4. COMPLETE / FAIL & NEXT
            if (msg.type === "COMPLETE_AND_NEXT" || msg.type === "FAIL_AND_NEXT") {
                const active_task = await getActiveTask();
                if (!active_task) {
                    sendResponse({ ok: false, error: "No active task" });
                    return;
                }

                const isSuccess = msg.type === "COMPLETE_AND_NEXT";
                let status = isSuccess ? "completed" : "failed";
                let summary = isSuccess
                    ? { step: "completed_from_popup" }
                    : { error: "manual_fail_from_popup" };

                // Truthful Status Check for investigations (Step 1.2)
                const isInvestigate = active_task.type === 'investigate_user';
                const tabId = (await getActiveState()).active_tab_id;
                if (isInvestigate && tabId && isSuccess) {
                    const primed = xPrimedTabs.get(tabId);
                    if (primed && (primed.metrics.saved + primed.metrics.duplicate) === 0) {
                        console.log(`[X Lifecycle] Forcing FAILED status for ${active_task.id} due to zero results.`);
                        status = "failed";
                        summary = { 
                            outcome: "zero_results", 
                            last_zero_reason: primed.lastZeroReason || 'nothing_captured_or_matched'
                        };
                    }
                }

                markRunnerProgress();
                await patchStatus(active_task.id, status, summary);
                await clearActiveState();
                
                // Claim Next Immediately

                // Claim Next Immediately
                const nextTask = await claimNextTask();
                if (nextTask) {
                    await new Promise(r => chrome.storage.local.set({
                        active_task: nextTask,
                        active_task_claimed_at: new Date().toISOString()
                    }, r));
                    setEvent("NEXT TASK CLAIMED");
                    chrome.action.setBadgeText({ text: '1' });
                    sendResponse({ ok: true, next: true });
                } else {
                    setEvent("NO PENDING TASKS");
                    chrome.action.setBadgeText({ text: '' });
                    sendResponse({ ok: true, next: false });
                }
                return;
            }

            // 5. CLEAR_ACTIVE
            if (msg.type === "CLEAR_ACTIVE") {
                await clearActiveState();
                setEvent("ACTIVE CLEARED");
                sendResponse({ ok: true });
                return;
            }

            // 6. FOCUS_TAB
            if (msg.type === "FOCUS_TAB") {
                const state = await getActiveState();
                if (state.active_tab_id) {
                    chrome.tabs.update(state.active_tab_id, { active: true }, () => {
                        sendResponse({ ok: true });
                    });
                } else {
                    sendResponse({ ok: false });
                }
                return;
            }

            sendResponse({ ok: false, error: "Unknown message" });

        } catch (err) {
            console.error("BG Message Error", err);
            sendResponse({ ok: false, error: err.toString() });
        }
    };

    handleAsync();
    return true; // Keep channel alive
});

// Lifecycle Listeners for X Priming (Step 1.1d)
chrome.tabs.onRemoved.addListener((tabId) => {
    xPrimedTabs.delete(tabId);
    igPrimedTabs.delete(tabId);
    igApiBuffer.delete(tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.url) {
        const primed = xPrimedTabs.get(tabId);
        if (primed && primed.normalizedUrl !== normalizeXUrl(changeInfo.url)) {
            console.log(`[X Lifecycle] URL changed on tab ${tabId}. Clearing primed state.`);
            xPrimedTabs.delete(tabId);
            igPrimedTabs.delete(tabId);
            igApiBuffer.delete(tabId);
        }
    }
});

// Helper: Extract Instagram posts from intercepted JSON (simple, robust)
function extractInstagramPosts(json, interceptedUrl) {
    const results = [];
    const diag = {
        payload_keys: json ? Object.keys(json) : [],
        candidate_nodes: 0,
        reasons: {} // shortcode: reason
    };

    function getTextFromNode(node) {
        try {
            if (node && node.edge_media_to_caption && Array.isArray(node.edge_media_to_caption.edges)) {
                const e0 = node.edge_media_to_caption.edges[0];
                if (e0 && e0.node && typeof e0.node.text === 'string') return e0.node.text.trim();
            }
        } catch (e) { }
        try {
            if (node && node.caption && typeof node.caption.text === 'string') return node.caption.text.trim();
        } catch (e) { }
        return '';
    }

    function getHandle(node) {
        try { if (node && node.owner && typeof node.owner.username === 'string') return node.owner.username; } catch (e) { }
        try { if (node && node.user && typeof node.user.username === 'string') return node.user.username; } catch (e) { }
        try { if (node && typeof node.username === 'string') return node.username; } catch (e) { }
        try { if (node && node.user && typeof node.user.login === 'string') return node.user.login; } catch (e) { }
        return null;
    }

    function getDisplayName(node) {
        try { if (node && node.user && typeof node.user.full_name === 'string') return node.user.full_name; } catch (e) { }
        try { if (node && typeof node.full_name === 'string') return node.full_name; } catch (e) { }
        return null;
    }

    function getMetrics(node) {
        const m = { likes: 0, comments: 0 };
        try {
            if (node.edge_media_preview_like) m.likes = node.edge_media_preview_like.count || 0;
            else if (node.like_count) m.likes = node.like_count;
        } catch (e) { }
        try {
            if (node.edge_media_to_comment) m.comments = node.edge_media_to_comment.count || 0;
            else if (node.comment_count) m.comments = node.comment_count;
        } catch (e) { }
        return m;
    }

    function nodeToPost(node) {
        let shortcode = null;
        try { if (node && typeof node.shortcode === 'string') shortcode = node.shortcode; } catch (e) { }
        if (!shortcode) {
            try { if (node && typeof node.code === 'string') shortcode = node.code; } catch (e) { }
        }
        
        if (!shortcode) {
            // Diagnostics: if it looks like a media node but has no shortcode
            if (node && (node.id || node.pk)) diag.candidate_nodes++;
            return null;
        }

        shortcode = (shortcode || '').trim();
        if (!shortcode || shortcode.indexOf(' ') !== -1) {
            diag.reasons[shortcode || 'empty'] = 'invalid_shortcode_format';
            return null;
        }

        const handle = getHandle(node);
        if (!handle) {
            diag.reasons[shortcode] = 'no_owner_handle';
            return null;
        }

        const caption = getTextFromNode(node);
        const display_name = getDisplayName(node);
        const metrics = getMetrics(node);

        let isReel = false;
        try {
            if (node && node.product_type && String(node.product_type).toLowerCase() === 'clips') isReel = true;
        } catch (e) { }
        try {
            if (!isReel && node && node.__typename && String(node.__typename).toLowerCase().indexOf('reel') !== -1) isReel = true;
        } catch (e) { }
        try {
            if (!isReel && node && node.is_reel === true) isReel = true;
        } catch (e) { }

        const postUrl = isReel
            ? `https://www.instagram.com/reel/${shortcode}/`
            : `https://www.instagram.com/p/${shortcode}/`;

        let raw_text = (caption || '').trim();
        if (!raw_text || raw_text === '') raw_text = "NO_TEXT | " + postUrl;

        let published_at = null;
        try {
            const ts = node.taken_at_timestamp || node.taken_at || (node.caption && node.caption.created_at);
            if (ts) {
                // If ts is in seconds (standard for IG API), convert to ms
                const ms = ts < 10000000000 ? ts * 1000 : ts;
                published_at = new Date(ms).toISOString();
            }
        } catch (e) { }

        return {
            platform: 'instagram',
            handle: handle,
            display_name: display_name || null,
            platform_post_id: shortcode,
            url: postUrl,
            raw_text: raw_text,
            metrics: metrics,
            published_at: published_at,
            raw_payload: { intercepted_url: interceptedUrl, scraped: true, ...node },
            captured_at: new Date().toISOString()
        };
    }

    function walk(obj) {
        if (!obj || results.length >= 25) return;
        if (typeof obj !== 'object') return;

        const post = nodeToPost(obj);
        if (post) {
            results.push(post);
            if (results.length >= 25) return;
        }

        try {
            const keys = Object.keys(obj);
            for (let i = 0; i < keys.length; i++) {
                if (results.length >= 25) break;
                const k = keys[i];
                const v = obj[k];
                if (Array.isArray(v)) {
                    for (let j = 0; j < v.length && results.length < 25; j++) {
                        walk(v[j]);
                    }
                } else if (v && typeof v === 'object') {
                    walk(v);
                }
            }
        } catch (e) { }
    }

    walk(json);

    if (results.length === 0) {
        chrome.storage.local.set({
            last_ig_extract_diag: diag
        });
    }

    return results;
}

function normalizePlatformForCapture(platformStr) {
    if (!platformStr) return 'other';
    const p = platformStr.toLowerCase();
    if (p === 'x' || p === 'twitter') return 'twitter';
    if (p === 'ig' || p === 'instagram') return 'instagram';
    return p;
}

function deriveInstagramHandle(url) {
    if (!url) return null;
    try {
        const u = new URL(url);
        if (u.hostname.indexOf('instagram.com') === -1) return null;
        const parts = u.pathname.split('/').filter(Boolean);
        if (parts.length === 0) return null;
        const handle = parts[0];
        // Exclude common IG non-profile paths
        const reserved = ['explore', 'reels', 'p', 'tv', 'stories', 'direct', 'accounts', 'emails', 'about', 'legal', 'terms', 'privacy'];
        if (reserved.includes(handle.toLowerCase())) return null;
        return handle;
    } catch (e) {
        return null;
    }
}

async function sendInstagramCaptures(tabId, posts, interceptedUrlUsed, task = null, logPrefix = "[IG Capture]") {
    const debug = {
        attempted: posts.length,
        saved: 0,
        duplicate: 0,
        failed: 0,
        analyzed: 0,
        analysis_errors: 0,
        last_status: 0,
        last_url: '',
        sample_post_id: '',
        sample_url: '',
        sample_raw_text_preview: '',
        intercepted_url_used: interceptedUrlUsed || '',
        source: logPrefix
    };

    if (!tabId) {
        console.error(`${logPrefix} Missing tabId. Capture aborted.`);
        chrome.storage.local.set({
            last_error: "IG capture skipped: missing tabId",
            last_event: "IG CAPTURE SKIPPED"
        });
        return debug;
    }

    try {
        const active_task = task || (await getActiveTask());
        const apiBase = await getApiBase();
        const captureUrl = `${apiBase}/api/posts/capture`;
        
        // Use IG-specific primed state
        let primed = igPrimedTabs.get(tabId);
        if (!primed) {
            primed = { saved: 0, duplicate: 0, seenPostIds: new Set() };
            igPrimedTabs.set(tabId, primed);
        }
        const sessionSeenIds = primed.seenPostIds;
        const capturedPostIds = [];

        for (let i = 0; i < posts.length; i++) {
            const p = posts[i];
            
            // Dedupe within this session
            if (p.platform_post_id && sessionSeenIds.has(p.platform_post_id)) {
                debug.duplicate++;
                continue;
            }
            if (p.platform_post_id) sessionSeenIds.add(p.platform_post_id);

            // Enrich metadata
            p.platform = 'instagram';
            if (!p.handle) {
                p.handle = deriveInstagramHandle(interceptedUrlUsed) || deriveInstagramHandle(p.url);
                // Last fallback: if we are in a task, use the task target
                if (!p.handle && active_task && active_task.platform === 'instagram') {
                    p.handle = active_task.target.replace('@', '');
                }
            }
            
            if (active_task) {
                p.task_id = active_task.id;
            }

            p.source_url = p.url || interceptedUrlUsed || '';
            p.captured_at = p.captured_at || new Date().toISOString();

            if (i === 0) {
                debug.last_url = p.url || '';
                debug.sample_post_id = p.platform_post_id || '';
                debug.sample_url = p.url || '';
                debug.sample_raw_text_preview = (p.raw_text || '').substring(0, 80);
            }

            try {
                const allowed = self.RateLimiter ? await self.RateLimiter.canProceed('capture') : { ok: true };
                if (!allowed.ok) {
                    const reason = allowed.reason || 'rate_limited';
                    setCaptureError(`Capture blocked: ${reason}`);
                    setEvent(`CAPTURE BLOCKED: ${reason}`);
                    break;
                }
                try { if (self.RateLimiter && self.RateLimiter.incrementPostsCaptured) await self.RateLimiter.incrementPostsCaptured(1); } catch (e) { }

                const res = await fetch(captureUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(p)
                });
                debug.last_status = res.status;
                if (res.ok) {
                    const json = await res.json().catch(() => ({}));
                    if (json && json.deduped) {
                        debug.duplicate++;
                        primed.duplicate++;
                    } else {
                        debug.saved++;
                        primed.saved++;
                        if (json && (typeof json.post_id === 'number' || typeof json.post_id === 'string')) {
                            const idNum = Number(json.post_id);
                            if (!Number.isNaN(idNum) && idNum > 0) capturedPostIds.push(idNum);
                        }
                    }
                    clearCaptureError();
                } else {
                    debug.failed++;
                    setCaptureError(`Capture HTTP ${res.status}`);
                }
            } catch (e) {
                debug.failed++;
                setCaptureError(e && e.message ? e.message : 'capture_failed');
            }
        }

        // Trigger analysis after successful capture
        if (capturedPostIds.length > 0) {
            console.log(`${logPrefix} Triggering analysis for ${capturedPostIds.length} posts`);
            try {
                const analysisRes = await analyzeCapturedPosts(apiBase, capturedPostIds);
                debug.analyzed = capturedPostIds.length;
                if (!analysisRes || !analysisRes.ok) {
                    debug.analysis_errors = capturedPostIds.length;
                    console.warn(`${logPrefix} Analysis trigger failed:`, analysisRes?.error);
                }
            } catch (ae) {
                debug.analysis_errors = capturedPostIds.length;
                console.error(`${logPrefix} Analysis error:`, ae);
            }
        }

        chrome.storage.local.set({
            last_capture_debug: debug,
            last_event: `${logPrefix} DONE: ${debug.saved} saved, ${debug.analyzed} analyzed`
        });

    } catch (e) {
        console.error(`${logPrefix} Error:`, e);
        chrome.storage.local.set({
            last_error: e && e.message ? e.message : 'IG capture error',
            last_error_at: new Date().toISOString()
        });
    }
    return debug;
}

// --- Resilient X Parsing Helpers (Step 1.1) ---
function findInstructionsResilient(data, opName) {
    let instructions = null;
    let source = 'none';

    // 1. Try Primary Paths
    try {
        if ((opName === 'HomeTimeline' || opName === 'HomeLatestTimeline') && data?.home?.home_timeline_urt?.instructions) {
            instructions = data.home.home_timeline_urt.instructions;
            source = 'primary_home_path';
        } else if ((opName === 'UserTweets' || opName === 'UserTweetsAndReplies' || opName === 'ProfileTimeline')) {
            instructions = data?.user?.result?.timeline_v2?.timeline?.instructions 
                         || data?.user?.result?.timeline?.timeline?.instructions
                         || data?.user?.timeline?.timeline?.instructions;
            if (instructions) source = 'primary_user_path';
        } else if (opName === 'SearchTimeline') {
            instructions = data?.search_by_raw_query?.search_timeline?.timeline?.instructions
                         || data?.search?.timeline?.timeline?.instructions;
            if (instructions) source = 'primary_search_path';
        }
    } catch (e) { }

    // 2. Fallback: Recursive find for 'instructions' array
    if (!instructions || !Array.isArray(instructions)) {
        const search = (obj, depth = 0) => {
            if (!obj || typeof obj !== 'object' || depth > 6) return null;
            if (Array.isArray(obj.instructions)) return obj.instructions;
            for (const key in obj) {
                if (obj[key] && typeof obj[key] === 'object') {
                    const found = search(obj[key], depth + 1);
                    if (found) return found;
                }
            }
            return null;
        };
        instructions = search(data);
        if (instructions) source = 'fallback_instruction_search';
    }

    return { instructions, source };
}

function findTweetResultResilient(obj, depth = 0) {
    if (!obj || typeof obj !== 'object' || depth > 6) return { result: null, source: 'none' };

    // 1. Direct result.legacy (The Tweet Object itself)
    if (obj.legacy && (obj.core || obj.rest_id)) {
        return { result: obj, source: 'direct_tweet_object' };
    }

    // 2. tweet_results.result path (Standard GraphQL)
    if (obj.tweet_results?.result) {
        let res = obj.tweet_results.result;
        if (res.tweet) return { result: res.tweet, source: 'tweet_results.result.tweet' };
        if (res.result) return { result: res.result, source: 'tweet_results.result.result' };
        return { result: res, source: 'tweet_results.result' };
    }

    // 3. Wrapped path: itemContent.tweet_results.result
    if (obj.itemContent?.tweet_results?.result) {
        let res = obj.itemContent.tweet_results.result;
        if (res.tweet) return { result: res.tweet, source: 'itemContent.tweet_results.result.tweet' };
        if (res.result) return { result: res.result, source: 'itemContent.tweet_results.result.result' };
        return { result: res, source: 'itemContent.tweet_results.result' };
    }

    // 4. itemContent directly if it contains a tweet
    if (obj.itemContent && obj.itemContent.tweet_results) {
        return findTweetResultResilient(obj.itemContent, depth + 1);
    }

    // 5. TweetWithVisibilityResults wrapper
    const type = obj.__typename || obj.tweet_results?.result?.__typename;
    if (type === 'TweetWithVisibilityResults' || obj.tweetDisplayType === 'TweetWithVisibilityResults') {
        const inner = obj.tweet_results?.result?.tweet || obj.tweet_results?.result || obj.tweet;
        if (inner) return { result: inner, source: 'visibility_wrapper' };
    }

    // 6. Generic Tweet type
    if (type === 'Tweet') {
        return { result: obj, source: 'typename_tweet' };
    }

    // 7. Recursive DNA search for core + legacy
    const priorityKeys = ['itemContent', 'tweet_results', 'result', 'tweet', 'tweet_result', 'item', 'content'];
    for (const key of priorityKeys) {
        if (obj[key] && typeof obj[key] === 'object') {
            const found = findTweetResultResilient(obj[key], depth + 1);
            if (found.result) return found;
        }
    }

    return { result: null, source: 'none' };
}

function processTweetResult(resultObj, url) {
    if (!resultObj) return null;
    
    // SKIP PROMOTED (Ads)
    if (resultObj.promotedMetadata || resultObj.itemContent?.promotedMetadata) {
        return null; 
    }

    let tweet = resultObj;
    // Unroll nesting
    if (tweet.tweet) tweet = tweet.tweet;
    if (tweet.result) tweet = tweet.result;
    if (tweet.tweet) tweet = tweet.tweet; // Support result.tweet.result etc

    let core = tweet.core;
    let legacy = tweet.legacy;

    if (!core || !legacy) {
        // Try fallback paths for legacy/core
        legacy = tweet.legacy || tweet.tweet?.legacy || resultObj.legacy;
        core = tweet.core || tweet.tweet?.core || resultObj.core;
        
        if (!core || !legacy) {
            if (tweet.__typename || resultObj.__typename) {
                console.log(`[X Parser] Extraction failed for __typename: ${tweet.__typename || resultObj.__typename}. Keys:`, Object.keys(tweet), "ResultObj Keys:", Object.keys(resultObj));
            }
            return null;
        }
    }

    const platform_post_id = tweet.rest_id || legacy.id_str || tweet.id_str;
    if (!platform_post_id) return null;

    let handle = '';
    let display_name = '';
    try {
        const userResult = core.user_results?.result || core.user_results?.result?.tweets_user_results?.result || core.user_results?.result?.result;
        const userLegacy = userResult?.legacy || core.legacy;
        if (userLegacy) {
            handle = userLegacy.screen_name;
            display_name = userLegacy.name;
        } else {
            if (core.user_results?.result?.__typename === 'UserUnavailable') {
                console.log(`[X Parser] User is unavailable for tweet ${platform_post_id}`);
            }
        }
    } catch (e) { }

    if (!handle) {
        // Last resort: extract from URL if handle is missing in payload but we have it elsewhere
        // But for now, we strictly require it from payload for data integrity
        return null;
    }

    const raw_text = legacy.full_text || legacy.text || '';
    const postUrl = `https://x.com/${handle}/status/${platform_post_id}`;

    return {
        platform: 'twitter',
        handle: handle,
        display_name: display_name || handle,
        platform_post_id: platform_post_id,
        url: postUrl,
        raw_text: raw_text || `NO_TEXT | ${postUrl}`,
        metrics: {
            likes: legacy.favorite_count || 0,
            retweets: legacy.retweet_count || 0,
            replies: legacy.reply_count || 0,
            quotes: legacy.quote_count || 0
        },
        raw_payload: { 
            ...tweet, 
            published_at_raw: legacy.created_at || null, 
            published_at_source: 'api_graphql',
            parser_source: resultObj.__source || 'resilient'
        }, 
        published_at: legacy.created_at ? new Date(legacy.created_at).toISOString() : null,
        captured_at: new Date().toISOString()
    };
}

function walkXTimelineEntries(entries, options = {}, depth = 0) {
    const { results, seenPostIds, diag, url } = options;
    if (!entries || !Array.isArray(entries) || depth > 5) return;

    entries.forEach((entry, idx) => {
        if (!entry) return;
        const content = entry.content || entry.item || entry;
        if (!content) return;

        // 1. Single Item (Direct Tweet)
        if (content.entryType === 'TimelineTimelineItem' || content.type === 'TimelineTimelineItem' || content.itemContent || content.tweet_results) {
            const res = findTweetResultResilient(content);
            if (res.result) {
                const post = processTweetResult(res.result, url);
                if (post && !seenPostIds.has(post.platform_post_id)) {
                    results.push(post);
                    seenPostIds.add(post.platform_post_id);
                    if (diag && !diag.tweet_sources.includes(res.source)) diag.tweet_sources.push(res.source);
                }
            }
        } 
        
        // 2. Module (Nested Items)
        if (content.entryType === 'TimelineTimelineModule' || content.type === 'TimelineTimelineModule' || content.items) {
            const items = content.items || (content.itemContent && content.itemContent.items);
            if (items && Array.isArray(items)) {
                walkXTimelineEntries(items, options, depth + 1);
            }
        }

        // 3. Nested Entries (Recursive)
        if (content.entries && Array.isArray(content.entries)) {
            walkXTimelineEntries(content.entries, options, depth + 1);
        }
    });
}

function extractXHomeTimelinePosts(payload, url) {
    if (!payload || !payload.data) return { posts: [], diagnostic: { instruction_source: 'none', fallback_attempted: false, tweet_sources: [] } };

    const diag = { instruction_source: 'none', fallback_attempted: false, tweet_sources: [] };
    const results = [];
    const seenPostIds = new Set();


    const { instructions, source } = findInstructionsResilient(payload.data, 'HomeTimeline');
    diag.instruction_source = source;
    diag.fallback_attempted = source.startsWith('fallback');

    if (instructions && Array.isArray(instructions)) {
        instructions.forEach(instr => {
            if (instr.type === 'TimelineAddEntries' && Array.isArray(instr.entries)) {
                walkXTimelineEntries(instr.entries, { results, seenPostIds, diag, url });
            }
        });
    }

    return { posts: results, diagnostic: diag };
}

function extractXProfilePosts(payload, url) {
    if (!payload || !payload.data) return { posts: [], diagnostic: { instruction_source: 'none', fallback_attempted: false, tweet_sources: [] } };

    const diag = { instruction_source: 'none', fallback_attempted: false, tweet_sources: [] };
    const results = [];
    const seenPostIds = new Set();

    const { instructions, source } = findInstructionsResilient(payload.data, 'UserTweets');
    diag.instruction_source = source;
    diag.fallback_attempted = source.startsWith('fallback');

    if (instructions && Array.isArray(instructions)) {
        instructions.forEach(instr => {
            if ((instr.type === 'TimelineAddEntries' || instr.type === 'TimelinePinEntry') && Array.isArray(instr.entries)) {
                walkXTimelineEntries(instr.entries, { results, seenPostIds, diag, url });
            } else if (instr.type === 'TimelinePinEntry' && instr.entry) {
                walkXTimelineEntries([instr.entry], { results, seenPostIds, diag, url });
            } else if (instr.type === 'TimelineAddEntries' && instr.entries) {
                walkXTimelineEntries(instr.entries, { results, seenPostIds, diag, url });
            } else if (instr.type === 'TimelineReplaceEntry' && instr.entry) {
                walkXTimelineEntries([instr.entry], { results, seenPostIds, diag, url });
            }
        });
    }

    return { posts: results, diagnostic: diag };
}

function extractXSearchPosts(payload, url) {
    if (!payload || !payload.data) return { posts: [], diagnostic: { instruction_source: 'none', fallback_attempted: false, tweet_sources: [] } };

    const diag = { instruction_source: 'none', fallback_attempted: false, tweet_sources: [] };
    const results = [];
    const seenPostIds = new Set();

    const { instructions, source } = findInstructionsResilient(payload.data, 'SearchTimeline');
    diag.instruction_source = source;
    diag.fallback_attempted = source.startsWith('fallback');

    if (instructions && Array.isArray(instructions)) {
        instructions.forEach(instr => {
            if (instr.type === 'TimelineAddEntries' && Array.isArray(instr.entries)) {
                walkXTimelineEntries(instr.entries, { results, seenPostIds, diag, url });
            }
        });
    }

    return { posts: results, diagnostic: diag };
}


// Helper: Send X Captures
async function sendXCaptures(tabId, posts, interceptedUrlUsed, xDebugObj, logPrefix = '[X Capture]') {
    const taskId = (await getActiveTask())?.id || 'no_task';
    console.log(`${logPrefix} [Task ${taskId}][Tab ${tabId}] incoming ${posts.length} posts to send`);
    if (xDebugObj) xDebugObj.send_called = true;
    
    // TRACK START (Step 2.5 Refined)
    const stateNow = await getActiveState();
    let batchKey = null;
    if (tabId && stateNow.active_task && stateNow.active_tab_id === tabId) {
        batchKey = `${tabId}-${stateNow.active_task.id}`;
        activeCaptures.set(batchKey, (activeCaptures.get(batchKey) || 0) + 1);
    }

    const debug = {
        attempted: posts.length,
        saved: 0,
        duplicate: 0,
        failed: 0,
        last_status: 0,
        last_url: '',
        sample_post_id: '',
        sample_url: '',
        sample_raw_text_preview: '',
        intercepted_url_used: interceptedUrlUsed || ''
    };
    try {
        const apiBase = await getApiBase();
        const captureUrl = `${apiBase}/api/posts/capture`;
        const capturedPostIds = []; const primed = xPrimedTabs.get(tabId); const sessionSeenIds = primed?.seenPostIds || new Set();
        for (let i = 0; i < posts.length; i++) {
            const p = posts[i]; if (p.platform_post_id && sessionSeenIds.has(p.platform_post_id)) { debug.duplicate++; continue; } if (p.platform_post_id) sessionSeenIds.add(p.platform_post_id);
            p.platform = normalizePlatformForCapture(p.platform);
            if (i === 0) {
                console.log(`${logPrefix} sample payload:`, JSON.stringify({
                    platform: p.platform, handle: p.handle, platform_post_id: p.platform_post_id, url: p.url, published_at: p.published_at, pub_raw: p.raw_payload?.published_at_raw, pub_src: p.raw_payload?.published_at_source, raw_text_preview: (p.raw_text || '').substring(0, 30)
                }));
                debug.last_url = p.url || '';
                debug.sample_post_id = p.platform_post_id || '';
                debug.sample_url = p.url || '';
                debug.sample_raw_text_preview = (p.raw_text || '').substring(0, 80);
            }
            try {
                const allowed = self.RateLimiter ? await self.RateLimiter.canProceed('capture') : { ok: true };
                if (!allowed.ok) {
                    const reason = allowed.reason || 'rate_limited';
                    setCaptureError(`Capture blocked: ${reason}`);
                    setEvent(`CAPTURE BLOCKED: ${reason}`);
                    debug.rate_limited = true;
                    debug.rate_limit_reason = reason;
                    break;
                }
                try { if (self.RateLimiter && self.RateLimiter.incrementPostsCaptured) await self.RateLimiter.incrementPostsCaptured(1); } catch (e) { }

                markRunnerProgress(tabId);
                const res = await fetch(captureUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(p)
                });
                debug.last_status = res.status;
                if (res.ok) {
                    const json = await res.json().catch(() => ({}));
                    const isDeduped = !!(json && json.deduped);
                    if (isDeduped) debug.duplicate++;
                    else debug.saved++;

                    // ONLY analyze if it's a NEW save (Requirement 6)
                    if (!isDeduped && json && (typeof json.post_id === 'number' || typeof json.post_id === 'string')) {
                        const idNum = Number(json.post_id);
                        if (!Number.isNaN(idNum) && idNum > 0) capturedPostIds.push(idNum);
                    }
                } else {
                    debug.failed++;
                    const errBody = await res.text().catch(() => '');
                    debug.last_error_status = res.status;
                    debug.last_error_body = errBody;
                    console.warn(`${logPrefix} HTTP ${res.status} body:`, errBody);
                }
            } catch (err) {
                debug.failed++;
                console.warn(`${logPrefix} Error`, err);
            }
        }

        console.log(`${logPrefix} [Task ${taskId}] Batch complete. Saved: ${debug.saved}, Duplicates: ${debug.duplicate}, Failed: ${debug.failed}`);

        if (xDebugObj) {
            xDebugObj.stage = "capture_done";
            xDebugObj.saved = debug.saved;
            xDebugObj.duplicate = debug.duplicate;
            xDebugObj.failed = debug.failed;
        }
        chrome.storage.local.set({ 
            last_capture_debug: xDebugObj || debug, 
            last_x_debug: xDebugObj || debug, 
            last_event: "X CAPTURE DONE" 
        });

        // INCREMENT METRICS EXACTLY ONCE (Requirement 1)
        // Pass isScrape: true if logPrefix suggests it was an intentional scrape/scroll
        const isScrape = logPrefix.includes('Scrape') || logPrefix.includes('Deep Scan') || logPrefix.includes('Deep Capture');
        await markXTabUsable(tabId, interceptedUrlUsed || '', { ...debug, isScrape });
        console.log(`${logPrefix} capture saved=${debug.saved} duplicate=${debug.duplicate} failed=${debug.failed}`);

        if (batchKey) {
            activeCaptures.set(batchKey, Math.max(0, (activeCaptures.get(batchKey) || 1) - 1));
        }
        
        markRunnerProgress(tabId);

        // TRIGGER ANALYSIS (Step 3 Addition)
        if (capturedPostIds.length > 0) {
            console.log(`${logPrefix} [Task ${taskId}] Triggering analysis for ${capturedPostIds.length} posts`);
            await analyzeCapturedPosts(apiBase, capturedPostIds);
        }

        return debug;
    } catch (e) {
        console.error("[X Capture Pipeline Error]", e);
        chrome.storage.local.set({
            last_error: e && e.message ? e.message : 'X capture error',
            last_error_at: new Date().toISOString()
        });
        return { attempted: posts.length, saved: 0, duplicate: 0, failed: posts.length };
    }
}

async function analyzeCapturedPosts(apiBase, postIds) {
    const uniq = [];
    try {
        const seen = new Set();
        for (let i = 0; i < (postIds || []).length; i++) {
            const id = postIds[i];
            if (!id) continue;
            if (seen.has(id)) continue;
            seen.add(id);
            uniq.push(id);
        }
    } catch (e) { }

    const debug = { attempted: uniq.length, success: 0, failed: 0 };
    if (!uniq.length) {
        chrome.storage.local.set({ last_analyze_debug: debug, last_event: "ANALYSIS DONE", analyze_last_error: null, analyze_last_error_at: null });
        return;
    }

    try {
        markRunnerProgress();
        const url = `${apiBase}/api/analysis/batch_analyze`;
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ post_ids: uniq })
        });

        if (!res.ok) {
            console.warn(`[Batch Analyze] HTTP ${res.status} error. Falling back to one-by-one.`);
            const errBody = await res.text().catch(() => 'no_body');
            const per = await analyzeCapturedPostsOneByOne(apiBase, uniq);
            chrome.storage.local.set({
                last_analyze_debug: per.debug,
                last_event: per.ok ? "ANALYSIS DONE (FALLBACK)" : "ANALYSIS FAILED (FALLBACK)",
                analyze_last_error: per.ok ? null : (per.error || `batch_http_${res.status}`),
                analyze_last_error_body: errBody,
                analyze_last_error_at: new Date().toISOString()
            });
            return;
        }

        const json = await res.json().catch(() => ({}));
        const errs = (json && typeof json.errors === 'number') ? json.errors : 0;
        debug.failed = errs || 0;
        debug.success = Math.max(0, uniq.length - debug.failed);

        console.log(`[Batch Analyze] Result: Total=${json?.total || 0}, Stored=${json?.stored_new || 0}, Reused=${json?.reused_existing || 0}, Errors=${errs}`);

        chrome.storage.local.set({
            last_analyze_debug: debug,
            last_event: "ANALYSIS DONE",
            analyze_last_error: null,
            analyze_last_error_at: null
        });
    } catch (e) {
        const per = await analyzeCapturedPostsOneByOne(apiBase, uniq);
        chrome.storage.local.set({
            last_analyze_debug: per.debug,
            last_event: per.ok ? "ANALYSIS DONE" : "ANALYSIS FAILED",
            analyze_last_error: per.ok ? null : (per.error || (e && e.message ? e.message : 'analyze_failed')),
            analyze_last_error_at: per.ok ? null : new Date().toISOString()
        });
    }
}

async function analyzeCapturedPostsOneByOne(apiBase, postIds) {
    const debug = { attempted: (postIds || []).length, success: 0, failed: 0 };
    try {
        const url = `${apiBase}/api/analysis/analyze`;
        for (let i = 0; i < (postIds || []).length; i++) {
            const id = postIds[i];
            if (!id) continue;
            try {
                const res = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ post_id: id, save: true, force: false })
                });
                if (res.ok) debug.success++;
                else debug.failed++;
            } catch (e) {
                debug.failed++;
            }
        }
        return { ok: debug.failed === 0, debug, error: debug.failed ? 'analyze_partial_failure' : null };
    } catch (e) {
        debug.failed = debug.attempted;
        return { ok: false, debug, error: e && e.message ? e.message : 'analyze_failed' };
    }
}
// Randomized Poll (25–45s)
chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name !== POLL_ALARM_NAME) return;

    try {
        if (self.RateLimiter && self.RateLimiter.resetDailyCountersIfNeeded) {
            await self.RateLimiter.resetDailyCountersIfNeeded();
        }
        const allowed = self.RateLimiter ? await self.RateLimiter.canProceed('poll') : { ok: true };
        if (!allowed.ok) {
            const reason = allowed.reason || 'rate_limited';
            chrome.storage.local.set({
                last_event: `POLL BLOCKED: ${reason}`,
                last_event_at: new Date().toISOString(),
                last_error: `Cooldown active: ${reason}`,
                last_error_at: new Date().toISOString()
            });
            const remaining = self.RateLimiter && self.RateLimiter.getCooldownRemainingMs ? await self.RateLimiter.getCooldownRemainingMs() : 60000;
            const waitMs = Math.max(30000, remaining);
            try { chrome.alarms.create(POLL_ALARM_NAME, { when: Date.now() + waitMs }); } catch (e) { }
            return;
        }

        // --- runnerBusy Watchdog (Step 2.2) ---
        if (runnerBusy) {
            const now = Date.now();
            const staleMs = now - runnerLastProgressAt;
            if (staleMs > RUNNER_WATCHDOG_TIMEOUT_MS) {
                const totalStuckMs = now - runnerStartTime;
                const state = await getActiveState();
                console.warn(`[Watchdog] runnerBusy stalled for ${staleMs}ms (Total stuck: ${totalStuckMs}ms). Force-resetting lock.`);
                
                chrome.storage.local.set({
                    watchdog_reset: true,
                    watchdog_at: new Date(now).toISOString(),
                    watchdog_reason: "runner_stalled",
                    watchdog_details: {
                        staleMs,
                        totalStuckMs,
                        taskId: state.active_task?.id || 'none',
                        tabId: state.active_tab_id || 'none'
                    },
                    last_event: "WATCHDOG RECOVERY",
                    last_event_at: new Date(now).toISOString()
                });

                runnerBusy = false;
                runnerStartTime = 0;
                runnerLastProgressAt = 0;
            }
        }

        const active_task = await getActiveTask();
        if (!active_task) {
            const task = await claimNextTask();
            if (task) {
                await new Promise(r => chrome.storage.local.set({
                    active_task: task,
                    active_task_claimed_at: new Date().toISOString()
                }, r));
                chrome.action.setBadgeText({ text: '1' });
                setEvent("TASK CLAIMED (BG)");
                console.log("[BG Poll] Task claimed:", task.id, "Target:", task.target);

                // --- Automatic Handoff to Execution ---
                const url = computeUrl(task);
                console.log("[BG Poll] Computed URL for auto-execution:", url);
                if (url) {
                    console.log("[BG Poll] Dispatching tab open/focus...");
                    openTab(url, (res) => {
                        if (res.ok) {
                            console.log("[BG Poll] Automatic tab opened/focused successfully. ID:", res.tabId);
                            setEvent("AUTO-EXECUTION STARTED");
                        } else {
                            console.error("[BG Poll] Failed to open automatic tab:", res.error);
                            setError(`Auto-execution failed: ${res.error}`);
                        }
                    });
                } else {
                    console.error("[BG Poll] URL computation failed for background task:", task.id);
                    setError("Auto-execution URL compute failed");
                }
            }
        }
    } catch (e) {
    } finally {
        scheduleNextPoll('auto');
    }
});

chrome.runtime.onInstalled.addListener(() => {
    try { if (self.RateLimiter && self.RateLimiter.initializeRateLimiterState) self.RateLimiter.initializeRateLimiterState(); } catch (e) { }
    scheduleNextPoll('install');
    recoverStaleTasks(); // Immediate cleanup on install/update
});

chrome.runtime.onStartup && chrome.runtime.onStartup.addListener(() => {
    try { if (self.RateLimiter && self.RateLimiter.initializeRateLimiterState) self.RateLimiter.initializeRateLimiterState(); } catch (e) { }
    scheduleNextPoll('startup');
    recoverStaleTasks(); // Immediate cleanup on startup
});

chrome.action.onClicked.addListener(async () => {
    console.log("[ICON CLICK]");
    const active_task = await getActiveTask();
    if (active_task) {
        chrome.storage.local.get(['active_tab_id'], (res) => {
            if (!res.active_tab_id) {
                const url = computeUrl(active_task);
                if (url) openTab(url, () => { });
            }
        });
    } else {
        const task = await claimNextTask();
        if (task) {
            await new Promise(r => chrome.storage.local.set({
                active_task: task,
                active_task_claimed_at: new Date().toISOString()
            }, r));
            chrome.action.setBadgeText({ text: '1' });
            setEvent("TASK CLAIMED (CLICK)");
            const url = computeUrl(task);
            if (url) openTab(url, () => { });
        }
    }
});

// --- X Lifecycle Helpers (Step 1.1c) ---
async function ensureXInterceptReady(tabId, wasJustOpened = false) {
    try {
        const tab = await chrome.tabs.get(tabId).catch(() => null);
        if (!tab || !tab.url) return false;
        
        const u = (tab.url || '').toLowerCase();
        const isX = u.indexOf('x.com') !== -1 || u.indexOf('twitter.com') !== -1;
        
        if (!isX || wasJustOpened) {
            return true;
        }

        const normalizedUrl = normalizeXUrl(tab.url);

        // check if already usable (skip reload) based on proof-of-productivity or recent intercept
        const primed = xPrimedTabs.get(tabId);
        if (primed && primed.normalizedUrl === normalizedUrl) {
            const hasProductivity = (primed.metrics.saved + primed.metrics.duplicate + primed.metrics.failed) > 0;
            const isInterceptFresh = (Date.now() - primed.lastInterceptAt) < X_INTERCEPT_FRESHNESS_MS;
            
            if (hasProductivity || isInterceptFresh) {
                console.log(`[X Lifecycle] Tab ${tabId} usable (Productivity: ${hasProductivity}, Fresh: ${isInterceptFresh}) for ${normalizedUrl}. Skipping reload.`);
                return true;
            }
        }

        // 2. Fallback: wait briefly for "late" intercept (up to 2s)
        console.log(`[X Lifecycle] Tab ${tabId} not yet usable. Waiting up to 2s for late intercept...`);
        for (let i = 0; i < 8; i++) { // 8 * 250ms = 2s
            await new Promise(r => setTimeout(r, 250));
            const p = xPrimedTabs.get(tabId);
            if (p && p.normalizedUrl === normalizedUrl) {
                if ((Date.now() - p.lastInterceptAt) < X_INTERCEPT_FRESHNESS_MS) {
                    console.log(`[X Lifecycle] Late intercept caught for ${tabId}. Skipping reload.`);
                    return true;
                }
            }
        }

        // 3. Controlled reload as last resort
        console.log(`[X Lifecycle] Still not primed. Triggering controlled reload for tab ${tabId}...`);
        await chrome.tabs.reload(tabId);
        
        return new Promise(resolve => {
            let timeout = setTimeout(() => {
                chrome.tabs.onUpdated.removeListener(listener);
                resolve(true); 
            }, 10000);

            const listener = (tid, info) => {
                if (tid === tabId && info.status === 'complete') {
                    clearTimeout(timeout);
                    chrome.tabs.onUpdated.removeListener(listener);
                    // Settle period
                    setTimeout(() => resolve(true), 1500);
                }
            };
            chrome.tabs.onUpdated.addListener(listener);
        });
    } catch (e) {
        console.error("[X Lifecycle] Error during readiness check", e);
        return true; // Fallback to proceed anyway
    }
}



async function triggerControlledScroll(tabId, taskId, scrollsRemaining) {
    if (scrollsRemaining <= 0) return;
    console.log(`[X Deep Capture] Triggering auto-scroll for Task ${taskId}, remaining: ${scrollsRemaining}`);
    
    const primed = xPrimedTabs.get(tabId);
    if (primed) primed.scrollsAttempted++;

    const lastInterceptBefore = primed?.lastInterceptAt || 0;
    const lastCaptureBefore = primed?.lastCaptureAt || 0;

    chrome.tabs.sendMessage(tabId, {
        type: 'DEEP_SCAN_START',
        duration_seconds: 2,
        max_scrolls: 1
    }, async (res) => {
        const err = chrome.runtime.lastError;
        if (err) {
            console.warn(`[X Deep Capture] Scroll trigger failed: ${err.message}`);
            triggerSettleTimer(tabId, taskId);
            return;
        }

        console.log(`[X Deep Capture] Scroll sent. Waiting for new data (API/DOM)...`);
        
        // Wait for either new API intercept or new capture or timeout
        let foundNewData = false;
        const waitStart = Date.now();
        const MAX_WAIT = 5000;
        
        while (Date.now() - waitStart < MAX_WAIT) {
            const current = xPrimedTabs.get(tabId);
            if (current && (current.lastInterceptAt > lastInterceptBefore || current.lastCaptureAt > lastCaptureBefore)) {
                foundNewData = true;
                console.log(`[X Deep Capture] New data detected after scroll! (Intercept: ${current.lastInterceptAt > lastInterceptBefore}, Capture: ${current.lastCaptureAt > lastCaptureBefore})`);
                break;
            }
            await new Promise(r => setTimeout(r, 400));
        }

        if (!foundNewData) {
            console.log(`[X Deep Capture] No new API data seen within ${MAX_WAIT}ms. Falling back to DOM scrape.`);
        }

        console.log(`[X Deep Capture] Post-scroll scrape started...`);
        chrome.tabs.get(tabId, (tab) => {
            if (!tab) return;
            chrome.tabs.sendMessage(tabId, {
                type: "SCRAPE_VISIBLE_POSTS",
                task: { type: 'investigate_user', id: taskId }
            }, async (scrapeRes) => {
                if (chrome.runtime.lastError) {
                    console.warn(`[X Deep Capture] Post-scroll scrape failed: ${chrome.runtime.lastError.message}`);
                } else if (scrapeRes && scrapeRes.ok && scrapeRes.posts) {
                    console.log(`[X Deep Capture] Post-scroll scrape found ${scrapeRes.posts.length} posts`);
                    const batchDebug = await sendXCaptures(tabId, scrapeRes.posts, tab.url, null, '[X Deep Capture]');
                }
                
                // Reschedule settle to check if we need more scrolls
                triggerSettleTimer(tabId, taskId);
            });
        });
    });
}

async function markXTabUsable(tabId, url, stats = null) {
    if (!tabId || !url) return;
    try {
        const state = await getActiveState();
        const normalizedUrl = normalizeXUrl(url);
        
        const existing = xPrimedTabs.get(tabId);
        const metrics = (existing && existing.normalizedUrl === normalizedUrl) 
            ? { ...existing.metrics } 
            : { attempted: 0, saved: 0, duplicate: 0, failed: 0 };
        
        let noNewPostsStreak = existing?.noNewPostsStreak || 0;
        const seenPostIds = existing?.seenPostIds || new Set();
        const beforeCount = seenPostIds.size;

        if (stats) {
            metrics.attempted += (stats.attempted || 0);
            metrics.saved += (stats.saved || 0);
            metrics.duplicate += (stats.duplicate || 0);
            metrics.failed += (stats.failed || 0);
            
            // Check for new posts to update streak (Requirement 3)
            if (stats.isScrape) {
                if (stats.saved === 0) {
                    noNewPostsStreak++;
                    console.log(`[X Streak] No new posts in scrape. Streak now: ${noNewPostsStreak}`);
                } else {
                    noNewPostsStreak = 0;
                }
            }
        }

        let newZeroReason = stats?.zero_reason || null;
        let lastZeroReason = existing?.lastZeroReason || null;

        if (metrics.saved > 0 || metrics.duplicate > 0) {
            lastZeroReason = null;
        } else if (newZeroReason) {
            const isSpecific = (r) => r === 'parser_extracted_zero' || r === 'dom_found_zero';
            if (!lastZeroReason || isSpecific(newZeroReason)) {
                lastZeroReason = newZeroReason;
            }
        }

        const entry = {
            taskId: state?.active_task?.id || null,
            normalizedUrl: normalizedUrl,
            lastInterceptAt: (stats && stats.intercepted) ? Date.now() : (existing ? existing.lastInterceptAt : 0),
            lastCaptureAt: (stats && stats.attempted > 0) ? Date.now() : (existing ? existing.lastCaptureAt : 0),
            metrics: metrics,
            lastZeroReason: lastZeroReason,
            scrollsAttempted: existing?.scrollsAttempted || 0,
            noNewPostsStreak: noNewPostsStreak,
            seenPostIds: seenPostIds
        };
        
        xPrimedTabs.set(tabId, entry);
        console.log(`[X Lifecycle] Tab ${tabId} usable state updated. Cumulative saved: ${metrics.saved}, duplicates: ${metrics.duplicate}, Streak: ${noNewPostsStreak}`);
    } catch (e) {
        console.warn("[X Lifecycle] Failed to mark tab usable", e);
    }
}
