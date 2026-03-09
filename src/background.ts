type PomodoroMode = 'focus' | 'shortBreak' | 'longBreak';

interface TimerState {
  mode: PomodoroMode;
  isRunning: boolean;
  phaseStartMs: number | null;
  phaseEndMs: number | null;
  remainingMs: number;
  totalPhaseMs: number;
  completedFocusSessions: number;
  focusMinutes: number;
  shortBreakMinutes: number;
  longBreakMinutes: number;
  cyclesBeforeLongBreak: number;
  totalPomodorosCompleted: number;
  totalFocusMinutesCompleted: number;
  totalBreakMinutesCompleted: number;
  totalShortBreaksCompleted: number;
  totalLongBreaksCompleted: number;
  totalXp: number;
  level: number;
  xpInCurrentLevel: number;
  xpForNextLevel: number;
}

type IncomingMessage =
  | { action: 'getState' }
  | { action: 'start' }
  | { action: 'pause' }
  | { action: 'reset' }
  | { action: 'skip' }
  | {
      action: 'setDurations';
      payload: {
        focusMinutes: number;
        shortBreakMinutes: number;
        longBreakMinutes: number;
      };
    };

const STORAGE_KEY = 'pocketPomoState';
const ALARM_NAME = 'pocketPomoPhaseEnd';
const BADGE_TICK_ALARM_NAME = 'pocketPomoBadgeTick';
const BADGE_TICK_PERIOD_MINUTES = 1;
const BADGE_TICK_INTERVAL_MS = 1_000;
const NOTIFICATION_ICON_PATH = 'assets/icon.png';

let badgeTickIntervalId: ReturnType<typeof setInterval> | null = null;

