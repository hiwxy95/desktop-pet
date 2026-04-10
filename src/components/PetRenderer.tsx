import React, { useState, useEffect, useRef, useCallback } from 'react';
import SpeechBubble from './SpeechBubble';

interface PetRendererProps {
  backendUrl: string;
  petId: string;
  transparent?: boolean;
}

type PetState = 'sleeping' | 'sitting' | 'eating' | 'moving';

const ALL_STATES: PetState[] = ['sitting', 'sleeping', 'eating', 'moving'];

const STATE_LABELS: Record<PetState, string> = {
  sleeping: '💤 Sleeping',
  sitting: '🐱 Sitting',
  eating: '🍽 Eating',
  moving: '🏃 Moving',
};

export default function PetRenderer({ backendUrl, petId, transparent = false }: PetRendererProps) {
  const [currentState, setCurrentState] = useState<PetState>('sitting');
  const [manifest, setManifest] = useState<any>(null);
  const [hasMatted, setHasMatted] = useState(false);
  const [videoUrls, setVideoUrls] = useState<Record<string, string>>({});
  const [loadError, setLoadError] = useState(false);
  const [reminderMessage, setReminderMessage] = useState<string | null>(null);
  // Track which videos have been loaded (preloaded = src set)
  const [loadedStates, setLoadedStates] = useState<Set<string>>(new Set(['sitting']));

  const currentStateRef = useRef(currentState);
  currentStateRef.current = currentState;
  const videoElsRef = useRef<Record<string, HTMLVideoElement | null>>({});

  // Load manifest on mount
  useEffect(() => {
    fetch(`${backendUrl}/api/pets/${petId}/manifest`)
      .then(r => r.json())
      .then(m => {
        setManifest(m);
        const matted = m?.videos?.matted && Object.keys(m.videos.matted).length > 0;
        if (matted) setHasMatted(true);

        const cacheBust = `v=${Date.now()}`;
        const urls: Record<string, string> = {};
        for (const state of ALL_STATES) {
          if (!m?.videos?.idle?.[state]) continue;
          const mattedPath = m?.videos?.matted?.[state] || '';
          if (matted && mattedPath.endsWith('.webm')) {
            urls[state] = `${backendUrl}/api/pets/${petId}/assets/matted/${state}.webm?${cacheBust}`;
          } else {
            urls[state] = `${backendUrl}/api/pets/${petId}/assets/videos/${state}.mp4?${cacheBust}`;
          }
        }
        setVideoUrls(urls);
      })
      .catch(err => {
        console.error('Failed to load manifest:', err);
        setLoadError(true);
      });
  }, [backendUrl, petId]);

  // After current video starts playing, preload the rest in background
  useEffect(() => {
    if (!manifest || Object.keys(videoUrls).length === 0) return;
    const timer = setTimeout(() => {
      setLoadedStates(new Set(ALL_STATES));
    }, 1500); // Wait 1.5s then start loading others
    return () => clearTimeout(timer);
  }, [manifest, videoUrls]);

  // When a new state is about to be shown, ensure it's in loadedStates
  useEffect(() => {
    setLoadedStates(prev => {
      if (prev.has(currentState)) return prev;
      const next = new Set(prev);
      next.add(currentState);
      return next;
    });
  }, [currentState]);

  const setVideoRef = useCallback((state: PetState) => (el: HTMLVideoElement | null) => {
    videoElsRef.current[state] = el;
    if (el && state === currentStateRef.current) {
      el.play().catch(() => {});
    }
  }, []);

  // When state changes, play active video, pause others
  useEffect(() => {
    for (const state of ALL_STATES) {
      const el = videoElsRef.current[state];
      if (!el) continue;
      if (state === currentState) {
        el.currentTime = 0;
        el.play().catch(() => {});
      } else {
        // Keep paused to save resources, but don't unload
        el.pause();
      }
    }
  }, [currentState]);

  const switchState = useCallback((newState: PetState) => {
    if (newState === currentStateRef.current) return;
    setCurrentState(newState);
  }, []);

  // WebSocket for live state updates
  useEffect(() => {
    const wsUrl = backendUrl.replace('http', 'ws') + '/ws';
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'subscribe', petId }));
      fetch(`${backendUrl}/api/pets/${petId}/mock/start`, { method: 'POST' }).catch(() => {});
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'state_change' && data.new_state) {
          switchState(data.new_state as PetState);
        } else if (data.type === 'reminder' && data.message) {
          setReminderMessage(data.message);
          if (data.audioUrl) {
            try { new Audio(`${backendUrl}${data.audioUrl}`).play().catch(() => {}); } catch {}
          }
        }
      } catch {}
    };

    return () => ws.close();
  }, [backendUrl, petId, switchState]);

  const wrapperStyle: React.CSSProperties = transparent
    ? { ...styles.wrapper, background: 'transparent', WebkitAppRegion: 'drag' } as any
    : { ...styles.wrapper, background: '#1a1a2e' };

  const stackWidth = transparent ? '100%' : '80%';
  const stackMaxWidth = transparent ? 'none' : 500;
  const stackHeight = transparent ? '100%' : 'auto';
  const stackAspect = transparent ? undefined : '1 / 1';

  // Show loading/error state in transparent mode so window isn't invisible
  const showLoading = transparent && !manifest && !loadError;
  const showError = transparent && loadError;

  return (
    <div style={wrapperStyle}>
      {showLoading && (
        <div style={{ color: '#fff', fontSize: 14, textAlign: 'center', padding: 20, background: 'rgba(0,0,0,0.5)', borderRadius: 12 }}>
          加载中...
        </div>
      )}
      {showError && (
        <div style={{ color: '#ff6b6b', fontSize: 13, textAlign: 'center', padding: 20, background: 'rgba(0,0,0,0.7)', borderRadius: 12 }}>
          加载失败，请检查网络
        </div>
      )}
      <div style={{
        position: 'relative',
        width: stackWidth,
        maxWidth: stackMaxWidth,
        height: stackHeight,
        aspectRatio: stackAspect,
      }}>
        {reminderMessage && (
          <SpeechBubble message={reminderMessage} onDismiss={() => setReminderMessage(null)} />
        )}
        {ALL_STATES.map(state => {
          const url = videoUrls[state];
          if (!url) return null;
          // Only render video element if it's been loaded
          if (!loadedStates.has(state)) return null;
          const isActive = state === currentState;
          return (
            <video
              key={state}
              ref={setVideoRef(state)}
              src={url}
              loop
              muted
              playsInline
              autoPlay={isActive}
              preload="auto"
              onError={() => {
                console.error(`Video load error for state: ${state}, url: ${url}`);
              }}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: '100%',
                objectFit: 'contain',
                borderRadius: transparent ? 0 : 16,
                opacity: isActive ? 1 : 0,
                zIndex: isActive ? 1 : 0,
                pointerEvents: isActive ? 'auto' : 'none',
              }}
            />
          );
        })}
      </div>

      {!transparent && (
        <>
          <div style={styles.stateIndicator}>
            {STATE_LABELS[currentState]}
            {hasMatted && <span style={{ marginLeft: 8, fontSize: 11, opacity: 0.6 }}>✨ alpha</span>}
          </div>

          <div style={styles.controls}>
            {ALL_STATES.map(s => (
              <button
                key={s}
                onClick={() => switchState(s)}
                style={{
                  ...styles.stateBtn,
                  ...(s === currentState ? styles.stateBtnActive : {}),
                }}
              >
                {STATE_LABELS[s]}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrapper: {
    position: 'relative',
    width: '100%',
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stateIndicator: {
    marginTop: 12,
    padding: '6px 16px',
    background: 'rgba(255,255,255,0.1)',
    borderRadius: 20,
    color: '#fff',
    fontSize: 14,
    fontWeight: 500,
  },
  controls: {
    marginTop: 16,
    display: 'flex',
    gap: 8,
    padding: '8px 16px',
    background: 'rgba(255,255,255,0.08)',
    borderRadius: 20,
  },
  stateBtn: {
    padding: '8px 16px',
    borderRadius: 12,
    border: '1px solid rgba(255,255,255,0.15)',
    background: 'rgba(255,255,255,0.05)',
    color: '#ccc',
    fontSize: 13,
    cursor: 'pointer',
    transition: 'all 0.2s',
  },
  stateBtnActive: {
    background: 'rgba(255,154,118,0.3)',
    borderColor: '#ff9a76',
    color: '#fff',
    fontWeight: 600,
  },
};
