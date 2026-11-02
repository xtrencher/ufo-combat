// (Round 16) The canyon run's sceneries (biomes) and difficulty levels: what
// a course's rock, floor, river, plants and sky are made of, and how wide,
// winding and overhung its canyon is. Pure (no three.js, no DOM): the chunk
// workers read it through js/dim-canyon.js, the run (js/canyon.js) reads the
// sky tints, the menu (js/menu-canyon.js) the names.
//
// A biome: its strata (bands from the floor up, each with how far it stands
// out of the wall: soft bands erode back, hard ones make ledges), the
// plateau's top and the blocks under it, the canyon's floor (by the water,
// and away from it), the river (water, ice or lava), what grows (plants on
// the floor, trees on the rim), what clings to the walls, and its sky (a
// tint on the course's own hour: js/canyon.js).
import { BLOCK } from "./content/base.js";
import {
  RED_TERRACOTTA, ORANGE_TERRACOTTA, YELLOW_TERRACOTTA, WHITE_TERRACOTTA, BROWN_TERRACOTTA, LIGHT_GRAY_TERRACOTTA, GRAY_TERRACOTTA, BLACK_TERRACOTTA,
  SMOOTH_SANDSTONE, SANDSTONE, CUT_SANDSTONE, CHISELED_SANDSTONE, RED_SAND, COARSE_DIRT, PODZOL,
  ANDESITE, POLISHED_ANDESITE, DIORITE, GRANITE, SMOOTH_STONE, MOSSY_COBBLESTONE,
  ICE, PACKED_ICE, SNOW_LAYER, LAVA, OBSIDIAN, MAGMA_BLOCK, BASALT, POLISHED_BASALT, SMOOTH_BASALT, BLACKSTONE,
  FERN, OXEYE_DAISY, CORNFLOWER,
} from "./content/ids.js";

const T = BLOCK.TERRACOTTA;

