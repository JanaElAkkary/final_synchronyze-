import { apiClient } from './client';

// Get API Base from apiClient or local helper
const getApiBase = () => {
    // This is a bit of a hack since getApiBase isn't exported from client.js, 
    // but we can use the same logic or just reach for localStorage.
    try {
        const settings = localStorage.getItem('sync_settings');
        if (settings) {
            const parsed = JSON.parse(settings);
            if (parsed.apiBaseUrl && parsed.apiBaseUrl.trim() !== '') {
                const base = parsed.apiBaseUrl.trim().replace(/\/$/, '');
                return base.endsWith('/api') ? base : `${base}/api`;
            }
        }
    } catch (e) { }
    return 'http://localhost:8001/api';
};

export const analyzePost = async (postId) => {
    try {
        const res = await fetch(`${getApiBase()}/analysis/analyze`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ post_id: postId, save: true, force: true })
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.json();
    } catch (err) {
        return { status: 'error', message: err.message };
    }
};
