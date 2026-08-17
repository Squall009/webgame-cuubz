/**
 * Cuubz — health, damage, armour, death and respawn (S3)
 *
 * §2.2 was the largest hole in the game: the player had no `health`, no `takeDamage` and
 * no death, so mobs could not hurt them, no block was hazardous, and every "Boss
 * Mechanics" line in the storyline described damage with no receiver.
 *
 * The arithmetic assertions matter more than usual here because two other systems are
 * built on top of them: S4's hazards apply *per-second* rates every frame, and S6's boss
 * abilities are tuned against the armour curve. Both are wrong if this is.
 */

import { describe, it, expect } from 'vitest';
import {
  PlayerVitals, MAX_HEALTH, REGEN_DELAY_SECONDS, REGEN_PER_SECOND, INVULNERABLE_SECONDS,
} from '../../../src/game/entities/PlayerVitals.js';
import { DAMAGE_SOURCES } from '../../../src/game/data/DamageSources.js';

/** An inventory stub that reports a fixed armour total. */
const armoured = (totalArmor) => ({
  getEquipmentStats: () => ({ totalArmor, totalToughness: 0 }),
});

/** A player stub with the two shapes `respawn` handles. */
const playerStub = () => ({
  position: { x: 0, y: 0, z: 0 },
  velocity: { x: 1, y: -9, z: 2 },
});

describe('health', () => {
  it('starts full', () => {
    const v = new PlayerVitals();
    expect(v.health).toBe(MAX_HEALTH);
    expect(v.maxHealth).toBe(MAX_HEALTH);
    expect(v.isDead).toBe(false);
    expect(v.fraction).toBe(1);
  });

  it('takes damage and reports what was dealt', () => {
    const v = new PlayerVitals();
    expect(v.takeDamage(5, DAMAGE_SOURCES.MOB)).toBe(5);
    expect(v.health).toBe(15);
    expect(v.lastDamageSource).toBe(DAMAGE_SOURCES.MOB);
  });

  it('ignores nonsense', () => {
    const v = new PlayerVitals();
    expect(v.takeDamage(0)).toBe(0);
    expect(v.takeDamage(-5)).toBe(0);
    expect(v.takeDamage(NaN)).toBe(0);
    expect(v.takeDamage(undefined)).toBe(0);
    expect(v.health).toBe(MAX_HEALTH);
  });

  it('heals, clamped at max', () => {
    const v = new PlayerVitals();
    v.takeDamage(8, DAMAGE_SOURCES.MOB);
    expect(v.heal(3)).toBe(3);
    expect(v.health).toBe(15);
    expect(v.heal(100)).toBe(5);
    expect(v.health).toBe(MAX_HEALTH);
  });

  it('fires onHealthChanged for both directions', () => {
    const v = new PlayerVitals();
    const seen = [];
    v.onHealthChanged = (h) => seen.push(h);
    v.takeDamage(4, DAMAGE_SOURCES.MOB);
    v._invulnerableFor = 0;
    v.heal(1);
    expect(seen).toEqual([16, 17]);
  });
});

describe('armour', () => {
  it('does nothing without an inventory', () => {
    const v = new PlayerVitals();
    expect(v.applyArmor(10)).toBe(10);
  });

  it('reduces by totalArmor/30', () => {
    const v = new PlayerVitals({ inventory: armoured(15) });
    // 15/30 = 50%
    expect(v.applyArmor(10)).toBe(5);
  });

  it('caps at 80%, so nothing makes a player immune', () => {
    // A full netherite set must not survive standing in lava. §3.5's whole design is
    // that lava kills quickly and obviously.
    const v = new PlayerVitals({ inventory: armoured(1000) });
    expect(v.applyArmor(10)).toBeCloseTo(2, 6);
  });

  it('does not floor a small hit to zero', () => {
    // The formula this replaced had `Math.floor(damage * (1 - reduction))`. The corrupt
    // ground drains 0.25 HP/s (§3.5) and is applied per frame, so every tick would have
    // floored to 0 and the biome's hazard would not exist for anyone wearing armour.
    const v = new PlayerVitals({ inventory: armoured(15) });
    expect(v.applyArmor(0.25)).toBeGreaterThan(0);
    expect(v.applyArmor(1)).toBe(0.5);
  });

  it('is bypassed when a source says so', () => {
    const v = new PlayerVitals({ inventory: armoured(15) });
    v.takeDamage(10, DAMAGE_SOURCES.BOSS, { ignoreArmor: true });
    expect(v.health).toBe(10);
  });
});

