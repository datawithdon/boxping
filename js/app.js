// BoxPing UI: a hash-routed single page. All text is rendered with
// textContent / DOM APIs, never innerHTML, because box names and reporter
// names come from links and from ntfy.sh, which anyone can post to.

import * as C from "./core.js";
import * as N from "./ntfy.js";

// Refuse to run inside another site's frame (GitHub Pages can't send
// frame-ancestors headers).
if (window.top !== window.self) {
  document.body.textContent = "BoxPing can't run inside another site.";
  throw new Error("framed");
}

// ---- Storage (per device; every read is rebuilt from a fixed schema) ----

const store = {
  get(key, fallback) {
    try { const v = localStorage.getItem("boxping:" + key); return v == null ? fallback : JSON.parse(v); } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem("boxping:" + key, JSON.stringify(value)); return true; } catch { return false; }
  },
  del(key) { try { localStorage.removeItem("boxping:" + key); } catch { /* ignore */ } },
};

let boxes = C.sanitizeBoxes(store.get("boxes", []));
let me = C.cleanWho(store.get("me", ""));
const saveBoxes = () => store.set("boxes", boxes);
const findBox = (topic) => boxes.find((b) => b.topic === topic);
const loadLog = (topic) => C.sanitizeLog(store.get("log:" + topic, null));
const saveLog = (topic, log) => store.set("log:" + topic, log);

const BASE = location.origin + location.pathname;
const boxUrl = (box) => C.joinLink(BASE, box.topic, box.name);

// ---- Tiny DOM helpers ----

function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "text") el.textContent = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid instanceof Node ? kid : String(kid));
  return el;
}

const view = document.getElementById("view");
const toastEl = document.getElementById("toast");
let toastTimer;
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.add("hidden"), 3500);
}

const fmtTime = (ms) => new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const fmtDay = (ms) => new Date(ms).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });

function todayLine(t) {
  if (t.state === "mail") return `Mail's in. ${t.event.who} spotted it at ${fmtTime(t.event.time)}.`;
  if (t.state === "empty") return `Checked at ${fmtTime(t.event.time)} by ${t.event.who}: nothing yet.`;
  return "No report yet today.";
}

// ---- Notifications (only while BoxPing is open; the ntfy app covers the rest) ----

async function notify(title, body, url) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const opts = { body, icon: "icons/icon.svg", badge: "icons/icon.svg", tag: "boxping", data: { url } };
  try {
    const reg = await navigator.serviceWorker?.ready;
    if (reg) return await reg.showNotification(title, opts);
  } catch { /* fall back */ }
  try { new Notification(title, opts); } catch { /* not supported here */ }
}

// ---- Router ----

let cleanups = [];
function render() {
  cleanups.forEach((f) => { try { f(); } catch { /* ignore */ } });
  cleanups = [];
  const route = C.parseRoute(location.hash);
  view.replaceChildren();
  if (route.view === "new") renderNew();
  else if (route.view === "box") renderBox(route);
  else renderHome();
  window.scrollTo(0, 0);
}
window.addEventListener("hashchange", render);

// ---- Home ----

