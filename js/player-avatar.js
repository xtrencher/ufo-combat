// The player's own body, shown in the third-person camera modes (F5): the
// "player" box model from mob-models.js, lit by the voxel light where the
// player stands, with the held item in its right hand. It walks, sneaks,
// looks where the player looks, and swings its arm when the first-person
// view would.
import * as THREE from "three";
import { createMobModel } from "./mob-models.js";
import { itemModel } from "./models.js";
import { itemInfo } from "./items.js";
import { createEntityMaterial, bindEntityLight } from "./shaders.js";

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
    bindEntityLight(mesh, () => this.light);
    this.itemMesh = mesh;
    this.socket.add(mesh);
  }

  // visible: third person. swing: 0-1 progress of the arm swing (1 = idle).
  // bowDraw: 0-1 while a bow is drawn. shots: a counter that goes up with
  // every shot fired (a muzzle flash and the recoil each time it changes).
  update(dt, player, light, { visible, swing = 1, heldId = 0, bowDraw = 0, shots = null }) {
    this.root.visible = visible && !player.dead;
    if (!this.root.visible) {
      // (The count kept current while hidden: no flash for shots fired in first person.)
      this._shots = shots;
      this._kick = 0;
      this._flashT = 9;
      return;
    }
    this.light = light;
    this.setItem(heldId);
    const p = player.position;
    this.root.position.set(p.x, p.y, p.z);
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
      sneak: player.sneaking,
      aim,
    });
  }
}
