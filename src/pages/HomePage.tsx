import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';

interface HomePageProps {
  backendUrl: string;
  onRedeem: () => void;
  onViewPet: (petId: string) => void;
}

interface PetInfo {
  id: string;
  name: string;
  status: string;
  photoUrl: string;
  likes: number;
  mattedMovingUrl: string | null;
}

interface PetPosition {
  x: number; // percentage 0-80
  y: number; // percentage 20-70
  scale: number;
  delay: number; // animation delay
  duration: number; // walk cycle duration
  direction: 1 | -1; // 1=right, -1=left
}

function getClientId(): string {
  let id = localStorage.getItem('desktop-pet-client-id');
  if (!id) {
    id = 'xxxx-xxxx-xxxx-xxxx'.replace(/x/g, () =>
      Math.floor(Math.random() * 16).toString(16)
    );
    localStorage.setItem('desktop-pet-client-id', id);
  }
  return id;
}

// Simple seeded pseudo-random for stable positions across re-renders
function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function generatePositions(count: number): PetPosition[] {
  const rng = seededRandom(42);
  const cols = Math.ceil(Math.sqrt(count * 1.5)); // wider than tall
  const rows = Math.ceil(count / cols);
  const cellW = 80 / cols; // leave 10% margin each side
  const cellH = 70 / rows; // use 70% of vertical space

  const positions: PetPosition[] = [];
  for (let i = 0; i < count; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    // Base position in grid cell + random jitter
    const jitterX = (rng() - 0.5) * cellW * 0.6;
    const jitterY = (rng() - 0.5) * cellH * 0.5;
    positions.push({
      x: 10 + col * cellW + cellW / 2 + jitterX - 5,
      y: 5 + row * cellH + cellH / 2 + jitterY,
      scale: 0.75 + rng() * 0.25,
      delay: rng() * 4,
      duration: 7 + rng() * 6,
      direction: rng() > 0.5 ? 1 : -1,
    });
  }
  // Sort by y so lower pets have higher z-index (depth)
  positions.sort((a, b) => a.y - b.y);
  return positions;
}

