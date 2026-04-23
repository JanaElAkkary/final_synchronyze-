// Simple API client
const normalizeApiBase = (raw) => {
  const trimmed = (raw || '').toString().trim().replace(/\/$/, '');
  if (!trimmed) return null;
  const withApi = trimmed.endsWith('/api') ? trimmed : `${trimmed}/api`;
  return withApi;
};

const getApiBase = () => {
  try {
    const envBase = import.meta.env && import.meta.env.VITE_API_BASE_URL;
    const normalizedEnv = normalizeApiBase(envBase);
    if (normalizedEnv) return normalizedEnv;

    const settings = localStorage.getItem('sync_settings');
    if (settings) {
      const parsed = JSON.parse(settings);
      if (parsed.apiBaseUrl && parsed.apiBaseUrl.trim() !== '') {
        const normalized = normalizeApiBase(parsed.apiBaseUrl);
        if (normalized) return normalized;
      }
    }
  } catch (e) { }
  return 'http://localhost:8001/api';
};

const getFallbackApiBase = (apiBase) => {
  if (!apiBase) return null;
  if (apiBase.includes('localhost:8001')) return apiBase.replace('localhost:8001', 'localhost:8000');
  if (apiBase.includes('127.0.0.1:8001')) return apiBase.replace('127.0.0.1:8001', '127.0.0.1:8000');
  if (apiBase.includes('localhost:8000')) return apiBase.replace('localhost:8000', 'localhost:8001');
  if (apiBase.includes('127.0.0.1:8000')) return apiBase.replace('127.0.0.1:8000', '127.0.0.1:8001');
  return null;
};

const fetchJson = async (url, options) => {
  const res = await fetch(url, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(formatBackendError(data, `HTTP error! status: ${res.status}`));
  return data;
};

const fetchJsonWithFallback = async (path, options) => {
  const apiBase = getApiBase();
  const primaryUrl = `${apiBase}${path}`;
  try {
    return await fetchJson(primaryUrl, options);
  } catch (err) {
    const msg = (err && err.message) ? err.message : String(err || '');
    const looksLikeNetwork =
      msg.toLowerCase().includes('failed to fetch') ||
      msg.toLowerCase().includes('networkerror') ||
      msg.toLowerCase().includes('err_failed');

    if (!looksLikeNetwork) throw err;

    const fallbackBase = getFallbackApiBase(apiBase);
    if (!fallbackBase) throw err;

    const fallbackUrl = `${fallbackBase}${path}`;
    return await fetchJson(fallbackUrl, options);
  }
};

const buildHeaders = (token, contentType = true) => {
  const headers = {};
  if (contentType) headers['Content-Type'] = 'application/json';
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
};

const formatBackendError = (data, fallback) => {
  if (!data) return fallback;
  const detail = data.detail;
  if (!detail) return fallback;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) {
    const msgs = detail
      .map((e) => {
        if (!e) return null;
        if (typeof e === 'string') return e;
        const loc = Array.isArray(e.loc) ? e.loc.join('.') : '';
        const msg = e.msg || e.message || '';
        if (loc && msg) return `${loc}: ${msg}`;
        return msg || null;
      })
      .filter(Boolean);
    if (msgs.length > 0) return msgs.join(', ');
  }
  return fallback;
};

const toNetworkErrorMessage = (err, apiBase) => {
  const raw = (err && err.message) ? err.message : String(err || 'Request failed');
  if (raw.toLowerCase().includes('failed to fetch') || raw.toLowerCase().includes('networkerror')) {
    return `Cannot reach backend (${apiBase}). Make sure the FastAPI server is running and the API base URL is correct.`;
  }
  return raw;
};

