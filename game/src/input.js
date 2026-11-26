// The keyboard and mouse: the pilot's hands. Keys are read every frame into one controls object,
// and one-shot presses (pause, restart, mission choice) are queued as actions so nothing is missed
// between frames. Holding several keys that ask for the opposite thing cancels out, so a pilot does
// not have to be exact; Shift and Control spool the throttle, Space is the cannon and the brakes.

const KEY_MAP = {
  ArrowLeft: 'rollLeft',
  KeyA: 'rollLeft',
  ArrowRight: 'rollRight',
  KeyD: 'rollRight',
  ArrowUp: 'pitchDown',
  KeyW: 'pitchDown',
  ArrowDown: 'pitchUp',
  KeyS: 'pitchUp',
  KeyQ: 'yawLeft',
  KeyE: 'yawRight',
  ShiftLeft: 'throttleUp',
  ShiftRight: 'throttleUp',
  ControlLeft: 'throttleDown',
  ControlRight: 'throttleDown',
  Space: 'fire',
  KeyB: 'brake',
  KeyF: 'flaps',
};

const ONE_SHOT = {
  KeyP: 'pause',
  Escape: 'pause',
  KeyR: 'restart',
  Enter: 'confirm',
  NumpadEnter: 'confirm',
  Digit1: 'mission1',
  Digit2: 'mission2',
  Digit3: 'mission3',
  KeyV: 'view',
  KeyH: 'help',
};

export function createInput(target, statusNode) {
  const held = Object.create(null);
  const actions = [];
  const mouse = { x: 640, y: 360, down: false, clicked: null };

  function announce(message) {
    if (statusNode) statusNode.textContent = message;
  }

  function onKey(event, down) {
    const fly = KEY_MAP[event.code];
    const shot = ONE_SHOT[event.code];
    if (!fly && !shot) return;
    if (event.code === 'Space' || event.code === 'Tab') event.preventDefault();
    if (fly) held[fly] = down;
    if (shot && down && !event.repeat) actions.push(shot);
    if (down && !event.repeat) announce(shot ? `${shot} pressed` : '');
  }

  window.addEventListener('keydown', (event) => onKey(event, true));
  window.addEventListener('keyup', (event) => onKey(event, false));
  window.addEventListener('blur', () => {
    for (const k of Object.keys(held)) held[k] = false;
  });
  target.addEventListener('pointermove', (event) => {
    const rect = target.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / Math.max(1, rect.width)) * target.width;
    mouse.y = ((event.clientY - rect.top) / Math.max(1, rect.height)) * target.height;
  });
  target.addEventListener('pointerdown', (event) => {
    mouse.down = true;
    mouse.clicked = { x: mouse.x, y: mouse.y };
    actions.push('click');
    if (event.button === 0) event.preventDefault();
  });
  target.addEventListener('pointerup', () => {
    mouse.down = false;
  });

  return {
    mouse,
    takeActions() {
      return actions.splice(0, actions.length);
    },
    controls() {
      return {
        pitch: (held.pitchUp ? 1 : 0) - (held.pitchDown ? 1 : 0),
        roll: (held.rollRight ? 1 : 0) - (held.rollLeft ? 1 : 0),
        yaw: (held.yawRight ? 1 : 0) - (held.yawLeft ? 1 : 0),
        throttleUp: held.throttleUp ? 1 : 0,
        throttleDown: held.throttleDown ? 1 : 0,
        fire: Boolean(held.fire),
        brake: Boolean(held.brake),
        flaps: Boolean(held.flaps),
      };
    },
  };
}
