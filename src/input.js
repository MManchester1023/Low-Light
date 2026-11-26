// Keyboard + mouse input, with rebindable keys.
// Clicking starts play. Moving the mouse turns the camera, no button needed. Pointer lock is requested
// (and asked for again on each click) but some browsers and embedded panes refuse it: without a lock the
// cursor is hidden and still turns the camera, and resting it at the left or right edge of the window
// keeps turning that way, so you never run out of room. Arrow keys look around too.
//
// Rebinding: game code always asks for an action's default key code (input.down('KeyW') means "forward").
// When a player binds forward to another key, that key is translated to 'KeyW' on the way in, and W itself
// stops doing anything (unless it was given to another action). Bindings are kept in localStorage.

export const ACTIONS = [
  { id: 'forward', label: 'Move forward', code: 'KeyW' },
  { id: 'back', label: 'Move back', code: 'KeyS' },
  { id: 'left', label: 'Move left', code: 'KeyA' },
  { id: 'right', label: 'Move right', code: 'KeyD' },
  { id: 'run', label: 'Run (hold)', code: 'ShiftLeft' },
  { id: 'crouch', label: 'Crouch · let go of a pipe', code: 'KeyC' },
  { id: 'use', label: 'Use · grab · knock out · climb', code: 'KeyE' },
  { id: 'hang', label: 'Pipe hang style', code: 'Space' },
  { id: 'pistol', label: 'Draw / holster pistol', code: 'Digit1' },
  { id: 'reload', label: 'Reload', code: 'KeyR' },
  { id: 'throw', label: 'Aim and throw (hold)', code: 'KeyG' },
  { id: 'nv', label: 'Night vision', code: 'KeyN' },
  { id: 'debug', label: 'Show guard view', code: 'KeyV' },
  { id: 'pause', label: 'Pause', code: 'KeyP' },
  { id: 'lookUp', label: 'Look up', code: 'ArrowUp' },
  { id: 'lookDown', label: 'Look down', code: 'ArrowDown' },
  { id: 'lookLeft', label: 'Look left', code: 'ArrowLeft' },
  { id: 'lookRight', label: 'Look right', code: 'ArrowRight' },
];
const CANONICAL = new Set(ACTIONS.map((a) => a.code));
const STORE_KEY = 'lowlight.keys';
const EDGE_PX = 24; // unlocked cursor this close to the side of the window keeps turning the camera

