// Signs (Round 11, js/content/decor.js): their text, four lines of up to
// 15 characters in a dye's colour (black unless dyed), kept per cell and
// saved with the world like the chests (serialize / load). Placing a sign
// opens its editor, a right click on one edits it again (as in vanilla
// 1.20), a dye on one colours its text. The text is drawn on the board as
// a small canvas texture, only for the signs near the camera.
//
// Online (SignSync below): the host keeps every sign's text; a guest's edit
// goes to the host ("sgset", plain text, cleaned the same at both ends),
// which keeps it and passes it on to everyone; a joining player gets them
// all with the world ("signs"). Peers without signs ignore the message.
//
// (Round 12) Every dimension's signs are in the one store (a Nether sign's
// key "n:x,y,z": js/dim-registry.js), each with its `dim`; only those of the
// dimension the world is in are drawn. Online "sgset" carries the dimension
// ("dm"); every player keeps every dimension's text (a guest arriving in the
// Nether reads its signs at once).
import * as THREE from "three";
import { createEntityMaterial, bindEntityLight } from "./shaders.js";
import { LIB } from "./content/base.js";
import { isSign, signFace, signInfo, DYE_TEXT_RGB, BLACK, COLOR_NAMES } from "./content/decor.js";
import { dimKey, DIM_KEY_RE, parseDimKey, OVERWORLD, dimOfCode, dmOf } from "./dim-registry.js";

export const SIGN_LINES = 4;
export const SIGN_LINE_CHARS = 15;
const VIEW = 24; // (blocks: text drawn this near the camera)
const KEEP = 30; // (and kept until this far)
const REFRESH = 0.25; // (seconds between looks at which signs are near)
const CANVAS_W = 256;
const CANVAS_H = 128;
const BOARD_RGB = ["#b08a52", "#6f4d2d", "#d5c48e"]; // (the editor's board: oak, spruce, birch)

// (Round 12: in a dimension; the Overworld's keys as before.)
const key = (x, y, z, dim = OVERWORLD) => dimKey(dim, x, y, z);
const chunkOf = (x, z) => ((x >> 4) & 0xffff) * 65536 + ((z >> 4) & 0xffff);

// One line as plain text: no control characters, at most 15 characters.
export function cleanLine(s) {
  // eslint-disable-next-line no-control-regex
  const t = String(s ?? "").replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, "");
  return Array.from(t).slice(0, SIGN_LINE_CHARS).join("");
}
export function cleanLines(lines) {
  const out = [];
  for (let i = 0; i < SIGN_LINES; i++) out.push(cleanLine(Array.isArray(lines) ? lines[i] : ""));
  return out;
}
const cleanColor = (c) => (Number.isInteger(c) && c >= 0 && c < 16 ? c : BLACK);
const blank = (lines) => lines.every((l) => !l);
const posOf = (p) => (Array.isArray(p) && p.length === 3 && p.every(Number.isInteger) && p[1] >= 0 && p[1] < 256 ? p : null);

// The text's colour: vanilla's dye colours at 0.4 (text that doesn't glow).
function textColor(c) {
  const v = DYE_TEXT_RGB[cleanColor(c)];
  const f = (s) => Math.round(((v >> s) & 255) * 0.4);
  return `rgb(${f(16)}, ${f(8)}, ${f(0)})`;
}

const PLANE = new THREE.PlaneGeometry(1, 0.5);

export class Signs {
  constructor({ scene, world }) {
    this.world = world;
    this.store = new Map(); // "x,y,z" -> { x, y, z, lines, color, mesh, canvas, texture, light, drawn }
    this.authority = true; // false on a guest: the host keeps the text
    this.remote = null; // js/net (SignSync): send(record)
    this.group = new THREE.Group();
    scene?.add(this.group);
    // Hooks set by the game: the editor takes the mouse and keyboard
    // (onOpen() => bool, false: not now) and gives them back (onClose());
    // inGame() false while it is open: something else took over, it closes.
    this.onOpen = null;
    this.onClose = null;
    this.inGame = null;
    this.editing = null; // { key, x, y, z, color }: the sign being edited
    this._chunks = new Map(); // chunk -> how many records it holds (edits elsewhere skip the lookup)
    this._t = 0;
    this._editor = null;
    LIB.openSignEditor = (x, y, z, fresh) => this.edit(x, y, z, fresh);
    LIB.dyeSign = (x, y, z, c) => this.dye(x, y, z, c);
    // (A sign gone, by anyone: its text goes too.)
    world.changeListeners.push((changed) => this._changed(changed));
    // (Round 12: and one gone in ground not loaded here, js/net/world.js.)
    world.signs ??= this; // (the game's: the first made on this world)
  }

