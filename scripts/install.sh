#!/bin/bash
# Private team installer. GitHub credentials stay in the user's gh credential store.
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"
REPO=ortusclub/ortus-profile-desk-team
APP='Ortus Profile Desk.app'
install_dir=''; launch=yes
while [[ $# -gt 0 ]]; do
  case "$1" in
    --directory) install_dir="${2:?Provide an absolute installation directory}"; shift 2;;
    --no-open) launch=no; shift;;
    *) echo "Unknown argument: $1"; exit 1;;
  esac
done
if [[ -n "$install_dir" && "$install_dir" != /* ]]; then echo 'Installation directory must be absolute.'; exit 1; fi
if ! command -v gh >/dev/null; then
  if command -v brew >/dev/null; then brew install gh
  else echo 'Install GitHub CLI from https://cli.github.com, then run this command again.'; exit 1; fi
fi
gh auth status >/dev/null 2>&1 || gh auth login --hostname github.com --web --git-protocol https
if pgrep -f '/Ortus Profile Desk.app/Contents/MacOS/' >/dev/null; then
  echo 'Quit Ortus Profile Desk before installing. Your saved profiles will be kept.'; exit 1
fi
work=$(mktemp -d "${TMPDIR:-/tmp}/ortus-install.XXXXXXXX")
mount="$work/mount"
cleanup() { if mount | /usr/bin/grep -F " on $mount " >/dev/null; then hdiutil detach "$mount" -quiet || true; fi; rm -rf "$work"; }
trap cleanup EXIT
metadata=$(gh api "repos/$REPO/releases/latest" --jq '[.tag_name, (.assets[] | select(.name == "Ortus-Profile-Desk-universal.dmg") | .digest)] | join(" ")')
read -r tag digest <<< "$metadata"
[[ "$tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ && "$digest" =~ ^sha256:[a-f0-9]{64}$ ]] || { echo 'No verified team installer is published yet.'; exit 1; }
echo "Downloading Ortus Profile Desk $tag…"
gh release download "$tag" --repo "$REPO" --pattern 'Ortus-Profile-Desk-universal.dmg' --dir "$work"
actual=$(shasum -a 256 "$work/Ortus-Profile-Desk-universal.dmg" | cut -d ' ' -f 1)
[[ "sha256:$actual" == "$digest" ]] || { echo 'Download verification failed.'; exit 1; }
hdiutil attach "$work/Ortus-Profile-Desk-universal.dmg" -readonly -nobrowse -mountpoint "$mount" -quiet
codesign --verify --deep --strict "$mount/$APP"
[[ "$(/usr/libexec/PlistBuddy -c 'Print CFBundleIdentifier' "$mount/$APP/Contents/Info.plist")" == local.profiledesk.app ]]
[[ "$(/usr/libexec/PlistBuddy -c 'Print CFBundleShortVersionString' "$mount/$APP/Contents/Info.plist")" == "${tag#v}" ]]
# Use a writable Applications directory without requesting administrator access.
if [[ -n "$install_dir" ]]; then target="$install_dir"; mkdir -p "$target"
elif [[ -d "/Applications/$APP" ]]; then
  target=/Applications
  [[ -w "$target/$APP" && -w "$target" ]] || { echo 'An administrator must update the existing /Applications installation.'; exit 1; }
elif [[ -d "$HOME/Applications/$APP" ]]; then target="$HOME/Applications"
elif [[ -w /Applications ]]; then target=/Applications
else target="$HOME/Applications"; mkdir -p "$target"; fi
staging=$(mktemp -d "$target/.ortus-install.XXXXXXXX")
ditto "$mount/$APP" "$staging/$APP"
codesign --verify --deep --strict "$staging/$APP"
if [[ -e "$target/$APP" ]]; then mv "$target/$APP" "$staging/Previous.app"; fi
if ! mv "$staging/$APP" "$target/$APP"; then
  if [[ -d "$staging/Previous.app" ]]; then mv "$staging/Previous.app" "$target/$APP"; fi
  echo 'Installation failed; previous app restored.'; exit 1
fi
rm -rf "$staging"
echo 'Installed. Saved profiles were preserved. Opening Ortus Profile Desk…'
if [[ "$launch" == yes ]]; then open "$target/$APP"; fi
