# Shared profiles

Version 0.1.4 shares profile names, folders, proxy settings and newly created profiles through the existing Google Cloud server. Each colleague enters a workspace key once. Both GitHub repositories are private; neither contains production credentials.

## Implemented

- The server maintains the shared catalog on a separate encrypted persistent volume.
- Active account-sheet rows are imported every five minutes. The account tab must be specified using its gid.
- Email provides stable identity; Full Name supplies the display name. VM Account supplies the folder; blank values use Unassigned.
- Proxy Details supplies host, port, username and password. Malformed values block opening. Blank values use direct connections.
- Account passwords and 2FA columns are excluded.
- Inactive accounts are archived, preserving their data. Empty or invalid sheet results do not erase the previous catalog.
- Apps refresh every ten seconds and save an encrypted local catalog. New shared profiles and settings changes propagate across Macs.
- Edits use version checks to reject stale overwrites. Open browsers retain their current local settings until closed.
- Every shared profile is checked against the server before opening, so inactive accounts cannot be opened from an old offline catalog.
- Workspace keys are entered manually and stored in the existing Keychain-encrypted vault. The installer contains no access keys.

## Still to implement

Browser cookies and site storage remain local. Saved-session transfer between Macs, exclusive browser locks with recovery, and live browser mirroring are not enabled. Backend snapshot and locking routes are disabled by default until portable session transfer and recovery have been implemented and tested.

Portable session transfer must handle Chrome's machine-specific cookie encryption; copying its entire directory alone is insufficient. Failed uploads must preserve unsaved local state and prevent conflicting writes. Session transfer must be tested before enabling these routes.

Exact GoLogin fingerprint cloning and device-bound sign-in transfer are not supported.

See [DEVELOPING.md](DEVELOPING.md) for repositories, tests and server configuration.
