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
