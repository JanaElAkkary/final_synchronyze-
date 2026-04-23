document.addEventListener('DOMContentLoaded', () => {
    // Helper: Safe ID selector
    const $ = (id) => document.getElementById(id);

    // UI Elements
    const els = {
        apiBaseInput: $('apiBaseInput'),
        btnSaveApi: $('btnSaveApi'),
        backendStatusBadge: $('backendStatusBadge'),
        btnToggleAdvanced: $('btnToggleAdvanced'),
        advancedSection: $('advancedSection'),
        deepScanStatus: $('deepScanStatus'),
        deepScanHintRow: $('deepScanHintRow'),
        deepScanHint: $('deepScanHint'),
        
        lastPoll: $('lastPoll'),
        lastEvent: $('lastEvent'),
        lastError: $('lastError'),
        taskClaimStatus: $('taskClaimStatus'),
        captureStatus: $('captureStatus'),
        interceptCount: $('interceptCount'),
        interceptPlatform: $('interceptPlatform'),
        interceptUrl: $('interceptUrl'),
        interceptAt: $('interceptAt'),
        lastOpenUrl: $('lastOpenUrl'),
        lastTabOpenError: $('lastTabOpenError'),
        lastScrapeSummary: $('lastScrapeSummary'),
        lastScrapeDebug: $('lastScrapeDebug'),
        activeTaskContent: $('activeTaskContent'),
        activeTaskDebug: $('activeTaskDebug'),
        taskStatusBadge: $('taskStatusBadge'),
        btnPoll: $('btnPoll'),
        btnStartResume: $('btnStartResume'),
        btnReloadTab: $('btnReloadTab'),
        btnCompleteNext: $('btnCompleteNext'),
        btnFailNext: $('btnFailNext'),
        btnOpen: $('btnOpen'),
        btnClear: $('btnClear'),
        btnStopDeepScan: $('btnStopDeepScan')
    };

    // Helper: Format Date
    const formatDate = (isoString) => {
        if (!isoString) return '—';
        return new Date(isoString).toLocaleTimeString();
    };

    const setAdvancedOpen = (open) => {
        try {
            if (els.advancedSection) els.advancedSection.style.display = open ? 'block' : 'none';
            if (els.btnToggleAdvanced) els.btnToggleAdvanced.textContent = open ? 'Advanced (Hide)' : 'Advanced';
            try { localStorage.setItem('sync_popup_advanced', open ? '1' : '0'); } catch (e) {}
        } catch (e) {}
    };

    const getAdvancedOpen = () => {
        try {
            const v = localStorage.getItem('sync_popup_advanced');
            return v === '1';
        } catch (e) {}
        return false;
    };

    const isSupportedUrl = (url) => {
        try {
            const u = (url || '').toLowerCase();
            return u.indexOf('instagram.com') !== -1 || u.indexOf('x.com') !== -1 || u.indexOf('twitter.com') !== -1;
        } catch (e) {}
        return false;
    };

    // Render State
    const render = (state) => {
        // Backend Config
        if (state.backend_base_url && els.apiBaseInput && state.backend_base_url !== els.apiBaseInput.value) {
            els.apiBaseInput.value = state.backend_base_url;
        }
        
        // Online Indicator
        const lastSuccess = state.last_api_success ? new Date(state.last_api_success) : null;
        const isOnline = lastSuccess && (new Date() - lastSuccess < 60000); // 60s timeout
        if (els.backendStatusBadge) {
            els.backendStatusBadge.textContent = isOnline ? "ONLINE" : "OFFLINE";
            els.backendStatusBadge.className = `badge ${isOnline ? 'green' : 'red'}`;
        }

        // Status Section
        if (els.lastPoll) els.lastPoll.textContent = formatDate(state.last_poll_at);
        if (els.lastEvent) els.lastEvent.textContent = state.last_event || '—';
        if (els.deepScanStatus) {
            const st = state.deep_scan_state || '';
            if (st === 'RUNNING') els.deepScanStatus.textContent = 'Running';
            else if (st === 'DONE') els.deepScanStatus.textContent = 'Done';
            else if (st === 'FAILED') els.deepScanStatus.textContent = 'Failed';
            else if (st === 'STOPPED') els.deepScanStatus.textContent = 'Stopped';
            else if (st === 'STOPPING') els.deepScanStatus.textContent = 'Stopping';
            else if (st === 'NO_SAVES') els.deepScanStatus.textContent = 'No Saves';
            else els.deepScanStatus.textContent = '—';
        }
        try {
            const hasTabId = typeof state.active_tab_id === 'number' && state.active_tab_id > 0;
            const supportedActiveTab = !!state.__popup_active_tab_supported;
            const enabled = hasTabId || supportedActiveTab;
            if (els.btnReloadTab) els.btnReloadTab.disabled = !enabled;
            if (els.btnStopDeepScan) {
                const running = (state.deep_scan_state === 'RUNNING') || (state.deep_scan_running === true);
                els.btnStopDeepScan.disabled = !running || state.deep_scan_state === 'STOPPING';
            }
            if (els.deepScanHintRow && els.deepScanHint) {
                if (!enabled) {
                    els.deepScanHint.textContent = 'Open Instagram/X tab to enable Deep Scan';
                    els.deepScanHintRow.style.display = 'flex';
                } else {
                    els.deepScanHintRow.style.display = 'none';
                }
            }
        } catch (e) {}

        if (els.lastError) {
            if (state.last_error) {
                let errorText = `${state.last_error}`;
                if (state.last_error_at) errorText += ` (${formatDate(state.last_error_at)})`;
                if (state.last_error_url) errorText += `\nURL: ${state.last_error_url}`;
                if (state.last_error_stack) errorText += `\nStack: ${state.last_error_stack.substring(0, 100)}...`;
                
                els.lastError.textContent = errorText;
                els.lastError.classList.add('error');
                els.lastError.style.whiteSpace = "pre-wrap";
                els.lastError.style.fontSize = "10px";
            } else {
                els.lastError.textContent = 'None';
                els.lastError.classList.remove('error');
            }
        }

        // Interceptor Section
        if (els.interceptCount) {
            els.interceptCount.textContent = (typeof state.intercept_count_total === 'number') ? state.intercept_count_total : 0;
        }
        if (els.interceptPlatform) {
            els.interceptPlatform.textContent = state.intercept_last_platform || '—';
        }
        if (els.interceptUrl) {
            const u = state.intercept_last_url || '';
            els.interceptUrl.textContent = u ? (u.length > 40 ? (u.substring(0, 37) + '...') : u) : '—';
            els.interceptUrl.title = u;
        }
        if (els.interceptAt) {
            els.interceptAt.textContent = formatDate(state.intercept_last_at);
        }

        // Last Scrape Section
        if (els.lastScrapeSummary) {
            if (state.last_scrape_summary) {
                const s = state.last_scrape_summary;
                els.lastScrapeSummary.innerHTML = `
                    ${s.posts_captured} posts (${s.platform})
                    <br><span class="small-date">${formatDate(s.timestamp)}</span>
                `;
            } else {
                els.lastScrapeSummary.textContent = '—';
            }
        }

        if (els.lastScrapeDebug) {
            const debug = {
                capture: state.last_capture_debug || null,
                ig_diag: state.last_ig_extract_diag || null,
                deep_scan_error: state.deep_scan_last_error || null
            };
            els.lastScrapeDebug.textContent = JSON.stringify(debug, null, 2);
        }

        // Task Claim status
        if (els.taskClaimStatus) {
            const err = state.task_last_error;
            if (err) {
                const when = state.task_last_error_at ? ` (${formatDate(state.task_last_error_at)})` : '';
                els.taskClaimStatus.textContent = `Failed: ${err}${when}`;
            } else {
                els.taskClaimStatus.textContent = 'OK';
            }
        }

        // Capture status summary
        if (els.captureStatus) {
            const cap = state.last_capture_debug || {};
            const toNum = (v) => (typeof v === 'number') ? v : (v ? Number(v) : 0);
            const s = toNum(cap.saved);
            const d = toNum(cap.duplicate);
            const f = toNum(cap.failed);
            const text = `S:${s} D:${d} F:${f}`;
            const capErr = state.capture_last_error;
            if (capErr) {
                const when = state.capture_last_error_at ? ` (${formatDate(state.capture_last_error_at)})` : '';
                els.captureStatus.textContent = `Failed: ${capErr}${when} | ${text}`;
            } else {
                els.captureStatus.textContent = text;
            }
        }

        // Capture counts (optional)
        try {
            const cap = state.last_capture_debug || {};
            const getNum = (v) => (typeof v === 'number') ? v : (v ? Number(v) : 0);
            const attempted = getNum(cap.attempted);
            const saved = getNum(cap.saved);
            const duplicate = getNum(cap.duplicate);
            const failed = getNum(cap.failed);
            const elA = document.getElementById('capAttempted');
            const elS = document.getElementById('capSaved');
            const elD = document.getElementById('capDuplicate');
            const elF = document.getElementById('capFailed');
            if (elA) elA.textContent = attempted ? String(attempted) : '0';
            if (elS) elS.textContent = saved ? String(saved) : '0';
            if (elD) elD.textContent = duplicate ? String(duplicate) : '0';
            if (elF) elF.textContent = failed ? String(failed) : '0';
        } catch (e) {}

        const hasTabId = typeof state.active_tab_id === 'number' && state.active_tab_id > 0;

        // Active Task Section
        if (state.active_task) {
            const t = state.active_task;
            
            // Badge Color Logic
            let badgeClass = 'blue';
            if (t.status === 'completed') badgeClass = 'green';
            if (t.status === 'failed') badgeClass = 'red';
            if (t.status === 'in_progress') badgeClass = 'yellow';
            
            if (els.taskStatusBadge) {
                els.taskStatusBadge.textContent = t.status;
                els.taskStatusBadge.className = `badge ${badgeClass}`;
            }

            if (els.activeTaskContent) {
                els.activeTaskContent.innerHTML = `
                    <div class="row"><span class="label">ID</span> <span class="value">${t.id}</span></div>
                    <div class="row"><span class="label">Target</span> <span class="value">${t.target}</span></div>
                    <div class="row"><span class="label">Platform</span> <span class="value">${t.platform}</span></div>
                    <div class="row"><span class="label">Tab</span> <span class="value">${state.active_tab_id || 'None'}</span></div>
                `;
            }
            
            // Enable Actions
            if (els.btnStartResume) els.btnStartResume.disabled = false;
            if (els.btnCompleteNext) els.btnCompleteNext.disabled = false;
            if (els.btnFailNext) els.btnFailNext.disabled = false;
            if (els.btnOpen) els.btnOpen.disabled = !hasTabId;
            if (els.btnClear) els.btnClear.disabled = false;

        } else {
            if (els.activeTaskContent) els.activeTaskContent.innerHTML = '<div class="no-task">No active task</div>';
            
            if (els.taskStatusBadge) {
                els.taskStatusBadge.textContent = '';
                els.taskStatusBadge.className = 'badge';
            }
            
            // Disable Actions
            if (els.btnStartResume) els.btnStartResume.disabled = true;
            if (els.btnCompleteNext) els.btnCompleteNext.disabled = true;
            if (els.btnFailNext) els.btnFailNext.disabled = true;
            if (els.btnOpen) els.btnOpen.disabled = !hasTabId;
            if (els.btnClear) els.btnClear.disabled = true;
        }
    };

    // Load State
    const refresh = () => {
        chrome.storage.local.get([
            'backend_base_url',
            'last_api_success',
            'last_poll_at',
            'last_event',
            'last_error',
            'last_error_at',
            'last_error_url',
            'task_last_error',
            'task_last_error_at',
            'capture_last_error',
            'capture_last_error_at',
            'deep_scan_state',
            'deep_scan_running',
            'deep_scan_started_at',
            'deep_scan_finished_at',
            'deep_scan_last_error',
            'intercept_count_total',
            'intercept_last_url',
            'intercept_last_at',
            'intercept_last_platform',
            'last_scrape_summary',
            'last_scrape_debug',
            'last_capture_debug',
            'active_task',
            'active_task_claimed_at',
            'active_tab_id'
        ], (state) => {
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                let supported = false;
                try {
                    const tab = (tabs && tabs[0]) ? tabs[0] : null;
                    supported = !!(tab && isSupportedUrl(tab.url || ''));
                } catch (e) {}
                state.__popup_active_tab_supported = supported;
                render(state);
            });
        });
    };

    // Event Listeners
    if (els.btnSaveApi) {
        els.btnSaveApi.addEventListener('click', () => {
            const url = els.apiBaseInput.value.trim().replace(/\/$/, '');
            if (url) {
                chrome.storage.local.set({ backend_base_url: url }, () => {
                    alert('Backend URL saved!');
                    refresh();
                });
            }
        });
    }

    const sendMsg = (type, cb) => {
        chrome.runtime.sendMessage({ type }, cb || (() => setTimeout(refresh, 500)));
    };

    els.btnPoll.addEventListener('click', () => sendMsg('POLL_NOW'));
    els.btnStartResume.addEventListener('click', () => sendMsg('START_RESUME'));
    els.btnReloadTab.addEventListener('click', () => {
        chrome.storage.local.get(['active_tab_id'], (st) => {
            const tabId = (st && typeof st.active_tab_id === 'number') ? st.active_tab_id : null;
            if (tabId && tabId > 0) {
                chrome.runtime.sendMessage({ type: 'DEEP_SCAN_START', tabId }, () => setTimeout(refresh, 500));
                return;
            }
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                const tab = (tabs && tabs[0]) ? tabs[0] : null;
                const liveTabId = tab && typeof tab.id === 'number' ? tab.id : null;
                chrome.runtime.sendMessage({ type: 'DEEP_SCAN_START', tabId: liveTabId }, () => setTimeout(refresh, 500));
            });
        });
    });

    if (els.btnStopDeepScan) {
        els.btnStopDeepScan.addEventListener('click', () => {
            chrome.runtime.sendMessage({ type: 'STOP_DEEP_SCAN' }, () => setTimeout(refresh, 300));
        });
    }
    els.btnCompleteNext.addEventListener('click', () => sendMsg('COMPLETE_AND_NEXT'));
    
    els.btnFailNext.addEventListener('click', () => {
        if (confirm('Mark task as failed?')) sendMsg('FAIL_AND_NEXT');
    });

    els.btnClear.addEventListener('click', () => {
        if (confirm('Clear active task?')) sendMsg('CLEAR_ACTIVE');
    });

    els.btnOpen.addEventListener('click', () => sendMsg('FOCUS_TAB'));

    // Initial Load
    setAdvancedOpen(getAdvancedOpen());
    if (els.btnToggleAdvanced) {
        els.btnToggleAdvanced.addEventListener('click', () => {
            const open = !!(els.advancedSection && els.advancedSection.style.display !== 'none');
            setAdvancedOpen(!open);
        });
    }
    refresh();

    // Auto-refresh every 2s while popup is open
    setInterval(refresh, 2000);
});
