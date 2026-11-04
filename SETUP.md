# Setup

One rerunnable entry prepares an Astack checkout for Pi: it installs missing host capabilities, prepares each independent package, registers the local Pi packages, syncs the shared skills, and reports exactly what is ready, manual, unsupported, or failed.

```bash
bash scripts/setup.sh             # install missing pieces + build + register
bash scripts/setup.sh --check     # read-only detection report
npm run setup                     # same as the first command, after Node exists
npm run setup:check               # same as --check, after Node exists
```

`bash scripts/setup.sh` works **before Node is installed**. It is non-interactive and safe to rerun.

## What it does

| Phase | Behavior |
|---|---|
| Detect | macOS or Linux, distro/version, architecture, package manager, desktop session, Vulkan. Never chooses a distro. |
| Runtimes | Reuses compatible Node >=22.19/npm >=10, Python, Pi >=1.4, uv. Installs missing pieces user-locally; checksum-verifies the official Node tarball. |
| Packages | Runs each package's own `npm ci`/`npm install` and `build` where defined. No workspaces, hoisting, or shared lockfile. |
| Pi registration | Merges the 11 local package paths into the Pi agent `settings.json`, replacing same-name entries from older checkouts/npm/git, and verifies with `pi list`. |
| Shared skills | Runs `skills/pi-herdr-skills/scripts/install.sh`. Modified global skills are preserved and reported, never force-replaced. |
| Browser | Reuses Chrome/Chromium or installs Chrome for Testing on Linux; installs/repairs uv + the Python `browser-use` CLI and verifies `browser_harness` imports. |
| Herdr | Reuses `hc`/`herdr-app` or runs the official installers. GUI capability is reported separately from binary presence and is informational: `AgentCreate` defaults to Core-only and needs a window only when the caller passes `present: true`. |
| Cua | Reuses/installs the local Cua Driver on desktop hosts, reports macOS permission status read-only, and adds `cua-driver mcp` to `mcp.json` when absent. |
| Desktop | Opt-in only (`--desktop`): Xvfb + full XFCE + session D-Bus + AT-SPI + ffmpeg, wired through a systemd user unit. The default path never installs a GUI. |
| Slack | Installs/builds `services/pi-slack` dependencies only. Never starts a listener, never writes tokens. |
| Report | Prints a table and optionally writes Markdown + JSON reports and logs. |

Status meanings:

- `ready` — already present and usable.
- `installed` — installed by this run; reload Pi or complete the noted follow-up.
- `manual` — a person must do it: login, OS grant, token, desktop session, Chrome install, PATH persistence.
- `unsupported` — this host/session cannot provide it (headless GUI feature, Slack delegation, bundled sandbox).
- `failed` — the installer attempted its owned step and it failed; the log tail is preserved.

A version command never proves GUI readiness. Herdr app, Cua, and desktop use are reported separately from `--version`.

## Options

```
--check                  Detect and report only; no installs or config writes.
--agent-dir DIR          Pi agent config directory (default $PI_CODING_AGENT_DIR or ~/.pi/agent).
--report-dir DIR         Write setup-report.md, setup-report.json and logs there.
--skip LIST              Skip groups: runtimes,packages,skills,desktop,chrome,browser,herdr,cua,slack.
--desktop                Opt in to the private Ubuntu/Debian virtual desktop (Xvfb, full XFCE,
                         session D-Bus, AT-SPI, ffmpeg) and its systemd user unit.
--no-desktop-start       Install and enable the desktop unit without starting it now.
--keep-package-paths     Keep same-name local package entries at another path; do not add local duplicates; report manual.
--no-config              Do not write settings.json or mcp.json.
--allow-root             Permit user-level installs into root's home (root-only hosts).
--yes                    Accepted no-op for non-interactive callers.
```

Environment: `ASTACK_HOME` (default `$HOME/.local/share/astack`) holds downloaded runtimes, Chrome for Testing, logs and `env.sh`.

## Config preservation

