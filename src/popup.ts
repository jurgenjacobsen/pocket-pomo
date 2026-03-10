export type PomodoroMode = 'focus' | 'shortBreak' | 'longBreak';

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

type PopupMessage =
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

const timeLabel = document.getElementById('timeLabel') as HTMLParagraphElement;
const modeLabel = document.getElementById('modeLabel') as HTMLParagraphElement;
const statusLabel = document.getElementById('statusLabel') as HTMLParagraphElement;
const progressRing = document.getElementById('progressRing') as HTMLDivElement;
const startPauseButton = document.getElementById('startPauseButton') as HTMLButtonElement;
const resetButton = document.getElementById('resetButton') as HTMLButtonElement;
const skipButton = document.getElementById('skipButton') as HTMLButtonElement;

const focusInput = document.getElementById('focusMinutes') as HTMLInputElement;
const shortBreakInput = document.getElementById('shortBreakMinutes') as HTMLInputElement;
const longBreakInput = document.getElementById('longBreakMinutes') as HTMLInputElement;
const levelValue = document.getElementById('levelValue') as HTMLSpanElement;
const xpValue = document.getElementById('xpValue') as HTMLSpanElement;
const xpFill = document.getElementById('xpFill') as HTMLDivElement;
const xpSubLabel = document.getElementById('xpSubLabel') as HTMLParagraphElement;
const pomodoroCount = document.getElementById('pomodoroCount') as HTMLParagraphElement;
const focusMinutesTotal = document.getElementById('focusMinutesTotal') as HTMLParagraphElement;
const breakCount = document.getElementById('breakCount') as HTMLParagraphElement;
const breakMinutesTotal = document.getElementById('breakMinutesTotal') as HTMLParagraphElement;

const clickSound = new Audio(chrome.runtime.getURL('assets/click.mp3'));

let latestState: TimerState | null = null;
let refreshHandle: number | null = null;

const MODE_LABELS: Record<PomodoroMode, string> = {
	focus: 'Focus',
	shortBreak: 'Short Break',
	longBreak: 'Long Break',
};

const MODE_STATUS: Record<PomodoroMode, string> = {
	focus: 'Heads down. Build momentum.',
	shortBreak: 'Quick reset. Breathe and stretch.',
	longBreak: 'Long recharge. You earned it.',
};

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

function asSafeNumber(value: unknown, fallback = 0): number {
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : fallback;
}

function formatTime(milliseconds: number): string {
	const totalSeconds = Math.ceil(milliseconds / 1000);
	const safeSeconds = Math.max(totalSeconds, 0);
	const minutes = Math.floor(safeSeconds / 60)
		.toString()
		.padStart(2, '0');
	const seconds = (safeSeconds % 60).toString().padStart(2, '0');
	return `${minutes}:${seconds}`;
}

function playSound(sound: HTMLAudioElement): void {
	try {
		sound.currentTime = 0;
		void sound.play();
	} catch (error) {
		console.debug('Unable to play sound:', error);
	}
}

function getLiveRemaining(state: TimerState): number {
	if (!state.isRunning || state.phaseEndMs === null) {
		return state.remainingMs;
	}
	return Math.max(0, state.phaseEndMs - Date.now());
}

function getStatusText(state: TimerState, remainingMs: number): string {
	if (remainingMs === 0) {
		return 'Switching sessions...';
	}
	if (!state.isRunning) {
		return 'Paused. Jump back in when ready.';
	}
	return MODE_STATUS[state.mode];
}

async function sendMessage(message: PopupMessage): Promise<TimerState> {
	const response = await chrome.runtime.sendMessage(message);
	return response as TimerState;
}

function render(state: TimerState): void {
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
	skipButton.disabled = state.isRunning && liveRemaining <= 1_000;

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

async function refreshState(): Promise<void> {
	latestState = await sendMessage({ action: 'getState' });
	render(latestState);
}

function readDurationInputs(): { focusMinutes: number; shortBreakMinutes: number; longBreakMinutes: number } {
	return {
		focusMinutes: clamp(Number(focusInput.value) || 25, 1, 120),
		shortBreakMinutes: clamp(Number(shortBreakInput.value) || 5, 1, 60),
		longBreakMinutes: clamp(Number(longBreakInput.value) || 15, 1, 90),
	};
}

async function updateDurationsFromInputs(): Promise<void> {
	const payload = readDurationInputs();
	latestState = await sendMessage({ action: 'setDurations', payload });
	render(latestState);
}

async function handleStartPause(): Promise<void> {
	playSound(clickSound);

	if (!latestState) {
		await refreshState();
	}
	if (latestState?.isRunning) {
		latestState = await sendMessage({ action: 'pause' });
	} else {
		latestState = await sendMessage({ action: 'start' });
	}
	if (latestState) {
		render(latestState);
	}
}

async function initialize(): Promise<void> {
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

	document.getElementById('reportButton')?.addEventListener('click', () => {
		void chrome.tabs.create({ url: chrome.runtime.getURL('report.html') });
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