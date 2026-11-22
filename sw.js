// Offline shell for BoxPing. Only same-origin GET requests inside this app's
// path are cached; ntfy.sh traffic is never touched.

const CACHE = "boxping-v1";
const SHELL = ["./", "index.html", "manifest.webmanifest", "icons/icon.svg", "icons/icon-192.png", "css/styles.css", "vendor/qrcode.js", "js/app.js", "js/core.js", "js/ntfy.js"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith("boxping-") && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  const scope = new URL(self.registration.scope).pathname;
  if (e.request.method !== "GET" || url.origin !== self.location.origin || !url.pathname.startsWith(scope)) return;
  // Network first so updates land quickly; cache when offline.
  e.respondWith(fetch(e.request).then((res) => {
    if (res.ok && res.type === "basic") caches.open(CACHE).then((c) => c.put(e.request, res.clone()));
    return res;
  }).catch(() => caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || caches.match("index.html"))));
});

// Tapping a BoxPing notification opens (or focuses) the box page.
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const scope = self.registration.scope;
  let target = scope;
  try {
    const u = new URL(e.notification.data?.url || scope);
    if (u.href.startsWith(scope)) target = u.href;
  } catch { /* use scope */ }
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
    for (const c of list) if (c.url.startsWith(scope) && "focus" in c) { c.navigate(target).catch(() => {}); return c.focus(); }
    return self.clients.openWindow(target);
  }));
});
