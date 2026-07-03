/**
 * File: main.tsx
 * Purpose:
 *   Starts the React web app.
 *
 * Why this file exists:
 *   The browser needs one small entry point that mounts the real app component.
 */

import { createRoot } from "react-dom/client";
import { App } from "./App.js";

/**
 * Mounts React into the root HTML element.
 */
function mountApp() {
  const rootElement = document.getElementById("root");

  if (!rootElement) {
    throw new Error("Root element was not found.");
  }

  createRoot(rootElement).render(<App />);
}

mountApp();
