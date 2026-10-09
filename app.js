import * as T from "./timer.js";

const STORAGE_KEY = "tray-timer:v1";
const SETTINGS_KEY = "tray-timer:settings";
const MODE_KEY = "tray-timer:mode";
const PART_LABEL = { bake: "Bake", pickup: "Pickup" };
const HINTS = {
  timer: "Tap a time to change it · tap a name to rename",
  orders: "Tap Bake or Pickup to set a duration or a clock time · ⚙︎ to make all trays uniform",
};

const list = document.getElementById("trays");
const templates = {
  timer: document.getElementById("tray-template"),
  orders: document.getElementById("order-template"),
};

let settings = T.restoreSettings(read(SETTINGS_KEY));
let trays = T.restore(read(STORAGE_KEY), settings) ?? T.createTrays(T.DEFAULT_TRAYS, settings);
let mode = read(MODE_KEY) === "orders" ? "orders" : "timer";
const cards = new Map(); // tray id -> card element (for the current mode)

function read(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function write(key, value) {
  try { localStorage.setItem(key, value); } catch {}
}

function save() {
  write(STORAGE_KEY, JSON.stringify(trays));
}

function update(id, fn) {
  trays = trays.map((t) => (t.id === id ? fn(t) : t));
  save();
  render();
}

const clockTime = (ms) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

// ---------- mode ----------

function setMode(next) {
  mode = next;
  write(MODE_KEY, mode);
  for (const [, el] of cards) el.remove();
  cards.clear();
  render();
}

document.querySelectorAll(".mode-switch button").forEach((btn) =>
  btn.addEventListener("click", () => setMode(btn.dataset.mode))
);

// ---------- rendering ----------

function buildCard(tray) {
  const el = templates[mode].content.firstElementChild.cloneNode(true);
  el.dataset.id = tray.id;

  const name = el.querySelector(".name");
  name.addEventListener("change", () => {
    const value = name.value.trim();
    if (value) update(tray.id, (t) => ({ ...t, name: value }));
    else render();
  });
  name.addEventListener("keydown", (e) => { if (e.key === "Enter") name.blur(); });

  el.querySelector(".start").addEventListener("click", () => {
    unlockAudio();
    askNotificationPermission();
    update(tray.id, mode === "orders" ? T.toggleOrder : T.toggle);
  });
  el.querySelector(".reset").addEventListener("click", () =>
    update(tray.id, mode === "orders" ? T.resetOrder : T.reset)
  );
  el.querySelector(".remove").addEventListener("click", () => {
    const t = trays.find((x) => x.id === tray.id);
    if (trays.length <= 1) return;
    if (!confirm(`Remove ${t.name}?`)) return;
    trays = trays.filter((x) => x.id !== tray.id);
    save();
    render();
  });

  if (mode === "timer") {
    el.querySelector(".time").addEventListener("click", () => editDuration(tray.id));
  } else {
    el.querySelectorAll(".part").forEach((btn) =>
      btn.addEventListener("click", () => openEditor(tray.id, btn.dataset.part))
    );
  }
  return el;
}

function editDuration(id) {
  const tray = trays.find((t) => t.id === id);
  if (!tray || T.isRunning(tray)) return;
  const btn = cards.get(id).querySelector(".time");
  if (btn.querySelector("input")) return;
  const input = document.createElement("input");
  input.inputMode = "numeric";
  input.value = T.format(tray.durationMs);
  input.setAttribute("aria-label", "Duration (minutes, or m:ss)");
  btn.textContent = "";
  btn.append(input);
  input.focus();
  input.select();

  let finished = false;
  const commit = (apply) => {
    if (finished) return;
    finished = true;
    const ms = apply ? T.parseDuration(input.value) : null;
    input.remove();
    if (ms) update(id, (t) => T.setDuration(t, ms));
    else render();
  };
  input.addEventListener("click", (e) => e.stopPropagation());
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") commit(true);
    if (e.key === "Escape") commit(false);
  });
  input.addEventListener("blur", () => commit(true));
}

function renderTimerCard(el, tray, now) {
  const running = T.isRunning(tray);
  const left = T.remaining(tray, now);
  el.classList.toggle("running", running);
  el.classList.toggle("done", tray.done);

  const time = el.querySelector(".time");
  if (!time.querySelector("input")) time.textContent = T.format(left);
  el.querySelector(".bar span").style.transform = `scaleX(${T.progress(tray, now)})`;

  el.querySelector(".start").textContent = running ? "Pause" : tray.done ? "Restart" :
    left < tray.durationMs ? "Resume" : "Start";
  el.querySelector(".reset").disabled = !running && !tray.done && left === tray.durationMs;
  return running;
}

