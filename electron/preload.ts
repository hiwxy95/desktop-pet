import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  setIgnoreMouseEvents: (ignore: boolean) => {
    ipcRenderer.send('set-ignore-mouse-events', ignore);
  },
  moveWindowBy: (dx: number, dy: number) => {
    ipcRenderer.send('move-pet-window', dx, dy);
  },
  resizeWindow: (width: number, height: number) => {
    ipcRenderer.send('resize-pet-window', width, height);
  },
  zoomPet: (delta: number) => {
    ipcRenderer.send('zoom-pet', delta);
  },
  showPetWindow: (petId?: string) => {
    ipcRenderer.send('show-pet-window', petId);
  },
  closeSetupWindow: () => {
    ipcRenderer.send('close-setup-window');
  },
  getBackendUrl: (): Promise<string> => {
    return ipcRenderer.invoke('get-backend-url');
  },
});
