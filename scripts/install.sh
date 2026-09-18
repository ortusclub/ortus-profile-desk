#!/bin/bash
# Public installer. Workspace access still requires a separately supplied key.
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
if pgrep -f '/Ortus Profile Desk.app/Contents/MacOS/' >/dev/null; then
  echo 'Quit Ortus Profile Desk before installing. Your saved profiles will be kept.'; exit 1
fi
work=$(mktemp -d "${TMPDIR:-/tmp}/ortus-install.XXXXXXXX")
mount="$work/mount"
attached=no
cleanup() {
  result=$?
  if [[ "$attached" == yes ]]; then
    if ! hdiutil detach "$mount" -quiet; then
      echo "Installation finished; eject the Ortus disk image in Finder to clean up $work."
      exit "$result"
    fi
  fi
  rm -rf "$work"
  exit "$result"
}
trap cleanup EXIT
curl -fsSL --proto '=https' --proto-redir '=https' --connect-timeout 20 --max-time 60 "https://github.com/$REPO/releases/latest/download/install.json" -o "$work/install.json"
version=$(/usr/bin/plutil -extract version raw -o - "$work/install.json")
sha=$(/usr/bin/plutil -extract sha256 raw -o - "$work/install.json")
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ && "$sha" =~ ^[a-f0-9]{64}$ ]] || { echo 'Installer metadata is invalid.'; exit 1; }
tag="v$version"; digest="sha256:$sha"
echo "Downloading Ortus Profile Desk ${tag}…"
curl -fL --proto '=https' --proto-redir '=https' --connect-timeout 20 --max-time 900 --progress-bar "https://github.com/$REPO/releases/download/$tag/Ortus-Profile-Desk-universal.dmg" -o "$work/Ortus-Profile-Desk-universal.dmg"
actual=$(shasum -a 256 "$work/Ortus-Profile-Desk-universal.dmg" | cut -d ' ' -f 1)
[[ "sha256:$actual" == "$digest" ]] || { echo 'Download verification failed.'; exit 1; }
hdiutil attach "$work/Ortus-Profile-Desk-universal.dmg" -readonly -nobrowse -mountpoint "$mount" -quiet
attached=yes
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
echo 'Installed. Saved profiles were preserved.'
if [[ "$launch" == yes ]]; then open "$target/$APP"; fi