export default function HomePage({ backendUrl, onRedeem, onViewPet }: HomePageProps) {
  const [pets, setPets] = useState<PetInfo[]>([]);
  const [totalMyLikes, setTotalMyLikes] = useState(0);
  const [animatingIds, setAnimatingIds] = useState<Set<string>>(new Set());
  const clientId = useRef(getClientId());

  const fetchPets = useCallback(() => {
    fetch(`${backendUrl}/api/pets?clientId=${clientId.current}`)
      .then(r => r.json())
      .then(data => {
        setPets((data.pets || []).filter((p: PetInfo) => p.status === 'ready'));
        setTotalMyLikes(data.totalMyLikes || 0);
      })
      .catch(() => {});
  }, [backendUrl]);

  useEffect(() => { fetchPets(); }, [fetchPets]);

  const positions = useMemo(() => generatePositions(pets.length), [pets.length]);

  const handleLike = async (e: React.MouseEvent, petId: string) => {
    e.stopPropagation();
    if (totalMyLikes >= 3) return;

    // Optimistic update
    setPets(prev => prev.map(p =>
      p.id === petId ? { ...p, likes: p.likes + 1 } : p
    ));
    setTotalMyLikes(prev => prev + 1);

    setAnimatingIds(prev => new Set(prev).add(petId));
    setTimeout(() => setAnimatingIds(prev => {
      const next = new Set(prev);
      next.delete(petId);
      return next;
    }), 400);

    try {
      const resp = await fetch(`${backendUrl}/api/pets/${petId}/like`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId: clientId.current }),
      });
      const data = await resp.json();
      setPets(prev => prev.map(p =>
        p.id === petId ? { ...p, likes: data.likes } : p
      ));
      setTotalMyLikes(data.totalMyLikes);
    } catch {
      // Rollback
      setPets(prev => prev.map(p =>
        p.id === petId ? { ...p, likes: p.likes - 1 } : p
      ));
      setTotalMyLikes(prev => prev - 1);
    }
  };

  return (
    <div style={styles.page}>
      <style>{cssAnimations}</style>

      {/* Header */}
      <div style={styles.header}>
        <h1 style={styles.title}>桌面陪伴</h1>
        <p style={styles.subtitle}>上传你最珍视的人或萌宠，让 TA 在桌面上陪伴你的每一天</p>
        <button style={styles.redeemBtn} onClick={onRedeem}>
          输入兑换码
        </button>
      </div>

      {/* Farm scene */}
      {pets.length > 0 && (
        <div style={styles.farm}>
          {/* Grass ground */}
          <div style={styles.ground} />

          {pets.map((pet, i) => {
            const pos = positions[i];
            if (!pos) return null;
            return (
              <div
                key={pet.id}
                className={`roaming-pet roaming-pet-${i}`}
                style={{
                  position: 'absolute',
                  left: `${pos.x}%`,
                  top: `${pos.y}%`,
                  transform: `scale(${pos.scale})`,
                  zIndex: Math.round(pos.y),
                  cursor: 'pointer',
                  animation: `walk${i % 2 === 0 ? 'A' : 'B'} ${pos.duration}s ease-in-out ${pos.delay}s infinite alternate`,
                }}
                onClick={() => onViewPet(pet.id)}
              >
                {/* Floating label above */}
                <div style={styles.floatingLabel}>
                  <span style={styles.nameTag}>{pet.name}</span>
                  <button
                    style={{
                      ...styles.heartBtn,
                      ...(totalMyLikes >= 3 ? styles.heartBtnDisabled : {}),
                    }}
                    className={animatingIds.has(pet.id) ? 'heart-pop' : ''}
                    onClick={(e) => handleLike(e, pet.id)}
                    disabled={totalMyLikes >= 3}
                  >
                    {pet.likes > 0 ? '❤️' : '🤍'}
                  </button>
                  <span style={styles.likeNum}>{pet.likes > 0 ? pet.likes : ''}</span>
                </div>

                {/* Pet video/image */}
                <div style={styles.petSprite}>
                  {pet.mattedMovingUrl ? (
                    <video
                      src={`${backendUrl}${pet.mattedMovingUrl}`}
                      autoPlay
                      loop
                      muted
                      playsInline
                      style={{
                        ...styles.petVideo,
                        transform: pos.direction === -1 ? 'scaleX(-1)' : 'none',
                      }}
                    />
                  ) : (
                    <img
                      src={`${backendUrl}${pet.photoUrl}`}
                      alt={pet.name}
                      style={styles.petPhoto}
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = 'none';
                      }}
                    />
                  )}
                </div>

                {/* Shadow */}
                <div style={styles.shadow} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

const cssAnimations = `
  @keyframes walkA {
    0% { transform: translateX(-30px); }
    100% { transform: translateX(40px); }
  }
  @keyframes walkB {
    0% { transform: translateX(30px); }
    100% { transform: translateX(-40px); }
  }
  @keyframes heartPop {
    0% { transform: scale(1); }
    30% { transform: scale(1.5); }
    60% { transform: scale(0.9); }
    100% { transform: scale(1); }
  }
  .heart-pop {
    animation: heartPop 0.4s ease !important;
  }
  .roaming-pet {
    transition: filter 0.2s;
  }
  .roaming-pet:hover {
    filter: brightness(1.1) drop-shadow(0 0 8px rgba(255,150,100,0.5));
  }
  .roaming-pet:hover .name-tag {
    opacity: 1;
  }
  @keyframes float {
    0%, 100% { transform: translateY(0); }
    50% { transform: translateY(-4px); }
  }
  @keyframes grassSway {
    0%, 100% { background-position: 0 0; }
    50% { background-position: 10px 0; }
  }
`;

const styles: Record<string, React.CSSProperties> = {
  page: {
    width: '100%',
    height: '100vh',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    background: 'linear-gradient(180deg, #87CEEB 0%, #B0E0E6 40%, #98D8C8 60%, #7BC67E 75%, #5DA05D 100%)',
  },
  header: {
    textAlign: 'center',
    padding: '24px 20px 12px',
    position: 'relative',
    zIndex: 100,
    flexShrink: 0,
  },
  title: {
    fontSize: 28,
    fontWeight: 700,
    color: '#fff',
    margin: '0 0 4px 0',
    textShadow: '0 2px 8px rgba(0,0,0,0.15)',
  },
  subtitle: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.85)',
    margin: '0 0 16px 0',
    textShadow: '0 1px 4px rgba(0,0,0,0.1)',
  },
  redeemBtn: {
    padding: '10px 32px',
    borderRadius: 20,
    border: '2px solid rgba(255,255,255,0.6)',
    background: 'rgba(255,255,255,0.25)',
    backdropFilter: 'blur(8px)',
    color: '#fff',
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
    textShadow: '0 1px 2px rgba(0,0,0,0.1)',
    transition: 'all 0.2s',
  },
  farm: {
    flex: 1,
    position: 'relative',
    overflow: 'auto',
    minHeight: 500,
  },
  ground: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: '35%',
    background: 'linear-gradient(180deg, transparent 0%, rgba(90,160,90,0.3) 30%, rgba(60,130,60,0.5) 100%)',
    borderRadius: '50% 50% 0 0 / 20% 20% 0 0',
  },
  floatingLabel: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    marginBottom: 2,
    animation: 'float 3s ease-in-out infinite',
    whiteSpace: 'nowrap',
  },
  nameTag: {
    fontSize: 13,
    fontWeight: 600,
    color: '#fff',
    textShadow: '0 1px 4px rgba(0,0,0,0.4), 0 0 8px rgba(0,0,0,0.2)',
    padding: '2px 8px',
    borderRadius: 10,
    background: 'rgba(0,0,0,0.25)',
    backdropFilter: 'blur(4px)',
  },
  heartBtn: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontSize: 16,
    padding: '0 2px',
    lineHeight: 1,
    filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.3))',
    transition: 'transform 0.15s',
  },
  heartBtnDisabled: {
    cursor: 'default',
    opacity: 0.5,
  },
  likeNum: {
    fontSize: 12,
    fontWeight: 600,
    color: '#fff',
    textShadow: '0 1px 3px rgba(0,0,0,0.4)',
    minWidth: 8,
  },
  petSprite: {
    width: 100,
    height: 100,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  petVideo: {
    width: '100%',
    height: '100%',
    objectFit: 'contain',
  },
  petPhoto: {
    width: 80,
    height: 80,
    borderRadius: '50%',
    objectFit: 'cover',
    border: '3px solid rgba(255,255,255,0.7)',
    boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
  },
  shadow: {
    width: 60,
    height: 12,
    margin: '-6px auto 0',
    borderRadius: '50%',
    background: 'rgba(0,0,0,0.15)',
    filter: 'blur(4px)',
  },
};
