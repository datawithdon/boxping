# Security notes

BoxPing is a static web app with no server, no accounts and no analytics. Its only network peer is ntfy.sh.

## What's protected and how

| Area | Protection |
|---|---|
| Network | The CSP allows only same-origin scripts, styles, images and workers. `connect-src` allows only `https://ntfy.sh`. Requests omit credentials and referrer. |
| Untrusted alerts | Anyone who knows a box's topic can post to it, so every incoming ntfy message is parsed as untrusted data. The ID, time, tags and topic are type-checked, text is length-capped and stripped of control, zero-width and bidi-override characters, and dates are validated. Messages without a BoxPing tag are ignored. |
| Code injection | All text is rendered with `textContent` / DOM APIs, never `innerHTML`. QR codes are built as SVG elements. |
| Join links | The topic must match `boxping-[A-Za-z0-9]{20}`, and the box name in the link is decoded safely and sanitized. Malformed links go to the home page. |
| Stored data | The box list and logs are rebuilt from a fixed schema on every load. Unknown keys, wrong types, old entries (>120 days) and oversized lists are dropped. |
| Clickjacking | The app refuses to run inside another site's frame. GitHub Pages can't send `frame-ancestors`. |
| Offline cache | The service worker handles only same-origin GET requests inside the app's path, and deletes only its own old caches. Notification taps open only URLs within the app's scope. |
| Location | Optional and on-demand. Coordinates are stored only in the browser and never sent anywhere. |
| Third-party code | One vendored library: qrcode-generator 1.4.4 (MIT), with no network calls or `eval`. |

## Known limits

- **A box is only as private as its sticker.** Anyone with the QR or link can read and send alerts for that box, including fake ones. The topic can't be guessed, but it isn't secret from anyone who sees the sticker. Leave unit numbers and addresses out of box names.
- **ntfy.sh is a third party.** It sees the alert text, the topic and the sender's IP address. See its [privacy policy](https://docs.ntfy.sh/privacy/).
- **Shared origin.** GitHub Pages serves all of an account's project sites from one origin, and they share browser storage. Keys are prefixed `boxping:`.

## Reporting

Please use GitHub's private vulnerability reporting on this repository.