describe('the invulnerability window', () => {
  it('drops repeat hits inside it', () => {
    const v = new PlayerVitals();
    expect(v.takeDamage(3, DAMAGE_SOURCES.MOB)).toBe(3);
    expect(v.takeDamage(3, DAMAGE_SOURCES.MOB)).toBe(0);
    expect(v.health).toBe(17);
  });

  it('expires on the clock', () => {
    const v = new PlayerVitals();
    v.takeDamage(3, DAMAGE_SOURCES.MOB);
    v.update(INVULNERABLE_SECONDS + 0.01);
    expect(v.takeDamage(3, DAMAGE_SOURCES.MOB)).toBe(3);
    expect(v.health).toBe(14);
  });

  it('is why per-second hazard rates work at all', () => {
    // Lava is 8 dps and the hazard system applies it every frame. Without the window a
    // player would take 60 separate hits a second at 60 fps.
    const v = new PlayerVitals();
    let dealt = 0;
    for (let i = 0; i < 60; i++) {
      dealt += v.takeDamage(8 / 60, DAMAGE_SOURCES.LAVA);
      v.update(1 / 60);
    }
    // ~1 second of frames, and only the ticks outside the window land.
    expect(dealt).toBeLessThan(8);
    expect(dealt).toBeGreaterThan(0);
  });

  it('can be bypassed for a source that must always land', () => {
    const v = new PlayerVitals();
    v.takeDamage(3, DAMAGE_SOURCES.MOB);
    expect(v.takeDamage(3, DAMAGE_SOURCES.LAVA, { ignoreInvulnerability: true })).toBe(3);
  });
});

describe('regeneration', () => {
  it('waits out the delay before starting', () => {
    const v = new PlayerVitals();
    v.takeDamage(10, DAMAGE_SOURCES.MOB);
    v.update(REGEN_DELAY_SECONDS - 0.1);
    expect(v.health).toBe(10);
    v.update(1);
    expect(v.health).toBeCloseTo(10 + REGEN_PER_SECOND, 5);
  });

  it('restarts the delay on every hit', () => {
    const v = new PlayerVitals();
    v.takeDamage(10, DAMAGE_SOURCES.MOB);
    // Four seconds is past the invulnerability window and short of the regen delay, so
    // nothing has come back yet when the second hit lands.
    v.update(4);
    expect(v.health).toBe(10);
    v.takeDamage(1, DAMAGE_SOURCES.MOB);
    expect(v.health).toBe(9);
    // The clock restarted, so another four seconds still heals nothing.
    v.update(4);
    expect(v.health).toBe(9);
    // And past the delay from the SECOND hit, it resumes.
    v.update(REGEN_DELAY_SECONDS - 4 + 1);
    expect(v.health).toBeGreaterThan(9);
  });

  it('stops at full', () => {
    const v = new PlayerVitals();
    v.takeDamage(1, DAMAGE_SOURCES.MOB);
    v.update(REGEN_DELAY_SECONDS + 100);
    expect(v.health).toBe(MAX_HEALTH);
  });

  it('does not regenerate the dead', () => {
    const v = new PlayerVitals();
    v.takeDamage(MAX_HEALTH, DAMAGE_SOURCES.LAVA);
    v.update(REGEN_DELAY_SECONDS + 100);
    expect(v.health).toBe(0);
    expect(v.isDead).toBe(true);
  });
});