  // ---------- The records ----------

  // (Round 12) The dimension the world is in.
  get _dim() {
    return this.world.dim ?? OVERWORLD;
  }

  get(x, y, z, dim = this._dim) {
    return this.store.get(key(x, y, z, dim)) || null;
  }

  // The text of the sign at (x, y, z), as plain lines.
  text(x, y, z) {
    const r = this.get(x, y, z);
    return r ? r.lines.slice() : cleanLines(null);
  }

  // Sets a sign's text (and colour); send: pass it on online (this player's own edit).
  // (Round 12) dim: another dimension's sign (online, or loading a save).
  set(x, y, z, lines, color, send = false, dim = this._dim) {
    const k = key(x, y, z, dim);
    let r = this.store.get(k);
    const clean = cleanLines(lines);
    const c = color === undefined ? r?.color ?? BLACK : cleanColor(color);
    if (!r) {
      if (blank(clean) && c === BLACK && !send) return null;
      r = { x, y, z, dim, lines: clean, color: c, mesh: null, canvas: null, texture: null, light: { sky: 15, block: 0 }, drawn: null };
      this.store.set(k, r);
      const ch = chunkOf(x, z);
      this._chunks.set(ch, (this._chunks.get(ch) || 0) + 1);
    } else {
      r.lines = clean;
      r.color = c;
    }
    if (send) this.remote?.send(r);
    this._t = REFRESH; // (drawn on the next frame)
    return r;
  }

  _remove(k) {
    const r = this.store.get(k);
    if (!r) return;
    this.store.delete(k);
    const ch = chunkOf(r.x, r.z);
    const n = (this._chunks.get(ch) || 1) - 1;
    if (n > 0) this._chunks.set(ch, n);
    else this._chunks.delete(ch);
    this._drop(r);
    if (this.editing?.key === k) this.close(false);
  }

  clear() {
    for (const r of this.store.values()) this._drop(r);
    this.store.clear();
    this._chunks.clear();
  }

  _changed(changed) {
    if (!this.store.size) return;
    const w = this.world;
    for (let i = 0; i < changed.length; i += 3) {
      const x = changed[i];
      const z = changed[i + 2];
      if (!this._chunks.has(chunkOf(x, z))) continue;
      const y = changed[i + 1];
      if (isSign(w.getBlock(x, y, z))) continue;
      const k = key(x, y, z, this._dim);
      if (this.store.has(k)) this._remove(k);
    }
  }

  // (Round 12) Another player's edit of a cell in ground not loaded here
  // (another dimension's, often: js/net/world.js): no sign there any more,
  // its text goes, as _changed does for loaded ground.
  goneUnloaded(x, y, z, id, dim = this._dim) {
    if (!this.store.size || isSign(id) || !this._chunks.has(chunkOf(x, z))) return;
    const k = key(x, y, z, dim);
    if (this.store.has(k)) this._remove(k);
  }

  // A dye on the sign: its text in that colour (false: already so, or no sign).
  dye(x, y, z, c) {
    if (!isSign(this.world.getBlock(x, y, z))) return false;
    const r = this.get(x, y, z);
    if ((r?.color ?? BLACK) === c) return false;
    this.set(x, y, z, r ? r.lines : null, c, true);
    return true;
  }

  // ---------- The editor ----------

