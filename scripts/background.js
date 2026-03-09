"use strict";
const STORAGE_KEY = 'pocketPomoState';
const ALARM_NAME = 'pocketPomoPhaseEnd';
const BADGE_TICK_ALARM_NAME = 'pocketPomoBadgeTick';
const BADGE_TICK_PERIOD_MINUTES = 1;
const BADGE_TICK_INTERVAL_MS = 1000;
const NOTIFICATION_ICON_PATH = 'assets/icon.png';
const OFFSCREEN_DOCUMENT_PATH = 'offscreen.html';
let badgeTickIntervalId = null;
let offscreenCreationPromise = null;
const DEFAULTS = {
    focusMinutes: 25,
    shortBreakMinutes: 5,
    longBreakMinutes: 15,
    cyclesBeforeLongBreak: 4,
    focusXpPerMinute: 2,
    breakXpPerMinute: 1,
    pomodoroBonusXp: 20,
};
function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}
function toFiniteNumber(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}
function toFiniteNullableNumber(value) {
    if (value === null || value === undefined) {
        return null;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}
function minutesForMode(state, mode) {
    if (mode === 'focus') {
        return state.focusMinutes;
    }
    if (mode === 'shortBreak') {
        return state.shortBreakMinutes;
    }
    return state.longBreakMinutes;
}
function msForMode(state, mode) {
    return minutesForMode(state, mode) * 60000;
}
function xpRequiredForLevel(level) {
    return 100 + (level - 1) * 40;
}
function deriveLevelMetrics(totalXp) {
    let level = 1;
    let remainingXp = Math.max(0, Math.floor(totalXp));
    let required = xpRequiredForLevel(level);
    while (remainingXp >= required) {
        remainingXp -= required;
        level += 1;
        required = xpRequiredForLevel(level);
    }
    return {
        level,
        xpInCurrentLevel: remainingXp,
        xpForNextLevel: required,
    };
}
function applyXp(state, gainedXp) {
    const totalXp = Math.max(0, Math.floor(state.totalXp + gainedXp));
    const levelMetrics = deriveLevelMetrics(totalXp);
    return {
        ...state,
        totalXp,
        ...levelMetrics,
    };
}
function applyPhaseCompletionRewards(state, completedMode) {
    if (completedMode === 'focus') {
        const minutes = state.focusMinutes;
        const xpGain = minutes * DEFAULTS.focusXpPerMinute + DEFAULTS.pomodoroBonusXp;
        return applyXp({
            ...state,
            completedFocusSessions: state.completedFocusSessions + 1,
            totalPomodorosCompleted: state.totalPomodorosCompleted + 1,
            totalFocusMinutesCompleted: state.totalFocusMinutesCompleted + minutes,
        }, xpGain);
    }
    if (completedMode === 'shortBreak') {
        const minutes = state.shortBreakMinutes;
        return applyXp({
            ...state,
            totalShortBreaksCompleted: state.totalShortBreaksCompleted + 1,
            totalBreakMinutesCompleted: state.totalBreakMinutesCompleted + minutes,
        }, minutes * DEFAULTS.breakXpPerMinute);
    }
    const minutes = state.longBreakMinutes;
    return applyXp({
        ...state,
        totalLongBreaksCompleted: state.totalLongBreaksCompleted + 1,
        totalBreakMinutesCompleted: state.totalBreakMinutesCompleted + minutes,
    }, minutes * DEFAULTS.breakXpPerMinute);
}
function getCompletionNotification(completedMode, nextMode) {
    if (completedMode === 'focus') {
        if (nextMode === 'longBreak') {
            return {
                title: 'Great focus block finished',
                message: 'Time for a long break.',
            };
        }
        return {
            title: 'Pomodoro completed',
            message: 'Time for a break.',
        };
    }
    return {
        title: 'Break completed',
        message: 'Your break has finished. Time to focus.',
    };
}
async function showCompletionNotification(completedMode, nextMode) {
    const content = getCompletionNotification(completedMode, nextMode);
    try {
        await chrome.notifications.create({
            type: 'basic',
            title: content.title,
            message: content.message,
            iconUrl: chrome.runtime.getURL(NOTIFICATION_ICON_PATH),
            priority: 2,
        });
    }
    catch (error) {
        console.log('Failed to show completion notification:', error);
        // Notifications can fail silently on invalid icon/OS restrictions; timer logic should still continue.
    }
}
async function ensureOffscreenDocument() {
    if (!chrome.offscreen) {
        return;
    }
    if (offscreenCreationPromise) {
        await offscreenCreationPromise;
        return;
    }
    offscreenCreationPromise = (async () => {
        try {
            await chrome.offscreen.createDocument({
                url: OFFSCREEN_DOCUMENT_PATH,
                reasons: [chrome.offscreen.Reason.AUDIO_PLAYBACK],
                justification: 'Play timer completion sounds while the popup is closed.',
            });
        }
        catch (error) {
            const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
            if (message.includes('single offscreen document')) {
                return;
            }
            throw error;
        }
        finally {
            offscreenCreationPromise = null;
        }
    })();
    await offscreenCreationPromise;
}
async function playCompletionChime() {
    if (!chrome.offscreen) {
        return;
    }
    try {
        await ensureOffscreenDocument();
        await chrome.runtime.sendMessage({ action: 'playCompletionChime' });
    }
    catch (error) {
        console.log('Failed to play completion chime:', error);
    }
}
function createInitialState() {
    const levelMetrics = deriveLevelMetrics(0);
    return {
        mode: 'focus',
        isRunning: false,
        phaseStartMs: null,
        phaseEndMs: null,
        remainingMs: DEFAULTS.focusMinutes * 60000,
        totalPhaseMs: DEFAULTS.focusMinutes * 60000,
        completedFocusSessions: 0,
        focusMinutes: DEFAULTS.focusMinutes,
        shortBreakMinutes: DEFAULTS.shortBreakMinutes,
        longBreakMinutes: DEFAULTS.longBreakMinutes,
        cyclesBeforeLongBreak: DEFAULTS.cyclesBeforeLongBreak,
        totalPomodorosCompleted: 0,
        totalFocusMinutesCompleted: 0,
        totalBreakMinutesCompleted: 0,
        totalShortBreaksCompleted: 0,
        totalLongBreaksCompleted: 0,
        totalXp: 0,
        level: levelMetrics.level,
        xpInCurrentLevel: levelMetrics.xpInCurrentLevel,
        xpForNextLevel: levelMetrics.xpForNextLevel,
    };
}
async function loadState() {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    const saved = result[STORAGE_KEY];
    const fallback = createInitialState();
    if (!saved) {
        return fallback;
    }
    const safePhaseStartMs = toFiniteNullableNumber(saved.phaseStartMs);
    const safePhaseEndMs = toFiniteNullableNumber(saved.phaseEndMs);
    const safeRunning = Boolean(saved.isRunning) && safePhaseEndMs !== null;
    const safeTotalPhaseMs = Math.max(1000, toFiniteNumber(saved.totalPhaseMs, fallback.totalPhaseMs));
    const safeRemainingMs = safeRunning
        ? Math.max(0, safePhaseEndMs - Date.now())
        : Math.max(1000, toFiniteNumber(saved.remainingMs, fallback.remainingMs));
    const safeTotalXp = Math.max(0, toFiniteNumber(saved.totalXp, fallback.totalXp));
    return {
        ...fallback,
        ...saved,
        isRunning: safeRunning,
        phaseStartMs: safeRunning ? safePhaseStartMs : null,
        phaseEndMs: safeRunning ? safePhaseEndMs : null,
        remainingMs: safeRemainingMs,
        totalPhaseMs: safeTotalPhaseMs,
        completedFocusSessions: Math.max(0, toFiniteNumber(saved.completedFocusSessions, fallback.completedFocusSessions)),
        focusMinutes: clamp(toFiniteNumber(saved.focusMinutes, fallback.focusMinutes), 1, 120),
        shortBreakMinutes: clamp(toFiniteNumber(saved.shortBreakMinutes, fallback.shortBreakMinutes), 1, 60),
        longBreakMinutes: clamp(toFiniteNumber(saved.longBreakMinutes, fallback.longBreakMinutes), 1, 90),
        cyclesBeforeLongBreak: clamp(toFiniteNumber(saved.cyclesBeforeLongBreak, fallback.cyclesBeforeLongBreak), 2, 8),
        totalPomodorosCompleted: Math.max(0, toFiniteNumber(saved.totalPomodorosCompleted, fallback.totalPomodorosCompleted)),
        totalFocusMinutesCompleted: Math.max(0, toFiniteNumber(saved.totalFocusMinutesCompleted, fallback.totalFocusMinutesCompleted)),
        totalBreakMinutesCompleted: Math.max(0, toFiniteNumber(saved.totalBreakMinutesCompleted, fallback.totalBreakMinutesCompleted)),
        totalShortBreaksCompleted: Math.max(0, toFiniteNumber(saved.totalShortBreaksCompleted, fallback.totalShortBreaksCompleted)),
        totalLongBreaksCompleted: Math.max(0, toFiniteNumber(saved.totalLongBreaksCompleted, fallback.totalLongBreaksCompleted)),
        totalXp: safeTotalXp,
        ...deriveLevelMetrics(safeTotalXp),
    };
}
async function saveState(state) {
    await chrome.storage.local.set({ [STORAGE_KEY]: state });
}
function getLiveRemainingMs(state, now) {
    if (!state.isRunning || state.phaseEndMs === null) {
        return state.remainingMs;
    }
    return Math.max(0, state.phaseEndMs - now);
}
function getNextMode(state) {
    if (state.mode === 'focus') {
        const shouldTakeLongBreak = state.completedFocusSessions > 0 && state.completedFocusSessions % state.cyclesBeforeLongBreak === 0;
        return shouldTakeLongBreak ? 'longBreak' : 'shortBreak';
    }
    return 'focus';
}
function startMode(state, mode, now, runImmediately) {
    const totalPhaseMs = msForMode(state, mode);
    const nextState = {
        ...state,
        mode,
        totalPhaseMs,
        remainingMs: totalPhaseMs,
        isRunning: runImmediately,
        phaseStartMs: runImmediately ? now : null,
        phaseEndMs: runImmediately ? now + totalPhaseMs : null,
    };
    return nextState;
}
function advancePhase(state, now, awardCompletion, runNextModeImmediately) {
    const completedMode = awardCompletion ? state.mode : null;
    const seededState = awardCompletion ? applyPhaseCompletionRewards(state, state.mode) : state;
    const nextMode = getNextMode(seededState);
    return {
        nextState: startMode(seededState, nextMode, now, runNextModeImmediately),
        completedMode,
    };
}
function normalizeState(state, now) {
    if (!state.isRunning || state.phaseEndMs === null) {
        return { normalizedState: state, completionEvents: [] };
    }
    if (state.phaseEndMs <= now) {
        const transition = advancePhase(state, state.phaseEndMs, true, false);
        return {
            normalizedState: transition.nextState,
            completionEvents: transition.completedMode ? [transition.completedMode] : [],
        };
    }
    return {
        normalizedState: {
            ...state,
            remainingMs: Math.max(0, state.phaseEndMs - now),
        },
        completionEvents: [],
    };
}
async function updateBadge(state) {
    if (!state.isRunning) {
        await chrome.action.setBadgeText({ text: '' });
        return;
    }
    const remainingMs = getLiveRemainingMs(state, Date.now());
    const remainingSec = Math.ceil(remainingMs / 1000);
    const safeRemainingSec = Math.max(0, remainingSec);
    const minutes = Math.floor(safeRemainingSec / 60)
        .toString()
        .padStart(2, '0');
    const seconds = (safeRemainingSec % 60).toString().padStart(2, '0');
    const badgeText = `${minutes}:${seconds}`;
    await chrome.action.setBadgeText({ text: badgeText });
    const color = state.mode === 'focus' ? '#d9583b' : state.mode === 'shortBreak' ? '#1f8c7f' : '#195ca8';
    await chrome.action.setBadgeBackgroundColor({ color });
}
function startBadgeTick(state) {
    stopBadgeTick();
    badgeTickIntervalId = setInterval(() => {
        void updateBadge(state);
    }, BADGE_TICK_INTERVAL_MS);
}
function stopBadgeTick() {
    if (badgeTickIntervalId !== null) {
        clearInterval(badgeTickIntervalId);
        badgeTickIntervalId = null;
    }
}
async function syncAlarm(state) {
    await chrome.alarms.clear(ALARM_NAME);
    await chrome.alarms.clear(BADGE_TICK_ALARM_NAME);
    if (state.isRunning && state.phaseEndMs !== null) {
        chrome.alarms.create(ALARM_NAME, { when: state.phaseEndMs });
        chrome.alarms.create(BADGE_TICK_ALARM_NAME, {
            delayInMinutes: BADGE_TICK_PERIOD_MINUTES,
            periodInMinutes: BADGE_TICK_PERIOD_MINUTES,
        });
        startBadgeTick(state);
    }
    else {
        stopBadgeTick();
    }
}
async function persistAndPublish(state) {
    const { normalizedState, completionEvents } = normalizeState(state, Date.now());
    await saveState(normalizedState);
    await syncAlarm(normalizedState);
    await updateBadge(normalizedState);
    if (completionEvents.length > 0) {
        await playCompletionChime();
        for (const completedMode of completionEvents) {
            const nextMode = normalizedState.mode;
            await showCompletionNotification(completedMode, nextMode);
        }
    }
    return normalizedState;
}
async function getCurrentState() {
    const loaded = await loadState();
    return persistAndPublish(loaded);
}
async function startTimer() {
    const now = Date.now();
    const state = await getCurrentState();
    if (state.isRunning) {
        return state;
    }
    const remainingMs = clamp(state.remainingMs, 1000, state.totalPhaseMs);
    const nextState = {
        ...state,
        isRunning: true,
        remainingMs,
        phaseStartMs: now,
        phaseEndMs: now + remainingMs,
    };
    return persistAndPublish(nextState);
}
async function pauseTimer() {
    const now = Date.now();
    const state = await getCurrentState();
    if (!state.isRunning) {
        return state;
    }
    const remainingMs = getLiveRemainingMs(state, now);
    const nextState = {
        ...state,
        isRunning: false,
        phaseStartMs: null,
        phaseEndMs: null,
        remainingMs,
    };
    return persistAndPublish(nextState);
}
async function resetTimer() {
    const state = await getCurrentState();
    const nextState = startMode({
        ...state,
        completedFocusSessions: 0,
    }, 'focus', Date.now(), false);
    return persistAndPublish(nextState);
}
async function skipTimer() {
    const state = await getCurrentState();
    const nextMode = state.mode === 'focus' ? 'shortBreak' : 'focus';
    const nextState = startMode(state, nextMode, Date.now(), false);
    return persistAndPublish(nextState);
}
async function setDurations(payload) {
    const now = Date.now();
    const state = await getCurrentState();
    const updated = {
        ...state,
        focusMinutes: clamp(payload.focusMinutes, 1, 120),
        shortBreakMinutes: clamp(payload.shortBreakMinutes, 1, 60),
        longBreakMinutes: clamp(payload.longBreakMinutes, 1, 90),
    };
    const newTotalPhaseMs = msForMode(updated, updated.mode);
    const previousRemaining = getLiveRemainingMs(state, now);
    const adjustedRemaining = clamp(previousRemaining, 1000, newTotalPhaseMs);
    updated.totalPhaseMs = newTotalPhaseMs;
    updated.remainingMs = adjustedRemaining;
    if (updated.isRunning) {
        updated.phaseStartMs = now;
        updated.phaseEndMs = now + adjustedRemaining;
    }
    else {
        updated.phaseStartMs = null;
        updated.phaseEndMs = null;
    }
    return persistAndPublish(updated);
}
async function initializeState() {
    await getCurrentState();
}
function isIncomingMessage(message) {
    if (!message || typeof message !== 'object') {
        return false;
    }
    const action = message.action;
    return (action === 'getState' ||
        action === 'start' ||
        action === 'pause' ||
        action === 'reset' ||
        action === 'skip' ||
        action === 'setDurations');
}
chrome.runtime.onInstalled.addListener(() => {
    void initializeState();
});
chrome.runtime.onStartup.addListener(() => {
    void initializeState();
});
chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== ALARM_NAME && alarm.name !== BADGE_TICK_ALARM_NAME) {
        return;
    }
    void getCurrentState();
});
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!isIncomingMessage(message)) {
        return false;
    }
    const execute = async () => {
        switch (message.action) {
            case 'getState':
                return getCurrentState();
            case 'start':
                return startTimer();
            case 'pause':
                return pauseTimer();
            case 'reset':
                return resetTimer();
            case 'skip':
                return skipTimer();
            case 'setDurations':
                return setDurations(message.payload);
        }
    };
    void execute().then(sendResponse);
    return true;
});