const DEFAULTS = {
  focusMinutes: 25,
  shortBreakMinutes: 5,
  longBreakMinutes: 15,
  cyclesBeforeLongBreak: 4,
  focusXpPerMinute: 2,
  breakXpPerMinute: 1,
  pomodoroBonusXp: 20,
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function toFiniteNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toFiniteNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function minutesForMode(state: TimerState, mode: PomodoroMode): number {
  if (mode === 'focus') {
    return state.focusMinutes;
  }
  if (mode === 'shortBreak') {
    return state.shortBreakMinutes;
  }
  return state.longBreakMinutes;
}

function msForMode(state: TimerState, mode: PomodoroMode): number {
  return minutesForMode(state, mode) * 60_000;
}

function xpRequiredForLevel(level: number): number {
  return 100 + (level - 1) * 40;
}

function deriveLevelMetrics(totalXp: number): { level: number; xpInCurrentLevel: number; xpForNextLevel: number } {
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

function applyXp(state: TimerState, gainedXp: number): TimerState {
  const totalXp = Math.max(0, Math.floor(state.totalXp + gainedXp));
  const levelMetrics = deriveLevelMetrics(totalXp);

  return {
    ...state,
    totalXp,
    ...levelMetrics,
  };
}

function applyPhaseCompletionRewards(state: TimerState, completedMode: PomodoroMode): TimerState {
  if (completedMode === 'focus') {
    const minutes = state.focusMinutes;
    const xpGain = minutes * DEFAULTS.focusXpPerMinute + DEFAULTS.pomodoroBonusXp;
    return applyXp(
      {
        ...state,
        completedFocusSessions: state.completedFocusSessions + 1,
        totalPomodorosCompleted: state.totalPomodorosCompleted + 1,
        totalFocusMinutesCompleted: state.totalFocusMinutesCompleted + minutes,
      },
      xpGain,
    );
  }

  if (completedMode === 'shortBreak') {
    const minutes = state.shortBreakMinutes;
    return applyXp(
      {
        ...state,
        totalShortBreaksCompleted: state.totalShortBreaksCompleted + 1,
        totalBreakMinutesCompleted: state.totalBreakMinutesCompleted + minutes,
      },
      minutes * DEFAULTS.breakXpPerMinute,
    );
  }

  const minutes = state.longBreakMinutes;
  return applyXp(
    {
      ...state,
      totalLongBreaksCompleted: state.totalLongBreaksCompleted + 1,
      totalBreakMinutesCompleted: state.totalBreakMinutesCompleted + minutes,
    },
    minutes * DEFAULTS.breakXpPerMinute,
  );
}

function getCompletionNotification(completedMode: PomodoroMode, nextMode: PomodoroMode): { title: string; message: string } {
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

async function showCompletionNotification(completedMode: PomodoroMode, nextMode: PomodoroMode): Promise<void> {
  const content = getCompletionNotification(completedMode, nextMode);
  try {
    await chrome.notifications.create({
      type: 'basic',
      title: content.title,
      message: content.message,
      iconUrl: chrome.runtime.getURL(NOTIFICATION_ICON_PATH),
      priority: 2,
    });
  } catch (error) {
    console.log('Failed to show completion notification:', error);
    // Notifications can fail silently on invalid icon/OS restrictions; timer logic should still continue.
  }
}

function createInitialState(): TimerState {
  const levelMetrics = deriveLevelMetrics(0);
  return {
    mode: 'focus',
    isRunning: false,
    phaseStartMs: null,
    phaseEndMs: null,
    remainingMs: DEFAULTS.focusMinutes * 60_000,
    totalPhaseMs: DEFAULTS.focusMinutes * 60_000,
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

async function loadState(): Promise<TimerState> {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  const saved = result[STORAGE_KEY] as Partial<TimerState> | undefined;
  const fallback = createInitialState();

  if (!saved) {
    return fallback;
  }

  const safePhaseStartMs = toFiniteNullableNumber(saved.phaseStartMs);
  const safePhaseEndMs = toFiniteNullableNumber(saved.phaseEndMs);
  const safeRunning = Boolean(saved.isRunning) && safePhaseEndMs !== null;
  const safeTotalPhaseMs = Math.max(1_000, toFiniteNumber(saved.totalPhaseMs, fallback.totalPhaseMs));
  const safeRemainingMs = safeRunning
    ? Math.max(0, safePhaseEndMs - Date.now())
    : Math.max(1_000, toFiniteNumber(saved.remainingMs, fallback.remainingMs));
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

async function saveState(state: TimerState): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: state });
}

function getLiveRemainingMs(state: TimerState, now: number): number {
  if (!state.isRunning || state.phaseEndMs === null) {
    return state.remainingMs;
  }
  return Math.max(0, state.phaseEndMs - now);
}

function getNextMode(state: TimerState): PomodoroMode {
  if (state.mode === 'focus') {
    const shouldTakeLongBreak =
      state.completedFocusSessions > 0 && state.completedFocusSessions % state.cyclesBeforeLongBreak === 0;
    return shouldTakeLongBreak ? 'longBreak' : 'shortBreak';
  }
  return 'focus';
}

function startMode(state: TimerState, mode: PomodoroMode, now: number, runImmediately: boolean): TimerState {
  const totalPhaseMs = msForMode(state, mode);
  const nextState: TimerState = {
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

function advancePhase(
  state: TimerState,
  now: number,
  awardCompletion: boolean,
  runNextModeImmediately: boolean,
): { nextState: TimerState; completedMode: PomodoroMode | null } {
  const completedMode = awardCompletion ? state.mode : null;
  const seededState = awardCompletion ? applyPhaseCompletionRewards(state, state.mode) : state;
  const nextMode = getNextMode(seededState);
  return {
    nextState: startMode(seededState, nextMode, now, runNextModeImmediately),
    completedMode,
  };
}

function normalizeState(state: TimerState, now: number): { normalizedState: TimerState; completionEvents: PomodoroMode[] } {
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

async function updateBadge(state: TimerState): Promise<void> {
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

function startBadgeTick(state: TimerState): void {
  stopBadgeTick();
  badgeTickIntervalId = setInterval(() => {
    void updateBadge(state);
  }, BADGE_TICK_INTERVAL_MS);
}

function stopBadgeTick(): void {
  if (badgeTickIntervalId !== null) {
    clearInterval(badgeTickIntervalId);
    badgeTickIntervalId = null;
  }
}

async function syncAlarm(state: TimerState): Promise<void> {
  await chrome.alarms.clear(ALARM_NAME);
  await chrome.alarms.clear(BADGE_TICK_ALARM_NAME);

  if (state.isRunning && state.phaseEndMs !== null) {
    chrome.alarms.create(ALARM_NAME, { when: state.phaseEndMs });
    chrome.alarms.create(BADGE_TICK_ALARM_NAME, {
      delayInMinutes: BADGE_TICK_PERIOD_MINUTES,
      periodInMinutes: BADGE_TICK_PERIOD_MINUTES,
    });
    startBadgeTick(state);
  } else {
    stopBadgeTick();
  }
}

async function persistAndPublish(state: TimerState): Promise<TimerState> {
  const { normalizedState, completionEvents } = normalizeState(state, Date.now());
  await saveState(normalizedState);
  await syncAlarm(normalizedState);
  await updateBadge(normalizedState);

  if (completionEvents.length > 0) {
    for (const completedMode of completionEvents) {
      const nextMode = normalizedState.mode;
      await showCompletionNotification(completedMode, nextMode);
    }
  }

  return normalizedState;
}

async function getCurrentState(): Promise<TimerState> {
  const loaded = await loadState();
  return persistAndPublish(loaded);
}

async function startTimer(): Promise<TimerState> {
  const now = Date.now();
  const state = await getCurrentState();
  if (state.isRunning) {
    return state;
  }

  const remainingMs = clamp(state.remainingMs, 1_000, state.totalPhaseMs);
  const nextState: TimerState = {
    ...state,
    isRunning: true,
    remainingMs,
    phaseStartMs: now,
    phaseEndMs: now + remainingMs,
  };

  return persistAndPublish(nextState);
}

async function pauseTimer(): Promise<TimerState> {
  const now = Date.now();
  const state = await getCurrentState();
  if (!state.isRunning) {
    return state;
  }

  const remainingMs = getLiveRemainingMs(state, now);
  const nextState: TimerState = {
    ...state,
    isRunning: false,
    phaseStartMs: null,
    phaseEndMs: null,
    remainingMs,
  };

  return persistAndPublish(nextState);
}

async function resetTimer(): Promise<TimerState> {
  const state = await getCurrentState();
  const nextState = startMode(
    {
      ...state,
      completedFocusSessions: 0,
    },
    'focus',
    Date.now(),
    false,
  );
  return persistAndPublish(nextState);
}

async function skipTimer(): Promise<TimerState> {
  const state = await getCurrentState();
  const transition = advancePhase(state, Date.now(), false, false);
  return persistAndPublish(transition.nextState);
}

async function setDurations(payload: {
  focusMinutes: number;
  shortBreakMinutes: number;
  longBreakMinutes: number;
}): Promise<TimerState> {
  const now = Date.now();
  const state = await getCurrentState();

  const updated: TimerState = {
    ...state,
    focusMinutes: clamp(payload.focusMinutes, 1, 120),
    shortBreakMinutes: clamp(payload.shortBreakMinutes, 1, 60),
    longBreakMinutes: clamp(payload.longBreakMinutes, 1, 90),
  };

  const newTotalPhaseMs = msForMode(updated, updated.mode);
  const previousRemaining = getLiveRemainingMs(state, now);
  const adjustedRemaining = clamp(previousRemaining, 1_000, newTotalPhaseMs);

  updated.totalPhaseMs = newTotalPhaseMs;
  updated.remainingMs = adjustedRemaining;

  if (updated.isRunning) {
    updated.phaseStartMs = now;
    updated.phaseEndMs = now + adjustedRemaining;
  } else {
    updated.phaseStartMs = null;
    updated.phaseEndMs = null;
  }

  return persistAndPublish(updated);
}

async function initializeState(): Promise<void> {
  await getCurrentState();
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

chrome.runtime.onMessage.addListener(
  (
    message: IncomingMessage,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response: TimerState) => void,
  ): boolean => {
    const execute = async (): Promise<TimerState> => {
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
  },
);