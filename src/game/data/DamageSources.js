/**
 * Cuubz — Damage source identifiers (PR 9)
 *
 * Extracted from `js/systems/survival.js` to break a **genuine circular dependency**
 * that ES modules turn from harmless into fatal.
 *
 * `survival.js` declared `DAMAGE_SOURCES` and called `calculateFallDamage`, which
 * `damageSystem.js` declared; `damageSystem.js` read `DAMAGE_SOURCES` — as a computed
 * key, at **module top level** (`ENVIRONMENTAL_DAMAGE_RATES`). As classic scripts that
 * worked because index.html loaded survival.js first and every name was one shared
 * global; under `require()` it worked because damageSystem.js carried a shim that
 * pulled the table off `require('./survival')` before using it.
 *
 * Neither crutch survives the conversion. With real ES modules, whichever of the two
 * is evaluated first pulls in the other, and the other reads a `const` in its
 * temporal dead zone: `ReferenceError: Cannot access 'DAMAGE_SOURCES' before
 * initialization`, at load, in the browser. `mobIntegration.js` imports
 * `DAMAGE_SOURCES` from the survival side, so the game would have hit it on the first
 * page load.
 *
 * A shared leaf module is the fix rather than reordering the imports, because import
 * order is not a thing a module graph lets you control. Both files now import from
 * here and neither imports the other's table. `refactor.md` §4.1 already puts data
 * tables under `src/game/data/`, so this is where it was going anyway.
 *
 * Both `SurvivalSystem.js` and `DamageSystem.js` re-export it, so every existing
 * import site — and every test — keeps working unchanged. Logged as **D-26** in
 * `BUGS.md`.
 *
 * The string values are persisted nowhere, but they are compared against saved
 * `lastDamageSource` state in a live session; do not rename them casually.
 */

export const DAMAGE_SOURCES = {
  NONE: 'none',
  LAVA: 'lava',
  POISON: 'poison',
  FALL: 'fall',
  BOSS: 'boss',
  MOB: 'mob',           // Regular mob attacks
  HUNGER: 'hunger',     // Starvation damage when hunger reaches 0
  THIRST: 'thirst',     // Dehydration damage when thirst reaches 0
};
