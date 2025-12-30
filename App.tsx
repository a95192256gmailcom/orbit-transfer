
import React, { useState, useEffect, useRef } from 'react';
import { SharedFile, TransferStatus, HistoryItem } from './types';
import { LaptopIcon, SmartphoneIcon, UploadIcon, FileIcon, CheckIcon, CopyIcon, TrashIcon, HashIcon, HistoryIcon, TransferArrowIcon, OrbitLogo } from './components/Icons';
import { getFileInsight } from './services/geminiService';
import { WebRTCService } from './services/webrtcService';
import QRCodeDisplay from './components/QRCodeDisplay';
import QRScanner from './components/QRScanner';

const App: React.FC = () => {
  const [roomId, setRoomId] = useState<string | null>(null);
  const [isHost, setIsHost] = useState(false);
  const [joinInput, setJoinInput] = useState('');
  const [files, setFiles] = useState<SharedFile[]>([]);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [activeTab, setActiveTab] = useState<'room' | 'history'>('room');
  const [deviceType, setDeviceType] = useState<'Mac' | 'Android'>('Mac');
  const [p2pConnected, setP2pConnected] = useState(false);
  const [connState, setConnState] = useState('Standby');
  const [showManualHandshake, setShowManualHandshake] = useState(false);
  const [manualToken, setManualToken] = useState('');
  const [inputToken, setInputToken] = useState('');
  const [isScanning, setIsScanning] = useState(false);
  
  const webrtcRef = useRef<WebRTCService | null>(null);
  const incomingFileRef = useRef<{ 
    name: string; 
    size: number; 
    chunks: ArrayBuffer[]; 
    receivedSize: number;
    id: string;
  } | null>(null);

  useEffect(() => {
    const savedHistory = localStorage.getItem('orbit_transfer_history');
    if (savedHistory) {
      try { setHistory(JSON.parse(savedHistory)); } catch (e) { console.error(e); }
    }
    const ua = navigator.userAgent;
    setDeviceType(/Android/i.test(ua) ? 'Android' : 'Mac');
  }, []);

  useEffect(() => {
    localStorage.setItem('orbit_transfer_history', JSON.stringify(history));
  }, [history]);

  useEffect(() => {
    if (roomId) {
      const service = new WebRTCService(roomId, isHost);
      webrtcRef.current = service;

      service.setOnStatusChange((connected, state) => {
        setP2pConnected(connected);
        setConnState(state || 'Ready');
      });

      service.setOnMessage((data) => {
        if (typeof data === 'string') {
          const msg = JSON.parse(data);
          if (msg.type === 'METADATA') {
            const id = msg.id || Math.random().toString(36).substring(7);
            incomingFileRef.current = { name: msg.name, size: msg.size, chunks: [], receivedSize: 0, id };
            setFiles(prev => [{
              id, name: msg.name, size: msg.size, type: msg.mimeType, url: '',
              timestamp: Date.now(), status: TransferStatus.UPLOADING, progress: 0,
              sender: deviceType === 'Mac' ? 'Android' : 'Mac', isP2P: true
            }, ...prev]);
          } else if (msg.type === 'TRANSFER_CONTROL') {
            const status = msg.action === 'PAUSE' ? TransferStatus.PAUSED : TransferStatus.UPLOADING;
            setFiles(prev => prev.map(f => f.id === msg.id ? { ...f, status } : f));
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

      return () => { service.destroy(); webrtcRef.current = null; };
    }
  }, [roomId, isHost, deviceType]);

  const finishReceivedFile = async (id: string, name: string, type: string, size: number, url: string) => {
    const insight = await getFileInsight(name, type, size);
    setFiles(prev => prev.map(f => f.id === id ? { ...f, status: TransferStatus.COMPLETED, url, aiInsight: insight } : f));
    const historyEntry: HistoryItem = { id, name, size, type, timestamp: Date.now(), sender: deviceType === 'Mac' ? 'Android' : 'Mac', aiInsight: insight };
    setHistory(prev => [historyEntry, ...prev.slice(0, 49)]);
  };

  const createRoom = () => { setIsHost(true); setRoomId(Math.random().toString(36).substring(2, 8).toUpperCase()); };
  
  const joinRoom = (code: string) => {
    setIsHost(false);
    setRoomId(code.toUpperCase());
    setIsScanning(false);
  };

  const handleManualPairing = async () => {
    if (!webrtcRef.current) return;
    const token = await webrtcRef.current.getManualToken();
    setManualToken(token);
    setShowManualHandshake(true);
  };

  const processInputToken = async () => {
    if (!webrtcRef.current || !inputToken) return;
    try {
      await webrtcRef.current.processManualToken(inputToken);
      if (!isHost) {
        const answer = await webrtcRef.current.getManualToken();
        setManualToken(answer);
      }
      setInputToken('');
    } catch (e: any) { alert(e.message); }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || !p2pConnected) { alert("Please pair devices first."); return; }
    for (let i = 0; i < fileList.length; i++) {
      const file = fileList[i];
      const id = Math.random().toString(36).substring(7);
      setFiles(prev => [{ id, name: file.name, size: file.size, type: file.type, url: URL.createObjectURL(file), timestamp: Date.now(), status: TransferStatus.UPLOADING, progress: 0, sender: deviceType, isP2P: true }, ...prev]);
      try {
        await webrtcRef.current?.sendFile(id, file, (p) => setFiles(prev => prev.map(f => f.id === id ? { ...f, progress: p } : f)));
        const insight = await getFileInsight(file.name, file.type, file.size);
        setFiles(prev => prev.map(f => f.id === id ? { ...f, status: TransferStatus.COMPLETED, aiInsight: insight } : f));
        setHistory(prev => [{ id, name: file.name, size: file.size, type: file.type, timestamp: Date.now(), sender: deviceType, aiInsight: insight }, ...prev.slice(0, 49)]);
      } catch (err: any) {
        setFiles(prev => prev.map(f => f.id === id ? { ...f, status: TransferStatus.FAILED, errorMessage: err.message } : f));
      }
    }
  };

  const togglePause = (id: string, currentStatus: TransferStatus) => {
    if (currentStatus === TransferStatus.UPLOADING) {
      webrtcRef.current?.pauseTransfer(id);
      setFiles(prev => prev.map(f => f.id === id ? { ...f, status: TransferStatus.PAUSED } : f));
    } else if (currentStatus === TransferStatus.PAUSED) {
      webrtcRef.current?.resumeTransfer(id);
      setFiles(prev => prev.map(f => f.id === id ? { ...f, status: TransferStatus.UPLOADING } : f));
    }
  };

  const formatSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  if (isScanning) {
    return <QRScanner onScan={joinRoom} onClose={() => setIsScanning(false)} />;
  }

  if (!roomId) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-4 bg-[#0d0e17] overflow-hidden relative">
        <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-purple-600/10 blur-[150px] rounded-full"></div>
        <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] bg-pink-600/10 blur-[150px] rounded-full"></div>
        <div className="max-w-md w-full space-y-8 bg-white/5 backdrop-blur-3xl p-10 rounded-[3rem] shadow-[0_40px_100px_-20px_rgba(0,0,0,0.8)] border border-white/10 z-10 animate-in zoom-in-95 duration-500">
          <div className="text-center">
            <div className="flex justify-center mb-4 transform drop-shadow-[0_0_30px_rgba(155,81,224,0.35)]"><OrbitLogo size="md" lightText={true} /></div>
            <p className="mt-2 text-slate-400 font-medium leading-relaxed max-w-[280px] mx-auto">Cross-platform P2P file sharing. No cloud, just direct tunnels.</p>
          </div>
          <div className="space-y-4">
            <button onClick={createRoom} className="w-full py-5 text-lg font-bold rounded-2xl text-white bg-gradient-to-r from-purple-600 via-pink-600 to-orange-500 hover:brightness-110 shadow-2xl transition-all transform hover:-translate-y-1">Launch Direct Hub</button>
            <div className="relative py-5"><div className="absolute inset-0 flex items-center"><div className="w-full border-t border-white/10"></div></div><div className="relative flex justify-center text-sm"><span className="px-4 bg-[#0d0e17] text-slate-500 font-bold uppercase tracking-widest text-[11px]">Join Existing Hub</span></div></div>
            <div className="space-y-4">
              <input type="text" maxLength={6} value={joinInput} onChange={(e) => setJoinInput(e.target.value.toUpperCase())} placeholder="6-DIGIT CODE" className="block w-full px-5 py-5 text-center tracking-[0.6em] font-mono text-3xl bg-white/5 border border-white/10 rounded-2xl text-white outline-none focus:ring-2 focus:ring-purple-500/40" />
              <div className="grid grid-cols-2 gap-3">
                <button onClick={() => joinRoom(joinInput)} className="py-4 bg-white text-[#0d0e17] font-bold text-sm rounded-2xl hover:bg-slate-100 transition-all uppercase tracking-widest">Connect</button>
                <button onClick={() => setIsScanning(true)} className="py-4 bg-white/10 text-white font-bold text-sm rounded-2xl hover:bg-white/20 transition-all uppercase tracking-widest border border-white/10">Scan Code</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 pb-20">
      <nav className="glass sticky top-0 z-20 px-4 py-1.5 border-b border-slate-200 shadow-sm">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center -ml-2"><OrbitLogo size="sm" lightText={false} className="scale-[0.85] origin-left" /></div>
          <div className="flex items-center gap-3">
            <div className="flex items-center bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
              <div className="bg-slate-50 px-3 py-2 border-r border-slate-200"><HashIcon className="text-purple-500" /></div>
              <div className="px-4 py-2 flex items-center gap-3">
                <span className="text-sm font-mono font-bold text-slate-800 tracking-widest uppercase">{roomId}</span>
                <button onClick={() => { navigator.clipboard.writeText(roomId); alert('Copied!'); }} className="text-slate-300 hover:text-purple-600 transition-colors p-1"><CopyIcon /></button>
              </div>
            </div>
            <button onClick={() => setRoomId(null)} className="text-[10px] font-black text-red-500 bg-red-50 px-4 py-2.5 rounded-xl border border-red-100 uppercase tracking-widest">Exit</button>
          </div>
        </div>
      </nav>

      <main className="max-w-5xl mx-auto px-4 mt-10">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-1 space-y-6">
            <div className="bg-white p-6 rounded-[2.5rem] border border-slate-200 shadow-sm">
              <h2 className="text-base font-bold mb-5 flex items-center gap-3 text-slate-800">
                <div className="p-2 bg-purple-50 text-purple-600 rounded-xl"><UploadIcon /></div>
                Direct Tunnel
              </h2>
              <div className={`relative group/upload ${!p2pConnected ? 'opacity-40 grayscale cursor-not-allowed' : ''}`}>
                <input type="file" multiple onChange={handleFileUpload} disabled={!p2pConnected} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" />
                <div className={`border-2 border-dashed ${p2pConnected ? 'border-purple-100 bg-purple-50/20' : 'border-slate-100'} rounded-[2rem] p-12 flex flex-col items-center justify-center text-center transition-all`}>
                  <div className="w-14 h-14 bg-white rounded-full flex items-center justify-center mb-5 shadow-sm"><UploadIcon className="text-slate-400" /></div>
                  <p className="text-sm font-bold text-slate-800">{p2pConnected ? 'Drop Stream Source' : 'Tunnel Closed'}</p>
                </div>
              </div>
              {!p2pConnected && (
                <button onClick={handleManualPairing} className="w-full mt-4 py-3 bg-slate-900 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-black transition-all">Manual Pairing Fallback</button>
              )}
            </div>

            <div className="bg-white p-7 rounded-[2.5rem] border border-slate-200 shadow-sm flex flex-col items-center text-center">
              <h3 className="text-[11px] font-black text-slate-400 mb-5 uppercase tracking-[0.25em]">Pairing Link</h3>
              <div className="p-1 bg-slate-50 rounded-[1.8rem] border border-slate-100"><QRCodeDisplay text={roomId} size={150} /></div>
              <div className="flex items-center gap-2.5 mt-6 px-4 py-2 bg-slate-50 rounded-full border border-slate-100">
                <div className={`w-2 h-2 rounded-full ${p2pConnected ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.5)]' : 'bg-amber-500 animate-pulse'}`}></div>
                <p className="text-[10px] text-slate-500 font-black uppercase tracking-widest">{p2pConnected ? 'P2P TUNNEL OPEN' : `STATE: ${connState.toUpperCase()}`}</p>
              </div>
            </div>
          </div>

          <div className="lg:col-span-2 space-y-5">
            <div className="bg-white p-2 rounded-[1.8rem] border border-slate-200 shadow-sm flex">
              <button onClick={() => setActiveTab('room')} className={`flex-1 py-3 px-6 rounded-2xl text-[11px] font-black uppercase tracking-widest ${activeTab === 'room' ? 'bg-slate-900 text-white' : 'text-slate-400'}`}>Current Stream</button>
              <button onClick={() => setActiveTab('history')} className={`flex-1 py-3 px-6 rounded-2xl text-[11px] font-black uppercase tracking-widest ${activeTab === 'history' ? 'bg-slate-900 text-white' : 'text-slate-400'}`}>Session Log</button>
            </div>

            <div className="min-h-[400px]">
              {activeTab === 'room' ? (
                <div className="space-y-4">
                  {files.length === 0 ? (
                    <div className="bg-white rounded-[2.5rem] border border-slate-100 p-24 flex flex-col items-center justify-center text-center opacity-60">
                      <div className="p-5 bg-slate-50 rounded-3xl mb-6"><FileIcon className="text-slate-300 w-8 h-8" /></div>
                      <p className="text-slate-400 font-bold text-sm uppercase tracking-widest">Waiting for Bitstream...</p>
                    </div>
                  ) : (
                    files.map(file => (
                      <div key={file.id} className="bg-white p-7 rounded-[2.5rem] border border-slate-200 shadow-sm relative transition-all animate-in fade-in slide-in-from-bottom-2">
                        <div className="flex items-start gap-5">
                          <div className={`p-4 rounded-[1.5rem] shadow-sm ${file.sender === deviceType ? 'bg-purple-50 text-purple-600' : 'bg-emerald-50 text-emerald-600'}`}>{file.sender === 'Mac' ? <LaptopIcon /> : <SmartphoneIcon />}</div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between mb-2">
                              <h3 className="text-sm font-black text-slate-900 truncate tracking-tight">{file.name}</h3>
                              <span className="text-[10px] font-black text-slate-400 tabular-nums">{formatSize(file.size)}</span>
                            </div>
                            <div className="flex items-center gap-2 mb-2 p-1.5 bg-slate-50 rounded-lg border border-slate-100 w-fit">
                              <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">{file.sender}</span>
                              <TransferArrowIcon className="text-slate-300 w-3 h-3" />
                              <span className="text-[9px] font-black uppercase tracking-widest text-blue-600">{file.sender === deviceType ? (deviceType === 'Mac' ? 'Android' : 'Mac') : 'Me'}</span>
                            </div>
                            {(file.status === TransferStatus.UPLOADING || file.status === TransferStatus.PAUSED) ? (
                              <div className="mt-4">
                                <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                                  <div 
                                    className={`h-full transition-all duration-300 ${file.status === TransferStatus.PAUSED ? 'bg-amber-400' : 'bg-gradient-to-r from-purple-600 to-pink-500'}`} 
                                    style={{ width: `${file.progress}%` }}
                                  ></div>
                                </div>
                                <div className="flex justify-between items-center mt-2">
                                  <p className={`text-[9px] font-black uppercase ${file.status === TransferStatus.PAUSED ? 'text-amber-600' : 'text-purple-600'}`}>
                                    {file.status === TransferStatus.PAUSED ? 'Paused' : `Streaming: ${file.progress}%`}
                                  </p>
                                  {file.sender === deviceType && (
                                    <button 
                                      onClick={() => togglePause(file.id, file.status)}
                                      className="text-[9px] font-black text-slate-400 hover:text-slate-900 uppercase tracking-widest"
                                    >
                                      {file.status === TransferStatus.PAUSED ? 'Resume' : 'Pause'}
                                    </button>
                                  )}
                                </div>
                              </div>
                            ) : file.status === TransferStatus.FAILED ? (
                              <div className="mt-3 p-3 bg-red-50 border border-red-100 rounded-xl text-[10px] text-red-600 font-bold">{file.errorMessage}</div>
                            ) : (
                              <>
                                <div className="flex items-center gap-2 mt-2"><CheckIcon className="w-4 h-4" /><span className="text-[10px] font-black text-green-600 uppercase">Verified</span></div>
                                {file.aiInsight && <div className="mt-4 p-4 bg-slate-50 rounded-2xl border border-slate-100 italic text-[11px] text-slate-500">"{file.aiInsight}"</div>}
                                <a href={file.url} download={file.name} className="mt-5 block w-full py-3.5 text-center bg-slate-900 text-white rounded-2xl text-[10px] font-black uppercase hover:bg-black transition-all">Download Local Copy</a>
                              </>
                            )}
                          </div>
                        </div>
                        <button onClick={() => setFiles(prev => prev.filter(f => f.id !== file.id))} className="absolute top-7 right-7 text-slate-200 hover:text-red-500 transition-colors"><TrashIcon /></button>
                      </div>
                    ))
                  )}
                </div>
              ) : (
                <div className="space-y-4">
                  {history.map(item => (
                    <div key={item.id} className="bg-white p-6 rounded-[2rem] border border-slate-200 opacity-90">
                      <div className="flex items-center gap-5">
                        <div className="p-3 bg-slate-50 rounded-2xl text-slate-400"><FileIcon /></div>
                        <div className="flex-1 min-w-0">
                          <h4 className="text-xs font-black text-slate-700 truncate">{item.name}</h4>
                          <p className="text-[9px] font-black text-slate-400 uppercase mt-1">{new Date(item.timestamp).toLocaleTimeString()} • {formatSize(item.size)}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </main>

      {/* Manual Handshake Modal */}
      {showManualHandshake && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/80 backdrop-blur-sm animate-in fade-in">
          <div className="bg-white w-full max-w-lg rounded-[3rem] p-10 border border-slate-200 shadow-2xl space-y-6">
            <div className="text-center">
              <h2 className="text-xl font-black text-slate-900 uppercase tracking-widest">Manual Pairing</h2>
              <p className="text-sm text-slate-500 font-medium mt-2">Use this if the devices are on different physical networks.</p>
            </div>
            {manualToken && (
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase">Your Tunnel Token (Send this to peer)</label>
                <div className="relative group">
                  <textarea readOnly value={manualToken} className="w-full p-4 bg-slate-50 border border-slate-100 rounded-2xl font-mono text-[9px] h-24 resize-none outline-none break-all" />
                  <button onClick={() => { navigator.clipboard.writeText(manualToken); alert('Token Copied!'); }} className="absolute bottom-4 right-4 bg-slate-900 text-white p-2 rounded-lg hover:scale-105 transition-transform"><CopyIcon /></button>
                </div>
              </div>
            )}
            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase">Input Peer Token (Paste received token)</label>
              <textarea value={inputToken} onChange={(e) => setInputToken(e.target.value)} placeholder="Paste token from other device..." className="w-full p-4 bg-white border border-slate-200 rounded-2xl font-mono text-[9px] h-24 resize-none outline-none focus:border-purple-300" />
              <button onClick={processInputToken} className="w-full py-4 bg-purple-600 text-white rounded-2xl text-xs font-black uppercase tracking-widest hover:bg-purple-700">Link Tunnel</button>
            </div>
            <button onClick={() => setShowManualHandshake(false)} className="w-full text-[10px] font-black text-slate-400 uppercase hover:text-slate-900">Close Handshake</button>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
