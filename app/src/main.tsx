import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
/* index.css owns the whole cascade — including the dark and
   high-contrast token layers — so the import order is declared in
   one place instead of being split across this file. */
import './index.css'
import { applyTheme, storedTheme, storedContrast, applyContrast } from './lib/theme'
import App from './App.tsx'

/* Resolve the appearance BEFORE the first paint. Both the theme and the
   high-contrast preference are applied here, synchronously, so there is
   never a flash of the wrong canvas on a cold open. */
applyTheme(storedTheme())
applyContrast(storedContrast())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
