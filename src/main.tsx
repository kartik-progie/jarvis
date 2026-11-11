import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { reportPhaseToDesktop } from './desktop.ts'

// No-op in a browser tab; in the desktop wrapper it is how a hidden window
// knows to appear when the wake word lands.
reportPhaseToDesktop()

// Deliberately no StrictMode: its double-invoked effects would open the
// microphone and arm the wake-word engine twice, and the second subscription
// steals the audio stream from the first.
createRoot(document.getElementById('root')!).render(<App />)
