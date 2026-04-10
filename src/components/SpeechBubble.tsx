import React, { useEffect, useState } from 'react';

interface SpeechBubbleProps {
  message: string;
  onDismiss: () => void;
}

export default function SpeechBubble({ message, onDismiss }: SpeechBubbleProps) {
  const [fading, setFading] = useState(false);

  useEffect(() => {
    const fadeTimer = setTimeout(() => setFading(true), 7000);
    const dismissTimer = setTimeout(onDismiss, 8000);
    return () => { clearTimeout(fadeTimer); clearTimeout(dismissTimer); };
  }, [onDismiss]);

  return (
    <div
      style={{
        position: 'absolute',
        top: 4,
        left: '50%',
        transform: 'translateX(-50%)',
        opacity: fading ? 0 : 1,
        transition: 'opacity 1s ease',
        zIndex: 200,
        cursor: 'pointer',
        animation: 'bubblePop 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)',
        WebkitAppRegion: 'no-drag',
        pointerEvents: 'auto',
      } as any}
      onClick={onDismiss}
    >
      <style>{`
        @keyframes bubblePop {
          0% { transform: translateX(-50%) scale(0) translateY(10px); opacity: 0; }
          50% { transform: translateX(-50%) scale(1.05) translateY(-2px); opacity: 1; }
          100% { transform: translateX(-50%) scale(1) translateY(0); opacity: 1; }
        }
        @keyframes float {
          0%, 100% { transform: translateX(-50%) translateY(0); }
          50% { transform: translateX(-50%) translateY(-3px); }
        }
      `}</style>
      <div style={{
        background: 'linear-gradient(135deg, rgba(255,220,200,0.95), rgba(255,200,180,0.95))',
        borderRadius: 18,
        padding: '8px 14px',
        maxWidth: 200,
        minWidth: 60,
        boxShadow: '0 3px 12px rgba(255,154,118,0.25), 0 1px 3px rgba(0,0,0,0.1)',
        border: '1.5px solid rgba(255,180,160,0.6)',
        animation: 'float 3s ease-in-out infinite',
      }}>
        <div style={{
          fontSize: 13,
          color: '#8B4513',
          lineHeight: 1.5,
          textAlign: 'center',
          fontWeight: 500,
        }}>
          {message}
        </div>
      </div>
      {/* Cute tail — three decreasing dots */}
      <div style={{ display: 'flex', justifyContent: 'center', gap: 3, marginTop: 3 }}>
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'rgba(255,200,180,0.9)', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }} />
        <div style={{ width: 5, height: 5, borderRadius: '50%', background: 'rgba(255,200,180,0.7)', marginTop: 2 }} />
      </div>
    </div>
  );
}
