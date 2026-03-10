const SESSIONS_KEY = 'pocketPomoSessions';
const MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
];
let viewedYear = 0;
let viewedMonth = 0; // 0-based (0 = January)
let allSessions = [];
function initViewedMonth() {
    const now = new Date();
    viewedMonth = now.getMonth() - 1;
    viewedYear = now.getFullYear();
    if (viewedMonth < 0) {
        viewedMonth = 11;
        viewedYear -= 1;
    }
}
function filterSessionsForMonth(sessions, year, month) {
    return sessions.filter((s) => {
        const d = new Date(s.timestamp);
        return d.getFullYear() === year && d.getMonth() === month;
    });
}
function formatMinutes(totalMin) {
    if (totalMin === 0)
        return '0m';
    if (totalMin < 60)
        return `${totalMin}m`;
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
}
function daysInMonth(year, month) {
    return new Date(year, month + 1, 0).getDate();
}
function renderReport(sessions) {
    const monthTitleEl = document.getElementById('monthTitle');
    const totalPomodorosEl = document.getElementById('totalPomodoros');
    const totalFocusTimeEl = document.getElementById('totalFocusTime');
    const totalBreaksEl = document.getElementById('totalBreaks');
    const totalBreakTimeEl = document.getElementById('totalBreakTime');
    const tbody = document.getElementById('dailyBody');
    const noDataEl = document.getElementById('noData');
    const tableEl = document.getElementById('dailyTable');
    const nextMonthBtn = document.getElementById('nextMonth');
    const label = `${MONTH_NAMES[viewedMonth]} ${viewedYear}`;
    monthTitleEl.textContent = label;
    document.title = `Pocket Pomo – ${label} Report`;
    // Disable "next" button when already at the most recent complete month
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();
    const latestCompleteMonth = currentMonth === 0 ? 11 : currentMonth - 1;
    const latestCompleteYear = currentMonth === 0 ? currentYear - 1 : currentYear;
    nextMonthBtn.disabled =
        viewedYear > latestCompleteYear ||
            (viewedYear === latestCompleteYear && viewedMonth >= latestCompleteMonth);
    const focusSessions = sessions.filter((s) => s.type === 'focus');
    const breakSessions = sessions.filter((s) => s.type !== 'focus');
    const pomodoroCount = focusSessions.length;
    const focusMinutes = focusSessions.reduce((sum, s) => sum + s.minutes, 0);
    const breakCount = breakSessions.length;
    const breakMinutes = breakSessions.reduce((sum, s) => sum + s.minutes, 0);
    totalPomodorosEl.textContent = String(pomodoroCount);
    totalFocusTimeEl.textContent = formatMinutes(focusMinutes);
    totalBreaksEl.textContent = String(breakCount);
    totalBreakTimeEl.textContent = formatMinutes(breakMinutes);
    tbody.innerHTML = '';
    if (sessions.length === 0) {
        noDataEl.style.display = 'block';
        tableEl.style.display = 'none';
    }
    else {
        noDataEl.style.display = 'none';
        tableEl.style.display = '';
        // Group sessions by day
        const byDay = new Map();
        const totalDays = daysInMonth(viewedYear, viewedMonth);
        for (let d = 1; d <= totalDays; d++) {
            byDay.set(d, []);
        }
        for (const s of sessions) {
            const day = new Date(s.timestamp).getDate();
            const bucket = byDay.get(day);
            if (bucket)
                bucket.push(s);
        }
        byDay.forEach((daySessions, day) => {
            if (daySessions.length === 0)
                return;
            const dayFocus = daySessions.filter((s) => s.type === 'focus');
            const dayBreaks = daySessions.filter((s) => s.type !== 'focus');
            const dateStr = new Date(viewedYear, viewedMonth, day).toLocaleDateString('en-US', {
                weekday: 'short',
                month: 'short',
                day: 'numeric',
            });
            const tr = document.createElement('tr');
            tr.innerHTML = `
        <td>${dateStr}</td>
        <td>${dayFocus.length}</td>
        <td>${formatMinutes(dayFocus.reduce((sum, s) => sum + s.minutes, 0))}</td>
        <td>${dayBreaks.length}</td>
        <td>${formatMinutes(dayBreaks.reduce((sum, s) => sum + s.minutes, 0))}</td>
      `;
            tbody.appendChild(tr);
        });
    }
}
async function loadAndRender() {
    const result = await chrome.storage.local.get(SESSIONS_KEY);
    allSessions = Array.isArray(result[SESSIONS_KEY]) ? result[SESSIONS_KEY] : [];
    const monthSessions = filterSessionsForMonth(allSessions, viewedYear, viewedMonth);
    renderReport(monthSessions);
}
function navigateMonth(delta) {
    viewedMonth += delta;
    if (viewedMonth < 0) {
        viewedMonth = 11;
        viewedYear -= 1;
    }
    else if (viewedMonth > 11) {
        viewedMonth = 0;
        viewedYear += 1;
    }
    const monthSessions = filterSessionsForMonth(allSessions, viewedYear, viewedMonth);
    renderReport(monthSessions);
}
function initialize() {
    initViewedMonth();
    document.getElementById('prevMonth')?.addEventListener('click', () => navigateMonth(-1));
    document.getElementById('nextMonth')?.addEventListener('click', () => navigateMonth(1));
    document.getElementById('printBtn')?.addEventListener('click', () => window.print());
    void loadAndRender();
}
document.addEventListener('DOMContentLoaded', initialize);
export {};
