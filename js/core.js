// Pure logic for BoxPing: box IDs, join links, alert messages, and the
// delivery log. No DOM and no network, so it runs in Node tests too.

export const TOPIC_RE = /^boxping-[A-Za-z0-9]{20}$/;
export const ID_RE = /^[A-Za-z0-9]{1,32}$/;
export const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
export const NAME_MAX = 40;
export const WHO_MAX = 24;
export const KEEP_DAYS = 120;
export const UNDO_WINDOW_MS = 30 * 60 * 1000;
export const NEAR_METERS = 60;

const B62 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const TAGS = { mail: "boxping-mail", empty: "boxping-empty", undo: "boxping-undo" };

/** A new unguessable box ID: "boxping-" + 20 base62 chars (~119 bits). */
export function newTopic(randomBytes = (n) => crypto.getRandomValues(new Uint8Array(n))) {
  let out = "";
  while (out.length < 20) {
    for (const b of randomBytes(32)) {
      if (b < 248 && out.length < 20) out += B62[b % 62]; // 248 = 4*62, no modulo bias
    }
  }
  return "boxping-" + out;
}

/** Plain single-line text: no control, zero-width or bidi-override characters. */
export function cleanText(value, max) {
  return String(value ?? "")
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max)
    .trim();
}

export const cleanName = (v) => cleanText(v, NAME_MAX);
export const cleanWho = (v) => cleanText(v, WHO_MAX);

/** The link a sticker's QR code opens. */
export function joinLink(base, topic, name) {
  if (!TOPIC_RE.test(topic)) throw new Error("bad box id");
  const n = cleanName(name);
  return `${base}#/box/${topic}` + (n ? `/${encodeURIComponent(n)}` : "");
}

