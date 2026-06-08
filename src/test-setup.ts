import { beforeEach, vi } from 'vitest';

// ---- Tauri IPC mocks (for hook-level tests that render useAppController) -----
// `@tauri-apps/*` modules don't exist outside the Tauri webview, so we mock them
// here for every test. Pure-function tests simply never touch these.
//
// `vi.hoisted` lets the (hoisted) `vi.mock` factories below share these objects.
// We can't `export` the hoisted bindings directly, so re-export via plain consts.
const hoisted = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  // event name -> set of registered handlers
  eventHandlers: new Map<string, Set<(event: { payload: unknown }) => void>>()
}));

export const invokeMock = hoisted.invokeMock;
export const eventHandlers = hoisted.eventHandlers;

/** Fire a backend event to all listeners registered via the mocked `listen`. */
export function emitTauriEvent(event: string, payload: unknown): void {
  for (const handler of hoisted.eventHandlers.get(event) ?? []) {
    handler({ payload });
  }
}

/** Default `invoke` routing: harmless values so mount effects don't throw. */
function defaultInvoke(command: string): Promise<unknown> {
  switch (command) {
    case 'scan_spine_files':
      return Promise.resolve({ files: [], skipped: [] });
    case 'list_export_presets':
      return Promise.resolve([]);
    case 'list_subdirectories':
      return Promise.resolve([]);
    case 'validate_settings':
      return Promise.resolve({ ok: true, warnings: [], errors: [] });
    case 'check_output_collisions':
      return Promise.resolve([]);
    case 'auto_detect_spine':
      return Promise.resolve('');
    default:
      return Promise.resolve(undefined);
  }
}

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (command: string, args?: unknown) => hoisted.invokeMock(command, args)
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: (event: string, handler: (e: { payload: unknown }) => void) => {
    const set = hoisted.eventHandlers.get(event) ?? new Set();
    set.add(handler);
    hoisted.eventHandlers.set(event, set);
    return Promise.resolve(() => set.delete(handler));
  }
}));

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    listen: () => Promise.resolve(() => undefined),
    setTitle: () => Promise.resolve()
  })
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({
  confirm: vi.fn(() => Promise.resolve(true)),
  message: vi.fn(() => Promise.resolve()),
  open: vi.fn(() => Promise.resolve(null)),
  save: vi.fn(() => Promise.resolve(null))
}));

vi.mock('@tauri-apps/plugin-process', () => ({
  relaunch: vi.fn(() => Promise.resolve())
}));

vi.mock('@tauri-apps/plugin-updater', () => ({
  check: vi.fn(() => Promise.resolve(null))
}));

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockImplementation((command: string) => defaultInvoke(command));
  eventHandlers.clear();
});

// jsdom doesn't implement matchMedia, which sessions.ts `readTheme` calls. Stub it
// to "light" so persistence tests can run.
if (!window.matchMedia) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn()
  })) as unknown as typeof window.matchMedia;
}

// Each test starts from a clean localStorage so persistence cases don't bleed into each other.
beforeEach(() => {
  localStorage.clear();
});
