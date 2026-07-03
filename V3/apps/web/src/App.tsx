/**
 * File: App.tsx
 * Purpose:
 *   Composes the first working web UI.
 *
 * Why this file exists:
 *   The app shell should stay simple and delegate real work to feature panels.
 */

import { LoginPanel } from "./features/auth/LoginPanel.js";
import { CollectionPanel } from "./features/collection/CollectionPanel.js";
import { SearchPanel } from "./features/search/SearchPanel.js";
import "./styles.css";

/**
 * Renders the main web app.
 */
export function App() {
  return (
    <main>
      <header>
        <h1>TCG V3</h1>
        <p>Clean Pokémon card collection tracking, built backend-first.</p>
      </header>
      <LoginPanel />
      <SearchPanel />
      <CollectionPanel />
    </main>
  );
}
