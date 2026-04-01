# ChromeOS Wi-Fi Fixer

AI-powered diagnostic tool for troubleshooting Chromebook Wi-Fi connectivity issues.

## Features

- **Real-Time Diagnostics** - Ping latency, DNS resolution, IP allocation, signal strength
- **Crosh Output Analyzer** - Parses `connectivity show services` output for detailed network telemetry
- **System Info Analyzer** - Extracts hardware/driver info from `chrome://system`
- **AI Troubleshooting Assistant** - Context-aware chat powered by Gemini 3 Flash
- **Diagnostic Shortcuts** - Quick-reference ChromeOS commands and keyboard shortcuts
- **Report Export** - Download diagnostic results as a text file

## Tech Stack

- React 19, TypeScript, Vite
- Tailwind CSS v4
- Framer Motion (motion/react)
- Lucide React icons
- Google Gemini AI (`@google/genai`)

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

4. Open [http://localhost:3000](http://localhost:3000)

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server on port 3000 |
| `npm run build` | Production build |
| `npm run preview` | Preview production build |
| `npm run lint` | Type-check with TypeScript |
| `npm run clean` | Remove dist folder |
