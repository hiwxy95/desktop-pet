import React, { useState, useRef } from 'react';

interface SetupPageProps {
  backendUrl: string;
  petId: string;
  onStartGeneration: () => void;
  onLaunchPet: () => void;
  onBackToPet?: () => void;
}

export default function SetupPage({ backendUrl, petId, onStartGeneration, onLaunchPet, onBackToPet }: SetupPageProps) {
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setPhoto(file);
      setPreview(URL.createObjectURL(file));
      setError('');
    }
  };

  const handleSubmit = async () => {
    if (!photo) {
      setError('Please select a pet photo');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const formData = new FormData();
      formData.append('photo', photo);

      const res = await fetch(`${backendUrl}/api/pets/${petId}/generate`, {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Generation failed');
      }

      onStartGeneration();
    } catch (err: any) {
      setError(err.message);
      setLoading(false);
    }
  };

  return (
    <div style={styles.container}>
      <h1 style={styles.title}>Desktop Pet</h1>
      <p style={styles.subtitle}>Upload your pet's photo to create a desktop companion</p>

      {/* Photo Upload */}
      <div
        style={{
          ...styles.uploadArea,
          ...(preview ? styles.uploadAreaWithPreview : {}),
        }}
        onClick={() => fileRef.current?.click()}
      >
        {preview ? (
          <img src={preview} alt="Pet" style={styles.previewImg} />
        ) : (
          <div style={styles.uploadPlaceholder}>
            <span style={styles.uploadIcon}>+</span>
            <span>Click to upload pet photo</span>
          </div>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          onChange={handleFileSelect}
          style={{ display: 'none' }}
        />
      </div>

      {/* Error */}
      {error && <p style={styles.error}>{error}</p>}

      {/* Submit */}
      <button
        onClick={handleSubmit}
        disabled={loading || !photo}
        style={{
          ...styles.button,
          ...(loading || !photo ? styles.buttonDisabled : {}),
        }}
      >
        {loading ? 'Starting...' : 'Generate Desktop Pet'}
      </button>

      {onBackToPet && (
        <button onClick={onBackToPet} style={styles.backBtn}>
          Back to Pet
        </button>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: '40px 30px',
    background: 'linear-gradient(135deg, #ffecd2 0%, #fcb69f 100%)',
    minHeight: '100vh',
    boxSizing: 'border-box',
  },
  title: {
    fontSize: 32,
    fontWeight: 700,
    color: '#333',
    margin: '0 0 8px 0',
  },
  subtitle: {
    fontSize: 14,
    color: '#666',
    margin: '0 0 30px 0',
  },
  uploadArea: {
    width: 280,
    height: 280,
    borderRadius: 20,
    border: '3px dashed #ccc',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    overflow: 'hidden',
    background: '#fff',
    transition: 'border-color 0.2s',
    marginBottom: 20,
  },
  uploadAreaWithPreview: {
    border: '3px solid #ff9a76',
  },
  previewImg: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
  },
  uploadPlaceholder: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 10,
    color: '#999',
    fontSize: 14,
  },
  uploadIcon: {
    fontSize: 48,
    fontWeight: 300,
    color: '#ccc',
  },
  error: {
    color: '#e74c3c',
    fontSize: 13,
    margin: '0 0 10px 0',
  },
  button: {
    width: 280,
    padding: '14px 0',
    borderRadius: 12,
    border: 'none',
    background: 'linear-gradient(135deg, #ff9a76, #f76b8a)',
    color: '#fff',
    fontSize: 16,
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'opacity 0.2s',
  },
  buttonDisabled: {
    opacity: 0.5,
    cursor: 'not-allowed',
  },
  backBtn: {
    marginTop: 12,
    width: 280,
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
