import test from "node:test";
import assert from "node:assert/strict";
import * as C from "../js/core.js";

const T = "boxping-" + "a".repeat(20);
const at = (y, m, d, hh = 11, mm = 0) => new Date(y, m - 1, d, hh, mm).getTime();
const ev = (id, kind, time, message, extra = {}) => ({
  id, time: Math.floor(time / 1000), event: "message", topic: T,
  tags: { mail: ["mailbox_with_mail", "boxping-mail"], empty: ["boxping-empty"], undo: ["x", "boxping-undo"] }[kind],
  message, ...extra,
});

test("newTopic is valid, random and unbiased-looking", () => {
  const seen = new Set();
  for (let i = 0; i < 200; i++) {
    const t = C.newTopic();
    assert.match(t, C.TOPIC_RE);
    seen.add(t);
  }
  assert.equal(seen.size, 200);
  // Bytes >= 248 are rejected, so a stream of 255s then 0s still yields "A"s.
  let calls = 0;
  const t = C.newTopic(() => (calls++ === 0 ? new Uint8Array(32).fill(255) : new Uint8Array(32)));
  assert.equal(t, "boxping-" + "A".repeat(20));
});

test("cleanText strips control, bidi and zero-width characters and caps length", () => {
  assert.equal(C.cleanText(" a‮\nb​ c\u0000 ", 40), "a b c");
  assert.equal(C.cleanName("x".repeat(100)).length, C.NAME_MAX);
  assert.equal(C.cleanWho(null), "");
});

test("join links round-trip through parseRoute", () => {
  const link = C.joinLink("https://example.test/boxping/", T, "Birch Lane / box B");
  assert.ok(link.startsWith("https://example.test/boxping/#/box/" + T + "/"));
  const r = C.parseRoute(link.slice(link.indexOf("#")));
  assert.deepEqual(r, { view: "box", topic: T, name: "Birch Lane / box B" });
  assert.throws(() => C.joinLink("x", "bad", "n"));
});

test("parseRoute rejects bad topics and malformed names", () => {
  assert.deepEqual(C.parseRoute("#/box/boxping-short"), { view: "home" });
  assert.deepEqual(C.parseRoute("#/box/../etc"), { view: "home" });
  assert.deepEqual(C.parseRoute("#/new"), { view: "new" });
  assert.deepEqual(C.parseRoute(""), { view: "home" });
  assert.equal(C.parseRoute(`#/box/${T}/%E0%A4%A`).name, ""); // bad escape
  assert.equal(C.parseRoute(`#/box/${T}/${encodeURIComponent("<img src=x>‮")}`).name, "<img src=x>");
});

test("day helpers handle month ends and leap years", () => {
  assert.equal(C.addDays("2028-02-28", 1), "2028-02-29");
  assert.equal(C.addDays("2026-03-01", -1), "2026-02-28");
  assert.equal(C.weekday("2026-11-21"), 6);
  assert.ok(C.isRealDay("2028-02-29"));
  assert.ok(!C.isRealDay("2026-02-30"));
  assert.ok(!C.isRealDay("1999-01-01"));
  assert.equal(C.localDay(at(2026, 11, 21, 23, 59)), "2026-11-21");
});

test("built messages parse back", () => {
  const mail = C.buildMail({ topic: T, boxName: "Birch B", who: "Sam", recentDays: ["2026-11-18", "bad", "2026-11-16", "2026-11-18"], url: "https://x/#/box/" + T });
  assert.equal(mail.title, "Mail's in: Birch B");
  assert.equal(mail.priority, 4);
  assert.ok(mail.tags.includes("boxping-mail"));
  assert.equal(mail.message, "Spotted by Sam\nRecent mail days: 2026-11-16, 2026-11-18");
  const p = C.parseEvent({ ...mail, id: "abc123", time: at(2026, 11, 20) / 1000, event: "message" }, T);
  assert.equal(p.kind, "mail");
  assert.equal(p.who, "Sam");
  assert.deepEqual(p.days, ["2026-11-16", "2026-11-18"]);

  const empty = C.buildEmpty({ topic: T, boxName: "", who: "" });
  assert.equal(empty.title, "Box was empty: your box");
  assert.equal(C.parseEvent({ ...empty, id: "e1", time: 1.8e9, event: "message" }).who, "a neighbour");

  const undo = C.buildUndo({ topic: T, boxName: "B", who: "Sam", refId: "abc123" });
  assert.equal(C.parseEvent({ ...undo, id: "u1", time: 1.8e9, event: "message" }).ref, "abc123");
  assert.throws(() => C.buildUndo({ topic: T, refId: "bad id!" }));
});

