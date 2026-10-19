# Runewright

Runewright is a local web workspace for persistent terminal sessions running Claude Code. The Next.js UI connects to a local PTY sidecar; each session runs as your operating-system user, with that user's filesystem and shell access.

## Requirements

- Node.js supported by Next.js 16
- pnpm 12.3.4 (`corepack enable` can activate the package manager)
- Claude Code installed and authenticated, unless you set `PTY_COMMAND` to an empty string
- A native build toolchain supported by [`node-pty`](https://github.com/microsoft/node-pty)

## Run locally

```sh
pnpm install
pnpm dev
```

Open <http://localhost:3000>. The sidecar listens on `127.0.0.1:4001` by default. The first terminal session starts in the repository root and runs `claude`.

## Configuration

Set environment variables before starting `pnpm dev`:

| Variable | Default | Purpose |
| --- | --- | --- |
| `PTY_PORT` | `4001` | Local PTY sidecar port |
| `PTY_ALLOWED_ORIGIN` | `http://localhost:3000` | Browser origin allowed by the sidecar and token route |
| `PTY_WORKSPACES` | `{"project":".."}` | JSON map of session IDs to directories, resolved relative to `pty-server/` |
| `PTY_COMMAND` | `claude` | Command started in each new session; set to an empty string to start an interactive shell instead |
| `PTY_SHELL` | Current shell, or `/bin/sh` | Shell executable used for sessions |
| `PTY_TOKEN_FILE` | `pty-server/.runtime/token` | Token file shared between the web app and sidecar; if overridden, use the same absolute path for both processes |
| `NEXT_PUBLIC_PTY_WS_URL` | `ws://127.0.0.1:4001/pty` | Sidecar WebSocket URL used by the browser |

Example with two workspaces:

```sh
export PTY_WORKSPACES='{"project":"..","notes":"../../notes"}'
pnpm dev
```

The sidecar creates a random token at startup and removes it at shutdown. Keep the sidecar and web app on the same machine; do not expose the PTY port or deploy this app as a shared or public service. A connected terminal has the full permissions of the account running the sidecar. This application does not sandbox shell commands or authenticate users.

## Checks

```sh
pnpm --filter @runewright/web lint
pnpm --filter @runewright/web build
```

## License

This project is licensed under the [MIT License](LICENSE).