  // Opens the editor on the sign at (x, y, z) (fresh: just placed, so it
  // starts blank). False if it can't open now.
  edit(x, y, z, fresh = false) {
    if (this.editing || typeof document === "undefined") return false;
    const id = this.world.getBlock(x, y, z);
    if (!isSign(id) || !this.onOpen || this.onOpen() === false) return false;
    const ui = this._ui();
    const r = this.get(x, y, z);
    const lines = fresh || !r ? cleanLines(null) : r.lines.slice();
    if (fresh && r) r.lines = lines.slice();
    const wood = signInfo(id)?.wood ?? 0;
    this.editing = { key: key(x, y, z, this._dim), x, y, z, color: fresh || !r ? BLACK : r.color };
    ui.board.style.background = `linear-gradient(180deg, ${BOARD_RGB[wood]}, ${BOARD_RGB[wood]}dd)`;
    ui.inputs.forEach((inp, i) => {
      inp.value = lines[i];
      inp.style.color = textColor(this.editing.color);
    });
    ui.hint.textContent = this.editing.color === BLACK ? "Enter: next line · Esc: done" : `${COLOR_NAMES[this.editing.color]} text · Enter: next line · Esc: done`;
    ui.root.classList.remove("hidden");
    ui.inputs[0].focus();
    return true;
  }

  // Closes the editor: the text kept (and sent) when commit; onClose gives
  // the controls back unless something else took them (quiet).
  close(commit = true, quiet = false) {
    const e = this.editing;
    if (!e) return;
    this.editing = null;
    const ui = this._ui();
    ui.root.classList.add("hidden");
    for (const inp of ui.inputs) inp.blur();
    if (commit && isSign(this.world.getBlock(e.x, e.y, e.z))) this.set(e.x, e.y, e.z, ui.inputs.map((inp) => inp.value), e.color, true);
    if (!quiet) this.onClose?.();
  }

  get isEditing() {
    return !!this.editing;
  }

  _ui() {
    if (this._editor) return this._editor;
    const root = document.createElement("div");
    root.id = "sign-editor";
    root.className = "hidden";
    root.style.cssText = "position:fixed;inset:0;z-index:90;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;background:rgba(0,0,0,0.55)";
    const title = document.createElement("div");
    title.textContent = "Edit sign message";
    title.style.cssText = "color:#fff;font:600 16px sans-serif;text-shadow:1px 1px 0 #000";
    const board = document.createElement("div");
    board.style.cssText = "width:min(480px,88vw);aspect-ratio:2/1;box-sizing:border-box;padding:3% 4%;display:flex;flex-direction:column;justify-content:space-evenly;border:4px solid #3b2a16;border-radius:3px;box-shadow:0 10px 40px rgba(0,0,0,0.6)";
    const inputs = [];
    for (let i = 0; i < SIGN_LINES; i++) {
      const inp = document.createElement("input");
      inp.type = "text";
      inp.maxLength = SIGN_LINE_CHARS;
      inp.spellcheck = false;
      inp.autocomplete = "off";
      inp.style.cssText = "width:100%;box-sizing:border-box;background:rgba(255,255,255,0.08);border:none;outline:none;text-align:center;font:600 clamp(16px,4.6vw,26px) ui-monospace,Menlo,Consolas,'Courier New',monospace;padding:2px 0;border-radius:2px";
      inp.addEventListener("focus", () => (inp.style.background = "rgba(255,255,255,0.2)"));
      inp.addEventListener("blur", () => (inp.style.background = "rgba(255,255,255,0.08)"));
      // (as typed: the sign in the world shows it, not passed on until done)
      inp.addEventListener("input", () => {
        const e = this.editing;
        if (e) this.set(e.x, e.y, e.z, inputs.map((x) => x.value), e.color, false);
      });
      board.appendChild(inp);
      inputs.push(inp);
    }
    const hint = document.createElement("div");
    hint.style.cssText = "color:#ddd;font:13px sans-serif;text-shadow:1px 1px 0 #000";
    const done = document.createElement("button");
    done.type = "button";
    done.textContent = "Done";
    done.style.cssText = "min-width:160px;padding:8px 18px;font:600 15px sans-serif;cursor:pointer";
    done.addEventListener("click", () => this.close(true));
    root.append(title, board, hint, done);
    document.body.appendChild(root);
    // (While it is open the keys are the editor's: no game key reaches the
    // game, the characters reach the line being typed.)
    window.addEventListener(
      "keydown",
      (e) => {
        if (!this.editing) return;
        e.stopPropagation();
        const at = inputs.indexOf(document.activeElement);
        if (e.code === "Escape") {
          e.preventDefault();
          if (!e.repeat) this.close(true);
        } else if (e.code === "Enter" || e.code === "NumpadEnter" || e.code === "ArrowDown") {
          e.preventDefault();
          if (e.repeat && e.code !== "ArrowDown") return;
          if (at >= SIGN_LINES - 1 && e.code !== "ArrowDown") this.close(true);
          else inputs[Math.min(SIGN_LINES - 1, at + 1)].focus();
        } else if (e.code === "ArrowUp") {
          e.preventDefault();
          inputs[Math.max(0, at - 1)].focus();
        } else if (e.code === "Tab") {
          e.preventDefault();
          inputs[(at + (e.shiftKey ? SIGN_LINES - 1 : 1)) % SIGN_LINES].focus();
        } else if (at < 0) inputs[0].focus();
      },
      true
    );
    window.addEventListener("keyup", (e) => this.editing && e.stopPropagation(), true);
    this._editor = { root, board, inputs, hint };
    return this._editor;
  }

