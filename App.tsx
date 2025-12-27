
import React, { useState, useEffect, useCallback } from 'react';
import { RoomState, SharedFile, TransferStatus } from './types';
import { LaptopIcon, SmartphoneIcon, UploadIcon, FileIcon, CheckIcon, CopyIcon, CameraIcon } from './components/Icons';
import { getFileInsight } from './services/geminiService';
import QRScanner from './components/QRScanner';
import QRCodeDisplay from './components/QRCodeDisplay';

const App: React.FC = () => {
  const [roomId, setRoomId] = useState<string | null>(null);
  const [joinInput, setJoinInput] = useState('');
  const [files, setFiles] = useState<SharedFile[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [deviceType, setDeviceType] = useState<'Mac' | 'Android'>('Mac');
  const [showScanner, setShowScanner] = useState(false);

  // Detect device type on mount
  useEffect(() => {
    const ua = navigator.userAgent;
    if (/Android/i.test(ua)) {
      setDeviceType('Android');
    } else {
      setDeviceType('Mac');
    }
  }, []);

  const createRoom = () => {
    const newRoomId = Math.random().toString(36).substring(2, 8).toUpperCase();
    setRoomId(newRoomId);
  };

  const joinRoom = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (joinInput.length === 6) {
      setRoomId(joinInput.toUpperCase());
    }
  };

  const handleQRScan = (code: string) => {
    // Extract 6 character code if it's a URL or just a code
    const cleanCode = code.length > 6 ? code.split('/').pop()?.toUpperCase() || '' : code.toUpperCase();
    if (cleanCode.length === 6) {
      setJoinInput(cleanCode);
      setRoomId(cleanCode);
      setShowScanner(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;

    setIsUploading(true);
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
        sender: deviceType
      };

      setFiles(prev => [newFile, ...prev]);

      // Mock upload progress
      let prog = 0;
      const interval = setInterval(() => {
        prog += 10;
        setFiles(prev => prev.map(f => f.id === id ? { ...f, progress: prog } : f));
        if (prog >= 100) {
          clearInterval(interval);
          finishUpload(id, file.name, file.type, file.size);
        }
      }, 200);
    }
    setIsUploading(false);
  };

  const finishUpload = async (id: string, name: string, type: string, size: number) => {
    const insight = await getFileInsight(name, type, size);
    setFiles(prev => prev.map(f => 
      f.id === id ? { ...f, status: TransferStatus.COMPLETED, progress: 100, aiInsight: insight } : f
    ));
  };

  const formatSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const copyRoomId = () => {
    if (roomId) {
      navigator.clipboard.writeText(roomId);
      alert('Room code copied to clipboard!');
    }
  };

  if (!roomId) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-slate-50 to-blue-50">
        <div className="max-w-md w-full space-y-8 glass p-10 rounded-3xl shadow-2xl border border-white">
          <div className="text-center">
            <div className="inline-flex items-center justify-center p-4 bg-blue-600 rounded-2xl shadow-lg mb-6">
              <UploadIcon />
            </div>
            <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">Orbit Transfer</h1>
            <p className="mt-3 text-slate-500 font-medium">Fast, secure peer-to-peer sharing between your Mac and Android.</p>
          </div>

          <div className="space-y-4">
            <button 
              onClick={createRoom}
              className="w-full flex items-center justify-center px-6 py-4 border border-transparent text-lg font-semibold rounded-2xl text-white bg-blue-600 hover:bg-blue-700 transition-all shadow-md hover:shadow-lg transform hover:-translate-y-0.5"
            >
              Create Secure Room
            </button>
            <div className="relative">
              <div className="absolute inset-0 flex items-center" aria-hidden="true">
                <div className="w-full border-t border-slate-200"></div>
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-3 bg-white text-slate-500 font-semibold rounded-full border border-slate-100 uppercase tracking-widest">or join</span>
              </div>
            </div>
            <form onSubmit={joinRoom} className="space-y-3">
              <div className="flex gap-2">
                <input
                  type="text"
                  maxLength={6}
                  value={joinInput}
                  onChange={(e) => setJoinInput(e.target.value.toUpperCase())}
                  placeholder="Enter 6-digit code"
                  className="flex-1 block w-full px-5 py-4 text-center tracking-[0.5em] font-mono text-xl border border-slate-200 rounded-2xl focus:ring-blue-500 focus:border-blue-500 transition-all outline-none"
                />
                <button 
                  type="button"
                  onClick={() => setShowScanner(true)}
                  className="px-5 py-4 bg-white border border-slate-200 text-slate-600 rounded-2xl hover:bg-slate-50 transition-all shadow-sm"
                  title="Scan QR Code"
                >
                  <CameraIcon />
                </button>
              </div>
              <button 
                type="submit"
                className="w-full py-4 bg-slate-900 text-white font-semibold rounded-2xl hover:bg-black transition-all shadow-md"
              >
                Join with Code
              </button>
            </form>
          </div>

          <div className="flex justify-center items-center gap-6 mt-8 pt-8 border-t border-slate-100">
             <div className="flex flex-col items-center opacity-50">
               <LaptopIcon />
               <span className="text-xs mt-1 font-bold">Mac</span>
             </div>
             <div className="h-4 w-px bg-slate-200"></div>
             <div className="flex flex-col items-center opacity-50">
               <SmartphoneIcon />
               <span className="text-xs mt-1 font-bold">Android</span>
             </div>
          </div>
        </div>
        
        {showScanner && (
          <QRScanner 
            onScan={handleQRScan} 
            onClose={() => setShowScanner(false)} 
          />
        )}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 pb-20">
      {/* Header */}
      <nav className="glass sticky top-0 z-10 px-4 py-4 border-b border-slate-200 shadow-sm">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-600 text-white rounded-lg">
              <UploadIcon />
            </div>
            <span className="text-xl font-bold tracking-tight">Orbit Transfer</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="hidden md:flex flex-col items-end mr-2">
              <span className="text-[10px] uppercase font-bold text-slate-400 leading-none">Your Device</span>
              <span className="text-xs font-semibold text-blue-600">{deviceType}</span>
            </div>
            <div className="bg-white border border-slate-200 px-4 py-2 rounded-xl flex items-center gap-3 shadow-sm">
              <span className="text-sm font-mono font-bold text-slate-700 tracking-wider uppercase">{roomId}</span>
              <button onClick={copyRoomId} className="text-slate-400 hover:text-blue-600 transition-colors">
                <CopyIcon />
              </button>
            </div>
            <button 
              onClick={() => setRoomId(null)}
              className="text-sm font-bold text-red-500 hover:text-red-700 ml-2"
            >
              Exit
            </button>
          </div>
        </div>
      </nav>

      <main className="max-w-4xl mx-auto px-4 mt-10">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* Left Column: Upload Area & QR */}
          <div className="lg:col-span-1 space-y-6">
            <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
              <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
                <UploadIcon />
                Share Files
              </h2>
              <div className="relative group">
                <input
                  type="file"
                  multiple
                  onChange={handleFileUpload}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                />
                <div className="border-2 border-dashed border-slate-200 rounded-2xl p-10 flex flex-col items-center justify-center text-center group-hover:border-blue-400 group-hover:bg-blue-50 transition-all duration-300">
                  <div className="w-12 h-12 bg-slate-100 rounded-full flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                    <UploadIcon />
                  </div>
                  <p className="text-sm font-semibold text-slate-700">Drag & drop files here</p>
                  <p className="text-xs text-slate-400 mt-1">or click to browse</p>
                </div>
              </div>
            </div>

            <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm flex flex-col items-center text-center">
              <h3 className="text-sm font-bold text-slate-900 mb-4 uppercase tracking-wider">Connect Mobile</h3>
              <QRCodeDisplay text={roomId} size={140} />
              <p className="text-[10px] text-slate-400 font-bold mt-4 uppercase tracking-widest">Scan code to join room</p>
            </div>
          </div>

          {/* Right Column: File List */}
          <div className="lg:col-span-2 space-y-4">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-lg font-bold">Transfer Room</h2>
              <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">{files.length} Total Files</span>
            </div>

            {files.length === 0 ? (
              <div className="bg-white rounded-3xl border border-slate-100 p-20 flex flex-col items-center justify-center text-center">
                <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mb-4">
                   <FileIcon />
                </div>
                <p className="text-slate-400 font-medium">Waiting for transfers...</p>
                <p className="text-xs text-slate-300 mt-1">Connected devices will see files here instantly.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {files.map((file) => (
                  <div key={file.id} className="bg-white p-5 rounded-3xl border border-slate-200 shadow-sm hover:shadow-md transition-shadow group">
                    <div className="flex items-start gap-4">
                      <div className={`p-3 rounded-2xl ${file.sender === 'Mac' ? 'bg-indigo-50 text-indigo-600' : 'bg-green-50 text-green-600'}`}>
                        {file.sender === 'Mac' ? <LaptopIcon /> : <SmartphoneIcon />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-1">
                          <h3 className="text-sm font-bold text-slate-900 truncate">{file.name}</h3>
                          <span className="text-[10px] font-bold text-slate-400">{formatSize(file.size)}</span>
                        </div>
                        
                        {file.status === TransferStatus.UPLOADING ? (
                          <div className="mt-2">
                            <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                              <div 
                                className="h-full bg-blue-600 transition-all duration-300"
                                style={{ width: `${file.progress}%` }}
                              ></div>
                            </div>
                            <p className="text-[10px] font-bold text-blue-600 mt-1 uppercase tracking-wider">Transferring {file.progress}%</p>
                          </div>
                        ) : (
                          <>
                            <div className="flex items-center gap-2 mt-1">
                              <CheckIcon />
                              <span className="text-[10px] font-bold text-green-600 uppercase tracking-wider">Available for download</span>
                              <span className="text-[10px] font-bold text-slate-300">•</span>
                              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{new Date(file.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                            </div>
                            {file.aiInsight && (
                              <div className="mt-3 p-3 bg-slate-50 rounded-xl border border-slate-100 flex items-start gap-2">
                                <span className="text-blue-500 font-bold text-[10px] uppercase mt-0.5">AI</span>
                                <p className="text-xs text-slate-600 italic leading-relaxed">{file.aiInsight}</p>
                              </div>
                            )}
                            <div className="mt-4 flex gap-2">
                              <a 
                                href={file.url} 
                                download={file.name}
                                className="flex-1 py-2 text-center bg-slate-900 text-white rounded-xl text-xs font-bold hover:bg-black transition-colors shadow-sm"
                              >
                                Download
                              </a>
                              <button className="px-4 py-2 border border-slate-200 rounded-xl text-slate-600 hover:bg-slate-50 transition-colors">
                                <FileIcon />
                              </button>
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
        </div>
      </main>

      {/* Persistent Mobile Action Button */}
      <div className="fixed bottom-6 left-1/2 transform -translate-x-1/2 lg:hidden w-11/12 max-w-sm">
        <label className="flex items-center justify-center w-full px-6 py-4 bg-blue-600 text-white rounded-2xl shadow-2xl font-bold cursor-pointer hover:bg-blue-700 active:scale-95 transition-all">
          <UploadIcon />
          <span className="ml-2">Quick Share</span>
          <input type="file" multiple onChange={handleFileUpload} className="hidden" />
        </label>
      </div>
    </div>
  );
};

export default App;
