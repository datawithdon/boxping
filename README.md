# BoxPing

**Know when the mail's in.** BoxPing is a tiny web app for neighbours who share a Canada Post community mailbox. Whoever sees the carrier taps **Mail's in**, and everyone else on that box gets an alert.

**Live:** https://datawithdon.github.io/boxping/

## Why

Door-to-door delivery is being phased out in favour of community mailboxes, and delivery days are fewer and less predictable. Walking to an empty box gets old fast. BoxPing confirms the mail actually landed.

## How it works

1. One neighbour taps **Set up a box**, names it and prints the QR sticker.
2. Neighbours scan the sticker with their phone camera and tap **Join**. No account or sign-up needed.
3. Whoever sees the carrier taps **Mail's in**. Everyone on the box gets a push alert.
4. BoxPing logs which days mail came (and which days someone found it empty), so you can see the pattern: "about 3 days a week, usually Mon, Wed, Fri."

Other features:

- **I checked: it's empty**: a quiet, low-priority note so others don't make the trip.
- **Undo**: for 30 minutes after a false alarm, the sender can retract their alert.
- **Duplicate guard**: if mail was already reported today, you're asked before pinging everyone again.
- **At the box**: optionally save the box's location. When you open BoxPing near it, the app asks "Anything in?". The location never leaves your phone.
- Installable PWA, works in light and dark mode, and the app shell works offline.

## Alerts: ntfy.sh

BoxPing has no server of its own. Alerts are relayed by [ntfy.sh](https://ntfy.sh), a free, open-source pub/sub push service:

- Each box is an unguessable ntfy topic (`boxping-` + 20 random characters, about 119 bits).
- **Mail's in** posts a message to that topic.
- **While BoxPing is open**, it streams the topic live (server-sent events) and can show browser notifications.
- **While BoxPing is closed**, neighbours get alerts through the free **ntfy** app (iOS/Android) or the ntfy web app, subscribed to the box's topic. The box page walks you through it.

ntfy.sh keeps messages for 12 hours. BoxPing builds the delivery log on each phone from the alerts it receives. Each **Mail's in** alert also carries the sender's mail days from the past two weeks, so a phone that missed a day fills in its log from the next alert.

## Privacy and limits

- No accounts, analytics or cookies. Your boxes, name, log and box location are stored only in your browser.
- Alerts contain the box name, the reporter's first name or nickname, and recent mail dates. Anyone who has the sticker or invite link can read and send alerts for that box. **Don't put unit numbers or full addresses in the box name.**
- ntfy.sh allows about 250 messages per day per network on its free tier, which is far more than a mailbox needs.
- Not affiliated with Canada Post or ntfy.

## Run locally

```sh
npm start        # serves on http://127.0.0.1:8000
npm test         # unit tests (Node 20+)
```

No build step and no dependencies. The only vendored library is [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) (MIT).

## Project layout

| Path | What |
|---|---|
| `index.html` | App shell, strict CSP |
| `js/core.js` | Pure logic: box IDs, links, message format, log, stats (tested) |
| `js/ntfy.js` | All network code: publish, poll, live stream |
| `js/app.js` | UI and routing |
| `sw.js` | Offline cache and notification taps |

## License

MIT
