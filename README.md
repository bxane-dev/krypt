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
| `PORT` | API port, defaults to `8787` |
| `WEB_ORIGIN` | Allowed browser origin |
| `JWT_SECRET` | Long random JWT signing secret |
| `DATABASE_PATH` | SQLite database path |
| `VITE_API_URL` | Optional web build-time API URL |

## Repository layout

```text
apps/
  server/   Express + Socket.IO + SQLite API
  web/      React/Vite encrypted chat client
.github/
  workflows/ci.yml
```

## License

MIT © bxane-dev
