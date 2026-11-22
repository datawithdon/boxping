// The only network code in BoxPing. Alerts go through ntfy.sh, a free,
// open-source push service: posting to a topic notifies everyone who follows
// it in the ntfy app, in the ntfy web app, or in BoxPing while it's open.

export const HOST = "https://ntfy.sh";

/** Publish one message. Sent as text/plain so the browser skips a CORS preflight. */
export async function publish(msg) {
  let res;
  try {
    res = await fetch(HOST + "/", { method: "POST", body: JSON.stringify(msg), credentials: "omit", referrerPolicy: "no-referrer" });
  } catch {
    throw new Error("Couldn't reach ntfy.sh. Check your connection and try again.");
  }
  if (res.status === 429) throw new Error("Too many alerts from this network today. Try again later.");
  if (!res.ok) throw new Error(`ntfy.sh couldn't send the alert (error ${res.status}).`);
  return res.json();
}

/** Messages ntfy.sh still holds for a topic (it keeps them for 12 hours). */
export async function poll(topic, since = "all") {
  const res = await fetch(`${HOST}/${topic}/json?poll=1&since=${encodeURIComponent(since)}`, { credentials: "omit", referrerPolicy: "no-referrer" });
  if (!res.ok) throw new Error(`poll failed: ${res.status}`);
  const text = (await res.text()).slice(0, 500_000);
  const out = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* skip junk lines */ }
  }
  return out;
}

/**
 * Live stream while the page is open. `onEvent` gets raw events; `onState`
 * gets "live" or "offline". Returns a function that closes the stream.
 */
export function subscribe(topic, onEvent, onState = () => {}) {
  if (typeof EventSource === "undefined") return () => {};
  const es = new EventSource(`${HOST}/${topic}/sse`);
  es.onopen = () => onState("live");
  es.onerror = () => onState("offline");
  es.onmessage = (m) => {
    if (typeof m.data !== "string" || m.data.length > 20_000) return;
    try { onEvent(JSON.parse(m.data)); } catch { /* ignore */ }
  };
  return () => es.close();
}

/** Links that follow a box outside BoxPing, for alerts when it's closed. */
export function followLinks(topic) {
  return {
    web: `${HOST}/${topic}`,
    android: `ntfy://ntfy.sh/${topic}`,
    docs: "https://docs.ntfy.sh/subscribe/phone/",
  };
}
