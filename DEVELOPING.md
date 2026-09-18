# Working on Ortus Profile Desk

App, backend and tests: https://github.com/ortusclub/ortus-profile-desk (private).
Installer distribution: https://github.com/ortusclub/ortus-profile-desk-team (private).

Invite developers to the source repository. Team members who only need to install the app need access to the distribution repository.

## Local development

Install Node.js and run `npm ci`, then `npm start`. Google Chrome is required for browser profiles. `npm test` runs unit and two-client server integration tests; those tests need permission to listen on localhost. On a Mac, `./node_modules/.bin/electron tests/electron-smoke.cjs` tests the real interface using a temporary vault.

The desktop app is in `src/` and `ui/`. `src/team-client.cjs` handles the shared catalog; `src/sheet-profiles.cjs` maps active account-sheet rows to stable profile IDs and proxy settings. `server/` contains the authenticated backend. `deploy/profile-desk.yaml` describes the separate deployment in the existing GKE cluster.

Server environment variables: `STORAGE_KEY` (32-byte hex encryption key), `TEAM_TOKEN`, `ADMIN_TOKEN`, `SHEET_URL` (including the account tab gid), and optionally `DATA_DIR`/`PORT`. Get credentials through the project owner; do not commit them. Browser-session transfer routes are disabled until that feature is completed and tested.

Each colleague enters the workspace key once in the app. It is stored in the existing Keychain-encrypted vault, never bundled in installers. Production keys belong in private server configuration outside this repository. Never include administrator or storage encryption keys in the app.

Names, folders and proxy credentials come from the account sheet on the server; sheet polling runs every five minutes. Installed apps refresh their catalog every ten seconds. Browser cookies/storage remain local in this version. New shared profiles and proxy changes propagate between Macs. A changed spreadsheet proxy replaces its previous value; a manual proxy override persists until the spreadsheet proxy changes again.

Keep the Electron application name `Profile Desk` and bundle ID `local.profiledesk.app` to preserve the existing Keychain and vault identity. Changes to the product's visible name must not change its data location.