function renderHome() {
  document.title = "BoxPing";
  const list = boxes.length
    ? h("ul", { class: "box-list" }, boxes.map((b) => h("li", {},
        h("a", { class: "box-card", href: `#/box/${b.topic}` },
          h("span", { class: "box-card-name", text: b.name }),
          h("span", { class: "muted", text: todayLine(C.today(loadLog(b.topic))) })))))
    : null;

  const nameInput = h("input", { id: "me", type: "text", maxlength: C.WHO_MAX, autocomplete: "given-name", placeholder: "e.g. Sam (optional)", value: me });
  nameInput.addEventListener("change", () => { me = C.cleanWho(nameInput.value); nameInput.value = me; store.set("me", me); toast("Saved."); });

  view.append(
    h("section", { class: "hero" },
      h("h1", { text: "Know when the mail's in." }),
      h("p", { class: "lead", text: "For neighbours who share a community mailbox. Whoever sees the carrier taps one button, and everyone else on the box gets a ping." })),
    boxes.length ? h("section", { class: "card" }, h("h2", { text: "Your boxes" }), list) : null,
    h("section", { class: "card" },
      h("h2", { text: boxes.length ? "Add another box" : "Get started" }),
      h("p", { text: "Got a BoxPing sticker on your mailbox? Point your phone camera at it to join." }),
      h("p", { text: "No sticker yet? Make one for your box. It takes a minute." }),
      h("a", { class: "btn", href: "#/new", text: "Set up a box" })),
    h("section", { class: "card" },
      h("h2", { text: "How it works" }),
      h("ol", { class: "steps" },
        h("li", { text: "One neighbour sets up the box and prints a QR sticker for it." }),
        h("li", { text: "Neighbours scan the sticker to join. No account or sign-up." }),
        h("li", { text: "When someone sees the carrier, they tap “Mail's in”. Everyone else gets an alert." }),
        h("li", { text: "BoxPing logs which days mail actually came, so you can see the pattern." }))),
    h("section", { class: "card" },
      h("h2", { text: "Your name" }),
      h("label", { for: "me", text: "Shown to neighbours when you send an alert" }),
      nameInput,
      h("p", { class: "muted small", text: "Your boxes, name and log stay on this device. Alerts are relayed by ntfy.sh, a free open-source push service." })),
  );
}

// ---- New box ----

function renderNew() {
  document.title = "Set up a box · BoxPing";
  const name = h("input", { id: "boxname", type: "text", required: true, maxlength: C.NAME_MAX, placeholder: "e.g. Birch Lane box B" });
  const who = h("input", { id: "who", type: "text", maxlength: C.WHO_MAX, autocomplete: "given-name", placeholder: "e.g. Sam (optional)", value: me });
  const form = h("form", { class: "card", novalidate: true },
    h("h1", { text: "Set up a box" }),
    h("label", { for: "boxname", text: "What do neighbours call this mailbox?" }),
    name,
    h("p", { class: "hint", text: "Anyone who sees the sticker can read this name, so leave out unit numbers and full addresses." }),
    h("label", { for: "who", text: "Your first name or nickname" }),
    who,
    h("div", { class: "row" },
      h("button", { class: "btn", type: "submit", text: "Create box" }),
      h("a", { class: "btn ghost", href: "#/", text: "Cancel" })));
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const n = C.cleanName(name.value);
    if (!n) { name.focus(); toast("Give the box a name first."); return; }
    me = C.cleanWho(who.value) || me;
    store.set("me", me);
    const topic = C.newTopic();
    boxes.push({ topic, name: n, joinedAt: Date.now(), mine: [], nearby: false });
    saveBoxes();
    location.hash = `#/box/${topic}`;
    setTimeout(() => toast("Box created. Print the sticker below and put it on the mailbox."), 50);
  });
  view.append(form);
  name.focus();
}

// ---- Box ----

