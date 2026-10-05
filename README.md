# KRYPT 🔐

KRYPT is an open-source encrypted chat application with accounts, direct messages, groups, reactions, image sharing, replies, editing/deletion, typing indicators, presence, and a browser-side encryption layer.

> **Security status:** KRYPT currently implements an end-to-end encrypted MVP using NaCl public-key boxes and password-encrypted key backup. Message plaintext is encrypted in the browser before it reaches the API. This implementation has **not** been independently audited and does **not** yet implement Signal's Double Ratchet or MLS forward secrecy. Do not market this release as a Signal-equivalent secure messenger until the crypto layer is replaced/audited.

## Features

- Account registration/login with bcrypt password hashing
- Encrypted private-key backup for multi-browser login
- Search users and start DMs
- Create group chats with roles
- End-to-end encrypted text and image messages
- Replies, edit, delete, and emoji reactions
- Live typing indicators and online presence via Socket.IO
- Responsive three-pane chat UI
- Selectable shared-server connection for web and installed desktop clients
- SQLite persistence with zero external database requirement
- MIT licensed

## Stack

- **Web:** React, TypeScript, Vite, TweetNaCl, Socket.IO client
- **Server:** Node.js, Express, TypeScript, Socket.IO, SQLite
- **Security:** NaCl box encryption in-browser, PBKDF2 + AES-GCM private-key backup, bcrypt password hashing, JWT sessions

## Local setup

```bash
cp .env.example .env
npm install
npm run dev
```

Open `http://localhost:5173`.

The API runs on `http://localhost:8787` by default.

## Shared server mode

KRYPT clients can connect to one shared HTTPS server instead of using the bundled local desktop server. Open **Server** from the login screen or **Profile & security**, enter the shared KRYPT server origin (for example `https://krypt.example.com`), and KRYPT verifies `/api/health` before switching.

Changing servers clears the local login session and encryption secret. Accounts and password-encrypted private-key backups belong to the server where the account was created.

Remote server URLs must use HTTPS. Plain HTTP is accepted only for `localhost` and `127.0.0.1` development servers.

### Render deployment

The repository includes `render.yaml` for a persistent single-instance shared API in Frankfurt:

- Node 22 runtime
- `/api/health` health check
- persistent SQLite database at `/var/data/krypt.db`
- desktop loopback origins enabled for installed clients
- generated JWT signing secret
- deploys gated on GitHub checks

The Blueprint uses a **Starter** web service because persistent disks are not a free-service feature. The attached SQLite disk also means the service remains single-instance. Move the shared API to PostgreSQL/libSQL before horizontal scaling.

After the Blueprint is applied, set `WEB_ORIGINS` to any browser origins that should be allowed, comma-separated. Installed Electron clients are covered by `ALLOW_DESKTOP_ORIGINS=true`.

## Production

Build everything:

```bash
npm install --no-audit --no-fund
npm run build
```

Start the API:

```bash
npm run start
```

Serve `apps/web/dist` using your web host/CDN and set `VITE_API_URL` at web build time if the API is on another origin.

Recommended production changes before public launch:

1. Replace the MVP message crypto with a reviewed Signal/MLS implementation.
2. Put the API behind HTTPS only.
3. Move SQLite to PostgreSQL/libSQL for multi-instance deployments.
4. Add object storage for large encrypted attachments.
5. Add email verification, rate limiting backed by Redis, abuse reporting, and account recovery.
6. Run an independent security audit.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `HOST` | Bind address; use `0.0.0.0` for hosted services |
| `PORT` | API port, defaults to `8787` |
| `WEB_ORIGINS` | Comma-separated browser origins allowed by CORS |
| `WEB_ORIGIN` | Legacy single-origin fallback |
| `ALLOW_DESKTOP_ORIGINS` | When `true`, allow HTTP loopback origins used by installed clients |
| `JWT_SECRET` | Long random JWT signing secret |
| `DATABASE_PATH` | SQLite database path |
| `VITE_API_URL` | Optional web build-time API URL |

## Repository layout

```text
apps/
  server/   Express + Socket.IO + SQLite API
  web/      React/Vite encrypted chat client
  desktop/  Electron desktop runtime
.github/
  workflows/ci.yml
  workflows/desktop-release.yml
render.yaml  Render shared-server Blueprint
```

## License

MIT © bxane-dev
