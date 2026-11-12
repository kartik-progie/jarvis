/**
 * Settings saved on the machine, whatever shell happened to start JARVIS.
 *
 * Every JARVIS_* variable and ELEVENLABS_API_KEY is read from process.env, and
 * a process only ever sees the environment it was born with. On Windows that
 * is a trap: `setx` and the System dialog write to the registry, and only
 * processes started *afterwards* see the change. A terminal opened before the
 * key was set — including one an editor or another app opened for you hours
 * ago — launches a bridge that silently has no key, no model choice and none
 * of the switches.
 *
 * Measured, which is why this file exists: a bridge started from a PowerShell
 * that predated the key reported `{"tts":false,"stt":false}` while the key sat
 * in the registry. Under Electron that means no speech recognition at all, so
 * JARVIS looked alive, heard nothing, and could do nothing — and nothing about
 * it said why.
 *
 * Used by the launchers, not by the bridge itself. `npm start` and
 * `npm run desktop` are how a person starts JARVIS, and they should recover
 * what that person saved. The bridge run directly stays exactly what its
 * environment says — the tests start it against a throwaway home and rely on
 * an unset variable meaning its default, and reading the real registry from
 * inside the bridge leaked this machine's settings straight into them.
 */
import { execFileSync } from 'node:child_process'

const OURS = /^(JARVIS_[A-Z0-9_]+|ELEVENLABS_API_KEY)$/

function savedUserEnvironment() {
  if (process.platform !== 'win32') return {}
  let out
  try {
    out = execFileSync('reg', ['query', 'HKCU\\Environment'], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 5000,
    })
  } catch {
    return {}
  }
  const found = {}
  for (const line of out.split(/\r?\n/)) {
    // "    NAME    REG_SZ    value" — the value can itself contain spaces.
    const m = line.match(/^\s+(\S+)\s+REG_(?:EXPAND_)?SZ\s+(.*)$/)
    if (m && OURS.test(m[1])) found[m[1]] = m[2]
  }
  return found
}

/**
 * `base` with any saved JARVIS setting it lacks filled in.
 *
 * The shell still wins when it has a value — `JARVIS_MODEL=... npm start` for a
 * one-off keeps working. Saved settings only fill what is missing. Returns the
 * names it filled so the launcher can say so; never the values, since one of
 * them is a credential.
 */
export function withSavedSettings(base = process.env) {
  const env = { ...base }
  const filled = []
  for (const [name, value] of Object.entries(savedUserEnvironment())) {
    if (env[name] === undefined || env[name] === '') {
      env[name] = value
      filled.push(name)
    }
  }
  return { env, filled }
}