function renderBox(route) {
  const box = findBox(route.topic);
  if (!box) return renderJoin(route);
  document.title = `${box.name} · BoxPing`;

  let log = loadLog(box.topic);
  let sending = false; // our own alert can echo back on the live stream before publish() returns
  const ingest = (raws, { live = false } = {}) => {
    const fresh = C.addEvents(log, raws.map((r) => C.parseEvent(r, box.topic)));
    if (!fresh.length) return;
    saveLog(box.topic, log);
    update();
    if (!live) return;
    const mine = new Set(box.mine.map((m) => m.id));
    for (const e of fresh) {
      if (mine.has(e.id) || e.kind !== "mail" || sending) continue;
      if (document.hidden) notify(`Mail's in: ${box.name}`, `${e.who} spotted the carrier at ${fmtTime(e.time)}.`, boxUrl(box));
      else { toast(`\u{1F4EC} ${e.who} says mail's in!`); navigator.vibrate?.(200); }
    }
  };

  // Header + live status
  const status = h("span", { class: "live", text: "Connecting…" });
  const header = h("header", { class: "box-head" }, h("h1", { text: box.name }), status);

  // Today + actions
  const todayEl = h("p", { class: "today", "aria-live": "polite" });
  const pingBtn = h("button", { class: "ping", type: "button" }, h("span", { class: "ping-emoji", "aria-hidden": "true", text: "\u{1F4EC}" }), h("span", { text: "Mail's in" }));
  const emptyBtn = h("button", { class: "btn ghost", type: "button", text: "I checked: it's empty" });
  const undoEl = h("div", { class: "undo hidden" });
  const nearEl = h("div", { class: "near hidden", role: "status" });

  async function send(build, extra, okMsg) {
    pingBtn.disabled = emptyBtn.disabled = true;
    sending = true;
    try {
      const res = await N.publish(build({ topic: box.topic, boxName: box.name, who: me, url: boxUrl(box), ...extra }));
      if (res && C.ID_RE.test(res.id || "")) {
        box.mine = [...box.mine, { id: res.id, time: Date.now() }].slice(-20);
        saveBoxes();
        ingest([res]);
      }
      toast(okMsg);
      update();
    } catch (err) {
      toast(err.message || "Couldn't send. Try again.");
    } finally {
      sending = false;
      pingBtn.disabled = emptyBtn.disabled = false;
    }
  }

  pingBtn.addEventListener("click", () => {
    const t = C.today(log);
    if (t.state === "mail" && !confirm(`${t.event.who} already reported mail at ${fmtTime(t.event.time)}. Send another alert anyway?`)) return;
    send(C.buildMail, { recentDays: C.recentMailDays(log) }, "Sent. Your neighbours have been pinged.");
  });
  emptyBtn.addEventListener("click", () => send(C.buildEmpty, {}, "Logged as empty. Neighbours get a quiet note."));

  // Log
  const logEl = h("div");

  function update() {
    const t = C.today(log);
    todayEl.textContent = todayLine(t);
    todayEl.dataset.state = t.state;

    // Undo my own mail alert for 30 minutes, if it hasn't been undone already.
    const undone = new Set(Object.values(log.events).filter((e) => e.kind === "undo").map((e) => e.ref));
    const last = [...box.mine].reverse().find((m) => log.events[m.id]?.kind === "mail" && !undone.has(m.id) && Date.now() - m.time < C.UNDO_WINDOW_MS);
    undoEl.replaceChildren();
    undoEl.classList.toggle("hidden", !last);
    if (last) {
      undoEl.append(
        h("span", { text: `You sent "Mail's in" at ${fmtTime(last.time)}.` }),
        h("button", { class: "link", type: "button", text: "False alarm? Undo", onclick: () => send(C.buildUndo, { refId: last.id }, "Undone. Neighbours were told it was a false alarm.") }));
    }

    renderLog(logEl, log, box);
  }

  // Alerts section
  const links = N.followLinks(box.topic);
  const notifBtn = h("button", { class: "btn ghost", type: "button" });
  const setNotifLabel = () => {
    const p = "Notification" in window ? Notification.permission : "unsupported";
    notifBtn.textContent = p === "granted" ? "Send a test notification" : p === "denied" ? "Notifications are blocked in this browser" : p === "unsupported" ? "This browser can't show notifications" : "Turn on alerts in this browser";
    notifBtn.disabled = p === "denied" || p === "unsupported";
  };
  setNotifLabel();
  notifBtn.addEventListener("click", async () => {
    if (Notification.permission === "default") await Notification.requestPermission();
    setNotifLabel();
    if (Notification.permission === "granted") notify("BoxPing test", `Alerts for ${box.name} will look like this.`, boxUrl(box));
  });
  const topicCode = h("code", { class: "topic", text: box.topic });

  const alerts = h("section", { class: "card" },
    h("h2", { text: "Get alerts when BoxPing is closed" }),
    h("p", { text: "BoxPing uses the free ntfy app for alerts in the background. Set it up once:" }),
    h("ol", { class: "steps" },
      h("li", {}, "Install ", h("strong", { text: "ntfy" }), " from the App Store or Google Play (free, no account)."),
      h("li", {}, "Tap ", h("strong", { text: "+" }), " to subscribe and paste this box's topic: ", topicCode, " ",
        h("button", { class: "link", type: "button", text: "Copy", onclick: () => copy(box.topic, "Topic copied.") })),
      h("li", { text: "That's it. You'll get a ping whenever a neighbour taps “Mail's in”." })),
    h("div", { class: "row" },
      h("a", { class: "btn ghost", href: links.android, text: "Open in ntfy (Android)" }),
      h("a", { class: "btn ghost", href: links.web, target: "_blank", rel: "noopener noreferrer", text: "Use ntfy in a browser" })),
    h("p", { class: "muted small" }, "On a computer, the ntfy web app can show alerts too. ", h("a", { href: links.docs, target: "_blank", rel: "noopener noreferrer", text: "ntfy setup help" })),
    h("h3", { text: "While BoxPing is open" }),
    notifBtn);

  // Sticker section
  const link = boxUrl(box);
  const sticker = stickerEl(box, link);
  const stickerCard = h("section", { class: "card" },
    h("h2", { text: "Sticker and invite" }),
    h("p", { text: "Print this and tape it inside the lid or next to the box. Neighbours scan it with their camera to join." }),
    sticker,
    h("div", { class: "row" },
      h("button", { class: "btn", type: "button", text: "Print sticker", onclick: () => printSticker(box, link) }),
      h("button", { class: "btn ghost", type: "button", text: "Copy invite link", onclick: () => copy(link, "Invite link copied.") }),
      navigator.share ? h("button", { class: "btn ghost", type: "button", text: "Share", onclick: () => navigator.share({ title: `BoxPing: ${box.name}`, text: "Get a ping when the mail's in at our community mailbox.", url: link }).catch(() => {}) }) : null),
    h("p", { class: "muted small", text: "Anyone with the sticker or link can send and see alerts for this box. Don't put personal details in the box name." }));

  // Location section (optional, stays on this device)
  const nearbyToggle = h("input", { type: "checkbox", id: "nearby" });
  nearbyToggle.checked = box.nearby && !!box.loc;
  nearbyToggle.disabled = !box.loc;
  const locLine = h("p", { class: "muted small", text: box.loc ? "Box location saved on this device." : "No location saved yet." });
  const locCard = h("section", { class: "card" },
    h("h2", { text: "At the box" }),
    h("p", { text: "Save where the box is, and BoxPing will ask “Anything in?” when you open it nearby. The location stays on this phone." }),
    h("button", { class: "btn ghost", type: "button", text: "I'm at the box: save this spot", onclick: saveSpot }),
    locLine,
    h("label", { class: "check", for: "nearby" }, nearbyToggle, " Ask me when I open BoxPing near the box"));
  nearbyToggle.addEventListener("change", () => { box.nearby = nearbyToggle.checked; saveBoxes(); watchNearby(); });

  function saveSpot() {
    if (!navigator.geolocation) return toast("This browser can't share location.");
    navigator.geolocation.getCurrentPosition((p) => {
      if (p.coords.accuracy > 150) return toast("Location is too rough right now. Try again outside.");
      box.loc = { lat: p.coords.latitude, lon: p.coords.longitude };
      box.nearby = true;
      saveBoxes();
      nearbyToggle.disabled = false;
      nearbyToggle.checked = true;
      locLine.textContent = "Box location saved on this device.";
      toast("Saved. BoxPing will ask when you're here.");
      watchNearby();
    }, () => toast("Couldn't get your location."), { enableHighAccuracy: true, timeout: 15000 });
  }

  let watchId = null;
  function watchNearby() {
    if (watchId != null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
    nearEl.classList.add("hidden");
    if (!box.nearby || !box.loc || !navigator.geolocation) return;
    watchId = navigator.geolocation.watchPosition((p) => {
      const d = C.distanceM(box.loc, { lat: p.coords.latitude, lon: p.coords.longitude });
      const near = d <= C.NEAR_METERS + Math.min(p.coords.accuracy, 40);
      const t = C.today(log);
      nearEl.classList.toggle("hidden", !near || t.state === "mail");
      nearEl.textContent = "You're at the box. Anything in? Tap a button below.";
    }, () => {}, { enableHighAccuracy: true, maximumAge: 60000 });
  }
  cleanups.push(() => { if (watchId != null) navigator.geolocation.clearWatch(watchId); });

  const leave = h("button", { class: "link danger", type: "button", text: "Leave this box", onclick: () => {
    if (!confirm(`Leave "${box.name}"? Its log on this device will be deleted. You can rejoin with the sticker.`)) return;
    boxes = boxes.filter((b) => b.topic !== box.topic);
    saveBoxes();
    store.del("log:" + box.topic);
    location.hash = "#/";
  } });

  view.append(
    header,
    h("section", { class: "card hero-card" }, todayEl, nearEl, pingBtn, emptyBtn, undoEl),
    h("section", { class: "card" }, h("h2", { text: "Delivery log" }), logEl),
    alerts,
    stickerCard,
    locCard,
    h("p", { class: "center" }, leave),
  );
  update();
  watchNearby();

  // Catch up on the last 12 hours, then stay live while the page is open.
  const catchUp = () => N.poll(box.topic, "all").then((evs) => ingest(evs)).catch(() => {});
  catchUp();
  const stop = N.subscribe(box.topic, (ev) => ingest([ev], { live: true }), (s) => {
    status.textContent = s === "live" ? "Live" : "Reconnecting…";
    status.dataset.state = s;
    if (s === "live") catchUp();
  });
  const onVis = () => { if (!document.hidden) { catchUp(); update(); } };
  document.addEventListener("visibilitychange", onVis);
  const tick = setInterval(update, 60000);
  cleanups.push(stop, () => document.removeEventListener("visibilitychange", onVis), () => clearInterval(tick));
}

function renderLog(el, log, box) {
  // Show only as many weeks as this device has tracked (2 to 8).
  const first = [C.localDay(box.joinedAt), ...log.backfill].sort()[0];
  const spanDays = (Date.parse(C.localDay(Date.now())) - Date.parse(first)) / 864e5;
  const weeks = Math.max(2, Math.min(8, Math.ceil((spanDays + 1) / 7) + 1));
  const hist = C.history(log, { since: box.joinedAt, weeks });
  const grid = h("div", { class: "cal", role: "table", "aria-label": "Mail days, last 8 weeks" },
    h("div", { class: "cal-row cal-head", role: "row" }, C.WEEKDAYS.map((d) => h("span", { role: "columnheader", text: d[0], title: d }))),
    hist.rows.map((row) => h("div", { class: "cal-row", role: "row" }, row.map((c) => h("span", {
      role: "cell",
      class: `cal-cell s-${c.status}`,
      title: `${c.day}: ${{ mail: "mail came", empty: "checked, empty", none: "no report", untracked: "before you joined", future: "" }[c.status]}`,
      "aria-label": `${c.day} ${c.status}`,
    })))));
  const legend = h("p", { class: "legend small" },
    h("span", { class: "cal-cell s-mail" }), " Mail came  ",
    h("span", { class: "cal-cell s-empty" }), " Checked, empty  ",
    h("span", { class: "cal-cell s-none" }), " No report");
  const facts = [];
  facts.push(`Mail on ${hist.mailDays} of ${hist.trackedDays} day${hist.trackedDays === 1 ? "" : "s"} tracked`);
  if (hist.perWeek != null) facts.push(`about ${hist.perWeek} days a week`);
  if (hist.usual.length) facts.push(`usually ${hist.usual.map((i) => C.WEEKDAYS[i]).join(", ")}`);
  const recent = C.liveEvents(log).slice(-8).reverse();
  el.replaceChildren(
    h("p", { class: "facts", text: facts.join(" · ") + "." }),
    grid,
    legend,
    recent.length
      ? h("ul", { class: "events" }, recent.map((e) => h("li", {},
          h("span", { class: "muted", text: `${fmtDay(e.time)}, ${fmtTime(e.time)}` }),
          h("span", { text: e.kind === "mail" ? `Mail's in, reported by ${e.who}` : `Empty, checked by ${e.who}` }))))
      : h("p", { class: "muted small", text: "No alerts yet. Alerts from the last 12 hours load when you open the box." }),
    h("p", { class: "muted small", text: "This log is built on your phone from the alerts it receives. Each “Mail's in” alert also shares the sender's last two weeks, so logs fill in even if you miss a day." }));
}

// ---- Join (from a sticker link) ----

function renderJoin(route) {
  const name = route.name || "a community mailbox";
  document.title = `Join ${name} · BoxPing`;
  const who = h("input", { id: "who", type: "text", maxlength: C.WHO_MAX, autocomplete: "given-name", placeholder: "e.g. Sam (optional)", value: me });
  const form = h("form", { class: "card" },
    h("p", { class: "eyebrow", text: "You scanned a BoxPing sticker" }),
    h("h1", {}, "Join ", h("span", { class: "quote", text: name })),
    h("p", { text: "Get a ping when a neighbour sees the mail arrive, and tap one button to tell them when you do. No account needed." }),
    h("label", { for: "who", text: "Your first name or nickname, shown when you send an alert" }),
    who,
    h("div", { class: "row" },
      h("button", { class: "btn", type: "submit", text: "Join this box" }),
      h("a", { class: "btn ghost", href: "#/", text: "Not now" })));
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    me = C.cleanWho(who.value) || me;
    store.set("me", me);
    if (!findBox(route.topic)) boxes.push({ topic: route.topic, name: route.name || "Our mailbox", joinedAt: Date.now(), mine: [], nearby: false });
    saveBoxes();
    render();
    toast("Joined. Set up ntfy below to get alerts when BoxPing is closed.");
  });
  view.append(form);
}

