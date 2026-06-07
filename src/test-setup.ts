import { beforeEach, vi } from 'vitest';

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
