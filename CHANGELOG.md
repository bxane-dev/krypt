# Changelog

All notable KRYPT changes are tracked here.

## [0.6.0] - 2026-10-05

### Added
- Unified GitHub Release pipeline for mobile and desktop packages.
- macOS DMG packaging for Intel x64, compatible with Apple Silicon through Rosetta 2.
- Android APK, iOS IPA, Windows NSIS, Linux AppImage/DEB, and macOS DMG in one release.
- Versioned release notes and changelog assets.
- Automatic release creation when a new package version reaches `main`.

### Changed
- KRYPT release version advanced to 0.6.0 across root and desktop packages.
- Mobile and desktop package publishing is consolidated into the unified release workflow.
- Legacy split packaging workflows remain manual-only for diagnostics.

### Packaging notes
- Android APK is debug-signed and directly installable.
- iOS publishes a signed IPA only when Apple signing secrets are configured; otherwise it publishes an unsigned iPhoneOS IPA plus a signing notice.
- Windows, Linux, and macOS desktop packages are currently unsigned.
- The release-gated macOS package is x64 so GitHub ARM runner capacity cannot block publication; Apple Silicon can run it through Rosetta 2.

## [0.5.1] - 2026-10-05

### Added
- Signing-aware iOS CI.
- Temporary Apple signing keychain handling.
- Provisioning-profile metadata extraction.
- Optional signed IPA archive/export path.
- Native version synchronization for mobile builds.

## [0.5.0] - 2026-10-05

### Added
- Mobile-first Capacitor 8.5.2 packaging.
- Android APK build pipeline using Android SDK 36.
- Native iOS/Xcode build and unsigned IPA packaging.
- Phone safe-area and touch optimizations.
- Native mobile WebView origin support for the shared server.

## [0.4.0] - 2026-10-05

### Added
- Server-backed revocable sessions.
- Device records and device management UI.
- Remote device/session revocation.
- Per-device verification identities and key versions.
- Authentication throttling and proxy-aware client IP handling.

## [0.3.0] - 2026-10-05

### Added
- Selectable shared hosted KRYPT server.
- Hosted CORS/origin policy.
- Render deployment Blueprint with persistent SQLite storage.
- Node 22 runtime alignment.

## [0.2.0] - 2026-10-05

### Added
- Electron desktop application.
- Windows NSIS installer.
- Linux AppImage and DEB packages.
- GitHub Actions desktop packaging.

## [0.1.0] - 2026-10-05

### Added
- Accounts and profiles.
- Direct and group chats.
- Browser-side encrypted messages and images.
- Replies, edits, deletes, reactions, typing, and presence.
- SQLite persistence, Socket.IO realtime messaging, and MIT license.

## Security status

KRYPT's current message encryption is an MVP based on NaCl public-key boxes with password-encrypted private-key backup. It has not received an independent cryptographic audit and does not yet implement Signal's Double Ratchet or MLS forward secrecy.