Only two files can change:

- `<agent-dir>/settings.json` — the `packages` array only.
- `<agent-dir>/mcp.json` — only the `cua-driver` server, only when that name is absent.

Both are backed up first under `<agent-dir>/backups/astack-setup-<stamp>/` and written atomically. Unrelated keys, package entries, MCP servers, auth, models, sessions, trust, skills, and user services are left alone. An existing `cua-driver` entry with a different command is reported `manual` and not overwritten.

Object-form package entries keep their `extensions`, `skills`, `prompts`, and `themes` filters: only `source` is replaced with the checkout path. Multiple same-name entries are coalesced only when their filters are identical or the duplicates are bare paths; distinct filtered entries are left untouched and reported `manual` rather than guessing which resources were intended.

The shared-skill installer is conflict-safe: if a global skill was modified, the setup reports `manual` with the conflict names and still installs missing/non-conflicting skills using its additive `--skip-conflicts` mode. Conflicting same-name skills are left untouched. Review the diff, then rerun `skills/pi-herdr-skills/scripts/install.sh --force` only if replacement is intended; it backs up first. The default installer still refuses conflicts.

## Reload

After a successful install, run `/reload` in Pi or restart it. In a new shell, source the generated environment file if a user-local runtime was installed:

```bash
. "$HOME/.local/share/astack/env.sh"
```

The installer does not edit shell profiles.

## Platform notes

### macOS

Tested on macOS 27.0.1 arm64 with Homebrew. Existing Node, Python, Pi, uv, hc, herdr-app, Cua, Chrome, and the six shared skills are reused. Cua permission status is read-only (`cua-driver permissions status`); the installer never calls `grant`, starts a daemon, or changes TCC. A desktop session is expected for the Herdr app/Cua; the browser smoke uses isolated headless Chrome.

If Chrome is missing, the installer tries the Homebrew cask. A cask that needs interactive permission is reported `manual` with the download page; it does not block the rest of setup. Every detected/downloaded Chrome binary is validated with a safe `--version` probe. On Linux, Chrome download/extraction checks the `unzip` prerequisite and installs it through the detected package manager only when root/passwordless sudo is available; otherwise it is reported `manual`. A binary that fails because shared libraries are missing triggers the documented apt library install only in install mode with privileges. Downloads are extracted in an installer-owned temporary directory and published only after a runnable binary is found; an existing owned directory is preserved under `chrome.previous.<stamp>` rather than deleted, so interrupted downloads do not poison later runs.

### Linux

The installer handles the detected family; it does not assume Ubuntu. Actual test target: Ubuntu 22.04.5 x86_64. distro Node is new enough and is reused; Python 3.10.12 is preserved for the OS, while uv supplies Python 3.12 for `browser-use`. Without a desktop, Herdr app, Cua, computer use, and the visible interview workflows are reported `unsupported`; the opt-in `--desktop` group (below) provides one. Herdr Core, headless Chrome, and `browser-use` remain supported without any desktop.


RunCommand/root execution: the installer refuses to write user-level Pi config, skills, or packages into `/root` when invoked as root without an explicit flag. Run it as the intended normal user:

```bash
runuser -u <user> -- env HOME=/home/<user> bash -c 'cd /home/<user> && bash /path/to/astack/scripts/setup.sh'
```

The installer also changes to its own checkout root before calling `npx`, `find`, or other relative helpers, so a root-only RunCommand cwd cannot leak into those commands. Use `--allow-root` only on a genuinely root-owned host. When the distro npm prefix is not writable, Pi is installed into `$ASTACK_HOME/npm-global` and the compatible executable is linked into `$ASTACK_HOME/bin`, even when an older incompatible `pi` is still on `PATH`; the installer does not elevate, downgrade, or change the user's npm prefix. A non-symlink file blocking `$ASTACK_HOME/bin/pi` is preserved and reported `manual`. The installer never touches `nginx` or `vsts.agent.*` services, and never starts/stops systemd/launchd units.

