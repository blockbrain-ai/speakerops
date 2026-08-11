/**
 * Web composition root — React + Vite SPA (section 1.4).
 * Lumen tokens + admin chrome shell + App routes.
 * E6: Lumen CSS variables only — no freeform palette.
 */
import { createRoot } from "react-dom/client";
import { StrictMode } from "react";
import { HEALTH_OK } from "@speakerops/shared";
import { App } from "./App.js";
import "./styles/fonts.css";
import "./styles/lumen.css";
import "./styles/components.css";
import "./styles/shell.css";

// Shared DTO import proves web → shared wiring (no duplicate types).
void HEALTH_OK;

export { App } from "./App.js";
export { AdminShell, ADMIN_NAV_ITEMS } from "./layout/AdminShell.js";

export function mount(el: Element | null = document.getElementById("root")): void {
  if (!el) return;
  createRoot(el).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

// Browser entry: mount when #root exists (Vite index.html).
if (typeof document !== "undefined") {
  const root = document.getElementById("root");
  if (root) {
    mount(root);
  }
}
