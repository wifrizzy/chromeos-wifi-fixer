/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export async function checkLatency(): Promise<number | null> {
  const start = Date.now();
  try {
    // Using a common endpoint for connectivity checks
    await fetch('https://www.google.com/generate_204', { mode: 'no-cors', cache: 'no-cache' });
    return Date.now() - start;
  } catch (e) {
    console.error('Latency check failed:', e);
    return null;
  }
}

export async function checkDNS(): Promise<boolean> {
  try {
    // Attempt to fetch a known domain
    const response = await fetch('https://dns.google/resolve?name=google.com', { mode: 'cors' });
    return response.ok;
  } catch (e) {
    console.error('DNS check failed:', e);
    return false;
  }
}

export function getChromebookInfo() {
  const ua = navigator.userAgent;
  const isCrOS = /\bCrOS\b/.test(ua);
  return {
    isChromebook: isCrOS,
    userAgent: ua,
    platform: navigator.platform,
    online: navigator.onLine,
    connection: (navigator as any).connection?.effectiveType || 'unknown'
  };
}

export interface ParsedService {
  name: string;
  type: string;
  state: string;
  security: string;
  strength: string;
  lastSignal?: string;
  avgSignal?: string;
  txFailures?: string;
  txSuccesses?: string;
  eap?: {
    method?: string;
    identity?: string;
    inner?: string;
  };
  psk?: {
    key_mgmt?: string;
  };
  ip?: string;
}

export function parseCroshOutput(text: string): ParsedService | null {
  const lines = text.split('\n');
  let currentService: any = null;
  let activeService: any = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    
    // Look for service headers (e.g., "/service/2" or "Service: /service/2")
    const serviceMatch = trimmed.match(/^(?:Service:?\s*)?(\/service\/\d+):?$/i);
    if (serviceMatch) {
      // If the previous service we were tracking was active, we've found our winner
      if (currentService?.state === 'online' || currentService?.state === 'ready' || currentService?.isConnected) {
        activeService = currentService;
        break;
      }
      currentService = { name: serviceMatch[1], state: 'unknown', isConnected: false };
      continue;
    }

    if (!currentService) continue;

    // Improved KV matching to allow slashes and dots in keys
    const kvMatch = trimmed.match(/^([\w./]+)\s*[=:]\s*(.*)$/);
    if (kvMatch) {
      const key = kvMatch[1].toLowerCase();
      const value = kvMatch[2].trim();

      // STRICT matching for state to avoid RoamState overwriting
      if (key === 'state') currentService.state = value.toLowerCase();
      if (key === 'isconnected' && value.toLowerCase() === 'true') currentService.isConnected = true;
      if (key === 'type') currentService.type = value;
      if (key === 'security') currentService.security = value;
      if (key === 'strength') currentService.strength = value;
      if (key === 'name' || key === 'logname') currentService.name = value;
      
      // Signal Metrics (Support both RSSI and Signal formats)
      if (key === 'wifi.lastreceivesignal' || key === 'wifi.signalstrengthrssi') {
        currentService.lastSignal = value;
      }
      if (key === 'wifi.averagereceivesignal') {
        currentService.avgSignal = value;
      }
      
      // Packet Metrics
      if (key === 'wifi.transmitfailures') currentService.txFailures = value;
      if (key === 'wifi.transmitsuccesses') currentService.txSuccesses = value;

      // IP Address (Look for common IPv4 patterns)
      if (key.includes('ipv4address') && !currentService.ip) {
        currentService.ip = value.split('/')[0];
      }

      // EAP / Security
      if (key === 'eap.method') {
        if (!currentService.eap) currentService.eap = {};
        currentService.eap.method = value;
      }
      if (key === 'eap.identity') {
        if (!currentService.eap) currentService.eap = {};
        currentService.eap.identity = value;
      }
      if (key === 'eap.keymgmt' || key === 'wifi.keymgmt') {
        if (!currentService.psk) currentService.psk = {};
        currentService.psk.key_mgmt = value;
      }
    }
  }

  // Final check for the last service in the loop
  if (!activeService && (currentService?.state === 'online' || currentService?.state === 'ready' || currentService?.isConnected)) {
    activeService = currentService;
  }

  return activeService as ParsedService;
}

export interface SystemInfo {
  lspci?: string[];
  lsusb?: string[];
  cpuinfo?: string;
  meminfo?: string;
  version?: string;
  os_version?: string;
  firmware_version?: string;
}

export function parseSystemInfo(text: string): SystemInfo {
  const info: SystemInfo = {};
  const lines = text.split('\n');
  
  let currentKey: keyof SystemInfo | null = null;
  let buffer: string[] = [];

  const flushBuffer = () => {
    if (currentKey && buffer.length > 0) {
      if (currentKey === 'lspci' || currentKey === 'lsusb') {
        info[currentKey] = [...buffer];
      } else {
        info[currentKey] = buffer.join('\n').trim();
      }
    }
    buffer = [];
  };

  for (const line of lines) {
    // chrome://system format is usually "KeyName   Value" or "KeyName [Expand]"
    // We look for known keys at the start of the line
    const lowerLine = line.toLowerCase();
    
    let foundKey: keyof SystemInfo | null = null;
    if (line.startsWith('lspci')) foundKey = 'lspci';
    else if (line.startsWith('lsusb')) foundKey = 'lsusb';
    else if (line.startsWith('cpuinfo')) foundKey = 'cpuinfo';
    else if (line.startsWith('meminfo')) foundKey = 'meminfo';
    else if (line.startsWith('CHROME VERSION')) foundKey = 'version';
    else if (line.startsWith('CHROMEOS_RELEASE_VERSION')) foundKey = 'os_version';
    else if (line.startsWith('fw_version')) foundKey = 'firmware_version';

    if (foundKey) {
      flushBuffer();
      currentKey = foundKey;
      // Try to get value from the same line if it's there
      const valuePart = line.substring(line.indexOf(' ') + 1).trim();
      if (valuePart && valuePart !== '[Expand]') {
        buffer.push(valuePart);
      }
    } else if (currentKey) {
      // If we are in a section, and the line doesn't look like a new key (starts with whitespace or is a continuation)
      // chrome://system often indents multi-line values or they just follow
      if (line.trim() === '') continue;
      buffer.push(line.trim());
    }
  }
  flushBuffer();

  return info;
}
