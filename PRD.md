# Product Requirements Document: ChromeOS Connectivity Diagnostics

## 1. Overview
**ChromeOS Connectivity Diagnostics** is a specialized diagnostic and troubleshooting application for Chromebook users experiencing Wi-Fi and network connectivity issues. It combines real-time network monitoring, file-based log analysis, visual signal history, and AI-powered assistance to provide actionable insight into complex Wi-Fi problems — all client-side with no data sent to external servers except when the AI assistant is engaged.

## 2. Target Audience
- **Chromebook Users:** Individuals experiencing intermittent or total Wi-Fi failure who want more than the stock ChromeOS diagnostics offer.
- **IT Support Professionals:** Technicians who need to parse `chrome://system` and `chrome://device-log` output without manual searching.
- **Educational Institutions:** Schools managing large fleets of ChromeOS devices.

## 3. Features

### 3.1 Real-Time Diagnostic Dashboard
- **Live Status Monitoring:** Instant feedback on browser online/offline state.
- **Network Health Checks:**
  - **Ping Latency:** Measures response time; warns if >150ms.
  - **DNS Resolution:** Verifies domain name resolution.
  - **IP Allocation:** Checks for a valid local IP address.
  - **Signal Strength:** Visual bar indicator from parsed system data.
- **Status Card Indicators:** Each card has a 4px left border that reflects its current state — green (success), amber (warning), red (error), gray (pending).
- **Re-Scan:** Header button re-runs all diagnostics on demand, with spinner feedback. Diagnostics also auto-run when the device reconnects after going offline.
- **Export Report:** Downloads all diagnostic results and device info as a `.txt` file.

### 3.2 System Info Analyzer (`chrome://system`)
- **File Upload Workflow:** User saves `chrome://system` as a file (Ctrl+S after Expand All) and uploads it. No copy-paste required.
- **Data Extracted:**
  - Wi-Fi chipset and adapter (from `lspci` / `lsusb`)
  - Active SSID, BSSID, security type, band, channel, PHY mode, frequency
  - IP address, gateway, DNS servers
  - Link-layer bitrate, avg/last signal (dBm), TX retries
  - Disconnect and misconnect counts
  - OS version, Chrome milestone, release channel
  - Wake-on-Wi-Fi status, MAC address randomization
- **Dashboard Integration:** Populates the Active Network card and status cards with the parsed data.

### 3.3 Connection Timeline (`chrome://device-log`)
- **File Upload Workflow:** User saves `chrome://device-log` as MHTML (Network checkbox only, Debug level, Ctrl+S) and uploads it.
- **MHTML Parsing:** Decodes quoted-printable encoding, extracts `<p>` log entries, strips noise (GetShillProperties, NetworkPropertiesUpdated, ARC messages), and returns events oldest-first.
- **Event Categories:**
  - `state` — Connection state changes (Connected, Disconnected, etc.)
  - `signal` — RSSI updates with dBm values
  - `speed` — Downlink/uplink speed changes
  - `slow` — Slow method warnings
  - `error` — Error-level events
  - `other` — Uncategorized debug events
- **Filter Tabs:** Toggle view by category with live counts per tab.
- **Collapsible Left Panel:** Instruction/upload panel collapses to a compact strip once a file is loaded, maximizing the timeline reading area.

### 3.4 Signal Chart
- **RSSI Over Time:** SVG chart plotting signal strength from all `signal` category events in the timeline.
- **Quality Zone Bands:** Color-coded bands for Excellent (>−50), Good (−60), Fair (−70), and Poor (<−70 dBm).
- **Crosshair:** Clicking a data point shows a vertical/horizontal crosshair with a value pill and time label.
- **Click-to-Scroll:** Clicking a point resets the category filter and scrolls the timeline to the matching log entry, highlighted with a ring for 2 seconds.
- **Chart Hint:** "Click a point → jump to log entry" shown in the chart header when navigation is active.

### 3.5 AI Troubleshooting Assistant
- **Contextual Chat:** Integrated chat interface powered by Google Gemini Flash.
- **Diagnostic Awareness:** Pre-loaded with current diagnostic results and device info for specific, relevant advice.
- **Typing Indicator:** Animated dots while the response is generating.

### 3.6 Quick Tools
- **Keyboard Shortcuts:** Reference for ChromeOS system shortcuts (Terminal, Task Manager, Settings, etc.).
- **Crosh Commands:** `network_diag`, `ping google.com`, `top`, `chrome://system` with one-click copy.

## 4. UX Design

- **Aesthetic:** Technical dashboard — precise, information-dense, professional. Google-brand color bar at top ties the visual language to ChromeOS.
- **Typography:** IBM Plex Sans (body/UI) + IBM Plex Mono (data values — IPs, dBm, latency, versions). Chosen for technical precision and readability at small sizes.
- **Color Palette:** Neutral grays with semantic accents — `#4285F4` blue (primary), green (success), amber (warning), red (error). Violet accent for the timeline/signal features.
- **Label Sizing:** All UI labels are 11px minimum; primary data values 12px+. No text below 11px anywhere in the interface.
- **Status Feedback:** Footer status indicator reacts to scanning state, warnings, and errors in real time.
- **Modals:** Framer Motion scale+opacity transitions. Backdrop blur on overlays.
- **Responsiveness:** Single-column max-w-4xl layout scales from Chromebook screens up. Modals use `h-[85vh]` with internal scroll.
- **Accessibility:** Semantic HTML, focus states, disabled states with opacity, touch-friendly hit areas on chart dots (14px radius invisible overlay).

## 5. Technical Stack

| Layer | Choice |
|-------|--------|
| Framework | React 19, TypeScript |
| Build | Vite |
| Styling | Tailwind CSS v4 (CSS-first config) |
| Animation | Framer Motion (`motion/react`) |
| Icons | Lucide React |
| AI | `@google/genai` — Gemini Flash |
| Fonts | IBM Plex Sans + IBM Plex Mono via Google Fonts |
| Charts | Custom SVG (no external chart library) |

## 6. Security & Privacy

- **Client-Side Only:** All log parsing (MHTML decoding, QP decoding, regex extraction) runs in the browser. No files or log content are uploaded to any server.
- **AI Scope:** Diagnostic context (latency, DNS status, device info) is sent to Gemini only when the user sends a chat message. Raw log files are never sent.
- **No Persistence:** All diagnostic state is in React memory and cleared on page refresh.

## 7. Current Status (as of April 2026)

### Implemented
- [x] Real-time diagnostics (latency, DNS, browser status, signal)
- [x] Auto re-scan on page load and on network reconnect
- [x] System Info Analyzer with file upload and full network/hardware parsing
- [x] Connection Timeline with MHTML parsing and category filtering
- [x] RSSI signal chart with zone bands, crosshair, and click-to-scroll
- [x] AI Assistant with diagnostic context
- [x] Quick Tools shortcuts modal
- [x] Export Report (`.txt` download)
- [x] Status card health borders
- [x] Reactive footer status indicator
- [x] Collapsible timeline panel
- [x] IBM Plex typography
- [x] Smarter empty state with live diagnostic preview

### Potential Future Work
- [ ] Auto re-scan on reconnect with diff highlighting (show what changed)
- [ ] Timeline: show delta between consecutive RSSI readings
- [ ] Multi-file comparison (two device logs side by side)
- [ ] Persistent history across sessions (localStorage)
- [ ] PWA / installable app for offline use on Chromebook
- [ ] Shareable diagnostic link (encoded state in URL)
