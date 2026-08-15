// @vitest-environment jsdom
/**
 * Cuubz — the quest HUD and the quest log, against the assembled DOM (S1)
 *
 * ─── WHY jsdom AND NOT A SCREENSHOT ─────────────────────────────────────────
 *
 * Browser e2e cannot run in this environment — `quest_implementation.md` §11 says so and
 * the harness confirms it. So the UI is verified the way the rest of the tree's UI is:
 * mount the real templates into a jsdom document and drive the real writer against it.
 * That is enough to catch what actually breaks here — a wrong element id, a panel that
 * never un-hides, a counter that does not move — because every one of those is a DOM
 * fact rather than a visual one.
 *
 * ─── THE PANEL HAD FOUR IDS AND ZERO WRITERS ────────────────────────────────
 *
 * `#quest-tracker`, `#quest-name`, `#quest-objective` and `#quest-progress` have been in
 * the template and styled in `quest-tracker.css` since before any of this, permanently
 * `hidden`, with nothing in the codebase writing to them. These assertions are the first
 * thing that has ever proved the four ids and the writer agree.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { mountTemplates } from '../../../src/ui/templates/index.js';
import { QuestTrackerHUD } from '../../../src/ui/hud/QuestTracker.js';
import { QuestLog } from '../../../src/ui/overlays/QuestLog.js';
import { QuestSystem } from '../../../src/game/systems/QuestSystem.js';
import { createQuestState } from '../../../src/game/data/QuestState.js';
import { QUEST_ORDER } from '../../../src/game/data/QuestDefinitions.js';

// `// @vitest-environment jsdom` at the top of the file, which is this repo's opt-in
// (`vitest.config.js`) — `src/util/HTMLUtils.js` calls `document.createElement` off the
// **global**, so constructing a detached JSDOM instance is not enough on its own.
beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div>';
  mountTemplates(document.getElementById('app'));
});

describe('the quest tracker panel', () => {
  it('finds all four ids the template has always mounted', () => {
    const hud = new QuestTrackerHUD(document);
    expect(hud.isMounted).toBe(true);
  });

  it('starts hidden and un-hides only when there is a quest to show', () => {
    const tracker = document.getElementById('quest-tracker');
    expect(tracker.classList.contains('hidden')).toBe(true);

    const hud = new QuestTrackerHUD(document);
    const quests = new QuestSystem({ questState: createQuestState() });
    hud.render(quests.getTrackerView());

    expect(tracker.classList.contains('hidden')).toBe(false);
    expect(document.getElementById('quest-name').textContent).toBe('First Steps');
  });

  it('writes one line per objective, because the template gives it one element', () => {
    // Q01 has two objectives and Q19 has three; `#quest-objective` is a single div.
    const hud = new QuestTrackerHUD(document);
    const quests = new QuestSystem({ questState: createQuestState() });
    hud.render(quests.getTrackerView());

    const lines = document.querySelectorAll('#quest-objective .quest-objective-line');
    expect(lines).toHaveLength(2);
    expect(lines[0].textContent).toContain('Wood Logs');
    expect(lines[0].textContent).toContain('0/5');
    expect(lines[1].textContent).toContain('Dirt');
    expect(lines[1].textContent).toContain('0/10');
  });

  it('moves the counter when the pool moves', () => {
    const hud = new QuestTrackerHUD(document);
    const quests = new QuestSystem({ questState: createQuestState() });
    hud.render(quests.getTrackerView());

    quests.observe('q01', 'wood_log', 'char_a', 3);
    hud.render(quests.getTrackerView());

    const first = document.querySelector('#quest-objective .quest-objective-line');
    expect(first.textContent).toContain('3/5');
  });

  it('strikes through a finished objective while the quest is still open', () => {
    const hud = new QuestTrackerHUD(document);
    const quests = new QuestSystem({ questState: createQuestState() });
    quests.observe('q01', 'wood_log', 'char_a', 5);
    hud.render(quests.getTrackerView());

    const lines = document.querySelectorAll('#quest-objective .quest-objective-line');
    expect(lines[0].classList.contains('done')).toBe(true);
    expect(lines[1].classList.contains('done')).toBe(false);
    expect(document.getElementById('quest-progress').textContent).toContain('1/2 objectives');
  });

  it('skips the rebuild when nothing changed', () => {
    const hud = new QuestTrackerHUD(document);
    const quests = new QuestSystem({ questState: createQuestState() });
    hud.render(quests.getTrackerView());

    const before = document.getElementById('quest-objective').firstElementChild;
    hud.render(quests.getTrackerView());
    // Same node object, not merely equal markup: a redraw every frame would fight the
    // CSS transition and drop any text selection.
    expect(document.getElementById('quest-objective').firstElementChild).toBe(before);

    quests.observe('q01', 'dirt', 'char_a', 1);
    hud.render(quests.getTrackerView());
    expect(document.getElementById('quest-objective').firstElementChild).not.toBe(before);
  });

  it('hides itself when the game is complete', () => {
    const state = createQuestState();
    for (const id of QUEST_ORDER) state.quests[id] = { stage: 0, completed: true, completedAt: 1 };
    const quests = new QuestSystem({ questState: state });
    const hud = new QuestTrackerHUD(document);
    hud.show();
    hud.render(quests.getTrackerView());
    expect(document.getElementById('quest-tracker').classList.contains('hidden')).toBe(true);
  });

  it('does nothing at all when the template is absent', () => {
    document.body.innerHTML = '';
    const hud = new QuestTrackerHUD(document);
    expect(hud.isMounted).toBe(false);
    expect(() => hud.render(null)).not.toThrow();
    expect(() => hud.flashComplete()).not.toThrow();
  });
});

describe('the quest log overlay', () => {
  const makeLog = (state = createQuestState()) =>
    new QuestLog({ questSystem: new QuestSystem({ questState: state }), doc: document });

  it('is not in the DOM until it is opened', () => {
    const log = makeLog();
    expect(document.getElementById('quest-log')).toBeNull();
    log.open();
    expect(document.getElementById('quest-log')).not.toBeNull();
    expect(document.getElementById('quest-log').classList.contains('hidden')).toBe(false);
  });

  it('toggles', () => {
    const log = makeLog();
    log.toggle();
    expect(log.isOpen).toBe(true);
    log.toggle();
    expect(log.isOpen).toBe(false);
    expect(document.getElementById('quest-log').classList.contains('hidden')).toBe(true);
  });

  it('lists all seven acts and all 28 quests', () => {
    const log = makeLog();
    log.open();
    expect(document.querySelectorAll('#quest-log .quest-log-act')).toHaveLength(7);
    expect(document.querySelectorAll('#quest-log .quest-log-row')).toHaveLength(28);
  });

  it('shows the active quest and locks the rest', () => {
    const log = makeLog();
    log.open();
    const active = document.querySelectorAll('#quest-log .quest-log-row.active');
    expect(active).toHaveLength(1);
    expect(active[0].textContent).toContain('First Steps');
    expect(document.querySelectorAll('#quest-log .quest-log-row.locked')).toHaveLength(27);
  });

  it('does not print a locked quest’s title or narrative', () => {
    const log = makeLog();
    log.open();
    const html = document.getElementById('quest-log').innerHTML;
    // Q27 is where the storyline turns. Its title and its text are both spoilers.
    expect(html).not.toContain('Keys of Power');
    expect(html).not.toContain('You were never restoring the seals');
  });

  it('reveals a quest once it is reachable', () => {
    const state = createQuestState();
    state.quests.q01 = { stage: 1, completed: true, completedAt: 1 };
    const log = makeLog(state);
    log.open();
    const html = document.getElementById('quest-log').innerHTML;
    expect(html).toContain('Crafting Basics');
    expect(html).toContain('Shape what you gather');
    expect(html).toContain('1/28 complete');
  });

  it('lists earned titles and says so when there are none', () => {
    const log = makeLog();
    log.open();
    expect(document.querySelector('#quest-log .quest-log-empty').textContent).toBe('None yet.');
    log.dispose();

    const state = createQuestState();
    state.titles = ['survivor', 'seeker'];
    const log2 = new QuestLog({
      questSystem: new QuestSystem({ questState: state }), doc: document,
    });
    log2.open();
    const titles = document.querySelectorAll('#quest-log .quest-log-titles li');
    expect(titles).toHaveLength(2);
    expect(titles[0].textContent).toContain('Survivor');
  });

  it('closes on the close button', () => {
    const log = makeLog();
    log.open();
    document.querySelector('#quest-log .quest-log-close').dispatchEvent(
      new window.MouseEvent('click', { bubbles: true })
    );
    expect(log.isOpen).toBe(false);
  });

  it('removes itself on dispose, so a second session does not stack panels', () => {
    // D-50's shape: a session that ends must leave nothing behind for the next one.
    const log = makeLog();
    log.open();
    log.dispose();
    expect(document.getElementById('quest-log')).toBeNull();
  });

  it('escapes what it prints', () => {
    // Every string here is authored, but the log is the one surface that prints quest
    // text into `innerHTML`, and the habit is worth keeping honest.
    const log = makeLog();
    log.open();
    const html = document.getElementById('quest-log').innerHTML;
    expect(html).not.toContain('<script');
  });
});