function renderOrderCard(el, tray, now) {
  const running = T.orderRunning(tray);
  el.classList.toggle("running", running);
  el.classList.toggle("done", T.orderDone(tray));

  let untouched = true;
  for (const part of T.ORDER_PARTS) {
    const sub = tray[part];
    const btn = el.querySelector(`.part[data-part="${part}"]`);
    const left = T.remaining(sub, now);
    btn.classList.toggle("running", T.isRunning(sub));
    btn.classList.toggle("done", sub.done);
    btn.querySelector(".count").textContent = T.format(left);
    btn.querySelector(".at").textContent = T.isRunning(sub) ? `at ${clockTime(sub.endAt)}` :
      sub.done ? "Done" : left < sub.durationMs ? "Paused" : `${T.format(sub.durationMs)} total`;
    btn.querySelector(".bar span").style.transform = `scaleX(${T.progress(sub, now)})`;
    if (T.isRunning(sub) || sub.done || left !== sub.durationMs) untouched = false;
  }

  const anyDone = T.orderDone(tray);
  el.querySelector(".start").textContent = running ? "Pause" : untouched ? "Start" :
    anyDone ? "Restart" : "Resume";
  el.querySelector(".reset").disabled = untouched;
  return running;
}

function render(now = Date.now()) {
  // Add/remove/reorder cards to match state.
  const ids = new Set(trays.map((t) => t.id));
  for (const [id, el] of cards) if (!ids.has(id)) { el.remove(); cards.delete(id); }
  trays.forEach((tray, i) => {
    let el = cards.get(tray.id);
    if (!el) { el = buildCard(tray); cards.set(tray.id, el); }
    if (list.children[i] !== el) list.insertBefore(el, list.children[i] ?? null);
  });

  let runningCount = 0;
  for (const tray of trays) {
    const el = cards.get(tray.id);
    el.querySelector(".remove").hidden = trays.length <= 1;
    const name = el.querySelector(".name");
    if (document.activeElement !== name) name.value = tray.name;
    const running = mode === "orders" ? renderOrderCard(el, tray, now) : renderTimerCard(el, tray, now);
    if (running) runningCount++;
  }

  document.querySelectorAll(".mode-switch button").forEach((b) =>
    b.setAttribute("aria-pressed", String(b.dataset.mode === mode))
  );
  document.getElementById("hint").textContent = HINTS[mode];
  document.title = runningCount ? `(${runningCount}) Tray Timer` : "Tray Timer";
  const anyRunning = trays.some((t) => T.isRunning(t) || T.orderRunning(t));
  syncWakeLock(anyRunning);
}

// ---------- bake / pickup editor ----------

const editDialog = document.getElementById("edit-dialog");
const editForm = editDialog.querySelector("form");
const editError = document.getElementById("edit-error");
let editing = null; // { id, part }

function showKind(kind) {
  editForm.querySelectorAll(".field[data-kind]").forEach((f) => { f.hidden = f.dataset.kind !== kind; });
}
editForm.querySelectorAll('input[name="kind"]').forEach((r) =>
  r.addEventListener("change", () => { showKind(r.value); editError.hidden = true; })
);

function openEditor(id, part) {
  const tray = trays.find((t) => t.id === id);
  if (!tray) return;
  const sub = tray[part];
  editing = { id, part };
  document.getElementById("edit-title").textContent = `${tray.name} · ${PART_LABEL[part]}`;
  editForm.duration.value = T.format(sub.durationMs);
  const target = T.isRunning(sub) ? sub.endAt : Date.now() + T.remaining(sub);
  const d = new Date(target);
  editForm.clock.value = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  const kind = T.isRunning(sub) ? "clock" : "duration";
  editForm.kind.value = kind;
  showKind(kind);
  editError.hidden = true;
  editDialog.showModal();
  editForm[kind].focus();
  if (kind === "duration") editForm.duration.select();
}

editForm.addEventListener("submit", (e) => {
  if (e.submitter?.value !== "save" || !editing) return;
  const { id, part } = editing;
  if (editForm.kind.value === "duration") {
    const ms = T.parseDuration(editForm.duration.value);
    if (!ms) { e.preventDefault(); editError.hidden = false; return; }
    update(id, (t) => T.updatePart(t, part, (s) => T.setDuration(s, ms)));
  } else {
    const at = T.parseClock(editForm.clock.value);
    if (!at) { e.preventDefault(); editError.hidden = false; return; }
    unlockAudio();
    update(id, (t) => T.updatePart(t, part, (s) => T.setEndAt(s, at)));
  }
});
editDialog.addEventListener("close", () => { editing = null; });

