// A floating nickname over a player (on foot, or over their vehicle):
// a small label in the player's colour that keeps the same size on screen,
// stays readable through terrain (to find each other) and shows how far
// away the player is when they are not close.
import * as THREE from "three";
import { LAYER_FX } from "../layers.js";

const W = 512;
const H = 96;

export class Nameplate {
  constructor(scene, nick, color) {
    this.canvas = document.createElement("canvas");
    this.canvas.width = W;
    this.canvas.height = H;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.minFilter = THREE.LinearFilter;
    this.material = new THREE.SpriteMaterial({ map: this.texture, transparent: true, depthTest: false, depthWrite: false, fog: false, sizeAttenuation: false, toneMapped: false });
    this.sprite = new THREE.Sprite(this.material);
    this.sprite.renderOrder = 1000;
    this.sprite.layers.set(LAYER_FX);
    this.sprite.frustumCulled = false;
    scene.add(this.sprite);
    this.scene = scene;
    this.nick = nick;
    this.color = color;
    this.extra = "";
    this.health = -1;
    this._draw();
  }

  set(nick, color, extra = "", health = -1) {
    if (nick === this.nick && color === this.color && extra === this.extra && health === this.health) return;
    this.nick = nick;
    this.color = color;
    this.extra = extra;
    this.health = health;
    this._draw();
  }

  _draw() {
    const c = this.canvas.getContext("2d");
    c.clearRect(0, 0, W, H);
    c.font = "700 40px Inter, 'Segoe UI', system-ui, Arial, sans-serif";
    const label = this.extra ? `${this.nick}  ${this.extra}` : this.nick;
    const tw = Math.min(W - 70, c.measureText(label).width);
    const bw = tw + 64;
    const x0 = (W - bw) / 2;
    c.fillStyle = "rgba(8,12,20,0.62)";
    roundRect(c, x0, 8, bw, 60, 16);
    c.fill();
    c.fillStyle = this.color;
    c.beginPath();
    c.arc(x0 + 26, 38, 9, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = "#fff";
    c.textBaseline = "middle";
    c.fillText(label, x0 + 44, 40, W - 70);
    // A thin health bar under the name (co-op).
    if (this.health >= 0) {
      c.fillStyle = "rgba(8,12,20,0.62)";
      roundRect(c, x0 + 16, 74, bw - 32, 12, 6);
      c.fill();
      c.fillStyle = this.health > 0.5 ? "#4fdc8a" : this.health > 0.25 ? "#ffc94a" : "#ff4a3a";
      roundRect(c, x0 + 18, 76, Math.max(0, (bw - 36) * Math.min(1, this.health)), 8, 4);
      c.fill();
    }
    this.texture.needsUpdate = true;
    // Screen-space size (sizeAttenuation off): a fixed share of the view height.
    const s = 0.16;
    this.sprite.scale.set(s * (W / H) * 0.5, s * 0.5, 1);
  }

  place(x, y, z, visible = true) {
    this.sprite.position.set(x, y, z);
    this.sprite.visible = visible;
  }

  dispose() {
    this.scene.remove(this.sprite);
    this.material.dispose();
    this.texture.dispose();
  }
}

function roundRect(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}