test("parseEvent rejects junk and foreign messages", () => {
  assert.equal(C.parseEvent(null), null);
  assert.equal(C.parseEvent({ event: "open", id: "a", time: 1.8e9 }), null);
  assert.equal(C.parseEvent(ev("a", "mail", at(2026, 11, 20), "hi", { tags: ["other"] })), null);
  assert.equal(C.parseEvent(ev("bad id", "mail", at(2026, 11, 20), "hi")), null);
  assert.equal(C.parseEvent(ev("a", "mail", at(2026, 11, 20), "hi"), "boxping-" + "b".repeat(20)), null);
  assert.equal(C.parseEvent(ev("a", "undo", at(2026, 11, 20), "Retracted by x")), null); // no ref
  assert.equal(C.parseEvent({ ...ev("a", "mail", at(2026, 11, 20), "x"), time: "soon" }), null);
  // Days on/after the message's own day, or impossible dates, are dropped.
  const p = C.parseEvent(ev("a", "mail", at(2026, 11, 20), "Spotted by Z\nRecent mail days: 2026-11-19, 2026-11-20, 2026-11-31, 2027-01-01"));
  assert.deepEqual(p.days, ["2026-11-19"]);
  assert.equal(C.parseEvent(ev("b", "mail", at(2026, 11, 20), "no first line format")).who, "a neighbour");
});

test("log: dedupe, retraction, backfill, today and recent days", () => {
  const now = at(2026, 11, 20, 15);
  const log = C.emptyLog();
  const raws = [
    ev("m1", "mail", at(2026, 11, 20, 11, 42), "Spotted by Sam\nRecent mail days: 2026-11-16, 2026-11-18"),
    ev("e1", "empty", at(2026, 11, 20, 9), "Checked by Ana"),
    ev("m0", "mail", at(2026, 11, 20, 10), "Spotted by Bo"),
    ev("u0", "undo", at(2026, 11, 20, 10, 5), "Retracted by Bo\nRef: m0"),
  ];
  const fresh = C.addEvents(log, raws.map((r) => C.parseEvent(r, T)));
  assert.equal(fresh.length, 4);
  assert.equal(C.addEvents(log, raws.map((r) => C.parseEvent(r, T))).length, 0);
  const t = C.today(log, now);
  assert.equal(t.state, "mail");
  assert.equal(t.event.id, "m1");
  const st = C.dayStatus(log);
  assert.equal(st["2026-11-16"], "mail");
  assert.equal(st["2026-11-20"], "mail");
  assert.deepEqual(C.recentMailDays(log, now), ["2026-11-16", "2026-11-18"]);
  assert.ok(!C.liveEvents(log).some((e) => e.id === "m0" || e.kind === "undo"));
});

test("today: empty check only, and nothing", () => {
  const log = C.emptyLog();
  assert.equal(C.today(log).state, "none");
  C.addEvents(log, [C.parseEvent(ev("e1", "empty", at(2026, 11, 20, 9), "Checked by Ana"))]);
  assert.equal(C.today(log, at(2026, 11, 20, 12)).state, "empty");
  assert.equal(C.today(log, at(2026, 11, 21, 12)).state, "none");
});

test("history grid and stats", () => {
  const now = at(2026, 11, 21, 12); // Saturday
  const log = C.emptyLog();
  // Mail Mon/Wed/Fri for the last 3 weeks.
  const days = [];
  for (const d of ["2026-11-02", "2026-11-04", "2026-11-06", "2026-11-09", "2026-11-11", "2026-11-13", "2026-11-16", "2026-11-18", "2026-11-20"]) days.push(d);
  log.backfill = days;
  const hst = C.history(log, { now, since: at(2026, 11, 1, 8), weeks: 8 });
  assert.equal(hst.rows.length, 8);
  assert.equal(hst.rows[7][6].day, "2026-11-21");
  assert.equal(hst.rows[7][6].status, "none");
  assert.equal(hst.rows[0][0].status, "untracked");
  assert.equal(hst.mailDays, 9);
  assert.equal(hst.trackedDays, 21);
  assert.equal(hst.perWeek, 3);
  assert.deepEqual(hst.usual, [1, 3, 5]);
  // Backfilled days before joining extend the tracked window.
  const h2 = C.history(log, { now, since: now });
  assert.equal(h2.trackedDays, 20);
});

