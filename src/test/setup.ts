import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

// jsdom doesn't implement the scrolling APIs or ResizeObserver used by the
// router and cmdk.
Element.prototype.scrollIntoView = vi.fn();
window.scrollTo = vi.fn();
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

afterEach(() => {
  cleanup();
});
