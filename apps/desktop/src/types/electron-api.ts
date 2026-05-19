declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

export interface ElectronAPI {
  // Platform information
  platform: NodeJS.Platform;

  // Listeners remain the same (two-way to renderer)
  onGlobalShortcut: (
    callback: (data: { shortcut: string }) => void,
  ) => (() => void) | void;
  onKeyEvent: (callback: (keyEvent: unknown) => void) => (() => void) | void;
  onForceStopMediaRecorder: (callback: () => void) => (() => void) | void;

  // Methods called from renderer to main become async (invoke/handle)
  sendAudioChunk: (chunk: Float32Array, isFinalChunk: boolean) => Promise<void>;

  // Model Management API (moved to tRPC)
  // Transcription Database API (moved to tRPC)

  onNotesWindowOpenRequested: (
    callback: (noteId?: number) => void,
  ) => (() => void) | void;
  onNavigate: (callback: (route: string) => void) => (() => void) | void;

  // Logging API for renderer process
  log: {
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
    debug: (...args: unknown[]) => void;
    scope: (name: string) => {
      info: (...args: unknown[]) => void;
      warn: (...args: unknown[]) => void;
      error: (...args: unknown[]) => void;
      debug: (...args: unknown[]) => void;
    };
  };

  // External link handling
  openExternal: (url: string) => Promise<void>;

  // Notes API - Yjs synchronization only
  notes: {
    saveYjsUpdate: (noteId: number, update: ArrayBuffer) => Promise<void>;
    loadYjsUpdates: (noteId: number) => Promise<ArrayBuffer[]>;
  };
}
