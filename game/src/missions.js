// The mission scripts and the menu that chooses them. A mission owns its gates, its target, its
// objective text and its clock, and it decides when a sortie is won; the world keeps the plane flying
// and the effects. What each one asks of the pilot is different on purpose:
//
//  - Gate Run threads nine canyon rings in order against the clock, low where the walls pinch.
//  - Canyon Strike flies the valley to its far end, climbs the pass, and puts cannon rounds into the
//    range hulk from a low, fast run-in: the approach is the hard part.
//  - Field Landing climbs over the ridge, comes back through the saddle, and puts the plane on the
//    Fernhollow tar wings level, nose up and under 165 km/h.

import { RANGE, terrainHeight } from './terrain.js';
import { addDebrisBurst, addSmoke } from './world.js';

const DEG = Math.PI / 180;

/** A gate: a ring of world radius `radius` centred at (x, y, z), counted once when passed. */
function gateRing(x, y, z, radius, index) {
  return { x, y, z, radius, index, passed: false };
}

export const MISSION_GATE_RUN = {
  id: 'gates',
  name: 'GATE RUN',
  subtitle: 'Nine canyon gates against the clock',
  clock: 210,
  seed: 'gates',
  briefing: 'Out of Fernhollow and down the valley, threading all nine rings in order. The line runs low through the first bend and climbs over the saddle; a cut corner leaves the next ring behind the wall. Clean lines are fast lines, and the tank is the clock that never stops.',
  start(world) {
    const line = [
      [240, -290, 92, 16],
      [470, -40, 88, 15],
      [570, 260, 92, 15],
      [830, 500, 80, 15],
      [1180, 600, 78, 15],
      [1410, 370, 72, 16],
      [1500, -70, 70, 17],
      [1330, -320, 82, 15],
      [1060, -450, 94, 17],
    ];
    world.gates = line.map(([x, z, y, r], i) => gateRing(x, y, z, r, i));
    world.missionState = { next: 0, time: 0, splits: [] };
    world.mission.objectiveOf = () => ({
      title: `GATE ${Math.min(world.missionState.next + 1, 9)} OF 9`,
      detail: `Thread the lit ring. ${Math.max(0, Math.ceil(210 - world.missionState.time))} s on the clock.`,
    });
    world.mission.waypointOf = () => {
      const g = world.gates[world.missionState.next];
      return g ? { point: [g.x, g.y, g.z], label: `GATE ${g.index + 1}` } : null;
    };
  },
  update(world, dt) {
    const s = world.missionState;
    s.time += dt;
    const gate = world.gates[s.next];
    if (!gate) return;
    const p = world.aircraft.position;
    if (Math.hypot(p[0] - gate.x, p[1] - gate.y, p[2] - gate.z) < gate.radius * 1.25) {
      gate.passed = true;
      s.splits.push(s.time);
      s.next += 1;
      world.score += 100;
      // A ring of sparks where the gate was, so a good pass looks like one.
      for (let i = 0; i < 12; i += 1) {
        const a = (i / 12) * Math.PI * 2;
        world.debris.push({
          position: [gate.x + Math.cos(a) * gate.radius, gate.y + Math.sin(a) * gate.radius, gate.z],
          velocity: [Math.cos(a) * 2, Math.sin(a) * 2, 0],
          life: 0.8,
          spin: a,
          spinRate: 6,
          size: 0.35,
          warm: true,
        });
      }
      if (s.next >= world.gates.length) {
        world.score += 300;
        world.outcome = { kind: 'cleared', text: `ALL NINE GATES IN ${s.time.toFixed(1)} s`, detail: 'Every ring on the line. Press R to fly it again.' };
      } else if (!world.outcome) {
        world.callout = { text: `GATE ${s.next} — ${s.time.toFixed(1)} s`, life: 1.6 };
      }
    }
  },
};