describe('death', () => {
  it('fires once, at zero, with the source that did it', () => {
    const v = new PlayerVitals();
    const deaths = [];
    v.onDeath = (source) => deaths.push(source);
    v.takeDamage(MAX_HEALTH, DAMAGE_SOURCES.LAVA);
    expect(v.isDead).toBe(true);
    expect(v.health).toBe(0);
    expect(deaths).toEqual([DAMAGE_SOURCES.LAVA]);
  });

  it('never goes below zero, and takes no further damage', () => {
    const v = new PlayerVitals();
    v.takeDamage(100, DAMAGE_SOURCES.LAVA);
    expect(v.health).toBe(0);
    expect(v.takeDamage(10, DAMAGE_SOURCES.LAVA, { ignoreInvulnerability: true })).toBe(0);
  });

  it('cannot be healed back from', () => {
    const v = new PlayerVitals();
    v.takeDamage(100, DAMAGE_SOURCES.LAVA);
    expect(v.heal(10)).toBe(0);
    expect(v.isDead).toBe(true);
  });
});

describe('respawn', () => {
  it('restores full health and clears death', () => {
    const v = new PlayerVitals();
    v.takeDamage(100, DAMAGE_SOURCES.LAVA);
    v.respawn({ x: 5, y: 40, z: -3 });
    expect(v.health).toBe(MAX_HEALTH);
    expect(v.isDead).toBe(false);
    expect(v.lastDamageSource).toBe(DAMAGE_SOURCES.NONE);
  });

  it('moves the player and stops them falling', () => {
    const player = playerStub();
    const v = new PlayerVitals({ player });
    v.takeDamage(100, DAMAGE_SOURCES.LAVA);
    v.respawn({ x: 5, y: 40, z: -3 });
    expect(player.position).toEqual({ x: 5, y: 40, z: -3 });
    expect(player.velocity).toEqual({ x: 0, y: 0, z: 0 });
  });

  it("prefers the Player class's own respawn when it has one", () => {
    const calls = [];
    const player = { ...playerStub(), respawn: (p) => calls.push(p) };
    const v = new PlayerVitals({ player });
    v.respawn({ x: 1, y: 2, z: 3 });
    expect(calls).toEqual([{ x: 1, y: 2, z: 3 }]);
  });

  it('grants a moment of grace on arrival', () => {
    // Respawning into the lava that killed you and dying again before the screen has
    // redrawn is not a difficulty curve.
    const v = new PlayerVitals();
    v.takeDamage(100, DAMAGE_SOURCES.LAVA);
    v.respawn({ x: 0, y: 0, z: 0 });
    expect(v.isInvulnerable).toBe(true);
    expect(v.takeDamage(5, DAMAGE_SOURCES.LAVA)).toBe(0);
  });

  it('fires onRespawn', () => {
    const v = new PlayerVitals();
    let fired = 0;
    v.onRespawn = () => { fired++; };
    v.respawn({ x: 0, y: 0, z: 0 });
    expect(fired).toBe(1);
  });
});

describe('persistence', () => {
  it('round-trips health', () => {
    const a = new PlayerVitals();
    a.takeDamage(7, DAMAGE_SOURCES.MOB);
    const b = new PlayerVitals();
    b.restore(a.serialize());
    expect(b.health).toBe(13);
  });

  it('brings a player who quit while dead back alive', () => {
    // Persisting death means loading into a death screen with no way to dismiss it if
    // the respawn path ever fails.
    const a = new PlayerVitals();
    a.takeDamage(100, DAMAGE_SOURCES.LAVA);
    const b = new PlayerVitals();
    b.restore(a.serialize());
    expect(b.isDead).toBe(false);
    expect(b.health).toBe(MAX_HEALTH);
  });

  it('survives a corrupt blob', () => {
    const v = new PlayerVitals();
    expect(() => v.restore(null)).not.toThrow();
    expect(() => v.restore('nonsense')).not.toThrow();
    v.restore({ health: -50, maxHealth: 0 });
    expect(v.health).toBe(MAX_HEALTH);
  });
});

describe('a callback that throws cannot break the frame', () => {
  it('survives a thrown onDamage', () => {
    const v = new PlayerVitals();
    v.onDamage = () => { throw new Error('boom'); };
    expect(() => v.takeDamage(5, DAMAGE_SOURCES.MOB)).not.toThrow();
    expect(v.health).toBe(15);
  });

  it('survives a thrown onDeath', () => {
    const v = new PlayerVitals();
    v.onDeath = () => { throw new Error('boom'); };
    expect(() => v.takeDamage(100, DAMAGE_SOURCES.LAVA)).not.toThrow();
    expect(v.isDead).toBe(true);
  });
});
