
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { SharedFile, TransferStatus, HistoryItem } from './types';
import { LaptopIcon, SmartphoneIcon, UploadIcon, FileIcon, CheckIcon, CopyIcon, TrashIcon, HashIcon, HistoryIcon } from './components/Icons';
import { getFileInsight } from './services/geminiService';
import { WebRTCService } from './services/webrtcService';
import QRCodeDisplay from './components/QRCodeDisplay';
import QRScanner from './components/QRScanner';

const App: React.FC = () => {
  const [roomId, setRoomId] = useState<string | null>(null);
  const [joinInput, setJoinInput] = useState('');
  const [files, setFiles] = useState<SharedFile[]>([]);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [activeTab, setActiveTab] = useState<'room' | 'history'>('room');
  const [isUploading, setIsUploading] = useState(false);
  const [deviceType, setDeviceType] = useState<'Mac' | 'Android'>('Mac');
  const [p2pConnected, setP2pConnected] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  
  const webrtcRef = useRef<WebRTCService | null>(null);
  const incomingFileRef = useRef<{ 
    name: string; 
    size: number; 
    chunks: ArrayBuffer[]; 
    receivedSize: number;
    id: string;
  } | null>(null);

  // Load history and detect device
  useEffect(() => {
    const savedHistory = localStorage.getItem('orbit_transfer_history');
    if (savedHistory) {
      try { setHistory(JSON.parse(savedHistory)); } catch (e) { console.error(e); }
    }
    const ua = navigator.userAgent;
    setDeviceType(/Android/i.test(ua) ? 'Android' : 'Mac');
  }, []);

  // Persist history
  useEffect(() => {
    localStorage.setItem('orbit_transfer_history', JSON.stringify(history));
  }, [history]);

  // WebRTC Setup when Room ID changes
  useEffect(() => {
    if (roomId) {
      const service = new WebRTCService(roomId);
      webrtcRef.current = service;

      service.setOnMessage((data) => {
        if (typeof data === 'string') {
          const msg = JSON.parse(data);
          if (msg.type === 'METADATA') {
            const id = Math.random().toString(36).substring(7);
            incomingFileRef.current = {
              name: msg.name,
              size: msg.size,
              chunks: [],
              receivedSize: 0,
              id
            };
            
            setFiles(prev => [{
              id,
              name: msg.name,
              size: msg.size,
              type: msg.mimeType,
              url: '',
              timestamp: Date.now(),
              status: TransferStatus.UPLOADING,
              progress: 0,
              sender: deviceType === 'Mac' ? 'Android' : 'Mac',
              isP2P: true
            }, ...prev]);
          }
        } else if (data instanceof ArrayBuffer) {
          const incoming = incomingFileRef.current;
          if (incoming) {
            incoming.chunks.push(data);
            incoming.receivedSize += data.byteLength;
            const progress = Math.round((incoming.receivedSize / incoming.size) * 100);
            
            setFiles(prev => prev.map(f => f.id === incoming.id ? { ...f, progress } : f));

            if (incoming.receivedSize >= incoming.size) {
              const blob = new Blob(incoming.chunks);
              const url = URL.createObjectURL(blob);
              finishReceivedFile(incoming.id, incoming.name, blob.type, incoming.size, url);
              incomingFileRef.current = null;
            }
          }
        }
      });

      // Try to connect as host
      service.createOffer();
      setP2pConnected(true);

      return () => {
        service.destroy();
        webrtcRef.current = null;
      };
    }
  }, [roomId, deviceType]);

  const finishReceivedFile = async (id: string, name: string, type: string, size: number, url: string) => {
    const insight = await getFileInsight(name, type, size);
    setFiles(prev => prev.map(f => 
      f.id === id ? { ...f, status: TransferStatus.COMPLETED, url, aiInsight: insight } : f
    ));
    
    const historyEntry: HistoryItem = { id, name, size, type, timestamp: Date.now(), sender: deviceType === 'Mac' ? 'Android' : 'Mac', aiInsight: insight };
    setHistory(prev => [historyEntry, ...prev.slice(0, 49)]);
  };

  const createRoom = () => {
    const newRoomId = Math.random().toString(36).substring(2, 8).toUpperCase();
    setRoomId(newRoomId);
  };

  const joinRoom = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (joinInput.length === 6) setRoomId(joinInput.toUpperCase());
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;

    for (let i = 0; i < fileList.length; i++) {
      const file = fileList[i];
      const id = Math.random().toString(36).substring(7);
      
      const newFile: SharedFile = {
        id,
        name: file.name,
        size: file.size,
        type: file.type,
        url: URL.createObjectURL(file),
        timestamp: Date.now(),
        status: TransferStatus.UPLOADING,
        progress: 0,
        sender: deviceType,
        isP2P: true
      };

      setFiles(prev => [newFile, ...prev]);

      if (webrtcRef.current) {
        try {
          await webrtcRef.current.sendFile(file, (progress) => {
            setFiles(prev => prev.map(f => f.id === id ? { ...f, progress } : f));
          });
          
          const insight = await getFileInsight(file.name, file.type, file.size);
          setFiles(prev => prev.map(f => f.id === id ? { ...f, status: TransferStatus.COMPLETED, aiInsight: insight } : f));
          
          const historyEntry: HistoryItem = { id, name: file.name, size: file.size, type: file.type, timestamp: Date.now(), sender: deviceType, aiInsight: insight };
          setHistory(prev => [historyEntry, ...prev.slice(0, 49)]);
        } catch (err) {
          console.error('P2P Error:', err);
          setFiles(prev => prev.map(f => f.id === id ? { ...f, status: TransferStatus.FAILED, errorMessage: "P2P connection lost." } : f));
        }
      }
    }
  };

  const formatSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const copyRoomId = () => {
    if (roomId) {
      navigator.clipboard.writeText(roomId);
      alert('Room code copied!');
    }
  };

  const handleScan = (code: string) => {
    if (code.length === 6) {
      setRoomId(code.toUpperCase());
      setIsScanning(false);
    }
  };

  if (!roomId) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-4 bg-gradient-to-br from-slate-50 to-blue-50">
        <div className="max-w-md w-full space-y-8 glass p-10 rounded-3xl shadow-2xl border border-white">
          <div className="text-center">
            <div className="inline-flex items-center justify-center p-4 bg-blue-600 text-white rounded-2xl shadow-lg mb-6">
              <UploadIcon />
            </div>
            <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">Orbit Transfer</h1>
            <p className="mt-3 text-slate-500 font-medium">True <span className="text-blue-600 font-bold underline decoration-wavy">P2P Sharing</span>. Direct transfer up to 500GB without servers.</p>
          </div>

          <div className="space-y-4">
            <button onClick={createRoom} className="w-full py-4 border border-transparent text-lg font-semibold rounded-2xl text-white bg-blue-600 hover:bg-blue-700 transition-all shadow-md transform hover:-translate-y-0.5">
              Launch P2P Hub
            </button>
            <div className="relative py-2">
              <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-slate-200"></div></div>
              <div className="relative flex justify-center text-sm"><span className="px-3 bg-white text-slate-500 font-semibold rounded-full border border-slate-100 uppercase tracking-widest text-[10px]">or pair device</span></div>
            </div>
            <form onSubmit={joinRoom} className="space-y-3">
              <input
                type="text" maxLength={6} value={joinInput} onChange={(e) => setJoinInput(e.target.value.toUpperCase())}
                placeholder="Enter 6-digit code"
                className="block w-full px-5 py-4 text-center tracking-[0.5em] font-mono text-xl border border-slate-200 rounded-2xl focus:ring-blue-500 focus:border-blue-500 outline-none"
              />
              <div className="flex gap-2">
                <button type="submit" className="flex-1 py-4 bg-slate-900 text-white font-semibold rounded-2xl hover:bg-black transition-all">
                  Connect to Room
                </button>
                <button 
                  type="button" 
                  onClick={() => setIsScanning(true)}
                  className="p-4 bg-white border border-slate-200 text-slate-700 rounded-2xl hover:bg-slate-50 transition-all shadow-sm"
                  title="Scan QR Code"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><rect x="7" y="7" width="3" height="3"/><rect x="14" y="7" width="3" height="3"/><rect x="7" y="14" width="3" height="3"/><path d="M14 14h3v3h-3z"/></svg>
                </button>
              </div>
            </form>
          </div>

          <div className="flex justify-center items-center gap-6 mt-8 pt-8 border-t border-slate-100 opacity-40">
             <div className="flex flex-col items-center"><LaptopIcon /><span className="text-[10px] mt-1 font-bold">Mac</span></div>
             <div className="flex items-center gap-2 px-3 py-1 bg-slate-100 rounded-full"><span className="text-[8px] font-black uppercase tracking-tighter">WebRTC Enabled</span></div>
             <div className="flex flex-col items-center"><SmartphoneIcon /><span className="text-[10px] mt-1 font-bold">Android</span></div>
          </div>
        </div>

        <div className="mt-8 text-center">
          <p className="text-slate-400 text-xs font-medium">
            Having trouble? If the app doesn't work, contact us at:
          </p>
          <a 
            href="mailto:ayushglobalenterprises@zohomail.in" 
            className="text-blue-500 hover:text-blue-600 text-sm font-bold mt-1 inline-block transition-colors underline decoration-blue-500/30"
          >
            ayushglobalenterprises@zohomail.in
          </a>
        </div>

        {isScanning && <QRScanner onScan={handleScan} onClose={() => setIsScanning(false)} />}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 pb-20">
      <nav className="glass sticky top-0 z-20 px-4 py-4 border-b border-slate-200 shadow-sm">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-600 text-white rounded-lg shadow-md"><UploadIcon /></div>
            <span className="text-xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-slate-900 to-slate-700">Orbit P2P</span>
          </div>
          
          <div className="flex items-center gap-3">
            <div className="flex items-center bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm hover:border-blue-300 transition-all group">
              <div className="bg-slate-50 px-3 py-2 border-r border-slate-200 flex items-center gap-1.5 group-hover:bg-blue-50"><HashIcon /></div>
              <div className="px-4 py-2 flex items-center gap-3">
                <span className="text-sm font-mono font-bold text-slate-800 tracking-widest uppercase">{roomId}</span>
                <button onClick={copyRoomId} className="text-slate-300 hover:text-blue-600 transition-colors p-1"><CopyIcon /></button>
              </div>
            </div>
            <button onClick={() => setRoomId(null)} className="text-xs font-black text-red-500 hover:text-red-700 bg-red-50 px-3 py-2 rounded-xl transition-all uppercase tracking-widest">
              Exit
            </button>
          </div>
        </div>
      </nav>

      <main className="max-w-5xl mx-auto px-4 mt-10">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-1 space-y-6">
            <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
              <h2 className="text-lg font-bold mb-4 flex items-center gap-2"><UploadIcon />P2P Uploader</h2>
              <div className="relative group">
                <input type="file" multiple onChange={handleFileUpload} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" />
                <div className="border-2 border-dashed border-slate-200 rounded-2xl p-10 flex flex-col items-center justify-center text-center group-hover:border-blue-400 group-hover:bg-blue-50 transition-all">
                  <div className="w-12 h-12 bg-slate-100 rounded-full flex items-center justify-center mb-4 group-hover:scale-110 transition-transform"><UploadIcon /></div>
                  <p className="text-sm font-semibold text-slate-700">Send up to 500GB</p>
                  <p className="text-xs text-slate-400 mt-1">Direct peer connection</p>
                </div>
              </div>
            </div>

            <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm flex flex-col items-center text-center">
              <h3 className="text-sm font-bold text-slate-900 mb-4 uppercase tracking-wider">Pair with {deviceType === 'Mac' ? 'Android' : 'Mac'}</h3>
              <QRCodeDisplay text={roomId} size={140} />
              <div className="flex items-center gap-2 mt-4">
                <div className={`w-2 h-2 rounded-full ${p2pConnected ? 'bg-green-500' : 'bg-amber-500 animate-pulse'}`}></div>
                <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">
                  {p2pConnected ? 'Encrypted Channel Ready' : 'Awaiting Peer Connection'}
                </p>
              </div>
            </div>
          </div>

          <div className="lg:col-span-2 space-y-4">
            <div className="flex items-center justify-between bg-white p-2 rounded-2xl border border-slate-200 shadow-sm">
              <div className="flex gap-1 flex-1">
                <button onClick={() => setActiveTab('room')} className={`flex-1 py-2 px-4 rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-2 ${activeTab === 'room' ? 'bg-slate-900 text-white shadow-md' : 'text-slate-500 hover:bg-slate-50'}`}><HashIcon />Live Tunnel</button>
                <button onClick={() => setActiveTab('history')} className={`flex-1 py-2 px-4 rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-2 ${activeTab === 'history' ? 'bg-slate-900 text-white shadow-md' : 'text-slate-500 hover:bg-slate-50'}`}><HistoryIcon />Transfer Log</button>
              </div>
            </div>

            {activeTab === 'room' ? (
              <div className="space-y-4">
                {files.length === 0 ? (
                  <div className="bg-white rounded-3xl border border-slate-100 p-20 flex flex-col items-center justify-center text-center">
                    <FileIcon />
                    <p className="text-slate-400 font-medium mt-4">No active streams.</p>
                    <p className="text-xs text-slate-300 mt-1">Files sent via WebRTC skip the server entirely.</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {files.map((file) => (
                      <div key={file.id} className={`bg-white p-5 rounded-3xl border ${file.status === TransferStatus.FAILED ? 'border-red-200 bg-red-50/30' : 'border-slate-200'} shadow-sm relative group`}>
                        <div className="flex items-start gap-4">
                          <div className={`p-3 rounded-2xl ${file.sender === 'Mac' ? 'bg-indigo-50 text-indigo-600' : 'bg-green-50 text-green-600'}`}>
                            {file.sender === 'Mac' ? <LaptopIcon /> : <SmartphoneIcon />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between mb-1">
                              <div className="flex items-center gap-2 truncate">
                                <h3 className="text-sm font-bold text-slate-900 truncate">{file.name}</h3>
                                <span className="px-1.5 py-0.5 bg-blue-100 text-blue-700 text-[8px] font-black uppercase rounded">Direct P2P</span>
                              </div>
                              <span className="text-[10px] font-bold text-slate-400">{formatSize(file.size)}</span>
                            </div>
                            
                            {file.status === TransferStatus.UPLOADING ? (
                              <div className="mt-2">
                                <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                                  <div className="h-full bg-blue-600 transition-all duration-300" style={{ width: `${file.progress}%` }}></div>
                                </div>
                                <p className="text-[10px] font-bold text-blue-600 mt-1 uppercase tracking-wider">Bitstream: {file.progress}%</p>
                              </div>
                            ) : file.status === TransferStatus.FAILED ? (
                              <div className="mt-2 p-3 bg-red-50 border border-red-100 rounded-xl text-xs text-red-600 font-medium">{file.errorMessage || "Transfer lost."}</div>
                            ) : (
                              <>
                                <div className="flex items-center gap-2 mt-1">
                                  <CheckIcon /><span className="text-[10px] font-bold text-green-600 uppercase tracking-wider">Received & Verified</span>
                                </div>
                                {file.aiInsight && (
                                  <div className="mt-3 p-3 bg-slate-50 rounded-xl border border-slate-100 flex items-start gap-2">
                                    <span className="text-blue-500 font-bold text-[10px] uppercase mt-0.5">AI</span>
                                    <p className="text-xs text-slate-600 italic">{file.aiInsight}</p>
                                  </div>
                                )}
                                <div className="mt-4 flex gap-2">
                                  <a href={file.url} download={file.name} className="flex-1 py-2 text-center bg-slate-900 text-white rounded-xl text-xs font-bold hover:bg-black transition-colors">Download from Peer</a>
                                </div>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-4">
                {history.length === 0 ? (
                  <div className="bg-white rounded-3xl border border-slate-100 p-20 flex flex-col items-center justify-center text-center"><HistoryIcon /><p className="text-slate-400 font-medium mt-4">History empty.</p></div>
                ) : (
                  <div className="space-y-4">
                    {history.map((item) => (
                      <div key={item.id} className="bg-white p-5 rounded-3xl border border-slate-200 shadow-sm opacity-80 hover:opacity-100">
                        <div className="flex items-start gap-4">
                          <div className="p-3 rounded-2xl bg-slate-100 text-slate-500">{item.sender === 'Mac' ? <LaptopIcon /> : <SmartphoneIcon />}</div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between mb-1">
                              <h3 className="text-sm font-bold text-slate-700 truncate">{item.name}</h3>
                              <span className="text-[10px] font-bold text-slate-400">{formatSize(item.size)}</span>
                            </div>
                            <div className="flex items-center gap-2 mt-1"><span className="text-[10px] font-bold text-slate-400 uppercase">{new Date(item.timestamp).toLocaleDateString()}</span></div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            
            <footer className="pt-10 pb-6 text-center">
              <p className="text-slate-300 text-[10px] font-bold uppercase tracking-widest">
                Support: <a href="mailto:ayushglobalenterprises@zohomail.in" className="text-blue-400 hover:text-blue-500 transition-colors">ayushglobalenterprises@zohomail.in</a>
              </p>
            </footer>
          </div>
        </div>
      </main>

      <div className="fixed bottom-6 left-1/2 transform -translate-x-1/2 lg:hidden w-11/12 max-w-sm">
        <label className="flex items-center justify-center w-full px-6 py-4 bg-blue-600 text-white rounded-2xl shadow-2xl font-bold cursor-pointer hover:bg-blue-700 active:scale-95 transition-all">
          <UploadIcon /><span className="ml-2">Direct P2P Upload</span>
          <input type="file" multiple onChange={handleFileUpload} className="hidden" />
        </label>
      </div>
    </div>
  );
};

export default App;
