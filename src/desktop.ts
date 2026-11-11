/**
 * Telling the desktop shell what JARVIS is doing.
 *
 * In a browser tab this is dead code: `window.jarvisDesktop` only exists when
 * the page is running inside the Electron wrapper (desktop/preload.cjs), so in
 * Chrome the subscription is never even made.
 *
 * The shell uses the phase to decide when to show itself — waking means the
 * user just said "Hey Jarvis", which is the moment the window should appear
 * with the reactor already spinning up, rather than a second later once an
 * answer exists.
 */
import { useStore, type Phase } from './store'

type DesktopShell = { phase: (phase: Phase) => void }

export function reportPhaseToDesktop() {
  const shell = (window as unknown as { jarvisDesktop?: DesktopShell }).jarvisDesktop
  if (!shell) return

  let last: Phase | null = null
  const push = (phase: Phase) => {
    if (phase === last) return
    last = phase
    shell.phase(phase)
  }

  push(useStore.getState().phase)
  useStore.subscribe((state) => push(state.phase))
}
