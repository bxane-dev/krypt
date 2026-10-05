# KRYPT iOS signing

KRYPT's CI can build an unsigned iPhoneOS IPA without Apple credentials. A stock iPhone, TestFlight, or App Store distribution requires Apple code signing.

## Required Apple items

For an installable IPA, provide:

- Apple Developer Program membership
- App ID / bundle identifier: `dev.bxane.krypt`
- Apple Development or Distribution certificate exported as a `.p12`
- Password for that `.p12`
- Matching provisioning profile (`.mobileprovision`)
- Apple Team ID

Do not commit certificates, provisioning profiles, passwords, or App Store Connect keys to the repository. Store them as GitHub Actions secrets.

## Current CI output

The **Mobile Builds** workflow currently creates:

- Android: debug-signed APK, installable directly on Android devices
- iOS: unsigned iPhoneOS IPA artifact for native build verification

The iOS artifact proves that the native app compiles for physical iPhone hardware. It is intentionally named `*-ios-unsigned.ipa` and cannot be installed on a normal iPhone until it is signed with a valid Apple identity and provisioning profile.

## Recommended distribution path

1. Configure Apple signing secrets in GitHub.
2. Archive the `App` scheme with Xcode on the macOS runner.
3. Export with an App Store Connect, Ad Hoc, or Development export method.
4. Upload the signed IPA to TestFlight/App Store Connect or distribute it to provisioned devices.
