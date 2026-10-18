// The player's own body, shown in the third-person camera modes (F5): the
// "player" box model from mob-models.js, lit by the voxel light where the
// player stands, with the held item in its right hand. It walks, sneaks,
// looks where the player looks, and swings its arm when the first-person
// view would.
// (Round 12) As vanilla's: crouching lowers it 0.125 with the arms hanging
// down, eating lifts the food to the mouth, a raised shield comes up in
// front, the off hand's item is in the left hand, the armor worn is drawn
// over the body (each material its colour), it flashes red when hurt and
// falls over on its side when it dies.
import * as THREE from "three";
import { createMobModel } from "./mob-models.js";
import { itemModel } from "./models.js";
import { itemInfo } from "./items.js";
import { createEntityMaterial, bindEntityLight } from "./shaders.js";
import { SHIELD } from "./content/ids.js";

const PX = 1 / 16;
let flashTex = null;
function flashTexture() {
  if (flashTex) return flashTex;
  const c = document.createElement("canvas");
  c.width = c.height = 32;
  const x = c.getContext("2d");
  const g = x.createRadialGradient(16, 16, 0, 16, 16, 16);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.35, "rgba(255,210,120,0.9)");
  g.addColorStop(1, "rgba(255,140,40,0)");
  x.fillStyle = g;
  x.fillRect(0, 0, 32, 32);
  flashTex = new THREE.CanvasTexture(c);
  return flashTex;
}
const GUN_BASIS = new THREE.Matrix4().makeBasis(new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0));

// (Round 12) Armor drawn over the model: each piece a few boxes a little
// bigger than the part it covers, in the parts' own pixels (x, y, z from and
// to; the head's box is 8 cube from (-4, 0, -4), the body's 8 x 12 x 4 from
// (-4, 0, -2), an arm's or a leg's 4 x 12 x 4 hanging from its pivot). The
// helmet leaves the face open.
const ARMOR_COLORS = { leather: 0xa06540, chain: 0x8a8d91, gold: 0xf2cf45, iron: 0xd6d6d6, diamond: 0x4fd8cf, netherite: 0x4a4246, turtle: 0x47a046 };
const ARMOR_BOXES = [
  // Helmet: a cap over the top and the back and sides of the head.
  [["head", -4.6, 5.6, -4.6, 4.6, 8.6, 4.6], ["head", -4.6, 1, -4.6, 4.6, 5.6, -3.4], ["head", -4.6, 2, -3.4, -3.4, 5.6, 4.6], ["head", 3.4, 2, -3.4, 4.6, 5.6, 4.6]],
  // Chestplate: the body and the shoulders.
  [["body", -4.5, 1.8, -2.5, 4.5, 12.5, 2.5], ["armL", -2.5, -3.5, -2.5, 2.5, 2.5, 2.5], ["armR", -2.5, -3.5, -2.5, 2.5, 2.5, 2.5]],
  // Leggings: the hips and the legs above the boots.
  [["body", -4.3, -0.3, -2.3, 4.3, 2.4, 2.3], ["legL", -2.3, -8.5, -2.3, 2.3, 0.3, 2.3], ["legR", -2.3, -8.5, -2.3, 2.3, 0.3, 2.3]],
  // Boots.
  [["legL", -2.6, -12.4, -2.6, 2.6, -7.6, 2.6], ["legR", -2.6, -12.4, -2.6, 2.6, -7.6, 2.6]],
];
const _armorGeo = new Map(); // "slot:colour" -> geometry per part, shared by every avatar
function armorGeometries(slot, hex) {
  const key = `${slot}:${hex}`;
  let out = _armorGeo.get(key);
  if (out) return out;
  out = [];
  const base = new THREE.Color(hex);
  for (const [part, x0, y0, z0, x1, y1, z1] of ARMOR_BOXES[slot]) {
    const g = new THREE.BoxGeometry((x1 - x0) * PX, (y1 - y0) * PX, (z1 - z0) * PX);
    g.translate(((x0 + x1) / 2) * PX, ((y0 + y1) / 2) * PX, ((z0 + z1) / 2) * PX);
    // (A little grain per face, a darker rim at the bottom: plate, not plastic.)
    const pos = g.getAttribute("position");
    const n = g.getAttribute("normal");
    const colors = [];
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const k = (n.getY(i) > 0.5 ? 1.08 : n.getY(i) < -0.5 ? 0.7 : 0.94) * (pos.getY(i) <= ((y0 + 0.4) * PX) ? 0.82 : 1);
      c.copy(base).multiplyScalar(k);
      colors.push(c.r, c.g, c.b);
    }
    g.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    out.push([part, g]);
  }
  _armorGeo.set(key, out);
  return out;
}
function armorColor(id) {
  const icon = itemInfo(id)?.icon;
  const m = typeof icon === "string" ? /^armor_([a-z]+)_/.exec(icon) : null;
  return ARMOR_COLORS[m?.[1]] ?? 0x9a9a9a;
}
const HURT_RED = new THREE.Color();

