const timeLabel = document.getElementById('timeLabel');
const modeLabel = document.getElementById('modeLabel');
const statusLabel = document.getElementById('statusLabel');
const progressRing = document.getElementById('progressRing');
const startPauseButton = document.getElementById('startPauseButton');
const resetButton = document.getElementById('resetButton');
const skipButton = document.getElementById('skipButton');
const focusInput = document.getElementById('focusMinutes');
const shortBreakInput = document.getElementById('shortBreakMinutes');
const longBreakInput = document.getElementById('longBreakMinutes');
const levelValue = document.getElementById('levelValue');
const xpValue = document.getElementById('xpValue');
const xpFill = document.getElementById('xpFill');
const xpSubLabel = document.getElementById('xpSubLabel');
const pomodoroCount = document.getElementById('pomodoroCount');
const focusMinutesTotal = document.getElementById('focusMinutesTotal');
const breakCount = document.getElementById('breakCount');
const breakMinutesTotal = document.getElementById('breakMinutesTotal');
const clickSound = new Audio(chrome.runtime.getURL('assets/click.mp3'));
let latestState = null;
let refreshHandle = null;
const MODE_LABELS = {
    focus: 'Focus',
    shortBreak: 'Short Break',
    longBreak: 'Long Break',
};
const MODE_STATUS = {
    focus: 'Heads down. Build momentum.',
    shortBreak: 'Quick reset. Breathe and stretch.',
    longBreak: 'Long recharge. You earned it.',
};
function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}
function asSafeNumber(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}
function formatTime(milliseconds) {
    const totalSeconds = Math.ceil(milliseconds / 1000);
    const safeSeconds = Math.max(totalSeconds, 0);
    const minutes = Math.floor(safeSeconds / 60)
        .toString()
        .padStart(2, '0');
    const seconds = (safeSeconds % 60).toString().padStart(2, '0');
    return `${minutes}:${seconds}`;
}
function playSound(sound) {
    try {
        sound.currentTime = 0;
        void sound.play();
    }
    catch (error) {
        console.debug('Unable to play sound:', error);
    }
}
function getLiveRemaining(state) {
    if (!state.isRunning || state.phaseEndMs === null) {
        return state.remainingMs;
    }
    return Math.max(0, state.phaseEndMs - Date.now());
}
function getStatusText(state, remainingMs) {
    if (remainingMs === 0) {
        return 'Switching sessions...';
    }
    if (!state.isRunning) {
        return 'Paused. Jump back in when ready.';
    }
    return MODE_STATUS[state.mode];
}
async function sendMessage(message) {
    const response = await chrome.runtime.sendMessage(message);
    return response;
}
function render(state) {
    const liveRemaining = getLiveRemaining(state);
    const progress = state.totalPhaseMs > 0 ? 1 - liveRemaining / state.totalPhaseMs : 0;
    const degrees = `${Math.round(clamp(progress, 0, 1) * 360)}deg`;
    const totalShortBreaks = asSafeNumber(state.totalShortBreaksCompleted);
    const totalLongBreaks = asSafeNumber(state.totalLongBreaksCompleted);
    const totalBreaks = totalShortBreaks + totalLongBreaks;
    const totalXp = asSafeNumber(state.totalXp);
    const level = Math.max(1, asSafeNumber(state.level, 1));
    const xpInCurrentLevel = Math.max(0, asSafeNumber(state.xpInCurrentLevel));
    const xpForNextLevel = Math.max(1, asSafeNumber(state.xpForNextLevel, 100));
    const xpProgress = xpForNextLevel > 0 ? xpInCurrentLevel / xpForNextLevel : 0;
    timeLabel.textContent = formatTime(liveRemaining);
    modeLabel.textContent = MODE_LABELS[state.mode];
    statusLabel.textContent = getStatusText(state, liveRemaining);
    progressRing.style.setProperty('--progress', degrees);
    progressRing.dataset.mode = state.mode;
    startPauseButton.textContent = state.isRunning ? 'Pause' : 'Start';
    skipButton.disabled = state.isRunning && liveRemaining <= 1000;
    focusInput.value = String(state.focusMinutes);
    shortBreakInput.value = String(state.shortBreakMinutes);
    longBreakInput.value = String(state.longBreakMinutes);
    levelValue.textContent = String(level);
    xpValue.textContent = String(totalXp);
    xpFill.style.width = `${Math.round(clamp(xpProgress, 0, 1) * 100)}%`;
    xpSubLabel.textContent = `${xpInCurrentLevel} / ${xpForNextLevel} XP to next level`;
    pomodoroCount.textContent = String(asSafeNumber(state.totalPomodorosCompleted));
    focusMinutesTotal.textContent = String(asSafeNumber(state.totalFocusMinutesCompleted));
    breakCount.textContent = String(totalBreaks);
    breakMinutesTotal.textContent = String(asSafeNumber(state.totalBreakMinutesCompleted));
}
async function refreshState() {
    latestState = await sendMessage({ action: 'getState' });
    render(latestState);
}
function readDurationInputs() {
    return {
        focusMinutes: clamp(Number(focusInput.value) || 25, 1, 120),
        shortBreakMinutes: clamp(Number(shortBreakInput.value) || 5, 1, 60),
        longBreakMinutes: clamp(Number(longBreakInput.value) || 15, 1, 90),
    };
}
async function updateDurationsFromInputs() {
    const payload = readDurationInputs();
    latestState = await sendMessage({ action: 'setDurations', payload });
    render(latestState);
}
async function handleStartPause() {
    playSound(clickSound);
    if (!latestState) {
        await refreshState();
    }
    if (latestState?.isRunning) {
        latestState = await sendMessage({ action: 'pause' });
    }
    else {
        latestState = await sendMessage({ action: 'start' });
    }
    if (latestState) {
        render(latestState);
    }
}
async function initialize() {
    startPauseButton.addEventListener('click', () => {
        void handleStartPause();
    });
    resetButton.addEventListener('click', () => {
        playSound(clickSound);
        void sendMessage({ action: 'reset' }).then((state) => {
            latestState = state;
            render(state);
        });
    });
    skipButton.addEventListener('click', () => {
        playSound(clickSound);
        void sendMessage({ action: 'skip' }).then((state) => {
            latestState = state;
            render(state);
        });
    });
    [focusInput, shortBreakInput, longBreakInput].forEach((input) => {
        input.addEventListener('change', () => {
            void updateDurationsFromInputs();
        });
    });
    await refreshState();
    refreshHandle = window.setInterval(() => {
        if (!latestState) {
            return;
        }
        if (latestState.isRunning) {
            render(latestState);
        }
        void refreshState();
    }, 1000);
}
window.addEventListener('beforeunload', () => {
    if (refreshHandle !== null) {
        window.clearInterval(refreshHandle);
    }
});
void initialize();
export {};
