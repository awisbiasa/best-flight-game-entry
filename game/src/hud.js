// The HUD, drawn in screen space over the world: the pitch ladder and the flight-path marker, the
// heading ribbon, the airspeed and altitude tapes with their trend needles, and the lower-left
// cluster with throttle, fuel, hull and gear. The style is a lit glass panel: warm amber for the
// primary numbers, mint for secondary, a dark pane behind each block so the digits stay readable over
// snow and cloud. Every number comes from the aircraft's own state, never a fixed picture, so the
// instruments read as flown rather than drawn.

import { PROJECT } from './mathkit.js';

const AMBER = 'rgba(255,198,104,';
const MINT = 'rgba(146,238,196,';
const GLASS = 'rgba(196,222,240,';
const RED = 'rgba(255,98,86,';
const PANE = 'rgba(9,15,23,0.54)';
const FONT = '"Courier New", "DejaVu Sans Mono", monospace';

function pane(ctx, x, y, w, h, radius) {
  ctx.fillStyle = PANE;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, radius);
  ctx.fill();
  ctx.strokeStyle = 'rgba(170,206,230,0.2)';
  ctx.lineWidth = 1;
  ctx.stroke();
}

function label(ctx, s, x, y, size, colour, align = 'center', weight = 'bold') {
  ctx.font = `${weight} ${size}px ${FONT}`;
  ctx.fillStyle = colour;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillText(s, x, y);
}