export class PlayerAvatar {
  constructor(scene, atlas) {
    this.model = createMobModel("player");
    this.root = this.model.root;
    this.root.visible = false;
    scene.add(this.root);
    this.light = { sky: 15, block: 0 };
    bindEntityLight(this.root, () => this.light);
    this.materials = {
      array: createEntityMaterial("array", atlas),
      color: createEntityMaterial("color"),
    };
    // The item sits in a socket at the right hand (the arm hangs 10 px down).
    this.socket = new THREE.Group();
    this.socket.position.set(0, -10 * PX, 1.2 * PX);
    this.model.parts.armR.add(this.socket);
    // The left hand: where a drawn bow is held.
    this.socketL = new THREE.Group();
    this.socketL.position.set(0, -10 * PX, 1.2 * PX);
    this.model.parts.armL.add(this.socketL);
    this._bowHand = false;
    // A shot: the muzzle flash at the gun's end, and the recoil.
    this.flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: flashTexture(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, color: new THREE.Color(4, 3, 1.6) }));
    this.flash.scale.setScalar(0.45);
    this.flash.visible = false;
    this.flash.position.set(0, -0.62, 0.08);
    this.socket.add(this.flash);
    this._shots = null;
    this._flashT = 9;
    this._kick = 0;
    this.itemId = null;
    this.itemMesh = null;
    this._walk = 0;
    this._bodyYaw = 0;
    // (Round 12) The off hand's item, the armor worn, the eating pose.
    this.offId = 0;
    this.offMesh = null;
    this._armorSig = "";
    this._armorMeshes = [];
    this._eat = 0;
    this._lit = { sky: 15, block: 0, flash: null };
  }

  // (Round 12) The armor worn (a list of four stacks or nulls: head, chest,
  // legs, feet), drawn over the model.
  setArmor(armor) {
    let sig = "";
    for (let i = 0; i < 4; i++) sig += `${armor?.[i]?.id ?? 0},`;
    if (sig === this._armorSig) return;
    this._armorSig = sig;
    for (const m of this._armorMeshes) m.parent?.remove(m);
    this._armorMeshes.length = 0;
    for (let slot = 0; slot < 4; slot++) {
      const id = armor?.[slot]?.id;
      if (!id) continue;
      for (const [part, geo] of armorGeometries(slot, armorColor(id))) {
        const mesh = new THREE.Mesh(geo, this.materials.color);
        mesh.castShadow = true;
        bindEntityLight(mesh, () => this._lit);
        this.model.parts[part].add(mesh);
        this._armorMeshes.push(mesh);
      }
    }
  }

  // (Round 12) The off hand's item, in the left hand.
  setOffhand(id) {
    id = id || 0;
    if (id === this.offId) return;
    this.offId = id;
    if (this.offMesh) {
      this.offMesh.parent?.remove(this.offMesh);
      this.offMesh = null;
    }
    const model = id ? itemModel(id) : null;
    if (!model) return;
    const mesh = new THREE.Mesh(model.geometry, this.materials[model.kind]);
    mesh.castShadow = true;
    if (model.cube) {
      mesh.scale.setScalar(0.28);
      mesh.rotation.set(0, Math.PI / 4, 0);
      mesh.position.set(0, -0.05, 0.08);
    } else {
      // (A shield or a sprite: held up flat in the fist, facing out to the side.)
      mesh.scale.setScalar(0.55);
      mesh.rotation.set(Math.PI / 2 - 0.35, Math.PI / 2, -Math.PI / 4);
      mesh.position.set(0, -0.04, 0.1);
    }
    bindEntityLight(mesh, () => this._lit);
    this.offMesh = mesh;
    this.socketL.add(mesh);
  }

  setItem(id) {
    id = id || 0;
    if (id === this.itemId) return;
    this.itemId = id;
    if (this.itemMesh) {
      this.itemMesh.parent?.remove(this.itemMesh);
      this.itemMesh = null;
    }
    const model = id ? itemModel(id) : null;
    if (!model) return;
    const mesh = new THREE.Mesh(model.geometry, this.materials[model.kind]);
    mesh.castShadow = true;
    if (model.cube) {
      mesh.scale.setScalar(0.28);
      mesh.rotation.set(0, Math.PI / 4, 0);
      mesh.position.set(0, -0.05, 0.08);
    } else if (model.gun) {
      // Guns point along the arm's "forward" when it's raised to aim.
      // The barrel (-Z) runs out along the arm (-Y), the top faces +Z.
      mesh.scale.setScalar(model.gun === "pistol" ? 0.55 : 0.75);
      mesh.setRotationFromMatrix(GUN_BASIS);
      mesh.position.set(0, -0.02, 0.05);
    } else {
      // Tools and sprites: held in the fist, the blade pointing forward and a
      // little up (Round 8: it pointed back up along the arm), seen side-on.
      mesh.scale.setScalar(0.55);
      mesh.rotation.set(Math.PI / 2 - 0.35, -Math.PI / 2, Math.PI / 4);
      mesh.position.set(0, -0.04, 0.1);
    }
    this._restRot = mesh.rotation.clone();
    this._restPos = mesh.position.clone();
    this._bowHand = false;
    bindEntityLight(mesh, () => this._lit);
    this.itemMesh = mesh;
    this.socket.add(mesh);
  }

  // visible: third person. swing: 0-1 progress of the arm swing (1 = idle).
  // bowDraw: 0-1 while a bow is drawn. shots: a counter that goes up with
  // every shot fired (a muzzle flash and the recoil each time it changes).
  // (Round 12) armor: the four armor stacks worn; offhandId: the off hand's
  // item; eating: food or a drink at the mouth. The player's hurtTime (s
  // since a hit) and deathTime (s since dying, the local player only: a
  // remote player's body is hidden when they die) are read too.
  update(dt, player, light, { visible, swing = 1, heldId = 0, bowDraw = 0, shots = null, armor = null, offhandId = 0, eating = false }) {
    const dying = player.dead && player.deathTime > 0;
    this.root.visible = visible && (!player.dead || dying);
    if (!this.root.visible) {
      // (The count kept current while hidden: no flash for shots fired in first person.)
      this._shots = shots;
      this._kick = 0;
      this._flashT = 9;
      return;
    }
    this.light = light;
    // Lit where the player stands; red while hurt or dying (as the creatures).
    const lit = this._lit;
    lit.sky = light.sky;
    lit.block = light.block;
    const hurt = dying ? 1 : Number.isFinite(player.hurtTime) ? Math.max(0, 1 - player.hurtTime / 0.3) : 0;
    lit.flash = hurt > 0 ? HURT_RED.setRGB(0.6 * hurt, 0, 0) : null;
    this.setItem(heldId);
    this.setArmor(armor);
    this.setOffhand(offhandId);
    const p = player.position;
    // (Crouching: the model sits 0.125 lower, as vanilla's.)
    this.root.position.set(p.x, p.y - (player.sneaking && !dying ? 0.125 : 0), p.z);
    // Dying: it falls over sideways in about 0.6 s (vanilla's), and stays down.
    this.model.tilt.rotation.z = dying ? (Math.min(1, Math.sqrt((player.deathTime * 20 - 1) / 20 * 1.6) || 0) * Math.PI) / 2 : 0;
    // The body turns with the view, the head follows at once; while walking
    // the body lines up with the view quickly, standing still it lags a bit.
    const speed = Math.hypot(player.velocity.x, player.velocity.z);
    const moving = speed > 0.5 && player.onGround;
    this._walk += ((moving ? Math.min(1, speed / 4.6) : 0) - this._walk) * Math.min(1, dt * 10);
    let diff = player.yaw - this._bodyYaw;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    const maxLag = 0.75;
    if (moving) this._bodyYaw += diff * Math.min(1, dt * 12);
    else if (Math.abs(diff) > maxLag) this._bodyYaw += diff - Math.sign(diff) * maxLag;
    diff = Math.atan2(Math.sin(player.yaw - this._bodyYaw), Math.cos(player.yaw - this._bodyYaw));
    this.root.rotation.y = this._bodyYaw + Math.PI;
    const weapon = itemInfo(heldId)?.weapon?.kind;
    const drawing = weapon === "bow" && bowDraw > 0;
    const aim = drawing ? "bow" : weapon === "pistol" || weapon === "blaster" ? "one" : weapon && weapon !== "grenade" && weapon !== "airstrike" && weapon !== "bow" ? "two" : null;
    // A drawn bow goes into the left hand, upright, the arrow pointing ahead.
    if (this.itemMesh && drawing !== this._bowHand) {
      this._bowHand = drawing;
      (drawing ? this.socketL : this.socket).add(this.itemMesh);
      if (drawing) {
        this.itemMesh.rotation.set(0, Math.PI / 2, (-3 * Math.PI) / 4);
        this.itemMesh.position.set(0, -0.08, 0.1);
      } else {
        this.itemMesh.rotation.copy(this._restRot);
        this.itemMesh.position.copy(this._restPos);
      }
    }
    // Shots fired since the last frame.
    if (shots !== null && this._shots !== null && shots !== this._shots && weapon && weapon !== "bow") {
      this._kick = 1;
      this._flashT = 0;
      const gun = weapon === "pistol" || weapon === "blaster" ? 0.55 : 0.75;
      this.flash.position.set(0, -0.42 - gun * 0.45, 0.08);
    }
    this._shots = shots;
    this._kick = Math.max(0, this._kick - dt * 8);
    this._flashT += dt;
    this.flash.visible = this._flashT < 0.06 && !!aim && aim !== "bow";
    this.model.animate({
      kick: this._kick * this._kick,
      draw: bowDraw,
      walkPhase: player.walkPhase,
      walk: this._walk,
      headPitch: player.pitch,
      headYaw: diff,
      swing,
      sneak: player.sneaking && !dying,
      aim,
    });
    this._pose(dt, player, aim, eating && !dying, dying);
  }

  // (Round 12) Vanilla's poses on top of the model's own animation: arms
  // hanging down when crouching (and an aim kept on the view), the food or
  // drink lifted to the mouth with a bob, a raised shield in front.
  _pose(dt, player, aim, eating, dying) {
    const P = this.model.parts;
    if (this.offMesh) this.offMesh.visible = !this._bowHand; // (a drawn bow is in that hand)
    if (dying) return;
    if (player.sneaking) {
      // (The body leans forward 0.45: aims are lifted by as much, idle arms hang.)
      if (aim) {
        P.armR.rotation.x -= 0.45;
        if (aim !== "one") P.armL.rotation.x -= 0.45;
      } else {
        P.armR.rotation.x += 0.4;
        P.armL.rotation.x += 0.4;
      }
    }
    this._eat += ((eating ? 1 : 0) - this._eat) * Math.min(1, dt * 14);
    if (this._eat > 0.01) {
      const k = this._eat;
      const t = performance.now() / 1000;
      // The hand up at the mouth, nibbling.
      P.armR.rotation.x += (-1.75 - player.pitch * 0.5 + Math.abs(Math.sin(t * 18)) * 0.12 - P.armR.rotation.x) * k;
      P.armR.rotation.y += (-0.55 - P.armR.rotation.y) * k;
      P.armR.rotation.z += (0 - P.armR.rotation.z) * k;
    }
    const shield = player.shieldRaisedUntil > performance.now() / 1000;
    if (shield && !aim) {
      // (Vanilla's block pose: the arm half raised and turned in.) The shield
      // goes up on its own side: the off hand's unless the main hand holds one.
      const main = this.itemId === SHIELD;
      const arm = main ? P.armR : P.armL;
      arm.rotation.x = arm.rotation.x * 0.5 - 0.94;
      arm.rotation.y = main ? -0.52 : 0.52;
    }
  }
}