/** Route from location.hash. Unknown or malformed routes go home. */
export function parseRoute(hash) {
  const parts = String(hash || "").replace(/^#\/?/, "").split("/");
  if (parts[0] === "new") return { view: "new" };
  if (parts[0] === "box" && TOPIC_RE.test(parts[1] || "")) {
    let name = "";
    try { name = cleanName(decodeURIComponent(parts.slice(2).join("/"))); } catch { name = ""; }
    return { view: "box", topic: parts[1], name };
  }
  return { view: "home" };
}

/** "YYYY-MM-DD" in the device's local time zone. */
export function localDay(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function isRealDay(s) {
  if (!DAY_RE.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d && y >= 2020;
}

/** Day string `n` days before `day` (calendar arithmetic, DST-safe). */
export function addDays(day, n) {
  const [y, m, d] = day.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

export function weekday(day) {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

// ---- Messages sent through ntfy.sh -------------------------------------
// The first line of every message is "<Verb> by <name>", so other devices
// can read who reported it. Mail alerts also carry the sender's recent mail
// days so a phone that missed earlier alerts can fill its log.

function base(kind, { topic, boxName, url }) {
  if (!TOPIC_RE.test(topic)) throw new Error("bad box id");
  const msg = { topic, tags: kind.tags, priority: kind.priority, title: `${kind.title}: ${cleanName(boxName) || "your box"}` };
  if (url) msg.click = url;
  return msg;
}

export function buildMail({ topic, boxName, who, recentDays = [], url }) {
  const msg = base({ title: "Mail's in", tags: ["mailbox_with_mail", TAGS.mail], priority: 4 }, { topic, boxName, url });
  const days = [...new Set(recentDays.filter(isRealDay))].sort().slice(-14);
  msg.message = `Spotted by ${cleanWho(who) || "a neighbour"}` + (days.length ? `\nRecent mail days: ${days.join(", ")}` : "");
  return msg;
}

export function buildEmpty({ topic, boxName, who, url }) {
  const msg = base({ title: "Box was empty", tags: ["mailbox_with_no_mail", TAGS.empty], priority: 2 }, { topic, boxName, url });
  msg.message = `Checked by ${cleanWho(who) || "a neighbour"}`;
  return msg;
}

export function buildUndo({ topic, boxName, who, refId, url }) {
  if (!ID_RE.test(refId || "")) throw new Error("bad ref");
  const msg = base({ title: "False alarm", tags: ["x", TAGS.undo], priority: 2 }, { topic, boxName, url });
  msg.message = `Retracted by ${cleanWho(who) || "a neighbour"}\nThe earlier "Mail's in" was a mistake.\nRef: ${refId}`;
  return msg;
}

/**
 * Turn a raw ntfy event (untrusted: anyone who knows the box ID can post)
 * into a log entry, or null if it isn't a well-formed BoxPing message.
 */
export function parseEvent(ev, topic) {
  if (!ev || typeof ev !== "object" || ev.event !== "message") return null;
  if (topic && ev.topic !== topic) return null;
  if (typeof ev.id !== "string" || !ID_RE.test(ev.id)) return null;
  if (typeof ev.time !== "number" || !Number.isFinite(ev.time) || ev.time < 1.5e9) return null;
  const tags = Array.isArray(ev.tags) ? ev.tags : [];
  const kind = Object.keys(TAGS).find((k) => tags.includes(TAGS[k]));
  if (!kind) return null;
  const text = typeof ev.message === "string" ? ev.message.slice(0, 2000) : "";
  const first = text.split("\n")[0];
  const m = /^(?:Spotted|Checked|Retracted) by (.+)$/.exec(first);
  const out = { id: ev.id, time: Math.floor(ev.time) * 1000, kind, who: cleanWho(m ? m[1] : "") || "a neighbour" };
  if (kind === "undo") {
    const r = /^Ref: ([A-Za-z0-9]{1,32})$/m.exec(text);
    if (!r) return null;
    out.ref = r[1];
  }
  if (kind === "mail") {
    const r = /^Recent mail days: ([0-9, -]{0,200})$/m.exec(text);
    const latest = localDay(out.time);
    out.days = r ? [...new Set(r[1].split(",").map((s) => s.trim()))].filter((d) => isRealDay(d) && d < latest).slice(-14) : [];
  }
  return out;
}

// ---- The per-device log --------------------------------------------------

export function emptyLog() {
  return { events: {}, backfill: [] };
}

/** Rebuild a stored log from a fixed schema, dropping anything odd or old. */
export function sanitizeLog(raw, now = Date.now()) {
  const log = emptyLog();
  if (!raw || typeof raw !== "object") return log;
  const cutoff = now - KEEP_DAYS * 864e5;
  const evs = raw.events && typeof raw.events === "object" ? Object.values(raw.events) : [];
  for (const e of evs.slice(-600)) {
    if (!e || !ID_RE.test(e.id || "") || !["mail", "empty", "undo"].includes(e.kind)) continue;
    if (typeof e.time !== "number" || !Number.isFinite(e.time) || e.time < cutoff || e.time > now + 864e5) continue;
    const c = { id: e.id, time: e.time, kind: e.kind, who: cleanWho(e.who) || "a neighbour" };
    if (e.kind === "undo") { if (!ID_RE.test(e.ref || "")) continue; c.ref = e.ref; }
    log.events[c.id] = c;
  }
  const minDay = localDay(cutoff);
  log.backfill = [...new Set(Array.isArray(raw.backfill) ? raw.backfill : [])].filter((d) => typeof d === "string" && isRealDay(d) && d >= minDay).sort();
  return log;
}

/** Add parsed events to a log. Returns the ones that were new. */
export function addEvents(log, parsed) {
  const fresh = [];
  for (const e of parsed) {
    if (!e || log.events[e.id]) continue;
    const { days, ...stored } = e;
    log.events[e.id] = stored;
    fresh.push(e);
    if (days && days.length) log.backfill = [...new Set([...log.backfill, ...days])].sort();
  }
  return fresh;
}

/** Events in time order with retracted mail alerts removed. */
export function liveEvents(log) {
  const all = Object.values(log.events).sort((a, b) => a.time - b.time);
  const retracted = new Set(all.filter((e) => e.kind === "undo").map((e) => e.ref));
  return all.filter((e) => e.kind !== "undo" && !(e.kind === "mail" && retracted.has(e.id)));
}

/** Map of day → "mail" | "empty". Mail wins over an empty check the same day. */
export function dayStatus(log) {
  const out = {};
  for (const d of log.backfill) out[d] = "mail";
  for (const e of liveEvents(log)) {
    const d = localDay(e.time);
    if (e.kind === "mail") out[d] = "mail";
    else if (!out[d]) out[d] = "empty";
  }
  return out;
}

/** What happened today: the first mail sighting, else the latest empty check. */
export function today(log, now = Date.now()) {
  const day = localDay(now);
  const evs = liveEvents(log).filter((e) => localDay(e.time) === day);
  const mail = evs.find((e) => e.kind === "mail");
  if (mail) return { state: "mail", event: mail };
  const empties = evs.filter((e) => e.kind === "empty");
  if (empties.length) return { state: "empty", event: empties[empties.length - 1] };
  return { state: "none" };
}

/** Mail days in the 14 days before today, to share in a new alert. */
export function recentMailDays(log, now = Date.now()) {
  const day = localDay(now);
  const from = addDays(day, -14);
  return Object.entries(dayStatus(log)).filter(([d, s]) => s === "mail" && d >= from && d < day).map(([d]) => d).sort();
}

/**
 * Calendar grid for the last `weeks` weeks (Sunday-first rows), plus stats
 * counted only from the day this device started following the box.
 */
export function history(log, { now = Date.now(), since = now, weeks = 8 } = {}) {
  const status = dayStatus(log);
  const todayStr = localDay(now);
  const start = addDays(todayStr, -(weekday(todayStr) + 7 * (weeks - 1)));
  const sinceStr = [localDay(since), ...log.backfill].sort()[0];
  const rows = [];
  const perWeekday = [0, 0, 0, 0, 0, 0, 0];
  const seenWeekday = [0, 0, 0, 0, 0, 0, 0];
  let mailDays = 0, trackedDays = 0;
  for (let w = 0; w < weeks; w++) {
    const row = [];
    for (let i = 0; i < 7; i++) {
      const d = addDays(start, w * 7 + i);
      const future = d > todayStr;
      const tracked = !future && d >= sinceStr;
      const s = status[d] || (tracked ? "none" : "untracked");
      row.push({ day: d, status: future ? "future" : s });
      if (tracked) {
        trackedDays++;
        seenWeekday[i]++;
        if (s === "mail") { mailDays++; perWeekday[i]++; }
      }
    }
    rows.push(row);
  }
  const trackedWeeks = trackedDays / 7;
  const usual = perWeekday
    .map((n, i) => ({ i, n, rate: seenWeekday[i] ? n / seenWeekday[i] : 0 }))
    .filter((x) => x.n >= 2 && x.rate >= 0.5)
    .map((x) => x.i);
  return {
    rows,
    mailDays,
    trackedDays,
    perWeek: trackedWeeks >= 1 ? Math.round((mailDays / trackedWeeks) * 10) / 10 : null,
    perWeekday,
    usual,
  };
}

/** Distance in metres between two {lat, lon} points (haversine). */
export function distanceM(a, b) {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function validLoc(l) {
  return !!l && typeof l === "object" && Number.isFinite(l.lat) && Number.isFinite(l.lon) && Math.abs(l.lat) <= 90 && Math.abs(l.lon) <= 180;
}

/** Rebuild the stored box list from a fixed schema. */
export function sanitizeBoxes(raw) {
  const out = [];
  const seen = new Set();
  for (const b of Array.isArray(raw) ? raw.slice(0, 50) : []) {
    if (!b || !TOPIC_RE.test(b.topic || "") || seen.has(b.topic)) continue;
    seen.add(b.topic);
    const box = {
      topic: b.topic,
      name: cleanName(b.name) || "Our mailbox",
      joinedAt: Number.isFinite(b.joinedAt) ? b.joinedAt : Date.now(),
      mine: (Array.isArray(b.mine) ? b.mine : []).filter((x) => x && ID_RE.test(x.id || "") && Number.isFinite(x.time)).slice(-20).map((x) => ({ id: x.id, time: x.time })),
      nearby: b.nearby === true,
    };
    if (validLoc(b.loc)) box.loc = { lat: b.loc.lat, lon: b.loc.lon };
    out.push(box);
  }
  return out;
}

export const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
