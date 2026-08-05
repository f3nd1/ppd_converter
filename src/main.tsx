import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import App from './App.tsx'
import './index.css'

// basename must match BASE_PATH in server/index.ts and `base` in vite.config.ts.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter basename="/ppd_converter">
      <App />
    </BrowserRouter>
  </StrictMode>,
)