export const apiClient = {
  registerAnalyst: async ({ full_name, username, password }) => {
    try {
      const data = await fetchJsonWithFallback(`/auth/register`, {
        method: 'POST',
        headers: buildHeaders(null),
        body: JSON.stringify({ full_name, username, password })
      });
      return data;
    } catch (err) {
      return { status: 'error', message: toNetworkErrorMessage(err, getApiBase()) };
    }
  },

  loginAnalyst: async ({ username, password }) => {
    try {
      const data = await fetchJsonWithFallback(`/auth/login`, {
        method: 'POST',
        headers: buildHeaders(null),
        body: JSON.stringify({ username, password })
      });
      return data;
    } catch (err) {
      return { status: 'error', message: toNetworkErrorMessage(err, getApiBase()) };
    }
  },

  getMe: async (token) => {
    try {
      return await fetchJsonWithFallback(`/auth/me`, { headers: buildHeaders(token, false) });
    } catch (err) {
      return { status: 'error', message: toNetworkErrorMessage(err, getApiBase()) };
    }
  },

  updateProfile: async (token, { full_name, username, avatar_key }) => {
    try {
      const data = await fetchJsonWithFallback(`/auth/profile`, {
        method: 'PUT',
        headers: buildHeaders(token),
        body: JSON.stringify({ full_name, username, avatar_key })
      });
      return data;
    } catch (err) {
      return { status: 'error', message: toNetworkErrorMessage(err, getApiBase()) };
    }
  },

  getActors: async (options = 1000) => {
    try {
      let paramsString = '';
      if (typeof options === 'object') {
        const params = new URLSearchParams();
        for (const [key, value] of Object.entries(options)) {
          if (value !== undefined && value !== null && value !== '') {
            params.append(key, value);
          }
        }
        paramsString = params.toString();
      } else {
        paramsString = `limit=${options}`;
      }
      
      const res = await fetch(`${getApiBase()}/results/actors?${paramsString}`);
      if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
      return res.json();
    } catch (err) {
      return { status: 'error', message: err.message };
    }
  },

  getAlerts: async (limit = 200) => {
    try {
      const res = await fetch(`${getApiBase()}/results/alerts?limit=${limit}`);
      if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
      return res.json();
    } catch (err) {
      return { status: 'error', message: err.message };
    }
  },

  getCoordination: async (limit = 200) => {
    try {
      const res = await fetch(`${getApiBase()}/results/coordination?limit=${limit}`);
      if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
      return res.json();
    } catch (err) {
      return { status: 'error', message: err.message };
    }
  },

  getActorTimeline: async (actorId, limit = 5) => {
    try {
      const res = await fetch(`${getApiBase()}/results/actor/${actorId}/timeline?limit=${limit}`);
      if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
      return res.json();
    } catch (err) {
      return { status: 'error', message: err.message };
    }
  },

  getActorDrift: async (actorId) => {
    try {
      const res = await fetch(`${getApiBase()}/results/actor/${actorId}/drift`);
      if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
      return res.json();
    } catch (err) {
      return { status: 'error', message: err.message };
    }
  },

  // Fallback for details if needed (no direct endpoint found yet, so using actors list or placeholder)
  getActorDetails: async (actorId) => {
    try {
      const res = await fetch(`${getApiBase()}/results/actors/${actorId}`);
      if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
      return res.json();
    } catch (err) {
      return { status: 'error', message: err.message };
    }
  },

  markAllAlertsRead: async () => {
    const res = await fetch(`${getApiBase()}/results/alerts/mark_all_read`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    return res.json();
  },

  getMyCases: async (token) => {
    try {
      return await fetchJsonWithFallback(`/results/cases/me`, {
        headers: buildHeaders(token, false),
        cache: 'no-store'
      });
    } catch (err) {
      return { status: 'error', message: toNetworkErrorMessage(err, getApiBase()) };
    }
  },

  getCaseDetail: async (token, caseId) => {
    try {
      if (!caseId || String(caseId).startsWith('case_') || String(caseId) === 'null' || String(caseId) === 'undefined' || String(caseId) === '') {
        throw new Error('Invalid case ID provided for fetch');
      }
      const data = await fetchJsonWithFallback(`/results/cases/${caseId}`, {
        headers: buildHeaders(token, false),
        cache: 'no-store'
      });
      // Data is now { status: 'ok', case: {...}, posts: [...], post_count: 123 }
      return { 
        status: 'ok', 
        item: data.case, 
        posts: data.posts, 
        post_count: data.post_count 
      };
    } catch (err) {
      return { status: 'error', message: toNetworkErrorMessage(err, getApiBase()) };
    }
  },

  createCaseForActor: async (token, actorId, title = null) => {
    try {
      if (!actorId) throw new Error('actorId is required');
      const data = await fetchJsonWithFallback(`/results/cases/open`, {
        method: 'POST',
        headers: buildHeaders(token),
        body: JSON.stringify({ actor_id: actorId, title })
      });
      return { status: 'ok', item: data };
    } catch (err) {
      return { status: 'error', message: toNetworkErrorMessage(err, getApiBase()) };
    }
  },

  deleteMyCase: async (token, caseId) => {
    try {
      if (!caseId || String(caseId).startsWith('case_') || String(caseId) === 'null' || String(caseId) === 'undefined' || String(caseId) === '') {
        throw new Error('Invalid case ID provided for delete');
      }
      return await fetchJsonWithFallback(`/results/cases/${caseId}`, {
        method: 'DELETE',
        headers: buildHeaders(token)
      });
    } catch (err) {
      return { status: 'error', message: toNetworkErrorMessage(err, getApiBase()) };
    }
  },

  updateMyCaseStatus: async (token, caseId, newStatus) => {
    try {
      const data = await fetchJsonWithFallback(`/results/cases/${caseId}/status`, {
        method: 'PATCH',
        headers: buildHeaders(token),
        body: JSON.stringify({ status: newStatus })
      });
      return { status: 'ok', item: data };
    } catch (err) {
      return { status: 'error', message: toNetworkErrorMessage(err, getApiBase()) };
    }
  },

  getCases: async (limit = 200) => {
    try {
      const res = await fetch(`${getApiBase()}/results/actors?limit=${limit}&_t=${Date.now()}`, {
        cache: 'no-store'
      });
      const data = await res.json();

      const items = Array.isArray(data) ? data : (data.items || []);

      const normalizedItems = items.map(item => {
        let st = item.status || item.case_status || 'active';

        // Check for locally persisted status overrides
        try {
          const localStatus = localStorage.getItem(`case_status_${item.id}`);
          if (localStatus) {
            st = localStatus;
          }
        } catch (e) {
          // ignore localStorage errors
        }

        if (st === 'close') st = 'closed';
        return {
          id: item.id,
          handle: item.handle,
          platform: item.platform,
          display_name: item.display_name,
          created_at: item.created_at,
          status: st
        };
      });

      return { status: 'ok', items: normalizedItems };
    } catch (err) {
      return { status: 'error', message: err.message };
    }
  },

  updateCaseStatus: async (id, status) => {
    try {
      // Mock the backend call since there is no endpoint for updating status
      // const res = await fetch(`${getApiBase()}/accounts/${id}/status`, ...);

      const normalizedStatus = status === 'close' ? 'closed' : status;
      // Persist the updated status locally to override the backend on future fetches
      try {
        localStorage.setItem(`case_status_${id}`, normalizedStatus);
      } catch (e) {
        // ignore localStorage errors
      }

      // Simulate network delay
      await new Promise(resolve => setTimeout(resolve, 300));

      return { status: 'ok', new_status: normalizedStatus, message: "Case updated" };
    } catch (err) {
      return { status: 'error', message: err.message };
    }
  },

  searchPosts: async (query, platform = 'All', topic = 'All', minConfidence = 'All', limit = 50) => {
    try {
      let url = `${getApiBase()}/search/posts?q=${encodeURIComponent(query)}&limit=${limit}`;
      if (platform && platform !== 'All') url += `&platform=${encodeURIComponent(platform)}`;
      if (topic && topic !== 'All') url += `&topic=${encodeURIComponent(topic)}`;
      if (minConfidence && minConfidence !== 'All') {
        const confVal = parseFloat(minConfidence) / 100.0;
        url += `&min_confidence=${confVal}`;
      }
      const res = await fetch(url);
      return res.json();
    } catch (err) {
      return { status: 'error', message: err.message };
    }
  },

  searchActors: async (query, platform = 'All', limit = 50) => {
    try {
      let url = `${getApiBase()}/search/actors?q=${encodeURIComponent(query)}&limit=${limit}`;
      if (platform && platform !== 'All') url += `&platform=${encodeURIComponent(platform)}`;
      const res = await fetch(url);
      return res.json();
    } catch (err) {
      return { status: 'error', message: err.message };
    }
  },

  searchTrends: async (period = '7d', platform = 'All') => {
    try {
      let url = `${getApiBase()}/search/trends?period=${encodeURIComponent(period)}`;
      if (platform && platform !== 'All') url += `&platform=${encodeURIComponent(platform)}`;
      const res = await fetch(url);
      return res.json();
    } catch (err) {
      return { status: 'error', message: err.message };
    }
  },

  createTask: async (payload) => {
    try {
      const res = await fetch(`${getApiBase()}/tasks/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      return res.json();
    } catch (err) {
      return { status: 'error', message: err.message };
    }
  },

  getTasks: async (params = {}) => {
    try {
      const query = new URLSearchParams(params).toString();
      const res = await fetch(`${getApiBase()}/tasks?${query}`);
      return res.json();
    } catch (err) {
      return { status: 'error', message: err.message };
    }
  },
  
  getTrendingLatest: async ({ platform = "twitter", category = "trending" } = {}) => {
    try {
      const params = new URLSearchParams({ platform, category }).toString();
      const res = await fetch(`${getApiBase()}/results/trending/latest?${params}`);
      if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
      return res.json();
    } catch (err) {
      return { status: 'error', message: err.message };
    }
  }
};

// Export standalone functions for compatibility with existing pages
export const fetchActors = apiClient.getActors;
export const fetchAlerts = apiClient.getAlerts;
export const fetchCoordination = apiClient.getCoordination;
export const fetchActorTimeline = apiClient.getActorTimeline;
export const fetchActorDrift = apiClient.getActorDrift;
export const fetchActorDetails = apiClient.getActorDetails;
export const markAllAlertsRead = apiClient.markAllAlertsRead;
export const fetchCases = apiClient.getCases;
export const updateCaseStatus = apiClient.updateCaseStatus;
export const deleteCase = apiClient.deleteMyCase;
export const fetchMyCases = apiClient.getMyCases;
export const fetchCaseDetail = apiClient.getCaseDetail;
export const createCaseForActor = apiClient.createCaseForActor;
export const updateMyCaseStatus = apiClient.updateMyCaseStatus;
export const deleteMyCase = apiClient.deleteMyCase;
export const searchPosts = apiClient.searchPosts;
export const searchActors = apiClient.searchActors;
export const searchTrends = apiClient.searchTrends;
export const createTask = apiClient.createTask;
export const fetchTasks = apiClient.getTasks;
export const fetchTrendingLatest = apiClient.getTrendingLatest;
