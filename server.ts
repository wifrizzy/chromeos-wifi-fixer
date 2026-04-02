/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Lightweight Express proxy that keeps the Gemini API key server-side.
 * The client sends diagnostic context to /api/chat; this server appends
 * the key and forwards the request to Google's Generative AI endpoint.
 */

import express from 'express';
import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

const app = express();
const PORT = parseInt(process.env.PORT || '3001', 10);

// --- Security: validate API key exists at startup ---
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) {
  console.error('FATAL: GEMINI_API_KEY environment variable is not set. Exiting.');
  process.exit(1);
}

const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

// --- Middleware ---
app.use(express.json({ limit: '50kb' })); // Limit request body size

// --- Rate limiting (simple in-memory, per-IP) ---
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const RATE_LIMIT_MAX = 15; // 15 requests per minute

function rateLimit(req: express.Request, res: express.Response, next: express.NextFunction): void {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const entry = rateLimitMap.get(ip);

  if (!entry || now > entry.resetTime) {
    rateLimitMap.set(ip, { count: 1, resetTime: now + RATE_LIMIT_WINDOW_MS });
    next();
    return;
  }

  if (entry.count >= RATE_LIMIT_MAX) {
    res.status(429).json({ error: 'Too many requests. Please try again later.' });
    return;
  }

  entry.count++;
  next();
}

// Clean up stale rate-limit entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimitMap) {
    if (now > entry.resetTime) rateLimitMap.delete(ip);
  }
}, 300_000);

// --- Security headers ---
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

// --- API route ---
app.post('/api/chat', rateLimit, async (req: express.Request, res: express.Response): Promise<void> => {
  const { message, diagnosticContext, deviceInfo } = req.body;

  // Input validation
  if (!message || typeof message !== 'string') {
    res.status(400).json({ error: 'A message is required.' });
    return;
  }

  if (message.length > 2000) {
    res.status(400).json({ error: 'Message too long (max 2000 characters).' });
    return;
  }

  try {
    const model = 'gemini-3-flash-preview';
    const contents = `The user is on a Chromebook. Current network diagnostics: ${
      typeof diagnosticContext === 'string' ? diagnosticContext.slice(0, 3000) : 'unavailable'
    }. Device Info: ${
      typeof deviceInfo === 'string' ? deviceInfo.slice(0, 1000) : 'unavailable'
    }. User says: ${message}`;

    const response = await ai.models.generateContent({
      model,
      contents,
      config: {
        systemInstruction:
          'You are a Chromebook Wi-Fi troubleshooting expert. Provide concise, step-by-step advice. Mention Chromebook-specific features like "crosh", "ChromeOS settings", or "hardware switches" if relevant. Keep it technical but accessible. If the user is offline, explain that your AI capabilities are limited but provide standard offline fixes.',
      },
    });

    res.json({ reply: response.text || "I'm having trouble analyzing that right now. Try checking your physical Wi-Fi switch." });
  } catch (err) {
    // Log full error server-side only
    console.error('Gemini API error:', err instanceof Error ? err.message : 'Unknown error');
    // Return generic message to client
    res.status(502).json({ error: 'AI service temporarily unavailable. Please try again.' });
  }
});

// --- Serve static build in production ---
const distPath = path.resolve(import.meta.dirname, 'dist');
app.use(express.static(distPath));
app.get('*', (_req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
