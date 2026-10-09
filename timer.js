// Pure tray-timer logic. Time is derived from timestamps (not tick counting),
// so timers stay accurate when the tab is backgrounded or the phone sleeps.

// A "timer" is { durationMs, remainingMs, endAt, done }. A tray is a timer
// itself (Timer mode) plus two sub-timers, bake and pickup (Orders mode).

export const DEFAULT_TRAYS = 5;
export const DEFAULT_DURATION_MS = 5 * 60 * 1000;
export const DEFAULT_SETTINGS = {
  timerMs: DEFAULT_DURATION_MS,
  bakeMs: 20 * 60 * 1000,
  pickupMs: 30 * 60 * 1000,
};

export function createTimer(durationMs) {
  return {
    durationMs,
    remainingMs: durationMs, // remaining time while paused/idle
    endAt: null, // timestamp when running, else null
    done: false,
  };
}

export function createTray(index, settings = DEFAULT_SETTINGS) {
  return {
    id: `tray-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    name: `Tray ${index + 1}`,
    ...createTimer(settings.timerMs),
    bake: createTimer(settings.bakeMs),
    pickup: createTimer(settings.pickupMs),
  };
}

export function createTrays(count = DEFAULT_TRAYS, settings = DEFAULT_SETTINGS) {
  return Array.from({ length: count }, (_, i) => createTray(i, settings));
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

// Run until a fixed moment (e.g. a pickup time typed as a clock time).
export function setEndAt(tray, endAt, now = Date.now()) {
  return { ...tray, endAt, remainingMs: Math.max(0, endAt - now), done: false };
}

// Fraction of the duration left, for progress bars (0..1).
export function progress(tray, now = Date.now()) {
  return tray.durationMs ? Math.min(1, remaining(tray, now) / tray.durationMs) : 0;
}

// "14:30" -> timestamp of the next 14:30 (today, or tomorrow if already past).
export function parseClock(input, now = Date.now()) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(input).trim());
  if (!m || +m[1] > 23 || +m[2] > 59) return null;
  const d = new Date(now);
  d.setHours(+m[1], +m[2], 0, 0);
  if (d.getTime() <= now) d.setDate(d.getDate() + 1);
  return d.getTime();
}

// ---------- Orders mode: bake + pickup per tray ----------

export const ORDER_PARTS = ["bake", "pickup"];

export function orderRunning(tray) {
  return ORDER_PARTS.some((k) => isRunning(tray[k]));
}

export function orderDone(tray) {
  return ORDER_PARTS.some((k) => tray[k].done);
}

// Start both (anything already running keeps going) or pause both.
export function toggleOrder(tray, now = Date.now()) {
  const fn = orderRunning(tray) ? pause : start;
  return { ...tray, bake: fn(tray.bake, now), pickup: fn(tray.pickup, now) };
}

export function resetOrder(tray) {
  return { ...tray, bake: reset(tray.bake), pickup: reset(tray.pickup) };
}

export function updatePart(tray, part, fn) {
  return { ...tray, [part]: fn(tray[part]) };
}

// Advance every timer in a tray. Returns [tray, finished] where finished lists
// which of "timer", "bake", "pickup" just hit zero.
export function tickTray(tray, now = Date.now()) {
  const finished = [];
  let [next, done] = tick(tray, now);
  if (done) finished.push("timer");
  for (const k of ORDER_PARTS) {
    const [sub, subDone] = tick(next[k], now);
    if (subDone) { next = { ...next, [k]: sub }; finished.push(k); }
  }
  return [next, finished];
}

// Settings: make every tray use the same durations (stops running trays).
export function applyUniform(trays, settings) {
  return trays.map((t) => ({
    ...setDuration(t, settings.timerMs),
    bake: setDuration(t.bake, settings.bakeMs),
    pickup: setDuration(t.pickup, settings.pickupMs),
  }));
}

export function restoreSettings(raw) {
  try {
    const data = JSON.parse(raw) ?? {};
    const out = { ...DEFAULT_SETTINGS };
    for (const k of Object.keys(out)) if (Number.isFinite(data[k]) && data[k] >= 1000) out[k] = data[k];
    return out;
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

const isTimer = (t) => t && Number.isFinite(t.durationMs) && Number.isFinite(t.remainingMs) &&
  (t.endAt === null || Number.isFinite(t.endAt));

// Restore from storage, discarding anything malformed.
// Trays saved before Orders mode existed get default bake/pickup timers.
export function restore(raw, settings = DEFAULT_SETTINGS) {
  try {
    const data = JSON.parse(raw);
    if (!Array.isArray(data) || data.length === 0) return null;
    const ok = data.every((t) => isTimer(t) && typeof t.id === "string" && typeof t.name === "string");
    if (!ok) return null;
    return data.map((t) => ({
      ...t,
      done: !!t.done,
      bake: isTimer(t.bake) ? { ...t.bake, done: !!t.bake.done } : createTimer(settings.bakeMs),
      pickup: isTimer(t.pickup) ? { ...t.pickup, done: !!t.pickup.done } : createTimer(settings.pickupMs),
    }));
  } catch {
    return null;
  }
}
