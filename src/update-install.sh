#!/bin/bash
set -euo pipefail
parent="$1"; source_app="$2"; destination="$3"; staging="$4"
# Never replace the running application or terminate browser sessions.
for ((i=0; i<120; i++)); do
  if ! kill -0 "$parent" 2>/dev/null; then break; fi
  sleep 1
done
if kill -0 "$parent" 2>/dev/null; then exit 1; fi
/usr/bin/codesign --verify --deep --strict "$source_app"
previous="$staging/Previous.app"
mv "$destination" "$previous"
if ! mv "$source_app" "$destination"; then mv "$previous" "$destination"; exit 1; fi
/usr/bin/open "$destination"
# Retain the previous build until the next successful preparation for recovery.
