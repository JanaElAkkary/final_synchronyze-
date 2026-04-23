console.log('[SYNC CS V1] scrape_visible_posts loaded');

// Listen for scrape request
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    try {
        if (!msg || !msg.type) return;
        try { console.log('[SYNC CS V1] msg:', msg.type); } catch (e) { }

        if (msg.type === "DEEP_SCAN_START" || msg.type === "STOP_DEEP_SCAN") {
            console.log(`[SYNC CS V1] intentionally ignoring ${msg.type}`);
            return;
        }

        if (msg.type === "GET_FIRST_POST_URLS") {
            getInstagramPostUrls()
                .then((result) => sendResponse({ ...result, success: !!result.ok }))
                .catch((e) => sendResponse({ ok: false, success: false, error: e && e.toString ? e.toString() : 'failed' }));
            return true;
        }

        if (msg.type === "EXTRACT_POST_FROM_PAGE") {
            extractInstagramPostPage(msg.task || {})
                .then((result) => sendResponse({ ...result, success: !!result.ok }))
                .catch((e) => sendResponse({ ok: false, success: false, error: e && e.toString ? e.toString() : 'failed' }));
            return true;
        }

        if (msg.type === "SCRAPE_VISIBLE_POSTS") {
            const task = msg.task || {};
            let platform = (task.platform || '').toLowerCase();

            if (!platform) {
                if (window.location.hostname.includes('x.com') || window.location.hostname.includes('twitter.com')) {
                    platform = 'x';
                }
            }

            if (platform === 'twitter' || platform === 'x') {
                try {
                    const scrapeRes = scrapeTwitter(task);
                    const posts = scrapeRes.posts || [];
                    if (posts && Array.isArray(posts)) {
                        posts.forEach(p => p.platform = 'twitter');
                    }
                    sendResponse({
                        ok: true,
                        success: true,
                        posts: posts,
                        debug: { 
                            platform: 'x', 
                            found: posts.length,
                            original_count: scrapeRes.original_count,
                            filtered_count: scrapeRes.filtered_count,
                            target_handle: scrapeRes.target_handle,
                            first_rejected_handle: scrapeRes.first_rejected_handle
                        }
                    });
                } catch (e) {
                    sendResponse({ ok: false, success: false, error: e.toString() });
                }
                return;
            }

            if (platform === 'instagram') {
                scrapeInstagram()
                    .then((result) => {
                        sendResponse({
                            ok: true,
                            success: true,
                            posts: result.posts,
                            debug: result.debug
                        });
                    })
                    .catch((e) => {
                        sendResponse({ ok: false, success: false, error: e.toString() });
                    });
                return true;
            }

            sendResponse({ ok: false, success: false, error: `Unsupported platform: ${platform || 'unknown'}` });
            return;
        }

        if (msg.type === "SCRAPE_X_EXPLORE_ITEMS") {
            const task = msg.task || {};
            const category = task.target === 'news' ? 'news' : 'trending';
            
            scrapeTwitterExploreWithRetry(category)
                .then(result => {
                    sendResponse({ 
                        ok: true, 
                        success: true, 
                        items: result.items,
                        debug: result.debug
                    });
                })
                .catch(e => {
                    sendResponse({ ok: false, success: false, error: e.toString() });
                });
            return true;
        }

        sendResponse({ ok: false, success: false, error: `Unhandled message type: ${msg.type}` });
        return;
    } catch (e) {
        try { sendResponse({ ok: false, success: false, error: e && e.message ? e.message : 'handler_error' }); } catch (e2) { }
        return;
    }
});

// --- Helpers ---
function normalizeHandle(h) {
    if (!h || typeof h !== 'string') return '';
    let val = h.trim().toLowerCase();
    if (val.startsWith('@')) val = val.substring(1);
    return val;
}

function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function waitForElement(selector, timeout = 8000) {
    return new Promise(resolve => {
        const el = document.querySelector(selector);
        if (el) return resolve(el);

        const observer = new MutationObserver(() => {
            const el = document.querySelector(selector);
            if (el) {
                observer.disconnect();
                resolve(el);
            }
        });

        observer.observe(document.body, { childList: true, subtree: true });

        setTimeout(() => {
            observer.disconnect();
            resolve(null);
        }, timeout);
    });
}

