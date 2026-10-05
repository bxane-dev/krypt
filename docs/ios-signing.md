# KRYPT iOS signing

KRYPT builds a real iPhoneOS app on GitHub Actions. Without Apple credentials the workflow exports an unsigned IPA for native build verification. When the signing secrets below are configured, the same workflow also archives and exports a signed IPA using Xcode.

## Required Apple items

For an installable signed IPA, prepare:

- Apple Developer Program membership
- App ID / bundle identifier: `dev.bxane.krypt`
- Apple Development or Apple Distribution certificate exported as a password-protected `.p12`
- Matching provisioning profile (`.mobileprovision`)
- An Xcode `ExportOptions.plist` matching the intended distribution method

For direct installation outside the App Store, the provisioning profile must contain the target device IDs. For TestFlight/App Store Connect, use an App Store Connect distribution profile and matching export options.

## GitHub Actions secrets

Add these repository secrets in **Settings → Secrets and variables → Actions**:

| Secret | Value |
| --- | --- |
| `IOS_CERTIFICATE_P12_BASE64` | Base64-encoded `.p12` certificate |
| `IOS_CERTIFICATE_PASSWORD` | Password used when exporting the `.p12` |
| `IOS_PROVISIONING_PROFILE_BASE64` | Base64-encoded `.mobileprovision` profile |
| `IOS_EXPORT_OPTIONS_PLIST_BASE64` | Base64-encoded Xcode `ExportOptions.plist` |

Do **not** commit certificates, provisioning profiles, passwords, or App Store Connect private keys to the repository.

The workflow extracts the Apple Team ID and provisioning-profile name from the profile itself, imports the certificate into a temporary CI keychain, builds the archive, exports the signed IPA, and deletes the temporary keychain afterward.

## Encoding files

On macOS:

```bash
base64 -i certificate.p12 | pbcopy
base64 -i KRYPT.mobileprovision | pbcopy
base64 -i ExportOptions.plist | pbcopy
```

Paste each encoded value into its matching GitHub Actions secret.

## CI behavior

If all four signing secrets are present:

1. KRYPT still builds the unsigned iPhoneOS app as a deterministic compile check.
2. CI imports the signing certificate into a temporary keychain.
3. CI installs the provisioning profile.
4. Xcode archives KRYPT with manual signing.
5. `xcodebuild -exportArchive` exports `KRYPT-<version>-ios-signed.ipa`.
6. CI removes the temporary signing keychain.

If any signing secret is missing, the signed steps are skipped and CI uploads only `KRYPT-<version>-ios-unsigned.ipa` with a signing notice.

## Distribution

A signed IPA created with a Development or Ad Hoc profile can only run on devices allowed by that profile. App Store/TestFlight distribution requires an App Store Connect profile and matching export settings.

The workflow does not upload to TestFlight automatically yet. It produces the signed IPA first so signing can be verified independently before App Store Connect automation is enabled.