On Ubuntu/Debian, headless Chrome may need shared libraries. If the downloaded binary does not run, the setup reports `manual` with the missing-library log; a root/apt run may install the documented `libnss3`/GTK/GBM/ALSA set automatically.

## Private virtual desktop (Ubuntu/Debian, opt-in)

Computer use on a headless Linux host needs a real desktop session: a display, a window manager, and the driver. The installer provides exactly one, and only when asked, because most hosts should not install a GUI:

```bash
bash scripts/setup.sh --desktop                  # install, enable and start
bash scripts/setup.sh --check --desktop          # read-only detection
bash scripts/setup.sh --desktop --no-desktop-start
bash scripts/setup.sh --skip desktop             # explicit opt-out
```

`--desktop` reports every desktop row `unsupported` with one reason on macOS and on non-apt hosts. The default Linux path is unchanged.

| Piece | Packages | Why |
|---|---|---|
| Display | `xvfb`, `xauth`, `x11-utils` | Private virtual X server, one per user, no hardware, no seat. |
| Desktop | `xfce4`, `xfce4-terminal` | Full XFCE session, which supplies the `xfwm4` window manager that window discovery needs. |
| Bus and a11y | `dbus`, `dbus-x11`, `at-spi2-core`, `libatk-bridge2.0-0`, `libatk-adaptor`, `libgail-common` | Session D-Bus plus the AT-SPI bridge used for semantic actions and tree readback. |
| Driver runtime | `libxi6`, `python3-gi`, `gir1.2-gtk-3.0` | Driver runtime library; the owned GTK3 verification window. |
| Capture | `ffmpeg` | `x11grab` H.264 capture of the main display. |

Packages are installed by name through the detected apt package manager. There is no `dist-upgrade`, no PPA, no third-party repository, no reboot, and no container.

The setup also writes `~/.config/systemd/user/astack-desktop.service` and, when a systemd user manager is reachable, enables and starts it. The unit runs `scripts/desktop/astack-desktop session`, which owns one process group:

1. a private Xauthority cookie (0600) and `Xvfb -auth … -nolisten tcp` (never `-ac`);
2. a session D-Bus at a dedicated fixed path, so out-of-session callers reach the same AT-SPI registry;
3. the accessibility environment for GTK, Qt and Mozilla toolkits;
4. `startxfce4` for the window manager and XFCE session services;
5. `wait -n`, so if any core process exits the group is torn down and systemd restarts the whole desktop.

Presence is not readiness. `desktop-packages` and `desktop-video` only prove that packages and the `x11grab` device exist. `desktop-runtime` is the only row that claims functionality, and only when the display is reachable, a window manager answers `_NET_SUPPORTING_WM_CHECK`, the session bus answers, and `org.a11y.Status.IsEnabled` is true. `desktop-unit`, `desktop-driver` and `desktop-session-start` report wiring, binary presence, and the start result (install mode only) separately. `--check` never waits for a start it did not request and never reports an absent prerequisite as `failed`. Herdr-app, Cua and desktop capability rows stay independent of each other.

### Use it from Pi

Start Pi inside the session so the `cua-driver` MCP child inherits the display and both buses:

```bash
scripts/desktop/astack-desktop status            # state, display, wm, session_bus, a11y_bus, ffmpeg
scripts/desktop/astack-desktop run -- pi         # the whole connection wrapper
```

Started anywhere else, `cua-driver` has no `DISPLAY`, `list_apps` is empty, and `get_window_state` has no accessibility bus. No second daemon is involved: on Linux `cua-driver mcp` owns its runtime directly and exits on stdin EOF.

Stop or remove it with:

```bash
systemctl --user disable --now astack-desktop
scripts/desktop/astack-desktop unit uninstall    # refuses a unit Astack did not write
```

### Isolation