test("sanitizeLog and sanitizeBoxes rebuild from a fixed schema", () => {
  const now = at(2026, 11, 20, 12);
  const raw = {
    events: {
      ok: { id: "ok", time: now - 1000, kind: "mail", who: "S‮am", extra: 1 },
      old: { id: "old", time: now - 200 * 864e5, kind: "mail", who: "x" },
      bad: { id: "b ad", time: now, kind: "mail" },
      weird: { id: "w", time: now, kind: "party" },
      undo: { id: "u", time: now, kind: "undo" },
      __proto__: { polluted: true },
    },
    backfill: ["2026-11-18", "2026-11-18", "nope", "2020-01-01", 5],
  };
  const log = C.sanitizeLog(raw, now);
  assert.deepEqual(Object.keys(log.events), ["ok"]);
  assert.equal(log.events.ok.who, "S am");
  assert.equal(log.events.ok.extra, undefined);
  assert.deepEqual(log.backfill, ["2026-11-18"]);
  assert.deepEqual(C.sanitizeLog("garbage"), C.emptyLog());

  const boxes = C.sanitizeBoxes([
    { topic: T, name: "", joinedAt: 5, mine: [{ id: "a", time: 1 }, { id: "bad id", time: 2 }], loc: { lat: 45, lon: -75 }, nearby: true },
    { topic: T, name: "dupe" },
    { topic: "nope" },
    { topic: "boxping-" + "b".repeat(20), name: "B", loc: { lat: 200, lon: 0 } },
  ]);
  assert.equal(boxes.length, 2);
  assert.equal(boxes[0].name, "Our mailbox");
  assert.deepEqual(boxes[0].mine, [{ id: "a", time: 1 }]);
  assert.deepEqual(boxes[0].loc, { lat: 45, lon: -75 });
  assert.equal(boxes[1].loc, undefined);
  assert.equal(boxes[1].nearby, false);
  assert.deepEqual(C.sanitizeBoxes("x"), []);
});

test("distanceM is roughly right", () => {
  const a = { lat: 45.4215, lon: -75.6972 };
  assert.equal(Math.round(C.distanceM(a, a)), 0);
  const b = { lat: 45.4224, lon: -75.6972 }; // ~100 m north
  assert.ok(Math.abs(C.distanceM(a, b) - 100) < 2);
});

test("security: an undo only retracts an alert within the undo window", () => {
  const mail = C.parseEvent(ev("real", "mail", at(2026, 11, 20, 10), "Spotted by Sam"));
  const late = C.parseEvent(ev("late", "undo", at(2026, 11, 23, 10), "Retracted by Mallory\nRef: real"));
  const early = C.parseEvent(ev("early", "undo", at(2026, 11, 20, 9), "Retracted by Mallory\nRef: real"));
  const log = C.emptyLog();
  C.addEvents(log, [mail, late, early]);
  assert.equal(C.liveEvents(log).length, 1);
  C.addEvents(log, [C.parseEvent(ev("ok", "undo", at(2026, 11, 20, 10, 20), "Retracted by Sam\nRef: real"))]);
  assert.equal(C.liveEvents(log).length, 0);
});

test("security: a message flood can't grow the stored log without limit", () => {
  const log = C.emptyLog();
  const now = Date.now();
  const flood = [];
  for (let i = 0; i < 5000; i++) flood.push(C.parseEvent(ev("f" + i, "mail", now - i * 1000, "Spotted by z")));
  C.addEvents(log, flood);
  assert.equal(Object.keys(log.events).length, C.MAX_EVENTS);
  assert.ok(log.events.f0, "newest kept");
  assert.ok(!log.events.f4999, "oldest dropped");
});

test("security: backfill days must be within two weeks of the alert", () => {
  const p = C.parseEvent(ev("a", "mail", at(2026, 11, 20), "Spotted by Z\nRecent mail days: 2025-01-06, 2026-11-01, 2026-11-05, 2026-11-19"));
  assert.deepEqual(p.days, ["2026-11-05", "2026-11-19"]);
});

test("security: network IDs can't collide with Object.prototype", () => {
  const log = C.emptyLog();
  const fresh = C.addEvents(log, [C.parseEvent(ev("constructor", "mail", at(2026, 11, 20), "Spotted by Z"))]);
  assert.equal(fresh.length, 1);
  assert.equal(Object.getPrototypeOf(C.sanitizeLog({ events: { a: { id: "a", time: Date.now(), kind: "mail" } } }).events), null);
});
