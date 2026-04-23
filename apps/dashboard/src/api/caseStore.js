const STORAGE_VERSION = 1;
const CASES_KEY = `sync_cases_v${STORAGE_VERSION}`;
const ACTIVE_CASE_KEY = `sync_active_case_id_v${STORAGE_VERSION}`;

const safeJsonParse = (raw, fallback) => {
  try {
    return JSON.parse(raw);
  } catch (e) {
    return fallback;
  }
};

const nowIso = () => new Date().toISOString();

const normalizePlatform = (p) => {
  if (!p) return null;
  const s = String(p).toLowerCase();
  if (s === 'x') return 'twitter';
  return s;
};

const normalizeHandle = (h) => {
  if (!h) return null;
  const s = String(h).trim();
  if (!s) return null;
  return s.startsWith('@') ? s.slice(1) : s;
};

const makeActorKey = (actor) => {
  if (!actor) return null;
  const id = actor.account_id || actor.id;
  if (id !== null && id !== undefined && String(id).trim() !== '') {
    return `id:${String(id)}`;
  }
  const platform = normalizePlatform(actor.platform);
  const handle = normalizeHandle(actor.handle);
  if (platform && handle) return `ph:${platform}:${handle}`;
  return null;
};

const makeCaseId = () => {
  return `case_${Date.now()}_${Math.random().toString(16).slice(2)}`;
};

const getLegacyCaseStatusItems = () => {
  const out = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;
      if (!key.startsWith('case_status_')) continue;
      const idPart = key.slice('case_status_'.length);
      if (!idPart) continue;
      const status = localStorage.getItem(key);
      out.push({ actorId: idPart, status });
    }
  } catch (e) { }
  return out;
};

const migrateLegacyCasesIfNeeded = () => {
  const legacy = getLegacyCaseStatusItems();
  if (!legacy || legacy.length === 0) return null;

  const migrated = legacy.map((x) => {
    const st = String(x.status || '').toLowerCase();
    const normalizedStatus = st === 'closed' ? 'closed' : 'open';
    const actorId = Number.isFinite(Number(x.actorId)) ? Number(x.actorId) : x.actorId;
    return {
      id: makeCaseId(),
      title: `Case: Actor #${x.actorId}`,
      status: normalizedStatus,
      actor_id: actorId,
      actor_key: `id:${String(x.actorId)}`,
      actor: {
        id: actorId,
        handle: null,
        platform: null,
        display_name: null
      },
      created_at: nowIso(),
      updated_at: nowIso()
    };
  });

  saveCases(migrated);
  return migrated;
};

export const loadCases = () => {
  try {
    const raw = localStorage.getItem(CASES_KEY);
    if (!raw) {
      const migrated = migrateLegacyCasesIfNeeded();
      return migrated || [];
    }
    const parsed = safeJsonParse(raw, []);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
};

export const saveCases = (cases) => {
  try {
    localStorage.setItem(CASES_KEY, JSON.stringify(Array.isArray(cases) ? cases : []));
  } catch (e) { }
};

export const getActiveCaseId = () => {
  try {
    return localStorage.getItem(ACTIVE_CASE_KEY);
  } catch (e) {
    return null;
  }
};

export const setActiveCase = (caseId) => {
  try {
    if (!caseId) return;
    localStorage.setItem(ACTIVE_CASE_KEY, String(caseId));
  } catch (e) { }
};

export const clearActiveCase = () => {
  try {
    localStorage.removeItem(ACTIVE_CASE_KEY);
  } catch (e) { }
};

export const getCaseByActor = (actor) => {
  const actorKey = makeActorKey(actor);
  const actorId = actor ? (actor.account_id || actor.id) : null;
  if (!actorKey && (actorId === null || actorId === undefined)) return null;

  const cases = loadCases();
  const found = cases.find((c) => {
    if (!c) return false;
    if (actorId !== null && actorId !== undefined && String(c.actor_id) === String(actorId)) return true;
    if (actorKey && c.actor_key && String(c.actor_key) === String(actorKey)) return true;
    return false;
  });
  return found || null;
};

export const createCaseForActor = (actor) => {
  const actorKey = makeActorKey(actor);
  const actorId = actor ? (actor.account_id || actor.id) : null;
  if (!actorKey && (actorId === null || actorId === undefined)) return null;

  const cases = loadCases();
  const existing = cases.find((c) => {
    if (!c) return false;
    if (actorId !== null && actorId !== undefined && String(c.actor_id) === String(actorId)) return true;
    if (actorKey && c.actor_key && String(c.actor_key) === String(actorKey)) return true;
    return false;
  });
  if (existing) return existing;

  const handle = normalizeHandle(actor && actor.handle);
  const displayName = actor && actor.display_name ? String(actor.display_name) : null;
  const platform = normalizePlatform(actor && actor.platform);
  const title = handle ? `Case: @${handle}` : `Case: Actor #${actorId ?? 'unknown'}`;

  const newCase = {
    id: makeCaseId(),
    title,
    status: 'open',
    actor_id: actorId,
    actor_key: actorKey,
    actor: {
      id: actorId,
      handle: handle,
      platform: platform,
      display_name: displayName
    },
    created_at: nowIso(),
    updated_at: nowIso()
  };

  const next = [newCase, ...cases];
  saveCases(next);
  return newCase;
};

export const closeCase = (caseId) => {
  if (!caseId) return null;
  const cases = loadCases();
  let updated = null;
  const next = cases.map((c) => {
    if (!c || String(c.id) !== String(caseId)) return c;
    updated = { ...c, status: 'closed', updated_at: nowIso() };
    return updated;
  });
  saveCases(next);
  return updated;
};

export const reopenCase = (caseId) => {
  if (!caseId) return null;
  const cases = loadCases();
  let updated = null;
  const next = cases.map((c) => {
    if (!c || String(c.id) !== String(caseId)) return c;
    updated = { ...c, status: 'open', updated_at: nowIso() };
    return updated;
  });
  saveCases(next);
  return updated;
};

export const deleteCase = (caseId) => {
  if (!caseId) return null;
  const cases = loadCases();
  const removed = cases.find((c) => c && String(c.id) === String(caseId)) || null;
  const next = cases.filter((c) => !c || String(c.id) !== String(caseId));
  saveCases(next);
  try {
    const active = getActiveCaseId();
    if (active && String(active) === String(caseId)) {
      clearActiveCase();
    }
  } catch (e) { }
  return removed;
};

export const upsertActorMetadata = (caseId, actor) => {
  if (!caseId || !actor) return null;
  const cases = loadCases();
  let updated = null;
  const next = cases.map((c) => {
    if (!c || String(c.id) !== String(caseId)) return c;
    const handle = normalizeHandle(actor.handle);
    const platform = normalizePlatform(actor.platform);
    const displayName = actor.display_name ? String(actor.display_name) : null;
    const actorId = actor.account_id || actor.id || c.actor_id;
    updated = {
      ...c,
      actor_id: actorId,
      actor_key: c.actor_key || makeActorKey(actor),
      actor: {
        id: actorId,
        handle: handle ?? (c.actor && c.actor.handle) ?? null,
        platform: platform ?? (c.actor && c.actor.platform) ?? null,
        display_name: displayName ?? (c.actor && c.actor.display_name) ?? null
      },
      updated_at: nowIso()
    };
    return updated;
  });
  saveCases(next);
  return updated;
};

export const caseStatusLabel = (status) => {
  const s = String(status || '').toLowerCase();
  if (s === 'open' || s === 'active') return 'open';
  if (s === 'closed') return 'closed';
  return s || 'open';
};
