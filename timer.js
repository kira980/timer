// Pure tray-timer logic. Time is derived from timestamps (not tick counting),
// so timers stay accurate when the tab is backgrounded or the phone sleeps.

export const DEFAULT_TRAYS = 5;
export const DEFAULT_DURATION_MS = 5 * 60 * 1000;

export function createTray(index, durationMs = DEFAULT_DURATION_MS) {
  return {
    id: `tray-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    name: `Tray ${index + 1}`,
    durationMs,
    remainingMs: durationMs, // remaining time while paused/idle
    endAt: null, // timestamp when running, else null
    done: false,
  };
}

export function createTrays(count = DEFAULT_TRAYS) {
  return Array.from({ length: count }, (_, i) => createTray(i));
}

export function isRunning(tray) {
  return tray.endAt !== null;
}

export function remaining(tray, now = Date.now()) {
  if (!isRunning(tray)) return tray.remainingMs;
  return Math.max(0, tray.endAt - now);
}

export function start(tray, now = Date.now()) {
  if (isRunning(tray)) return tray;
  const left = tray.done || tray.remainingMs <= 0 ? tray.durationMs : tray.remainingMs;
  return { ...tray, endAt: now + left, remainingMs: left, done: false };
}

export function pause(tray, now = Date.now()) {
  if (!isRunning(tray)) return tray;
  return { ...tray, endAt: null, remainingMs: remaining(tray, now) };
}

export function toggle(tray, now = Date.now()) {
  return isRunning(tray) ? pause(tray, now) : start(tray, now);
}

export function reset(tray) {
  return { ...tray, endAt: null, remainingMs: tray.durationMs, done: false };
}

export function setDuration(tray, durationMs) {
  const ms = Math.max(1000, Math.min(Math.round(durationMs), 100 * 3600 * 1000 - 1000));
  return { ...tray, durationMs: ms, remainingMs: ms, endAt: null, done: false };
}

// Advance a tray to "now". Returns [tray, justFinished].
export function tick(tray, now = Date.now()) {
  if (isRunning(tray) && now >= tray.endAt) {
    return [{ ...tray, endAt: null, remainingMs: 0, done: true }, true];
  }
  return [tray, false];
}

export function format(ms) {
  const total = Math.ceil(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

// Accepts "90" (minutes), "5:30" (m:s) or "1:05:00" (h:m:s). Returns ms or null.
export function parseDuration(input) {
  const str = String(input).trim();
  if (!/^\d+(:\d{1,2}){0,2}$/.test(str)) return null;
  const parts = str.split(":").map(Number);
  let secs;
  if (parts.length === 1) secs = parts[0] * 60;
  else if (parts.length === 2) secs = parts[0] * 60 + parts[1];
  else secs = parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length > 1 && parts.slice(1).some((p) => p > 59)) return null;
  return secs > 0 ? secs * 1000 : null;
}

// Restore from storage, discarding anything malformed.
export function restore(raw) {
  try {
    const data = JSON.parse(raw);
    if (!Array.isArray(data) || data.length === 0) return null;
    const ok = data.every(
      (t) => t && typeof t.id === "string" && typeof t.name === "string" &&
        Number.isFinite(t.durationMs) && Number.isFinite(t.remainingMs) &&
        (t.endAt === null || Number.isFinite(t.endAt))
    );
    return ok ? data.map((t) => ({ ...t, done: !!t.done })) : null;
  } catch {
    return null;
  }
}
