#!/usr/bin/env bash
# Uploads mock-mission-<world>.json.gz to a locally running ocap-webserver.
# Usage: ./upload.sh [host] [secret] [world]
set -euo pipefail

HOST="${1:-http://localhost:5000}"
SECRET="${2:-change-me}"
WORLD="${3:-altis}"

curl -sS -X POST "$HOST/api/v1/operations/add" \
  -F "secret=$SECRET" \
  -F "worldName=$WORLD" \
  -F "missionName=3D View Mock Mission ($WORLD)" \
  -F "missionDuration=180" \
  -F "filename=mock_3d_mission_$WORLD" \
  -F "tag=test" \
  -F "file=@mock-mission-$WORLD.json.gz;type=application/gzip" \
  && echo "Uploaded. Open the recording list in the app to play it back."
