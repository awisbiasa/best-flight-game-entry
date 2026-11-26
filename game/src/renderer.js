// The renderer: one frame of the world, in painter's order. The sky and its haze go down first, then
// the cloud deck, then the ground in two grids (coarse and fine), then the runway and the base, the
// mission's props, the rounds, the aircraft, the effects and finally the glass of the HUD. Every
// polygon comes from the shared camera in mathkit; there is no drawing library and no image asset.

import { rebuildCamera, createCamera } from './mathkit.js';
import { paintSky, paintClouds, paintTerrain, paintRunway, paintBuildings, paintGroundMarks, nearBaseBuildings, project } from './terrainrender.js';
import { drawAircraft, drawPuff, drawDebris } from './aircraftrender.js';
import { drawGate, drawHulk, drawWaypointCue } from './props.js';
import { drawHud } from './hud.js';

/** The starting world clock: the frame the screenshots show, and every new game's starting time. */
export const SORTIE_CLOCK = 9.6;

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d', { alpha: false });
  const cam = createCamera();
  const buildings = nearBaseBuildings();
  return { ctx, canvas, width: canvas.width, height: canvas.height, cam, buildings };
}

/** The crate a cloud deck is built from: flat bases at a fixed altitude, drifting slowly. */
export function createCloudDeck(seedRandom) {
  const clouds = [];
  for (let i = 0; i < 46; i += 1) {
    const x = seedRandom.range(-2600, 3200);
    const z = seedRandom.range(-2400, 2400);
    const y = seedRandom.range(330, 620);
    clouds.push({ position: [x, y, z], size: seedRandom.range(90, 260), drift: seedRandom.range(-0.3, 0.3) });
  }
  return clouds;
}

/**
 * Draw one frame. `view` holds what the renderer needs beyond the world: the camera pose (already
 * smoothed by camera.js), the clouds, the sun's azimuth, the transient call-outs and the objective.
 */
export function drawFrame(renderer, world, view) {
  const { ctx, width, height, cam } = renderer;
  const aircraft = world.aircraft;
  const pose = view.pose;
  // The camera is rebuilt once per frame here; the HUD reads the same object, so the ladder and the
  // painted horizon can never disagree.
  rebuildCamera(cam, pose.eye, pose.yaw, pose.pitch, pose.roll);

  ctx.save();
  paintSky(renderer, cam, view.sunAzimuth, world.impactFlash);
  paintClouds(renderer, cam, view.clouds, world.time + SORTIE_CLOCK);
  paintTerrain(renderer, cam, world.terrain);
  paintRunway(renderer, cam, world.runway);
  paintGroundMarks(renderer, cam);
  paintBuildings(renderer, cam, renderer.buildings);

  // --- Mission props: the gates of the gate run, the range hulk, and the waypoint cue.
  for (const gate of world.gates) drawGate(renderer, cam, gate, world.time + SORTIE_CLOCK);
  if (world.missionState && world.missionState.hulk) drawHulk(renderer, cam, world.missionState.hulk, world.time + SORTIE_CLOCK);
  if (view.waypoint) drawWaypointCue(renderer, cam, view.waypoint.point, world.time + SORTIE_CLOCK, view.waypoint.label);

  // --- Rounds: short bright tracers from last frame's point to this one.
  ctx.lineCap = 'round';
  for (const round of world.rounds) {
    const a = project(cam, round.previous);
    const b = project(cam, round.position);
    if (!a || !b) continue;
    ctx.strokeStyle = 'rgba(255,232,150,0.9)';
    ctx.lineWidth = Math.max(1, 2.2 * b.k * 3);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,250,220,0.95)';
    ctx.beginPath();
    ctx.arc(b.x, b.y, Math.max(1, b.k * 1.4), 0, Math.PI * 2);
    ctx.fill();
  }

  // --- The aircraft, unless the camera is inside the cockpit.
  const insideCockpit = view.cockpit;
  if (!insideCockpit) drawAircraft(renderer, cam, aircraft, world.firedThisFrame);

  // --- Effects: smoke first so the aircraft's own sparks sit over it, then debris.
  for (const puff of world.puffs) drawPuff(renderer, cam, puff);
  for (const piece of world.debris) drawDebris(renderer, cam, piece);
  if (world.wreck && world.wreck.time < 40) drawWreckFire(renderer, cam, world.wreck, world.time);

  ctx.restore();

  // --- The glass. The HUD goes over everything, in screen space, except on the menus.
  if (view.hud) drawHud(renderer, aircraft, view.hud);
  if (view.vignette) paintVignette(renderer, world);
  void width;
  void height;
}

/** The wreck's fire: a few flickering flames at the impact point, for the first seconds only. */
function drawWreckFire(renderer, cam, wreck, time) {
  const { ctx } = renderer;
  const p = project(cam, wreck.position);
  if (!p) return;
  const r = Math.max(2, 7 * p.k);
  const flicker = 0.55 + 0.45 * Math.abs(Math.sin(time * 17 + wreck.time * 3));
  const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 4);
  glow.addColorStop(0, `rgba(255,236,190,${0.85 * flicker})`);
  glow.addColorStop(0.3, `rgba(255,158,60,${0.6 * flicker})`);
  glow.addColorStop(1, 'rgba(200,80,30,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(p.x - r * 4, p.y - r * 4, r * 8, r * 8);
}

/** A soft dark edge and a speed vignette: the frame feels like a view through a helmet visor. */
function paintVignette(renderer, world) {
  const { ctx, width, height } = renderer;
  const speed = world.aircraft.speed / 150;
  const grad = ctx.createRadialGradient(width / 2, height / 2, height * 0.45, width / 2, height / 2, height * 0.92);
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(1, `rgba(6,10,16,${0.22 + speed * 0.18})`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);
}