// (b: block, r: recess (+ eroded back, - standing out), max: thickest band)
export const CANYON_BIOMES = {
  mesa: {
    id: "mesa",
    name: "Red rock",
    note: "Banded red and orange cliffs",
    bands: [
      { b: RED_TERRACOTTA, r: 1.5 },
      { b: ORANGE_TERRACOTTA, r: 0.5 },
      { b: T, r: 0 },
      { b: YELLOW_TERRACOTTA, r: -1 },
      { b: WHITE_TERRACOTTA, r: -2.5 },
      { b: BROWN_TERRACOTTA, r: 2.5 },
      { b: LIGHT_GRAY_TERRACOTTA, r: -1.5 },
    ],
    top: RED_SAND,
    cap: SANDSTONE,
    floor: [RED_SAND, BLOCK.SAND, COARSE_DIRT, BLOCK.GRAVEL],
    river: BLOCK.WATER,
    plant: BLOCK.DEAD_BUSH,
    plantP: 0.012,
    topPlant: BLOCK.DEAD_BUSH,
    topPlantP: 0.004,
    card: "rgba(190,90,40,0.3)",
  },
  desert: {
    id: "desert",
    name: "Desert",
    note: "Pale sandstone and dunes",
    bands: [
      { b: SANDSTONE, r: 0 },
      { b: SMOOTH_SANDSTONE, r: -2.5 },
      { b: CUT_SANDSTONE, r: -1 },
      { b: YELLOW_TERRACOTTA, r: 1.5 },
      { b: WHITE_TERRACOTTA, r: -1.5 },
      { b: SANDSTONE, r: 0.8 },
      { b: CHISELED_SANDSTONE, r: -3, max: 2 },
    ],
    top: BLOCK.SAND,
    cap: SANDSTONE,
    floor: [BLOCK.SAND, BLOCK.SAND, SANDSTONE, BLOCK.GRAVEL],
    river: BLOCK.WATER,
    plant: BLOCK.DEAD_BUSH,
    plantP: 0.01,
    cactusP: 0.004,
    topPlant: BLOCK.CACTUS,
    topPlantP: 0.003,
    card: "rgba(220,180,90,0.32)",
  },
  green: {
    id: "green",
    name: "Green gorge",
    note: "Grass, trees and mossy stone",
    bands: [
      { b: BLOCK.STONE, r: 0 },
      { b: ANDESITE, r: -1 },
      { b: MOSSY_COBBLESTONE, r: 1.5, max: 4 },
      { b: BLOCK.DIRT, r: 2.5, max: 4 },
      { b: GRANITE, r: -1.5 },
      { b: BLOCK.COBBLESTONE, r: 0.5 },
      { b: BLOCK.STONE, r: -0.5 },
    ],
    top: BLOCK.GRASS,
    cap: BLOCK.DIRT,
    floor: [BLOCK.GRASS, BLOCK.GRASS, PODZOL, BLOCK.GRAVEL],
    river: BLOCK.WATER,
    plant: BLOCK.TALL_GRASS,
    plantP: 0.16,
    flowers: [BLOCK.FLOWER_RED, BLOCK.FLOWER_YELLOW, OXEYE_DAISY, CORNFLOWER, FERN],
    topPlant: BLOCK.TALL_GRASS,
    topPlantP: 0.12,
    trees: { log: BLOCK.WOOD, leaves: BLOCK.LEAVES, p: 0.5, h: [5, 8], kind: "round" }, // (p: a tree in this share of the 7-block cells)
    moss: BLOCK.LEAVES, // (green clinging to the walls)
    mossP: 0.035,
    card: "rgba(80,160,70,0.32)",
  },
  grey: {
    id: "grey",
    name: "Grey stone",
    note: "Bare granite-grey rock, overcast",
    bands: [
      { b: BLOCK.STONE, r: 0 },
      { b: ANDESITE, r: -1 },
      { b: POLISHED_ANDESITE, r: -2.5, max: 3 },
      { b: BLOCK.COBBLESTONE, r: 1.5 },
      { b: SMOOTH_STONE, r: -1.5, max: 3 },
      { b: GRAY_TERRACOTTA, r: 2 },
      { b: DIORITE, r: -0.5, max: 4 },
    ],
    top: BLOCK.STONE,
    cap: BLOCK.STONE,
    floor: [BLOCK.GRAVEL, BLOCK.STONE, BLOCK.COBBLESTONE, BLOCK.GRAVEL],
    topAlt: BLOCK.GRAVEL,
    river: BLOCK.WATER,
    plant: BLOCK.DEAD_BUSH,
    plantP: 0.002,
    card: "rgba(140,145,155,0.32)",
  },
  snow: {
    id: "snow",
    name: "Frozen pass",
    note: "Snow, ice and pine trees",
    bands: [
      { b: BLOCK.STONE, r: 0 },
      { b: ANDESITE, r: -1 },
      { b: DIORITE, r: -2 },
      { b: PACKED_ICE, r: 1, max: 3 },
      { b: BLOCK.SNOW, r: 2, max: 4 },
      { b: BLOCK.COBBLESTONE, r: 0.5 },
      { b: LIGHT_GRAY_TERRACOTTA, r: -1.5 },
    ],
    top: BLOCK.SNOW,
    cap: BLOCK.STONE,
    floor: [BLOCK.SNOW, BLOCK.SNOW, PACKED_ICE, BLOCK.GRAVEL],
    river: ICE,
    snowLayer: SNOW_LAYER + 1,
    trees: { log: BLOCK.PINE_LOG, leaves: BLOCK.PINE_LEAVES, p: 0.42, h: [7, 11], kind: "cone" },
    card: "rgba(190,215,240,0.34)",
  },
  volcanic: {
    id: "volcanic",
    name: "Volcanic",
    note: "Black basalt, magma and a lava river",
    bands: [
      { b: BASALT, r: -1 },
      { b: BLACKSTONE, r: 0 },
      { b: SMOOTH_BASALT, r: 1 },
      { b: POLISHED_BASALT, r: -2 },
      { b: MAGMA_BLOCK, r: 2, max: 2 },
      { b: OBSIDIAN, r: -3, max: 2 },
      { b: BLACK_TERRACOTTA, r: 1.5 },
    ],
    top: BLACKSTONE,
    cap: BASALT,
    floor: [BASALT, BLACKSTONE, MAGMA_BLOCK, BLOCK.GRAVEL],
    river: LAVA,
    falls: LAVA,
    glow: MAGMA_BLOCK,
    glowP: 0.006,
    card: "rgba(150,40,20,0.36)",
  },
};
export const BIOME_ORDER = ["mesa", "desert", "green", "grey", "snow", "volcanic"];

