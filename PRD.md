# Product Requirements Document: ChromeOS Wi-Fi Fixer

## 1. Overview
**ChromeOS Wi-Fi Fixer** is a specialized diagnostic and troubleshooting application designed specifically for Chromebook users experiencing connectivity issues. It combines real-time network monitoring with advanced log analysis and AI-powered assistance to provide actionable solutions for complex Wi-Fi problems.

## 2. Target Audience
- **Chromebook Users:** Individuals experiencing intermittent or total Wi-Fi failure.
- **IT Support Professionals:** Technicians needing a quick way to parse `crosh` and `chrome://system` logs without manual regex searches.
- **Educational Institutions:** Schools managing large fleets of ChromeOS devices.

## 3. Key Features

### 3.1. Real-Time Diagnostic Dashboard
- **Live Status Monitoring:** Instant feedback on browser online/offline state.
- **Network Health Checks:**
    - **Ping Latency:** Measures response time to global servers.
    - **DNS Resolution:** Verifies if the device can resolve domain names.
    - **IP Allocation:** Checks if the device has a valid local IP address.
    - **Signal Strength:** Visual representation of Wi-Fi signal quality.
- **Automated Scanning:** One-click refresh to re-run all basic diagnostics.

### 3.2. Crosh Output Analyzer
- **Log Parsing:** Users can paste output from the `connectivity show services` command.
- **Data Extraction:** Automatically identifies the active service, SSID, security type (PSK/EAP), signal strength, and IP address.
- **Dashboard Integration:** Updates the main diagnostic dashboard with high-fidelity data extracted from the logs.

### 3.3. System Info Analyzer (`chrome://system`)
- **Hardware Diagnostics:** Parses the complex output of `chrome://system` to identify:
    - **PCI Devices:** Identifying the specific Wi-Fi/Bluetooth chipset and drivers.
    - **USB Devices:** Detecting external adapters or peripherals.
    - **OS/Firmware Versions:** Checking for outdated software that might cause bugs.
- **Copy-Paste Workflow:** Provides a "Copy URL" button and clear instructions to bypass browser security restrictions on internal `chrome://` pages.

### 3.4. AI-Powered Troubleshooting Assistant
- **Contextual Help:** An integrated chat interface powered by Gemini.
- **Diagnostic Awareness:** The AI assistant is aware of the current diagnostic results and analyzed logs, allowing it to provide specific advice (e.g., "Your signal is -80dBm, try moving closer to the router").
- **Step-by-Step Guidance:** Provides clear instructions for advanced fixes like resetting the Wi-Fi stack or changing DNS settings.

### 3.5. Diagnostic Shortcuts
- **Command Library:** A quick-reference modal containing essential `crosh` commands:
    - `connectivity show services`
    - `network_diag`
    - `ping google.com`
    - `top`
- **One-Click Copy:** Every command has a copy button for fast terminal entry.

## 4. User Experience (UX) Design
- **Aesthetic:** "Technical Dashboard" style—professional, precise, and information-dense.
- **Color Palette:** High-contrast neutral grays with semantic accents (Blue for info, Green for success, Amber for warnings, Red for errors).
- **Responsiveness:** Fluid layout that adapts from small Chromebook screens to large external monitors.
- **Accessibility:** Large touch targets (44px+) and clear typography (Inter) for legibility.

## 5. Technical Stack
- **Frontend:** React 18+, TypeScript, Vite.
- **Styling:** Tailwind CSS.
- **Animations:** Framer Motion (motion/react).
- **Icons:** Lucide React.
- **AI Integration:** `@google/genai` (Gemini 3 Flash).
- **Deployment:** Cloud Run (containerized).

## 6. Security & Privacy
- **Local Analysis:** Log parsing happens client-side; sensitive network names or IPs are only sent to the AI if the user engages in chat.
- **No Data Persistence:** Diagnostic data is stored in volatile memory and cleared on refresh unless explicitly saved to history.
- **Iframe Awareness:** Designed to work within the AI Studio preview environment, handling cross-origin and internal URL restrictions gracefully.
