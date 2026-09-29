#!/usr/bin/env node
// Generates a mock OCAP mission (legacy JSON format) with a few ground units,
// a truck, a helicopter, and a plane flying at altitude — for local testing
// of the 3D map view (aircraft AGL/ASL, terrain tilt, unit markers).
//
// Usage:
//   node generate.mjs [worldName]
//
// Writes ./mock-mission.json.gz in the current directory.

import { gzipSync } from "node:zlib";
import { writeFileSync } from "node:fs";

const worldName = process.argv[2] ?? "altis";
const FPS = 1; // captureDelay: 1 second between frames
const FRAMES = 180; // 3 minutes of playback

// Small, generic coordinate range near a map's origin corner so it fits
// inside virtually any Arma world (smallest common maps are a few km).
const BASE = [2000, 2000];

// Recordings store ASL heights (the recorder uses getPosASL), so aircraft
// altitudes are given above ground and added to the terrain height below.
// This mirrors syntheticDEM() in cmd/gen-test-heightmap (minus its ±20 m
// jitter) so aircraft fly at their intended height over that test terrain.
// Ground units keep z = 0, which the 3D view treats as "on the ground".
const TERRAIN_WORLD_SIZE = 30720;
function syntheticGround(x, y) {
  const u = x / TERRAIN_WORLD_SIZE;
  const v = y / TERRAIN_WORLD_SIZE;
  let h = 180;
  h += 220 * Math.sin(u * 2 * Math.PI * 1.3 + 0.5) * Math.cos(v * 2 * Math.PI * 0.8);
  h += 120 * Math.sin(u * 2 * Math.PI * 3.1 + 1.7) * Math.sin(v * 2 * Math.PI * 2.4);
  h += 60 * Math.cos(u * 2 * Math.PI * 5.7) * Math.cos(v * 2 * Math.PI * 4.9 + 0.3);
  return Math.max(0, h);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function dirBetween(from, to) {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  return ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
}

// ---------------- Ground squad (4x WEST infantry) ----------------

const squadStart = [BASE[0], BASE[1]];
const squadEnd = [BASE[0] + 600, BASE[1] + 500];

function unitPositions({ offset, isPlayer, inVehicleUntilFrame, vehicleId }) {
  const positions = [];
  for (let f = 0; f < FRAMES; f++) {
    const t = f / (FRAMES - 1);
    const x = lerp(squadStart[0], squadEnd[0], t) + offset[0];
    const y = lerp(squadStart[1], squadEnd[1], t) + offset[1];
    const dir = dirBetween([x, y], [x + 1, y + 1]);
    const inVehicle = inVehicleUntilFrame && f < inVehicleUntilFrame ? vehicleId : 0;
    positions.push([[x, y, 0], Math.round(dir), 1, inVehicle, `Unit${offset[0]}`, isPlayer ? 1 : 0, 0, "Alpha", "WEST"]);
  }
  return positions;
}

const entities = [];
let id = 0;

// Player + 3 squad mates. Two ride the truck (vehicleId 100) for the first
// half of the mission, then dismount.
entities.push({
  id: id++,
  type: "unit",
  name: "Reineke",
  side: "WEST",
  group: "Alpha",
  isPlayer: 1,
  startFrameNum: 0,
  positions: unitPositions({ offset: [0, 0], isPlayer: true }),
  framesFired: Array.from({ length: 12 }, (_, i) => {
    const f = 40 + i * 3;
    const t = f / (FRAMES - 1);
    const x = lerp(squadStart[0], squadEnd[0], t) + 40;
    const y = lerp(squadStart[1], squadEnd[1], t) + 40;
    return [f, [x, y, 1.6]];
  }),
});
entities.push({
  id: id++,
  type: "unit",
  name: "Cooper",
  side: "WEST",
  group: "Alpha",
  isPlayer: 0,
  startFrameNum: 0,
  positions: unitPositions({ offset: [3, -2], isPlayer: false }),
});
entities.push({
  id: id++,
  type: "unit",
  name: "Diaz",
  side: "WEST",
  group: "Alpha",
  isPlayer: 0,
  startFrameNum: 0,
  positions: unitPositions({ offset: [-3, 3], isPlayer: false, inVehicleUntilFrame: 90, vehicleId: 100 }),
});
entities.push({
  id: id++,
  type: "unit",
  name: "Novak",
  side: "WEST",
  group: "Alpha",
  isPlayer: 0,
  startFrameNum: 0,
  positions: unitPositions({ offset: [-3, -3], isPlayer: false, inVehicleUntilFrame: 90, vehicleId: 100 }),
});

// ---------------- Truck (ground vehicle, id 100) ----------------

const truckId = 100;
{
  const positions = [];
  for (let f = 0; f < FRAMES; f++) {
    const t = f / (FRAMES - 1);
    const x = lerp(squadStart[0] - 5, squadEnd[0] - 5, t);
    const y = lerp(squadStart[1] - 5, squadEnd[1] - 5, t);
    const dir = Math.round(dirBetween([x, y], [x + 1, y + 1]));
    positions.push([[x, y, 0], dir, 1, [2, 3]]);
  }
  entities.push({
    id: truckId,
    type: "truck",
    name: "Alpha Truck",
    side: "WEST",
    startFrameNum: 0,
    positions,
  });
}

// ---------------- Helicopter (racetrack pattern, id 101) ----------------

{
  const center = [BASE[0] + 900, BASE[1] + 200];
  const radius = 350;
  const positions = [];
  for (let f = 0; f < FRAMES; f++) {
    const angle = (f / FRAMES) * Math.PI * 4; // two laps
    const x = center[0] + radius * Math.cos(angle);
    const y = center[1] + radius * Math.sin(angle);
    const z = syntheticGround(x, y) + 150 + 80 * Math.sin(f / 25); // 70-230m AGL
    const dir = Math.round(((angle + Math.PI / 2) * 180) / Math.PI) % 360;
    positions.push([[x, y, z], dir, 1, []]);
  }
  entities.push({
    id: id++,
    type: "heli",
    name: "Pelican 1-1",
    side: "WEST",
    startFrameNum: 0,
    positions,
  });
}

// ---------------- Plane (long flyby at altitude, id auto) ----------------

{
  const start = [BASE[0] - 1500, BASE[1] - 1000, 400];
  const end = [BASE[0] + 2500, BASE[1] + 1800, 420];
  const positions = [];
  for (let f = 0; f < FRAMES; f++) {
    const t = f / (FRAMES - 1);
    const x = lerp(start[0], end[0], t);
    const y = lerp(start[1], end[1], t);
    const z = syntheticGround(x, y) + lerp(start[2], end[2], t); // 400-420m AGL
    const dir = Math.round(dirBetween([x, y], [x + 1, y + (end[1] - start[1] > 0 ? 1 : -1)]));
    positions.push([[x, y, z], dir, 1, []]);
  }
  entities.push({
    id: id++,
    type: "plane",
    name: "Eagle 1",
    side: "WEST",
    startFrameNum: 0,
    positions,
  });
}

// ---------------- OPFOR contact (2 units, one gets killed) ----------------

const opforPos = [BASE[0] + 550, BASE[1] + 480];
const opforKilledFrame = 95;

const ivanovId = id++;
entities.push({
  id: ivanovId,
  type: "unit",
  name: "Ivanov",
  side: "EAST",
  group: "Bravo",
  isPlayer: 0,
  startFrameNum: 0,
  positions: Array.from({ length: FRAMES }, (_, f) => {
    const alive = f >= opforKilledFrame ? 0 : 1;
    return [[opforPos[0], opforPos[1], 0], 90, alive, 0, "Ivanov", 0, 0, "Bravo", "EAST"];
  }),
});
entities.push({
  id: id++,
  type: "unit",
  name: "Petrov",
  side: "EAST",
  group: "Bravo",
  isPlayer: 0,
  startFrameNum: 0,
  positions: Array.from({ length: FRAMES }, (_, f) => [
    [opforPos[0] + 15, opforPos[1] + 10, 0],
    90,
    1,
    0,
    "Petrov",
    0,
    0,
    "Bravo",
    "EAST",
  ]),
});

// ---------------- Events ----------------

const events = [
  [0, "connected", "Reineke"],
  [opforKilledFrame - 2, "hit", ivanovId, [0, "arifle_MX_F"], 42.3],
  [opforKilledFrame, "killed", ivanovId, [0, "arifle_MX_F"], 44.1],
];

const mission = {
  worldName,
  missionName: "3D View Mock Mission",
  missionAuthor: "mock-mission-generator",
  endFrame: FRAMES - 1,
  captureDelay: 1 / FPS,
  extensionVersion: "1.0.0-mock",
  addonVersion: "1.0.0-mock",
  entities,
  events,
  Markers: [],
  times: [],
};

const json = JSON.stringify(mission);
const gz = gzipSync(Buffer.from(json, "utf-8"));
writeFileSync("mock-mission.json.gz", gz);

console.log(`Wrote mock-mission.json.gz (${gz.length} bytes, ${entities.length} entities, ${FRAMES} frames, worldName="${worldName}")`);