function normalizeTwitterDate(timeEl) {
    if (!timeEl) return { date: null, source: 'none' };
    
    // 1. Try datetime attribute (ISO 8601)
    const iso = timeEl.getAttribute('datetime');
    const text = (timeEl.innerText || '').trim();
    if (iso) {
        return { date: iso, source: 'time.datetime', raw_text: text || iso };
    }

    // 2. Try visible text
    if (!text) return { date: null, source: 'none', raw_text: null };

    const now = new Date();
    
    // Handle relative dates: "2h", "5m", "10s", "1d"
    if (text.endsWith('h') || text.endsWith('m') || text.endsWith('s') || text.endsWith('d')) {
        const val = parseInt(text);
        if (!isNaN(val)) {
            const d = new Date(now);
            if (text.endsWith('h')) d.setHours(now.getHours() - val);
            else if (text.endsWith('m')) d.setMinutes(now.getMinutes() - val);
            else if (text.endsWith('s')) d.setSeconds(now.getSeconds() - val);
            else if (text.endsWith('d')) d.setDate(now.getDate() - val);
            return { date: d.toISOString(), source: 'relative_text' };
        }
    }

    // Handle "Month Day" (e.g. "Feb 11")
    const parts = text.split(' ');
    if (parts.length === 2) {
        // Infer year
        const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        const mIdx = months.indexOf(parts[0]);
        const day = parseInt(parts[1]);
        
        if (mIdx !== -1 && !isNaN(day)) {
            let year = now.getFullYear();
            const candidate = new Date(year, mIdx, day, 12, 0, 0);
            
            // If the date is in the future relative to now, assume it's last year
            if (candidate > now) {
                year = year - 1;
            }
            const finalDate = new Date(year, mIdx, day, 12, 0, 0);
            return { 
                date: finalDate.toISOString(), 
                source: 'visible_text_inferred_year',
                raw_text: text,
                inferred_year: year
            };
        }
    }

    // Handle "Month Day, Year" (e.g. "Feb 11, 2024")
    if (text.includes(',')) {
        const d = new Date(text);
        if (!isNaN(d.getTime())) {
            return { date: d.toISOString(), source: 'visible_text_full' };
        }
    }

    return { date: null, source: 'unsupported_format', raw_text: text };
}

// --- Twitter Scraper ---
function scrapeTwitter(task = {}) {
    const posts = [];
    const articles = document.querySelectorAll('article[data-testid="tweet"]');
    
    // Determine context
    const currentUrl = window.location.href;
    const isSearch = currentUrl.includes('/search');
    const isExplore = currentUrl.includes('/explore');
    const taskType = task.type || '';
    
    if (isSearch) {
        console.log(`[X Search] scraping ${articles.length} visible posts from search result page`);
    } else if (isExplore) {
        console.log(`[X Explore] scraping ${articles.length} visible posts from explore page`);
    }

    for (let i = 0; i < articles.length && posts.length < 10; i++) {
        const art = articles[i];
        try {
            // 1. User Handle
            const userLink = art.querySelector('div[data-testid="User-Name"] a[href^="/"]');
            let handle = '';
            let displayName = '';

            if (userLink) {
                const href = userLink.getAttribute('href') || '';
                handle = href.replace('/', '').split('/')[0].split('?')[0]; 
                displayName = (userLink.innerText || '').split('\n')[0].trim();
            }

            // 2. Text
            const textDiv = art.querySelector('div[data-testid="tweetText"]');
            let rawText = textDiv ? textDiv.innerText : '';
            rawText = rawText.trim();

            // 3. ID & URL & Dates
            const timeEl = art.querySelector('time');
            const timeLink = timeEl?.closest('a');
            let url = '';
            let platformPostId = '';
            let capturedAt = new Date().toISOString();
            let publishedAtInfo = normalizeTwitterDate(timeEl);

            if (timeLink) {
                url = timeLink.href || '';
                if (url && !url.startsWith('http')) url = 'https://x.com' + url;
                const match = url.match(/status\/(\d+)/);
                if (match) {
                    platformPostId = match[1];
                }
            }

            if (!rawText || rawText === '') {
                rawText = "NO_TEXT | " + (url || window.location.href);
            }

            if (!platformPostId) {
                platformPostId = 'tw_' + Math.random().toString(36).substring(2, 10);
            }

            if (rawText || url) {
                const postObj = {
                    platform: 'twitter',
                    handle: handle || 'unknown',
                    display_name: displayName || 'Unknown',
                    platform_post_id: platformPostId,
                    url: url,
                    raw_text: rawText,
                    raw_payload: { 
                        scraped: true,
                        captured_at: capturedAt,
                        published_at_raw: publishedAtInfo.raw_text || null,
                        published_at_source: publishedAtInfo.source,
                        source_page_url: currentUrl
                    },
                    captured_at: capturedAt,
                    published_at: publishedAtInfo.date
                };

                // Attach Explore metadata if applicable
                if (isExplore) {
                    postObj.raw_payload.captured_from = "x_explore";
                    postObj.raw_payload.x_surface = "explore";
                    
                    if (taskType === 'explore_trending' || currentUrl.includes('/trending')) {
                        postObj.raw_payload.x_tab = "trending";
                    } else if (taskType === 'explore_news' || currentUrl.includes('/news')) {
                        postObj.raw_payload.x_tab = "news";
                    } else {
                        // Fallback for general explore
                        postObj.raw_payload.x_tab = "general";
                    }
                }

                posts.push(postObj);
            }
        } catch (err) {
            console.error('Twitter scrape error', err);
        }
    }

    const originalCount = posts.length;
    let filteredPosts = posts;
    let targetHandle = null;
    let firstRejectedHandle = null;

    if (taskType === 'investigate_user' && task.target) {
        targetHandle = normalizeHandle(task.target);
        if (targetHandle) {
            filteredPosts = posts.filter(p => {
                const h = normalizeHandle(p.handle);
                const match = (h === targetHandle);
                if (!match && !firstRejectedHandle && h !== 'unknown') {
                    firstRejectedHandle = h;
                }
                return match;
            });
            console.log(`[X Scrape] Profile Investigation filtering: ${originalCount} visible -> ${filteredPosts.length} target (@${targetHandle})`);
        }
    }

    return { 
        posts: filteredPosts, 
        original_count: originalCount,
        filtered_count: filteredPosts.length,
        target_handle: targetHandle,
        first_rejected_handle: firstRejectedHandle
    };
}

