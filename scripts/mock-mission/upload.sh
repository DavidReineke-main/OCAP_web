#!/usr/bin/env bash
# Uploads mock-mission.json.gz to a locally running ocap-webserver.
# Usage: ./upload.sh [host] [secret]
set -euo pipefail

HOST="${1:-http://localhost:5000}"
SECRET="${2:-change-me}"

curl -sS -X POST "$HOST/api/v1/operations/add" \
  -F "secret=$SECRET" \
  -F "worldName=altis" \
  -F "missionName=3D View Mock Mission" \
  -F "missionDuration=180" \
  -F "filename=mock_3d_mission" \
  -F "tag=test" \
  -F "file=@mock-mission.json.gz;type=application/gzip" \
  && echo "Uploaded. Open the recording list in the app to play it back."
