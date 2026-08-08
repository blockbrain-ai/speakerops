/**
 * Web composition root — React + Vite SPA (section 1.1 scaffold).
 * Lumen shell + routes land in section 1.4. No freeform CSS here (E6).
 */
import { createRoot } from "react-dom/client";
import { createElement } from "react";
import { HEALTH_OK } from "@speakerops/shared";

export function App() {
  // Shared DTO import proves web → shared wiring (no duplicate types).
  void HEALTH_OK;
  return createElement(
    "div",
    { id: "speakerops-root", "data-scaffold": "1.1" },
    "SpeakerOps",
  );
}

export function mount(el: Element | null = document.getElementById("root")): void {
  if (!el) return;
  createRoot(el).render(createElement(App));
}

// Browser entry: mount when #root exists (Vite index.html in 1.4).
if (typeof document !== "undefined") {
  const root = document.getElementById("root");
  if (root) {
    mount(root);
  }
}
