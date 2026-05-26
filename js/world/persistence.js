/**
 * Cuubz — IndexedDB Persistence System
 * Character saves + world chunk saves (separate stores).
 */

const DB_NAME = 'CuubzDB';
const DB_VERSION = 1;

class PersistenceManager {
  constructor() {
    this.db = null;
    this.dirtyChunks = new Map(); // "cx,cz" → chunkData
    this.saveInterval = 30000; // 30 seconds
    this.lastSaveTime = Date.now();
  }

  /**
   * Initialize IndexedDB
   */
  async init() {
    return new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        reject(new Error('IndexedDB not supported'));
        return;
      }
      
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        
        // Characters store
        if (!db.objectStoreNames.contains('characters')) {
          db.createObjectStore('characters', { keyPath: 'id' });
        }
        
        // Worlds store
        if (!db.objectStoreNames.contains('worlds')) {
          db.createObjectStore('worlds', { keyPath: 'id' });
        }
        
        // Chunks store
        if (!db.objectStoreNames.contains('chunks')) {
          const chunkStore = db.createObjectStore('chunks', { keyPath: 'key' });
          chunkStore.createIndex('worldId', 'worldId', { unique: false });
        }
      };
      
      request.onsuccess = (event) => {
        this.db = event.target.result;
        resolve(this.db);
      };
      
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Save character data
   */
  async saveCharacter(characterData) {
    const tx = this.db.transaction('characters', 'readwrite');
    const store = tx.objectStore('characters');
    store.put(characterData);
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  /**
   * Load all characters
   */
  async loadCharacters() {
    const tx = this.db.transaction('characters', 'readonly');
    const store = tx.objectStore('characters');
    return new Promise((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Delete character
   */
  async deleteCharacter(id) {
    const tx = this.db.transaction('characters', 'readwrite');
    const store = tx.objectStore('characters');
    store.delete(id);
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  /**
   * Save world metadata
   */
  async saveWorld(worldData) {
    const tx = this.db.transaction('worlds', 'readwrite');
    const store = tx.objectStore('worlds');
    store.put(worldData);
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  /**
   * Load all worlds
   */
  async loadWorlds() {
    const tx = this.db.transaction('worlds', 'readonly');
    const store = tx.objectStore('worlds');
    return new Promise((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Delete world and all its associated chunks
   */
  async deleteWorld(id) {
    // Delete the world metadata
    const tx1 = this.db.transaction('worlds', 'readwrite');
    const worldStore = tx1.objectStore('worlds');
    worldStore.delete(id);

    // Delete all chunks associated with this world
    const tx2 = this.db.transaction('chunks', 'readwrite');
    const chunkStore = tx2.objectStore('chunks');
    const index = chunkStore.index('worldId');
    
    // Get all chunk keys for this world
    const chunkKeys = await new Promise((resolve, reject) => {
      const request = index.getAll(id);
      request.onsuccess = () => {
        resolve(request.result.map(c => c.key));
      };
      request.onerror = () => reject(request.error);
    });

    // Delete each chunk
    for (const key of chunkKeys) {
      chunkStore.delete(key);
    }

    return new Promise((resolve, reject) => {
      tx1.oncomplete = () => {
        tx2.oncomplete = () => resolve();
        tx2.onerror = () => reject(tx2.error);
      };
      tx1.onerror = () => reject(tx1.error);
    });
  }

  /**
   * Queue a dirty chunk for saving
   */
  queueChunk(worldId, cx, cz, chunkData) {
    const key = `${worldId}_${cx}_${cz}`;
    this.dirtyChunks.set(key, { worldId, cx, cz, data: chunkData });
  }

  /**
   * Save dirty chunks to IndexedDB
   */
  async saveDirtyChunks() {
    if (this.dirtyChunks.size === 0) return;
    
    const tx = this.db.transaction('chunks', 'readwrite');
    const store = tx.objectStore('chunks');
    
    for (const [key, chunk] of this.dirtyChunks) {
      store.put({ key, worldId: chunk.worldId, cx: chunk.cx, cz: chunk.cz, data: chunk.data });
    }
    
    this.dirtyChunks.clear();
    
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  /**
   * Load a specific chunk
   */
  async loadChunk(worldId, cx, cz) {
    const key = `${worldId}_${cx}_${cz}`;
    const tx = this.db.transaction('chunks', 'readonly');
    const store = tx.objectStore('chunks');
    
    return new Promise((resolve, reject) => {
      const request = store.get(key);
      request.onsuccess = () => resolve(request.result ? request.result.data : null);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Periodic save check (call from game loop)
   */
  periodicSave() {
    const now = Date.now();
    if (now - this.lastSaveTime >= this.saveInterval) {
      this.saveDirtyChunks().then(() => {
        this.lastSaveTime = now;
      });
    }
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = PersistenceManager;

}