export const MISSION_STRIKE = {
  id: 'strike',
  name: 'CANYON STRIKE',
  subtitle: 'Cannon run on the range hulk',
  clock: 240,
  seed: 'strike',
  briefing: 'A target hulk sits on the hardpan at the valley\'s far end, past the saddle. Fly the canyon to the end, climb the pass, turn in and come at the hulk from the north at low altitude. Cannon rounds in the drum end it. One pass is a sortie; a second pass into the wall is a crash.',
  start(world) {
    const hulk = {
      position: [RANGE.x, RANGE.height + 2.4, RANGE.z],
      heading: 112 * DEG,
      hp: 100,
      length: 36,
      width: 11,
      height: 7,
      destroyed: false,
      burn: 0,
      smokeTimer: 0,
    };
    world.missionState = { hulk, time: 0 };
    world.mission.objectiveOf = () => ({
      title: 'STRIKE THE RANGE HULK',
      detail: hulk.destroyed ? 'Target destroyed. Turn for home.' : `Hold SPACE on the run. Target hull ${Math.max(0, Math.round(hulk.hp))}%.`,
    });
    world.mission.waypointOf = () => (hulk.destroyed ? null : { point: [hulk.position[0], hulk.position[1] + 3, hulk.position[2]], label: 'RANGE HULK' });
  },
  onRound(world, round) {
    const hulk = world.missionState.hulk;
    if (hulk.destroyed) return;
    const dx = round.position[0] - hulk.position[0];
    const dy = round.position[1] - (hulk.position[1] + 2.8);
    const dz = round.position[2] - hulk.position[2];
    if (Math.abs(dx) < hulk.length * 0.52 && Math.abs(dz) < hulk.width * 0.55 && Math.abs(dy) < hulk.height * 0.75) {
      hulk.hp = Math.max(0, hulk.hp - 4.2);
      world.hits += 1;
      addDebrisBurst(world, round.position, 4, true);
      round.life = 0;
      world.shake = Math.min(1, world.shake + 0.12);
      if (hulk.hp <= 0) {
        hulk.destroyed = true;
        hulk.burn = 1;
        world.score += 1000;
        world.outcome = { kind: 'cleared', text: 'RANGE HULK DESTROYED', detail: 'The drum is gone. Press R to fly another sortie.' };
        addDebrisBurst(world, hulk.position, 30, true);
        addSmoke(world, hulk.position, 8, true);
        world.impactFlash = 0.8;
      }
    }
  },
  update(world, dt) {
    const s = world.missionState;
    s.time += dt;
    const hulk = s.hulk;
    if (hulk.burn > 0) {
      hulk.burn = Math.max(0, hulk.burn - dt * 0.04);
      hulk.smokeTimer -= dt;
      if (hulk.smokeTimer <= 0 && world.puffs.length < 34) {
        hulk.smokeTimer = 0.22;
        addSmoke(world, hulk.position, 1, false);
      }
    }
  },
};

export const MISSION_LANDING = {
  id: 'landing',
  name: 'FIELD LANDING',
  subtitle: 'Over the ridge and home to the tar',
  clock: 300,
  seed: 'landing',
  briefing: 'The weather is closing and the tank is two-thirds gone. Climb out, cross the saddle to the north-east, turn and fly the Fernhollow approach: wings level, under 165 km/h, nose up, on the tar. Fast, low and flat puts the plane in a heap beside the numbers.',
  start(world) {
    world.missionState = { time: 0, landed: false, touchdown: null };
    world.mission.objectiveOf = () => ({
      title: world.missionState.landed ? 'RUNWAY SECURED' : 'LAND AT FERNHOLLOW',
      detail: world.missionState.landed ? `Down at ${world.missionState.touchdown.toFixed(0)} km/h. Brake with B.` : 'Runway 09 at 40 m: wings level, under 165 km/h, on the tar.',
    });
    world.mission.waypointOf = () => (world.missionState.landed ? null : { point: [world.runway.threshold[0], world.runway.threshold[1] + 2, world.runway.threshold[2]], label: 'RWY 09' });
    // The approach is what the mission is about, so the tank starts with the flight home in it.
    world.aircraft.fuel = 0.72;
  },
  update(world, dt) {
    const s = world.missionState;
    s.time += dt;
    if (s.landed) return;
    const a = world.aircraft;
    const local = world.runway.local(a.position[0], a.position[2]);
    const onTar = Math.abs(local.across) < world.runway.halfWidth - 1.5 && Math.abs(local.along) < world.runway.halfLength;
    if (a.onGround && onTar) {
      s.landed = true;
      s.touchdown = a.speed * 3.6;
      world.score += 1200 + Math.max(0, Math.round((165 - s.touchdown) * 6));
      world.outcome = { kind: 'cleared', text: 'A CLEAN LANDING', detail: `Down at ${s.touchdown.toFixed(0)} km/h on the tar. Press R for another approach.` };
    }
  },
};

export const MISSIONS = [MISSION_GATE_RUN, MISSION_STRIKE, MISSION_LANDING];

/** The mission whose script is running, by id, or the first one. */
export function missionById(id) {
  return MISSIONS.find((m) => m.id === id) || MISSIONS[0];
}
