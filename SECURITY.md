# Security notes

BoxPing is a static web app with no server, no accounts and no analytics. Its only network peer is ntfy.sh.

## What's protected and how

| Area | Protection |
|---|---|
| Network | The CSP allows only same-origin scripts, styles, images and workers. `connect-src` allows only `https://ntfy.sh`. Requests omit credentials and referrer. |
| Untrusted alerts | Anyone who knows a box's topic can post to it, so every incoming ntfy message is parsed as untrusted data. The ID, time, tags and topic are type-checked, text is length-capped and stripped of control, zero-width and bidi-override characters, and dates are validated. Messages without a BoxPing tag are ignored. |
| Code injection | All text is rendered with `textContent` / DOM APIs, never `innerHTML`. QR codes are built as SVG elements. The CSP also enforces Trusted Types (`require-trusted-types-for 'script'`), with one policy that allows only `sw.js`, so a future HTML-string bug can't execute script. |
| Flooding | Anyone with the topic can post many messages. The stored log keeps at most 600 events and 120 backfilled days, incoming streams and polls are size-capped, and alerts and vibration are throttled to one per box every 10 minutes. |
| Forged retractions | An undo only counts if it arrives within 30 minutes after the alert it names, so stray or hostile messages can't erase older genuine alerts. |
| Log backfill | Shared "recent mail days" are accepted only for real dates within 15 days before the alert. |
| Join links | The topic must match `boxping-[A-Za-z0-9]{20}`, and the box name in the link is decoded safely and sanitized. Malformed links go to the home page. |
| Stored data | The box list and logs are rebuilt from a fixed schema on every load. Unknown keys, wrong types, old entries (>120 days) and oversized lists are dropped. |
| Clickjacking | The app refuses to run inside another site's frame. GitHub Pages can't send `frame-ancestors`. |
| Offline cache | The service worker handles only same-origin GET requests inside the app's path, and deletes only its own old caches. Notification taps open only URLs within the app's scope. |
| Location | Optional and on-demand. Coordinates are stored only in the browser and never sent anywhere. |
| Third-party code | One vendored library: qrcode-generator 1.4.4 (MIT), byte-identical to the npm release, with no network calls or `eval`. |

## Known limits

- **A box is only as private as its sticker.** Anyone with the QR or link can read and send alerts for that box, including fake ones. The topic can't be guessed, but it isn't secret from anyone who sees the sticker. Leave unit numbers and addresses out of box names.
- **Fake alerts and phishing in the ntfy app.** Someone with the topic can send messages with their own links, action buttons or attachments, and the ntfy app will show them. BoxPing ignores everything but its own format, but the ntfy app can't, so the app warns users that real BoxPing alerts never ask them to sign in, pay or download anything. Fixing this fully needs authenticated topics (a reserved ntfy topic or a backend of our own).
- **Shared log data can be forged.** A poster can claim false recent mail days (bounded to the last 15 days) or retract a fresh alert within 30 minutes.
- **ntfy.sh is a third party.** It sees the alert text, the topic and the sender's IP address. See its [privacy policy](https://docs.ntfy.sh/privacy/).
- **Shared origin.** GitHub Pages serves all of an account's project sites from one origin, and they share browser storage. Keys are prefixed `boxping:`.

## Reporting

Please use GitHub's private vulnerability reporting on this repository.
