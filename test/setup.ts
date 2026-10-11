import '@testing-library/jest-dom/vitest';

if (typeof window !== 'undefined') {
  class RO {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  // jsdom has no layout, so ResizeObserver is a no-op here.
  (globalThis as unknown as { ResizeObserver: typeof RO }).ResizeObserver ??= RO;
  window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
}