/** The whole HUD in one call; `view` adds the horizon, call-outs and the mission objective. */
export function drawHud(renderer, aircraft, view) {
  const { ctx, width, height } = renderer;
  // The camera the frame was painted with; if a caller passes no camera the ladder simply sits level.
  const cam = view.cam || { pitch: aircraft.pitch };
  const heading = ((Math.atan2(aircraft.forward[0], aircraft.forward[2]) * 180) / Math.PI + 360) % 360;
  const midY = 172;
  const tapeH = 300;

  // --- Airspeed tape, left. The window shows the value; the ticks scroll past it.
  pane(ctx, 26, midY, 136, tapeH + 44, 8);
  drawTape(ctx, 26, midY, 136, tapeH, Math.round(aircraft.speed * 3.6), 20, 100, 'km/h', 'AIRSPEED');
  if (aircraft.stallWarning > 0.25) {
    const blink = 0.55 + 0.4 * Math.sin(aircraft.time * 16);
    ctx.fillStyle = RED + blink + ')';
    ctx.fillRect(28, midY + tapeH - 42, 132, 22);
    label(ctx, 'STALL', 94, midY + tapeH - 31, 15, 'rgb(24,10,10)');
  }

  // --- Altitude tape, right, with the radar height beneath it.
  pane(ctx, width - 162, midY, 136, tapeH + 44, 8);
  drawTape(ctx, width - 162, midY, 136, tapeH, Math.round(aircraft.position[1] * 3.281), 100, 1000, 'ft', 'ALTITUDE', false);
  label(ctx, `AGL ${Math.round(Math.max(0, aircraft.agl) * 3.281)}`, width - 94, midY + tapeH + 18, 12, MINT + '0.9)');

  // --- Vertical speed, between the altitude tape and the frame's edge.
  const climb = Math.sin(aircraft.pitch) * aircraft.speed;
  label(ctx, `${climb >= 0 ? '+' : ''}${Math.round(climb * 196.85)}`, width - 24, midY + tapeH / 2, 12, GLASS + '0.75)', 'right', 'normal');

  // --- Heading ribbon across the top and the heading readout under it.
  pane(ctx, PROJECT.cx - 230, 16, 460, 46, 8);
  drawHeadingRibbon(ctx, PROJECT.cx, 40, 460, heading);
  label(ctx, `${heading.toFixed(0).padStart(3, '0')}°`, PROJECT.cx, 76, 20, AMBER + '0.95)');

  // --- The pitch ladder, banked with the plane around the panel's centre, offset by the camera's
  // pitch so the ladder's horizon agrees with the painted one.
  ctx.save();
  ctx.translate(PROJECT.cx, PROJECT.cy);
  ctx.rotate(aircraft.bank);
  const rise = (Math.tan(aircraft.pitch) - Math.tan(cam.pitch)) * PROJECT.focal;
  ctx.translate(0, Math.max(-220, Math.min(220, rise)) * 0.8);
  ctx.lineWidth = 1.6;
  for (let deg = -35; deg <= 35; deg += 5) {
    if (deg === 0) continue;
    const y = -deg * 13;
    const major = deg % 10 === 0;
    const w = major ? 58 : 30;
    ctx.strokeStyle = GLASS + (major ? '0.56)' : '0.3)');
    ctx.beginPath();
    ctx.moveTo(-w, y);
    ctx.lineTo(-w * 0.42, y);
    ctx.lineTo(-w * 0.42, y + (deg > 0 ? 5 : -5));
    ctx.moveTo(w, y);
    ctx.lineTo(w * 0.42, y);
    ctx.lineTo(w * 0.42, y + (deg > 0 ? 5 : -5));
    ctx.stroke();
    if (major) {
      label(ctx, String(Math.abs(deg)), -w - 14, y, 11, GLASS + '0.5)', 'right');
      label(ctx, String(Math.abs(deg)), w + 14, y, 11, GLASS + '0.5)', 'left');
    }
  }
  // The horizon line, broken in the middle so the datum is clear.
  ctx.strokeStyle = MINT + '0.8)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-170, 0);
  ctx.lineTo(-46, 0);
  ctx.moveTo(46, 0);
  ctx.lineTo(170, 0);
  ctx.stroke();
  ctx.restore();

  // --- The flight-path marker: where the nose points, a winged caret in amber.
  const markerY = PROJECT.cy + (Math.tan(aircraft.pitch) - Math.tan(cam.pitch)) * PROJECT.focal * 0.8 * 0 - 6;
  ctx.strokeStyle = AMBER + '0.95)';
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  ctx.moveTo(PROJECT.cx - 30, markerY);
  ctx.lineTo(PROJECT.cx - 12, markerY);
  ctx.lineTo(PROJECT.cx - 7, markerY + 6);
  ctx.moveTo(PROJECT.cx + 30, markerY);
  ctx.lineTo(PROJECT.cx + 12, markerY);
  ctx.lineTo(PROJECT.cx + 7, markerY + 6);
  ctx.stroke();
  ctx.fillStyle = AMBER + '0.95)';
  ctx.beginPath();
  ctx.arc(PROJECT.cx, markerY, 3.2, 0, Math.PI * 2);
  ctx.fill();

  // --- Lower-left cluster: throttle, fuel, hull bars; gear lamp; the g load; hull segments.
  const cy = height - 136;
  pane(ctx, 24, cy, 420, 118, 8);
  drawBar(ctx, 38, cy + 14, 120, 9, aircraft.throttle, AMBER + '0.92)', `THROTTLE ${Math.round(aircraft.throttle * 100)}%`);
  drawBar(ctx, 38, cy + 40, 120, 9, aircraft.fuel, aircraft.fuel < 0.18 ? RED + '0.95)' : MINT + '0.86)', `FUEL ${Math.round(aircraft.fuel * 100)}%`);
  drawBar(ctx, 38, cy + 66, 120, 9, aircraft.hull / 100, aircraft.hull < 45 ? RED + '0.95)' : MINT + '0.86)', `HULL ${Math.round(aircraft.hull)}%`);
  // Gear lamp and cannon lamp.
  const gearOn = aircraft.gearDown;
  ctx.strokeStyle = gearOn ? MINT + '0.95)' : GLASS + '0.3)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(196, cy + 26, 10, 0, Math.PI * 2);
  ctx.stroke();
  label(ctx, 'G', 196, cy + 26, 12, gearOn ? MINT + '0.95)' : GLASS + '0.4)');
  label(ctx, gearOn ? 'GEAR DOWN' : 'GEAR UP', 214, cy + 26, 11, gearOn ? MINT + '0.9)' : GLASS + '0.5)', 'left');
  const firing = aircraft.time - (view.lastFire || -9) < 0.2;
  ctx.fillStyle = firing ? AMBER + '0.9)' : GLASS + '0.22)';
  ctx.beginPath();
  ctx.arc(196, cy + 54, 5, 0, Math.PI * 2);
  ctx.fill();
  label(ctx, 'CANNON', 212, cy + 54, 11, AMBER + (firing ? '0.95)' : '0.4)'), 'left');
  label(ctx, `G ${aircraft.gLoad.toFixed(1)}`, 300, cy + 24, 12, GLASS + '0.72)', 'left');
  label(ctx, aircraft.onGround ? 'ON WHEELS' : `${Math.round(Math.max(0, aircraft.agl))} m AGL`, 300, cy + 44, 11, GLASS + '0.6)', 'left', 'normal');
  for (let i = 0; i < 10; i += 1) {
    const lit = i < Math.ceil(aircraft.hull / 10);
    ctx.fillStyle = lit ? (aircraft.hull < 45 ? RED + '0.9)' : MINT + '0.7)') : 'rgba(120,132,144,0.22)';
    ctx.fillRect(38 + i * 12, cy + 92, 10, 7);
  }
  label(ctx, 'AIRFRAME', 168, cy + 95, 9, GLASS + '0.4)', 'left', 'normal');

  // --- The mission objective, above the cluster.
  if (view.objective) {
    pane(ctx, 24, cy - 66, 420, 58, 8);
    label(ctx, view.objective.title, 38, cy - 45, 14, AMBER + '0.95)', 'left');
    label(ctx, view.objective.detail, 38, cy - 25, 11, GLASS + '0.82)', 'left', 'normal');
  }

  // --- Centre call-outs: the pull-up warning, the mission toast, the outcome banner.
  if (view.pullUp) {
    const blink = 0.6 + 0.3 * Math.sin(aircraft.time * 18);
    ctx.fillStyle = RED + blink + ')';
    ctx.fillRect(PROJECT.cx - 112, height * 0.3 - 18, 224, 36);
    label(ctx, 'PULL UP', PROJECT.cx, height * 0.3, 21, 'rgb(24,8,8)');
  }
  if (view.callout && view.callout.life > 0) {
    label(ctx, view.callout.text, PROJECT.cx, height * 0.745, 20, AMBER + Math.min(1, view.callout.life) + ')');
  }
}

