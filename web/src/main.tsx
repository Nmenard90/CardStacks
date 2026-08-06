/**
 * main.tsx — entry point. Mounts <App /> into the #root element in
 * index.html; everything else is reached through App.
 */

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
