#!/usr/bin/env bash
# Uploads mock-mission-<world>.json.gz to a locally running ocap-webserver.
# Usage: ./upload.sh [host] [secret] [world]
#   secret: the server's "secret" from setting.json / OCAP_SECRET (not a file name)
set -euo pipefail

HOST="${1:-http://localhost:5000}"
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
  echo "Upload failed: $response" >&2
  echo "Usage: ./upload.sh [host] [secret] [world]  (secret = \"secret\" in setting.json / OCAP_SECRET)" >&2
  exit 1
fi
echo "Uploaded $FILE. Open the recording list in the app to play it back."
