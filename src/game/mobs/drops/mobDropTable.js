/**
 * Cuubz — Mob Drop Table
 * Weighted rolling for mob drops against the player's inventory.
 */

/**
 * Roll a mob's drop table and return the items.
 * @param {Mob} mob
 * @returns {{typeId:*, count:number}[]}
 */
export function rollDrops(mob) {
  const drops = mob.definition.drops || [];
  const items = [];

  for (const entry of drops) {
    const roll = Math.random() * 100;
    if (roll < entry.weight) {
      const count = entry.minCount + Math.floor(Math.random() * (entry.maxCount - entry.minCount + 1));
      if (count > 0) {
        items.push({ typeId: entry.item, count });
      }
    }
  }

  return items;
}

/**
 * Add drops to a player's inventory. Returns items that couldn't fit.
 * @param {{typeId:*, count:number}[]} drops
 * @param {Inventory} inventory
 * @returns {{typeId:*, count:number}[]} Overflow items
 */
export function addDropsToInventory(drops, inventory) {
  const overflow = [];
  for (const drop of drops) {
    if (inventory && typeof inventory.addItem === 'function') {
      const result = inventory.addItem(drop.typeId, drop.count);
      if (result.remaining > 0) {
        overflow.push({ typeId: drop.typeId, count: result.remaining });
      }
    } else {
      overflow.push(drop);
    }
  }
  return overflow;
}
