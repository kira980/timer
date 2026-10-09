import { test } from "node:test";
import assert from "node:assert/strict";
import * as T from "../timer.js";

const MIN = 60_000;

test("creates 5 trays by default with 5:00 each", () => {
  const trays = T.createTrays();
  assert.equal(trays.length, 5);
  assert.deepEqual(trays.map((t) => t.name), ["Tray 1", "Tray 2", "Tray 3", "Tray 4", "Tray 5"]);
  assert.equal(new Set(trays.map((t) => t.id)).size, 5);
  for (const t of trays) assert.equal(T.remaining(t), 5 * MIN);
});

test("start counts down from timestamps", () => {
  const t = T.start(T.createTray(0), 1000);
  assert.ok(T.isRunning(t));
  assert.equal(T.remaining(t, 1000 + 30_000), 5 * MIN - 30_000);
});

test("pause keeps remaining time, start resumes from it", () => {
  let t = T.start(T.createTray(0), 0);
  t = T.pause(t, 10_000);
  assert.equal(T.isRunning(t), false);
  assert.equal(T.remaining(t, 999_999), 5 * MIN - 10_000);
  t = T.start(t, 50_000);
  assert.equal(T.remaining(t, 60_000), 5 * MIN - 20_000);
});

test("toggle alternates start and pause", () => {
  let t = T.toggle(T.createTray(0), 0);
  assert.ok(T.isRunning(t));
  t = T.toggle(t, 1000);
  assert.ok(!T.isRunning(t));
});

test("reset restores full duration and stops", () => {
  let t = T.start(T.createTray(0), 0);
  t = T.reset(t);
  assert.ok(!T.isRunning(t));
  assert.equal(T.remaining(t), 5 * MIN);
});

test("tick finishes timer exactly once", () => {
  let t = T.start(T.setDuration(T.createTray(0), 2000), 0);
  let [a, doneA] = T.tick(t, 1999);
  assert.equal(doneA, false);
  let [b, doneB] = T.tick(a, 2000);
  assert.equal(doneB, true);
  assert.ok(b.done && !T.isRunning(b));
  assert.equal(T.remaining(b), 0);
  assert.equal(T.tick(b, 5000)[1], false);
  // starting a finished tray restarts the full duration
  const r = T.start(b, 10_000);
  assert.equal(T.remaining(r, 10_000), 2000);
  assert.equal(r.done, false);
});

test("trays are independent", () => {
  const [a, b] = T.createTrays(2);
  const a2 = T.start(a, 0);
  assert.ok(T.isRunning(a2));
  assert.ok(!T.isRunning(b));
});

test("format", () => {
  assert.equal(T.format(5 * MIN), "05:00");
  assert.equal(T.format(0), "00:00");
  assert.equal(T.format(59_001), "01:00"); // rounds up partial seconds
  assert.equal(T.format(3_725_000), "1:02:05");
});

test("parseDuration", () => {
  assert.equal(T.parseDuration("5"), 5 * MIN);
  assert.equal(T.parseDuration("1:30"), 90_000);
  assert.equal(T.parseDuration("1:00:00"), 60 * MIN);
  assert.equal(T.parseDuration(" 10 "), 10 * MIN);
  for (const bad of ["", "0", "abc", "1:75", "-3", "1.5", "0:00"]) {
    assert.equal(T.parseDuration(bad), null, bad);
  }
});

test("setDuration clamps and resets", () => {
  let t = T.start(T.createTray(0), 0);
  t = T.setDuration(t, 10);
  assert.equal(t.durationMs, 1000);
  assert.ok(!T.isRunning(t));
});

test("restore accepts saved state and rejects garbage", () => {
  const trays = [T.start(T.createTray(0), 123), T.createTray(1)];
  assert.deepEqual(T.restore(JSON.stringify(trays)), trays);
  for (const bad of [null, "", "{", "[]", "{}", '[{"id":1}]']) {
    assert.equal(T.restore(bad), null, String(bad));
  }
});

// ---------- Orders mode ----------