- Per-user Xauthority cookie at 0600; `Xvfb` runs with `-auth` and `-nolisten tcp`, never `-ac`, so there is no global display access.
- The session bus lives in its own 0700 runtime directory instead of replacing the user's systemd bus.
- No VNC, RDP, noVNC, public port, NSG change, or container. A stopped unit leaves no listener.
- One UI owner per display. `browser-use` stays on its headless Chrome launcher.
- The desktop starts empty; the only windows are the ones the task launches.

### Screenshots and video

Capture is display-scoped, never per-window. Through the driver, `get_desktop_state` writes a full-display PNG with `screenshot_out_file`, and `start_recording` with `record_video: true` writes `<output_dir>/recording.mp4` (H.264, 30 fps) using the same ffmpeg `x11grab` mechanism. Outside an MCP session:

```bash
scripts/desktop/astack-desktop record --output var/<sessionId>/<workId>/<taskId>/desktop.png --frames 1
scripts/desktop/astack-desktop record --output var/<sessionId>/<workId>/<taskId>/desktop.mp4 --duration 5
```

Artifacts stay in the owning task directory under `var/`. There is no storage service.

### VM smoke test (not executed by the installer)

Status: **source only**. The composition is vendor-derived, but a hand-built Ubuntu 22.04 session is untested until this runs. Run it as the normal user over SSH, because the systemd user unit needs a user manager.

```bash
# 0. Install once. Expect desktop-packages/desktop-unit installed and desktop-runtime ready.
bash scripts/setup.sh --desktop --report-dir var/<sessionId>/<workId>/<taskId>/setup

# 1. Session: display, window manager, buses.
scripts/desktop/astack-desktop status
DISPLAY=:1 XAUTHORITY=$HOME/.local/state/astack-desktop/xauthority \
  xdpyinfo | grep -E 'dimensions|depth of root'
DISPLAY=:1 XAUTHORITY=$HOME/.local/state/astack-desktop/xauthority \
  xprop -root _NET_SUPPORTING_WM_CHECK

# 2. Optional environment diagnostic. This is not connection proof and need not pass to continue;
#    the CLI `status`/`call` commands talk to a daemon endpoint that the direct MCP runtime does
#    not provide, so they are not used here.
scripts/desktop/astack-desktop run -- cua-driver doctor

# 3. Owned verification window with an independent result file.
ASTACK_TOY_RESULT=$PWD/var/<sessionId>/<workId>/<taskId>/toy-result.txt \
  scripts/desktop/astack-desktop run -- python3 scripts/desktop/toy-app.py &
```

Then, in Pi started with `scripts/desktop/astack-desktop run -- pi`, keep **one** MCP connection for the whole sequence. `cua-driver call` retires snapshots between invocations and is not a substitute for shared-session tokens.

```js
// codemode: one connection, one session, one token per fresh snapshot.
// Connection proof is this list_apps result, not a CLI daemon status.
text(await tools.mcp__cua_driver__list_apps({}));
text(await tools.mcp__cua_driver__list_windows({}));
// take pid and window_id from that result for the window titled "Astack Desktop Smoke"
const s1 = await tools.mcp__cua_driver__get_window_state({
  pid, window_id, include_screenshot: true,
  screenshot_out_file: "var/<sessionId>/<workId>/<taskId>/window.png",
});
// act once with an element_token from s1 (for example set_value on "toy-input")
const s2 = await tools.mcp__cua_driver__get_window_state({ pid, window_id, include_screenshot: true });
// verify s2 shows the application's own state: label "Applied: 42"
```

