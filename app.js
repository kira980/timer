import * as T from "./timer.js";

const STORAGE_KEY = "tray-timer:v1";
const list = document.getElementById("trays");
const template = document.getElementById("tray-template");

let trays = load();
const cards = new Map(); // tray id -> card element

function load() {
  try {
    return T.restore(localStorage.getItem(STORAGE_KEY)) ?? T.createTrays();
  } catch {
    return T.createTrays();
  }
}

function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(trays)); } catch {}
}

function update(id, fn) {
  trays = trays.map((t) => (t.id === id ? fn(t) : t));
  save();
  render();
}

// ---------- rendering ----------

function buildCard(tray) {
  const el = template.content.firstElementChild.cloneNode(true);
  el.dataset.id = tray.id;

  const name = el.querySelector(".name");
  name.addEventListener("change", () => {
    const value = name.value.trim() || tray.name;
    update(tray.id, (t) => ({ ...t, name: value }));
  });
  name.addEventListener("keydown", (e) => { if (e.key === "Enter") name.blur(); });

  el.querySelector(".start").addEventListener("click", () => {
    unlockAudio();
    update(tray.id, (t) => T.toggle(t));
  });
  el.querySelector(".reset").addEventListener("click", () => update(tray.id, T.reset));
  el.querySelector(".remove").addEventListener("click", () => {
    const t = trays.find((x) => x.id === tray.id);
    if (trays.length <= 1) return;
    if (!confirm(`Remove ${t.name}?`)) return;
    trays = trays.filter((x) => x.id !== tray.id);
    save();
    render();
  });
  el.querySelector(".time").addEventListener("click", () => editDuration(tray.id));
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

function render(now = Date.now()) {
  // Add/remove/reorder cards to match state.
  const ids = new Set(trays.map((t) => t.id));
  for (const [id, el] of cards) if (!ids.has(id)) { el.remove(); cards.delete(id); }
  trays.forEach((tray, i) => {
    let el = cards.get(tray.id);
    if (!el) { el = buildCard(tray); cards.set(tray.id, el); }
    if (list.children[i] !== el) list.insertBefore(el, list.children[i] ?? null);
  });

  for (const tray of trays) {
    const el = cards.get(tray.id);
    const running = T.isRunning(tray);
    const left = T.remaining(tray, now);
    el.classList.toggle("running", running);
    el.classList.toggle("done", tray.done);
    el.querySelector(".remove").hidden = trays.length <= 1;

    const name = el.querySelector(".name");
    if (document.activeElement !== name) name.value = tray.name;

    const time = el.querySelector(".time");
    if (!time.querySelector("input")) time.textContent = T.format(left);

    el.querySelector(".bar span").style.transform =
      `scaleX(${tray.durationMs ? left / tray.durationMs : 0})`;

    const start = el.querySelector(".start");
    start.textContent = running ? "Pause" : tray.done ? "Restart" :
      left < tray.durationMs ? "Resume" : "Start";
    el.querySelector(".reset").disabled = !running && !tray.done && left === tray.durationMs;
  }

  const runningCount = trays.filter(T.isRunning).length;
  document.title = runningCount ? `(${runningCount}) Tray Timer` : "Tray Timer";
  syncWakeLock(runningCount > 0);
}

// ---------- tick loop ----------

function loop() {
  const now = Date.now();
  let finished = [];
  let changed = false;
  trays = trays.map((t) => {
    const [next, done] = T.tick(t, now);
    if (done) { finished.push(next); changed = true; }
    return next;
  });
  if (changed) { save(); finished.forEach(alarm); }
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

function alarm(tray) {
  if (navigator.vibrate) navigator.vibrate([300, 150, 300, 150, 300]);
  if (audioCtx) {
    const t0 = audioCtx.currentTime;
    for (let i = 0; i < 6; i++) {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.frequency.value = i % 2 ? 660 : 880;
      gain.gain.setValueAtTime(0.0001, t0 + i * 0.35);
      gain.gain.exponentialRampToValueAtTime(0.4, t0 + i * 0.35 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.35 + 0.3);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(t0 + i * 0.35);
      osc.stop(t0 + i * 0.35 + 0.32);
    }
  }
  if (document.hidden && "Notification" in window && Notification.permission === "granted") {
    navigator.serviceWorker?.ready
      .then((reg) => reg.showNotification(`${tray.name} is done`, { icon: "/icons/icon-192.png", tag: tray.id }))
      .catch(() => {});
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
  trays = [...trays, T.createTray(trays.length)];
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

// Ask for notification permission once, on first Start press.
document.addEventListener("click", (e) => {
  if (e.target.closest(".start") && "Notification" in window && Notification.permission === "default") {
    Notification.requestPermission().catch(() => {});
  }
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
}

render();
