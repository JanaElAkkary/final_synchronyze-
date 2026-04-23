/* global chrome */
(function () {
  const LIMITS = {
    maxPostsPerSession: 50,
    maxScrollsPerSession: 30,
    maxSessionDurationMs: 180000,
    cooldownBetweenSessionsMs: 1000,
    maxSessionsPerHour: 200,
    maxSessionsPerDay: 500,
    maxPostsPerDay: 5000,
    minScrollDelayMs: 2000,
    maxScrollDelayMs: 6000,
    readingPauseChance: 0.3,
    readingPauseMinMs: 5000,
    readingPauseMaxMs: 15000,
    scrollBackChance: 0.1,
  };

  const STORAGE_KEY = "rateLimiterState";

  const dateKey = (d) => {
    const dt = d ? new Date(d) : new Date();
    return dt.toISOString().slice(0, 10);
  };

  const randInt = (min, max) => {
    const a = Math.ceil(min);
    const b = Math.floor(max);
    return Math.floor(a + Math.random() * (b - a + 1));
  };

  const chance = (p) => Math.random() < p;

  const defaultState = () => ({
    currentDate: dateKey(),
    daily: { posts: 0, sessions: 0 },
    hourlySessionTimestamps: [],
    currentSession: {
      active: false,
      type: null,
      startedAt: null,
      posts: 0,
      scrolls: 0,
      stoppedReason: null,
    },
    cooldownUntil: null,
    cooldownReason: null,
    lastSessionEndedAt: null,
    lastRateLimitWarning: null,
  });

  const getState = async () => {
    return new Promise((resolve) => {
      chrome.storage.local.get([STORAGE_KEY], (res) => {
        const st = res && res[STORAGE_KEY] ? res[STORAGE_KEY] : null;
        resolve(st || defaultState());
      });
    });
  };

  const setState = async (state) => {
    return new Promise((resolve) => {
      chrome.storage.local.set({ [STORAGE_KEY]: state }, resolve);
    });
  };

  const pruneHourly = (timestamps) => {
    const now = Date.now();
    const oneHourAgo = now - 60 * 60 * 1000;
    const list = Array.isArray(timestamps) ? timestamps : [];
    return list
      .map((t) => Number(t))
      .filter((t) => Number.isFinite(t) && t >= oneHourAgo && t <= now);
  };

  const resetDailyCountersIfNeeded = async () => {
    const st = await getState();
    const today = dateKey();
    if (st.currentDate !== today) {
      const next = {
        ...st,
        currentDate: today,
        daily: { posts: 0, sessions: 0 },
        hourlySessionTimestamps: pruneHourly(st.hourlySessionTimestamps),
      };
      await setState(next);
      return next;
    }
    const next = { ...st, hourlySessionTimestamps: pruneHourly(st.hourlySessionTimestamps) };
    await setState(next);
    return next;
  };

  const isCooldownActive = async () => {
    const st = await getState();
    const until = st.cooldownUntil ? Number(st.cooldownUntil) : null;
    return until && Date.now() < until;
  };

  const setCooldownUntil = async (timestamp, reason) => {
    const st = await getState();
    const until = timestamp ? Number(timestamp) : null;
    const next = {
      ...st,
      cooldownUntil: until,
      cooldownReason: reason || "cooldown_active",
      lastRateLimitWarning: reason || "cooldown_active",
    };
    await setState(next);
    return next;
  };

  const getCooldownRemainingMs = async () => {
    const st = await getState();
    const until = st.cooldownUntil ? Number(st.cooldownUntil) : null;
    if (!until) return 0;
    return Math.max(0, until - Date.now());
  };

  const canProceed = async (actionType) => {
    const st0 = await resetDailyCountersIfNeeded();
    const st = st0;

    const now = Date.now();
    const cooldownUntil = st.cooldownUntil ? Number(st.cooldownUntil) : null;
    if (cooldownUntil && now < cooldownUntil) {
      return { ok: false, reason: st.cooldownReason || "cooldown_active", cooldownUntil };
    }

    if (actionType === "session_start") {
      const lastEnd = st.lastSessionEndedAt ? Number(st.lastSessionEndedAt) : null;
      if (lastEnd && (now - lastEnd) < LIMITS.cooldownBetweenSessionsMs) {
        return { ok: false, reason: "cooldown_between_sessions", cooldownUntil: lastEnd + LIMITS.cooldownBetweenSessionsMs };
      }

      const hourly = pruneHourly(st.hourlySessionTimestamps);
      if (hourly.length >= LIMITS.maxSessionsPerHour) {
        return { ok: false, reason: "max_sessions_per_hour" };
      }
      if ((st.daily && st.daily.sessions ? Number(st.daily.sessions) : 0) >= LIMITS.maxSessionsPerDay) {
        return { ok: false, reason: "max_sessions_per_day" };
      }
      return { ok: true };
    }

    if (actionType === "poll") {
      return { ok: true };
    }

    const sess = st.currentSession || {};
    if (!sess.active) {
      if (actionType === "scroll") {
        return { ok: false, reason: "no_active_session" };
      }
      if (actionType === "capture") {
        if ((st.daily && st.daily.posts ? Number(st.daily.posts) : 0) >= LIMITS.maxPostsPerDay) {
          return { ok: false, reason: "max_posts_per_day" };
        }
        return { ok: true };
      }
      return { ok: true };
    }

    const startedAt = sess.startedAt ? Number(sess.startedAt) : null;
    if (startedAt && (now - startedAt) >= LIMITS.maxSessionDurationMs) {
      return { ok: false, reason: "max_session_duration" };
    }

    if (actionType === "scroll") {
      if ((sess.posts ? Number(sess.posts) : 0) >= LIMITS.maxPostsPerSession) {
        return { ok: false, reason: "max_posts_per_session" };
      }
      if ((sess.scrolls ? Number(sess.scrolls) : 0) >= LIMITS.maxScrollsPerSession) {
        return { ok: false, reason: "max_scrolls_per_session" };
      }
      return { ok: true };
    }

    if (actionType === "capture") {
      if ((sess.posts ? Number(sess.posts) : 0) >= LIMITS.maxPostsPerSession) {
        return { ok: false, reason: "max_posts_per_session" };
      }
      if ((st.daily && st.daily.posts ? Number(st.daily.posts) : 0) >= LIMITS.maxPostsPerDay) {
        return { ok: false, reason: "max_posts_per_day" };
      }
      return { ok: true };
    }

    return { ok: true };
  };

  const startSession = async (sessionType) => {
    const allowed = await canProceed("session_start");
    if (!allowed.ok) return { ok: false, reason: allowed.reason, cooldownUntil: allowed.cooldownUntil || null };

    const st = await getState();
    const now = Date.now();
    const hourly = pruneHourly(st.hourlySessionTimestamps);
    hourly.push(now);

    const next = {
      ...st,
      hourlySessionTimestamps: hourly,
      daily: {
        posts: st.daily && Number.isFinite(Number(st.daily.posts)) ? Number(st.daily.posts) : 0,
        sessions: (st.daily && Number.isFinite(Number(st.daily.sessions)) ? Number(st.daily.sessions) : 0) + 1,
      },
      currentSession: {
        active: true,
        type: sessionType || null,
        startedAt: now,
        posts: 0,
        scrolls: 0,
        stoppedReason: null,
      },
      lastRateLimitWarning: null,
    };

    await setState(next);
    return { ok: true, state: next };
  };

  const endSession = async (reason) => {
    const st = await getState();
    const now = Date.now();
    const next = {
      ...st,
      currentSession: {
        ...(st.currentSession || {}),
        active: false,
        stoppedReason: reason || null,
      },
      lastSessionEndedAt: now,
      lastRateLimitWarning: reason || st.lastRateLimitWarning || null,
    };
    await setState(next);
    return next;
  };

  const incrementPostsCaptured = async (count) => {
    const c = Number.isFinite(Number(count)) ? Number(count) : 1;
    const st = await getState();
    const sess = st.currentSession || {};
    const sessActive = !!sess.active;
    const next = {
      ...st,
      daily: {
        posts: (st.daily && Number.isFinite(Number(st.daily.posts)) ? Number(st.daily.posts) : 0) + c,
        sessions: st.daily && Number.isFinite(Number(st.daily.sessions)) ? Number(st.daily.sessions) : 0,
      },
      currentSession: {
        ...sess,
        posts: sessActive
          ? (sess.posts && Number.isFinite(Number(sess.posts)) ? Number(sess.posts) : 0) + c
          : (sess.posts && Number.isFinite(Number(sess.posts)) ? Number(sess.posts) : 0),
      },
    };
    await setState(next);
    return next;
  };

  const incrementScrolls = async (count) => {
    const c = Number.isFinite(Number(count)) ? Number(count) : 1;
    const st = await getState();
    const sess = st.currentSession || {};
    const next = {
      ...st,
      currentSession: {
        ...sess,
        scrolls: (sess.scrolls && Number.isFinite(Number(sess.scrolls)) ? Number(sess.scrolls) : 0) + c,
      },
    };
    await setState(next);
    return next;
  };

  const getRandomScrollDelay = () => randInt(LIMITS.minScrollDelayMs, LIMITS.maxScrollDelayMs);

  const shouldTakeReadingPause = () => chance(LIMITS.readingPauseChance);

  const shouldScrollBack = () => chance(LIMITS.scrollBackChance);

  const maybeGetLongPauseMs = () => (chance(0.05) ? randInt(15000, 45000) : 0);

  const getScrollStepPlan = () => {
    const back = shouldScrollBack();
    const distance = back ? randInt(150, 350) : randInt(300, 800);
    const longPause = maybeGetLongPauseMs();
    const readingPause = shouldTakeReadingPause() ? randInt(LIMITS.readingPauseMinMs, LIMITS.readingPauseMaxMs) : 0;
    const delayMs = getRandomScrollDelay();
    return {
      distancePx: distance,
      direction: back ? -1 : 1,
      delayMs,
      readingPauseMs: readingPause,
      longPauseMs: longPause,
    };
  };

  const initializeRateLimiterState = async () => {
    const st = await getState();
    const normalized = st && typeof st === "object" ? st : defaultState();
    const next = {
      ...defaultState(),
      ...normalized,
      hourlySessionTimestamps: pruneHourly(normalized.hourlySessionTimestamps),
    };
    if (!next.currentDate) next.currentDate = dateKey();
    await setState(next);
    return next;
  };

  const getRateLimitState = async () => {
    return await resetDailyCountersIfNeeded();
  };

  self.RateLimiter = {
    LIMITS,
    initializeRateLimiterState,
    getRateLimitState,
    canProceed,
    startSession,
    endSession,
    incrementPostsCaptured,
    incrementScrolls,
    setCooldownUntil,
    isCooldownActive,
    resetDailyCountersIfNeeded,
    getCooldownRemainingMs,
    getRandomScrollDelay,
    shouldTakeReadingPause,
    shouldScrollBack,
    maybeGetLongPauseMs,
    getScrollStepPlan,
  };
})();
