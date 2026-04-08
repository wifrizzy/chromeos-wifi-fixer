/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

const FETCH_TIMEOUT_MS = 8000;

export async function checkLatency(): Promise<number | null> {
  const start = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    await fetch('https://www.google.com/generate_204', {
      mode: 'no-cors', cache: 'no-cache', signal: controller.signal,
    });
    return Date.now() - start;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function checkDNS(): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch('https://dns.google/resolve?name=google.com', {
      mode: 'cors', signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
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

// ---------------------------------------------------------------------------
// Crosh parser
// ---------------------------------------------------------------------------

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

    const serviceMatch = trimmed.match(/^(?:Service:?\s*)?(\/service\/\d+):?$/i);
    if (serviceMatch) {
      if (currentService?.state === 'online' || currentService?.state === 'ready' || currentService?.isConnected) {
        activeService = currentService;
        break;
      }
      currentService = { name: serviceMatch[1], state: 'unknown', isConnected: false };
      continue;
    }

    if (!currentService) continue;

    const kvMatch = trimmed.match(/^([\w./]+)\s*[=:]\s*(.*)$/);
    if (kvMatch) {
      const key = kvMatch[1].toLowerCase();
      const value = kvMatch[2].trim();

      if (key === 'state') currentService.state = value.toLowerCase();
      if (key === 'isconnected' && value.toLowerCase() === 'true') currentService.isConnected = true;
      if (key === 'type') currentService.type = value;
      if (key === 'security') currentService.security = value;
      if (key === 'strength') currentService.strength = value;
      if (key === 'name' || key === 'logname') currentService.name = value;

      if (key === 'wifi.lastreceivesignal' || key === 'wifi.signalstrengthrssi') {
        currentService.lastSignal = value;
      }
      if (key === 'wifi.averagereceivesignal') {
        currentService.avgSignal = value;
      }

      if (key === 'wifi.transmitfailures') currentService.txFailures = value;
      if (key === 'wifi.transmitsuccesses') currentService.txSuccesses = value;

      if (key.includes('ipv4address') && !currentService.ip) {
        currentService.ip = value.split('/')[0];
      }

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

  if (!activeService && (currentService?.state === 'online' || currentService?.state === 'ready' || currentService?.isConnected)) {
    activeService = currentService;
  }

  return activeService as ParsedService;
}

// ---------------------------------------------------------------------------
// chrome://system parser — Step 6: robust QP + HTML decoding
// ---------------------------------------------------------------------------

function decodeQP(text: string): string {
  return text
    .replace(/=\r?\n/g, '')  // soft line breaks
    .replace(/=([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');
}

function stripTags(text: string): string {
  return text.replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, '');
}

/**
 * Extracts named sections from a plain-text copy-paste of chrome://system.
 * When a user selects-all and copies in Chrome, each section appears as:
 *   🔗 section_name      ← link icon (U+1F517) + name on its own line
 *   Collapse…            ← button text to skip
 *   <content lines>
 */
function extractPlainTextSections(text: string): Record<string, string> {
  const sections: Record<string, string> = {};

  // Strip the 🔗 link-chain emoji Chrome prepends to section names
  const cleaned = text.replace(/\u{1F517}\s*/gu, '');

  // All section names we care about for Wi-Fi diagnostics
  const TARGET = new Set([
    'lspci', 'lsusb', 'lsusb_verbose',
    'network_devices', 'network_services', 'network_event_log', 'ifconfig',
    'meminfo', 'cpuinfo', 'dmesg',
    'CHROMEOS_RELEASE_VERSION', 'CHROMEOS_RELEASE_BOARD',
    'CHROMEOS_RELEASE_TRACK', 'CHROMEOS_RELEASE_CHROME_MILESTONE',
    'CHROMEOS_RELEASE_BUILDER_PATH', 'CHROMEOS_FIRMWARE_VERSION',
    'CHROME VERSION', 'fw_version',
  ]);

  const lines = cleaned.split('\n');
  let current: string | null = null;
  let buffer: string[] = [];

  const flush = () => {
    if (current && buffer.length > 0) sections[current] = buffer.join('\n').trim();
    buffer = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // Skip Chrome's "Collapse…" / "Expand…" button text (U+2026 ellipsis or plain dots)
    if (/^(Collapse|Expand)[….]/.test(trimmed)) continue;

    if (TARGET.has(trimmed)) {
      flush();
      current = trimmed;
    } else if (current) {
      buffer.push(trimmed);
    }
  }
  flush();
  return sections;
}

/**
 * Extracts named sections from chrome://system HTML output (including
 * quoted-printable encoded page source saved from a network capture).
 * Returns a map of section_name -> plain text content.
 */
function extractHtmlSections(raw: string): Record<string, string> {
  const decoded = decodeEntities(decodeQP(raw));
  const sections: Record<string, string> = {};
  const nameRe = /name="([^"]+)"/g;
  let m: RegExpExecArray | null;

  while ((m = nameRe.exec(decoded)) !== null) {
    const sectionName = m[1];
    const tail = decoded.slice(m.index + m[0].length);
    const marker = 'class="stat-value">';
    const si = tail.indexOf(marker);
    if (si === -1) continue;
    const ci = si + marker.length;
    const ei = tail.indexOf('</span>', ci);
    if (ei === -1) continue;
    sections[sectionName] = stripTags(tail.slice(ci, ei)).trim();
  }

  return sections;
}

// ---------------------------------------------------------------------------
// Network device + service interfaces and parsers (Steps 2 & 3)
// ---------------------------------------------------------------------------

export interface NetworkDeviceInfo {
  macAddress?: string;
  interface?: string;
  ipv4Address?: string;
  ipv4Gateway?: string;
  nameServers?: string[];
  linkStats?: {
    avgSignalDbm?: number;
    lastSignalDbm?: number;
    receiveBitrate?: string;
    transmitBitrate?: string;
    transmitRetries?: number;
    packetRx?: number;
    packetTx?: number;
  };
  wakeOnWiFiAllowed?: boolean;
  wakeOnWiFiSupported?: boolean;
  macRandomizationEnabled?: boolean;
  bgscanSignalThreshold?: number;
}

export interface NetworkServiceInfo {
  ssid?: string;
  bssid?: string;
  security?: string;
  state?: string;
  strength?: number;
  signalRssi?: number;
  frequency?: number;
  frequencyList?: number[];
  phyMode?: number;
  band?: string;
  channel?: number;
  downlinkMbps?: number;
  uplinkMbps?: number;
  ipv4Address?: string;
  ipv4Gateway?: string;
  nameServers?: string[];
  disconnectCount?: number;
  misconnectCount?: number;
  error?: string;
  country?: string;
  keyMgmt?: string;
  roamState?: string;
  isConnected?: boolean;
  eap?: { method?: string; identity?: string };
}

export const PHY_MODE_LABELS: Record<number, string> = {
  1: '802.11a', 2: '802.11b', 3: '802.11g',
  4: 'Wi-Fi 4 (802.11n)', 5: 'Wi-Fi 5 (802.11ac)',
  6: 'Wi-Fi 6 (802.11ax)', 7: 'Wi-Fi 6E / Wi-Fi 7',
};

function freqToBand(freq: number): string {
  if (freq < 3000) return '2.4 GHz';
  if (freq < 5925) return '5 GHz';
  return '6 GHz';
}

function freqToChannel(freq: number): number {
  if (freq >= 2412 && freq <= 2472) return Math.round((freq - 2412) / 5) + 1;
  if (freq === 2484) return 14;
  if (freq >= 5000) return Math.round((freq - 5000) / 5);
  return 0;
}

function parseNetworkDeviceJson(json: string): NetworkDeviceInfo | null {
  try {
    const data = JSON.parse(json);
    const key = Object.keys(data).find(k => k.includes('wlan'));
    if (!key) return null;
    const d = data[key];
    const configs = Object.values((d.IPConfigs || {}) as Record<string, any>);
    const v4 = configs.find((c: any) => c.Method === 'dhcp') as any;
    const ls = d.LinkStatistics || {};
    return {
      macAddress: d.Address,
      interface: d.Interface || d.Name,
      ipv4Address: v4?.Address,
      ipv4Gateway: v4?.Gateway,
      nameServers: v4?.NameServers,
      linkStats: {
        avgSignalDbm: ls.AverageReceiveSignalDbm,
        lastSignalDbm: ls.LastReceiveSignalDbm,
        receiveBitrate: ls.ReceiveBitrate,
        transmitBitrate: ls.TransmitBitrate,
        transmitRetries: ls.TransmitRetries != null ? Math.round(ls.TransmitRetries) : undefined,
        packetRx: ls.PacketReceiveSuccesses != null ? Math.round(ls.PacketReceiveSuccesses) : undefined,
        packetTx: ls.PacketTransmitSuccesses != null ? Math.round(ls.PacketTransmitSuccesses) : undefined,
      },
      wakeOnWiFiAllowed: d.WakeOnWiFiAllowed,
      wakeOnWiFiSupported: d.WakeOnWiFiSupported,
      macRandomizationEnabled: d.MACAddressRandomizationEnabled,
      bgscanSignalThreshold: d.BgscanSignalThreshold,
    };
  } catch {
    return null;
  }
}

function parseNetworkServiceJson(json: string): NetworkServiceInfo | null {
  try {
    const data = JSON.parse(json);
    const key = Object.keys(data).find(k => {
      const s = data[k];
      return s.IsConnected === true || s.State === 'online' || s.State === 'ready';
    });
    if (!key) return null;
    const s = data[key];
    const nc = s.NetworkConfig || {};
    const freq: number | undefined = s['WiFi.Frequency'];
    return {
      ssid: s.Name,
      bssid: s['WiFi.BSSID'],
      security: s.Security,
      state: s.State,
      strength: s.Strength,
      signalRssi: s['WiFi.SignalStrengthRssi'],
      frequency: freq,
      frequencyList: s['WiFi.FrequencyList'],
      phyMode: s['WiFi.PhyMode'],
      band: freq ? freqToBand(freq) : undefined,
      channel: freq ? freqToChannel(freq) : undefined,
      downlinkMbps: s.DownlinkSpeedKbps ? Math.round(s.DownlinkSpeedKbps / 100) / 10 : undefined,
      uplinkMbps: s.UplinkSpeedKbps ? Math.round(s.UplinkSpeedKbps / 100) / 10 : undefined,
      ipv4Address: nc.IPv4Address?.split('/')[0],
      ipv4Gateway: nc.IPv4Gateway,
      nameServers: nc.NameServers,
      disconnectCount: s['Diagnostics.Disconnects']?.length ?? 0,
      misconnectCount: s['Diagnostics.Misconnects']?.length ?? 0,
      error: s.Error !== 'no-failure' ? s.Error : undefined,
      country: s.Country,
      keyMgmt: s['EAP.KeyMgmt'],
      roamState: s['WiFi.RoamState'],
      isConnected: s.IsConnected,
      eap: s['EAP.EAP'] ? { method: s['EAP.EAP'], identity: s['EAP.Identity'] } : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Converts rich system-parsed network data into a ParsedService so the main
 * dashboard can be populated from a chrome://system paste (no crosh needed).
 */
export function networkServiceToParsedService(
  ns: NetworkServiceInfo,
  nd?: NetworkDeviceInfo
): ParsedService {
  return {
    name: ns.ssid || 'Unknown',
    type: 'wifi',
    state: ns.state || 'unknown',
    security: ns.security || 'unknown',
    strength: String(ns.strength ?? 0),
    lastSignal: nd?.linkStats?.lastSignalDbm != null
      ? String(nd.linkStats.lastSignalDbm)
      : ns.signalRssi != null ? String(ns.signalRssi) : undefined,
    avgSignal: nd?.linkStats?.avgSignalDbm != null
      ? String(nd.linkStats.avgSignalDbm) : undefined,
    txFailures: nd?.linkStats?.transmitRetries != null
      ? String(nd.linkStats.transmitRetries) : undefined,
    txSuccesses: nd?.linkStats?.packetTx != null
      ? String(nd.linkStats.packetTx) : undefined,
    ip: ns.ipv4Address || nd?.ipv4Address,
    eap: ns.eap ? { method: ns.eap.method, identity: ns.eap.identity } : undefined,
    psk: ns.keyMgmt ? { key_mgmt: ns.keyMgmt } : undefined,
  };
}

// ---------------------------------------------------------------------------
// SystemInfo interface + parseSystemInfo
// ---------------------------------------------------------------------------

export interface SystemInfo {
  lspci?: string[];
  lsusb?: string[];
  cpuinfo?: string;
  meminfo?: string;
  version?: string;
  os_version?: string;
  firmware_version?: string;
  // New fields
  wifiChipset?: string;
  board?: string;
  channel?: string;
  milestone?: string;
  networkDevice?: NetworkDeviceInfo;
  networkService?: NetworkServiceInfo;
}

export function parseSystemInfo(text: string): SystemInfo {
  const info: SystemInfo = {};

  // 1. Try HTML extraction (QP-encoded page source / network capture)
  const htmlSections = extractHtmlSections(text);
  // 2. Try plain-text extraction (Ctrl+A, Ctrl+C from Chrome's chrome://system)
  const plainSections = Object.keys(htmlSections).length === 0
    ? extractPlainTextSections(text)
    : {};

  const sections = Object.keys(htmlSections).length > 0 ? htmlSections : plainSections;

  // Populate fields from whichever extractor found sections
  if (sections.lspci) {
    info.lspci = sections.lspci.split('\n').map(l => l.trim()).filter(Boolean);
  }
  if (sections.lsusb) {
    info.lsusb = sections.lsusb.split('\n').map(l => l.trim()).filter(Boolean);
  }
  if (sections.meminfo) {
    info.meminfo = sections.meminfo;
  }
  if (sections.network_devices) {
    info.networkDevice = parseNetworkDeviceJson(sections.network_devices) ?? undefined;
  }
  if (sections.network_services) {
    info.networkService = parseNetworkServiceJson(sections.network_services) ?? undefined;
  }

  // CHROMEOS_RELEASE_* — plain-text format has these as individual sections
  // whose content is just the bare value (e.g. "16581.42.0").
  // QP/HTML format has them as key=value pairs in the raw text (handled by regex below).
  if (sections.CHROMEOS_RELEASE_VERSION) info.os_version = sections.CHROMEOS_RELEASE_VERSION;
  if (sections.CHROMEOS_RELEASE_CHROME_MILESTONE) info.milestone = sections.CHROMEOS_RELEASE_CHROME_MILESTONE;
  if (sections.CHROMEOS_RELEASE_TRACK) info.channel = sections.CHROMEOS_RELEASE_TRACK;
  if (sections.CHROMEOS_RELEASE_BOARD) info.board = sections.CHROMEOS_RELEASE_BOARD;
  if (sections.CHROMEOS_RELEASE_BUILDER_PATH) info.version = sections.CHROMEOS_RELEASE_BUILDER_PATH;

  // Wi-Fi chipset: find the Network Controller line in lspci
  if (info.lspci) {
    const wifiLine = info.lspci.find(l => /network controller|wireless|wi-?fi/i.test(l));
    if (wifiLine) {
      info.wifiChipset = wifiLine.replace(/^[0-9a-f:.]+\s+/i, '').replace(/^[^:]+:\s*/, '').trim();
    }
  }

  // Regex fallback for QP/HTML format where CHROMEOS fields appear as key=value
  // (only fills fields not already populated from sections above)
  if (!info.os_version) {
    const m = text.match(/CHROMEOS_RELEASE_VERSION=(?:3D)?([\d.]+)/);
    if (m) info.os_version = m[1];
  }
  if (!info.milestone) {
    const m = text.match(/CHROMEOS_RELEASE_CHROME_MILESTONE=(?:3D)?(\d+)/);
    if (m) info.milestone = m[1];
  }
  if (!info.channel) {
    const m = text.match(/CHROMEOS_RELEASE_TRACK=(?:3D)?([^\s<&]+)/);
    if (m) info.channel = m[1];
  }
  if (!info.board) {
    const m = text.match(/CHROMEOS_RELEASE_BOARD=(?:3D)?([^\s<&]+)/);
    if (m) info.board = m[1];
  }
  if (!info.version) {
    const m = text.match(/CHROMEOS_RELEASE_BUILDER_PATH=(?:3D)?([^\s<&]+)/);
    if (m) info.version = m[1];
  }

  return info;
}

// ---------------------------------------------------------------------------
// chrome://device-log parser
// ---------------------------------------------------------------------------

export type DeviceLogLevel = 'debug' | 'event' | 'user' | 'error';
export type DeviceLogCategory = 'signal' | 'speed' | 'state' | 'slow' | 'error' | 'other';

export interface DeviceLogEntry {
  timestamp: string;    // "2026/04/01 17:54:49.102500"
  displayTime: string;  // "17:54:49"
  level: DeviceLogLevel;
  source: string;       // "network_state_handler.cc:2234"
  message: string;
  category: DeviceLogCategory;
  rssi?: number;
  strength?: number;
  speedKbps?: number;
  speedDir?: 'up' | 'down';
  bssid?: string;       // e.g. "e6:55:b8:ac:ac:b1"
  frequency?: number;   // e.g. 5500 (MHz)
}

export interface RoamingSession {
  bssid: string;
  frequency: number | null;
  band: '2.4GHz' | '5GHz' | '6GHz' | 'unknown';
  startTimestamp: string;
  endTimestamp: string;
  startEntryIdx: number;
  endEntryIdx: number;
  durationMs: number;
}

/** Format a raw log message into a compact, human-readable string. */
export function formatDeviceLogMessage(entry: DeviceLogEntry): string {
  const msg = entry.message;

  // Property update: "DefaultNetworkPropertyUpdated: wifi_psk_0, Foo = Bar"
  const propM = msg.match(/DefaultNetworkPropertyUpdated:\s*\S+,\s*(.+)$/);
  if (propM) {
    const prop = propM[1].trim();
    // RSSI
    const rssiM = prop.match(/WiFi\.SignalStrengthRssi\s*=\s*(-?\d+)/);
    if (rssiM) return `RSSI: ${rssiM[1]} dBm`;
    // Strength
    const strM = prop.match(/^Strength\s*=\s*(\d+)/);
    if (strM) return `Signal Strength: ${strM[1]}%`;
    // Uplink speed
    const upM = prop.match(/UplinkSpeedKbps\s*=\s*(\d+)/);
    if (upM) return `↑ Uplink: ${(parseInt(upM[1]) / 1000).toFixed(1)} Mbps`;
    // Downlink speed
    const dnM = prop.match(/DownlinkSpeedKbps\s*=\s*(\d+)/);
    if (dnM) return `↓ Downlink: ${(parseInt(dnM[1]) / 1000).toFixed(1)} Mbps`;
    return prop;
  }

  // Slow method: "@@@ Slow method: .../FileName.cc:MethodName: Nms"
  const slowM = msg.match(/@@@\s*Slow method:\s*.*\/([^/]+\.cc:\w+):\s*(\d+ms)/);
  if (slowM) return `Slow: ${slowM[1]} (${slowM[2]})`;

  // ActiveNetworksChanged
  if (msg.includes('ActiveNetworksChanged')) return 'Active Networks Changed';

  return msg;
}

export function extractRoamingSessions(entries: DeviceLogEntry[]): RoamingSession[] {
  function tsToMs(ts: string): number {
    return new Date(ts.replace(/(\d{4})\/(\d{2})\/(\d{2})/, '$1-$2-$3')).getTime();
  }

  function bandFromFreq(freq: number | null): RoamingSession['band'] {
    if (freq === null) return 'unknown';
    if (freq < 3000) return '2.4GHz';
    if (freq < 5925) return '5GHz';
    return '6GHz';
  }

  const sessions: RoamingSession[] = [];
  let currentBssid: string | null = null;
  let currentFreq: number | null = null;
  let sessionStartIdx = 0;

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];

    if (entry.frequency !== undefined) {
      currentFreq = entry.frequency;
    }

    if (entry.bssid !== undefined) {
      if (currentBssid === null) {
        currentBssid = entry.bssid;
        sessionStartIdx = i;
      } else if (entry.bssid !== currentBssid) {
        const startTs = entries[sessionStartIdx].timestamp;
        const endTs = entries[i - 1].timestamp;
        sessions.push({
          bssid: currentBssid,
          frequency: currentFreq,
          band: bandFromFreq(currentFreq),
          startTimestamp: startTs,
          endTimestamp: endTs,
          startEntryIdx: sessionStartIdx,
          endEntryIdx: i - 1,
          durationMs: tsToMs(endTs) - tsToMs(startTs),
        });
        currentBssid = entry.bssid;
        currentFreq = entry.frequency ?? currentFreq;
        sessionStartIdx = i;
      }
    }
  }

  if (currentBssid !== null) {
    const startTs = entries[sessionStartIdx].timestamp;
    const endTs = entries[entries.length - 1].timestamp;
    sessions.push({
      bssid: currentBssid,
      frequency: currentFreq,
      band: bandFromFreq(currentFreq),
      startTimestamp: startTs,
      endTimestamp: endTs,
      startEntryIdx: sessionStartIdx,
      endEntryIdx: entries.length - 1,
      durationMs: tsToMs(endTs) - tsToMs(startTs),
    });
  }

  return sessions;
}

export function parseDeviceLog(raw: string): DeviceLogEntry[] {
  // Decode quoted-printable (handles =XX sequences and soft line breaks)
  const decoded = raw
    .replace(/=\r?\n/g, '')
    .replace(/=([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));

  const entries: DeviceLogEntry[] = [];
  const pRe = /<p>([\s\S]*?)<\/p>/g;
  let m: RegExpExecArray | null;

  while ((m = pRe.exec(decoded)) !== null) {
    const block = m[1];

    // Extract log level from CSS class
    const levelM = block.match(/log-level-(\w+)/);
    if (!levelM) continue;
    const level = levelM[1].toLowerCase() as DeviceLogLevel;

    // Strip HTML comments and tags → plain text, collapse whitespace
    const text = block
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    // Extract timestamp — supports both full format [YYYY/MM/DD HH:MM:SS.micros]
    // and short format [HH:MM:SS] (newer ChromeOS versions)
    const tsFullM = text.match(/\[(\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}\.\d+)\]/);
    const tsShortM = text.match(/\[(\d{2}:\d{2}:\d{2})\]/);
    if (!tsFullM && !tsShortM) continue;

    const timestamp = tsFullM ? tsFullM[1] : `2026/04/03 ${tsShortM![1]}.000000`;
    const displayTime = (tsFullM ? tsFullM[1] : tsShortM![1]).split(' ')[0]?.slice(0, 8) ?? timestamp;

    // Split remainder into source (file:line) and message
    const tsMarker = tsFullM ? tsFullM[0] : tsShortM![0];
    const rest = text.slice(text.indexOf(tsMarker) + tsMarker.length).trim();

    let source: string;
    let message: string;

    if (tsFullM) {
      // Full format: "[timestamp] source_file:line message"
      const parts = rest.split(/\s+/);
      source = parts[0] ?? '';
      message = parts.slice(1).join(' ').trim();
    } else {
      // Short format: "[HH:MM:SS] message" (no source file)
      source = '';
      message = rest;
    }

    if (!message) continue;

    // Skip high-noise entries that add no diagnostic value
    if (message.startsWith('GetShillProperties:')) continue;
    if (message.startsWith('NOTIFY: NetworkPropertiesUpdated:')) continue;
    if (message.includes('Host networks are considered equivalent to ARC')) continue;
    // DefaultNetworkChanged is always paired with a more specific DefaultNetworkPropertyUpdated
    if (message.startsWith('NOTIFY: DefaultNetworkChanged:')) continue;

    // Categorize and extract typed values
    let category: DeviceLogCategory = 'other';
    let rssi: number | undefined;
    let strength: number | undefined;
    let speedKbps: number | undefined;
    let speedDir: 'up' | 'down' | undefined;
    let bssid: string | undefined;
    let frequency: number | undefined;

    const bssidM2 = message.match(/WiFi\.BSSID\s*=\s*"([0-9a-fA-F:]{17})"/);
    if (bssidM2) bssid = bssidM2[1].toLowerCase();
    const freqM2 = message.match(/WiFi\.Frequency\s*=\s*(\d+)/);
    if (freqM2) frequency = parseInt(freqM2[1]);

    if (level === 'error') {
      category = 'error';
    } else if (message.includes('@@@ Slow method')) {
      category = 'slow';
    } else if (message.includes('SignalStrengthRssi') || /,\s*Strength\s*=/.test(message)) {
      category = 'signal';
      const rssiM = message.match(/SignalStrengthRssi\s*=\s*(-?\d+)/);
      if (rssiM) rssi = parseInt(rssiM[1]);
      const strM = message.match(/,\s*Strength\s*=\s*(\d+)/);
      if (strM) strength = parseInt(strM[1]);
    } else if (message.includes('SpeedKbps')) {
      category = 'speed';
      const upM = message.match(/UplinkSpeedKbps\s*=\s*(\d+)/);
      const dnM = message.match(/DownlinkSpeedKbps\s*=\s*(\d+)/);
      if (upM) { speedKbps = parseInt(upM[1]); speedDir = 'up'; }
      else if (dnM) { speedKbps = parseInt(dnM[1]); speedDir = 'down'; }
    } else if (
      message.includes('ActiveNetworksChanged') ||
      message.includes('Connected') ||
      message.includes('Disconnect') ||
      message.includes('State =')
    ) {
      category = 'state';
    }

    entries.push({ timestamp, displayTime, level, source, message, category, rssi, strength, speedKbps, speedDir, bssid, frequency });
  }

  // Reverse so oldest entries appear first (chronological order)
  return entries.reverse();
}
