# Ortus Profile Desk

A standalone Mac profile manager. Each profile opens in Google Chrome with a separate persistent browser-data directory. GoLogin is used only for a one-time import; local profiles do not use its SDK, Orbita, account, or cloud storage.

## Download for Mac

[Download the latest installer](https://github.com/ortusclub/ortus-profile-desk/releases/latest). Open the DMG and drag **Ortus Profile Desk** into Applications.

The installer includes both Intel and Apple Silicon support. This initial build is locally signed but not Apple-notarized; macOS may require you to allow it in System Settings → Privacy & Security.

## Requirements

- macOS 13 or newer.
- Google Chrome installed.
- The downloadable universal installer supports Intel and Apple Silicon.

Shared profiles across Macs are planned but not implemented. See [shared-profile requirements](SHARED-PROFILES.md).

## Use

1. Open **Ortus Profile Desk.app**. Google Chrome must be installed.
2. Choose **New profile** to create a fresh local session, or **Import from GoLogin**.
3. Before importing, close and finish syncing the source profiles in GoLogin.
4. Paste your GoLogin API token into the app, load the profile list, select profiles and import.
5. Review each imported profile's **Report**. Set an independent proxy in profile settings if required.
6. Click **Open**. Sign in again wherever needed. Close the profile normally to save its browser state.
7. After importing, **Disconnect & forget token** removes the API token from memory. The app also forgets it on quit.

## What this version preserves

- Profile names and notes.
- Available non-expired cookies returned by GoLogin's cookie API. Chrome's acceptance/rejection count appears in the report after the first open.
- Supported external HTTP/HTTPS and unauthenticated SOCKS proxy settings. Authenticated HTTP/HTTPS proxies use a loopback relay.
- Original profile configuration, including fingerprint settings, archived in the encrypted vault for reference.
- After migration: persistent, isolated Chrome cookies, local storage, extensions installed by you, and browsing state on this Mac.

## Important limits

**This is not an exact GoLogin fingerprint clone.** Chrome supplies its real browser identity. Canvas, WebGL, fonts, audio, client hints, hardware properties, and other GoLogin fingerprint overrides are not recreated. Imported fingerprint settings are reference data, not active overrides. Normal Chrome updates and changes to your Mac or proxy can change observable signals. Websites can expire or bind sessions to a device and ask you to log in again.

The importer does not transfer saved passwords, history, extensions, local storage, IndexedDB, client certificates, or device-bound authentication keys. It does not download private profile archives. Profile settings and cookie endpoints alone do not constitute a complete browser backup.

GoLogin-managed or unsupported proxy configurations block launch until you choose an independent connection. A proxy working today is not proof that it will survive cancellation of GoLogin; verify your proxy provider separately. SOCKS username/password authentication is not implemented.

Import only adds new local profiles. It never deletes or modifies your GoLogin profiles and never overwrites an existing local import. Validate a sample profile and its websites before cancelling your GoLogin service. No live account import has been validated without your token.

## Local data

Data is stored under `~/Library/Application Support/Profile Desk/vault/`:

- `profiles.vault`: encrypted configuration, proxy credentials, migration reports and cookies awaiting import, protected by Electron safeStorage and the macOS login Keychain.
- `browsers/<local-id>/`: dedicated Chrome data directories. Chrome controls protection of its own data; these directories are not encrypted by Profile Desk as a whole.

The root directory is private to your user. The API token is not saved to disk by the application. Browsing and imported profile data are never sent back to GoLogin. Keep backups of the whole data directory and your macOS Keychain; copying the vault alone to another Mac will not make it decryptable there. Profile Desk has no telemetry.

## Development

```sh
npm ci
npx install-electron --no
npm start
npm test
node tests/browser-smoke.cjs
./node_modules/.bin/electron tests/electron-smoke.cjs
npm run build
npm run build:release # Universal Mac DMG (Intel + Apple Silicon)
```

The build targets this Mac's Apple Silicon architecture. Output: `dist/mac-arm64/Ortus Profile Desk.app`. It uses local ad-hoc signing, not Apple notarization. The browser smoke test opens isolated headless Chrome profiles against a temporary localhost page; it does not touch your normal Chrome data. The Electron smoke test uses a temporary vault.

## API references

- [List profiles](https://gologin.com/docs/api-reference/profile/get-all-profiles)
- [Read profile settings](https://gologin.com/docs/api-reference/profile/get-profile-by-id)
- [Read cookies](https://gologin.com/docs/api-reference/profile/find-cookies-of-profile)
- [GoLogin export limitations](https://support.gologin.com/en/articles/14405649-export-import-overview)

Only read-only `GET` requests are used for migration. Redirects are rejected to avoid forwarding the API token to another host.

Paste proxies in profile settings as `host:port:username:password`. The connection fields fill automatically; direct profiles switch to HTTP. Choose HTTPS if required by your provider.

The displayed name is Ortus Profile Desk. Its original internal identity and data-directory name remain Profile Desk so existing encrypted profiles continue working.

## Team installation and updates

Both repositories are private. Developers work in [ortus-profile-desk](https://github.com/ortusclub/ortus-profile-desk); [ortus-profile-desk-team](https://github.com/ortusclub/ortus-profile-desk-team) distributes installers.

Install GitHub CLI (`brew install gh`, or https://cli.github.com), then run:

```sh
gh auth login --hostname github.com --web --git-protocol https
installer=$(mktemp) && gh api repos/ortusclub/ortus-profile-desk-team/contents/install.sh -H "Accept: application/vnd.github.raw" > "$installer" && bash "$installer"
```

The GitHub account must have access to the private team repository. The installer verifies the private release and preserves existing profiles. Google Chrome and macOS 13+ are required. If macOS blocks this ad-hoc signed app, use System Settings → Privacy & Security → Open Anyway for the trusted team download.

In version 0.1.4+, click **Connect team workspace** and enter the workspace key from your administrator. The app loads active sheet accounts, grouped by VM Account, with their proxy credentials. The key is saved in the Mac's Keychain-encrypted vault; it is never included in the installer or repository. The server reads the account sheet every five minutes; connected apps refresh every ten seconds. Newly created shared profiles and changed proxy settings appear on other Macs automatically.

Only rows with a populated proxy field receive a proxy. Blank proxy fields use direct connections. Account passwords and 2FA codes are not imported. Browser cookies and site storage remain local in this version; browser-session transfer is not enabled yet.

The sidebar shows the app version and **Check for updates**. Packaged builds automatically check at startup and every four hours, download newer private releases, and offer **Restart to update** after all profile windows are closed. GitHub CLI must remain signed into an authorized account. If updating fails, rerun the Terminal installer.

See [DEVELOPING.md](DEVELOPING.md) for source layout, development, tests and deployment notes.
