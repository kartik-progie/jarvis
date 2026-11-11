/**
 * JARVIS as a desktop app.
 *
 * The face is a web page, which is why the repo asks you to keep a tab open.
 * That tab is a bad place for an always-on assistant: Chromium throttles
 * timers and media in tabs you are not looking at, which is exactly why
 * `src/lib/vad.ts` is wrapped in a heartbeat that restarts speech recognition
 * when the browser starves it. An Electron window can simply turn that off
 * (`backgroundThrottling: false`), so a window you never see keeps listening
 * at full speed — better than the background tab, not merely equivalent.
 *
 * Three jobs live here:
 *
 *   1. Run the brain. The bridge is a plain Node process; this spawns it and
 *      takes it down again, so "JARVIS is running" is one thing, not two.
 *   2. Serve the face. NOT from file:// — see the note on the static server
 *      below, which is the whole reason this file exists rather than a
 *      three-line loadFile().
 *   3. Be a tray app. Hidden at login, summoned by the wake word or a key.
 */
import { app, BrowserWindow, Menu, Tray, globalShortcut, ipcMain, shell, nativeImage } from 'electron'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, extname, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const DIST = join(ROOT, 'dist')

/**
 * The port range is not a preference, it is the bridge's allowlist.
 *
 * `originAllowed()` in bridge/server.mjs accepts localhost:5173-5199 and
 * 4173-4199 and refuses everything else, and a request with NO origin — which
 * is what a file:// page sends — is refused unless JARVIS_ALLOW_NO_ORIGIN=1.
 * That flag is the one the repo warns is "also what local malware looks like".
 *
 * So the app serves its own built files over HTTP inside the allowed range and
 * loads an http:// URL. The origin is then ordinary and nothing is relaxed.
 * Loading dist/ straight off disk would have cost a security flag.
 */
const PORT_RANGE = { from: 5173, to: 5199 }

/**
 * The ignition click exists to satisfy two browser rules: audio cannot start
 * without a user gesture, and the microphone needs a prompt. A hidden window
 * has nobody to click it. The permission is granted below, and this lifts the
 * gesture requirement — so the page can power itself up (see src/App.tsx) and
 * actually be listening while it is out of sight.
 */
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.wasm': 'application/wasm',
  '.data': 'application/octet-stream',
  '.bin': 'application/octet-stream',
}

let tray = null
let win = null
let bridge = null
let origin = null
let quitting = false

/** Serve dist/ on the first free port the bridge will accept. */
function serveFace() {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    let rel = decodeURIComponent(url.pathname)
    if (rel.endsWith('/')) rel += 'index.html'
    // Normalise before joining so ../.. cannot climb out of dist/.
    const file = join(DIST, normalize(rel).replace(/^([/\\])+/, ''))
    const target = file.startsWith(DIST) && existsSync(file) ? file : join(DIST, 'index.html')
    try {
      const body = await readFile(target)
      res.writeHead(200, {
        'Content-Type': MIME[extname(target)] ?? 'application/octet-stream',
        // The hand-tracking runtime and the voice models are large and local;
        // re-reading them from disk on every launch is pure latency.
        'Cache-Control': 'no-cache',
      })
      res.end(body)
    } catch {
      res.writeHead(404).end('not found')
    }
  })

  return new Promise((resolve, reject) => {
    let port = PORT_RANGE.from
    const tryPort = () => {
      server.once('error', (err) => {
        if (err.code === 'EADDRINUSE' && port < PORT_RANGE.to) {
          port += 1
          tryPort()
        } else {
          reject(err)
        }
      })
      server.listen(port, '127.0.0.1', () => resolve(`http://localhost:${port}`))
    }
    tryPort()
  })
}

/**
 * The brain, as a child process.
 *
 * Inherits this process's environment, so the JARVIS_* variables set on the
 * machine (model, effort, connectors, writes) apply exactly as they do when
 * you run `npm start` yourself — the app changes how JARVIS is launched, not
 * how it is configured.
 */
