// Target props the renderer paints besides the terrain: the gate rings of the gate run (billboard
// torches that glow amber for the next ring and go cold once passed), the range hulk with its drum
// and beacon, and the flight-path cue that points at the next gate from a distance.

import { PROJECT } from './mathkit.js';

function project(cam, p) {
  const dx = p[0] - cam.eye[0];
  const dy = p[1] - cam.eye[1];
  const dz = p[2] - cam.eye[2];
  const depth = dx * cam.fwd[0] + dy * cam.fwd[1] + dz * cam.fwd[2];
  if (depth < 1.2) return null;
  const x = dx * cam.right[0] + dy * cam.right[1] + dz * cam.right[2];
  const y = dx * cam.up[0] + dy * cam.up[1] + dz * cam.up[2];
  const k = PROJECT.focal / depth;
  return { x: PROJECT.cx + x * k, y: PROJECT.cy - y * k, depth, k };
}

/** A gate ring drawn as a torus billboard: two ellipses, misted inward rings and a torch glow. */
export function drawGate(painter, cam, gate, time) {
  const { ctx } = painter;
  const p = project(cam, [gate.x, gate.y, gate.z]);
  if (!p) return;
  const r = gate.radius * p.k;
  if (r < 3) return;
  const pulse = 0.72 + 0.28 * Math.sin(time * 3 + gate.index);
  const colour = gate.passed ? '150,160,170' : gate.active ? '255,196,84' : '96,206,232';
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(-cam.roll * 0.35);
  if (gate.active) {
    const glow = ctx.createRadialGradient(0, 0, r * 0.1, 0, 0, r * 1.5);
    glow.addColorStop(0, 'rgba(255,190,90,0)');
    glow.addColorStop(0.7, `rgba(255,180,80,${0.14 * pulse})`);
    glow.addColorStop(1, 'rgba(255,180,80,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(-r * 1.6, -r * 1.6, r * 3.2, r * 3.2);
  }
  ctx.strokeStyle = `rgba(${colour},${gate.passed ? 0.3 : 1})`;
  ctx.lineWidth = Math.max(3, r * 0.1);
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.stroke();
  // A broken inner ring, so the gate reads as a built frame rather than a drawn circle.
  ctx.strokeStyle = `rgba(${colour},${gate.passed ? 0.2 : 0.55})`;
  ctx.lineWidth = Math.max(1, r * 0.03);
  for (let i = 0; i < 8; i += 1) {
    const a0 = (i / 8) * Math.PI * 2 + 0.12;
    const a1 = a0 + 0.42;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.86, a0, a1);
    ctx.stroke();
  }
  // The gate number, in the middle of the ring.
  if (!gate.passed && r > 14) {
    ctx.fillStyle = `rgba(${colour},0.95)`;
    ctx.font = `bold ${Math.max(11, Math.round(r * 0.5))}px "Courier New", monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(gate.index + 1), 0, 0);
  }
  ctx.restore();
}

/**
 * The range hulk as a bombing-range facility: a long tracked hull with a striped drum at its centre,
 * six oil drums on the hardpan around it, a white/red range circle on the ground and a canvas
 * windsock mast, all placed on the camera's ground plane so the target reads from a run-in. The
 * drums and hull darken and burn once the hull is past its last hit point.
 */
export function drawHulk(painter, cam, hulk, time) {
  const { ctx } = painter;
  const p = project(cam, hulk.position);
  if (!p) return;
  const k = p.k;
  const sin = Math.sin(hulk.heading);
  const cos = Math.cos(hulk.heading);
  // The range ring on the ground, flat on the hardpan: three concentric ellipses, drawn first.
  const groundY = hulk.position[1] - 2.4;
  const centre = project(cam, [hulk.position[0], groundY, hulk.position[2]]);
  if (centre) {
    for (let i = 0; i < 3; i += 1) {
      const r = (26 + i * 16) * centre.k;
      ctx.strokeStyle = i % 2 === 0 ? 'rgba(222,214,196,0.5)' : 'rgba(186,70,52,0.55)';
      ctx.lineWidth = Math.max(1, 1.2 * centre.k * 2);
      ctx.beginPath();
      ctx.ellipse(centre.x, centre.y, r, Math.max(1, r * 0.3), 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  // Six oil drums round the hull, each a short lit cylinder.
  for (let i = 0; i < 6; i += 1) {
    const a = (i / 6) * Math.PI * 2 + 0.4;
    const q = project(cam, [hulk.position[0] + Math.cos(a) * 22, groundY + 1.6, hulk.position[2] + Math.sin(a) * 22]);
    if (!q) continue;
    const w = Math.max(1.5, 1.3 * q.k);
    ctx.fillStyle = hulk.destroyed ? 'rgb(56,44,40)' : 'rgb(176,140,92)';
    ctx.fillRect(q.x - w / 2, q.y - w * 1.3, w, w * 1.3);
    ctx.fillStyle = 'rgba(236,226,204,0.5)';
    ctx.fillRect(q.x - w / 2, q.y - w * 1.32, w, Math.max(1, w * 0.18));
  }
  const w = hulk.length * k;
  const h = hulk.height * k;
  // Projected hull direction as a screen angle: enough to give the hulk its lean.
  const tip = project(cam, [hulk.position[0] + sin * hulk.length, hulk.position[1], hulk.position[2] + cos * hulk.length]);
  const angle = tip ? Math.atan2(tip.y - p.y, tip.x - p.x) : 0;
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(angle);
  // Tracks first, then the hull sitting on them, then the drum.
  ctx.fillStyle = 'rgb(40,40,42)';
  ctx.fillRect(-w, h * 0.26, w * 2, Math.max(1.5, h * 0.2));
  ctx.fillStyle = hulk.destroyed ? 'rgb(52,46,42)' : 'rgb(78,84,82)';
  ctx.fillRect(-w, -h * 0.5, w * 2, h * 0.8);
  ctx.fillStyle = hulk.destroyed ? 'rgb(84,62,52)' : 'rgb(112,118,112)';
  ctx.fillRect(-w, -h * 0.6, w * 2, Math.max(1, h * 0.14));
  // The drum: a striped cylinder of the sort that marks a bombing range.
  ctx.fillStyle = hulk.destroyed ? 'rgb(76,54,46)' : 'rgb(198,86,58)';
  ctx.fillRect(-w * 0.24, -h * 1.25, w * 0.48, h * 0.75);
  ctx.fillStyle = 'rgba(240,234,218,0.92)';
  ctx.fillRect(-w * 0.24, -h * 1.12, w * 0.48, Math.max(1, h * 0.1));
  ctx.fillRect(-w * 0.24, -h * 0.86, w * 0.48, Math.max(1, h * 0.1));
  // A cab at the near end, so the hull reads as a tracked vehicle and not a slab.
  ctx.fillStyle = hulk.destroyed ? 'rgb(60,52,48)' : 'rgb(92,100,100)';
  ctx.fillRect(w * 0.42, -h * 1.1, w * 0.4, h * 0.6);
  ctx.fillStyle = 'rgb(150,200,214)';
  ctx.fillRect(w * 0.48, -h * 1.02, w * 0.2, Math.max(1, h * 0.22));
  ctx.restore();
  // The mast and windsock on the far side, a thin pole with a waving sock at the top.
  const mast = project(cam, [hulk.position[0] + cos * 26, groundY, hulk.position[2] - sin * 26]);
  if (mast) {
    const mh = 9 * mast.k;
    ctx.strokeStyle = 'rgba(220,220,214,0.8)';
    ctx.lineWidth = Math.max(1, 0.35 * mast.k);
    ctx.beginPath();
    ctx.moveTo(mast.x, mast.y);
    ctx.lineTo(mast.x, mast.y - mh);
    ctx.stroke();
    const wave = Math.sin(time * 2.2) * mh * 0.12;
    ctx.fillStyle = hulk.destroyed ? 'rgba(120,90,70,0.85)' : 'rgba(232,126,64,0.9)';
    ctx.beginPath();
    ctx.moveTo(mast.x, mast.y - mh);
    ctx.lineTo(mast.x + mh * 0.75, mast.y - mh + wave);
    ctx.lineTo(mast.x + mh * 0.75, mast.y - mh + wave + mh * 0.22);
    ctx.lineTo(mast.x, mast.y - mh + mh * 0.3);
    ctx.closePath();
    ctx.fill();
  }
  if (!hulk.destroyed) {
    const blink = Math.sin(time * 5) > 0.2;
    if (blink) {
      ctx.fillStyle = `rgba(255,70,60,${0.85 * Math.max(0, 1 - p.depth / 3000)})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y - h * 1.35, Math.max(1.6, 0.9 * k), 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/**
 * The waypoint cue: a small amber diamond pinned to the edge of the frame, or over the target when
 * it is in view, telling the pilot which way the next objective lies. It keeps the player from
 * losing the mission in a canyon with no other marker.
 */
export function drawWaypointCue(painter, cam, target, time, label) {
  const { ctx, width, height } = painter;
  if (!target) return;
  const p = project(cam, target);
  let x;
  let y;
  if (p && p.depth > 0 && p.x > 40 && p.x < width - 40 && p.y > 120 && p.y < height - 60) {
    x = p.x;
    y = p.y;
  } else {
    const rel = Math.atan2(target[0] - cam.eye[0], target[2] - cam.eye[2]) - cam.yaw;
    const angle = Math.atan2(Math.sin(rel), Math.cos(rel));
    x = PROJECT.cx + Math.max(-0.9, Math.min(0.9, angle)) * 360;
    y = 132;
  }
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(Math.PI / 4);
  ctx.fillStyle = 'rgba(255,190,90,0.9)';
  const s = 6 + Math.sin(time * 4) * 1.2;
  ctx.fillRect(-s / 2, -s / 2, s, s);
  ctx.restore();
  if (label) {
    ctx.fillStyle = 'rgba(255,196,96,0.85)';
    ctx.font = 'bold 11px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(label, x, y + 10);
  }
}