// ---------- settings ----------

const settingsDialog = document.getElementById("settings-dialog");
const settingsForm = settingsDialog.querySelector("form");
const settingsError = document.getElementById("settings-error");
const SETTING_FIELDS = Object.keys(T.DEFAULT_SETTINGS);

document.getElementById("settings-btn").addEventListener("click", () => {
  for (const k of SETTING_FIELDS) settingsForm[k].value = T.format(settings[k]);
  settingsError.hidden = true;
  settingsDialog.showModal();
});

settingsForm.addEventListener("submit", (e) => {
  const action = e.submitter?.value;
  if (action !== "save" && action !== "apply") return;
  const next = {};
  for (const k of SETTING_FIELDS) {
    const ms = T.parseDuration(settingsForm[k].value);
    if (!ms) { e.preventDefault(); settingsError.hidden = false; settingsForm[k].focus(); return; }
    next[k] = ms;
  }
  if (action === "apply") {
    const busy = trays.some((t) => T.isRunning(t) || T.orderRunning(t));
    if (busy && !confirm("Some trays are running. Reset all trays to these times?")) {
      e.preventDefault();
      return;
    }
    trays = T.applyUniform(trays, next);
    save();
  }
  settings = next;
  write(SETTINGS_KEY, JSON.stringify(settings));
  render();
});

// ---------- tick loop ----------

function loop() {
  const now = Date.now();
  const alarms = [];
  trays = trays.map((t) => {
    const [next, finished] = T.tickTray(t, now);
    for (const kind of finished) alarms.push([next, kind]);
    return next;
  });
  if (alarms.length) { save(); alarms.forEach(([t, kind]) => alarm(t, kind)); }
  render(now);
}
setInterval(loop, 250);
document.addEventListener("visibilitychange", loop);

// ---------- alarm ----------

let audioCtx;
function unlockAudio() {
  // Must be created inside a user gesture on iOS/Safari.
  try {
    audioCtx ??= new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") audioCtx.resume();
  } catch {}
}

function alarm(tray, kind) {
  if (navigator.vibrate) navigator.vibrate([300, 150, 300, 150, 300]);
  if (audioCtx) {
    const t0 = audioCtx.currentTime;
    // Pickup uses a lower tone so it can be told apart from bake/timer.
    const [hi, lo] = kind === "pickup" ? [523, 392] : [880, 660];
    for (let i = 0; i < 6; i++) {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.frequency.value = i % 2 ? lo : hi;
      gain.gain.setValueAtTime(0.0001, t0 + i * 0.35);
      gain.gain.exponentialRampToValueAtTime(0.4, t0 + i * 0.35 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.35 + 0.3);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(t0 + i * 0.35);
      osc.stop(t0 + i * 0.35 + 0.32);
    }
  }
  if (document.hidden && "Notification" in window && Notification.permission === "granted") {
    const title = kind === "bake" ? `${tray.name}: baking done` :
      kind === "pickup" ? `${tray.name}: pickup time` : `${tray.name} is done`;
    navigator.serviceWorker?.ready
      .then((reg) => reg.showNotification(title, { icon: "/icons/icon-192.png", tag: `${tray.id}-${kind}` }))
      .catch(() => {});
  }
}

// Ask for notification permission once, on first Start press.
function askNotificationPermission() {
  if ("Notification" in window && Notification.permission === "default") {
    Notification.requestPermission().catch(() => {});
  }
}

// ---------- screen wake lock (keep screen on while timers run) ----------

let wakeLock = null;
async function syncWakeLock(want) {
  if (!("wakeLock" in navigator)) return;
  try {
    if (want && !wakeLock && !document.hidden) {
      wakeLock = await navigator.wakeLock.request("screen");
      wakeLock.addEventListener("release", () => { wakeLock = null; });
    } else if (!want && wakeLock) {
      await wakeLock.release();
      wakeLock = null;
    }
  } catch { wakeLock = null; }
}

// ---------- header actions ----------

document.getElementById("add").addEventListener("click", () => {
  trays = [...trays, T.createTray(trays.length, settings)];
  save();
  render();
});

let installPrompt = null;
const installBtn = document.getElementById("install");
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  installPrompt = e;
  installBtn.hidden = false;
});
installBtn.addEventListener("click", async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  await installPrompt.userChoice;
  installPrompt = null;
  installBtn.hidden = true;
});
window.addEventListener("appinstalled", () => { installBtn.hidden = true; });

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
}

render();
