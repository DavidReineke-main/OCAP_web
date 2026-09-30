#!/usr/bin/env bash
# Uploads mock-mission-<world>.json.gz to a locally running ocap-webserver.
# Usage: ./upload.sh [host] [secret] [world]
#   secret: the server's "secret" from setting.json / OCAP_SECRET (not a file name)
set -euo pipefail

# 127.0.0.1, not localhost: on macOS "localhost" tries ::1 first, where the
# AirPlay Receiver often owns port 5000 and answers 403 to everything.
HOST="${1:-http://127.0.0.1:5000}"
SECRET="${2:-change-me}"
WORLD="${3:-altis}"

FILE="mock-mission-$WORLD.json.gz"
if [[ ! -f "$FILE" ]]; then
  echo "Missing $FILE — run: node generate.mjs $WORLD" >&2
  exit 1
fi

# --fail-with-body: a rejected upload (e.g. wrong secret) must not look like success.
if ! response=$(curl -sS --fail-with-body -X POST "$HOST/api/v1/operations/add" \
  -F "secret=$SECRET" \
  -F "worldName=$WORLD" \
  -F "missionName=3D View Mock Mission ($WORLD)" \
  -F "missionDuration=180" \
  -F "filename=mock_3d_mission_$WORLD" \
  -F "tag=test" \
  -F "file=@$FILE;type=application/gzip"); then
  echo "Upload failed: ${response:-<empty response>}" >&2
  if [[ -z "$response" ]]; then
    server=$(curl -sI "$HOST/api/healthcheck" | tr -d '\r' | awk -F': ' 'tolower($1)=="server"{print $2}')
    echo "That reply did not come from ocap-webserver${server:+ (Server: $server)}." >&2
    echo "On macOS, port 5000 on localhost is often the AirPlay Receiver — use http://127.0.0.1:5000" >&2
    echo "or turn off System Settings > General > AirDrop & Handoff > AirPlay Receiver." >&2
  fi
  echo "Usage: ./upload.sh [host] [secret] [world]  (secret = \"secret\" in setting.json / OCAP_SECRET)" >&2
  exit 1
fi
echo "Uploaded $FILE. Open the recording list in the app to play it back."
