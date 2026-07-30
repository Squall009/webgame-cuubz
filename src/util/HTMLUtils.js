/**
 * Cuubz — HTML helpers.
 *
 * `refactor.md` §4.1 gives `escapeHtml` its own home here. It had one definition inside
 * `main.js`'s IIFE and six call sites, every one of them interpolating player-controlled
 * text — character names, world names, session names, remote player names — into an
 * `innerHTML` template string. That is the only thing standing between a character called
 * `<img onerror=…>` and script execution in every other player's lobby, so it is worth a
 * module of its own rather than being a private function in a 4,800-line file.
 */

/**
 * Escape a string for safe interpolation into `innerHTML`.
 *
 * Implemented by round-tripping through a detached element's `textContent` rather than by
 * a replace chain: the browser's own serialiser decides what needs escaping, which is one
 * fewer thing to get wrong than a hand-written `&<>"'` table. Non-strings are coerced, so
 * `escapeHtml(undefined)` is `"undefined"` and never throws inside a template literal.
 *
 * @param {*} text
 * @returns {string}
 */
export function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
