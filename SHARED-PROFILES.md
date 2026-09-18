# Shared profiles: planned next step

Status: shared service not deployed. The current application stores profiles on one Mac. A tested spreadsheet mapper is implemented in `src/sheet-profiles.cjs`.

## Requested behavior

- One shared Ortus workspace and profile list across installations.
- Everyone granted access to that workspace can use the same profiles.
- No individual login screen in the initial version.
- Individual accounts and permissions can be introduced later.
- Code and Mac installers are distributed through GitHub; live profile data is stored separately.

## Decisions needed

1. Choose the shared-service host: an existing Ortus server or a new hosted service.
2. Confirm whether synchronization means profile lists/settings/saved sessions or live browser mirroring.

Confirmed: different team Macs, no personal logins initially, a private team-only installer with preconfigured workspace access. Public generic source remains separate. Private release repository: `ortusclub/ortus-profile-desk-team`.

## Implementation requirements

- A shared profile service provides the canonical list, metadata and saved session snapshots.
- Each installation receives a workspace connection configuration. No personal account is needed initially. Workspace credentials must not be committed or baked into publicly downloadable builds.
- Opening a profile acquires an exclusive server-side lock before downloading its latest saved state. Closing saves a new version before releasing the lock.
- Failed uploads retain the local copy and expose a retry action. They must not report a successful save or permit conflicting edits silently.
- Connection failures and stale locks require explicit recovery behavior. Profile versions prevent an old client overwriting newer data.
- Cookie transfer must account for Chrome’s machine-specific encryption. Copying the Chrome directory alone is not a portable session-transfer solution.
- Stored profile data must be protected in transit and on the server. Keep the API structured around workspace membership so account authentication can be added later.

Exact GoLogin fingerprint cloning and device-bound sign-in transfer remain outside the current app’s capabilities.

## Sheet mapping

- Use the selected account tab, not the spreadsheet overview tab.
- Select rows whose trimmed Status equals Active, case-insensitively.
- Use Email as the stable account identifier and Full Name as the display name.
- Group by the trimmed VM Account value; blank values belong to Unassigned.
- Read supported proxy strings from Proxy Details. Invalid proxies block opening.
- Do not import account passwords or 2FA columns.
- Preserve profile identity across row reordering, renaming, and folder changes.
- Duplicate active emails or missing required identifiers block the sync rather than mix account sessions.
- The live spreadsheet URL and rows are runtime configuration/data; do not publish them in source or releases.
