/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { 
  Wifi, 
  WifiOff, 
  Activity, 
  AlertCircle, 
  CheckCircle2, 
  ChevronRight, 
  Terminal, 
  MessageSquare,
  RefreshCw,
  Info,
  ShieldAlert,
  Download,
  ExternalLink,
  Copy,
  Cpu,
  Globe,
  Lock,
  Keyboard,
  X,
  Upload,
  FileText
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { GoogleGenAI } from "@google/genai";
import { checkLatency, checkDNS, getChromebookInfo, ParsedService, parseSystemInfo, SystemInfo, PHY_MODE_LABELS, networkServiceToParsedService } from './lib/diagnostics';

// --- Types ---
interface DiagnosticResult {
  id: string;
  name: string;
  status: 'pending' | 'success' | 'error' | 'warning';
  value?: string;
  details?: string;
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

// --- Components ---
const SignalStrength = ({ strength }: { strength: string | number }) => {
  const s = typeof strength === 'string' ? parseInt(strength) : strength;
  const bars = [
    { threshold: 0, color: 'bg-red-500' },
    { threshold: 25, color: 'bg-amber-500' },
    { threshold: 50, color: 'bg-green-500' },
    { threshold: 75, color: 'bg-green-500' },
  ];

  return (
    <div className="flex items-end gap-[2px] h-4">
      {bars.map((bar, i) => (
        <div 
          key={i}
          className={`w-1 rounded-t-sm transition-all duration-500 ${
            s > bar.threshold ? bar.color : 'bg-gray-200'
          }`}
          style={{ height: `${(i + 1) * 25}%` }}
        />
      ))}
    </div>
  );
};

export default function App() {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [diagnostics, setDiagnostics] = useState<DiagnosticResult[]>([
    { id: 'browser', name: 'Browser Status', status: 'pending' },
    { id: 'latency', name: 'Ping Latency', status: 'pending' },
    { id: 'dns', name: 'DNS Resolution', status: 'pending' },
    { id: 'ip_res', name: 'IP Resolution', status: 'pending' },
    { id: 'device', name: 'ChromeOS Check', status: 'pending' },
    { id: 'signal', name: 'Signal Strength', status: 'pending' },
  ]);
  const [isScanning, setIsScanning] = useState(false);
  const [showAIChat, setShowAIChat] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    { role: 'assistant', content: "Hello! I'm your Chromebook Wi-Fi assistant. I've detected your current network state. How can I help you troubleshoot today?" }
  ]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [parsedService, setParsedService] = useState<ParsedService | null>(null);
  const [showSystemAnalyzer, setShowSystemAnalyzer] = useState(false);
  const systemFileContentRef = useRef<string>('');
  const systemFileInputRef = useRef<HTMLInputElement>(null);
  const [systemFileName, setSystemFileName] = useState<string | null>(null);
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
  const [systemError, setSystemError] = useState<string | null>(null);

  // --- Effects ---
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    runDiagnostics();

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // --- Logic ---
  const handleAnalyzeSystem = () => {
    setSystemError(null);
    const rawText = systemFileContentRef.current;
    if (!rawText.trim()) {
      setSystemError("Please select a file first.");
      return;
    }
    const result = parseSystemInfo(rawText);
    const hasData = result.lspci || result.lsusb || result.version || result.os_version
      || result.networkDevice || result.networkService;

    if (hasData) {
      setSystemInfo(result);

      // Populate the main dashboard from network_services + network_devices
      // if no crosh data has been loaded yet (or as a richer replacement)
      if (result.networkService) {
        const ps = networkServiceToParsedService(result.networkService, result.networkDevice);
        setParsedService(ps);
        setDiagnostics(prev => prev.map(d => {
          if (d.id === 'signal' && result.networkService?.strength != null)
            return { ...d, status: 'success', value: `${result.networkService!.strength}%` };
          if (d.id === 'ip_res' && ps.ip)
            return { ...d, status: 'success', value: ps.ip };
          return d;
        }));
      }

      const ns = result.networkService;
      const nd = result.networkDevice;
      const parts: string[] = [];
      if (result.wifiChipset) parts.push(`**Chipset:** ${result.wifiChipset}`);
      if (ns?.ssid) parts.push(`**Network:** ${ns.ssid} (${ns.band ?? ''} Ch.${ns.channel ?? ''})`);
      if (nd?.linkStats?.receiveBitrate) parts.push(`**Link:** ${nd.linkStats.receiveBitrate}`);
      if (ns?.disconnectCount !== undefined) parts.push(`**Disconnects:** ${ns.disconnectCount}`);

      setMessages(prev => [...prev, {
        role: 'assistant',
        content: parts.length > 0
          ? `I've analyzed your system info.\n${parts.join(' · ')}`
          : `I've analyzed your system information. I found details for your ${result.lspci ? 'PCI devices' : ''} ${result.lsusb ? 'and USB devices' : ''}. This helps me understand your hardware drivers better.`
      }]);
      setShowSystemAnalyzer(false);
    } else {
      setSystemError("Could not find any recognizable system information. Please ensure you copied the content from 'chrome://system'.");
    }
  };

  const runDiagnostics = async () => {
    setIsScanning(true);
    
    const steps: DiagnosticResult[] = [
      { id: 'browser', name: 'Browser Status', status: navigator.onLine ? 'success' : 'error', value: navigator.onLine ? 'Online' : 'Offline' },
      { id: 'latency', name: 'Ping Latency', status: 'pending' },
      { id: 'dns', name: 'DNS Resolution', status: 'pending' },
      { id: 'ip_res', name: 'IP Resolution', status: parsedService?.ip ? 'success' : 'pending', value: parsedService?.ip },
      { id: 'device', name: 'ChromeOS Check', status: 'pending' },
      { id: 'signal', name: 'Signal Strength', status: parsedService ? 'success' : 'pending', value: parsedService ? `${parsedService.strength}%` : undefined },
    ];
    setDiagnostics([...steps]);

    // Step 2: Latency
    const latency = await checkLatency();
    steps[1] = { 
      ...steps[1], 
      status: latency === null ? 'error' : (latency < 150 ? 'success' : 'warning'), 
      value: latency === null ? 'Failed' : `${latency}ms` 
    };
    setDiagnostics([...steps]);

    // Step 3: DNS
    const dnsSuccess = await checkDNS();
    steps[2] = { 
      ...steps[2], 
      status: dnsSuccess ? 'success' : 'error', 
      value: dnsSuccess ? 'Resolved' : 'Failed' 
    };
    setDiagnostics([...steps]);

    // Step 4: Device Info
    const info = getChromebookInfo();
    steps[4] = { 
      ...steps[4], 
      status: info.isChromebook ? 'success' : 'warning', 
      value: info.isChromebook ? 'Chromebook' : 'Non-ChromeOS' 
    };
    setDiagnostics([...steps]);

    setIsScanning(false);
  };

  const handleSendMessage = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!input.trim()) return;

    const userMsg = input.trim();
    setMessages(prev => [...prev, { role: 'user', content: userMsg }]);
    setInput('');
    setIsTyping(true);

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const model = "gemini-3-flash-preview";
      
      const diagnosticContext = diagnostics.map(d => `${d.name}: ${d.value || d.status}`).join(', ');
      const deviceInfo = JSON.stringify(getChromebookInfo());
      
      const response = await ai.models.generateContent({
        model,
        contents: `The user is on a Chromebook. Current network diagnostics: ${diagnosticContext}. Device Info: ${deviceInfo}. User says: ${userMsg}`,
        config: {
          systemInstruction: "You are a Chromebook Wi-Fi troubleshooting expert. Provide concise, step-by-step advice. Mention Chromebook-specific features like 'crosh', 'ChromeOS settings', or 'hardware switches' if relevant. Keep it technical but accessible. If the user is offline, explain that your AI capabilities are limited but provide standard offline fixes.",
        }
      });

      setMessages(prev => [...prev, { role: 'assistant', content: response.text || "I'm having trouble analyzing that right now. Try checking your physical Wi-Fi switch." }]);
    } catch (error) {
      console.error(error);
      setMessages(prev => [...prev, { role: 'assistant', content: "I'm offline or unable to reach my brain. Please check your connection." }]);
    } finally {
      setIsTyping(false);
    }
  };

  const generateReport = () => {
    const reportText = `
ChromeOS Wi-Fi Diagnostic Report
Generated: ${new Date().toLocaleString()}
----------------------------------
${diagnostics.map(d => `${d.name}: ${d.value || d.status}`).join('\n')}
----------------------------------
Device Info:
${JSON.stringify(getChromebookInfo(), null, 2)}
    `;
    const blob = new Blob([reportText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `wifi-report-${Date.now()}.txt`;
    a.click();
  };

  return (
    <div className="min-h-screen bg-[#F8F9FA] text-[#202124] font-sans selection:bg-[#4285F4] selection:text-white">
      {/* Google Branding Bar */}
      <div className="h-1 w-full flex">
        <div className="h-full w-1/4 bg-[#4285F4]" />
        <div className="h-full w-1/4 bg-[#EA4335]" />
        <div className="h-full w-1/4 bg-[#FBBC05]" />
        <div className="h-full w-1/4 bg-[#34A853]" />
      </div>

      {/* Header */}
      <header className="border-b border-gray-200 p-4 flex justify-between items-center bg-white sticky top-0 z-50 shadow-sm">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-[#4285F4] flex items-center justify-center text-white font-bold text-lg">G</div>
            <div className="h-6 w-[1px] bg-gray-300 mx-1" />
            <Wifi className="w-5 h-5 text-[#5F6368]" />
          </div>
          <div>
            <h1 className="font-medium text-lg tracking-tight text-[#202124]">ChromeOS Connectivity Diagnostics</h1>
            <p className="text-[10px] uppercase tracking-widest text-[#5F6368] font-medium">Official Support Utility</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button 
            onClick={() => setShowSystemAnalyzer(true)}
            className="px-4 py-2 text-[11px] font-medium uppercase tracking-wider text-[#5F6368] hover:bg-gray-100 rounded-md transition-colors flex items-center gap-2"
          >
            <Cpu className="w-4 h-4" />
            System Info
          </button>
          <button
            onClick={() => setShowAIChat(true)}
            className="px-4 py-2 text-[11px] font-medium uppercase tracking-wider bg-[#4285F4] text-white hover:bg-[#1A73E8] rounded-md transition-colors flex items-center gap-2 shadow-sm"
          >
            <MessageSquare className="w-4 h-4" />
            AI Assistant
          </button>
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-md border border-gray-200 text-[11px] font-medium ${isOnline ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
            <div className={`w-2 h-2 rounded-full ${isOnline ? 'bg-green-600 animate-pulse' : 'bg-red-600'}`} />
            {isOnline ? 'ONLINE' : 'OFFLINE'}
          </div>
        </div>
      </header>

      <main className="grid grid-cols-1 lg:grid-cols-12 min-h-[calc(100vh-73px)]">
        {/* Left Column: Diagnostics (Smaller) */}
        <section className="lg:col-span-3 border-r border-gray-200 p-0 flex flex-col bg-white">
          <div className="p-4 border-b border-gray-200 flex justify-between items-center bg-gray-50/50">
            <h2 className="font-medium text-sm text-[#5F6368] uppercase tracking-wider">Telemetry</h2>
            <div className="flex gap-1">
              <button 
                onClick={generateReport}
                className="p-2 hover:bg-gray-100 text-[#5F6368] transition-colors rounded-full"
                title="Download Report"
              >
                <Download className="w-4 h-4" />
              </button>
              <button 
                onClick={runDiagnostics}
                disabled={isScanning}
                className="p-2 hover:bg-gray-100 text-[#5F6368] transition-colors rounded-full disabled:opacity-30"
                title="Refresh Scan"
              >
                <RefreshCw className={`w-4 h-4 ${isScanning ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {diagnostics.map((item) => (
              <div key={item.id} className="group border-b border-gray-100 p-4 flex items-center justify-between hover:bg-blue-50/50 transition-all cursor-default">
                <div className="flex items-center gap-3">
                  <div className="opacity-20 font-mono text-[9px]">0{diagnostics.indexOf(item) + 1}</div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-[#5F6368] font-medium mb-0.5">{item.id}</div>
                    <div className="text-sm font-medium text-[#202124]">{item.name}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {item.id === 'signal' && item.value && (
                    <SignalStrength strength={item.value.replace('%', '')} />
                  )}
                  <div className="font-mono text-xs text-[#5F6368]">{item.value || '---'}</div>
                  {item.status === 'success' && <CheckCircle2 className="w-3.5 h-3.5 text-[#34A853]" />}
                  {item.status === 'error' && <AlertCircle className="w-3.5 h-3.5 text-[#EA4335]" />}
                  {item.status === 'warning' && <ShieldAlert className="w-3.5 h-3.5 text-[#FBBC05]" />}
                  {item.status === 'pending' && <Activity className="w-3.5 h-3.5 animate-pulse opacity-20" />}
                </div>
              </div>
            ))}

            <div className="p-6 space-y-4">
              <div className="p-3 bg-gray-50 border border-gray-200 rounded-lg">
                <div className="flex items-center gap-2 mb-2">
                  <Terminal className="w-3.5 h-3.5 text-[#5F6368]" />
                  <span className="text-[10px] font-bold text-[#5F6368] uppercase tracking-widest">Quick Tools</span>
                </div>
                <button 
                  onClick={() => setShowShortcuts(true)}
                  className="w-full text-left text-xs text-[#4285F4] hover:underline flex items-center justify-between group"
                >
                  View Shortcuts
                  <ChevronRight className="w-3 h-3 group-hover:translate-x-1 transition-transform" />
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* Right Column: AI Assistant */}
        {/* Right Column: Active Network Info & Main Content */}
        <section className="lg:col-span-9 flex flex-col bg-gray-50/30">
          <div className="flex-1 p-8 overflow-y-auto">
            <div className="max-w-4xl mx-auto space-y-8">
              {/* Active Network Card */}
              <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
                <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-white">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-blue-50 rounded-lg">
                      <Wifi className="w-6 h-6 text-[#4285F4]" />
                    </div>
                    <div>
                      <h3 className="text-lg font-medium text-[#202124]">Active Network</h3>
                      <p className="text-xs text-[#5F6368]">Real-time connection status and telemetry</p>
                    </div>
                  </div>
                  <div className={`px-3 py-1 rounded-full text-[11px] font-bold tracking-wider ${isOnline ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                    {isOnline ? 'CONNECTED' : 'DISCONNECTED'}
                  </div>
                </div>

                <div className="p-8 grid grid-cols-1 md:grid-cols-2 gap-8">
                  {parsedService ? (
                    <>
                      <div className="space-y-6">
                        <div>
                          <label className="text-[10px] font-bold text-[#5F6368] uppercase tracking-widest block mb-1">Network SSID</label>
                          <div className="text-2xl font-medium text-[#202124]">{parsedService.name || 'Unknown Network'}</div>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <label className="text-[10px] font-bold text-[#5F6368] uppercase tracking-widest block mb-1">Security</label>
                            <div className="text-sm font-medium text-[#202124] flex items-center gap-2">
                              <Lock className="w-3.5 h-3.5 text-[#5F6368]" />
                              {parsedService.security || 'None'}
                            </div>
                          </div>
                          <div>
                            <label className="text-[10px] font-bold text-[#5F6368] uppercase tracking-widest block mb-1">Band / Channel</label>
                            <div className="text-sm font-medium text-[#202124]">
                              {systemInfo?.networkService?.band
                                ? `${systemInfo.networkService.band}${systemInfo.networkService.channel ? ` · Ch. ${systemInfo.networkService.channel}` : ''}`
                                : '---'}
                            </div>
                          </div>
                        </div>
                        <div>
                          <label className="text-[10px] font-bold text-[#5F6368] uppercase tracking-widest block mb-1">IP Address</label>
                          <div className="text-sm font-mono text-[#202124] bg-gray-50 px-3 py-2 rounded border border-gray-100 inline-block">
                            {parsedService.ip || 'Not Assigned'}
                          </div>
                        </div>
                      </div>

                      <div className="space-y-6">
                        <div>
                          <label className="text-[10px] font-bold text-[#5F6368] uppercase tracking-widest block mb-1">Signal Quality</label>
                          <div className="flex items-end gap-4">
                            <div className="text-4xl font-medium text-[#202124]">{parsedService.strength}%</div>
                            <div className="pb-1">
                              <SignalStrength strength={parsedService.strength} />
                            </div>
                          </div>
                        </div>
                        <div className="p-4 bg-blue-50/50 rounded-xl border border-blue-100/50 space-y-3">
                          <div className="flex justify-between items-center">
                            <span className="text-xs text-[#5F6368]">Last Signal</span>
                            <span className="text-xs font-mono font-medium text-[#202124]">{parsedService.lastSignal} dBm</span>
                          </div>
                          <div className="flex justify-between items-center">
                            <span className="text-xs text-[#5F6368]">Avg Signal</span>
                            <span className="text-xs font-mono font-medium text-[#202124]">{parsedService.avgSignal} dBm</span>
                          </div>
                          <div className="pt-2 border-t border-blue-100 flex justify-between items-center">
                            <span className="text-xs text-[#5F6368]">Packet Success</span>
                            <span className="text-xs font-mono font-medium text-green-600">+{parsedService.txSuccesses}</span>
                          </div>
                          <div className="flex justify-between items-center">
                            <span className="text-xs text-[#5F6368]">Packet Failures</span>
                            <span className="text-xs font-mono font-medium text-red-600">-{parsedService.txFailures}</span>
                          </div>
                        </div>
                      </div>
                      {/* PSK / EAP details — full-width row */}
                      {(parsedService.psk || parsedService.eap) && (
                        <div className="col-span-2">
                          {parsedService.eap ? (
                            <div className="p-4 bg-blue-50 border border-blue-100 rounded-2xl">
                              <div className="text-[10px] font-bold text-[#4285F4] uppercase tracking-widest mb-3 flex items-center gap-2">
                                <Lock className="w-3.5 h-3.5" />
                                802.1X (EAP) Details
                              </div>
                              <div className="grid grid-cols-2 gap-4 text-xs">
                                <div>
                                  <span className="text-[#5F6368]">Method</span>
                                  <div className="font-mono font-bold text-[#202124] mt-0.5">{parsedService.eap.method || '---'}</div>
                                </div>
                                <div>
                                  <span className="text-[#5F6368]">Identity</span>
                                  <div className="font-mono text-[#202124] mt-0.5">{parsedService.eap.identity || '---'}</div>
                                </div>
                              </div>
                            </div>
                          ) : (
                            <div className="p-4 bg-green-50 border border-green-100 rounded-2xl">
                              <div className="text-[10px] font-bold text-[#34A853] uppercase tracking-widest mb-3 flex items-center gap-2">
                                <Lock className="w-3.5 h-3.5" />
                                PSK Details
                              </div>
                              <div className="text-xs">
                                <span className="text-[#5F6368]">Key Management</span>
                                <div className="font-mono font-bold text-[#202124] mt-0.5">{parsedService.psk?.key_mgmt || 'WPA-PSK'}</div>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="col-span-2 py-12 text-center space-y-4">
                      <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto">
                        <Terminal className="w-8 h-8 text-gray-400" />
                      </div>
                      <div>
                        <h4 className="text-gray-900 font-medium">No Active Network Data</h4>
                        <p className="text-sm text-gray-500 max-w-xs mx-auto mt-1">
                          Use System Info to import telemetry from your Chromebook.
                        </p>
                      </div>
                      <button
                        onClick={() => setShowSystemAnalyzer(true)}
                        className="px-6 py-2 bg-[#4285F4] text-white rounded-full text-sm font-medium hover:bg-[#1A73E8] transition-colors shadow-md"
                      >
                        Open System Info
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Quick Actions / Status Summary */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm">
                  <div className="w-8 h-8 bg-green-50 rounded-lg flex items-center justify-center mb-3">
                    <Activity className="w-4 h-4 text-green-600" />
                  </div>
                  <div className="text-[10px] font-bold text-[#5F6368] uppercase tracking-widest mb-1">Latency</div>
                  <div className="text-xl font-medium text-[#202124]">
                    {diagnostics.find(d => d.id === 'latency')?.value || '---'}
                  </div>
                </div>
                <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm">
                  <div className="w-8 h-8 bg-blue-50 rounded-lg flex items-center justify-center mb-3">
                    <Globe className="w-4 h-4 text-blue-600" />
                  </div>
                  <div className="text-[10px] font-bold text-[#5F6368] uppercase tracking-widest mb-1">DNS Status</div>
                  <div className="text-xl font-medium text-[#202124]">
                    {diagnostics.find(d => d.id === 'dns')?.value || '---'}
                  </div>
                </div>
                <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm">
                  <div className="w-8 h-8 bg-purple-50 rounded-lg flex items-center justify-center mb-3">
                    <Cpu className="w-4 h-4 text-purple-600" />
                  </div>
                  <div className="text-[10px] font-bold text-[#5F6368] uppercase tracking-widest mb-1">ChromeOS</div>
                  <div className="text-xl font-medium text-[#202124]">
                    {diagnostics.find(d => d.id === 'chromeos')?.value || '---'}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Footer Branding */}
          <div className="p-6 border-t border-gray-200 bg-white flex justify-between items-center">
            <div className="flex items-center gap-4 text-[10px] font-medium text-[#5F6368] uppercase tracking-widest">
              <span>Diagnostic Engine v2.4</span>
              <span className="w-1 h-1 bg-gray-300 rounded-full" />
              <span>Google ChromeOS Verified</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 bg-[#34A853] rounded-full" />
              <span className="text-[10px] font-bold text-[#5F6368] uppercase tracking-widest">System Ready</span>
            </div>
          </div>
        </section>
      </main>

      {/* Shortcuts Modal */}
      <AnimatePresence>
        {showShortcuts && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowShortcuts(false)}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ scale: 0.95, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 20 }}
              className="relative bg-white w-full max-w-lg rounded-3xl shadow-2xl overflow-hidden border border-gray-200"
            >
              <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-white">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-blue-50 rounded-lg">
                    <Keyboard className="w-6 h-6 text-[#4285F4]" />
                  </div>
                  <div>
                    <h3 className="text-lg font-medium text-[#202124]">ChromeOS Shortcuts</h3>
                    <p className="text-xs text-[#5F6368]">Quick access to system tools</p>
                  </div>
                </div>
                <button 
                  onClick={() => setShowShortcuts(false)}
                  className="p-2 hover:bg-gray-100 rounded-full transition-colors"
                >
                  <X className="w-5 h-5 text-[#5F6368]" />
                </button>
              </div>
              <div className="p-6 space-y-6">
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-4 bg-gray-50 rounded-2xl border border-gray-100 hover:border-blue-200 transition-colors group">
                    <div className="text-[10px] font-bold text-[#4285F4] uppercase tracking-widest mb-2">Terminal</div>
                    <div className="font-medium text-sm text-[#202124] bg-white px-2 py-1 rounded-md border border-gray-200 inline-block shadow-sm">Ctrl + Alt + T</div>
                    <div className="text-xs text-[#5F6368] mt-2">Open Crosh Shell</div>
                  </div>
                  <div className="p-4 bg-gray-50 rounded-2xl border border-gray-100 hover:border-blue-200 transition-colors group">
                    <div className="text-[10px] font-bold text-[#4285F4] uppercase tracking-widest mb-2">Task Manager</div>
                    <div className="font-medium text-sm text-[#202124] bg-white px-2 py-1 rounded-md border border-gray-200 inline-block shadow-sm">Search + Esc</div>
                    <div className="text-xs text-[#5F6368] mt-2">Monitor Bandwidth</div>
                  </div>
                  <div className="p-4 bg-gray-50 rounded-2xl border border-gray-100 hover:border-blue-200 transition-colors group">
                    <div className="text-[10px] font-bold text-[#4285F4] uppercase tracking-widest mb-2">System Info</div>
                    <div className="font-medium text-sm text-[#202124] bg-white px-2 py-1 rounded-md border border-gray-200 inline-block shadow-sm">Ctrl + Alt + I</div>
                    <div className="text-xs text-[#5F6368] mt-2">Feedback Report</div>
                  </div>
                  <div className="p-4 bg-gray-50 rounded-2xl border border-gray-100 hover:border-blue-200 transition-colors group">
                    <div className="text-[10px] font-bold text-[#4285F4] uppercase tracking-widest mb-2">Settings</div>
                    <div className="font-medium text-sm text-[#202124] bg-white px-2 py-1 rounded-md border border-gray-200 inline-block shadow-sm">Alt + Shift + S</div>
                    <div className="text-xs text-[#5F6368] mt-2">Quick Settings</div>
                  </div>
                </div>
                <div className="bg-[#202124] text-white p-5 rounded-2xl shadow-lg">
                  <div className="flex items-center gap-2 mb-3">
                    <Terminal className="w-4 h-4 text-[#4285F4]" />
                    <div className="text-[10px] font-bold uppercase tracking-widest text-blue-400">Diagnostic Commands (Crosh)</div>
                  </div>
                  <ul className="text-xs font-mono space-y-3">
                    <li className="flex items-center gap-3">
                      <span className="text-blue-400">network_diag</span>
                      <span className="text-gray-400">—</span>
                      <span className="text-gray-300">Full network test</span>
                    </li>
                    <li className="flex items-center gap-3">
                      <span className="text-blue-400">ping google.com</span>
                      <span className="text-gray-400">—</span>
                      <span className="text-gray-300">Test latency</span>
                    </li>
                    <li className="flex items-center gap-3">
                      <span className="text-blue-400">top</span>
                      <span className="text-gray-400">—</span>
                      <span className="text-gray-300">Check CPU usage</span>
                    </li>
                    <li className="flex items-center justify-between gap-3 pt-2 border-t border-gray-700">
                      <div className="flex items-center gap-3">
                        <span className="text-green-400">chrome://system</span>
                        <span className="text-gray-400">—</span>
                        <span className="text-gray-300 italic">Hardware & Drivers</span>
                      </div>
                      <button 
                        onClick={() => navigator.clipboard.writeText('chrome://system')}
                        className="p-1 hover:bg-gray-700 rounded text-gray-400 hover:text-white transition-colors"
                        title="Copy URL"
                      >
                        <Copy className="w-3 h-3" />
                      </button>
                    </li>
                  </ul>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* System Info Analyzer Modal */}
      <AnimatePresence>
        {showSystemAnalyzer && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowSystemAnalyzer(false)}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ scale: 0.95, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 20 }}
              className="relative bg-white w-full max-w-5xl h-[85vh] rounded-3xl shadow-2xl overflow-hidden border border-gray-200 flex flex-col"
            >
              <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-white">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-blue-50 rounded-lg">
                    <Cpu className="w-6 h-6 text-[#4285F4]" />
                  </div>
                  <div>
                    <h3 className="text-lg font-medium text-[#202124]">System Info Analyzer</h3>
                    <p className="text-xs text-[#5F6368]">Extract driver and hardware info from chrome://system</p>
                  </div>
                </div>
                <button 
                  onClick={() => setShowSystemAnalyzer(false)}
                  className="p-2 hover:bg-gray-100 rounded-full transition-colors"
                >
                  <X className="w-5 h-5 text-[#5F6368]" />
                </button>
              </div>
              
              <div className="flex-1 overflow-y-auto p-8">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 h-full">
                  <div className="space-y-4 flex flex-col">
                    <div className="flex justify-between items-center">
                      <div className="text-[10px] font-bold text-[#5F6368] uppercase tracking-widest">1. Load System Output</div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => navigator.clipboard.writeText('chrome://system')}
                          className="text-[10px] font-bold text-[#4285F4] hover:bg-blue-50 px-3 py-1.5 rounded-full transition-colors uppercase tracking-widest flex items-center gap-1"
                          title="Copy URL to clipboard"
                        >
                          <Copy className="w-3 h-3" />
                          Copy URL
                        </button>
                        <button
                          onClick={() => window.open('chrome://system', '_blank')}
                          className="text-[10px] font-bold text-[#4285F4] hover:bg-blue-50 px-3 py-1.5 rounded-full transition-colors uppercase tracking-widest flex items-center gap-1"
                        >
                          <ExternalLink className="w-3 h-3" />
                          Try Open
                        </button>
                      </div>
                    </div>

                    {/* How-to steps */}
                    <div className="p-3 bg-blue-50 border border-blue-100 rounded-xl text-[11px] text-[#202124] leading-relaxed space-y-1">
                      <p><span className="font-bold text-[#4285F4]">How to save the file:</span></p>
                      <ol className="list-decimal list-inside space-y-1 text-[#5F6368]">
                        <li>Open <code className="bg-white px-1 rounded border border-blue-200">chrome://system</code> in a new tab</li>
                        <li>Click <span className="font-medium text-[#202124]">Expand All</span> to reveal all fields</li>
                        <li>Press <kbd className="bg-white border border-blue-200 rounded px-1">Ctrl+S</kbd> to save the page as a file</li>
                        <li>Upload that file below</li>
                      </ol>
                    </div>

                    {/* Hidden file input */}
                    <input
                      ref={systemFileInputRef}
                      type="file"
                      accept=".html,.htm,.md,.txt"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        setSystemFileName(file.name);
                        setSystemError(null);
                        systemFileContentRef.current = '';
                        const reader = new FileReader();
                        reader.onload = (ev) => {
                          systemFileContentRef.current = (ev.target?.result as string) ?? '';
                        };
                        reader.readAsText(file);
                      }}
                    />

                    {/* Upload drop zone */}
                    <button
                      type="button"
                      onClick={() => systemFileInputRef.current?.click()}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault();
                        const file = e.dataTransfer.files?.[0];
                        if (!file) return;
                        setSystemFileName(file.name);
                        setSystemError(null);
                        systemFileContentRef.current = '';
                        const reader = new FileReader();
                        reader.onload = (ev) => {
                          systemFileContentRef.current = (ev.target?.result as string) ?? '';
                        };
                        reader.readAsText(file);
                      }}
                      className={`flex-1 min-h-[220px] w-full flex flex-col items-center justify-center gap-4 rounded-2xl border-2 border-dashed transition-colors cursor-pointer
                        ${systemFileName
                          ? 'border-[#4285F4] bg-blue-50/50'
                          : systemError
                          ? 'border-red-300 bg-red-50/30'
                          : 'border-gray-200 bg-gray-50 hover:border-[#4285F4] hover:bg-blue-50/30'
                        }`}
                    >
                      {systemFileName ? (
                        <>
                          <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center">
                            <FileText className="w-6 h-6 text-[#4285F4]" />
                          </div>
                          <div className="text-center">
                            <div className="text-sm font-medium text-[#202124]">{systemFileName}</div>
                            <div className="text-xs text-[#4285F4] mt-1">Click to replace</div>
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center">
                            <Upload className="w-6 h-6 text-gray-400" />
                          </div>
                          <div className="text-center">
                            <div className="text-sm font-medium text-[#202124]">Click to upload or drag & drop</div>
                            <div className="text-xs text-[#5F6368] mt-1">.html · .md · .txt</div>
                          </div>
                        </>
                      )}
                    </button>

                    {systemError && (
                      <div className="text-xs text-red-600 font-medium flex items-center gap-2 bg-red-50 p-3 rounded-xl border border-red-100">
                        <AlertCircle className="w-4 h-4" />
                        {systemError}
                      </div>
                    )}
                    <button
                      onClick={handleAnalyzeSystem}
                      disabled={!systemFileName}
                      className="w-full py-4 bg-[#4285F4] text-white rounded-2xl text-sm font-medium shadow-lg shadow-blue-200 hover:bg-blue-600 transition-all active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none"
                    >
                      Analyze System Info
                    </button>
                  </div>

                  <div className="space-y-4 overflow-y-auto">
                    <div className="text-[10px] font-bold text-[#5F6368] uppercase tracking-widest">2. Interpreted Hardware & Drivers</div>
                    {systemInfo ? (
                      <div className="space-y-6 pb-8">
                        {/* OS & Version Info */}
                        <div className="grid grid-cols-2 gap-4">
                          <div className="p-4 bg-gray-50 rounded-2xl border border-gray-100">
                            <div className="text-[9px] font-bold text-[#5F6368] uppercase tracking-widest mb-1">Chrome Version</div>
                            <div className="text-xs font-medium text-[#202124] truncate">{systemInfo.version || 'Unknown'}</div>
                          </div>
                          <div className="p-4 bg-gray-50 rounded-2xl border border-gray-100">
                            <div className="text-[9px] font-bold text-[#5F6368] uppercase tracking-widest mb-1">OS Version</div>
                            <div className="text-xs font-medium text-[#202124] truncate">{systemInfo.os_version || 'Unknown'}</div>
                          </div>
                          {systemInfo.milestone && (
                            <div className="p-4 bg-gray-50 rounded-2xl border border-gray-100">
                              <div className="text-[9px] font-bold text-[#5F6368] uppercase tracking-widest mb-1">Milestone</div>
                              <div className="text-xs font-medium text-[#202124]">M{systemInfo.milestone}</div>
                            </div>
                          )}
                          {systemInfo.channel && (
                            <div className="p-4 bg-gray-50 rounded-2xl border border-gray-100">
                              <div className="text-[9px] font-bold text-[#5F6368] uppercase tracking-widest mb-1">Channel</div>
                              <div className="text-xs font-medium text-[#202124] capitalize">{systemInfo.channel.replace('-channel', '')}</div>
                            </div>
                          )}
                        </div>

                        {/* Wi-Fi Chipset */}
                        {systemInfo.wifiChipset && (
                          <div className="p-4 bg-blue-50 border border-blue-100 rounded-2xl flex items-center gap-3">
                            <Wifi className="w-5 h-5 text-[#4285F4] shrink-0" />
                            <div>
                              <div className="text-[9px] font-bold text-[#4285F4] uppercase tracking-widest mb-0.5">Wi-Fi Adapter</div>
                              <div className="text-sm font-medium text-[#202124]">{systemInfo.wifiChipset}</div>
                            </div>
                          </div>
                        )}

                        {/* Network Intelligence — Active Service */}
                        {systemInfo.networkService && (
                          <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm">
                            <div className="p-4 bg-gray-50 border-b border-gray-200 flex items-center gap-2">
                              <Activity className="w-4 h-4 text-[#4285F4]" />
                              <span className="text-[10px] font-bold text-[#202124] uppercase tracking-widest">Active Connection</span>
                              {systemInfo.networkService.isConnected && (
                                <span className="ml-auto flex items-center gap-1 text-[9px] font-bold text-green-600 bg-green-50 px-2 py-0.5 rounded-full">
                                  <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse inline-block" />
                                  CONNECTED
                                </span>
                              )}
                            </div>
                            <div className="p-4 grid grid-cols-2 gap-x-6 gap-y-4">
                              {systemInfo.networkService.ssid && (
                                <div className="col-span-2">
                                  <div className="text-[9px] font-bold text-[#5F6368] uppercase tracking-widest mb-0.5">SSID</div>
                                  <div className="text-base font-medium text-[#202124]">{systemInfo.networkService.ssid}</div>
                                </div>
                              )}
                              {systemInfo.networkService.bssid && (
                                <div>
                                  <div className="text-[9px] font-bold text-[#5F6368] uppercase tracking-widest mb-0.5">BSSID (AP MAC)</div>
                                  <div className="text-xs font-mono text-[#202124]">{systemInfo.networkService.bssid}</div>
                                </div>
                              )}
                              {systemInfo.networkService.security && (
                                <div>
                                  <div className="text-[9px] font-bold text-[#5F6368] uppercase tracking-widest mb-0.5">Security</div>
                                  <div className="text-xs font-medium text-[#202124] flex items-center gap-1">
                                    <Lock className="w-3 h-3 text-[#5F6368]" />
                                    {systemInfo.networkService.security.toUpperCase()}
                                  </div>
                                </div>
                              )}
                              {systemInfo.networkService.band && (
                                <div>
                                  <div className="text-[9px] font-bold text-[#5F6368] uppercase tracking-widest mb-0.5">Band</div>
                                  <div className="text-xs font-medium text-[#202124]">{systemInfo.networkService.band}</div>
                                </div>
                              )}
                              {systemInfo.networkService.channel != null && (
                                <div>
                                  <div className="text-[9px] font-bold text-[#5F6368] uppercase tracking-widest mb-0.5">Channel</div>
                                  <div className="text-xs font-medium text-[#202124]">
                                    {systemInfo.networkService.channel}
                                    {systemInfo.networkService.frequency ? ` (${systemInfo.networkService.frequency} MHz)` : ''}
                                  </div>
                                </div>
                              )}
                              {systemInfo.networkService.phyMode != null && (
                                <div>
                                  <div className="text-[9px] font-bold text-[#5F6368] uppercase tracking-widest mb-0.5">PHY Mode</div>
                                  <div className="text-xs font-medium text-[#202124]">
                                    {PHY_MODE_LABELS[systemInfo.networkService.phyMode] ?? `Mode ${systemInfo.networkService.phyMode}`}
                                  </div>
                                </div>
                              )}
                              {systemInfo.networkService.ipv4Address && (
                                <div>
                                  <div className="text-[9px] font-bold text-[#5F6368] uppercase tracking-widest mb-0.5">IP Address</div>
                                  <div className="text-xs font-mono text-[#202124] bg-gray-50 px-2 py-1 rounded border border-gray-100 inline-block">
                                    {systemInfo.networkService.ipv4Address}
                                  </div>
                                </div>
                              )}
                              {systemInfo.networkService.country && (
                                <div>
                                  <div className="text-[9px] font-bold text-[#5F6368] uppercase tracking-widest mb-0.5">Country</div>
                                  <div className="text-xs font-medium text-[#202124]">{systemInfo.networkService.country}</div>
                                </div>
                              )}
                              {(systemInfo.networkService.downlinkMbps != null || systemInfo.networkService.uplinkMbps != null) && (
                                <div className="col-span-2 pt-2 border-t border-gray-100 grid grid-cols-2 gap-4">
                                  <div>
                                    <div className="text-[9px] font-bold text-[#5F6368] uppercase tracking-widest mb-0.5">Downlink Speed</div>
                                    <div className="text-sm font-mono font-medium text-green-600">{systemInfo.networkService.downlinkMbps} Mbps</div>
                                  </div>
                                  <div>
                                    <div className="text-[9px] font-bold text-[#5F6368] uppercase tracking-widest mb-0.5">Uplink Speed</div>
                                    <div className="text-sm font-mono font-medium text-blue-600">{systemInfo.networkService.uplinkMbps} Mbps</div>
                                  </div>
                                </div>
                              )}
                              {(systemInfo.networkService.disconnectCount != null || systemInfo.networkService.misconnectCount != null) && (
                                <div className="col-span-2 pt-2 border-t border-gray-100 grid grid-cols-2 gap-4">
                                  <div>
                                    <div className="text-[9px] font-bold text-[#5F6368] uppercase tracking-widest mb-0.5">Disconnects</div>
                                    <div className={`text-sm font-mono font-medium ${systemInfo.networkService.disconnectCount! > 0 ? 'text-red-600' : 'text-green-600'}`}>
                                      {systemInfo.networkService.disconnectCount}
                                    </div>
                                  </div>
                                  <div>
                                    <div className="text-[9px] font-bold text-[#5F6368] uppercase tracking-widest mb-0.5">Misconnects</div>
                                    <div className={`text-sm font-mono font-medium ${systemInfo.networkService.misconnectCount! > 0 ? 'text-amber-600' : 'text-green-600'}`}>
                                      {systemInfo.networkService.misconnectCount}
                                    </div>
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                        )}

                        {/* Link Statistics from network_devices */}
                        {systemInfo.networkDevice?.linkStats && (
                          <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm">
                            <div className="p-4 bg-gray-50 border-b border-gray-200 flex items-center gap-2">
                              <Activity className="w-4 h-4 text-[#34A853]" />
                              <span className="text-[10px] font-bold text-[#202124] uppercase tracking-widest">Link Statistics</span>
                            </div>
                            <div className="p-4 grid grid-cols-2 gap-x-6 gap-y-4">
                              {systemInfo.networkDevice.linkStats.receiveBitrate && (
                                <div className="col-span-2">
                                  <div className="text-[9px] font-bold text-[#5F6368] uppercase tracking-widest mb-0.5">Negotiated Bitrate</div>
                                  <div className="text-xs font-mono text-[#202124]">{systemInfo.networkDevice.linkStats.receiveBitrate}</div>
                                </div>
                              )}
                              {systemInfo.networkDevice.linkStats.avgSignalDbm != null && (
                                <div>
                                  <div className="text-[9px] font-bold text-[#5F6368] uppercase tracking-widest mb-0.5">Avg Signal</div>
                                  <div className="text-sm font-mono font-medium text-[#202124]">{systemInfo.networkDevice.linkStats.avgSignalDbm} dBm</div>
                                </div>
                              )}
                              {systemInfo.networkDevice.linkStats.lastSignalDbm != null && (
                                <div>
                                  <div className="text-[9px] font-bold text-[#5F6368] uppercase tracking-widest mb-0.5">Last Signal</div>
                                  <div className="text-sm font-mono font-medium text-[#202124]">{systemInfo.networkDevice.linkStats.lastSignalDbm} dBm</div>
                                </div>
                              )}
                              {systemInfo.networkDevice.linkStats.transmitRetries != null && (
                                <div>
                                  <div className="text-[9px] font-bold text-[#5F6368] uppercase tracking-widest mb-0.5">TX Retries</div>
                                  <div className={`text-sm font-mono font-medium ${systemInfo.networkDevice.linkStats.transmitRetries > 1000 ? 'text-amber-600' : 'text-green-600'}`}>
                                    {systemInfo.networkDevice.linkStats.transmitRetries.toLocaleString()}
                                  </div>
                                </div>
                              )}
                              {systemInfo.networkDevice.bgscanSignalThreshold != null && (
                                <div>
                                  <div className="text-[9px] font-bold text-[#5F6368] uppercase tracking-widest mb-0.5">Roam Threshold</div>
                                  <div className="text-sm font-mono font-medium text-[#202124]">{systemInfo.networkDevice.bgscanSignalThreshold} dBm</div>
                                </div>
                              )}
                              <div className="col-span-2 pt-2 border-t border-gray-100 flex gap-4 text-[10px] text-[#5F6368]">
                                {systemInfo.networkDevice.wakeOnWiFiSupported != null && (
                                  <span className={`px-2 py-1 rounded-full border ${systemInfo.networkDevice.wakeOnWiFiAllowed ? 'bg-green-50 border-green-200 text-green-700' : 'bg-gray-50 border-gray-200'}`}>
                                    WakeOnWiFi: {systemInfo.networkDevice.wakeOnWiFiAllowed ? 'On' : 'Off'}
                                  </span>
                                )}
                                {systemInfo.networkDevice.macRandomizationEnabled != null && (
                                  <span className={`px-2 py-1 rounded-full border ${systemInfo.networkDevice.macRandomizationEnabled ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-gray-50 border-gray-200'}`}>
                                    MAC Rand: {systemInfo.networkDevice.macRandomizationEnabled ? 'On' : 'Off'}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        )}

                        {/* PCI Devices (lspci) */}
                        {systemInfo.lspci && (
                          <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm">
                            <div className="p-4 bg-gray-50 border-b border-gray-200 flex items-center gap-2">
                              <Cpu className="w-4 h-4 text-[#4285F4]" />
                              <span className="text-[10px] font-bold text-[#202124] uppercase tracking-widest">PCI Devices (lspci)</span>
                            </div>
                            <div className="p-4 space-y-2 max-h-64 overflow-y-auto">
                              {systemInfo.lspci.map((device, i) => (
                                <div key={i} className="text-[11px] font-mono p-2 bg-gray-50 rounded border border-gray-100 hover:bg-blue-50 transition-colors">
                                  {device}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* USB Devices (lsusb) */}
                        {systemInfo.lsusb && (
                          <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm">
                            <div className="p-4 bg-gray-50 border-b border-gray-200 flex items-center gap-2">
                              <Globe className="w-4 h-4 text-[#34A853]" />
                              <span className="text-[10px] font-bold text-[#202124] uppercase tracking-widest">USB Devices (lsusb)</span>
                            </div>
                            <div className="p-4 space-y-2 max-h-64 overflow-y-auto">
                              {systemInfo.lsusb.map((device, i) => (
                                <div key={i} className="text-[11px] font-mono p-2 bg-gray-50 rounded border border-gray-100 hover:bg-green-50 transition-colors">
                                  {device}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Memory Info */}
                        {systemInfo.meminfo && (
                          <div className="p-4 bg-blue-50 border border-blue-100 rounded-2xl">
                            <div className="text-[10px] font-bold text-[#4285F4] uppercase tracking-widest mb-2">Memory Status</div>
                            <pre className="text-[10px] font-mono text-[#202124] whitespace-pre-wrap leading-tight">
                              {systemInfo.meminfo.split('\n').slice(0, 5).join('\n')}...
                            </pre>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="h-full min-h-[400px] bg-gray-50 border-2 border-dashed border-gray-200 rounded-2xl flex flex-col items-center justify-center text-center p-8">
                        <div className="w-16 h-16 bg-white rounded-full shadow-sm flex items-center justify-center mb-4">
                          <Info className="w-8 h-8 text-gray-300" />
                        </div>
                        <h4 className="text-[#202124] font-medium mb-2">Awaiting System Data</h4>
                        <p className="text-xs text-[#5F6368] max-w-[240px] leading-relaxed">
                          Follow the instructions on the left to pull hardware and driver info from your Chromebook.
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* AI Assistant Modal */}
      <AnimatePresence>
        {showAIChat && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-white w-full max-w-2xl h-[80vh] rounded-3xl shadow-2xl flex flex-col overflow-hidden border border-gray-200"
            >
              <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-white">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-blue-50 rounded-lg">
                    <MessageSquare className="w-6 h-6 text-[#4285F4]" />
                  </div>
                  <div>
                    <h3 className="text-lg font-medium text-[#202124]">AI Troubleshooting Assistant</h3>
                    <p className="text-xs text-[#5F6368]">Powered by Gemini 3.0 Flash</p>
                  </div>
                </div>
                <button 
                  onClick={() => setShowAIChat(false)}
                  className="p-2 hover:bg-gray-100 rounded-full transition-colors"
                >
                  <X className="w-6 h-6 text-gray-400" />
                </button>
              </div>

              <div className="flex-1 p-6 overflow-y-auto space-y-6 bg-gray-50/30">
                <AnimatePresence initial={false}>
                  {messages.map((msg, i) => (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                    >
                      <div className={`max-w-[85%] p-4 rounded-2xl ${
                        msg.role === 'user' 
                          ? 'bg-[#4285F4] text-white rounded-tr-none shadow-md' 
                          : 'bg-white border border-gray-200 shadow-sm rounded-tl-none text-[#202124]'
                      }`}>
                        <div className={`text-[9px] uppercase tracking-widest mb-1 font-bold ${msg.role === 'user' ? 'text-blue-100' : 'text-gray-400'}`}>
                          {msg.role === 'user' ? 'You' : 'Chromebook Specialist'}
                        </div>
                        <div className="text-sm leading-relaxed whitespace-pre-wrap">
                          {msg.content}
                        </div>
                      </div>
                    </motion.div>
                  ))}
                  {isTyping && (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="flex justify-start"
                    >
                      <div className="bg-white border border-gray-200 p-4 rounded-2xl rounded-tl-none flex gap-1 shadow-sm">
                        <div className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-bounce" />
                        <div className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-bounce [animation-delay:0.2s]" />
                        <div className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-bounce [animation-delay:0.4s]" />
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              <div className="p-6 border-t border-gray-100 bg-white">
                <form onSubmit={handleSendMessage} className="relative">
                  <input
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder="Ask a question or describe your issue..."
                    className="w-full bg-gray-50 border border-gray-200 p-4 pr-16 rounded-2xl focus:outline-none focus:ring-2 focus:ring-[#4285F4]/20 transition-all text-sm"
                  />
                  <button
                    type="submit"
                    disabled={!input.trim() || isTyping}
                    className="absolute right-2 top-2 bottom-2 px-6 bg-[#4285F4] text-white rounded-xl text-xs font-bold uppercase tracking-wider hover:bg-[#1A73E8] disabled:opacity-30 transition-all shadow-sm"
                  >
                    Send
                  </button>
                </form>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
