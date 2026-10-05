// Magazines, reloads and cooldowns of the hand weapons (pure data, shared by
// weapons.js, the HUD and the tests). The laser blaster has none: it never
// runs dry and can fire continuously (6 a bolt, ~27/s: no magazine).
// Balanced by damage: the harder a
// weapon hits, the longer the wait. Sustained damage per second in
// brackets (damage x shots in a magazine / (time to fire it + reload)).
// The guns' bullets and the lasers' bolts take time to arrive (bullets ~175-190
// blocks/s, the sniper's 480 or 624 with a long view, lasers 650-680): that
// delays hits but does not change these rates; against a far, moving target
// the bullets need a lead.
//   mag: shots before a reload; reload: seconds to reload (or recharge);
//   heat / cool: seconds of fire before it overheats, seconds to cool.
export const WEAPON_STATS = {
  bow: { mag: 1, reload: 0.35, label: "Nocking" }, // 10 per full draw (~7.4/s)
  pistol: { mag: 12, reload: 1.5, label: "Reloading" }, // 5 per shot (~15/s)
  machinegun: { mag: 30, reload: 2.2, label: "Reloading" }, // 3 x 12/s (~19/s; real bullets, a little weaker at range vs. a moving target)
  sniper: { mag: 1, reload: 1.8, label: "Reloading" }, // 34, one round (~19/s, at 400 blocks)
  grenade: { mag: 1, reload: 1.4, label: "Next grenade" },
  bazooka: { mag: 1, reload: 3, label: "Reloading" },
  railgun: { mag: 1, reload: 3.5, label: "Recharging" }, // 140 and pierces everything
  airstrike: { mag: 1, reload: 25, label: "Next strike" },
  minigun: { heat: 4, cool: 3, label: "Overheated" }, // 3 x 32/s while it lasts (~48/s)
};

