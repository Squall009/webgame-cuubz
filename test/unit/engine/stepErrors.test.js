/**
 * Cuubz — a render-loop step's exception is never completely silent (BUGS.md D-89)
 *
 * D-89: `WorldStep.js`'s mob-update catch only logged while `frameCount < 10`, so after
 * the tenth frame a throw was silent and mobs stopped updating for the rest of the
 * session with nothing in the console. The row's own prescription is a one-shot latch,
 * and this is the gate for it.
 *
 * The second half of the file is the part that makes the row *closed* rather than moved:
 * a sweep over every render-loop step asserting the raw idiom is gone. It had been copied
 * to nine sites — one in `CombatStep`, six in `QuestStep` as S1 through S8 added
 * systems, two in `WorldStep` — and fixing the one D-89 happens to name would have left
 * eight.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { TEST_DIR as __dirname } from '../../helpers/paths.js';
import {
  reportStepError, STEP_ERROR_WARMUP_FRAMES,
} from '../../../src/engine/loop/reportStepError.js';

let warn, error;
beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  error = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { warn.mockRestore(); error.mockRestore(); });

describe('the latch', () => {
  it('reports every occurrence during warm-up, which is what the throttle was for', () => {
    const state = { frameCount: 0 };
    for (let i = 0; i < STEP_ERROR_WARMUP_FRAMES; i++) {
      state.frameCount = i;
      expect(reportStepError(state, 'Mob update', new Error('boom'))).toBe(true);
    }
    expect(warn).toHaveBeenCalledTimes(STEP_ERROR_WARMUP_FRAMES);
  });

  it('reports the first failure AFTER warm-up, which is the whole defect', () => {
    // Before this, a subsystem that died at frame 400 left nothing in the console at all
    // and the symptom was "mobs stopped moving".
    const state = { frameCount: 400 };
    expect(reportStepError(state, 'Mob update', new Error('boom'))).toBe(true);
    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0][0]).toContain('frame 400');
    expect(error.mock.calls[0][0]).toContain('suppressed');
    // The error object, not the message: this is the only line anyone gets, so it has to
    // carry the stack.
    expect(error.mock.calls[0][1]).toBeInstanceOf(Error);
  });

  it('goes quiet after that one, which is why the throttle existed', () => {
    const state = { frameCount: 400 };
    for (let i = 0; i < 600; i++) reportStepError(state, 'Mob update', new Error('boom'));
    expect(error).toHaveBeenCalledTimes(1);
  });

  it('latches per label, so one dead subsystem does not silence the others', () => {
    const state = { frameCount: 400 };
    reportStepError(state, 'Mob update', new Error('a'));
    reportStepError(state, 'Mob update', new Error('a'));
    reportStepError(state, 'Hazard system', new Error('b'));
    reportStepError(state, 'Boss encounter', new Error('c'));
    expect(error).toHaveBeenCalledTimes(3);
  });

  it('latches per session, not per module', () => {
    // A module-level Set would be shared across every game a page loads: quit to the
    // menu, start another world, and the second session inherits the first's latches and
    // reports nothing at all.
    const first = { frameCount: 400 };
    reportStepError(first, 'Mob update', new Error('boom'));
    const second = { frameCount: 400 };
    reportStepError(second, 'Mob update', new Error('boom'));
    expect(error).toHaveBeenCalledTimes(2);
  });

  it('reports rather than suppresses when there is no state to latch against', () => {
    expect(reportStepError(null, 'Mob update', new Error('boom'))).toBe(true);
    expect(reportStepError(undefined, 'Mob update', 'a bare string')).toBe(true);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('survives a non-Error throw', () => {
    expect(() => reportStepError({ frameCount: 0 }, 'X', 'a string')).not.toThrow();
    expect(() => reportStepError({ frameCount: 400 }, 'Y', undefined)).not.toThrow();
  });
});

describe('every render-loop step routes through it', () => {
  const STEPS_DIR = path.join(__dirname, '..', 'src', 'engine', 'loop', 'steps');

  it('no step still carries the raw `frameCount < 10` idiom', () => {
    // The sweep, not a list: a step added tomorrow that copies the idiom from its
    // neighbours fails here rather than going silent in production six months later.
    const offenders = [];
    for (const file of fs.readdirSync(STEPS_DIR).filter((f) => f.endsWith('.js'))) {
      const src = fs.readFileSync(path.join(STEPS_DIR, file), 'utf8');
      // Strip comments — the *explanations* of D-89 legitimately quote the old shape.
      const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      if (/frameCount\s*<\s*\d+/.test(code)) offenders.push(file);
    }
    expect(offenders, `these steps still throttle by hand: ${offenders.join(', ')}`).toEqual([]);
  });

  it('and every step that catches at all calls the helper', () => {
    const missing = [];
    for (const file of fs.readdirSync(STEPS_DIR).filter((f) => f.endsWith('.js'))) {
      const src = fs.readFileSync(path.join(STEPS_DIR, file), 'utf8');
      const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      // `catch { }` with no binding is a deliberate ignore of an expected condition (an
      // unloaded chunk, a disconnecting player) and is not what D-89 is about. Only a
      // catch that BINDS the error is claiming to handle it.
      if (!/catch\s*\(/.test(code)) continue;
      if (!/reportStepError/.test(code)) missing.push(file);
    }
    expect(missing, `these steps catch an error and do not report it: ${missing.join(', ')}`)
      .toEqual([]);
  });

  it('found some steps to check — the sweep is not vacuous', () => {
    const files = fs.readdirSync(STEPS_DIR).filter((f) => f.endsWith('.js'));
    expect(files.length).toBeGreaterThan(4);
    const callers = files.filter((f) =>
      /reportStepError/.test(fs.readFileSync(path.join(STEPS_DIR, f), 'utf8')));
    expect(callers.length).toBeGreaterThan(2);
  });
});
