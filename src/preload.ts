import { contextBridge, ipcRenderer } from 'electron';

/** The only things the window may ask the app to do. The app checks every value it gets. */
contextBridge.exposeInMainWorld('chests', {
  state: (): Promise<unknown> => ipcRenderer.invoke('state'),
  onState: (show: (state: unknown) => void): void => {
    ipcRenderer.on('state', (_event, state: unknown) => show(state));
  },
  action: (name: string): void => ipcRenderer.send('action', name),
  view: (name: string): void => ipcRenderer.send('view', name),
  settingsTab: (tab: string): void => ipcRenderer.send('settings-tab', tab),
  lock: (on: boolean): void => ipcRenderer.send('lock', on),
  gearHover: (over: boolean, gear?: { x: number; y: number; width: number; height: number }): void => ipcRenderer.send('gear-hover', over, gear),
  barWidth: (width: number): void => ipcRenderer.send('bar-width', width),
  capture: (kind: string, action: string): void => ipcRenderer.send('capture', kind, action),
  cancel: (): void => ipcRenderer.send('cancel'),
  key: (press: unknown): void => ipcRenderer.send('key', press),
  pad: (pressed: number[]): void => ipcRenderer.send('pad', pressed),
  clearPad: (action: string): void => ipcRenderer.send('clear-pad', action),
  reset: (): void => ipcRenderer.send('reset'),
  resetStats: (): void => ipcRenderer.send('reset-stats'),
  deleteOldReplays: (): void => ipcRenderer.send('delete-old-replays'),
  theme: (name: string): void => ipcRenderer.send('theme', name),
  addChests: (chests: number): void => ipcRenderer.send('add-chests', chests),
  estimate: (careerMatches: number): void => ipcRenderer.send('estimate', careerMatches),
  removeManual: (id: string): void => ipcRenderer.send('remove-manual', id),
  tickPrize: (id: string): void => ipcRenderer.send('tick-prize', id),
  onlyHunt: (on: boolean): void => ipcRenderer.send('only-hunt', on),
  notifications: (on: boolean): void => ipcRenderer.send('notifications', on),
  cat: (on: boolean): void => ipcRenderer.send('cat', on),
  screenCount: (on: boolean): void => ipcRenderer.send('screen-count', on),
  screenStatus: (status: string): void => ipcRenderer.send('screen-status', status),
  screenFrame: (pixels: Uint8ClampedArray): void => ipcRenderer.send('screen-frame', pixels),
  copyObsPath: (): void => ipcRenderer.send('copy-obs-path'),
  installUpdate: (): void => ipcRenderer.send('install-update'),
  openWithFortnite: (on: boolean): void => ipcRenderer.send('open-with-fortnite', on),
  opacity: (value: number): void => ipcRenderer.send('opacity', value),
  autoCount: (on: boolean): void => ipcRenderer.send('auto-count', on),
  sensitivity: (value: number): void => ipcRenderer.send('sensitivity', value),
  showHistory: (on: boolean): void => ipcRenderer.send('show-history', on),
  onCounted: (show: (action: string, by: string) => void): void => {
    ipcRenderer.on('counted', (_event, action: string, by: string) => show(action, by));
  },
  onTab: (open: (tab: string) => void): void => {
    ipcRenderer.on('tab', (_event, tab: string) => open(tab));
  },
  quit: (): void => ipcRenderer.send('quit'),
});
