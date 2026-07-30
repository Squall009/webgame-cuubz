'use strict';

/**
 * Logging utility for Cuubz — toggles debug output in production.
 *
 * Usage:
 *   import { log, warn, error } from './util/logger.js';
 *   log('[Cuubz] Initializing...');        // Silent in production
 *   warn('[Audio] Init failed:', e.message);  // Always shown
 *   error('[Game] Fatal:', err);            // Always shown
 *
 * Enable debug mode: CuubzLogger.DEBUG = true;
 */

export class CuubzLogger {
  static DEBUG = false;

  static log(...args) {
    if (CuubzLogger.DEBUG && typeof console !== 'undefined') {
      console.log(...args);
    }
  }

  static warn(...args) {
    if (typeof console !== 'undefined') {
      console.warn(...args);
    }
  }

  static error(...args) {
    if (typeof console !== 'undefined') {
      console.error(...args);
    }
  }
}
