/**
 * Cuubz — Chunk / storage constants (PR 23)
 *
 * A LEAF. It imports nothing, so every one of the eleven files ChunkManager.js was
 * split into can read these without an import cycle. That is the whole reason it
 * exists as a file rather than living in ChunkManager.js: the method-group mixins are
 * imported BY ChunkManager.js, so anything they need from it has to come from
 * somewhere below it in the graph. `src/` has no import cycles and must not gain one —
 * `test/helpers/esmRequire.js` compiles these modules as CommonJS, which resolves a
 * cycle to `undefined` where real ESM would resolve it fine (D-28), so a cycle here
 * fails in Node long before anyone sees it in a browser.
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
