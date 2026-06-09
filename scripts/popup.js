const timeLabel = document.getElementById('timeLabel');
const modeLabel = document.getElementById('modeLabel');
const statusLabel = document.getElementById('statusLabel');
const progressRing = document.getElementById('progressRing');
const startPauseButton = document.getElementById('startPauseButton');
const resetButton = document.getElementById('resetButton');
const skipButton = document.getElementById('skipButton');
const clearDataButton = document.getElementById('clearDataButton');
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
const taskCount = document.getElementById('taskCount');
const newTaskInput = document.getElementById('newTaskInput');
const addTaskButton = document.getElementById('addTaskButton');
const taskList = document.getElementById('taskList');
const soundChimeSelect = document.getElementById('soundChimeSelect');
const dailyGoalInput = document.getElementById('dailyGoalInput');
const dailyGoalProgress = document.getElementById('dailyGoalProgress');
const streakValue = document.getElementById('streakValue');
const clickSound = new Audio(chrome.runtime.getURL('assets/click.mp3'));
let latestState = null;
let previousState = null;
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
const confettiParticles = [];
let confettiActive = false;
let confettiCanvas = null;
let confettiCtx = null;
let confettiAnimationId = null;
const CONFETTI_COLORS = ['#de6648', '#e9a04b', '#1f8c7f', '#195ca8', '#ffd4bb', '#5f7ea8'];
function initConfetti() {
    confettiCanvas = document.getElementById('confettiCanvas');
    if (!confettiCanvas)
        return;
    confettiCtx = confettiCanvas.getContext('2d');
    resizeConfettiCanvas();
}
function resizeConfettiCanvas() {
    if (confettiCanvas) {
        confettiCanvas.width = confettiCanvas.clientWidth;
        confettiCanvas.height = confettiCanvas.clientHeight;
    }
}
function spawnConfetti(count = 100) {
    if (!confettiCanvas || !confettiCtx)
        return;
    resizeConfettiCanvas();
    for (let i = 0; i < count; i++) {
        confettiParticles.push({
            x: Math.random() * confettiCanvas.width,
            y: -10 - Math.random() * 20,
            size: Math.random() * 6 + 4,
            color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
            speedX: Math.random() * 4 - 2,
            speedY: Math.random() * 3 + 2,
            rotation: Math.random() * 360,
            rotationSpeed: Math.random() * 10 - 5,
        });
    }
    if (!confettiActive) {
        confettiActive = true;
        animateConfetti();
    }
}
function animateConfetti() {
    if (!confettiCanvas || !confettiCtx || confettiParticles.length === 0) {
        confettiActive = false;
        if (confettiAnimationId !== null) {
            cancelAnimationFrame(confettiAnimationId);
            confettiAnimationId = null;
        }
        return;
    }
    confettiCtx.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);
    for (let i = confettiParticles.length - 1; i >= 0; i--) {
        const p = confettiParticles[i];
        p.y += p.speedY;
        p.x += p.speedX;
        p.rotation += p.rotationSpeed;
        confettiCtx.save();
        confettiCtx.translate(p.x, p.y);
        confettiCtx.rotate((p.rotation * Math.PI) / 180);
        confettiCtx.fillStyle = p.color;
        confettiCtx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
        confettiCtx.restore();
        if (p.y > confettiCanvas.height) {
            confettiParticles.splice(i, 1);
        }
    }
    confettiAnimationId = requestAnimationFrame(animateConfetti);
}
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
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
function tasksAreEqual(a, b) {
    if (a.length !== b.length) {
        return false;
    }
    for (let i = 0; i < a.length; i++) {
        if (a[i].id !== b[i].id || a[i].completed !== b[i].completed || a[i].text !== b[i].text) {
            return false;
        }
    }
    return true;
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
    startPauseButton.textContent = state.isRunning ? 'Pause' : (state.remainingMs < state.totalPhaseMs ? 'Resume' : 'Start');
    skipButton.disabled = state.isRunning && liveRemaining <= 1000;
    // Disable duration inputs for the currently running mode
    focusInput.disabled = state.isRunning && state.mode === 'focus';
    shortBreakInput.disabled = state.isRunning && state.mode === 'shortBreak';
    longBreakInput.disabled = state.isRunning && state.mode === 'longBreak';
    // Add tooltips
    focusInput.title = focusInput.disabled ? 'Cannot change duration while timer is running' : '';
    shortBreakInput.title = shortBreakInput.disabled ? 'Cannot change duration while timer is running' : '';
    longBreakInput.title = longBreakInput.disabled ? 'Cannot change duration while timer is running' : '';
    if (document.activeElement !== focusInput) {
        focusInput.value = String(state.focusMinutes);
    }
    if (document.activeElement !== shortBreakInput) {
        shortBreakInput.value = String(state.shortBreakMinutes);
    }
    if (document.activeElement !== longBreakInput) {
        longBreakInput.value = String(state.longBreakMinutes);
    }
    levelValue.textContent = String(level);
    xpValue.textContent = String(totalXp);
    xpFill.style.width = `${Math.round(clamp(xpProgress, 0, 1) * 100)}%`;
    xpSubLabel.textContent = `${xpInCurrentLevel} / ${xpForNextLevel} XP to next level`;
    pomodoroCount.textContent = String(asSafeNumber(state.totalPomodorosCompleted));
    focusMinutesTotal.textContent = String(asSafeNumber(state.totalFocusMinutesCompleted));
    breakCount.textContent = String(totalBreaks);
    breakMinutesTotal.textContent = String(asSafeNumber(state.totalBreakMinutesCompleted));
    // Daily Goal & Streak display
    dailyGoalProgress.textContent = `${state.dailyPomodorosCompleted} / ${state.dailyGoalCount}`;
    streakValue.textContent = String(state.streakCount);
    if (document.activeElement !== dailyGoalInput) {
        dailyGoalInput.value = String(state.dailyGoalCount);
    }
    if (document.activeElement !== soundChimeSelect) {
        soundChimeSelect.value = state.soundChime || 'chime';
    }
    // Focus Tasks Checklist rendering
    const tasks = state.tasks || [];
    const prevTasks = previousState?.tasks || [];
    if (!previousState || !tasksAreEqual(prevTasks, tasks)) {
        const activeTasksCount = tasks.filter((t) => !t.completed).length;
        taskCount.textContent = `${activeTasksCount} active`;
        // Sort tasks: unchecked first, checked last
        const sortedTasks = [...tasks].sort((a, b) => {
            if (a.completed === b.completed)
                return 0;
            return a.completed ? 1 : -1;
        });
        taskList.innerHTML = '';
        sortedTasks.forEach((task) => {
            const li = document.createElement('li');
            li.className = `task-item ${task.completed ? 'completed' : ''}`;
            li.innerHTML = `
				<div class="task-item-left" data-id="${task.id}">
					<input type="checkbox" ${task.completed ? 'checked' : ''} />
					<span class="task-text">${escapeHtml(task.text)}</span>
				</div>
				<button class="task-delete-btn" data-id="${task.id}" title="Delete Task">🗑️</button>
			`;
            taskList.appendChild(li);
        });
    }
    // Trigger confetti celebrations on level up or Pomodoro completion
    if (previousState) {
        if (state.level > previousState.level) {
            spawnConfetti(150);
        }
        else if (state.totalPomodorosCompleted > previousState.totalPomodorosCompleted) {
            spawnConfetti(80);
        }
    }
    previousState = state;
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
    if (!latestState) {
        return;
    }
    const newPayload = readDurationInputs();
    // Determine which mode's duration changed
    let changedMode = null;
    if (newPayload.focusMinutes !== latestState.focusMinutes) {
        changedMode = 'focus';
    }
    else if (newPayload.shortBreakMinutes !== latestState.shortBreakMinutes) {
        changedMode = 'shortBreak';
    }
    else if (newPayload.longBreakMinutes !== latestState.longBreakMinutes) {
        changedMode = 'longBreak';
    }
    // If timer is running and the changed mode is the currently running mode, prevent the change
    if (latestState.isRunning && changedMode === latestState.mode) {
        render(latestState);
        return;
    }
    latestState = await sendMessage({ action: 'setDurations', payload: newPayload });
    // If timer is paused and the current mode's duration was changed, reset the timer
    const isPaused = !latestState.isRunning && latestState.remainingMs < latestState.totalPhaseMs;
    if (isPaused && changedMode === latestState.mode) {
        latestState = await sendMessage({ action: 'reset' });
    }
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
    initConfetti();
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
    clearDataButton.addEventListener('click', () => {
        const shouldClear = window.confirm('Clear all saved settings and progress data? This cannot be undone.');
        if (!shouldClear) {
            return;
        }
        playSound(clickSound);
        void sendMessage({ action: 'clearData' }).then((state) => {
            latestState = state;
            previousState = null;
            render(state);
        });
    });
    [focusInput, shortBreakInput, longBreakInput].forEach((input) => {
        input.addEventListener('change', () => {
            void updateDurationsFromInputs();
        });
    });
    soundChimeSelect.addEventListener('change', () => {
        void sendMessage({
            action: 'setSoundChime',
            payload: { soundChime: soundChimeSelect.value }
        }).then((state) => {
            latestState = state;
            render(state);
        });
    });
    dailyGoalInput.addEventListener('change', () => {
        const goalVal = clamp(Number(dailyGoalInput.value) || 4, 1, 20);
        void sendMessage({
            action: 'setDailyGoal',
            payload: { dailyGoalCount: goalVal }
        }).then((state) => {
            latestState = state;
            render(state);
        });
    });
    const handleAddTask = () => {
        const text = newTaskInput.value.trim();
        if (!text)
            return;
        newTaskInput.value = '';
        playSound(clickSound);
        void sendMessage({
            action: 'addTask',
            payload: { text }
        }).then((state) => {
            latestState = state;
            render(state);
        });
    };
    addTaskButton.addEventListener('click', handleAddTask);
    newTaskInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            handleAddTask();
        }
    });
    taskList.addEventListener('click', (e) => {
        const target = e.target;
        // Checkbox or text row toggle
        const itemLeft = target.closest('.task-item-left');
        if (itemLeft) {
            const id = itemLeft.dataset.id;
            if (id) {
                playSound(clickSound);
                void sendMessage({
                    action: 'toggleTask',
                    payload: { id }
                }).then((state) => {
                    latestState = state;
                    render(state);
                });
            }
            return;
        }
        // Delete task button
        const deleteBtn = target.closest('.task-delete-btn');
        if (deleteBtn) {
            const id = deleteBtn.dataset.id;
            if (id) {
                playSound(clickSound);
                void sendMessage({
                    action: 'deleteTask',
                    payload: { id }
                }).then((state) => {
                    latestState = state;
                    render(state);
                });
            }
            return;
        }
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