```bash
# 4. Independent readback: the app wrote the value itself.
cat var/<sessionId>/<workId>/<taskId>/toy-result.txt        # expect 42

# 5. Screenshot and playable video from the same display.
scripts/desktop/astack-desktop record --output var/<sessionId>/<workId>/<taskId>/desktop.png --frames 1
scripts/desktop/astack-desktop record --output var/<sessionId>/<workId>/<taskId>/desktop.mp4 --duration 5
ffprobe -v error -select_streams v:0 \
  -show_entries stream=codec_name,avg_frame_rate,width,height \
  -show_entries format=duration \
  -of default=noprint_wrappers=1 var/<sessionId>/<workId>/<taskId>/desktop.mp4

# 6. Driver video path: start_recording({output_dir, record_video: true}) -> one action ->
#    stop_recording(); recording.mp4 must exist and ffprobe must report H.264, ~30 fps, duration > 0.

# 7. Cleanup: close the owned window, stop the recording, then the session.
kill %1 2>/dev/null || true
systemctl --user stop astack-desktop
scripts/desktop/astack-desktop status                       # state=stopped
ss -ltnp 2>/dev/null | grep -E ':5[0-9]{3}|:32[0-9]{2}|:6080' || true   # expect no listener
```

Passing the last check without a listener is part of the contract, not an extra test.

## Tested results (two hosts)

These are actual installation outcomes, not a claim that every feature passes. The same executed code ran on both hosts. This section is documentation added after the Ubuntu run; it changes only `SETUP.md`, not the installer, and needs no script rerun.

| Host | OS / arch | Main runtimes | Latest install / rerun / check |
|---|---|---|---|
| macOS | 27.0.1, arm64 (Apple M4 Max) | Node 22.21.1, npm 10.9.4, Python 3.14.7, Pi 1.4.0, uv 0.12.13, Chrome 156.0.8078.80, hc 0.1.15, herdr-app 0.1.10, Cua 0.34.1, browser-use 0.1.13 | 32 ready / 0 installed / 6 manual / 2 unsupported / **0 failed**; real check and repeat install left config, stamps, tracked content and status unchanged |
| Ubuntu VM | 22.04.5 LTS, x86_64 | Node 22.23.4, npm 10.9.9, OS Python 3.10.12 preserved (uv-managed 3.12.16 for browser-use), Pi 1.5.0, uv 0.13.7, Chrome 156.0.8078.80, hc 0.1.17; no desktop, herdr-app or Cua | 25 ready / 0 installed / 4 manual / 10 unsupported / **0 failed**; install, rerun and `--check` returned 0; rerun/check snapshots empty |

Executed code bytes (verified on both hosts):

| file | sha256 |
|---|---|
| `scripts/setup.sh` | `2b4868b748bd4bb6d00d38216d24b0c4146a651b850f46a00ecd8dd66b599279` |
| `scripts/lib/setup/common.sh` | `2e9fb1a46421e3cf18326e0040004865d4538999740a8703d230860c13fde832` |
| `scripts/lib/setup/steps.sh` | `b2797a6bcffa5cc0a7c5e5547ef0de9372bfd39f94c81763f6f293618f0d20db` |
| `scripts/lib/setup/configure.mjs` | `865f57ff53d880934ba3dd36f1dce0ee95ce71b9ec36e7152523611861928f3e` |
| `skills/pi-herdr-skills/scripts/install.sh` | `e4fb78af6d2c1a9106188ef4acac442e0e4eb4467efa50447916bf83c1f2ab6e` |
| `SETUP.md` at execution | `4c26b4b26401057f72f2d1feca03e11df30937893974677167b425cbbfb5269e` |

This documentation edit produces a new `SETUP.md` hash, recorded separately in the task's `both-host-verification.md`; the VM has not synced the edited document. The five code files and helper above are unchanged.

What actually passed:

- macOS: 11 local packages registered; 6 shared skills current; headless owned-browser screenshot 756×469; Cua permission status readable; `npm run check` 28/28 and `npm run check:skills` 1/1.
- Ubuntu: 11 packages registered; all **25 Astack skill names present** plus 2 unrelated names; `computer-use` and `retro` byte-identical to the repo; four **pre-existing modified skills preserved with unchanged hashes** (`browser-use`, `commit-and-merge`, `implement`, `talk-human`). **25 names does not mean all 25 are current bytes.** Headless owned-browser screenshot 480×320 (9,807 B, SHA-256 `e9c7d31504fe85e2b60736917c47ae693ac9b3bb28a7b118351910dd0782bb27`); Archify doctor ready.
- Ubuntu used the standard Azure RunCommand route with no NSG change, no SSH change, and no restart/cutover of pre-existing services. nginx and both `vsts.agent.*` services stayed active; listening ports stayed 22/53/80/8080/8443. The newly installed `herdr-core serve` daemon and `Linger=yes` remain as a disclosed installed capability, not a change to an existing service.
- Chrome was already installed and was reused, not deleted; the interrupted-download recovery branch was therefore not exercised on the VM. `unzip` remains installed.

