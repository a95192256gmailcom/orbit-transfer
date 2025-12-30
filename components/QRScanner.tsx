
import React, { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import { CloseIcon } from './Icons';

interface QRScannerProps {
  onScan: (data: string) => void;
  onClose: () => void;
}

const QRScanner: React.FC<QRScannerProps> = ({ onScan, onClose }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let animationFrameId: number;
    let stream: MediaStream | null = null;

    const startCamera = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' }
        });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.setAttribute('playsinline', 'true');
          videoRef.current.play();
          requestAnimationFrame(tick);
        }
      } catch (err) {
        console.error('Camera access error:', err);
        setError('Camera access denied. Please check permissions.');
      }
    };

    const tick = () => {
      if (videoRef.current && canvasRef.current && videoRef.current.readyState === videoRef.current.HAVE_ENOUGH_DATA) {
        const canvas = canvasRef.current;
        const video = videoRef.current;
        const context = canvas.getContext('2d', { willReadFrequently: true });

        if (context) {
          canvas.height = video.videoHeight;
          canvas.width = video.videoWidth;
          context.drawImage(video, 0, 0, canvas.width, canvas.height);
          
          const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
          const code = jsQR(imageData.data, imageData.width, imageData.height, {
            inversionAttempts: 'dontInvert',
          });

          if (code) {
            // Check if it's a valid 6-character room code
            if (code.data && code.data.length === 6) {
              onScan(code.data.toUpperCase());
              return; // Stop scanning
            }
          }
        }
      }
      animationFrameId = requestAnimationFrame(tick);
    };

    startCamera();

    return () => {
      cancelAnimationFrame(animationFrameId);
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
    };
  }, [onScan]);

  return (
    <div className="fixed inset-0 z-[100] bg-[#0d0e17] flex flex-col items-center justify-center p-6">
      <div className="absolute top-8 right-8 z-[110]">
        <button 
          onClick={onClose}
          className="p-4 bg-white/10 hover:bg-white/20 rounded-full text-white transition-all backdrop-blur-md border border-white/10"
        >
          <CloseIcon />
        </button>
      </div>

      <div className="relative w-full max-w-md aspect-square rounded-[3rem] overflow-hidden border-4 border-white/10 shadow-[0_0_50px_rgba(0,0,0,0.5)]">
        <video ref={videoRef} className="w-full h-full object-cover" />
        <canvas ref={canvasRef} className="hidden" />
        
        {/* Scanner Overlay UI */}
        <div className="absolute inset-0 border-[40px] border-black/40 pointer-events-none"></div>
        <div className="absolute inset-[40px] border-2 border-purple-500/50 rounded-2xl pointer-events-none">
          {/* Animated Scanning Line */}
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-purple-400 to-transparent shadow-[0_0_15px_rgba(168,85,247,0.8)] animate-scan"></div>
          
          {/* Corners */}
          <div className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-purple-500 rounded-tl-lg"></div>
          <div className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-purple-500 rounded-tr-lg"></div>
          <div className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-purple-500 rounded-bl-lg"></div>
          <div className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-purple-500 rounded-br-lg"></div>
        </div>

        {error && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/80 p-8 text-center">
            <p className="text-red-400 font-bold">{error}</p>
          </div>
        )}
      </div>

      <div className="mt-12 text-center space-y-2">
        <h3 className="text-xl font-black text-white tracking-widest uppercase">Align Orbit Code</h3>
        <p className="text-slate-400 text-sm font-medium">Point your camera at the QR code on the other device</p>
      </div>

      <style>{`
        @keyframes scan {
          0% { top: 0; }
          100% { top: 100%; }
        }
        .animate-scan {
          animation: scan 2s linear infinite;
        }
      `}</style>
    </div>
  );
};

export default QRScanner;
