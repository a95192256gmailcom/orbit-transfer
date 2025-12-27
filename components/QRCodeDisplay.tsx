
import React, { useEffect, useRef } from 'react';
import QRCode from 'qrcode';

interface QRCodeDisplayProps {
  text: string;
  size?: number;
}

const QRCodeDisplay: React.FC<QRCodeDisplayProps> = ({ text, size = 160 }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (canvasRef.current) {
      QRCode.toCanvas(canvasRef.current, text, {
        width: size,
        margin: 2,
        color: {
          dark: '#0f172a', // slate-900
          light: '#ffffff',
        },
      }, (error) => {
        if (error) console.error('QR Code Generation Error:', error);
      });
    }
  }, [text, size]);

  return (
    <div className="bg-white p-2 rounded-2xl shadow-sm border border-slate-100 inline-block">
      <canvas ref={canvasRef} className="rounded-xl" />
    </div>
  );
};

export default QRCodeDisplay;