// ---- Sticker ----

const SVG = "http://www.w3.org/2000/svg";
function qrSvg(text) {
  const qr = window.qrcode(0, "M");
  qr.addData(text, "Byte");
  qr.make();
  const n = qr.getModuleCount(), m = 2, size = n + m * 2;
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", `0 0 ${size} ${size}`);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "QR code to join this box");
  svg.setAttribute("shape-rendering", "crispEdges");
  svg.setAttribute("class", "qr");
  const bg = document.createElementNS(SVG, "rect");
  bg.setAttribute("width", size);
  bg.setAttribute("height", size);
  bg.setAttribute("fill", "#fff");
  let d = "";
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + m} ${r + m}h1v1h-1z`;
  const p = document.createElementNS(SVG, "path");
  p.setAttribute("d", d);
  p.setAttribute("fill", "#000");
  svg.append(bg, p);
  return svg;
}

function stickerEl(box, link) {
  return h("div", { class: "sticker" },
    h("div", { class: "sticker-brand" }, h("img", { src: "icons/icon.svg", alt: "", width: 28, height: 28 }), "BoxPing"),
    h("div", { class: "sticker-title", text: "Get a ping when the mail's in" }),
    window.qrcode ? qrSvg(link) : h("p", { text: link }),
    h("div", { class: "sticker-name", text: box.name }),
    h("div", { class: "sticker-foot", text: "Scan with your phone camera. Free, no account. Saw the carrier? Scan and tap “Mail's in”." }));
}

function printSticker(box, link) {
  const area = document.getElementById("print-area");
  area.replaceChildren(stickerEl(box, link), stickerEl(box, link));
  document.body.classList.add("printing");
  const done = () => { document.body.classList.remove("printing"); area.replaceChildren(); window.removeEventListener("afterprint", done); };
  window.addEventListener("afterprint", done);
  window.print();
}

async function copy(text, msg) {
  try { await navigator.clipboard.writeText(text); toast(msg); }
  catch { window.prompt("Copy this:", text); }
}

// ---- Boot ----

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
render();