  // ---------- Drawing ----------

  // Per frame: the text of the signs near `eye` (a THREE.Vector3) drawn on
  // their boards, the others' let go.
  update(dt, eye) {
    if (this.editing) {
      const e = this.editing;
      if ((this.inGame && !this.inGame()) || !isSign(this.world.getBlock(e.x, e.y, e.z))) this.close(true, !!(this.inGame && !this.inGame()));
    }
    this._t += dt;
    if (this._t < REFRESH || !eye) return;
    this._t = 0;
    const w = this.world;
    const here = this._dim;
    for (const r of this.store.values()) {
      // (Round 12: another dimension's sign is not drawn here.)
      if (r.dim !== here) {
        if (r.mesh) this._drop(r);
        continue;
      }
      const d = Math.max(Math.abs(r.x + 0.5 - eye.x), Math.abs(r.y + 0.5 - eye.y), Math.abs(r.z + 0.5 - eye.z));
      const id = d < KEEP ? w.getBlock(r.x, r.y, r.z) : 0;
      if (d >= KEEP || (!r.mesh && (d >= VIEW || blank(r.lines))) || !isSign(id)) {
        if (r.mesh && (d >= KEEP || !isSign(id))) this._drop(r);
        continue;
      }
      this._show(r, id);
    }
  }

  _show(r, id) {
    if (!r.mesh) {
      const canvas = document.createElement("canvas");
      canvas.width = CANVAS_W;
      canvas.height = CANVAS_H;
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = 4;
      const mesh = new THREE.Mesh(PLANE, createEntityMaterial("map", texture));
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      bindEntityLight(mesh, () => r.light);
      this.group.add(mesh);
      r.mesh = mesh;
      r.canvas = canvas;
      r.texture = texture;
      r.drawn = null;
      r.shownId = -1;
    }
    if (r.shownId !== id) {
      const f = signFace(id);
      r.mesh.position.set(r.x + f.x, r.y + f.y, r.z + f.z);
      r.mesh.rotation.set(0, f.angle, 0);
      r.mesh.updateMatrix();
      r.shownId = id;
    }
    const l = this.world.lightAt(r.x, r.y, r.z);
    r.light.sky = l.sky;
    r.light.block = l.block;
    const drawn = `${r.color}|${r.lines.join("\n")}`;
    if (r.drawn === drawn) return;
    r.drawn = drawn;
    const ctx = r.canvas.getContext("2d");
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
    ctx.fillStyle = textColor(r.color);
    ctx.font = "700 23px ui-monospace, Menlo, Consolas, 'Courier New', monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (let i = 0; i < SIGN_LINES; i++) if (r.lines[i]) ctx.fillText(r.lines[i], CANVAS_W / 2, (CANVAS_H * (i + 0.5)) / SIGN_LINES + 1, CANVAS_W - 20);
    r.texture.needsUpdate = true;
  }

