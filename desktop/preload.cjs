/**
 * The only thing the page is allowed to say to the desktop shell.
 *
 * Context isolation is on, so the page cannot reach Electron itself. This
 * exposes one function, in one direction, carrying one string: which phase
 * JARVIS is in. The window uses it to appear when the wake word lands and to
 * step back when the exchange ends.
 *
 * Deliberately not a general bridge. A voice agent that reads web pages should
 * not have a channel into the shell that can do more than this, and a page
 * that is served from our own loopback origin is still a page.
 */
const { contextBridge, ipcRenderer } = require('electron')

const PHASES = new Set([
  'offline',
  'boot',
  'dormant',
  'waking',
  'listening',
  'thinking',
  'tooling',
  'speaking',
])

// Surfaced so a window that starts hidden can be shown to have wired itself
// up at all — the failure mode otherwise is a page that silently stays a
// browser page and waits forever for a click nobody can give it.
console.log('[jarvis] desktop preload ready')

contextBridge.exposeInMainWorld('jarvisDesktop', {
  phase: (phase) => {
    if (typeof phase === 'string' && PHASES.has(phase)) {
      ipcRenderer.send('jarvis:phase', phase)
    }
  },
})
