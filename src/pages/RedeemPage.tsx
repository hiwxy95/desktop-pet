import React, { useState } from 'react';

interface RedeemPageProps {
  backendUrl: string;
  onSuccess: (petId: string) => void;
  onBack: () => void;
}

export default function RedeemPage({ backendUrl, onSuccess, onBack }: RedeemPageProps) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (!code.trim()) {
      setError('请输入兑换码');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const res = await fetch(`${backendUrl}/api/redeem`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code.trim(), name: name.trim() || undefined }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || '兑换失败');
      }

      onSuccess(data.petId);
    } catch (err: any) {
      setError(err.message);
      setLoading(false);
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <h2 style={styles.title}>输入兑换码</h2>
        <p style={styles.subtitle}>请输入你的兑换码来创建桌面萌宠</p>

        <input
          type="text"
          value={code}
          onChange={e => setCode(e.target.value.toUpperCase())}
          placeholder="兑换码"
          style={styles.input}
          maxLength={8}
          autoFocus
        />

        <input
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="给萌宠起个名字（可选）"
          style={styles.input}
        />

        {error && <p style={styles.error}>{error}</p>}

        <button
          onClick={handleSubmit}
          disabled={loading || !code.trim()}
          style={{
            ...styles.button,
            ...(loading || !code.trim() ? styles.buttonDisabled : {}),
          }}
        >
          {loading ? '验证中...' : '确认兑换'}
        </button>

        <button onClick={onBack} style={styles.backBtn}>
          返回
        </button>
      </div>
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
    width: 360,
    textAlign: 'center',
    boxShadow: '0 10px 40px rgba(0,0,0,0.1)',
  },
  title: {
    fontSize: 22,
    fontWeight: 700,
    color: '#333',
    margin: '0 0 8px 0',
  },
  subtitle: {
    fontSize: 13,
    color: '#888',
    margin: '0 0 24px 0',
  },
  input: {
    width: '100%',
    padding: '12px 16px',
    borderRadius: 12,
    border: '2px solid #eee',
    fontSize: 16,
    marginBottom: 12,
    boxSizing: 'border-box',
    textAlign: 'center',
    letterSpacing: 2,
    outline: 'none',
  },
  error: {
    color: '#e74c3c',
    fontSize: 13,
    margin: '0 0 10px 0',
  },
  button: {
    width: '100%',
    padding: '14px 0',
    borderRadius: 12,
    border: 'none',
    background: 'linear-gradient(135deg, #ff9a76, #f76b8a)',
    color: '#fff',
    fontSize: 16,
    fontWeight: 600,
    cursor: 'pointer',
  },
  buttonDisabled: {
    opacity: 0.5,
    cursor: 'not-allowed',
  },
  backBtn: {
    marginTop: 12,
    width: '100%',
    padding: '12px 0',
    borderRadius: 12,
    border: '2px solid #ff9a76',
    background: 'transparent',
    color: '#ff9a76',
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
  },
};
