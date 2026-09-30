// Magazines, reloads and cooldowns of the hand weapons (pure data, shared by
// weapons.js, the HUD and the tests). Balanced by damage: the harder a
// weapon hits, the longer the wait. Sustained damage per second in
// brackets (damage x shots in a magazine / (time to fire it + reload)).
//   mag: shots before a reload; reload: seconds to reload (or recharge);
//   heat / cool: seconds of fire before it overheats, seconds to cool.
export const WEAPON_STATS = {
  bow: { mag: 1, reload: 0.35, label: "Nocking" }, // 9 per full draw (~6.5/s)
  pistol: { mag: 12, reload: 1.5, label: "Reloading" }, // 5 per shot (~15/s)
  machinegun: { mag: 30, reload: 2.2, label: "Reloading" }, // 3 x 12/s (~19/s)
  sniper: { mag: 1, reload: 1.8, label: "Reloading" }, // 34, one round (~19/s, at 400 blocks)
  grenade: { mag: 1, reload: 1.4, label: "Next grenade" },
  bazooka: { mag: 1, reload: 3, label: "Reloading" },
  blaster: { mag: 18, reload: 2, label: "Recharging" }, // 7 x 5/s (~23/s)
  railgun: { mag: 1, reload: 3.5, label: "Recharging" }, // 140 and pierces everything
  airstrike: { mag: 1, reload: 25, label: "Next strike" },
  minigun: { heat: 4, cool: 3, label: "Overheated" }, // 3 x 32/s while it lasts (~48/s)
};

