/**
 * Cuubz — localStorage access for the rejoin record (PR 16, refactor.md §8.3)
 *
 * ─── ONE KEY, ONE SHAPE, ONE WRITER ─────────────────────────────────────────
 *
 * `'cuubz_last_session'` is the record the game reads on the next page load to offer —
 * or perform — a rejoin. `refactor.md` §1.5 and §14 forbid changing the key string; it is
 * unchanged here and `REJOIN_STORAGE_KEY` is the only place it is spelled.
 *
 * Before this file there were **six** `setItem` calls on that key across `src/main.js`,
 * writing four different subsets of fields, and two of them were `beforeunload` handlers
 * registered on the same event. Both fired; the second-registered one ran second and its
 * write won. They disagreed about `mode`: the loser read the session's real mode off
 * `sessionManager._gameMode`, the winner read `#host-mode-select` for a host and
 * **hard-coded `'survival'` for a joiner** — so refreshing while joined to a creative
 * session rejoined into survival. That is `BUGS.md` **D-43**, and the fix is not deleting a
 * handler. It is that there is now exactly one function that writes this key,
 * `writeLastSession`, and exactly one function that decides what goes in the record,
 * `SessionManager.getSessionRecord()`.
 *
 * `normaliseSessionRecord` is what makes "one shape" enforceable rather than a convention:
 * every field the six sites between them used to write appears on every record, with an
 * explicit `null` when it is not known. A reader can therefore test a field for `null`
 * instead of testing whether the write site that produced this record happened to include
 * it — which is the property the six sites did not have.
 *
 * ─── WHY `globalThis.localStorage` AND NOT BARE `localStorage` ───────────────
 *
 * So `test/test_storageHelper.js` can install a fake and exercise the expiry and
 * corrupt-JSON paths in Node. A bare `localStorage` reference is a `ReferenceError` off the
 * browser, which the `try/catch`es here would swallow into "no saved session" — a test that
 * passes for the wrong reason. This is a property lookup on an object that exists in every
 * environment, **not** a `typeof X !== 'undefined'` guard (`BUGS.md` D-27, PR 33's).
 */

/** The localStorage key. Do not change it — refactor.md §1.5, §14. */
export const REJOIN_STORAGE_KEY = 'cuubz_last_session';

/** A saved session older than this is discarded on read. */
export const REJOIN_MAX_AGE = 24 * 60 * 60 * 1000; // 24 hours

/**
 * @returns {Storage|null} the host's localStorage, or null where there is none.
 */
function store() {
  return globalThis.localStorage || null;
}

/**
 * Every field the six former write sites used between them, in one shape.
 *
 * @param {Object} record
 * @returns {Object|null} the normalised record, or null if it has no `sessionId` —
 *   a record without one cannot be rejoined and must not be written.
 */
export function normaliseSessionRecord(record) {
  if (!record || !record.sessionId) return null;
  return {
    sessionId: record.sessionId,
    name: record.name || (record.isHost ? 'My Session' : 'Joined Session'),
    // The mode the session is actually running in. Never inferred from a form control
    // and never hard-coded — that was D-43.
    mode: record.mode || 'survival',
    seed: record.seed === undefined ? null : record.seed,
    isHost: !!record.isHost,
    // The relay-issued player id this session was joined under. D-109: without it a
    // reloaded page arrives as a stranger, and a **host** therefore could not reclaim its
    // own session — `attemptAutoRejoin` fell back to `hostSession()`, which creates a
    // second session with the first one's name rather than rejoining anything.
    playerId: record.playerId === undefined ? null : record.playerId,
    characterId: record.characterId === undefined ? null : record.characterId,
    worldId: record.worldId === undefined ? null : record.worldId,
    timestamp: record.timestamp || Date.now(),
  };
}

/**
 * Read the last saved session.
 *
 * @returns {Object|null} the record, or null when there is none, it is unparseable, it
 *   carries no `sessionId`, or it is older than {@link REJOIN_MAX_AGE}. An expired record
 *   is removed as a side effect, which is what the pre-PR-16 `getLastSession()` did.
 */
export function readLastSession() {
  try {
    const ls = store();
    if (!ls) return null;
    const raw = ls.getItem(REJOIN_STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || !data.sessionId) return null;
    if (Date.now() - data.timestamp > REJOIN_MAX_AGE) {
      ls.removeItem(REJOIN_STORAGE_KEY);
      return null;
    }
    return data;
  } catch (e) {
    // Corrupt JSON, a disabled store, or a quota-exceeded profile. There is no saved
    // session as far as the caller is concerned, and the caller has no repair to make.
    return null;
  }
}

/**
 * **The only writer of `'cuubz_last_session'` in the tree.** D-43.
 *
 * @param {Object} record — normalised by {@link normaliseSessionRecord} before it is stored.
 * @returns {Object|null} what was written, or null if nothing was.
 */
export function writeLastSession(record) {
  const normalised = normaliseSessionRecord(record);
  if (!normalised) return null;
  try {
    const ls = store();
    if (!ls) return null;
    ls.setItem(REJOIN_STORAGE_KEY, JSON.stringify(normalised));
    return normalised;
  } catch (e) {
    // A full or disabled localStorage costs the rejoin offer, nothing else.
    return null;
  }
}

/** Forget the saved session. */
export function clearLastSession() {
  try {
    const ls = store();
    if (ls) ls.removeItem(REJOIN_STORAGE_KEY);
  } catch (e) { /* ignore localStorage errors */ }
}
