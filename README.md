# Tray Timer

Multiple independent countdown timers ("trays") in an installable, offline-capable PWA. No build step — plain HTML/CSS/JS.

- 5 trays by default, each with its own **Start/Pause** and **Reset**
- Tap a time to set a duration (`5` = 5 min, `1:30` = 1m30s, `1:00:00` = 1h)
- Tap a name to rename; **+ Tray** to add, **×** to remove
- Beep, vibration and (when backgrounded) a notification when a tray finishes
- State is saved locally, so timers keep running across reloads
- Keeps the screen awake while any tray is running

## Develop

```sh
npm run dev        # serve on http://localhost:3000
npm test           # unit tests (node:test)
npm run test:e2e   # Playwright browser tests (uses installed Google Chrome)
```

## Deploy to Vercel

Import the repo in Vercel with Framework Preset **Other** — no build command, output directory is the repo root.