  _drop(r) {
    if (!r.mesh) return;
    this.group.remove(r.mesh);
    r.mesh.material.dispose();
    r.texture.dispose();
    r.mesh = null;
    r.canvas = null;
    r.texture = null;
    r.drawn = null;
  }

  // How many signs' text is drawn now (tests, stats).
  get drawnCount() {
    let n = 0;
    for (const r of this.store.values()) if (r.mesh) n++;
    return n;
  }

  // ---------- Save ----------

  // The signs with text, for the world save: { "x,y,z": [line 1, ..., line 4, colour] }
  // (undefined on a guest, and when there are none). A record whose cell is
  // loaded and holds no sign is left out.
  serialize() {
    if (!this.authority || !this.store.size) return undefined;
    const out = {};
    let n = 0;
    for (const [k, r] of this.store) {
      if (blank(r.lines) && r.color === BLACK) continue;
      if (r.dim === this._dim && this.world.getChunk?.(r.x >> 4, r.z >> 4) && !isSign(this.world.getBlock(r.x, r.y, r.z))) continue;
      out[k] = [...r.lines, r.color];
      n++;
    }
    return n ? out : undefined;
  }

  load(data) {
    this.clear();
    if (!data || typeof data !== "object") return;
    for (const [k, list] of Object.entries(data)) {
      if (!DIM_KEY_RE.test(k) || !Array.isArray(list)) continue;
      const [x, y, z, dim] = parseDimKey(k);
      this.set(x, y, z, list.slice(0, SIGN_LINES), list[SIGN_LINES], false, dim);
    }
  }
}

// ---------- Online ----------

// The multiplayer module (main.js adds it: mp.addModule): the host keeps
// the text and passes every edit on; a joining player gets them all.
export class SignSync {
  constructor(mp, signs) {
    this.mp = mp;
    this.net = mp.net;
    this.signs = signs;
    if (!signs) return;
    // (A guest's page never keeps signs of its own.)
    if (mp.game?.GUEST) signs.authority = false;
    signs.remote = this;
    this.net.on("sgset", (m, from) => this._onSet(m, from));
    this.net.registerSync("signs", {
      save: () => signs.serialize() || {},
      load: (data) => signs.load(data),
    });
  }

  start() {
    if (!this.signs) return;
    this.signs.authority = this.net.isHost;
    if (!this.net.isHost) this.signs.clear();
  }

  // This player's edit: to the host (a guest), or to everyone (the host).
  send(r) {
    if (!this.mp.active) return;
    const msg = { t: "sgset", p: [r.x, r.y, r.z], l: r.lines, c: r.color, ...dmOf(r.dim) };
    if (this.net.isHost) this.net.broadcast(msg);
    else this.net.toHost(msg);
  }

  _onSet(m, from) {
    const p = posOf(m.p);
    if (!p || !this.signs) return;
    const [x, y, z] = p;
    const dim = dimOfCode(m.dm);
    if (this.net.isHost) {
      // (A guest's edit: within reach of where they are.)
      const r = this.mp.players?.get(from);
      const at = r?.livePos;
      if (!at || Math.abs(at.x - x - 0.5) > 16 || Math.abs(at.y - y) > 16 || Math.abs(at.z - z - 0.5) > 16) return;
      this.signs.set(x, y, z, m.l, cleanColor(m.c), false, dim);
      this.net.broadcast({ t: "sgset", p, l: cleanLines(m.l), c: cleanColor(m.c), ...dmOf(dim) }, { except: from });
      return;
    }
    // (A guest: the host's word, unless this player is typing on that sign.)
    if (this.signs.editing?.key === key(x, y, z, dim)) return;
    this.signs.set(x, y, z, m.l, cleanColor(m.c), false, dim);
  }
}