/** One vertical tape: the value in a window, ticks and numerals scrolling past, and the unit below. */
function drawTape(ctx, x, y, w, h, value, minor, major, unit, title, rising = true) {
  const windowH = 68;
  const mid = y + h * 0.5 + 6;
  const pixelsPerMinor = 14;
  label(ctx, title, x + w / 2, y + 18, 11, GLASS + '0.55)');
  ctx.save();
  ctx.beginPath();
  ctx.rect(x + 4, y + 30, w - 8, h - 34);
  ctx.clip();
  const first = Math.floor((value - (h / 2 / pixelsPerMinor) * minor) / minor) * minor;
  const last = value + (h / 2 / pixelsPerMinor) * minor;
  for (let v = first; v <= last; v += minor) {
    if (v < 0) continue;
    const py = mid + (rising ? (value - v) : -(value - v)) * (pixelsPerMinor / minor);
    const isMajor = v % major === 0;
    ctx.strokeStyle = isMajor ? GLASS + '0.7)' : GLASS + '0.26)';
    ctx.lineWidth = isMajor ? 2 : 1;
    ctx.beginPath();
    ctx.moveTo(x + 6, py);
    ctx.lineTo(x + (isMajor ? 26 : 16), py);
    ctx.stroke();
    if (isMajor) label(ctx, String(v), x + w - 8, py, 12, GLASS + '0.78)', 'right', 'normal');
  }
  ctx.restore();
  ctx.fillStyle = 'rgba(5,9,15,0.9)';
  ctx.fillRect(x + 2, mid - windowH / 2, w - 4, windowH);
  ctx.strokeStyle = AMBER + '0.85)';
  ctx.lineWidth = 1.6;
  ctx.strokeRect(x + 2, mid - windowH / 2, w - 4, windowH);
  label(ctx, String(Math.round(value)), x + w / 2, mid - 6, 24, AMBER + '0.98)');
  label(ctx, unit, x + w / 2, mid + 19, 11, AMBER + '0.72)');
}

/** The compass ribbon: ticks every five degrees, letters at the cardinals, a caret under the value. */
function drawHeadingRibbon(ctx, cx, cy, w, hdg) {
  const pxPerDeg = w / 92;
  const first = Math.floor((hdg - 46) / 5) * 5;
  for (let d = first; d <= hdg + 46; d += 5) {
    const x = cx + (d - hdg) * pxPerDeg;
    if (x < cx - w / 2 + 8 || x > cx + w / 2 - 8) continue;
    const norm = ((d % 360) + 360) % 360;
    const major = norm % 30 === 0;
    ctx.strokeStyle = GLASS + (major ? '0.78)' : '0.32)');
    ctx.lineWidth = major ? 2 : 1;
    ctx.beginPath();
    ctx.moveTo(x, cy - 4);
    ctx.lineTo(x, cy - (major ? 20 : 12));
    ctx.stroke();
    if (major) {
      const cardinal = norm === 0 ? 'N' : norm === 90 ? 'E' : norm === 180 ? 'S' : norm === 270 ? 'W' : String(norm / 10).padStart(2, '0');
      const isCardinal = norm % 90 === 0;
      label(ctx, cardinal, x, cy + 2, 12, isCardinal ? MINT + '0.95)' : GLASS + '0.72)', 'center', 'bold');
    }
  }
  ctx.fillStyle = AMBER + '0.95)';
  ctx.beginPath();
  ctx.moveTo(cx - 6, cy + 16);
  ctx.lineTo(cx + 6, cy + 16);
  ctx.lineTo(cx, cy + 8);
  ctx.closePath();
  ctx.fill();
}

/** A labelled horizontal bar reading left to right, with its caption under it. */
function drawBar(ctx, x, y, w, h, fraction, colour, caption) {
  ctx.fillStyle = 'rgba(130,150,168,0.2)';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = colour;
  ctx.fillRect(x, y, w * Math.max(0, Math.min(1, fraction)), h);
  label(ctx, caption, x, y + h + 11, 11, GLASS + '0.74)', 'left', 'normal');
}
