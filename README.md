# ChromeOS Connectivity Diagnostics

Wi-Fi and network troubleshooting tool for Chromebook users. Combines real-time diagnostics, log analysis, a signal history chart, and an AI assistant in a single browser-based interface.

## Features

- **Real-Time Diagnostics** — Ping latency, DNS resolution, browser status; auto re-runs on reconnect
- **Active Network Dashboard** — SSID, security, IP, signal strength, packet stats loaded from `chrome://system`
- **System Info Analyzer** — Upload a saved `chrome://system` file to extract Wi-Fi chipset, driver, channel, PHY mode, link stats, disconnect counts, and more
- **Connection Timeline** — Upload a `chrome://device-log` MHTML file to get a chronological event log, filtered by category (state changes, signal, speed, errors)
- **Signal Chart** — RSSI-over-time SVG chart inside the timeline with quality zone bands, crosshair, and click-to-scroll to the matching log entry
- **AI Troubleshooting Assistant** — Context-aware chat powered by Gemini Flash, pre-loaded with your current diagnostic state
- **Quick Tools** — ChromeOS keyboard shortcuts and `crosh` command reference with one-click copy
- **Export Report** — Download all diagnostic results as a `.txt` file
- **Re-scan** — Re-run all live diagnostics on demand or automatically on reconnect

## Tech Stack

- React 19, TypeScript, Vite
- Tailwind CSS v4
- Framer Motion (`motion/react`)
- Lucide React icons
- Google Gemini AI (`@google/genai`)
- IBM Plex Sans + IBM Plex Mono (typography)

## Getting Started

### Prerequisites

- Node.js 18+

### Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Create `.env.local` and set your Gemini API key:
   ```
   GEMINI_API_KEY=your_key_here
   ```

3. Start the dev server:
   ```bash
   npm run dev
   ```

4. Open [http://localhost:5173](http://localhost:5173)

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server on port 5173 |
| `npm run build` | Production build |
| `npm run preview` | Preview production build |
| `npm run lint` | Type-check with TypeScript |
| `npm run clean` | Remove dist folder |

## How to Use the Log Tools

### System Info Analyzer
1. Open `chrome://system` in a new tab on your Chromebook
2. Click **Expand All**
3. Press `Ctrl+S` to save as a file
4. Upload it in the System Info modal — the dashboard populates automatically

### Connection Timeline
1. Open `chrome://device-log` in a new tab
2. Check **only** the **Network** checkbox (leave all others unchecked)
3. Set Log Level to **Debug**
4. Press `Ctrl+S` to save as `.mhtml`
5. Upload it in the Net Timeline modal to see a timestamped event log and signal chart
