import React, { useState, useEffect, useRef } from 'react';

interface GeneratingPageProps {
  backendUrl: string;
  petId: string;
  onComplete: () => void;
}

const STAGE_LABELS: Record<string, string> = {
  starting: 'Preparing...',
  seedream: 'Generating pet images',
  seedance: 'Creating animations',
  matting: 'Processing transparency',
};

export default function GeneratingPage({ backendUrl, petId, onComplete }: GeneratingPageProps) {
  const [stage, setStage] = useState('starting');
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState('Connecting...');
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    const wsUrl = backendUrl.replace('http', 'ws') + '/ws';
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'subscribe', petId }));
    };

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);

      if (data.type === 'progress') {
        setStage(data.stage);
        setProgress(data.progress);
        setMessage(data.message);
      } else if (data.type === 'ready') {
        setStage('complete');
        setProgress(1);
        setMessage('Your desktop pet is ready!');
        setTimeout(onComplete, 1500);
      } else if (data.type === 'error') {
        setMessage(`Error: ${data.message}`);
      } else if (data.type === 'status') {
        if (data.status === 'ready') {
          onComplete();
        } else if (data.status === 'generating') {
          setStage(data.stage);
          setProgress(data.progress);
          setMessage(data.message);
        }
      }
    };

    ws.onclose = () => {
      // Try to reconnect
      setTimeout(() => {
        if (wsRef.current === ws) {
          wsRef.current = null;
        }
      }, 3000);
    };

    // Keep alive
    const pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'ping' }));
      }
    }, 30000);

    return () => {
      clearInterval(pingInterval);
      ws.close();
    };
  }, [backendUrl, petId, onComplete]);

  const overallProgress = (() => {
    const weights: Record<string, [number, number]> = {
      starting: [0, 0.05],
      seedream: [0.05, 0.25],
      seedance: [0.25, 0.85],
      matting: [0.85, 0.95],
      complete: [0.95, 1.0],
    };
    const [start, end] = weights[stage] || [0, 0];
    return start + (end - start) * progress;
  })();

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <h2 style={styles.title}>Creating Your Desktop Pet</h2>

        {/* Stage indicator */}
        <div style={styles.stages}>
          {['seedream', 'seedance', 'matting'].map((s, i) => (
            <div key={s} style={styles.stageItem}>
              <div
                style={{
                  ...styles.stageDot,
                  ...(stage === s ? styles.stageDotActive : {}),
                  ...(overallProgress > (i + 1) / 3 ? styles.stageDotDone : {}),
                }}
              />
              <span style={styles.stageLabel}>
                {STAGE_LABELS[s]}
              </span>
            </div>
          ))}
        </div>

        {/* Progress bar */}
        <div style={styles.progressBg}>
          <div
            style={{
              ...styles.progressFill,
              width: `${Math.max(overallProgress * 100, 2)}%`,
            }}
          />
        </div>

        <p style={styles.progressText}>
          {Math.round(overallProgress * 100)}%
        </p>

        <p style={styles.message}>{message}</p>

        <div style={styles.petAnimation}>
          {/* Simple loading animation */}
          <div style={styles.loadingPet}>
            <span style={{ fontSize: 64, animation: 'bounce 1s ease-in-out infinite' }}>
              {stage === 'complete' ? '🎉' : '🐾'}
            </span>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes bounce {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-10px); }
        }
      `}</style>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '100vh',
    background: 'linear-gradient(135deg, #ffecd2 0%, #fcb69f 100%)',
    padding: 20,
    boxSizing: 'border-box',
  },
  card: {
    background: '#fff',
    borderRadius: 24,
    padding: '40px 30px',
    width: 400,
    textAlign: 'center',
    boxShadow: '0 10px 40px rgba(0,0,0,0.1)',
  },
  title: {
    fontSize: 22,
    fontWeight: 700,
    color: '#333',
    margin: '0 0 30px 0',
  },
  stages: {
    display: 'flex',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  stageItem: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 6,
    flex: 1,
  },
  stageDot: {
    width: 12,
    height: 12,
    borderRadius: '50%',
    background: '#ddd',
    transition: 'all 0.3s',
  },
  stageDotActive: {
    background: '#ff9a76',
    boxShadow: '0 0 10px rgba(255,154,118,0.5)',
    transform: 'scale(1.3)',
  },
  stageDotDone: {
    background: '#4caf50',
  },
  stageLabel: {
    fontSize: 11,
    color: '#888',
  },
  progressBg: {
    width: '100%',
    height: 8,
    borderRadius: 4,
    background: '#eee',
    overflow: 'hidden',
    marginBottom: 8,
  },
  progressFill: {
    height: '100%',
    borderRadius: 4,
    background: 'linear-gradient(90deg, #ff9a76, #f76b8a)',
    transition: 'width 0.5s ease',
  },
  progressText: {
    fontSize: 14,
    fontWeight: 600,
    color: '#ff9a76',
    margin: '0 0 4px 0',
  },
  message: {
    fontSize: 13,
    color: '#888',
    margin: '0 0 30px 0',
  },
  petAnimation: {
    display: 'flex',
    justifyContent: 'center',
  },
  loadingPet: {
    width: 100,
    height: 100,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
};