test("trays have bake and pickup timers from settings", () => {
  const s = { timerMs: 60_000, bakeMs: 12 * MIN, pickupMs: 40 * MIN };
  const [t] = T.createTrays(1, s);
  assert.equal(t.durationMs, 60_000);
  assert.equal(T.remaining(t.bake), 12 * MIN);
  assert.equal(T.remaining(t.pickup), 40 * MIN);
});

test("toggleOrder starts and pauses bake + pickup together", () => {
  let t = T.toggleOrder(T.createTray(0), 0);
  assert.ok(T.isRunning(t.bake) && T.isRunning(t.pickup));
  assert.ok(!T.isRunning(t)); // Timer-mode timer untouched
  t = T.toggleOrder(t, 60_000);
  assert.ok(!T.orderRunning(t));
  assert.equal(T.remaining(t.bake), 19 * MIN);
  assert.equal(T.remaining(t.pickup), 29 * MIN);
  t = T.resetOrder(t);
  assert.equal(T.remaining(t.bake), 20 * MIN);
});

test("setEndAt makes a timer count down to a fixed moment", () => {
  const t = T.setEndAt(T.createTimer(5 * MIN), 100_000 + 45 * MIN, 100_000);
  assert.ok(T.isRunning(t));
  assert.equal(T.remaining(t, 100_000), 45 * MIN);
  assert.equal(T.progress(t, 100_000), 1); // clamped when longer than duration
});

test("parseClock picks the next occurrence", () => {
  const now = new Date(2026, 9, 9, 14, 0).getTime();
  assert.equal(T.parseClock("14:30", now), new Date(2026, 9, 9, 14, 30).getTime());
  assert.equal(T.parseClock("09:15", now), new Date(2026, 9, 10, 9, 15).getTime());
  for (const bad of ["", "25:00", "12:60", "noon", "1430"]) assert.equal(T.parseClock(bad, now), null, bad);
});

test("tickTray reports bake and pickup finishing separately", () => {
  let t = T.createTray(0, { timerMs: MIN, bakeMs: 2000, pickupMs: 5000 });
  t = T.toggleOrder(t, 0);
  let fin;
  [t, fin] = T.tickTray(t, 2000);
  assert.deepEqual(fin, ["bake"]);
  assert.ok(t.bake.done && T.isRunning(t.pickup));
  [t, fin] = T.tickTray(t, 3000);
  assert.deepEqual(fin, []);
  [t, fin] = T.tickTray(t, 5000);
  assert.deepEqual(fin, ["pickup"]);
  assert.ok(T.orderDone(t) && !T.orderRunning(t));
});

test("applyUniform sets every tray to the same times and stops them", () => {
  const trays = [T.toggleOrder(T.createTray(0), 0), T.start(T.createTray(1), 0)];
  const s = { timerMs: 2 * MIN, bakeMs: 15 * MIN, pickupMs: 25 * MIN };
  for (const t of T.applyUniform(trays, s)) {
    assert.ok(!T.isRunning(t) && !T.orderRunning(t));
    assert.equal(T.remaining(t), 2 * MIN);
    assert.equal(T.remaining(t.bake), 15 * MIN);
    assert.equal(T.remaining(t.pickup), 25 * MIN);
  }
});

test("restore upgrades trays saved before Orders mode", () => {
  const old = [{ id: "a", name: "Tray 1", durationMs: MIN, remainingMs: MIN, endAt: null, done: false }];
  const [t] = T.restore(JSON.stringify(old));
  assert.equal(T.remaining(t.bake), 20 * MIN);
  assert.equal(T.remaining(t.pickup), 30 * MIN);
});

test("restoreSettings falls back to defaults", () => {
  assert.deepEqual(T.restoreSettings(null), T.DEFAULT_SETTINGS);
  assert.deepEqual(T.restoreSettings("{bad"), T.DEFAULT_SETTINGS);
  assert.equal(T.restoreSettings('{"bakeMs":600000,"pickupMs":-1}').bakeMs, 600_000);
  assert.equal(T.restoreSettings('{"bakeMs":600000,"pickupMs":-1}').pickupMs, 30 * MIN);
});
