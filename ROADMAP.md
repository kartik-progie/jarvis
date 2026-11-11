# JARVIS — what's next

A running list. Add ideas to the **Backlog** at the bottom whenever they occur;
we promote them into a numbered item when we're ready to build one.

Status: `todo` · `doing` · `done` · `parked`

---

## Where it stands today

Working and verified on this machine:

| | |
|---|---|
| Brain | `claude-sonnet-5-5`, effort `low`, on the Claude Pro login |
| Speech in | ElevenLabs Scribe, via the bridge's `/stt` |
| Speech out | ElevenLabs voice, via `/tts` |
| Shell | Tray app (Electron), hidden window, wake word, `Ctrl+Alt+J` |
| Tools | `memory`, `brave` (Playwright), Claude Docs + Higgsfield connectors |
| Browsing | `probe_url`/`WebFetch` to read, `Bash` to open a real browser |
| Writes | **enabled**, every effectful action gated behind a spoken yes |

Two constraints worth remembering before planning anything:

- **Speech only works through ElevenLabs here.** The keyless path fails with
  `error: network` in Electron *and* Brave — recognition runs on Google's
  servers, reached with a key only Chrome ships. Nothing we build changes that.
- **`Bash` is not fenced.** The file tools are confined to the workspace, but
  the shell reaches whatever the Windows account reaches. That is what makes
  everything in §2 possible, and it is also the reason §1 matters more than §2.

---

## 1. Make confirmation a conversation · `done`

Built in `bridge/consent.mjs`. Verified: *"yes, go ahead and open it"* — which the
old regex rejected — now releases the action, and *"no not that one, the BBC
news site instead"* re-proposes the corrected action and asks again instead of
confirming the wrong one.


**The problem.** The gate added in `197168f` matches the reply against a regex
anchored at both ends. `"yes"` and `"go ahead"` work; `"yes, open it"` does not,
and `"not that one, the one with the blue icon"` can never work — a pattern
cannot understand a correction. The action is dropped silently and the user is
left wondering why nothing happened.

**What it should do.** Hear the whole reply, work out whether it approves,
refuses, or *amends* the request, and act accordingly:

| Reply | Should mean |
|---|---|
| "yes" / "go ahead" / "yes, open it" | run the pending action |
| "no" / "not that" / "stop" | drop it, say so |
| "not that one, the one with the blue icon" | re-propose the corrected action, ask again |
| anything unrelated | drop the pending action, treat as a new request |

**Approach.** The model already hears the reply — it is the only thing in the
system that can read intent. The gate stays a hard gate (the shell must not run
on a pattern match), but the *decision* moves to the model via a tool it calls
to claim consent, with the bridge still holding the rules:

- the claim is only honoured if a real user utterance arrived after the hold
- it is bound to the exact tool and arguments already pending
- it is consumed on use and expires
- page text and tool output can never reach it — only speech from the interface

That keeps the property that matters (a web page cannot talk JARVIS into
anything) while letting the conversation be a conversation. The fallback stays:
if no claim arrives, the regex path still accepts a bare "yes".

**Touches** `bridge/server.mjs` (the hold in `enforcePolicy`, a new SDK tool),
`bridge/policy.mjs` (that tool must itself never be gated).

---

## 2. Run the laptop · `todo`

The shell is already there and already gated, so most of this is teaching it
*what to run* rather than giving it new power. Windows specifics, roughly in
order of how well they work:

**2a. Launch apps** — `start spotify:`, `start ms-settings:`, or the executable
path. Works today; JARVIS reached for `Bash` unprompted when asked to open a
website. Mostly needs a prompt section so it knows the common ones by name.

**2b. Media control** — play/pause/next as system media keys, driven from
PowerShell. Controls whatever is playing, Spotify included, with no account
needed. The cheap 80% of "play some music".

**2c. Spotify properly** — note the desktop app is **not installed** on this
machine (nothing at `%APPDATA%\Spotify\Spotify.exe`), so 2a and 2b have nothing
to drive yet: either install it, or treat Spotify as web-only and drive
`open.spotify.com` in the browser. "play *Rubber Soul*" needs the Web API and an OAuth
token, or the local app's URI scheme (`spotify:search:…`) which opens a search
rather than playing. The API is a real integration: its own credentials, a
refresh token, a small MCP server. Worth it only if 2b proves not enough.

**2d. Chrome profile switching** — `chrome.exe --profile-directory="<dir>"`.
Simple. The display names live in Chrome's `Local State`
(`%LOCALAPPDATA%\Google\Chrome\User Data\Local State`, under
`profile.info_cache`) and map to directories like `Default`, `Profile 3`.

Read them at runtime rather than writing them down — this repo is public, and
profile names are personal. Checked on this machine: four profiles, **two
sharing a display name**, so "switch to my profile" is ambiguous. JARVIS should
look them up, and ask which one when a name is not unique.

**2e. Mail** — the claude.ai connectors attached to this account are Claude Docs
and Higgsfield, *not* mail. So either open webmail in the browser (trivial), or
attach a mail connector at claude.ai (then it can actually read and search),
or sign into webmail once inside the Brave profile at `~/.jarvis/brave-profile`.

**2f. Window management** — focus, minimise, arrange. PowerShell plus a few
Win32 calls. Fiddly; park until the rest is in use.

**Before any of this**: §1 should land first. Every item here is an effectful
action, which means every one of them goes through the confirmation gate — and
a gate that only accepts a bare "yes" will make the whole lot feel broken.

---

## 3. Give him a name · `parked`

Change the wake word to something chosen. Needs the name, plus mishearing
variants — the repo carries `jervis`, `travis`, `java's` because "Jarvis" is not
in a dictation vocabulary. Scribe is better at proper nouns than the browser
engine was, so it may need fewer. Touches the wake pattern in
`src/lib/voice.ts`, the vocative stripper and barge-in pattern in `src/App.tsx`,
and the HUD copy in `src/ui/`.

---

## 4. Always there · `todo`

Tick **Start at login** in the tray menu, so it is running from boot with no
window. One click, deliberately left to the user. After that, consider whether
the app should survive a crash of the bridge (it currently takes both down).

---

## Backlog

Unsorted. Add freely.

- Rotate the ElevenLabs key — it is in PowerShell scrollback from `setx`.
- Narrow `JARVIS_MCP_SERVERS` now that writes are permanent.
- `JARVIS_CLAUDE_EXECUTABLE` as a sandbox wrapper — the real answer to "Bash is
  not fenced", at the OS level rather than the policy layer.
- A follow-up window longer than 11s, or one that stays open while a
  conversation is clearly still going.
- Sign into the Brave profile once so "check my email" and logged-in pages work.
- Reduce the post-processing chain further if frames still drop under load —
  dropping noise and chromatic aberration would help and would change the look.
- Upstream has no confirmation gate and no tray app; expect conflicts in
  `bridge/server.mjs` and decide each time whether to keep ours.
