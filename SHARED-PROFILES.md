# Shared profiles: planned next step

Status: not implemented or deployed. The current application stores profiles on one Mac.

## Requested behavior

- One shared Ortus workspace and profile list across installations.
- Everyone granted access to that workspace can use the same profiles.
- No individual login screen in the initial version.
- Individual accounts and permissions can be introduced later.
- Code and Mac installers are distributed through GitHub; live profile data is stored separately.

## Decisions needed

1. Are users on different Macs or on the same Mac?
2. If different Macs, choose a host: an existing Ortus server, this Mac while online, or a new hosted service.
3. Choose public source/release distribution or a private repository.

## Implementation requirements

- A shared profile service provides the canonical list, metadata and saved session snapshots.
- Each installation receives a workspace connection configuration. No personal account is needed initially. Workspace credentials must not be committed or baked into publicly downloadable builds.
- Opening a profile acquires an exclusive server-side lock before downloading its latest saved state. Closing saves a new version before releasing the lock.
- Failed uploads retain the local copy and expose a retry action. They must not report a successful save or permit conflicting edits silently.
- Connection failures and stale locks require explicit recovery behavior. Profile versions prevent an old client overwriting newer data.
- Cookie transfer must account for Chrome’s machine-specific encryption. Copying the Chrome directory alone is not a portable session-transfer solution.
- Stored profile data must be protected in transit and on the server. Keep the API structured around workspace membership so account authentication can be added later.

Exact GoLogin fingerprint cloning and device-bound sign-in transfer remain outside the current app’s capabilities.