// --- Instagram: Step 1 (Get URLs) ---
async function getInstagramPostUrls() {
    const debug = {
        platform: "instagram",
        found_links_count: 0,
        sample_hrefs: [],
        reason_if_failed: ""
    };

    try {
        const startWait = Date.now();
        const waitTimeout = 25000;
        const uniqueLinksMap = new Map();

        while (Date.now() - startWait < waitTimeout) {
            uniqueLinksMap.clear();
            const allAnchors = Array.from(document.querySelectorAll('a'));

            for (const a of allAnchors) {
                const raw = a.getAttribute('href') || '';
                const abs = a.href || '';
                let candidate = '';
                if (raw.includes('/p/') || raw.includes('/reel/') || raw.includes('/tv/')) candidate = raw;
                else if (abs.includes('/p/') || abs.includes('/reel/') || abs.includes('/tv/')) candidate = abs;

                if (candidate) {
                    const match = candidate.match(/(p|reel|tv)\/([^\/\?\#]+)/);
                    if (match) {
                        const type = match[1];
                        const shortcode = match[2];
                        const canonicalUrl = `https://www.instagram.com/${type}/${shortcode}/`;
                        if (!uniqueLinksMap.has(canonicalUrl)) uniqueLinksMap.set(canonicalUrl, a);
                    }
                }
            }
            if (uniqueLinksMap.size >= 1) break;
            await wait(500);
        }

        const uniqueLinks = Array.from(uniqueLinksMap.keys()).slice(0, 3);
        debug.found_links_count = uniqueLinks.length;
        debug.sample_hrefs = uniqueLinks;

        if (uniqueLinks.length === 0) {
            const pageText = document.body.innerText || "";
            if (pageText.includes("This account is private") || pageText.includes("Follow to see their photos and videos")) {
                debug.reason_if_failed = "Private account";
            } else {
                debug.reason_if_failed = "No posts found";
            }
            return { ok: false, error: debug.reason_if_failed, debug };
        }

        return { ok: true, urls: uniqueLinks, debug };
    } catch (e) {
        return { ok: false, error: e.toString(), debug };
    }
}

// --- Instagram: Step 2 (Extract Post) ---
async function extractInstagramPostPage(task = {}) {
    const url = window.location.href;
    let platformPostId = '';
    let shortcodeType = 'unknown';
    
    // Support /p/, /reel/, and /tv/
    const idMatch = url.match(/\/(p|reel|tv)\/([^/]+)/);
    if (idMatch) {
        shortcodeType = idMatch[1];
        platformPostId = idMatch[2];
    } else {
        platformPostId = 'ig_' + Math.random().toString(36).substring(2, 10);
    }

    // Handle normalization from task.target
    let handle = 'unknown';
    let handleSource = 'unknown';
    if (task.target) {
        let h = task.target.trim();
        if (h.startsWith('@') || h.startsWith('#')) {
            h = h.substring(1);
        }
        handle = h;
        handleSource = 'task';
    }

    // Display name defaults to handle
    let displayName = handle;

    // Debug logging (concise)
    console.log(`[IG Extract] id:${platformPostId} (${shortcodeType}), handle:${handle}, source:${handleSource}`);

    // Meta extraction (unchanged raw_text logic)
    let rawText = '';
    const metaDesc = document.querySelector('meta[property="og:description"]') || document.querySelector('meta[name="description"]');

    if (metaDesc) {
        let content = metaDesc.getAttribute('content') || '';
        content = content.trim();

        // Parse "Quotes"
        const quoteMatch = content.match(/["“](.*?)["”]/);
        if (quoteMatch && quoteMatch[1]) {
            rawText = quoteMatch[1];
        } else if (content.includes(": ")) {
            // "Likes, Comments - Handle: Caption"
            const parts = content.split(": ");
            if (parts.length > 1) {
                rawText = parts.slice(1).join(": "); // Everything after first colon
            } else {
                rawText = content;
            }
        } else {
            rawText = content;
        }
    }

    // Fallback if empty
    if (!rawText) rawText = "";

    const post = {
        platform: 'instagram',
        handle: handle,
        display_name: displayName,
        platform_post_id: platformPostId,
        url: url,
        raw_text: rawText,
        captured_at: new Date().toISOString(),
        raw_payload: { 
            scraped: true,
            debug: {
                shortcode: platformPostId,
                shortcode_type: shortcodeType,
                handle: handle,
                handle_source: handleSource
            }
        }
    };

    return { ok: true, post };
}

// --- Instagram Scraper (Legacy/Grid) ---
async function scrapeInstagram() {
    const posts = [];
    const debug = {
        platform: "instagram",
        wait_ms_used: 0,
        anchor_count: 0,
        sample_hrefs: [],
        sample_abs_hrefs: [],
        found_links_count: 0,
        found_links_sample: [],
        clicked_count: 0,
        extracted_count: 0,
        reason_if_failed: ""
    };

    // 1. Find Post Links (with robust waiting & scanning)
    const startWait = Date.now();
    const waitTimeout = 25000; // 25 seconds
    const uniqueLinksMap = new Map(); // canonicalUrl -> anchor element

    while (Date.now() - startWait < waitTimeout) {
        uniqueLinksMap.clear();
        const allAnchors = Array.from(document.querySelectorAll('a'));

        for (const a of allAnchors) {
            const raw = a.getAttribute('href') || '';
            const abs = a.href || '';

            let candidate = '';
            // Robust check for /p/, /reel/, or /tv/
            if (raw.includes('/p/') || raw.includes('/reel/') || raw.includes('/tv/')) candidate = raw;
            else if (abs.includes('/p/') || abs.includes('/reel/') || abs.includes('/tv/')) candidate = abs;

            if (candidate) {
                // Canonical regex: /(p|reel|tv)\/([^\/\?\#]+)/
                const match = candidate.match(/(p|reel|tv)\/([^\/\?\#]+)/);
                if (match) {
                    const type = match[1];
                    const shortcode = match[2];
                    const canonicalUrl = `https://www.instagram.com/${type}/${shortcode}/`;
                    if (!uniqueLinksMap.has(canonicalUrl)) {
                        uniqueLinksMap.set(canonicalUrl, a);
                    }
                }
            }
        }

        if (uniqueLinksMap.size >= 1) break;
        await wait(500); // Poll every 500ms
    }

    debug.wait_ms_used = Date.now() - startWait;

    // Collect debug info from final state
    const finalAnchors = Array.from(document.querySelectorAll('a'));
    debug.anchor_count = finalAnchors.length;
    for (let i = 0; i < Math.min(10, finalAnchors.length); i++) {
        debug.sample_hrefs.push(finalAnchors[i].getAttribute('href') || '');
        debug.sample_abs_hrefs.push(finalAnchors[i].href || '');
    }

    const uniqueLinks = Array.from(uniqueLinksMap.values()).slice(0, 3);
    const canonicalUrls = Array.from(uniqueLinksMap.keys());
    debug.found_links_count = uniqueLinks.length;
    debug.found_links_sample = canonicalUrls.slice(0, 5);

    if (debug.found_links_count === 0) {
        const pageText = document.body.innerText || "";
        if (pageText.includes("This account is private") || pageText.includes("Follow to see their photos and videos")) {
            debug.reason_if_failed = "Private account";
        } else {
            debug.reason_if_failed = "Selector mismatch: anchors exist but no /p|reel|tv links found";
        }
        return { posts, debug };
    }

    // 2. Iterate and Click
    for (const link of uniqueLinks) {
        try {
            debug.clicked_count++;

            // Click the post tile
            link.click();

            // Wait for Modal
            const modal = await waitForElement('div[role="dialog"]', 8000);

            if (!modal) {
                console.log("IG Modal timeout");
                continue;
            }

            // Notify Background for "IG MODAL OPENED"
            try {
                chrome.runtime.sendMessage({ type: "IG_DEBUG_EVENT", event: "IG MODAL OPENED" });
            } catch (e) { /* ignore */ }

            // Extract Data
            let url = window.location.href;
            if (!url.includes('/p/')) {
                url = link.href; // Fallback
            }

            let shortcode = '';
            const match = url.match(/\/p\/([^/]+)/);
            if (match) shortcode = match[1];
            else shortcode = 'ig_' + Math.random().toString(36).substring(2, 10);

            let handle = '';
            const headerLink = modal.querySelector('header h2 a') || modal.querySelector('header a');
            if (headerLink) {
                handle = headerLink.innerText;
            }

            // Text/Caption
            let rawText = '';
            // Better strategy for caption: First list item in the comments section usually
            const firstComment = modal.querySelector('ul li span');
            if (firstComment) rawText = firstComment.innerText;
            else {
                // Try fallback selectors for Instagram caption
                const h1 = modal.querySelector('h1');
                if (h1) rawText = h1.innerText;
            }

            // Fallback for empty text (leave empty here, background will handle robust fallback)
            if (!rawText) rawText = "";

            posts.push({
                platform: 'instagram',
                handle: handle || 'unknown',
                display_name: handle || 'Unknown',
                platform_post_id: shortcode,
                url: url,
                raw_text: rawText,
                captured_at: new Date().toISOString(),
                raw_payload: { scraped: true }
            });

            debug.extracted_count++;

            // Close Modal
            const closeBtn = modal.querySelector('svg[aria-label="Close"]')?.closest('button')
                || modal.querySelector('div[role="button"] svg[aria-label="Close"]')?.closest('div[role="button"]');

            if (closeBtn) {
                closeBtn.click();
            } else {
                const ev = new KeyboardEvent('keydown', {
                    bubbles: true, cancelable: true, keyCode: 27, code: 'Escape', key: 'Escape'
                });
                document.dispatchEvent(ev);
            }

            await wait(1000);

        } catch (err) {
            console.error("IG Scrape Loop Error", err);
        }
    }

    return { posts, debug };
}

function isValidTrendLabel(text) {
    if (!text) return false;
    const val = text.trim().replace(/\s+/g, ' ');
    if (!val) return false;
    
    const low = val.toLowerCase();

    // 1. Reject pure numbers
    if (/^\d+$/.test(val)) return false;
    
    // 2. Reject dot
    if (val === '·') return false;

    // 3. Reject post counts (e.g. "10K posts", "1,234 posts", "50 posts")
    if (low.includes('posts') && /\d/.test(val)) return false;
    
    // 4. Reject generic metadata and metadata-like strings (e.g. "Trending in Egypt")
    const generic = [
        "trending", "show more", "explore", "posts", "what's happening", 
        "see new posts", "global trending", "the most popular posts"
    ];
    if (generic.includes(low)) return false;
    
    // Metadata lines often contain "trending" or "·"
    if (!val.startsWith('#') && (low.includes('trending') || val.includes('·'))) return false;

    // 5. Reject "Trending with ..."
    if (low.startsWith("trending with")) return false;
    
    // 6. Minimum length
    if (val.length < 2) return false;
    
    return true;
}

function scrapeTwitterExploreItems() {
    const items = [];
    const selector = 'div[data-testid="trend"]';
    const trends = document.querySelectorAll(selector);
    
    console.log(`[X Explore] Found ${trends.length} trend containers.`);

    trends.forEach((el) => {
        if (items.length >= 30) return;
        
        try {
            // Extract all visible text fragments in order
            const fragments = [];
            const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null, false);
            let node;
            while (node = walker.nextNode()) {
                const text = node.textContent.trim();
                if (text) fragments.push(text);
            }

            // Normalize fragments -> Ordered unique lines
            let lines = fragments.map(f => f.replace(/\s+/g, ' ').trim()).filter(f => f.length > 0);
            // Dedupe consecutive
            lines = lines.filter((line, i) => i === 0 || line !== lines[i-1]);

            if (lines.length === 0) return;

            let rank = null;
            let itemType = "trending";
            let label = "";
            let context = "";

            // Parsing Logic
            // 1. Find Rank (first pure integer)
            let foundRankIdx = -1;
            for (let i = 0; i < lines.length; i++) {
                const num = parseInt(lines[i]);
                if (!isNaN(num) && /^\d+$/.test(lines[i]) && num > 0 && num <= 35) {
                    rank = num;
                    foundRankIdx = i;
                    break;
                }
            }

            // 2. Identify Item Type (metadata after rank/dot)
            let ptr = (foundRankIdx !== -1) ? foundRankIdx + 1 : 0;
            if (lines[ptr] === "·") ptr++;

            // Greedily consume metadata lines before the label
            // e.g. ["1", "·", "Sports", "·", "Trending", "Label"]
            if (lines[ptr] && !isValidTrendLabel(lines[ptr])) {
                 itemType = lines[ptr];
                 ptr++;
                 // Handle cases like "Sports" followed by "·" followed by "Trending"
                 if (lines[ptr] === "·") ptr++;
                 if (lines[ptr] && !isValidTrendLabel(lines[ptr])) {
                     itemType += " · " + lines[ptr];
                     ptr++;
                 }
            }

            // 3. Find Label (first valid human-readable line)
            for (let i = ptr; i < lines.length; i++) {
                if (isValidTrendLabel(lines[i])) {
                    label = lines[i];
                    ptr = i + 1;
                    break;
                }
            }

            // 4. Record Context (the rest)
            if (ptr < lines.length) {
                context = lines.slice(ptr).join(" | ");
            }

            if (label) {
                items.push({
                    rank: rank || (items.length + 1),
                    label: label,
                    item_type: itemType,
                    raw_payload: {
                        lines: lines,
                        context: context
                    }
                });
            }
        } catch (e) {
            console.error("[X Explore] Item Scrape Error", e);
        }
    });
    
    // Debug Preview
    if (items.length > 0) {
        console.log("[X Explore] SCRAPE PREVIEW:", JSON.stringify(items.slice(0, 3), null, 2));
    }

    return items;
}

async function scrapeTwitterExploreWithRetry(category) {
    let items = [];
    let attempts = 0;
    const maxAttempts = 3;
    const warnings = [];
    const selectors_used = ['div[data-testid="trend"]'];
    
    console.log(`[X Explore] Starting robust scrape for: ${category}`);

    while (attempts < maxAttempts && items.length < 30) {
        attempts++;
        items = scrapeTwitterExploreItems();
        
        console.log(`[X Explore] Attempt ${attempts}: Scraped ${items.length} items`);
        
        if (items.length < 30) {
            // Scroll down a bit to trigger lazy loading
            window.scrollBy(0, 800);
            await wait(1200);
        }
    }

    if (items.length === 0) {
        warnings.push("no_items_found");
    } else if (items.length < 10) {
        warnings.push("snapshot_too_small_for_alerting");
    } else if (items.length < 30) {
        warnings.push("partial_snapshot");
    }

    return {
        items: items,
        debug: {
            count: items.length,
            category: category,
            attempts: attempts,
            source_url: window.location.href,
            warnings: warnings,
            selectors_used: selectors_used,
            scraped_at: new Date().toISOString()
        }
    };
}