Boundaries (do not read the counts as “everything works”):

- **Not all GUI, auth or Slack features pass.** On macOS, model auth, Slack tokens/listener, Herdr visible-tab/AgentCreate behavior, Cua GUI action verification, Core-parent delegation and optional external packages remain `manual`. On the VM, `shared-skills` is `manual` for the four preserved conflicts, with Slack config, model auth and optional packages also manual. Herdr app, desktop, Vulkan, Cua, computer-use, GUI delegation, Slack delegation and the OS security sandbox are `manual`/`unsupported` on the headless VM.
- The installer proves installation and selection only for the capabilities listed above. It does not prove model credentials, Slack connectivity, a visible Herdr tab, Cua GUI control, or an OS sandbox.

## Manual follow-ups

- Model/provider login: `pi`, then `/login`, or the provider's environment variables. The installer only checks whether a credentials file exists; it never reads or prints it.
- Cua onboarding: on macOS, grant Accessibility and Screen & System Audio Recording to the signed `CuaDriver.app` in System Settings. The setup reports current status but cannot grant it.
- Herdr delegation: start Pi inside a live Herdr Core terminal. `AgentCreate` is Core-only by default; the Herdr app and its visible tabs are optional presentation, requested with `present: true`. The installer cannot create a Core parent.
- Private desktop: run `bash scripts/setup.sh --desktop` as the normal user, then start Pi with `scripts/desktop/astack-desktop run -- pi`. See the section above for the VM smoke test.
- Slack: create the app/tokens and private config, then start exactly one listener. See `services/pi-slack/README.md`.
- Security sandbox: no OS sandbox ships with Astack. `security-audit` target execution stays source-only until a reviewed sandbox is provided.
- Optional external packages: `pi-web-access` and `@narumitw/pi-usage` are separate global packages; Astack neither installs nor configures them.

## Slack capability boundary

The installer builds the Slack gateway but does not start it. There is no supported Slack → First Mate → `AgentCreate` path with the current implementation: the gateway runs as `node dist/service.js`, while `AgentCreate` uses `process.argv[1]` as the Pi entrypoint, so a Core-wrapped gateway would relaunch the gateway under Node instead of Pi. Installing Core, the app, or a desktop does not fix that deterministic entrypoint mismatch. Treat `pi-slack` as a chat gateway; a delegated parent must be a genuine Core-hosted Pi process. See `services/pi-slack/README.md` for the connector details.

## Verification

The setup's own checks are lifecycle checks, not unit tests:

```bash
bash scripts/setup.sh --check
bash scripts/setup.sh --report-dir /tmp/astack-setup-report
pi list
pi mcp list                 # inspect, do not paste secrets
npm run check               # package typecheck/build/pack + service build
npm run check:skills        # shared skills match the global install
```

`--check` never installs, builds, writes stamps, or changes `settings.json`/`mcp.json`; it only reads and writes the requested report. Package checks report `ready` for current dependencies with an existing build output, and `manual` when a build is missing.

A second `bash scripts/setup.sh` should report the same state with no config changes; dependency installs are skipped through stamps in each package's `node_modules/.astack-setup/`.

## Optional limits

The installer intentionally targets the Node 22 major required by the package engines and uses each package's existing lockfile. It does not add package-count, concurrency, cache, or artifact-size caps. Optional controls such as skipping groups (`--skip`) are available but not required.
