/**
 * Cuubz — Chunk / storage constants (PR 23)
 *
 * A LEAF. It imports nothing, so every one of the eleven files ChunkManager.js was
 * split into can read these without an import cycle. That is the whole reason it
 * exists as a file rather than living in ChunkManager.js: the method-group mixins are
 * imported BY ChunkManager.js, so anything they need from it has to come from
 * somewhere below it in the graph. `src/` has no import cycles and must not gain one.
 *
 * D-82: the reason given here used to be that `test/helpers/esmRequire.js` compiled these
 * modules as CommonJS and resolved a cycle to `undefined` where real ESM would not (D-28),
 * so a cycle failed in Node before anyone saw it in a browser. **PR 31 deleted that hook**
 * and Vitest loads real ES modules, so that specific early-warning is gone: a cycle would
 * now behave the same in the tests as in the browser — which means it fails LATER, not
 * never. The no-cycle rule stands on its own merits and this file is still a leaf.
 *
 * ChunkManager.js re-exports all six under their original names. Nothing that imported
 * them from there has to change.
 *
 * `DB_VERSION` IS NOT A NUMBER YOU MAY BUMP CASUALLY. Read the schema ladder comment
 * in ChunkSchema.js and DEPLOY.md §2.1 first: a version with no registered step aborts
 * the upgrade by design.
 */

export const CHUNK_W = 16;
export const CHUNK_D = 16;
export const DB_NAME = 'cuubz-worlds';
export const DB_VERSION = 2;
export const STORE_CHUNKS = 'chunks';
export const STORE_MANIFESTS = 'manifests';