function startBridge() {
  // Plain `node`, not this process with ELECTRON_RUN_AS_NODE: the bridge
  // spawns the Claude CLI underneath it, and that flag would be inherited by
  // everything below. The repo already requires Node to exist.
  bridge = spawn('node', [join(ROOT, 'bridge', 'server.mjs')], {
    cwd: ROOT,
    env: { ...process.env },
    // No `shell: true`. node.exe is a real executable on every platform this
    // runs on, and a shell here would concatenate the path rather than pass it
    // as an argument — which Node now warns about for good reason.
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const log = (prefix) => (d) =>
    String(d)
      .split('\n')
      .filter(Boolean)
      .forEach((line) => console.log(`${prefix} ${line}`))
  bridge.stdout.on('data', log('[bridge]'))
  bridge.stderr.on('data', log('[bridge!]'))
  bridge.on('exit', (code) => {
    console.log(`[desktop] bridge exited (${code})`)
    bridge = null
  })
}

function stopBridge() {
  if (!bridge) return
  bridge.kill()
  bridge = null
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    backgroundColor: '#05070b',
    autoHideMenuBar: true,
    title: 'J.A.R.V.I.S.',
    webPreferences: {
      preload: join(ROOT, 'desktop', 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      // The point of the whole exercise: a hidden window that is not slowed
      // down for being hidden, so the wake word keeps working.
      backgroundThrottling: false,
    },
  })

  /**
   * The microphone, granted once instead of asked every launch.
   *
   * In a browser this is the INITIALISE click plus a permission prompt. Here
   * the page is ours, served from our own loopback origin, so the grant is
   * narrowed to that origin and to media only — everything else is refused.
   */
  const session = win.webContents.session
  // Compared as origins, not as strings: Electron reports the requester as
  // "http://localhost:5173" in one callback and sometimes with a trailing
  // slash in the other, and an === against the wrong one silently refuses the
  // microphone — which looks exactly like a page that simply never woke up.
  const sameOrigin = (url) => {
    try {
      return new URL(url).origin === origin
    } catch {
      return false
    }
  }
  const audio = (permission) => permission === 'media' || permission === 'audioCapture'

  session.setPermissionRequestHandler((contents, permission, callback) => {
    callback(sameOrigin(contents.getURL()) && audio(permission))
  })
  session.setPermissionCheckHandler((_contents, permission, requesting) =>
    sameOrigin(requesting) && audio(permission),
  )

  win.webContents.on('preload-error', (_e, path, error) =>
    console.log(`[desktop] preload failed (${path}): ${error.message}`),
  )

  /**
   * The page's console, in the terminal.
   *
   * A hidden window has no devtools anyone is looking at, so a failure during
   * power-up — a refused microphone, an unreachable bridge — would otherwise
   * be invisible: the app would simply sit there, silent and apparently fine.
   */
  win.webContents.on('console-message', (_event, level, message) => {
    if (level >= 2 || message.includes('[jarvis]')) console.log(`[face] ${message}`)
  })
  win.webContents.on('did-fail-load', (_e, code, desc) =>
    console.log(`[face] failed to load: ${desc} (${code})`),
  )

  // A link in a HUD panel should open in the real browser, not replace JARVIS.
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  // Closing is hiding. Quit from the tray, so a stray Alt-F4 does not take the
  // brain down with it mid-sentence.
  win.on('close', (event) => {
    if (quitting) return
    event.preventDefault()
    win.hide()
  })

  /**
   * What the page can actually hear, said out loud at startup.
   *
   * The browser build's keyless path is `webkitSpeechRecognition`, and the
   * trap is that Electron HAS it: the constructor is present, `new` succeeds,
   * the microphone opens and `onaudiostart` fires. It is a shell around
   * Google's speech service, and Chromium builds carry no key for it, so the
   * first utterance comes back `error: network` and the engine dies. The
   * heartbeat rebuilds it and it dies again.
   *
   * Measured here: the wake word can slip through on a first result while the
   * sentence after it never does — which reads as "it ignores me" rather than
   * as a missing credential. So the only honest answer is the bridge's /stt
   * endpoint, and the only honest thing to print is that it is missing.
   */
  win.webContents.once('did-finish-load', async () => {
    const stt = await win.webContents
      .executeJavaScript(`fetch('http://127.0.0.1:8787/health').then(r => r.json()).then(h => h.stt)`)
      .catch(() => false)
    console.log(
      stt
        ? '[desktop] speech in: ElevenLabs Scribe'
        : '[desktop] no usable speech input: the bridge reports no ElevenLabs' +
            " key, and Electron's own recogniser fails with `network`. Expect" +
            ' the wake word to be unreliable or dead until ELEVENLABS_API_KEY' +
            ' is set. Space-to-talk has the same problem; the HUD still works.',
    )
  })

  return win.loadURL(origin)
}

/** A dim reactor ring, drawn rather than shipped, so there is no asset to lose. */
function trayIcon() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16">
    <circle cx="8" cy="8" r="6.5" fill="none" stroke="#7fd4ff" stroke-width="1.5"/>
    <circle cx="8" cy="8" r="2" fill="#7fd4ff"/>
  </svg>`
  return nativeImage.createFromDataURL(
    `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`,
  )
}

function toggleWindow() {
  if (!win) return
  if (win.isVisible() && win.isFocused()) win.hide()
  else {
    win.show()
    win.focus()
  }
}

function buildTray() {
  tray = new Tray(trayIcon())
  const menu = Menu.buildFromTemplate([
    { label: 'Show JARVIS', click: () => { win?.show(); win?.focus() } },
    { label: 'Hide', click: () => win?.hide() },
    { type: 'separator' },
    {
      label: 'Start at login',
      type: 'checkbox',
      checked: app.getLoginItemSettings().openAtLogin,
      click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked, args: ['--hidden'] }),
    },
    {
      label: 'Restart the brain',
      click: () => { stopBridge(); startBridge() },
    },
    { label: 'Open in browser', click: () => origin && shell.openExternal(origin) },
    { type: 'separator' },
    { label: 'Quit', click: () => { quitting = true; app.quit() } },
  ])
  tray.setToolTip('J.A.R.V.I.S.')
  tray.setContextMenu(menu)
  tray.on('click', toggleWindow)
}

/**
 * The window follows the conversation.
 *
 * The page reports its phase (see src/desktop.ts). Waking means the user just
 * said "Hey Jarvis" — that is the moment to appear, reactor already spinning.
 * Going dormant means the exchange is over, so it steps back out of the way,
 * unless the user has taken hold of the window themselves.
 */
function watchPhase() {
  ipcMain.on('jarvis:phase', (_event, phase) => {
    console.log(`[face] phase: ${phase}`)
    if (!win) return
    if ((phase === 'waking' || phase === 'listening') && !win.isVisible()) {
      win.showInactive()
    }
    if (phase === 'dormant' && win.isVisible() && !win.isFocused()) {
      win.hide()
    }
  })
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => { win?.show(); win?.focus() })

  app.whenReady().then(async () => {
    if (!existsSync(join(DIST, 'index.html'))) {
      console.error('[desktop] dist/ is missing — run `npm run build` first.')
      app.quit()
      return
    }
    origin = await serveFace()
    console.log(`[desktop] serving the face on ${origin}`)
    startBridge()
    watchPhase()
    await createWindow()
    buildTray()
    globalShortcut.register('Control+Alt+J', toggleWindow)
    // Launched by the login item, or by hand with --hidden: stay out of sight.
    if (!process.argv.includes('--hidden')) win.show()
    console.log('[desktop] ready — tray icon, Ctrl+Alt+J, or say "Hey Jarvis"')
  })

  app.on('window-all-closed', () => {}) // tray app: outliving its window is the point
  app.on('before-quit', () => { quitting = true })
  app.on('will-quit', () => {
    globalShortcut.unregisterAll()
    stopBridge()
  })
}