// The sky over each (js/canyon.js): tints on the hour's colours (multipliers
// per channel), how grey (desat), the haze (x the usual) and the light.
export const BIOME_SKY = {
  mesa: null,
  desert: { zen: [1.04, 1.0, 0.9], hor: [1.14, 1.05, 0.86], light: [1.06, 1.0, 0.9], amb: [1.05, 1.0, 0.92], desat: 0, haze: 1.8 },
  green: { zen: [0.92, 1.0, 1.06], hor: [0.94, 1.03, 1.02], light: [0.98, 1.02, 0.98], amb: [0.95, 1.04, 0.98], desat: 0, haze: 1.1 },
  grey: { zen: [0.8, 0.83, 0.88], hor: [0.95, 0.97, 1.0], light: [0.82, 0.85, 0.9], amb: [0.95, 0.97, 1.02], desat: 0.65, haze: 2.2 },
  snow: { zen: [1.0, 1.06, 1.14], hor: [1.22, 1.27, 1.34], light: [0.96, 1.0, 1.08], amb: [1.1, 1.14, 1.22], desat: 0.45, haze: 2.2 },
  volcanic: { zen: [0.55, 0.3, 0.26], hor: [1.15, 0.55, 0.36], light: [1.0, 0.68, 0.5], amb: [1.15, 0.72, 0.6], desat: 0.55, haze: 3 },
};

// The difficulty levels: how wide (x the course's half-width, plus some),
// how much it winds, the overhangs and narrows, the tunnels, the obstacles,
// the rings' size, the jet's speed at the start and the par times' pace.
// Hard is the Round 15 canyon as it was; Normal a little wider and calmer;
// Easy wide open; Insane a crack in the rock.
export const CANYON_DIFFS = {
  easy: { id: "easy", name: "Easy", note: "Wide and gentle", w: 1.75, wAdd: 10, minHalf: 22, wander: 0.55, bulge: 0, flare: 1.2, narrows: 0.25, narrowW: 1.8, tunnels: 0.35, tunnelH: 1.45, pillars: 0.45, fins: 0.5, finLane: 1.6, arches: 0.7, ringR: 1.35, speed: 0.9, pace: 0.86 },
  normal: { id: "normal", name: "Normal", note: "Roomy, a few tight spots", w: 1.22, wAdd: 3, minHalf: 13, wander: 0.85, bulge: 0.6, flare: 1, narrows: 0.75, narrowW: 1.25, tunnels: 0.8, tunnelH: 1.15, pillars: 0.85, fins: 0.9, finLane: 1.2, arches: 1, ringR: 1.12, speed: 0.96, pace: 0.95 },
  hard: { id: "hard", name: "Hard", note: "Narrow, winding, overhangs", w: 1, wAdd: 0, minHalf: 9, wander: 1, bulge: 1, flare: 1, narrows: 1, narrowW: 1, tunnels: 1, tunnelH: 1, pillars: 1, fins: 1, finLane: 1, arches: 1, ringR: 1, speed: 1, pace: 1 },
  insane: { id: "insane", name: "Insane", note: "A crack in the rock", w: 0.78, wAdd: 0, minHalf: 7.5, wander: 1.25, bulge: 1.7, flare: 0.8, narrows: 1.6, narrowW: 0.82, tunnels: 1.4, tunnelH: 0.9, pillars: 1.2, fins: 1.2, finLane: 0.85, arches: 1.3, ringR: 0.86, speed: 1.02, pace: 1.03 },
};
export const DIFF_ORDER = ["easy", "normal", "hard", "insane"];

// Open stretches between the canyons: none, some (about one every 6.5 km), lots.
export const CANYON_OPENS = {
  none: { id: "none", name: "None", per: 0 },
  some: { id: "some", name: "Some", per: 1 / 6500 },
  lots: { id: "lots", name: "Lots", per: 1 / 2800 },
};
export const OPEN_ORDER = ["none", "some", "lots"];
