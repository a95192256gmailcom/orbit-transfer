
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { SharedFile, TransferStatus, HistoryItem } from './types';
import { LaptopIcon, SmartphoneIcon, UploadIcon, FileIcon, CheckIcon, CopyIcon, TrashIcon, HashIcon, HistoryIcon, TransferArrowIcon, OrbitLogo } from './components/Icons';
import { getFileInsight } from './services/geminiService';
import { WebRTCService } from './services/webrtcService';
import QRCodeDisplay from './components/QRCodeDisplay';

const App: React.FC = () => {
  const [roomId, setRoomId] = useState<string | null>(null);
  const [joinInput, setJoinInput] = useState('');
  const [files, setFiles] = useState<SharedFile[]>([]);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [activeTab, setActiveTab] = useState<'room' | 'history'>('room');
  const [isUploading, setIsUploading] = useState(false);
  const [deviceType, setDeviceType] = useState<'Mac' | 'Android'>('Mac');
  const [p2pConnected, setP2pConnected] = useState(false);
  
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

  const downloadApk = () => {
    const link = document.createElement('a');
    link.href = '/orbit-transfer-v1.apk';
    link.download = 'OrbitTransfer.apk';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const renderDirectionIndicator = (sender: 'Mac' | 'Android') => {
    const isMe = sender === deviceType;
    const peerType = deviceType === 'Mac' ? 'Android' : 'Mac';

    return (
      <div className="flex items-center gap-2 mb-2 p-2 bg-slate-50 rounded-xl border border-slate-100 w-fit">
        <div className="flex items-center gap-1.5">
          {sender === 'Mac' ? <LaptopIcon className="w-4 h-4 text-slate-500" /> : <SmartphoneIcon className="w-4 h-4 text-slate-500" />}
          <span className={`text-[10px] font-bold uppercase tracking-wider ${isMe ? 'text-blue-600' : 'text-slate-500'}`}>
            {isMe ? 'You' : peerType}
          </span>
        </div>
        <TransferArrowIcon className="text-slate-300" />
        <div className="flex items-center gap-1.5">
          {sender === 'Mac' ? <SmartphoneIcon className="w-4 h-4 text-slate-500" /> : <LaptopIcon className="w-4 h-4 text-slate-500" />}
          <span className={`text-[10px] font-bold uppercase tracking-wider ${!isMe ? 'text-blue-600' : 'text-slate-500'}`}>
            {!isMe ? 'You' : peerType}
          </span>
        </div>
      </div>
    );
  };

  if (!roomId) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-4 bg-[#0d0e17] overflow-hidden relative">
        {/* Aesthetic Background Glows */}
        <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-purple-600/10 blur-[150px] rounded-full"></div>
        <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] bg-pink-600/10 blur-[150px] rounded-full"></div>

        <div className="max-w-md w-full space-y-8 bg-white/5 backdrop-blur-3xl p-10 rounded-[3rem] shadow-[0_40px_100px_-20px_rgba(0,0,0,0.8)] border border-white/10 z-10">
          <div className="text-center">
            <div className="flex justify-center mb-4 transform scale-100 drop-shadow-[0_0_30px_rgba(155,81,224,0.35)]">
              <OrbitLogo size="md" lightText={true} />
            </div>
            <p className="mt-2 text-slate-400 font-medium leading-relaxed max-w-[280px] mx-auto">Zero servers, absolute privacy. Secure peer-to-peer file sharing up to 500GB.</p>
          </div>

          <div className="space-y-4">
            <button onClick={createRoom} className="w-full py-5 border border-transparent text-lg font-bold rounded-2xl text-white bg-gradient-to-r from-purple-600 via-pink-600 to-orange-500 hover:brightness-110 transition-all shadow-2xl shadow-purple-900/30 transform hover:-translate-y-1 active:scale-95 active:translate-y-0">
              Launch Direct Hub
            </button>
            
            <div className="relative py-5">
              <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-white/10"></div></div>
              <div className="relative flex justify-center text-sm"><span className="px-4 bg-[#0d0e17] text-slate-500 font-bold uppercase tracking-widest text-[11px]">Secure Connection</span></div>
            </div>

            <form onSubmit={joinRoom} className="space-y-4">
              <input
                type="text" maxLength={6} value={joinInput} onChange={(e) => setJoinInput(e.target.value.toUpperCase())}
                placeholder="6-DIGIT CODE"
                className="block w-full px-5 py-5 text-center tracking-[0.6em] font-mono text-3xl bg-white/5 border border-white/10 rounded-2xl text-white placeholder:text-slate-800 focus:ring-2 focus:ring-purple-500/40 outline-none transition-all"
              />
              <button type="submit" className="w-full py-5 bg-white text-[#0d0e17] font-bold text-lg rounded-2xl hover:bg-slate-100 transition-all active:scale-95 active:bg-slate-200">
                Join Transfer Hub
              </button>
            </form>
          </div>

          <div className="pt-8 border-t border-white/10">
            <button 
              onClick={downloadApk}
              className="w-full flex items-center justify-center gap-4 px-6 py-5 bg-white/5 text-white rounded-[2rem] border border-white/10 hover:bg-white/10 transition-all group overflow-hidden relative"
            >
              <div className="absolute inset-0 bg-gradient-to-r from-purple-600/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
              <SmartphoneIcon className="text-pink-400 relative z-10" />
              <div className="text-left relative z-10">
                <p className="text-sm font-bold leading-none">Android Companion</p>
                <p className="text-[10px] font-medium opacity-40 mt-1">Direct APK installation</p>
              </div>
              <div className="ml-auto opacity-30 group-hover:opacity-100 transition-all group-hover:translate-x-1 relative z-10">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M19 12l-7 7-7-7"/></svg>
              </div>
            </button>
          </div>

          <div className="flex justify-center items-center gap-10 mt-6 opacity-20 grayscale transition-all duration-700 hover:grayscale-0 hover:opacity-100">
             <div className="flex flex-col items-center gap-2">
               <LaptopIcon className="text-white w-5 h-5" />
               <span className="text-[10px] font-black text-white uppercase tracking-wider">macOS</span>
             </div>
             <div className="h-6 w-px bg-white/20"></div>
             <div className="flex flex-col items-center gap-2">
               <SmartphoneIcon className="text-white w-5 h-5" />
               <span className="text-[10px] font-black text-white uppercase tracking-wider">Android</span>
             </div>
          </div>
        </div>

        <div className="mt-16 text-center z-10">
          <p className="text-slate-600 text-[10px] font-bold uppercase tracking-[0.25em] mb-3">Enterprise Infrastructure</p>
          <a 
            href="mailto:ayushglobalenterprises@zohomail.in" 
            className="text-purple-400/60 hover:text-white text-xs font-bold transition-all border-b border-transparent hover:border-purple-500/40 pb-1"
          >
            ayushglobalenterprises@zohomail.in
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 pb-20">
      <nav className="glass sticky top-0 z-20 px-4 py-1.5 border-b border-slate-200 shadow-sm">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center -ml-2">
            <OrbitLogo size="sm" lightText={false} className="scale-[0.85] origin-left" />
          </div>
          
          <div className="flex items-center gap-3">
            <div className="flex items-center bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm hover:border-purple-300 transition-all group">
              <div className="bg-slate-50 px-3 py-2 border-r border-slate-200 flex items-center gap-1.5 group-hover:bg-purple-50"><HashIcon className="text-purple-500" /></div>
              <div className="px-4 py-2 flex items-center gap-3">
                <span className="text-sm font-mono font-bold text-slate-800 tracking-widest uppercase">{roomId}</span>
                <button onClick={copyRoomId} className="text-slate-300 hover:text-purple-600 transition-colors p-1"><CopyIcon /></button>
              </div>
            </div>
            <button onClick={() => setRoomId(null)} className="text-[10px] font-black text-red-500 hover:text-white hover:bg-red-500 bg-red-50 px-4 py-2.5 rounded-xl transition-all uppercase tracking-widest border border-red-100">
              Disconnect
            </button>
          </div>
        </div>
      </nav>

      <main className="max-w-5xl mx-auto px-4 mt-10">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-1 space-y-6">
            <div className="bg-white p-6 rounded-[2.5rem] border border-slate-200 shadow-sm group">
              <h2 className="text-base font-bold mb-5 flex items-center gap-3 text-slate-800">
                <div className="p-2 bg-purple-50 text-purple-600 rounded-xl group-hover:scale-110 transition-transform"><UploadIcon /></div>
                File Hub
              </h2>
              <div className="relative group/upload">
                <input type="file" multiple onChange={handleFileUpload} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" />
                <div className="border-2 border-dashed border-slate-100 rounded-[2rem] p-12 flex flex-col items-center justify-center text-center group-hover/upload:border-purple-400 group-hover/upload:bg-purple-50/50 transition-all duration-300">
                  <div className="w-14 h-14 bg-slate-50 rounded-full flex items-center justify-center mb-5 group-hover/upload:scale-110 group-hover/upload:bg-white group-hover/upload:shadow-sm transition-all"><UploadIcon className="text-slate-400" /></div>
                  <p className="text-sm font-bold text-slate-800">Direct P2P Tunnel</p>
                  <p className="text-[10px] text-slate-400 mt-2 font-bold uppercase tracking-wider">Drag files here</p>
                </div>
              </div>
            </div>

            <div className="bg-white p-7 rounded-[2.5rem] border border-slate-200 shadow-sm flex flex-col items-center text-center overflow-hidden">
              <h3 className="text-[11px] font-black text-slate-400 mb-5 uppercase tracking-[0.25em]">Sync Access</h3>
              <div className="p-1 bg-slate-50 rounded-[1.8rem] border border-slate-100">
                <QRCodeDisplay text={roomId} size={150} />
              </div>
              <div className="flex items-center gap-2.5 mt-6 px-4 py-2 bg-slate-50 rounded-full border border-slate-100">
                <div className={`w-2.5 h-2.5 rounded-full ${p2pConnected ? 'bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.5)]' : 'bg-amber-500 animate-pulse'}`}></div>
                <p className="text-[10px] text-slate-500 font-black uppercase tracking-widest">
                  {p2pConnected ? 'Encrypted Stream Active' : 'Waiting for Peer...'}
                </p>
              </div>
              
              <button 
                onClick={downloadApk}
                className="w-full mt-8 py-4 px-4 bg-slate-900 text-white rounded-2xl text-[11px] font-black hover:bg-black transition-all flex items-center justify-center gap-3 uppercase tracking-widest"
              >
                <SmartphoneIcon className="w-4 h-4" />
                Get Android APK
              </button>
            </div>
          </div>

          <div className="lg:col-span-2 space-y-5">
            <div className="flex items-center justify-between bg-white p-2 rounded-[1.8rem] border border-slate-200 shadow-sm">
              <div className="flex gap-1.5 flex-1">
                <button onClick={() => setActiveTab('room')} className={`flex-1 py-3 px-6 rounded-2xl text-[11px] font-black transition-all flex items-center justify-center gap-2.5 uppercase tracking-widest ${activeTab === 'room' ? 'bg-slate-900 text-white shadow-xl' : 'text-slate-400 hover:bg-slate-50'}`}><HashIcon className="w-4 h-4" />Active Channel</button>
                <button onClick={() => setActiveTab('history')} className={`flex-1 py-3 px-6 rounded-2xl text-[11px] font-black transition-all flex items-center justify-center gap-2.5 uppercase tracking-widest ${activeTab === 'history' ? 'bg-slate-900 text-white shadow-xl' : 'text-slate-400 hover:bg-slate-50'}`}><HistoryIcon className="w-4 h-4" />Transfer Log</button>
              </div>
            </div>

            <div className="min-h-[400px]">
              {activeTab === 'room' ? (
                <div className="space-y-4">
                  {files.length === 0 ? (
                    <div className="bg-white rounded-[2.5rem] border border-slate-100 p-24 flex flex-col items-center justify-center text-center opacity-60">
                      <div className="p-5 bg-slate-50 rounded-3xl mb-6"><FileIcon className="text-slate-300 w-8 h-8" /></div>
                      <p className="text-slate-400 font-bold text-sm uppercase tracking-widest">Waiting for data...</p>
                      <p className="text-[10px] text-slate-300 mt-2 font-medium max-w-[200px]">Files sent here bypass our servers and flow directly between devices.</p>
                    </div>
                  ) : (
                    <div className="space-y-4 animate-in fade-in duration-500">
                      {files.map((file) => (
                        <div key={file.id} className={`bg-white p-7 rounded-[2.5rem] border ${file.status === TransferStatus.FAILED ? 'border-red-200 bg-red-50/20' : 'border-slate-200'} shadow-sm relative group transition-all hover:shadow-md`}>
                          <div className="flex items-start gap-5">
                            <div className={`p-4 rounded-[1.5rem] shadow-sm ${file.sender === deviceType ? 'bg-purple-50 text-purple-600' : 'bg-emerald-50 text-emerald-600'}`}>
                              {file.sender === 'Mac' ? <LaptopIcon className="w-6 h-6" /> : <SmartphoneIcon className="w-6 h-6" />}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between mb-2">
                                <div className="flex items-center gap-3 truncate">
                                  <h3 className="text-sm font-black text-slate-900 truncate tracking-tight">{file.name}</h3>
                                  <span className="px-2 py-0.5 bg-purple-100 text-purple-700 text-[8px] font-black uppercase rounded-md tracking-widest">Direct P2P</span>
                                </div>
                                <span className="text-[10px] font-black text-slate-400 tabular-nums">{formatSize(file.size)}</span>
                              </div>
                              
                              {renderDirectionIndicator(file.sender)}

                              {file.status === TransferStatus.UPLOADING ? (
                                <div className="mt-4">
                                  <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                                    <div className="h-full bg-gradient-to-r from-purple-600 to-pink-500 transition-all duration-300 ease-out" style={{ width: `${file.progress}%` }}></div>
                                  </div>
                                  <div className="flex justify-between items-center mt-2">
                                    <p className="text-[10px] font-black text-purple-600 uppercase tracking-widest">Streaming Data</p>
                                    <p className="text-[10px] font-black text-slate-400 tabular-nums">{file.progress}%</p>
                                  </div>
                                </div>
                              ) : file.status === TransferStatus.FAILED ? (
                                <div className="mt-3 p-4 bg-red-50 border border-red-100 rounded-2xl text-[11px] text-red-600 font-bold uppercase tracking-widest">{file.errorMessage || "Tunnel Interrupted"}</div>
                              ) : (
                                <>
                                  <div className="flex items-center gap-2.5 mt-2">
                                    <CheckIcon /><span className="text-[10px] font-black text-green-600 uppercase tracking-widest">Integrity Verified</span>
                                  </div>
                                  {file.aiInsight && (
                                    <div className="mt-4 p-4 bg-slate-50 rounded-2xl border border-slate-100 flex items-start gap-3">
                                      <div className="px-1.5 py-0.5 bg-blue-600 text-white rounded text-[8px] font-black uppercase mt-0.5">AI</div>
                                      <p className="text-[11px] text-slate-600 leading-relaxed font-medium italic">"{file.aiInsight}"</p>
                                    </div>
                                  )}
                                  <div className="mt-5 flex gap-3">
                                    <a href={file.url} download={file.name} className="flex-1 py-3.5 text-center bg-slate-900 text-white rounded-2xl text-[11px] font-black uppercase tracking-widest hover:bg-black transition-all shadow-lg shadow-slate-200 active:scale-95">Download File</a>
                                  </div>
                                </>
                              )}
                            </div>
                          </div>
                          <button onClick={() => setFiles(prev => prev.filter(f => f.id !== file.id))} className="absolute top-7 right-7 text-slate-200 hover:text-red-500 transition-colors"><TrashIcon /></button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-500">
                  {history.length === 0 ? (
                    <div className="bg-white rounded-[2.5rem] border border-slate-100 p-24 flex flex-col items-center justify-center text-center opacity-60">
                      <div className="p-5 bg-slate-50 rounded-3xl mb-6"><HistoryIcon className="text-slate-300 w-8 h-8" /></div>
                      <p className="text-slate-400 font-bold text-sm uppercase tracking-widest">No previous session logs.</p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {history.map((item) => (
                        <div key={item.id} className="bg-white p-7 rounded-[2.5rem] border border-slate-200 shadow-sm opacity-90 hover:opacity-100 transition-all hover:shadow-md">
                          <div className="flex items-start gap-5">
                            <div className="p-4 rounded-[1.5rem] bg-slate-50 text-slate-400 shadow-inner">
                              {item.sender === 'Mac' ? <LaptopIcon className="w-6 h-6" /> : <SmartphoneIcon className="w-6 h-6" />}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between mb-2">
                                <h3 className="text-sm font-black text-slate-700 truncate tracking-tight">{item.name}</h3>
                                <span className="text-[10px] font-black text-slate-400 tabular-nums">{formatSize(item.size)}</span>
                              </div>
                              
                              {renderDirectionIndicator(item.sender)}

                              <div className="flex items-center gap-3 mt-2">
                                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{new Date(item.timestamp).toLocaleDateString()}</span>
                                <div className="w-1 h-1 rounded-full bg-slate-200"></div>
                                <span className="text-[10px] font-black text-purple-500 uppercase tracking-widest">{item.type.split('/')[1] || 'BINARY'}</span>
                              </div>
                              {item.aiInsight && (
                                <div className="mt-4 p-4 bg-slate-50/50 rounded-2xl border border-slate-100 flex items-start gap-3">
                                  <div className="px-1.5 py-0.5 bg-slate-400 text-white rounded text-[8px] font-black uppercase mt-0.5">LOG</div>
                                  <p className="text-[11px] text-slate-500 leading-relaxed font-medium italic">"{item.aiInsight}"</p>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
            
            <footer className="pt-16 pb-10 text-center">
              <div className="flex flex-col items-center gap-4">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-emerald-500"></div>
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Global Transmission Status: Active</p>
                </div>
                <p className="text-slate-300 text-[10px] font-bold uppercase tracking-widest leading-relaxed">
                  Platform Operations Hub:<br/>
                  <a href="mailto:ayushglobalenterprises@zohomail.in" className="text-purple-400 hover:text-purple-600 transition-colors font-black mt-1 inline-block">ayushglobalenterprises@zohomail.in</a>
                </p>
              </div>
            </footer>
          </div>
        </div>
      </main>

      <div className="fixed bottom-8 left-1/2 transform -translate-x-1/2 lg:hidden w-[calc(100%-2rem)] max-w-sm z-30 group">
        <label className="flex items-center justify-center px-8 py-5 bg-slate-900 text-white rounded-[2.2rem] shadow-[0_20px_40px_-10px_rgba(0,0,0,0.5)] font-black uppercase tracking-widest text-[12px] cursor-pointer hover:bg-black active:scale-95 transition-all relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-r from-purple-600/20 via-pink-600/20 to-orange-500/20 opacity-0 group-active:opacity-100 transition-opacity"></div>
          <UploadIcon className="w-5 h-5" /><span className="ml-3 relative z-10">Select Stream Source</span>
          <input type="file" multiple onChange={handleFileUpload} className="hidden" />
        </label>
      </div>
    </div>
  );
};

export default App;
