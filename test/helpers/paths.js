/**
 * Cuubz — repo paths for the migrated test suite (PR 31)
 *
 * Eighteen of the migrated files build paths with `__dirname`, which does not exist in
 * an ES module. They also **moved**: `test/test_chunkStorage.js` is now
 * `test/unit/engine/chunkStorage.test.js`, two directories deeper, so every
 * `path.join(__dirname, '..', 'src', …)` in the body would have to be re-counted.
 *
 * Both problems are solved by one import. `TEST_DIR` is the `test/` directory — exactly
 * what `__dirname` used to be for every one of those files — so the migration aliases it
 * back:
 *
 *     import { TEST_DIR as __dirname } from '../../helpers/paths.js';
 *
 * and not one path expression in any body changes. `REPO_ROOT` is there for new code.
 */
'use strict';

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HELPERS_DIR = path.dirname(fileURLToPath(import.meta.url));

/** The `test/` directory — what `__dirname` meant in every pre-PR-31 test file. */
export const TEST_DIR = path.resolve(HELPERS_DIR, '..');

/** The repository root. */
export const REPO_ROOT = path.resolve(TEST_DIR, '..');
