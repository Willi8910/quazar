# Quazar

A lightweight terminal for running many LLM coding agents — Claude Code, Codex, Gemini CLI — across many
repositories at once, and keeping track of all of them.

Built with [Tauri 2](https://tauri.app), React and xterm.js: a ~5 MB app with a native terminal per tab.

## Features

- **Tabs grouped by repository.** Every tab is a real shell. Tabs group themselves by repo folder; make your
  own (nested) groups and drag tabs and groups around. Hide what you're not using right now.
- **Agent status at a glance.** Each agent tab shows whether it's working, waiting for you or done, what it's
  doing, and its last reply. Notifications and a dock badge when one needs you.
- **"Needs you" queue.** A pill lists agents waiting for input or finished while you were away; **⌘J** jumps to
  the next one.
- **Resume anything.** Every session Quazar ran — and every Claude/Codex/Gemini session in that folder — can be
  resumed with the flags it was started with. Agents cut off by a restart or Stop resume when their tab opens.
- **Review changes.** See an agent's uncommitted changes as a unified or split diff, comment on lines, and send
  the comments back to the agent as its next prompt.
- **Worktree aware.** Shows each agent's branch and git worktree, and warns when two agents share a checkout.
- **Resource use.** CPU and memory per tab and in total; hover a tab's figure for every process in it (dev
  servers with their ports included) and stop the one that's running away.
- **Multiple windows.** Move a tab to its own window (one console per monitor); all windows share the same,
  synced sidebar.
- **Keyboard first.** Everything is in the command palette (**⌘K**).

## Install

### macOS

1. Download **`Quazar_<version>_universal.dmg`** from the
   [latest release](https://github.com/Willi8910/quazar/releases/latest). It runs on Apple Silicon and Intel
   Macs (macOS 13 or later).
2. Open the `.dmg` and drag **Quazar** to **Applications**.
3. Quazar isn't signed with an Apple Developer ID yet, so macOS blocks it on first launch. Run this once in
   Terminal, then open Quazar normally:

   ```sh
   xattr -dr com.apple.quarantine /Applications/Quazar.app
   ```

To update, download the new release and replace the app in Applications. Your tabs, groups and settings are
kept (they live in `~/Library/Application Support/com.williamlie.quazar`).

### Windows

Not available yet. Quazar's shell integration and process tools are macOS/Unix-specific today; a Windows
version (PowerShell integration, Windows installer) is planned. Follow the
[releases](https://github.com/Willi8910/quazar/releases) for it.

## First steps

1. On first launch, Quazar asks for your **development folders** (e.g. `~/Development`) — it finds the git
   repositories inside them, so you can open any project in a couple of keystrokes. Change them any time in
   **Settings → Projects**.
2. **Install the agent hooks** when asked (or later: ⌘K → *Install agent hooks*). They let Quazar see what each
   agent is doing; without them, status, notifications and the "needs you" queue stay idle. They only act inside
   Quazar, and your existing hooks are kept.
3. **⌘N** to start an agent in a project, **⌘T** for a plain terminal.

## Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| ⌘N / ⌘T | New agent / new terminal tab |
| ⌘K | Command palette |
| ⌘J | Next agent needing you |
| ⌘1 … ⌘9 | Go to tab 1–9 |
| ⇧⌘] / ⇧⌘[ | Next / previous tab |
| ⌘W | Close tab |
| ⇧⌘R | Rename tab |
| ⌘B / ⇧⌘B | Show or hide the sidebar / move it left or right |
| ⌘= / ⌘- / ⌘0 | Bigger / smaller / actual size (sidebar or terminal, whichever you used last) |
| ⌘, | Settings |

## Build from source

Requirements: macOS 13+, [Node.js](https://nodejs.org) 20+, [Rust](https://rustup.rs) (stable) and the Xcode
command line tools (`xcode-select --install`).

```sh
git clone https://github.com/Willi8910/quazar.git
cd quazar
npm ci
npm run tauri dev      # run in development, with live reload
npm run tauri build    # build the app: src-tauri/target/release/bundle/macos/Quazar.app
```

A Quazar built this way updates itself from the source folder: when the source changes, an **Update** button
appears in the sidebar — it rebuilds in the background and restarts into the new build.

Tests: `npx vitest run` (frontend) and `cargo test --manifest-path src-tauri/Cargo.toml` (backend).

Releases are built by GitHub Actions: pushing a version tag (`git tag v0.2.0 && git push origin v0.2.0`)
builds the app and publishes it to [Releases](https://github.com/Willi8910/quazar/releases). Bump the version
in `package.json`, `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml` first.

## License

[MIT](LICENSE)
