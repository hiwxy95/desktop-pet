import React, { useState } from 'react';
import HomePage from './pages/HomePage';
import RedeemPage from './pages/RedeemPage';
import SetupPage from './pages/SetupPage';
import GeneratingPage from './pages/GeneratingPage';
import PetOverlayPage from './pages/PetOverlayPage';

type Page = 'home' | 'redeem' | 'setup' | 'generating' | 'pet';

const BACKEND_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  ? 'http://127.0.0.1:8765'
  : `${window.location.protocol}//${window.location.host}`;

function parseHash(): { page: Page; petId: string | null } {
  const hash = window.location.hash.replace('#/', '').replace('#', '').replace(/\/+$/, '');
  // #/pet/<petId> or #/pet/<petId>/setup or #/pet/<petId>/generating
  const petMatch = hash.match(/^pet\/([^/]+)(\/(.+))?$/);
  if (petMatch) {
    const petId = petMatch[1];
    const sub = petMatch[3];
    if (sub === 'setup') return { page: 'setup', petId };
    if (sub === 'generating') return { page: 'generating', petId };
    return { page: 'pet', petId };
  }
  if (hash === 'redeem') return { page: 'redeem', petId: null };
  return { page: 'home', petId: null };
}

function App() {
  const initial = parseHash();
  const isElectron = !!(window as any).electronAPI;
  const isElectronPet = initial.page === 'pet' && isElectron;

  const [page, setPage] = useState<Page>(initial.page);
  const [petId, setPetId] = useState<string | null>(initial.petId);

  // Report client type on load
  useState(() => {
    fetch(`${BACKEND_URL}/api/heartbeat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client: isElectron ? 'electron' : 'browser' }),
    }).catch(() => {});
  });

  const navigate = (p: Page, id?: string | null) => {
    if (id !== undefined) setPetId(id);
    setPage(p);
    // Update hash
    const pid = id !== undefined ? id : petId;
    if (p === 'home') window.location.hash = '#/';
    else if (p === 'redeem') window.location.hash = '#/redeem';
    else if (pid) window.location.hash = p === 'pet' ? `#/pet/${pid}` : `#/pet/${pid}/${p}`;
  };

  const handleGenerationComplete = () => {
    if (isElectron) {
      (window as any).electronAPI.showPetWindow(petId);
      (window as any).electronAPI.closeSetupWindow();
    } else {
      navigate('pet');
    }
  };

  switch (page) {
    case 'home':
      return (
        <HomePage
          backendUrl={BACKEND_URL}
          onRedeem={() => navigate('redeem')}
          onViewPet={(id) => {
            if (isElectron) {
              (window as any).electronAPI.showPetWindow(id);
              (window as any).electronAPI.closeSetupWindow();
            } else {
              navigate('pet', id);
            }
          }}
        />
      );
    case 'redeem':
      return (
        <RedeemPage
          backendUrl={BACKEND_URL}
          onSuccess={(id) => navigate('setup', id)}
          onBack={() => navigate('home')}
        />
      );
    case 'setup':
      return (
        <SetupPage
          backendUrl={BACKEND_URL}
          petId={petId!}
          onStartGeneration={() => navigate('generating')}
          onLaunchPet={handleGenerationComplete}
        />
      );
    case 'generating':
      return (
        <GeneratingPage
          backendUrl={BACKEND_URL}
          petId={petId!}
          onComplete={handleGenerationComplete}
        />
      );
    case 'pet':
      return (
        <PetOverlayPage
          backendUrl={BACKEND_URL}
          petId={petId!}
          transparent={isElectronPet}
          onBackToSetup={() => navigate('home')}
        />
      );
    default:
      return (
        <HomePage
          backendUrl={BACKEND_URL}
          onRedeem={() => navigate('redeem')}
          onViewPet={(id) => navigate('pet', id)}
        />
      );
  }
}

export default App;
