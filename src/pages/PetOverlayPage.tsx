import React, { useState, useEffect, useRef, useCallback } from 'react';
import PetRenderer from '../components/PetRenderer';
import ReminderPanel from '../components/ReminderPanel';
import ChatDialog from '../components/ChatDialog';

interface PetOverlayPageProps {
  backendUrl: string;
  petId: string;
  transparent?: boolean;
  onBackToSetup?: () => void;
}

const STATES = ['sitting', 'sleeping', 'eating', 'moving'] as const;

type CameraStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export default function PetOverlayPage({ backendUrl, petId, transparent = false, onBackToSetup }: PetOverlayPageProps) {
  const [mockRunning, setMockRunning] = useState(false);
  const [cameraStatus, setCameraStatus] = useState<CameraStatus>('disconnected');
  const [mode, setMode] = useState<'mock' | 'camera' | 'reminder'>('mock');
  const [chatOpen, setChatOpen] = useState(false);
  const [reminderOpen, setReminderOpen] = useState(false);

  // Poll camera status when in camera mode
  useEffect(() => {
    if (mode !== 'camera') return;
    const poll = setInterval(async () => {
      try {
        const res = await fetch(`${backendUrl}/api/camera/status`);
        const data = await res.json();
        setCameraStatus(data.status);
      } catch {}
    }, 3000);
    return () => clearInterval(poll);
  }, [mode, backendUrl]);

  const startMock = async () => {
    await fetch(`${backendUrl}/api/pets/${petId}/mock/start`, { method: 'POST' });
    setMockRunning(true);
  };

  const stopMock = async () => {
    await fetch(`${backendUrl}/api/pets/${petId}/mock/stop`, { method: 'POST' });
    setMockRunning(false);
  };

  const setState = async (state: string) => {
    await fetch(`${backendUrl}/api/pets/${petId}/state`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state }),
    });
  };

  const startCamera = async (useMock = false) => {
    setCameraStatus('connecting');
    if (mockRunning) {
      await fetch(`${backendUrl}/api/pets/${petId}/mock/stop`, { method: 'POST' });
      setMockRunning(false);
    }
    const url = useMock
      ? `${backendUrl}/api/camera/start?mock=true`
      : `${backendUrl}/api/camera/start`;
    await fetch(url, { method: 'POST' });
  };

  const stopCamera = async () => {
    await fetch(`${backendUrl}/api/camera/stop`, { method: 'POST' });
    setCameraStatus('disconnected');
  };

  // Zoom via scroll wheel + Cmd+/- keyboard shortcuts
  useEffect(() => {
    if (!transparent) return;
    const api = (window as any).electronAPI;
    if (!api?.resizeWindow) return;

    const handleWheel = (e: WheelEvent) => {
      if (chatOpen || reminderOpen) return;
      e.preventDefault();
      e.stopPropagation();
      const delta = e.deltaY < 0 ? 20 : -20;
      console.log(`[Zoom:renderer] wheel deltaY=${e.deltaY} delta=${delta}`);
      if (api.zoomPet) {
        api.zoomPet(delta);
      } else {
        const base = (window as any).__petBaseSize || window.innerWidth;
        const s = Math.max(150, Math.min(800, base + delta));
        (window as any).__petBaseSize = s;
        api.resizeWindow(s, s);
      }
    };

    const handleKey = (e: KeyboardEvent) => {
      if (chatOpen || reminderOpen) return;
      if (!(e.metaKey || e.ctrlKey)) return;
      const base = (window as any).__petBaseSize || window.innerWidth;
      if (e.key === '=' || e.key === '+') {
        e.preventDefault();
        const s = Math.min(800, base + 50);
        (window as any).__petBaseSize = s;
        api.resizeWindow(s, s);
      } else if (e.key === '-') {
        e.preventDefault();
        const s = Math.max(150, base - 50);
        (window as any).__petBaseSize = s;
        api.resizeWindow(s, s);
      }
    };

    window.addEventListener('wheel', handleWheel, { passive: false });
    window.addEventListener('keydown', handleKey);
    return () => {
      window.removeEventListener('wheel', handleWheel);
      window.removeEventListener('keydown', handleKey);
    };
  }, [transparent, chatOpen, reminderOpen]);

  // Double-click or Enter to open chat in transparent mode
  useEffect(() => {
    if (!transparent) return;
    const handleDblClick = () => setChatOpen(prev => !prev);
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) setChatOpen(prev => !prev);
    };
    window.addEventListener('dblclick', handleDblClick);
    window.addEventListener('keydown', handleKey);
    return () => {
      window.removeEventListener('dblclick', handleDblClick);
      window.removeEventListener('keydown', handleKey);
    };
  }, [transparent]);

  const [savedPetSize, setSavedPetSize] = useState(300);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  // chatReply removed — using TTS audio only
  const [chatHistory, setChatHistory] = useState<{ role: string; content: string }[]>([]);
  const chatInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!transparent) return;
    setSavedPetSize(window.innerWidth);
    const onResize = () => {
      // When no panel is open, window is square — update base size
      if (!chatOpen && !reminderOpen) {
        const s = window.innerWidth;
        setSavedPetSize(s);
        (window as any).__petBaseSize = s;
      }
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [transparent, chatOpen, reminderOpen]);

  const electronApi = typeof window !== 'undefined' ? (window as any).electronAPI : null;
  const getBaseSize = () => (window as any).__petBaseSize || savedPetSize;

  // Send chat message — shows reply as a floating bubble
  const sendChat = useCallback(async () => {
    const text = chatInput.trim();
    if (!text || chatLoading) return;
    setChatInput('');
    setChatLoading(true);
    const newHistory = [...chatHistory, { role: 'user', content: text }];
    setChatHistory(newHistory.slice(-10));
    try {
      const res = await fetch(`${backendUrl}/api/pets/${petId}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, history: newHistory.slice(-10) }),
      });
      const data = await res.json();
      const reply = data.reply || '...';
      setChatHistory(prev => [...prev, { role: 'assistant', content: reply }]);
      // Play TTS audio
      if (data.audioUrl) {
        try {
          const audio = new Audio(`${backendUrl}${data.audioUrl}`);
          audio.play().catch(() => {});
        } catch {}
      }
    } catch {
      // Network error — silent fail
    } finally {
      setChatLoading(false);
    }
  }, [chatInput, chatLoading, chatHistory, backendUrl, petId]);

  const openPanel = (panel: 'chat' | 'reminder') => {
    if (panel === 'chat') {
      setChatOpen(!chatOpen);
      setReminderOpen(false);
      if (!chatOpen) {
        setTimeout(() => chatInputRef.current?.focus(), 100);
      }
    } else {
      if (reminderOpen) {
        setReminderOpen(false);
      } else {
        setChatOpen(false);
        setReminderOpen(true);
      }
    }
  };

  const closeAllPanels = () => {
    setChatOpen(false);
    setReminderOpen(false);
  };

  // In Electron transparent mode
  // Window size never changes — panels share space inside the same window
  // Pet area shrinks proportionally when panels open
  if (transparent) {
    // Calculate layout proportions based on window size
    const petRatio = chatOpen ? 0.85 : reminderOpen ? 0.6 : 1;
    const petHeight = `${petRatio * 100}%`;
    const panelHeight = `${(1 - petRatio) * 100}%`;

    return (
      <div style={{ width: '100vw', height: '100vh', background: 'transparent', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>

        {/* Pet area — proportional height */}
        <div style={{ width: '100%', height: petHeight, position: 'relative', overflow: 'hidden', flexShrink: 0 }}>
          <PetRenderer backendUrl={backendUrl} petId={petId} transparent />

          {/* Loading indicator while waiting for TTS */}
          {chatLoading && (
            <div style={{
              position: 'absolute', top: '3%', left: '50%', transform: 'translateX(-50%)',
              zIndex: 200, WebkitAppRegion: 'no-drag', pointerEvents: 'none',
            } as any}>
              <div style={{
                background: 'rgba(0,0,0,0.4)', borderRadius: 12, padding: '4px 10px',
              }}>
                <div style={{ fontSize: 10, color: '#fff' }}>🎤 ...</div>
              </div>
            </div>
          )}

          {/* Mini action buttons — inside pet area, bottom-right */}
          <div style={{
            position: 'absolute', bottom: 4, right: 4,
            display: 'flex', flexDirection: 'column', gap: 4,
            zIndex: 100, WebkitAppRegion: 'no-drag', pointerEvents: 'auto',
          } as any}>
            <button onClick={() => openPanel('chat')} title="聊天" style={{
              width: 22, height: 22, borderRadius: '50%', border: 'none',
              background: chatOpen ? '#ff9a76' : 'rgba(255,255,255,0.25)',
              color: '#fff', fontSize: 11, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 1px 4px rgba(0,0,0,0.25)', transition: 'all 0.2s',
            }}>💬</button>
            <button onClick={() => openPanel('reminder')} title="提醒" style={{
              width: 22, height: 22, borderRadius: '50%', border: 'none',
              background: reminderOpen ? '#4CAF50' : 'rgba(255,255,255,0.25)',
              color: '#fff', fontSize: 11, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 1px 4px rgba(0,0,0,0.25)', transition: 'all 0.2s',
            }}>⏰</button>
          </div>
        </div>

        {/* Chat input bar — shares window space with pet */}
        {chatOpen && (
          <div style={{
            height: panelHeight, minHeight: 36,
            display: 'flex', gap: 4, padding: '3px 6px', alignItems: 'center',
            background: 'transparent', borderRadius: '0 0 10px 10px',
            WebkitAppRegion: 'no-drag', pointerEvents: 'auto',
          } as any}>
            <input
              ref={chatInputRef}
              value={chatInput}
              onChange={e => setChatInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); sendChat(); } }}
              placeholder="说点什么..."
              disabled={chatLoading}
              style={{
                flex: 1, padding: '0 8px', height: '70%', borderRadius: 8,
                border: '1px solid rgba(200,200,200,0.4)',
                background: 'rgba(255,255,255,0.75)', color: '#333',
                fontSize: 11, outline: 'none',
              }}
            />
            <button onClick={sendChat} disabled={chatLoading || !chatInput.trim()} style={{
              padding: '0 10px', height: '70%', borderRadius: 8, border: 'none',
              background: '#ff9a76', color: '#fff', fontSize: 11, fontWeight: 600,
              cursor: 'pointer', opacity: chatLoading || !chatInput.trim() ? 0.5 : 1,
            }}>发送</button>
          </div>
        )}

        {/* Reminder panel — shares window space with pet */}
        {reminderOpen && (
          <div style={{
            height: panelHeight, overflow: 'auto',
            background: 'rgba(255,255,255,0.85)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
            borderRadius: '0 0 10px 10px',
            padding: '6px 8px', color: '#333', fontSize: 11,
            WebkitAppRegion: 'no-drag', pointerEvents: 'auto',
          } as any}>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 2 }}>
              <button onClick={closeAllPanels} style={{ background: 'none', border: 'none', color: '#999', fontSize: 14, cursor: 'pointer', padding: 0 }}>✕</button>
            </div>
            <ReminderPanel backendUrl={backendUrl} petId={petId} light />
          </div>
        )}
      </div>
    );
  }

  const statusColors: Record<CameraStatus, string> = {
    disconnected: '#888',
    connecting: '#f0ad4e',
    connected: '#4CAF50',
    error: '#e74c3c',
  };

  // Browser preview mode: dark background + controls
  return (
    <div style={styles.container}>
      <PetRenderer backendUrl={backendUrl} petId={petId} />
      {chatOpen && <ChatDialog backendUrl={backendUrl} petId={petId} onClose={() => setChatOpen(false)} />}

      <div style={styles.panel}>
        {/* Mode tabs */}
        <div style={styles.tabRow}>
          <button
            style={{ ...styles.tab, ...(mode === 'mock' ? styles.tabActive : {}) }}
            onClick={() => setMode('mock')}
          >
            Mock
          </button>
          <button
            style={{ ...styles.tab, ...(mode === 'camera' ? styles.tabActive : {}) }}
            onClick={() => setMode('camera')}
          >
            Camera
          </button>
          <button
            style={{ ...styles.tab, ...(mode === 'reminder' ? styles.tabActive : {}) }}
            onClick={() => setMode('reminder')}
          >
            提醒
          </button>
        </div>
        <button
          style={{ ...styles.autoBtn, marginBottom: 8, background: chatOpen ? '#e74c3c' : '#ff9a76' }}
          onClick={() => setChatOpen(!chatOpen)}
        >
          {chatOpen ? '关闭对话' : '💬 和宠物聊天'}
        </button>

        {mode === 'reminder' ? (
          <ReminderPanel backendUrl={backendUrl} petId={petId} />
        ) : mode === 'mock' ? (
          <>
            <div style={styles.btnRow}>
              {STATES.map((s) => (
                <button key={s} style={styles.stateBtn} onClick={() => setState(s)}>
                  {s}
                </button>
              ))}
            </div>
            <div style={styles.autoRow}>
              {mockRunning ? (
                <button style={{ ...styles.autoBtn, background: '#e74c3c' }} onClick={stopMock}>
                  Stop Auto
                </button>
              ) : (
                <button style={styles.autoBtn} onClick={startMock}>
                  Start Auto
                </button>
              )}
            </div>
          </>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
              <div style={{
                width: 8, height: 8, borderRadius: '50%',
                background: statusColors[cameraStatus],
              }} />
              <span style={{ fontSize: 11, color: '#ccc' }}>{cameraStatus}</span>
            </div>
            {cameraStatus === 'disconnected' ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <button style={styles.autoBtn} onClick={() => startCamera(false)}>
                  Connect Camera
                </button>
                <button style={{ ...styles.autoBtn, background: '#9b59b6' }} onClick={() => startCamera(true)}>
                  Mock Camera (Video)
                </button>
              </div>
            ) : (
              <button style={{ ...styles.autoBtn, background: '#e74c3c' }} onClick={stopCamera}>
                Disconnect
              </button>
            )}
            {cameraStatus === 'connecting' && (
              <div style={{ fontSize: 10, color: '#f0ad4e', marginTop: 6 }}>
                Connecting to camera...
              </div>
            )}
          </>
        )}

        <a
          href={`${backendUrl}/api/download/mac`}
          style={{ ...styles.autoBtn, marginTop: 8, background: '#2196F3', textAlign: 'center', textDecoration: 'none', display: 'block' }}
        >
          下载桌面版 (macOS)
        </a>
        <div style={{ fontSize: 9, color: '#999', marginTop: 2, lineHeight: '1.3' }}>
          安装后右键点击App → 打开 → 再点"打开"
        </div>
        <a
          href={`${backendUrl}/api/download/win`}
          style={{ ...styles.autoBtn, marginTop: 4, background: '#0078D4', textAlign: 'center', textDecoration: 'none', display: 'block' }}
        >
          下载桌面版 (Windows)
        </a>

        {onBackToSetup && (
          <button style={styles.reuploadBtn} onClick={onBackToSetup}>
            重新上传
          </button>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    width: '100vw',
    height: '100vh',
    display: 'flex',
    flexDirection: 'column',
    background: '#ffffff',
  },
  panel: {
    position: 'absolute',
    top: 12,
    right: 12,
    background: 'rgba(0,0,0,0.7)',
    borderRadius: 12,
    padding: '10px 14px',
    color: '#fff',
    fontSize: 12,
    zIndex: 100,
  },
  tabRow: {
    display: 'flex',
    gap: 2,
    marginBottom: 8,
  },
  tab: {
    flex: 1,
    padding: '4px 0',
    borderRadius: 6,
    border: '1px solid rgba(255,255,255,0.15)',
    background: 'transparent',
    color: '#888',
    fontSize: 11,
    cursor: 'pointer',
    textAlign: 'center' as const,
  },
  tabActive: {
    background: 'rgba(255,255,255,0.15)',
    color: '#fff',
    borderColor: 'rgba(255,255,255,0.3)',
  },
  panelTitle: {
    fontWeight: 600,
    marginBottom: 8,
    fontSize: 13,
    color: '#aaa',
  },
  btnRow: {
    display: 'flex',
    gap: 4,
    marginBottom: 8,
  },
  stateBtn: {
    padding: '4px 10px',
    borderRadius: 8,
    border: '1px solid rgba(255,255,255,0.2)',
    background: 'rgba(255,255,255,0.1)',
    color: '#fff',
    fontSize: 11,
    cursor: 'pointer',
  },
  autoRow: {
    display: 'flex',
  },
  autoBtn: {
    padding: '4px 14px',
    borderRadius: 8,
    border: 'none',
    background: '#4CAF50',
    color: '#fff',
    fontSize: 11,
    cursor: 'pointer',
    width: '100%',
  },
  reuploadBtn: {
    marginTop: 8,
    padding: '6px 14px',
    borderRadius: 8,
    border: '1px solid rgba(255,255,255,0.2)',
    background: 'rgba(255,154,118,0.3)',
    color: '#fff',
    fontSize: 11,
    cursor: 'pointer',
    width: '100%',
  },
};
