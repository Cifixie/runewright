# Security

Runewright runs shell commands and Claude Code with the operating-system permissions of the account that starts the PTY sidecar. It is designed for local, trusted use only; it is not a sandbox or a multi-user service.

Do not expose the sidecar port to a network or deploy this application as a public/shared service. Keep credentials, tokens, `.env` files, and workspace contents out of commits. The generated PTY token only protects the local WebSocket handshake; it does not limit the shell's permissions.

To report a vulnerability, contact the repository owner privately rather than publishing exploit details in an issue. No private reporting contact is configured yet; do not use a public issue for sensitive reports.