/** Short name for a key code: KeyW → W, Digit1 → 1, ShiftLeft → Shift, ArrowUp → ↑. */
export function keyLabel(code) {
  if (!code) return '—';
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return 'Num ' + code.slice(6);
  const arrows = { ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→' };
  if (arrows[code]) return arrows[code];
  const mods = { Shift: 'Shift', Control: 'Ctrl', Alt: 'Alt', Meta: 'Meta' };
  for (const m in mods) if (code.startsWith(m)) return mods[m];
  return code;
}

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this._down = new Set();
    this._pressed = new Set();
    this._dx = 0;
    this._dy = 0;
    this._locked = false;
    this._active = false;
    this._edgeX = 0; // -1 / 1 while the unlocked cursor sits at the left / right edge
    this.onActiveChange = null;   // (active: boolean) => void
    this.onBindingsChange = null; // () => void
    this.bindings = this._loadBindings(); // action id -> key code

    window.addEventListener('keydown', (e) => {
      const code = this.translate(e.code);
      if (this._active && (code && CANONICAL.has(code))) e.preventDefault();
      if (e.repeat) return;
      if (this._active && (e.code === 'Escape' || code === 'KeyP')) { this._setActive(false); return; }
      if (!code) return;
      this._down.add(code);
      this._pressed.add(code);
    });
    window.addEventListener('keyup', (e) => {
      const code = this.translate(e.code);
      if (this._active && code && CANONICAL.has(code)) e.preventDefault();
      if (code) this._down.delete(code);
    });
    window.addEventListener('blur', () => { this._down.clear(); this._pressed.clear(); this._edgeX = 0; });

    const overlay = document.getElementById('overlay');
    if (overlay) overlay.addEventListener('click', () => this.resume());
    canvas.addEventListener('click', () => { if (!this._active) this.resume(); });

    document.addEventListener('pointerlockchange', () => {
      const was = this._locked;
      this._locked = document.pointerLockElement === canvas;
      // Losing a lock we had (the browser's Esc) pauses the game.
      if (was && !this._locked) this._setActive(false);
    });

    canvas.addEventListener('mousedown', (e) => {
      if (!this._active) return;
      if (!this._locked) this._requestLock(); // try again: a click is a user gesture
      if (e.button === 0) { this._down.add('Mouse0'); this._pressed.add('Mouse0'); } // fires the pistol
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this._down.delete('Mouse0');
    });
    window.addEventListener('mousemove', (e) => {
      if (!this._active) return;
      this._dx += e.movementX || 0;
      this._dy += e.movementY || 0;
      if (this._locked) { this._edgeX = 0; return; }
      const edge = Math.max(EDGE_PX, window.innerWidth * 0.03);
      this._edgeX = e.clientX <= edge ? -1 : e.clientX >= window.innerWidth - edge ? 1 : 0;
    });
  }

  // ---------- Bindings ----------

  _loadBindings() {
    const b = Object.fromEntries(ACTIONS.map((a) => [a.id, a.code]));
    try {
      const saved = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
      for (const a of ACTIONS) if (typeof saved[a.id] === 'string') b[a.id] = saved[a.id];
    } catch (_) { /* no storage: defaults */ }
    return b;
  }

  _saveBindings() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(this.bindings)); } catch (_) { /* fine */ }
    this._down.clear();
    if (this.onBindingsChange) this.onBindingsChange();
  }

  /** Bind an action to a key. If another action had that key, it gets this action's old key (a swap). */
  setBinding(id, code) {
    const old = this.bindings[id];
    for (const a of ACTIONS) if (a.id !== id && this.bindings[a.id] === code) this.bindings[a.id] = old;
    this.bindings[id] = code;
    this._saveBindings();
  }

  resetBindings() {
    for (const a of ACTIONS) this.bindings[a.id] = a.code;
    this._saveBindings();
  }

  /** Key shown for an action, e.g. keyFor('reload') → 'R'. */
  keyFor(id) { return keyLabel(this.bindings[id]); }

  /** Physical key → the default code the game listens for, or null if that key is switched off. */
  translate(code) {
    for (const a of ACTIONS) if (this.bindings[a.id] === code) return a.code;
    if (CANONICAL.has(code)) return null; // a default key whose action moved elsewhere
    return code;                          // not a game key (Escape, ShiftRight, ...)
  }

  // ---------- Play / pause ----------

  /** Start or resume play (must come from a click or key press so the pointer lock is allowed). */
  resume() {
    this._setActive(true);
    this._requestLock();
  }

  _requestLock() {
    if (document.pointerLockElement === this.canvas) return;
    try {
      const p = this.canvas.requestPointerLock();
      if (p && p.catch) p.catch(() => {});
    } catch (_) { /* lock refused: mouse look still works unlocked */ }
  }

  pause() { this._setActive(false); }

  _setActive(on) {
    if (this._active === on) return;
    this._active = on;
    this._edgeX = 0;
    document.body.classList.toggle('playing', on); // hides the cursor over the game
    if (!on) {
      this._down.clear();
      this._dx = 0;
      this._dy = 0;
      if (document.pointerLockElement === this.canvas) document.exitPointerLock();
    }
    if (this.onActiveChange) this.onActiveChange(on);
  }

  down(code) { return this._down.has(code); }
  pressed(code) { return this._pressed.has(code); }
  get mouseDX() { return this._dx; }
  get mouseDY() { return this._dy; }
  /** -1 / 0 / 1: keep turning left / right (unlocked cursor resting at a window edge). */
  get edgeX() { return this._active && !this._locked ? this._edgeX : 0; }
  get locked() { return this._locked; }
  /** True while the game is being played (clicked in, not paused). */
  get active() { return this._active; }
  endFrame() { this._pressed.clear(); this._dx = 0; this._dy = 0; }
}

export class NullInput {
  down() { return false; }
  pressed() { return false; }
  get mouseDX() { return 0; }
  get mouseDY() { return 0; }
  get edgeX() { return 0; }
  get locked() { return false; }
  get active() { return false; }
  endFrame() {}
}
