// The screen the game opens on: a sortie over the valley with the three missions laid over it, the
// selected one lit and its brief below. The menu is painted over a live frame of the world, so the
// cover shot is the game flying, not a title card; the sortie behind it is a short, scripted climb out
// of the home runway so it always looks the same at the same seed.

import { PROJECT } from './mathkit.js';

const AMBER = 'rgba(255,198,104,';
const GLASS = 'rgba(200,224,242,';
const FONT = '"Courier New", "DejaVu Sans Mono", monospace';
const TITLE_FONT = '"Trebuchet MS", "DejaVu Sans", "Segoe UI", sans-serif';

const CARD_W = 316;
const CARD_H = 96;
const CARD_Y = 396;
const CARD_GAP = 22;

function label(ctx, s, x, y, size, colour, align = 'center', weight = 'bold', font = FONT) {
  ctx.font = `${weight} ${size}px ${font}`;
  ctx.fillStyle = colour;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillText(s, x, y);
}

/** Screen rectangles of the three mission cards, for the mouse to hit-test. */
export function missionCardRects(renderer) {
  const total = CARD_W * 3 + CARD_GAP * 2;
  const left = (renderer.width - total) / 2;
  return [0, 1, 2].map((i) => ({ x: left + i * (CARD_W + CARD_GAP), y: CARD_Y, w: CARD_W, h: CARD_H, index: i }));
}

export function drawMissionMenu(renderer, missions, selected, time) {
  const { ctx, width } = renderer;
  const rects = missionCardRects(renderer);
  // A soft band at the top of the frame so the title reads over sky or wall alike.
  const top = ctx.createLinearGradient(0, 0, 0, 260);
  top.addColorStop(0, 'rgba(6,12,20,0.72)');
  top.addColorStop(1, 'rgba(6,12,20,0)');
  ctx.fillStyle = top;
  ctx.fillRect(0, 0, width, 260);
  const bottom = ctx.createLinearGradient(0, 340, 0, 720);
  bottom.addColorStop(0, 'rgba(6,12,20,0)');
  bottom.addColorStop(0.4, 'rgba(6,12,20,0.62)');
  bottom.addColorStop(1, 'rgba(6,12,20,0.88)');
  ctx.fillStyle = bottom;
  ctx.fillRect(0, 340, width, 380);

  // The title, with a hairline under it and the house line above it.
  label(ctx, 'AN ORIGINAL CANYON FLIGHT SIMULATION', width / 2, 52, 12, GLASS + '0.62)', 'center', 'normal');
  label(ctx, 'COLD FRONT', width / 2, 106, 58, 'rgb(246,242,232)', 'center', 'bold', TITLE_FONT);
  ctx.strokeStyle = AMBER + '0.9)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(width / 2 - 130, 144);
  ctx.lineTo(width / 2 + 130, 144);
  ctx.stroke();
  label(ctx, 'FERNMOOR VALLEY  ·  THREE SORTIES  ·  ONE AIRFRAME', width / 2, 166, 13, AMBER + '0.9)', 'center', 'normal');
  label(ctx, 'Take off on the tar, then fly what the brief asks.', width / 2, 196, 12, GLASS + '0.7)', 'center', 'normal');

  // The three cards: the selected one lit amber, the others dim until hovered.
  for (const rect of rects) {
    const mission = missions[rect.index];
    const on = rect.index === selected;
    ctx.fillStyle = on ? 'rgba(24,30,40,0.86)' : 'rgba(14,20,28,0.72)';
    ctx.beginPath();
    ctx.roundRect(rect.x, rect.y, rect.w, rect.h, 8);
    ctx.fill();
    ctx.strokeStyle = on ? AMBER + '0.95)' : GLASS + '0.28)';
    ctx.lineWidth = on ? 2 : 1;
    ctx.stroke();
    label(ctx, `0${rect.index + 1}`, rect.x + 24, rect.y + 26, 13, on ? AMBER + '0.95)' : GLASS + '0.45)', 'left');
    label(ctx, mission.name, rect.x + 24, rect.y + 50, 17, on ? 'rgb(248,244,236)' : GLASS + '0.8)', 'left');
    label(ctx, mission.subtitle, rect.x + 24, rect.y + 74, 11, GLASS + (on ? '0.72)' : '0.5)'), 'left', 'normal');
    if (on) {
      ctx.fillStyle = AMBER + '0.95)';
      ctx.fillRect(rect.x, rect.y + rect.h - 3, rect.w * (0.45 + 0.55 * Math.abs(Math.sin(time * 1.6))), 3);
    }
  }

  // The selected mission's brief, under the cards.
  const brief = missions[selected];
  const lines = wrap(ctx, brief.briefing, 880, 12);
  let y = CARD_Y + CARD_H + 34;
  for (const line of lines) {
    label(ctx, line, width / 2, y, 12.5, GLASS + '0.8)', 'center', 'normal');
    y += 19;
  }
  // The keys, in a row along the bottom.
  const keys = [
    ['W A S D / ARROWS', 'stick and pitch'],
    ['SHIFT / CTRL', 'throttle up / down'],
    ['SPACE', 'cannon'],
    ['B', 'wheel brakes'],
    ['V', 'cockpit / chase'],
    ['P', 'pause'],
  ];
  let x = (width - keys.length * 188) / 2 + 8;
  for (const [key, what] of keys) {
    ctx.strokeStyle = GLASS + '0.4)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x, 672, 178, 26);
    label(ctx, key, x + 89, 685, 10.5, AMBER + '0.92)', 'center');
    label(ctx, what, x + 89, 710, 10, GLASS + '0.55)', 'center', 'normal');
    x += 188;
  }
  label(ctx, 'PRESS SPACE TO FLY THE LIT SORTIE  ·  1 2 3 OR CLICK TO PICK', width / 2, 742, 13, AMBER + (0.7 + 0.3 * Math.abs(Math.sin(time * 2.2))) + ')');
}

/** A plain word wrap: the briefs are short, so a greedy wrap is all that is needed. */
function wrap(ctx, text, maxWidth, size) {
  ctx.font = `normal ${size}px ${FONT}`;
  const words = text.split(/\s+/);
  const lines = [];
  let line = '';
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** The banner a finished sortie shows: what happened, the score, and how to go again. */
export function drawOutcomeBanner(renderer, world) {
  const { ctx, width, height } = renderer;
  if (!world.outcome) return;
  const good = world.outcome.kind !== 'crash';
  const fade = Math.min(1, world.outcomeTimer * 1.6);
  ctx.fillStyle = `rgba(4,8,14,${0.55 * fade})`;
  ctx.fillRect(0, height * 0.26, width, 168);
  label(ctx, world.outcome.text, width / 2, height * 0.26 + 46, 34, good ? AMBER + fade + ')' : 'rgba(255,110,96,' + fade + ')', 'center', 'bold', TITLE_FONT);
  if (world.outcome.detail) label(ctx, world.outcome.detail, width / 2, height * 0.26 + 88, 14, GLASS + (0.85 * fade) + ')', 'center', 'normal');
  label(ctx, `SCORE ${world.score}   ·   R RESTART   ·   ESC MENU`, width / 2, height * 0.26 + 128, 13, GLASS + (0.7 * fade) + ')', 'center', 'normal');
}

export { PROJECT };
