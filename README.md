# KRYPT 🔐

KRYPT is an open-source encrypted chat application for Android, iPhone, web, and desktop with accounts, direct messages, groups, reactions, image sharing, replies, editing/deletion, typing indicators, presence, and client-side encryption. KRYPT's current release priority is mobile-first.

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
- Server-backed, revocable login sessions
- Per-device verification identities with key versions
- Device list with remote session/device revocation
- Authentication throttling for login and registration
- SQLite persistence with zero external database requirement
- MIT licensed

## Stack

- **Mobile:** Capacitor 8.5.2, Android SDK 36, native iOS/Xcode project generation
- **Web:** React, TypeScript, Vite, TweetNaCl, Socket.IO client
- **Server:** Node.js, Express, TypeScript, Socket.IO, SQLite
- **Security:** NaCl box encryption in-browser, PBKDF2 + AES-GCM private-key backup, bcrypt password hashing, JWTs backed by revocable server sessions

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

## Devices and sessions

KRYPT 0.4.0 introduces server-backed sessions tied to device records. Tokens are accepted only while their session and device are still active. Removing a device revokes all active sessions for that device, including WebSocket access.

Each client also creates a separate local verification signing identity. Its public key and key version are stored with the device record. This is a foundation for future device verification and key transparency; it is **not yet used as the message-encryption ratchet**.

The Profile & security screen shows current and previously revoked devices. The current device can rotate its verification key, and other active devices can be remotely removed.

Upgrading a server from 0.3.x invalidates old stateless JWT sessions, so users must sign in once again after the upgrade.

Authentication endpoints include in-memory throttling. For horizontally scaled production deployments, move this limiter to a shared store such as Redis/Key Value.

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

## Mobile builds

KRYPT 0.5.x is mobile-first.

```bash
npm install
npm run mobile:web

# Create once locally, then sync after web changes
npx cap add android
npx cap add ios --packagemanager SPM
npx cap sync
```

GitHub Actions builds both platforms:

- **Android APK:** debug-signed and directly installable on Android; the native version name is synchronized with KRYPT's package version.
- **iOS IPA:** always builds a Release iPhoneOS compile-check IPA. When the four documented Apple signing secrets are configured, CI additionally archives and exports a signed IPA using Xcode. See `docs/ios-signing.md`.

The hosted KRYPT API supports the native WebView origins only when `ALLOW_MOBILE_ORIGINS=true`. The included Render Blueprint enables this.

KRYPT v0.6.0 uses a unified GitHub Release pipeline. A new version on `main` builds Android, iOS, Windows, Linux, and macOS packages and publishes them together under one GitHub Release. The older mobile and desktop workflows remain manual-only for diagnostics.

## GitHub Releases

Official packages are published together at **GitHub → Releases**. Each release includes:

- Android APK
- iOS IPA (signed when Apple credentials are configured; otherwise an unsigned verification IPA)
- Windows x64 NSIS installer
- Linux x64 AppImage
- Debian/Ubuntu x64 DEB
- macOS x64 DMG (Apple Silicon supported via Rosetta 2)
- `CHANGELOG.md`

The `.github/workflows/unified-release.yml` workflow checks the version in `package.json`. When a version reaches `main` and no matching release exists, it builds every target, creates the `v<version>` tag/release, attaches all installers, and verifies the release contains the expected assets.

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
5. Move authentication throttling to Redis/Key Value before horizontal scaling.
6. Add email verification, abuse reporting, and account recovery.
7. Run an independent security audit.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `HOST` | Bind address; use `0.0.0.0` for hosted services |
| `TRUST_PROXY` | Trust one reverse-proxy hop for accurate client IP throttling; enabled by the Render Blueprint |
| `PORT` | API port, defaults to `8787` |
| `WEB_ORIGINS` | Comma-separated browser origins allowed by CORS |
| `WEB_ORIGIN` | Legacy single-origin fallback |
| `ALLOW_DESKTOP_ORIGINS` | When `true`, allow HTTP loopback origins used by installed desktop clients |
| `ALLOW_MOBILE_ORIGINS` | When `true`, allow KRYPT's native Capacitor Android/iOS WebView origins |
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
  workflows/unified-release.yml
  workflows/mobile-build.yml
  workflows/desktop-release.yml
docs/
  ios-signing.md
  releases/
CHANGELOG.md
capacitor.config.ts
render.yaml  Render shared-server Blueprint
```

## License

MIT © bxane-dev
