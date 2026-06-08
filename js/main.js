/**
 * Cuubz — Main Entry Point
 * Menu system, play/host/join flow, screen management, character & world management.
 */

(function() {
  'use strict';

  // Debug logging — set CuubzLogger.DEBUG = true in browser console to enable
  const _log = typeof CuubzLogger !== 'undefined' ? CuubzLogger.log : function() {};

  // ============================================================
  // Screen Management
  // ============================================================

  const screens = {
    mainMenu: document.getElementById('main-menu'),
    characterScreen: document.getElementById('character-screen'),
    worldScreen: document.getElementById('world-screen'),
    modeScreen: document.getElementById('mode-screen'),
    settingsScreen: document.getElementById('settings-screen'),
    lobbyScreen: document.getElementById('lobby-screen'),
    loadingScreen: document.getElementById('loading-screen'),
  };

  // Modal elements (NOT in screens — they must NOT be hidden by showScreen)
  const modals = {
    createCharModal: document.getElementById('create-char-modal'),
    deleteCharModal: document.getElementById('delete-char-modal'),
    createWorldModal: document.getElementById('create-world-modal'),
  };

  // Additional screen elements for session UI
  const sessionUI = {
    connectionStatus: document.getElementById('connection-status'),
    connectionHud: document.getElementById('connection-hud'),
    playerListOverlay: document.getElementById('player-list-overlay'),
    playerCount: document.getElementById('player-count'),
    playerListItems: document.getElementById('player-list-items'),
    browsePanel: document.getElementById('browse-panel'),
    hostPanel: document.getElementById('host-panel'),
    sessionList: document.getElementById('session-list'),
    noSessionsMsg: document.getElementById('no-sessions-msg'),
  };

  function showScreen(name) {
    // Hide all screens
    Object.values(screens).forEach(el => {
      if (el) el.classList.add('hidden');
    });
    // Show target screen
    const target = screens[name];
    if (target) target.classList.remove('hidden');
  }

  // ============================================================
  // Character Manager (inline — runs in browser context)
  // ============================================================

  const MAX_CHARACTERS = 3;
  const MIN_NAME_LENGTH = 1;
  const MAX_NAME_LENGTH = 16;
  const DEFAULT_COLOR = '#4CAF50';

  /**
   * BrowserCharacterManager — Wraps PersistenceManager for browser UI.
   * Handles character CRUD with IndexedDB storage.
   */
  class BrowserCharacterManager {
    constructor(persistence) {
      this.persistence = persistence;
      this.characters = [];
      this.selectedId = null;
    }

    async init() {
      this.characters = await this.persistence.loadCharacters();
      return this.characters;
    }

    static validateName(name) {
      if (typeof name !== 'string') return { valid: false, error: 'Name must be a string' };
      const trimmed = name.trim();
      if (trimmed.length < MIN_NAME_LENGTH) return { valid: false, error: `Name must be at least ${MIN_NAME_LENGTH} character` };
      if (trimmed.length > MAX_NAME_LENGTH) return { valid: false, error: `Name must be at most ${MAX_NAME_LENGTH} characters` };
      if (!/^[a-zA-Z0-9 _\-]+$/.test(trimmed)) return { valid: false, error: 'Name can only contain letters, numbers, spaces, hyphens, and underscores' };
      return { valid: true };
    }

    static validateColor(color) {
      if (typeof color !== 'string') return { valid: false };
      if (/^#[0-9A-Fa-f]{6}$/.test(color)) return { valid: true, color: color.toUpperCase() };
      return { valid: false };
    }

    static generateId() {
      const ts = Date.now().toString(36);
      const rnd = Math.random().toString(36).substring(2, 8);
      return `char_${ts}_${rnd}`;
    }

    canCreateMore() {
      return this.characters.length < MAX_CHARACTERS;
    }

    getRemainingSlots() {
      return MAX_CHARACTERS - this.characters.length;
    }

    async createCharacter(name, color) {
      const nameResult = BrowserCharacterManager.validateName(name);
      if (!nameResult.valid) return { success: false, error: nameResult.error };

      const colorVal = color || DEFAULT_COLOR;
      const colorResult = BrowserCharacterManager.validateColor(colorVal);
      if (!colorResult.valid) return { success: false, error: 'Invalid color format' };

      if (!this.canCreateMore()) return { success: false, error: `Maximum ${MAX_CHARACTERS} characters reached` };

      const trimmedName = name.trim();
      const duplicate = this.characters.find(c => c.name.toLowerCase() === trimmedName.toLowerCase());
      if (duplicate) return { success: false, error: `Character "${duplicate.name}" already exists` };

      const id = BrowserCharacterManager.generateId();
      const character = {
        id,
        name: trimmedName,
        color: colorResult.color,
        inventory: [],
        spawnPoints: {},
        createdAt: Date.now(),
        lastPlayed: null,
      };

      await this.persistence.saveCharacter(character);
      this.characters.push(character);
      return { success: true, character };
    }

    async updateCharacter(id, updates) {
      const index = this.characters.findIndex(c => c.id === id);
      if (index === -1) return { success: false, error: 'Character not found' };

      const character = this.characters[index];

      if (updates.name !== undefined) {
        const nameResult = BrowserCharacterManager.validateName(updates.name);
        if (!nameResult.valid) return { success: false, error: nameResult.error };
        const trimmedName = updates.name.trim();
        const duplicate = this.characters.find(c => c.id !== id && c.name.toLowerCase() === trimmedName.toLowerCase());
        if (duplicate) return { success: false, error: `Character "${duplicate.name}" already exists` };
        character.name = trimmedName;
      }

      if (updates.color !== undefined) {
        const colorResult = BrowserCharacterManager.validateColor(updates.color);
        if (!colorResult.valid) return { success: false, error: 'Invalid color format' };
        character.color = colorResult.color;
      }

      await this.persistence.saveCharacter(character);
      this.characters[index] = character;
      return { success: true, character };
    }

    async deleteCharacter(id) {
      const index = this.characters.findIndex(c => c.id === id);
      if (index === -1) return { success: false, error: 'Character not found' };

      await this.persistence.deleteCharacter(id);
      this.characters.splice(index, 1);
      if (this.selectedId === id) this.selectedId = null;
      return { success: true };
    }

    getCharacter(id) {
      return this.characters.find(c => c.id === id) || null;
    }

    getAllCharacters() {
      return [...this.characters];
    }

    selectCharacter(id) {
      const character = this.getCharacter(id);
      if (!character) return { success: false, error: 'Character not found' };
      this.selectedId = id;
      character.lastPlayed = Date.now();
      return { success: true, character };
    }

    getSelectedCharacter() {
      if (!this.selectedId) return null;
      return this.getCharacter(this.selectedId);
    }

    clearSelection() {
      this.selectedId = null;
    }
  }

  // Global reference for game engine access
  let characterManager = null;
  let worldManager = null;

  // ============================================================
  // Character UI Rendering
  // ============================================================

  function renderCharacterSlots() {
    const container = document.getElementById('character-slots');
    const slotInfo = document.getElementById('char-slot-info');
    if (!container) return;

    container.innerHTML = '';

    // Render existing characters
    const characters = characterManager ? characterManager.getAllCharacters() : [];
    characters.forEach(char => {
      const slot = createCharacterSlotElement(char);
      container.appendChild(slot);
    });

    // Render empty slots
    for (let i = characters.length; i < MAX_CHARACTERS; i++) {
      const emptySlot = document.createElement('div');
      emptySlot.className = 'char-slot empty';
      emptySlot.innerHTML = '<span style="font-size:28px;color:#555;">+</span><span class="char-name">Empty</span>';
      container.appendChild(emptySlot);
    }

    // Update slot info text
    if (slotInfo) {
      const remaining = MAX_CHARACTERS - characters.length;
      slotInfo.textContent = `${characters.length}/${MAX_CHARACTERS} characters (${remaining} slots available)`;
    }

    // Update create button visibility
    const createBtn = document.getElementById('btn-create-char');
    if (createBtn) {
      if (characterManager && !characterManager.canCreateMore()) {
        createBtn.disabled = true;
        createBtn.textContent = 'Slots Full';
        createBtn.style.opacity = '0.5';
      } else {
        createBtn.disabled = false;
        createBtn.textContent = 'Create Character';
        createBtn.style.opacity = '1';
      }
    }
  }

  function createCharacterSlotElement(char) {
    const slot = document.createElement('div');
    slot.className = 'char-slot' + (characterManager && characterManager.selectedId === char.id ? ' selected' : '');
    slot.style.position = 'relative';
    slot.dataset.charId = char.id;

    // Avatar circle with character color
    slot.innerHTML = `
      <div class="char-avatar" style="background:${char.color};"></div>
      <span class="char-name">${escapeHtml(char.name)}</span>
      <div class="char-slot-actions">
        <button class="char-slot-action-btn edit" title="Edit character" data-action="edit">✎</button>
        <button class="char-slot-action-btn delete" title="Delete character" data-action="delete">✕</button>
      </div>
    `;

    // Click to select character → navigate to world screen
    slot.addEventListener('click', async (e) => {
      if (e.target.closest('.char-slot-action-btn')) return; // Don't trigger on action buttons
      if (characterManager) {
        await characterManager.selectCharacter(char.id);
        renderCharacterSlots();
        // Navigate to world selection after picking character
        showScreen('worldScreen');
        renderWorldSlots();
      }
    });

    // Edit button
    const editBtn = slot.querySelector('[data-action="edit"]');
    editBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openEditModal(char);
    });

    // Delete button
    const deleteBtn = slot.querySelector('[data-action="delete"]');
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openDeleteModal(char);
    });

    return slot;
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // ============================================================
  // Character Modal Handlers
  // ============================================================

  let editingCharId = null; // Set when editing existing character

  function openCreateModal() {
    editingCharId = null;
    document.getElementById('char-modal-title').textContent = 'Create New Character';
    document.getElementById('btn-save-char').textContent = 'Create';
    document.getElementById('char-name').value = '';
    document.getElementById('char-color').value = DEFAULT_COLOR;
    hideCharError();
    modals.createCharModal.classList.remove('hidden');
    setTimeout(() => document.getElementById('char-name').focus(), 100);
  }

  function openEditModal(char) {
    editingCharId = char.id;
    document.getElementById('char-modal-title').textContent = 'Edit Character';
    document.getElementById('btn-save-char').textContent = 'Save';
    document.getElementById('char-name').value = char.name;
    document.getElementById('char-color').value = char.color;
    hideCharError();
    modals.createCharModal.classList.remove('hidden');
    setTimeout(() => {
      const nameInput = document.getElementById('char-name');
      nameInput.focus();
      nameInput.select();
    }, 100);
  }

  function closeCharModal() {
    if (modals.createCharModal) {
      modals.createCharModal.classList.add('hidden');
    }
    editingCharId = null;
  }

  // ============================================================
  // World Modal Handlers
  // ============================================================

  function openCreateWorldModal() {
    document.getElementById('world-name').value = '';
    // Generate a random seed and display it (user can edit or leave blank for another random)
    const randomSeed = Math.floor(Math.random() * 0xFFFFFFFF);
    document.getElementById('world-seed').value = String(randomSeed);
    hideWorldError();
    modals.createWorldModal.classList.remove('hidden');
    // Force modal-content visible
    const mc = modals.createWorldModal.querySelector('.modal-content');
    if (mc) mc.style.display = 'block';
    setTimeout(() => document.getElementById('world-name').focus(), 100);
  }

  function closeCreateWorldModal() {
    if (modals.createWorldModal) {
      modals.createWorldModal.classList.add('hidden');
    }
  }

  function showWorldError(message) {
    const errorEl = document.getElementById('world-error');
    errorEl.textContent = message;
    errorEl.classList.remove('hidden');
  }

  function hideWorldError() {
    document.getElementById('world-error').classList.add('hidden');
  }

  function openDeleteModal(char) {
    document.getElementById('delete-char-name').textContent = `"${char.name}"`;
    modals.deleteCharModal.dataset.charId = char.id;
    modals.deleteCharModal.classList.remove('hidden');
  }

  function closeDeleteModal() {
    modals.deleteCharModal.classList.add('hidden');
    delete modals.deleteCharModal.dataset.charId;
  }

  // ============================================================
  // World Delete Modal Handlers
  // ============================================================

  function openDeleteWorldModal(world) {
    document.getElementById('delete-char-name').textContent = `"${world.name}"`;
    modals.deleteCharModal.dataset.worldId = world.id;
    modals.deleteCharModal.classList.remove('hidden');
  }

  function closeDeleteWorldModal() {
    modals.deleteCharModal.classList.add('hidden');
    delete modals.deleteCharModal.dataset.worldId;
  }

  function showCharError(message) {
    const errorEl = document.getElementById('char-error');
    errorEl.textContent = message;
    errorEl.classList.remove('hidden');
  }

  function hideCharError() {
    document.getElementById('char-error').classList.add('hidden');
  }

  // ============================================================
  // World Manager (inline — runs in browser context)
  // ============================================================

  const MAX_WORLDS = 3;
  const DEFAULT_WORLD_SEED = 42;

  /**
   * BrowserWorldManager — Wraps PersistenceManager for browser UI.
   * Handles world CRUD with IndexedDB storage.
   */
  class BrowserWorldManager {
    constructor(persistence) {
      this.persistence = persistence;
      this.worlds = [];
      this.selectedId = null;
    }

    async init() {
      this.worlds = await this.persistence.loadWorlds();
      return this.worlds;
    }

    static validateName(name) {
      if (typeof name !== 'string') return { valid: false, error: 'Name must be a string' };
      const trimmed = name.trim();
      if (trimmed.length < 1) return { valid: false, error: 'Name must be at least 1 character' };
      if (trimmed.length > 32) return { valid: false, error: 'Name must be at most 32 characters' };
      if (!/^[a-zA-Z0-9 _\-]+$/.test(trimmed)) return { valid: false, error: 'Name can only contain letters, numbers, spaces, hyphens, and underscores' };
      return { valid: true };
    }

    static generateId() {
      const ts = Date.now().toString(36);
      const rnd = Math.random().toString(36).substring(2, 8);
      return `world_${ts}_${rnd}`;
    }

    static generateSeed() {
      return Math.floor(Math.random() * 0xFFFFFFFF);
    }

    static formatSeed(seed) {
      return String(seed).padStart(8, '0');
    }

    canCreateMore() {
      return this.worlds.length < MAX_WORLDS;
    }

    getRemainingSlots() {
      return MAX_WORLDS - this.worlds.length;
    }

    async createWorld(name, seed) {
      const nameResult = BrowserWorldManager.validateName(name);
      if (!nameResult.valid) return { success: false, error: nameResult.error };

      if (!this.canCreateMore()) return { success: false, error: `Maximum ${MAX_WORLDS} worlds reached` };

      const trimmedName = name.trim();
      const duplicate = this.worlds.find(w => w.name.toLowerCase() === trimmedName.toLowerCase());
      if (duplicate) return { success: false, error: `World "${duplicate.name}" already exists` };

      const worldSeed = seed !== undefined ? seed : BrowserWorldManager.generateSeed();
      
      // Generate biome map metadata
      const lcg = (s) => (s * 16807 + 12345) % 2147483647;
      let s = worldSeed;
      const biomeNames = ['Plains', 'Forest', 'Desert', 'Tundra', 'Mountains', 'Ocean', 'Lava', 'Corrupt'];
      const count = 2 + (lcg(s) % 3);
      const biomes = [];
      const used = new Set();
      for (let i = 0; i < count; i++) {
        s = lcg(s);
        let idx = s % biomeNames.length;
        while (used.has(idx)) idx = (idx + 1) % biomeNames.length;
        used.add(idx);
        biomes.push(biomeNames[idx]);
      }

      const id = BrowserWorldManager.generateId();
      const world = {
        id,
        name: trimmedName,
        seed: worldSeed,
        biomeMap: { dominantBiomes: biomes, seed: worldSeed },
        questProgress: {},
        chunkReferences: [],
        createdAt: Date.now(),
        lastPlayed: null,
      };

      await this.persistence.saveWorld(world);
      this.worlds.push(world);
      return { success: true, world };
    }

    async updateWorld(id, updates) {
      const index = this.worlds.findIndex(w => w.id === id);
      if (index === -1) return { success: false, error: 'World not found' };

      const world = this.worlds[index];

      if (updates.name !== undefined) {
        const nameResult = BrowserWorldManager.validateName(updates.name);
        if (!nameResult.valid) return { success: false, error: nameResult.error };
        const trimmedName = updates.name.trim();
        const duplicate = this.worlds.find(w => w.id !== id && w.name.toLowerCase() === trimmedName.toLowerCase());
        if (duplicate) return { success: false, error: `World "${duplicate.name}" already exists` };
        world.name = trimmedName;
      }

      await this.persistence.saveWorld(world);
      this.worlds[index] = world;
      return { success: true, world };
    }

    async deleteWorld(id) {
      const index = this.worlds.findIndex(w => w.id === id);
      if (index === -1) return { success: false, error: 'World not found' };

      // Remove world metadata from PersistenceManager
      await this.persistence.deleteWorld(id);

      // Clean up all chunk data and manifest from IndexedDB to prevent orphaned storage.
      // ChunkStore uses the world ID as its namespace key, so we create a temporary instance.
      try {
        const store = new ChunkStore(id);
        await store.deleteWorld();
        store.close();
      } catch (err) {
        // Silently ignore chunk store cleanup errors on world deletion.
      }

      this.worlds.splice(index, 1);
      if (this.selectedId === id) this.selectedId = null;
      return { success: true };
    }

    getWorld(id) {
      return this.worlds.find(w => w.id === id) || null;
    }

    getAllWorlds() {
      return [...this.worlds];
    }

    async selectWorld(id) {
      const world = this.getWorld(id);
      if (!world) return { success: false, error: 'World not found' };
      this.selectedId = id;
      world.lastPlayed = Date.now();
      await this.persistence.saveWorld(world);
      return { success: true, world };
    }

    getSelectedWorld() {
      if (!this.selectedId) return null;
      return this.getWorld(this.selectedId);
    }

    clearSelection() {
      this.selectedId = null;
    }

    static getBiomePreview(world) {
      const biomes = world.biomeMap && world.biomeMap.dominantBiomes
        ? world.biomeMap.dominantBiomes.join(', ')
        : 'Unknown';
      const seed = BrowserWorldManager.formatSeed(world.seed);
      return { biomes, seed };
    }
  }

  // ============================================================
  // World UI Rendering
  // ============================================================

 function renderWorldSlots() {
    
    const container = document.getElementById('world-slots');
    if (!container) {
      _log('[Cuubz] #world-slots not found');;
      return;
    }

    container.innerHTML = '';

    let worlds = [];
    try {
      worlds = worldManager ? worldManager.getAllWorlds() : [];
    } catch (err) {
      console.error('[Cuubz] Error loading worlds for display:', err);
    }

    // Render existing worlds
    worlds.forEach(world => {
      try {
        const slot = createWorldSlotElement(world);
        container.appendChild(slot);
      } catch (err) {
        console.error('[Cuubz] Error rendering world slot:', err, world);
      }
    });

    // Render empty slots
    for (let i = worlds.length; i < MAX_WORLDS; i++) {
      const emptySlot = document.createElement('div');
      emptySlot.className = 'world-slot empty';
      emptySlot.innerHTML = '<span style="font-size:28px;color:#555;">+</span><span class="world-name">Empty</span>';
      container.appendChild(emptySlot);
    }

    // Update slot info text
    const worldSlotInfo = document.getElementById('world-slot-info');
    if (worldSlotInfo) {
      const remaining = MAX_WORLDS - worlds.length;
      worldSlotInfo.textContent = `${worlds.length}/${MAX_WORLDS} worlds (${remaining} slots available)`;
    }

    // Update create button visibility
    const createBtn = document.getElementById('btn-create-world');
    if (createBtn) {
      if (worldManager && !worldManager.canCreateMore()) {
        createBtn.disabled = true;
        createBtn.textContent = 'Slots Full';
        createBtn.style.opacity = '0.5';
      } else {
        createBtn.disabled = false;
        createBtn.textContent = 'Create New World';
        createBtn.style.opacity = '1';
      }
    }
  }

  function createWorldSlotElement(world) {
    const slot = document.createElement('div');
    slot.className = 'world-slot' + (worldManager && worldManager.selectedId === world.id ? ' selected' : '');
    slot.style.position = 'relative';
    slot.dataset.worldId = world.id;

    const preview = BrowserWorldManager.getBiomePreview(world);

    // Biome color indicator based on dominant biome
    const biomeColors = {
      'Plains': '#4CAF50', 'Forest': '#2E7D32', 'Desert': '#FFB300', 'Tundra': '#90CAF9',
      'Mountains': '#78909C', 'Ocean': '#1E88E5', 'Lava': '#E64A19', 'Corrupt': '#AB47BC'
    };
    const primaryBiome = preview.biomes.split(',')[0] || 'Plains';
    const biomeColor = biomeColors[primaryBiome] || '#4CAF50';

    slot.innerHTML = `
      <div class="world-icon" style="background:${biomeColor};" title="${preview.biomes}">🌍</div>
      <div class="world-info">
        <span class="world-name">${escapeHtml(world.name)}</span>
        <span class="world-seed">Seed: ${preview.seed}</span>
        <span class="world-biomes" title="${preview.biomes}">${preview.biomes}</span>
      </div>
      <div class="world-slot-actions">
        <button class="world-slot-action-btn delete" title="Delete world" data-action="delete">✕</button>
      </div>
    `;

    // Click to select world → go to mode screen
    slot.addEventListener('click', async (e) => {
      if (e.target.closest('.world-slot-action-btn')) return;
      if (worldManager) {
        await worldManager.selectWorld(world.id);
        renderWorldSlots();
        showScreen('modeScreen');
      }
    });

    // Delete button
    const deleteBtn = slot.querySelector('[data-action="delete"]');
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openDeleteWorldModal(world);
    });

    return slot;
  }

  // ============================================================
  // Menu Navigation
  // ============================================================

  function initMenuNavigation() {
    try {
        _log('[Cuubz] initMenuNavigation');
      // Main menu buttons
      document.getElementById('btn-play-solo').addEventListener('click', () => {
        showScreen('characterScreen');
        renderCharacterSlots();
      });

      document.getElementById('btn-host').addEventListener('click', () => {
      showScreen('lobbyScreen');
    });

    document.getElementById('btn-join').addEventListener('click', () => {
      showScreen('lobbyScreen');
    });

    document.getElementById('btn-settings').addEventListener('click', () => {
      showScreen('settingsScreen');
    });

    // Character screen — navigate to world screen after selecting character
    document.getElementById('btn-back-char').addEventListener('click', () => {
      showScreen('mainMenu');
    });

    document.getElementById('btn-create-char').addEventListener('click', () => {
      if (characterManager && !characterManager.canCreateMore()) return;
      openCreateModal();
    });

     // Character modal — save (create or edit character)
    document.getElementById('btn-save-char').addEventListener('click', async () => {
      const name = document.getElementById('char-name').value.trim();
      const color = document.getElementById('char-color').value;

      if (!name) { showCharError('Please enter a character name.'); return; }

      let result;
      if (editingCharId) {
        result = await characterManager.updateCharacter(editingCharId, { name, color });
      } else {
        result = await characterManager.createCharacter(name, color);
      }

      if (result.success) {
        closeCharModal();
        renderCharacterSlots();
        _log(`[Cuubz] Character ${editingCharId ? 'updated' : 'created'}: ${result.character.name}`);
      } else {
        showCharError(result.error);
      }
    });

    // Character modal — cancel
    document.getElementById('btn-cancel-char').addEventListener('click', closeCharModal);

    // Enter key in name input triggers save
    document.getElementById('char-name').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        document.getElementById('btn-save-char').click();
      }
      if (e.key === 'Escape') {
        closeCharModal();
      }
    });

    // Delete modal — handles both character and world deletion
    document.getElementById('btn-confirm-delete-char').addEventListener('click', async () => {
      const charId = modals.deleteCharModal.dataset.charId;
      const worldId = modals.deleteCharModal.dataset.worldId;

      if (worldId) {
        // Deleting a world
        const result = await worldManager.deleteWorld(worldId);
        if (result.success) {
          closeDeleteWorldModal();
          renderWorldSlots();
          _log(`[Cuubz] World deleted: ${worldId}`);
        } else {
          alert(result.error);
        }
      } else if (charId) {
        // Deleting a character
        const result = await characterManager.deleteCharacter(charId);
        if (result.success) {
          closeDeleteModal();
          renderCharacterSlots();
          _log(`[Cuubz] Character deleted: ${charId}`);
        } else {
          alert(result.error);
        }
      }
    });

    document.getElementById('btn-cancel-delete-char').addEventListener('click', () => {
      if (modals.deleteCharModal.dataset.worldId) {
        closeDeleteWorldModal();
      } else {
        closeDeleteModal();
      }
    });

    // World screen
    document.getElementById('btn-back-world').addEventListener('click', () => {
      showScreen('characterScreen');
    });

    // Create world button → open dedicated world modal
    document.getElementById('btn-create-world').addEventListener('click', () => {
      if (!worldManager || !worldManager.canCreateMore()) return;
      openCreateWorldModal();
    });

    // World modal save handler
    document.getElementById('btn-save-world').addEventListener('click', async () => {
      const name = document.getElementById('world-name').value.trim();
      if (!name) { showWorldError('Please enter a world name'); return; }

      // Parse seed from input — blank means random, invalid values fall back to random
      let seed = undefined;
      const seedInput = document.getElementById('world-seed').value.trim();
      if (seedInput !== '') {
        const parsed = parseInt(seedInput, 10);
        if (!isNaN(parsed)) {
          seed = parsed;
        } else {
          showWorldError('Seed must be a valid integer (or leave blank for random)');
          return;
        }
      }

      const result = await worldManager.createWorld(name, seed);
      if (result.success) {
        closeCreateWorldModal();
        renderWorldSlots();
      } else {
        showWorldError(result.error);
      }
    });

    document.getElementById('btn-cancel-world').addEventListener('click', closeCreateWorldModal);
    document.getElementById('world-name').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') document.getElementById('btn-save-world').click();
      if (e.key === 'Escape') closeCreateWorldModal();
    });

    // Mode screen
    document.getElementById('btn-back-mode').addEventListener('click', () => {
      showScreen('worldScreen');
    });

    document.getElementById('btn-survival').addEventListener('click', () => {
      _log('[Cuubz] Mode: Survival');
      startGame('survival');
    });

    document.getElementById('btn-creative').addEventListener('click', () => {
      _log('[Cuubz] Mode: Creative');
      startGame('creative');
    });

    // Settings screen
    document.getElementById('btn-back-settings').addEventListener('click', () => {
      showScreen('mainMenu');
    });

    // Render distance slider
    const renderSlider = document.getElementById('render-distance');
    const renderValue = document.getElementById('render-distance-value');
    if (renderSlider && renderValue) {
      renderSlider.addEventListener('input', () => {
        renderValue.textContent = renderSlider.value;
      });
    }

    // Volume slider
    const volumeSlider = document.getElementById('volume-slider');
    const volumeValue = document.getElementById('volume-value');
    if (volumeSlider && volumeValue) {
      volumeSlider.addEventListener('input', () => {
        volumeValue.textContent = volumeSlider.value + '%';
      });
    }

    // Lobby screen — session UI management
    document.getElementById('btn-back-lobby').addEventListener('click', () => {
      showScreen('mainMenu');
    });

    // Tab switching: Browse / Host
    document.getElementById('tab-browse').addEventListener('click', () => {
      switchLobbyTab('browse');
    });

    document.getElementById('tab-host').addEventListener('click', () => {
      switchLobbyTab('host');
    });

    // Refresh sessions button
    document.getElementById('btn-refresh-sessions').addEventListener('click', () => {
      if (sessionManager) {
        sessionManager.browseSessions();
      }
    });

    // Host form — max players slider
    const hostMaxPlayers = document.getElementById('host-max-players');
    const hostMaxPlayersValue = document.getElementById('host-max-players-value');
    if (hostMaxPlayers && hostMaxPlayersValue) {
      hostMaxPlayers.addEventListener('input', () => {
        hostMaxPlayersValue.textContent = hostMaxPlayers.value;
      });
    }

    // Start hosting button
    document.getElementById('btn-start-hosting').addEventListener('click', async () => {
      if (sessionManager) {
        await sessionManager.startHosting();
      }
    });

    initSessionUI();
    _log('[Cuubz] initMenuNavigation complete');
  } catch (e) {
    console.error('[Cuubz] initMenuNavigation CRASHED:', e.message, '\n', e.stack);
  }
}

  // ============================================================
  // Session UI Management
  // ============================================================

  let sessionManager = null;

  /**
   * Switch between Browse and Host tabs in lobby screen.
   * @param {'browse'|'host'} tab
   */
  function switchLobbyTab(tab) {
    const tabBrowse = document.getElementById('tab-browse');
    const tabHost = document.getElementById('tab-host');

    if (tab === 'browse') {
      tabBrowse.classList.add('active');
      tabHost.classList.remove('active');
      sessionUI.browsePanel.classList.remove('hidden');
      sessionUI.hostPanel.classList.add('hidden');
      // Auto-refresh sessions when switching to browse
      if (sessionManager) {
        sessionManager.browseSessions();
      }
    } else {
      tabHost.classList.add('active');
      tabBrowse.classList.remove('active');
      sessionUI.hostPanel.classList.remove('hidden');
      sessionUI.browsePanel.classList.add('hidden');
      // Populate world select dropdown when switching to host
      populateHostWorldSelect();
    }
  }

  /**
   * Populate the host form's world dropdown with available worlds.
   */
  function populateHostWorldSelect() {
    const select = document.getElementById('host-world-select');
    if (!select) return;

    select.innerHTML = '';
    const worlds = worldManager ? worldManager.getAllWorlds() : [];

    if (worlds.length === 0) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = 'No worlds available';
      select.appendChild(opt);
      return;
    }

    worlds.forEach(w => {
      const opt = document.createElement('option');
      opt.value = w.id;
      opt.textContent = `${w.name} (seed: ${BrowserWorldManager.formatSeed(w.seed)})`;
      select.appendChild(opt);
    });
  }

  /**
   * Update connection status indicator in lobby and HUD.
   * @param {'disconnected'|'connecting'|'connected'|'reconnecting'} status
   */
  function updateConnectionStatus(status) {
    const statusTexts = {
      disconnected: 'Disconnected',
      connecting: 'Connecting...',
      connected: 'Connected',
      reconnecting: 'Reconnecting...',
    };

    // Lobby connection status
    if (sessionUI.connectionStatus) {
      sessionUI.connectionStatus.className = `connection-status ${status}`;
      const textEl = sessionUI.connectionStatus.querySelector('.status-text');
      if (textEl) textEl.textContent = statusTexts[status] || status;
    }

    // In-game connection HUD
    if (sessionUI.connectionHud) {
      sessionUI.connectionHud.className = `connection-hud ${status}`;
      const hudText = sessionUI.connectionHud.querySelector('.status-text');
      if (hudText) hudText.textContent = statusTexts[status] || status;
    }
  }

  /**
   * Render the session list in browse panel.
   * @param {Array} sessions — Array of session objects from server
   */
  function renderSessionList(sessions) {
    const container = sessionUI.sessionList;
    const noMsg = sessionUI.noSessionsMsg;
    if (!container) return;

    container.innerHTML = '';

    if (!sessions || sessions.length === 0) {
      if (noMsg) noMsg.classList.remove('hidden');
      return;
    }

    if (noMsg) noMsg.classList.add('hidden');

    sessions.forEach(session => {
      const item = document.createElement('div');
      item.className = 'session-item';
      const playerCount = session.players || 0;
      const maxPlayers = session.maxPlayers || 4;
      const mode = session.mode || 'survival';
      const isFull = playerCount >= maxPlayers;

      item.innerHTML = `
        <div class="session-info">
          <div class="session-name">${escapeHtml(session.name)}</div>
          <div class="session-details">${mode.charAt(0).toUpperCase() + mode.slice(1)} · ${session.seed ? 'Seed: ' + session.seed : ''}</div>
        </div>
        <div class="session-players">
          ${isFull ? '<span style="color:#e74c3c;">Full</span>' : `${playerCount}/${maxPlayers}`}
        </div>
      `;

      if (!isFull) {
        item.addEventListener('click', () => {
          if (sessionManager) {
            sessionManager.joinSession(session.sessionId);
          }
        });
      } else {
        item.style.opacity = '0.5';
        item.style.cursor = 'not-allowed';
      }

      container.appendChild(item);
    });
  }

  /**
   * Render the in-game player list overlay.
   * @param {Array} players — Array of player objects with name, color, health
   */
  function renderPlayerList(players) {
    const overlay = sessionUI.playerListOverlay;
    const itemsContainer = sessionUI.playerListItems;
    const countEl = sessionUI.playerCount;

    if (!overlay || !itemsContainer) return;

    // Show overlay when in multiplayer game
    overlay.classList.remove('hidden');
    itemsContainer.innerHTML = '';

    if (countEl) {
      countEl.textContent = players ? players.length : 0;
    }

    if (!players || players.length === 0) return;

    players.forEach(player => {
      const item = document.createElement('div');
      item.className = 'player-list-item';

      const healthPercent = player.health !== undefined ? Math.max(0, Math.min(100, player.health)) : 100;
      const healthColor = healthPercent > 60 ? '#4CAF50' : healthPercent > 30 ? '#f1c40f' : '#e74c3c';

      item.innerHTML = `
        <span class="player-color-dot" style="background:${escapeHtml(player.color || '#ffffff')}"></span>
        <span class="player-name-text">${escapeHtml(player.name || 'Player')}</span>
        <div class="player-health-bar">
          <div class="player-health-fill" style="width:${healthPercent}%;background:${healthColor};"></div>
        </div>
      `;

      itemsContainer.appendChild(item);
    });
  }

  /**
   * Hide the in-game player list overlay.
   */
  function hidePlayerList() {
    if (sessionUI.playerListOverlay) {
      sessionUI.playerListOverlay.classList.add('hidden');
    }
    if (sessionUI.connectionHud) {
      sessionUI.connectionHud.classList.add('hidden');
    }
  }

  /**
   * SessionManager — Handles multiplayer session lifecycle in the browser.
   * Wraps MultiplayerClient for UI integration.
   */
  class SessionManager {
    constructor() {
      this.client = null; // MultiplayerClient instance (created when connecting)
      this.sessions = [];
      this.currentSessionId = null;
      this.hostingSessionId = null;
      this.players = [];
      this._browseCallback = null;
      this._hostCreatedCallback = null;
      this._joinAcceptedCallback = null;
      this._joinRejectedCallback = null;
      this._playerJoinedCallback = null;
      this._playerLeftCallback = null;
    }

    /**
     * Initialize the WebSocket client for matchmaking.
     * @param {string} serverUrl — WebSocket URL for matchmaking (e.g., ws://localhost:8765)
     */
    init(serverUrl) {
      this._serverUrl = serverUrl || 'ws://localhost:8765';

      if (typeof MultiplayerClient !== 'undefined') {
        const urlObj = new URL(this._serverUrl);
        // TEMPORARY DISABLE: WebSocket proxy not configured yet. Re-enable after NPM /ws location is set up.
        console.log('[Cuubz] Multiplayer disabled — WebSocket proxy at', this._serverUrl, 'not configured yet.');
        return;

        this.client = new MultiplayerClient({ url: this._serverUrl });
        this._wireClientEvents();
      } else {
        console.warn('[SessionManager] MultiplayerClient not loaded — offline mode');
      }
    }

    /** Wire up client events to UI updates */
    _wireClientEvents() {
      if (!this.client) return;

      this.client.on('SESSION_LIST', (data) => {
        this.sessions = data.sessions || [];
        renderSessionList(this.sessions);
        if (this._browseCallback) this._browseCallback(this.sessions);
      });

      this.client.on('HOST_CREATED', (data) => {
        this.hostingSessionId = data.sessionId;
        updateConnectionStatus('connected');
        if (this._hostCreatedCallback) this._hostCreatedCallback(data);
      });

      this.client.on('JOIN_ACCEPTED', (data) => {
        this.currentSessionId = data.sessionId;
        updateConnectionStatus('connected');
        if (this._joinAcceptedCallback) this._joinAcceptedCallback(data);
      });

      this.client.on('JOIN_REJECTED', (data) => {
        const reason = data.reason || 'Unknown error';
        showHostError(`Join failed: ${reason}`);
        if (this._joinRejectedCallback) this._joinRejectedCallback(data);
      });

      this.client.on('PLAYER_JOINED', (data) => {
        this.players.push(data.player);
        renderPlayerList(this.players);
        if (this._playerJoinedCallback) this._playerJoinedCallback(data);
      });

      this.client.on('PLAYER_LEFT', (data) => {
        this.players = this.players.filter(p => p.id !== data.playerId);
        renderPlayerList(this.players);
        if (this._playerLeftCallback) this._playerLeftCallback(data);
      });

      this.client.on('disconnect', () => {
        updateConnectionStatus('disconnected');
      });

      this.client.on('stateChange', (data) => {
        const statusMap = {
          disconnected: 'disconnected',
          connecting: 'connecting',
          connected: 'connected',
          reconnecting: 'reconnecting',
        };
        updateConnectionStatus(statusMap[data.to] || 'disconnected');
      });

      // Connect to matchmaking server
      this.client.connectMatchmaking();
    }

    /** Browse available sessions */
    browseSessions() {
      if (this.client) {
        this.client.browseSessions();
      } else {
        // Offline mode — show empty list
        renderSessionList([]);
      }
    }

    /**
     * Start hosting a new session.
     * Validates form inputs and creates the session on the server.
     */
    /**
     * Start hosting a multiplayer session.
     * @param {Object} [options] — Optional configuration
     * @param {Function} [options.onBlockBreakValidated] — Called when remote player breaks block (host marks chunk dirty)
     * @param {Function} [options.onBlockPlaceValidated] — Called when remote player places block (host marks chunk dirty)
     */
    async startHosting(options = {}) {
      const nameInput = document.getElementById('host-session-name');
      const worldSelect = document.getElementById('host-world-select');
      const modeSelect = document.getElementById('host-mode-select');
      const maxPlayersSlider = document.getElementById('host-max-players');

      hideHostError();

      // Validate session name
      const name = nameInput ? nameInput.value.trim() : '';
      if (!name) {
        showHostError('Please enter a session name.');
        return;
      }
      if (name.length > 32) {
        showHostError('Session name must be 32 characters or less.');
        return;
      }

      // Validate world selection
      const worldId = worldSelect ? worldSelect.value : '';
      if (!worldId) {
        showHostError('Please create a world first (go to Play Solo → Create World).');
        return;
      }

      const mode = modeSelect ? modeSelect.value : 'survival';
      const maxPlayers = parseInt(maxPlayersSlider ? maxPlayersSlider.value : '4', 10);

      // Get world seed
      const selectedWorld = worldManager ? worldManager.getWorld(worldId) : null;
      if (!selectedWorld) {
        showHostError('Selected world not found.');
        return;
      }

      updateConnectionStatus('connecting');

      if (this.client) {
        try {
          await this.client.hostSession({
            name,
            seed: selectedWorld.seed,
            mode,
            maxPlayers,
          });
          _log(`[SessionManager] Hosting session: ${name}`);
        } catch (err) {
          updateConnectionStatus('disconnected');
          showHostError(`Failed to host: ${err.message}`);
        }
      } else {
        // Offline simulation
        this.hostingSessionId = `session_${Date.now()}`;
        updateConnectionStatus('connected');
        _log(`[SessionManager] Simulated hosting: ${name} (offline)`);
      }

      // Wire up block validation callbacks for host persistence to IndexedDB.
      // These fire when remote players break/place blocks — the host validates via relay,
      // then marks chunks dirty so they get flushed to ChunkStore on next interval.
      if (this.client) {
        const { onBlockBreakValidated, onBlockPlaceValidated } = options;

        if (onBlockBreakValidated) {
          this.client.onGame('BLOCK_BREAK', (data) => {
            try {
              onBlockBreakValidated(data);
            } catch (err) {
              console.error('[SessionManager] Error in BLOCK_BREAK handler:', err.message);
            }
          });
        }

        if (onBlockPlaceValidated) {
          this.client.onGame('BLOCK_PLACE', (data) => {
            try {
              onBlockPlaceValidated(data);
            } catch (err) {
              console.error('[SessionManager] Error in BLOCK_PLACE handler:', err.message);
            }
          });
        }

        _log('[SessionManager] Host block validation callbacks wired');
      }
    }

    /**
     * Join an existing session by its ID.
     * @param {string} sessionId
     */
    async joinSession(sessionId) {
      if (!sessionId) return;

      updateConnectionStatus('connecting');

      if (this.client) {
        try {
          await this.client.joinSession(sessionId);
          _log(`[SessionManager] Joined session: ${sessionId}`);
        } catch (err) {
          updateConnectionStatus('disconnected');
          showHostError(`Failed to join: ${err.message}`);
        }
      } else {
        // Offline simulation
        this.currentSessionId = sessionId;
        updateConnectionStatus('connected');
        _log(`[SessionManager] Simulated joining: ${sessionId} (offline)`);
      }
    }

    /** Leave the current session */
    leaveSession() {
      if (this.client) {
        this.client.leaveSession();
      }
      this.currentSessionId = null;
      this.hostingSessionId = null;
      this.players = [];
      updateConnectionStatus('disconnected');
      hidePlayerList();
    }

    /**
     * Register host-side block validation callbacks after game session starts.
     * Called from startGame() when chunkManager and dirtyFlush are available.
     * @param {Function} onBlockBreakValidated — (data: {x, y, z, chunkX, chunkZ}) => void
     * @param {Function} onBlockPlaceValidated — (data: {x, y, z, blockType, chunkX, chunkZ}) => void
     */
    registerHostCallbacks(onBlockBreakValidated, onBlockPlaceValidated) {
      if (!this.client || !this.hostingSessionId) return;

      if (onBlockBreakValidated) {
        this.client.onGame('BLOCK_BREAK', (data) => {
          try {
            onBlockBreakValidated(data);
          } catch (err) {
            console.error('[SessionManager] Error in BLOCK_BREAK handler:', err.message);
          }
        });
      }

      if (onBlockPlaceValidated) {
        this.client.onGame('BLOCK_PLACE', (data) => {
          try {
            onBlockPlaceValidated(data);
          } catch (err) {
            console.error('[SessionManager] Error in BLOCK_PLACE handler:', err.message);
          }
        });
      }

      _log('[SessionManager] Host callbacks registered for IndexedDB persistence');
    }

    /**
     * Register client-side block delta callbacks after game session starts.
     * Called from startGame() when joining a session (not hosting).
     * Applies remote deltas visually without persisting to IndexedDB — only the host persists.
     * @param {Function} onBlockBreak — (data: {x, y, z, chunkX, chunkZ}) => void
     * @param {Function} onBlockPlace — (data: {x, y, z, blockType, chunkX, chunkZ}) => void
     */
    registerClientCallbacks(onBlockBreak, onBlockPlace) {
      if (!this.client || !this.currentSessionId || this.hostingSessionId) return;

      if (onBlockBreak) {
        this.client.onGame('BLOCK_BREAK', (data) => {
          try {
            onBlockBreak(data);
          } catch (err) {
            console.error('[SessionManager] Error in client BLOCK_BREAK handler:', err.message);
          }
        });
      }

      if (onBlockPlace) {
        this.client.onGame('BLOCK_PLACE', (data) => {
          try {
            onBlockPlace(data);
          } catch (err) {
            console.error('[SessionManager] Error in client BLOCK_PLACE handler:', err.message);
          }
        });
      }

      _log('[SessionManager] Client delta callbacks registered (visual only, no persistence)');
    }

    /** Dispose and clean up */
    dispose() {
      if (this.client) {
        this.client.dispose();
        this.client = null;
      }
    }
  }

  /** Show error message in host form */
  function showHostError(message) {
    const errorEl = document.getElementById('host-error');
    if (!errorEl) return;
    errorEl.textContent = message;
    errorEl.classList.remove('hidden');
  }

  /** Hide error message in host form */
  function hideHostError() {
    const errorEl = document.getElementById('host-error');
    if (errorEl) errorEl.classList.add('hidden');
  }

  /**
   * Determine the correct WebSocket relay URL based on page origin.
   * Auto-detects whether running locally or deployed behind NPM proxy.
   *
   * @param {string} [pageOrigin] — Override for testing (e.g., 'https://webgame-cuubz.thehomelabguy.com')
   * @returns {string} WebSocket URL for the matchmaking relay server
   */
  function getRelayUrl(pageOrigin) {
    // Allow override via URL query parameter: ?relayUrl=ws://custom-host:8765
    if (typeof location !== 'undefined' && location.search) {
      const params = new URLSearchParams(location.search);
      const relayOverride = params.get('relayUrl');
      if (relayOverride) return relayOverride;
    }

    // Route WebSocket through the same domain via /ws path — reuses existing SSL cert.
    // Nginx reverse proxy forwards /ws to the relay server on port 8765.
    const origin = pageOrigin || (typeof location !== 'undefined' ? location.origin : '');
    if (origin) {
      const base = origin.replace('https://', 'wss://').replace('http://', 'ws://');
      return `${base}/ws`;
    }

    // Default: localhost for local development / direct server access
    return 'ws://localhost:8765';
  }

  /** Initialize session UI — create SessionManager and set defaults */
  function initSessionUI() {
    // Create session manager instance
    sessionManager = new SessionManager();

    // Determine relay URL based on deployment context
    const relayUrl = getRelayUrl();
    _log(`[SessionManager] Relay URL: ${relayUrl}`);

    // Initialize WebSocket client with auto-detected relay URL
    sessionManager.init(relayUrl);

    // Default to disconnected state (will update when connection established)
    updateConnectionStatus('disconnected');

    // Hide in-game overlays by default
    hidePlayerList();

    _log('[SessionManager] Initialized with WebSocket client');
  }

  // ============================================================
  // Game Start
  // ============================================================

  async function startGame(mode) {
    _log(`[Cuubz] Starting game in ${mode} mode...`);

    const selected = characterManager ? characterManager.getSelectedCharacter() : null;
    if (!selected) {
      console.warn('[Cuubz] No character selected!');
      showScreen('characterScreen');
      return;
    }

    _log(`[Cuubz] Playing as: ${selected.name} (${selected.color})`);

    // Show loading screen
    showScreen('loadingScreen');
    const loadingStatus = document.getElementById('loading-status');
    const loadingProgress = document.getElementById('loading-progress');

    // Get selected world
    const currentWorld = worldManager ? worldManager.getSelectedWorld() : null;
    if (!currentWorld) {
      console.warn('[Cuubz] No world selected!');
      showScreen('worldScreen');
      return;
    }

    loadingStatus.textContent = 'Initializing renderer...';
    if (loadingProgress) loadingProgress.style.width = '10%';

    setTimeout(async () => {
      try {
        // Hide all UI screens
        Object.values(screens).forEach(el => { if (el) el.classList.add('hidden'); });

        const container = document.getElementById('game-container');
        container.innerHTML = '';

        // Initialize VoxelRenderer
        loadingStatus.textContent = 'Building 3D scene...';
        if (loadingProgress) loadingProgress.style.width = '30%';

        const renderer = new VoxelRenderer(container, window.innerWidth, window.innerHeight);
        _log('[Cuubz] Renderer created');

        // Initialize Input Systems
        loadingStatus.textContent = 'Setting up controls...';
        if (loadingProgress) loadingProgress.style.width = '40%';

        const keyboard = new KeyboardInput();
        const touch = new TouchInput();
        const canvas = renderer.domElement;
        const mouse = new MouseInput(canvas);

        // Request pointer lock on canvas click
        canvas.addEventListener('click', () => {
          if (!mouse.locked) {
            mouse.requestPointerLock();
          }
        });

        // Initialize World Generator first (needed for spawn height)
        const sensitivity = 0.002;
        loadingStatus.textContent = 'Generating terrain...';
        if (loadingProgress) loadingProgress.style.width = '50%';

        const worldGen = new WorldGenerator(currentWorld.seed);

        // Initialize worker pool for multi-threaded chunk generation.
        loadingStatus.textContent = 'Initializing workers...';
        if (loadingProgress) loadingProgress.style.width = '55%';
        await worldGen.init('js/world/workerGeneration.js');

        // Initialize Texture Atlas (async)
        loadingStatus.textContent = 'Loading textures...';
        if (loadingProgress) loadingProgress.style.width = '60%';

        const textureAtlas = new TextureAtlas();
        await textureAtlas.buildAtlas();

        // Wire up texture atlas to debug overlay (top-right corner)
        const atlasOverlay = document.getElementById('atlas-overlay');
        const atlasCanvasEl = document.getElementById('atlas-canvas');
        if (atlasOverlay && atlasCanvasEl && textureAtlas.canvas) {
          const ctx = atlasCanvasEl.getContext('2d');
          const srcW = textureAtlas.canvas.width;
          const srcH = textureAtlas.canvas.height;

          // Scale canvas to fit nicely in the overlay (max 300px wide)
          const maxDisplayWidth = Math.min(300, window.innerWidth - 40);
          const scale = maxDisplayWidth / srcW;
          atlasCanvasEl.width = Math.round(srcW * scale);
          atlasCanvasEl.height = Math.round(srcH * scale);

          // Draw the atlas scaled down
          ctx.imageSmoothingEnabled = false; // Keep pixelated
          ctx.drawImage(textureAtlas.canvas, 0, 0, atlasCanvasEl.width, atlasCanvasEl.height);

          // Draw block ID labels on each tile for visual verification
          const debugInfo = textureAtlas.getDebugInfo();
          if (debugInfo) {
            ctx.font = `bold ${Math.max(8, Math.round(10 * scale))}px monospace`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';

            for (const info of debugInfo) {
              const x = info.col * srcW / textureAtlas.gridW;
              const y = info.row * srcH / textureAtlas.gridH;
              const w = srcW / textureAtlas.gridW;
              const h = srcH / textureAtlas.gridH;

              // Draw label background
              ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
              ctx.fillRect(x * scale, y * scale, w * scale, Math.min(h * scale, 14 * scale));

              // Draw block ID text
              ctx.fillStyle = '#ffffff';
              const label = `${info.blockId}_${info.sideNum}`;
              ctx.fillText(label, (x + w / 2) * scale, (y + h / 2 - 1) * scale);
            }
          }

          // Draw grid lines
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
          ctx.lineWidth = 1;
          for (let col = 0; col <= textureAtlas.gridW; col++) {
            const gx = (col * srcW / textureAtlas.gridW) * scale;
            ctx.beginPath();
            ctx.moveTo(gx, 0);
            ctx.lineTo(gx, atlasCanvasEl.height);
            ctx.stroke();
          }
          for (let row = 0; row <= textureAtlas.gridH; row++) {
            const gy = (row * srcH / textureAtlas.gridH) * scale;
            ctx.beginPath();
            ctx.moveTo(0, gy);
            ctx.lineTo(atlasCanvasEl.width, gy);
            ctx.stroke();
          }

          // atlasOverlay stays hidden — remove this line to show debug overlay during gameplay
// Texture atlas built — no log
        }

        // Initialize Chunk Manager with texture atlas + new IndexedDB storage system
        loadingStatus.textContent = 'Loading chunks...';
        if (loadingProgress) loadingProgress.style.width = '85%';

        // Create IndexedDB-backed chunk store (opens lazily on first use)
        const worldName = currentWorld.id;
        const chunkStore = new ChunkStore(worldName);

        // Load or create world manifest
        let manifest = await chunkStore.loadManifest();
        if (!manifest) {
          manifest = {
            worldName: currentWorld.name,
            seed: currentWorld.seed,
            createdAt: Date.now(),
            lastPlayed: Date.now(),
            playerCount: 1,
            spawnPoint: { x: 0, y: 68, z: 0 },
            generatedChunks: [],
          };
          await chunkStore.saveManifest(manifest);
          _log(`[Cuubz] Created new world manifest for "${worldName}"`);
        } else {
          // Update last played time
          manifest.lastPlayed = Date.now();
          await chunkStore.saveManifest(manifest);
          _log(`[Cuubz] Loaded existing world manifest (${manifest.generatedChunks.length} chunks saved)`);
        }

        // Create dirty flush manager (periodic auto-save)
        const dirtyFlush = new DirtyFlushManager(chunkStore, {
          flushInterval: 5000, // Flush every 5 seconds
        });
        dirtyFlush.start();

        // Load initial chunks around spawn via update (renderDistance 8 = ~17x17 chunk area)
        const chunkManager = new ChunkManager(renderer, worldGen.generateChunk.bind(worldGen), {
          textureAtlas: textureAtlas,
          renderDistance: 8,
          // New storage system
          chunkStore: chunkStore,
          dirtyFlush: dirtyFlush,
        });
        chunkManager.update(0, 0, performance.now());

        // Start periodic chunk update timer — ensures orphaned chunks are unloaded regardless of player position
        chunkManager.startTickTimer();

        // Wire up host block validation callbacks for multiplayer persistence to IndexedDB.
        // When hosting a session, remote player block changes arrive via MultiplayerClient game events.
        // These callbacks apply the change locally and mark chunks dirty for ChunkStore flush.
        if (sessionManager && sessionManager.hostingSessionId) {
// Host callbacks wired — no log

          const applyRemoteBlockChange = (data, newBlockType) => {
            try {
              // Apply the block change locally through ChunkManager.
              // This already handles marking chunks dirty for IndexedDB flush internally.
              chunkManager.applyBlockChange(data.x, data.y, data.z, newBlockType);

// Remote block change applied — no log
            } catch (err) {
              console.error('[Cuubz] Error applying remote block change:', err.message, '\n', err.stack);
            }
          };

          // Register callbacks with SessionManager's game event handlers
          sessionManager.registerHostCallbacks(
            (data) => applyRemoteBlockChange(data, 0),  // BLOCK_BREAK → AIR
            (data) => applyRemoteBlockChange(data, data.blockType || 1)  // BLOCK_PLACE → blockType
          );
        } else if (sessionManager && sessionManager.currentSessionId) {
          // Client-side: Joiner applies remote deltas visually without persisting to IndexedDB.
          // Only the host owns storage writes — joiners just update their local meshes.
// Client callbacks wired — no log

          const applyRemoteDelta = (data, newBlockType) => {
            try {
              chunkManager.applyBlockChange(data.x, data.y, data.z, newBlockType, { persist: false });
// Client delta applied — no log
            } catch (err) {
              console.error('[Cuubz] Error applying client delta:', err.message, '\n', err.stack);
            }
          };

          sessionManager.registerClientCallbacks(
            (data) => applyRemoteDelta(data, 0),  // BLOCK_BREAK → AIR
            (data) => applyRemoteDelta(data, data.blockType || 1)  // BLOCK_PLACE → blockType
          );
        }

        // Initialize Water Flow System (after ChunkManager is created)
        // DISABLED: water flow system needs overhaul
        // const waterFlowSystem = new WaterFlowSystem(worldManager, chunkManager);

        // Wait for initial chunks to finish building, then link neighbors and rebuild meshes
        function waitForChunksAndLink() {
          if (chunkManager.building) {
            setTimeout(waitForChunksAndLink, 50);
            return;
          }

          // All chunks loaded — link neighbor references for correct face culling
          chunkManager.linkNeighbors();

          // Rebuild all chunk meshes with proper neighbor data
          let rebuiltCount = 0;
          for (const [key, entry] of chunkManager.loadedChunks) {
            if (entry.data && entry.built) {
              const [cx, cz] = key.split(',').map(Number);
              chunkManager.rebuildChunkMesh(cx, cz);
              rebuiltCount++;
            }
          }

// Neighbors linked — no log

          // Calculate spawn position — search all loaded chunks for dry plains surface (GRASS/DIRT)
          // Must have: ground block above sea level, no water directly above it, adjacent columns clear
          let bestSpawnX = 0, bestSpawnZ = 0, bestSpawnY = MIN_Y;
          let debugCandidates = 0, debugRejectedByWater = 0, debugRejectedByAdjacent = 0, debugAccepted = 0;

          function isColumnClear(entry, lx, lz, fromY, toY) {
            // Check that all blocks from 'fromY' up to 'toY' are AIR (no solid blocks, no water)
            for (let y = fromY; y <= toY; y++) {
              const block = entry.data.getBlock(lx, y, lz);
              if (block !== BLOCK_TYPES.AIR && block !== BLOCK_TYPES.WATER) {
                // Allow water if it's below the fromY, but not above
                if (block === BLOCK_TYPES.WATER && y < fromY) continue;
                return false; // Found solid block or water at/above spawn height
              }
            }
            return true;
          }

          function isAdjacentClear(entry, lx, lz, spawnY, cx, cz) {
            // Check the 8 adjacent columns at spawn height and one above — must be AIR
            for (let dx = -1; dx <= 1; dx++) {
              for (let dz = -1; dz <= 1; dz++) {
                if (dx === 0 && dz === 0) continue; // Skip center column
                const nx = lx + dx, nz = lz + dz;

                // If within this chunk, check directly
                if (nx >= 0 && nx < 16 && nz >= 0 && nz < 16) {
                  if (!isColumnClear(entry, nx, nz, spawnY - 2, spawnY + 3)) return false;
                  continue;
                }

                // If outside this chunk boundary, check the neighbor chunk instead of rejecting outright
                const neighborCx = cx + Math.floor(nx / 16);
                const neighborCz = cz + Math.floor(nz / 16);
                const key = `${neighborCx},${neighborCz}`;
                const neighborEntry = chunkManager.loadedChunks.get(key);

                // If neighbor chunk exists and is built, check it
                if (neighborEntry?.data && neighborEntry.built) {
                  const localNx = ((nx % 16) + 16) % 16;
                  const localNz = ((nz % 16) + 16) % 16;
                  if (!isColumnClear(neighborEntry, localNx, localNz, spawnY - 2, spawnY + 3)) return false;
                } else {
                  // Neighbor chunk not loaded — treat as solid (safe default)
                  return false;
                }
              }
            }
            return true;
          }

          for (const [key, entry] of chunkManager.loadedChunks) {
            if (!entry?.data || !entry.built) continue;
            const [cx, cz] = key.split(',').map(Number);

            // Scan this chunk's columns from top down for plains surface blocks
            for (let lx = 0; lx < 16; lx++) {
              for (let lz = 0; lz < 16; lz++) {
                for (let y = Math.min(MAX_Y - 1, 150); y >= MIN_Y; y--) {
                  const block = entry.data.getBlock(lx, y, lz);
                  // Plains surface blocks: GRASS and DIRT are solid ground
                  if ((block === BLOCK_TYPES.GRASS || block === BLOCK_TYPES.DIRT) && BLOCK_PROPERTIES[block]?.solid) {
                    debugCandidates++;

                    // Must be above sea level (or a valid fallback if no high ground is found)
                    const SEA_LEVEL = 64;
                    if (y <= SEA_LEVEL) {
                      // If we already have a spawn above sea level, ignore candidates below it
                      if (bestSpawnY > SEA_LEVEL) continue;
                      // If this is the first candidate, or higher than current best below sea level, take it
                      if (y <= SEA_LEVEL && y < bestSpawnY) continue; // Only pick lowest available if forced below sea level
                    }

                    // Check column from ground up to y+4 is clear AIR — enough for player headroom (no water/leaves blocking)
                    // This also implies no water at the spawn point itself
                    const colClear = isColumnClear(entry, lx, lz, y + 1, y + 4);
                    if (!colClear) {
                      debugRejectedByWater++;
                      continue;
                    }

                    // Check adjacent columns are clear so player doesn't spawn in a wall or next to a cliff
                    const adjClear = isAdjacentClear(entry, lx, lz, y + 1, cx, cz);
                    if (!adjClear) {
                      debugRejectedByAdjacent++;
                      continue;
                    }

                    debugAccepted++;

                    // This is a valid dry spawn point — prefer highest Y
                    const worldX = cx * 16 + lx;
                    const worldZ = cz * 16 + lz;
                    if (y > bestSpawnY) {
                      bestSpawnX = worldX;
                      bestSpawnZ = worldZ;
                      bestSpawnY = y;
                    }
                  }
                }
              }
            }
          }

          const SEA_LEVEL = 64;
// Spawn search debug — no log on success
          if (bestSpawnY === MIN_Y || bestSpawnY <= SEA_LEVEL) {
            console.warn(`[Cuubz] WARNING: No suitable surface spawn found above sea level! Falling back to highest safe point (Y=${bestSpawnY + 1.625 + 2}).`);
          } else {
// Spawn selected — no log
          }

          const spawnHeight = bestSpawnY + 1.625 + 2; // +2 units so player drops onto surface cleanly
          _log(`[Cuubz] Spawn at Y=${spawnHeight} (on plains ground, +2 above surface)`);

          // Initialize Player at terrain level
          loadingStatus.textContent = 'Creating player...';
          if (loadingProgress) loadingProgress.style.width = '90%';

          const player = new Player();
          player.position.x = bestSpawnX + 0.5; // Center in chunk column
          player.position.y = spawnHeight;
          player.position.z = bestSpawnZ + 0.5;
          player.pitch = -Math.PI / 8; // Sync with initial camera pitch

          // Player placed — position logged only on error
          
          player.linkWorld(worldManager);

          // Start water flow system after player and world are set up
          // DISABLED: water flow system needs overhaul
          // waterFlowSystem.start();

          // Initialize Biome Effects System (wire up visual effects per biome)
          const biomeEffects = new BiomeEffects();
          if (renderer.scene && renderer.renderer) {
            biomeEffects.init(renderer.scene, renderer.renderer);
// Biome Effects initialized — no log
          } else {
            // If Three.js not ready yet, initialize on next frame when available
            setTimeout(() => {
              if (renderer.scene && renderer.renderer) {
                biomeEffects.init(renderer.scene, renderer.renderer);
// Biome Effects initialized — no log
              }
            }, 100);
          }

          // Initialize water levels + queue initial water blocks around player for flow simulation
          // DISABLED: water flow system needs overhaul — entire block commented out
          /*
          const playerChunkX = Math.floor(player.position.x / 16);
          const playerChunkZ = Math.floor(player.position.z / 16);

          for (let x = playerChunkX - waterFlowSystem.flowRadiusChunks; x <= playerChunkX + waterFlowSystem.flowRadiusChunks; x++) {
            for (let z = playerChunkZ - waterFlowSystem.flowRadiusChunks; z <= playerChunkZ + waterFlowSystem.flowRadiusChunks; z++) {
              // First initialize water levels for this chunk
              waterFlowSystem.initializeChunkWaterLevels(x, z);

              const chunkKey = `${x},${z}`;
              const chunkEntry = chunkManager.loadedChunks.get(chunkKey);
              if (chunkEntry && chunkEntry.data) {
                for (let lx = 0; lx < 16; lx++) {
                  for (let lz = 0; lz < 16; lz++) {
                    for (let ly = MIN_Y; ly < MAX_Y; ly++) {
                      if (chunkEntry.data.getBlock(lx, ly, lz) === BLOCK_TYPES.WATER) {
                        waterFlowSystem.queueBlockForFlow(x * 16 + lx, ly, z * 16 + lz);
                      }
                    }
                  }
                }
              }
            }
          }
          */
          // console.log(`[Cuubz] Water flow system initialized and initial water blocks queued.`);

          // Handle mouse movement for camera rotation (pointer lock) — must be after player exists
          document.addEventListener('mousemove', (e) => {
            if (document.pointerLockElement === canvas) {
              player.yaw -= e.movementX * sensitivity;
              player.pitch -= e.movementY * sensitivity;
              // Clamp pitch to avoid flipping at gimbal lock limits
              player.pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, player.pitch));
            }
          });

          // Initialize Game Engine
          loadingStatus.textContent = 'Starting game loop...';
          if (loadingProgress) loadingProgress.style.width = '90%';

          const game = new CuubzGame();
          game.mode = mode || 'survival';
          game.player = player;
          game.renderer = renderer;
          game.chunkManager = chunkManager;
          game.worldGen = worldGen;
          game.persistence = characterManager ? characterManager.storage : null; // For periodic saving
          game.frameCount = 0; // Frame counter for debug logging

           // Set up camera at player eye level — looking slightly downward to see terrain
          const initCamPos = new THREE.Vector3(player.position.x, player.position.y + 1.6, player.position.z);
          renderer.updateCamera(initCamPos, 0, -Math.PI / 8);

          // Initialize Block Interaction system
          const blockInteraction = new BlockInteraction({
            renderer: renderer,
            chunkManager: chunkManager,
            mouse: mouse,
            player: player,
            touch: touch, // Mobile break/place support
          });

          // Start game loop
          loadingStatus.textContent = 'Almost ready...';
          if (loadingProgress) loadingProgress.style.width = '100%';

          // Create a simple world-like object for collision detection
          const chunkWorld = {
            getBlockAtWorld: function(bx, by, bz) {
              const cx = Math.floor(bx / 16);
              const cz = Math.floor(bz / 16);
              const key = `${cx},${cz}`;
              const entry = chunkManager.loadedChunks.get(key);
              if (entry && entry.data) {
                const lx = ((bx % 16) + 16) % 16; // Handle negative modulo
                const lz = ((bz % 16) + 16) % 16;
                return entry.data.getBlock(lx, by, lz);
              }
              return null; // Unloaded chunk → treat as solid (prevents falling through borders)
            }
          };

          setTimeout(() => {
            game.start(mode);

            // Main render loop
            function renderLoop() {
              if (!game.running) return;

              const now = performance.now();
              game.delta = Math.min((now - game.lastTime) / 1000, 0.1);
              game.lastTime = now;

              // Update keyboard just-pressed flags
              keyboard.update();
              
              // Update touch input (clears per-frame state)
              touch.update();

              // Update mouse pointer lock state
              if (document.pointerLockElement === canvas) {
                mouse.locked = true;
              } else {
                mouse.locked = false;
              }

              // Apply mouse movement to player yaw/pitch (pointer lock)
              if (mouse._onMouseMoveBound) {
                // Mouse movement handled via pointerlockchange event
              }

              // Build merged input state (keyboard OR touch — both can contribute)
              const inputState = {
                forward: keyboard.forward || (touch.joystickY < -0.3),
                backward: keyboard.backward || (touch.joystickY > 0.3),
                left: keyboard.left || (touch.joystickX < -0.3),
                right: keyboard.right || (touch.joystickX > 0.3),
                jump: keyboard.jump || touch.jump,
                sprint: keyboard.sprint, // No mobile sprint yet — could add a dedicated button later
                sneak: keyboard.keys['ShiftLeft'] || keyboard.keys['ShiftRight'],
              };

              // Update player physics with input (pass chunkWorld for collision)
              player.update(game.delta, inputState, chunkWorld);
              
              // Apply touch look deltas to player rotation (swipe right half of screen)
              const look = touch.consumeLookDeltas();
              if (look.x !== 0 || look.y !== 0) {
                player.yaw -= look.x * sensitivity;
                player.pitch -= look.y * sensitivity;
                // Clamp pitch to avoid flipping at gimbal lock limits
                player.pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, player.pitch));
              }
              
              // Handle fly mode toggle (F key — single press only)
              if (keyboard.consumeFlyToggle() && !player.gravityEnabled && player.flyMode) {
                console.log('[Cuubz] ⬇️ FLY MODE DEACTIVATED — falling back to survival physics');
                player.gravityEnabled = true;
                player.flyMode = false;
                player.velocity.y = 0;
              }
              
              // Update fly mode indicator HUD
              const flyIndicator = document.getElementById('fly-mode-indicator');
              if (player.flyMode && !player.gravityEnabled) {
                if (flyIndicator) flyIndicator.classList.remove('hidden');
              } else {
                if (flyIndicator) flyIndicator.classList.add('hidden');
              }
              
              // Debug: log player state every 60 frames (disabled — too verbose)

              // Update block interaction (break/place)
              if (blockInteraction) {
                blockInteraction.update(game.delta);
              }

              // Emergency rescue: only teleport if player falls completely out of the world.
              // The old threshold was spawnHeight-10 which fired whenever you entered
              // a cave or deep hole (e.g. spawnHeight=34 → fires at Y=24, above bedrock).
              // Now only fires at MIN_Y-5 — the player must be genuinely below bedrock.
              if (player.position.y < MIN_Y - 5) {
                player.position.y = spawnHeight;
                player.velocity.y = 0;
              }

              // Update camera to follow player at eye level
              const camPos = new THREE.Vector3(player.position.x, player.position.y + 1.6, player.position.z);
              renderer.updateCamera(camPos, player.yaw, player.pitch);

              // Update Biome Effects (fog, sky color, UV animation offsets, particles)
              if (biomeEffects && game.worldGen && game.chunkManager) {
                // Determine current biome from world generator at player position
                const wx = Math.floor(player.position.x);
                const wz = Math.floor(player.position.z);
                const biomeData = game.worldGen.getBiomeAtWorldPos(wx, wz);

                if (biomeData) {
                  biomeEffects.setBiome(biomeData.id);
                  
                  // Set player/camera positions for particle spawning & billboarding
                  biomeEffects.setPlayerPosition(player.position.x, player.position.y, player.position.z);
                  biomeEffects.setCameraPosition(camPos);

                  // Spawn bubble particles in lava/toxic biomes
                  if (biomeData.id === 'lava' && Math.random() < 0.02) {
                    biomeEffects.spawnLavaBubbles(
                      player.position.x + (Math.random() - 0.5) * 40,
                      player.position.y - 2,
                      player.position.z + (Math.random() - 0.5) * 40
                    );
                  } else if (biomeData.id === 'corrupt' && Math.random() < 0.015) {
                    biomeEffects.spawnToxicBubbles(
                      player.position.x + (Math.random() - 0.5) * 40,
                      player.position.y - 2,
                      player.position.z + (Math.random() - 0.5) * 40
                    );
                  }
                }

                // Update animation timers & particles
                biomeEffects.update(game.delta);
              }

              // Render scene
              renderer.render();

              // DEBUG: Hover raycasting — show block ID at crosshair center
              const tooltip = document.getElementById('block-tooltip');
              const tooltipId = document.getElementById('tooltip-block-id');
              const tooltipName = document.getElementById('tooltip-block-name');
              if (renderer.camera && renderer.chunkGroup) {
                const raycaster = new THREE.Raycaster();
                raycaster.setFromCamera(new THREE.Vector2(0, 0), renderer.camera);
                raycaster.far = 7; // Same as block interaction range

                const intersects = raycaster.intersectObjects(renderer.chunkGroup.children, true);
                if (intersects.length > 0) {
                  const hit = intersects[0];
                  const obj = hit.object;
                  if (obj.userData && obj.userData.chunkKey && obj.userData.blockIdToName) {
                    // Calculate block position from intersection point.
                    // Mesh position is the chunk origin in world space.
                    // IMPORTANT: hit.point sits on the surface, so floor() can land
                    // in the air block above. We check both the hit position and
                    // one block below to find the actual solid block.
                    const meshPos = obj.position;

                    const localX = Math.floor(hit.point.x - meshPos.x);
                    const localY = Math.floor(hit.point.y - meshPos.y);
                    const localZ = Math.floor(hit.point.z - meshPos.z);

                    // Clamp to chunk bounds (X/Z: 0-15, Y: -32 to 64)
                    if (localX >= 0 && localX < 16 && localZ >= 0 && localZ < 16 && localY >= -32 && localY <= 64) {
                      try {
                        // First check the exact hit position
                        let blockId = obj.userData.chunkData.getBlock(localX, localY, localZ);

                        // If that's air, check one block below (hit point is on surface boundary)
                        if (blockId === 0 && localY > -32) {
                          blockId = obj.userData.chunkData.getBlock(localX, localY - 1, localZ);
                        }

                        const blockName = obj.userData.blockIdToName[blockId] || 'unknown';

                        tooltipId.textContent = `ID: ${blockId}`;
                        tooltipName.textContent = blockName.replace(/_/g, ' ');
                        tooltip.classList.remove('hidden');
                      } catch (e) {
                        // Block out of range — hide tooltip
                        tooltip.classList.add('hidden');
                      }
                    } else {
                      tooltip.classList.add('hidden');
                    }
                  } else {
                    tooltip.classList.add('hidden');
                  }
                } else {
                  tooltip.classList.add('hidden');
                }
              }

              // Update chunk manager for player position
              if (game.chunkManager) {
                game.chunkManager.update(player.position.x, player.position.z, performance.now());
              }

              // ─── Debug Stats Overlay Update ──────────────
              updateDebugStats(game);

              requestAnimationFrame(renderLoop);
            }

            // ─── Wire up Pause Menu & Settings ────────────
            setupPauseMenu(game);

            game.lastTime = performance.now();
            requestAnimationFrame(renderLoop);

            _log('[Cuubz] Game started successfully in ' + mode + ' mode');
          }, 500);
        }

        // Start the wait loop
        waitForChunksAndLink();
      } catch (err) {
        console.error('[Cuubz] Game init failed:', err);
        loadingStatus.textContent = 'Error: ' + err.message;
        _log('[Cuubz] Game init error:', err.stack);
      }
    }, 200);
  }

  // ============================================================
  // Debug Stats Overlay & Pause Menu
  // ============================================================

  /**
   * FPS tracking state — shared across frames for rolling average.
   */
  let _fpsFrames = 0;
  let _fpsLastTime = performance.now();
  let _currentFps = 0;

  function updateDebugStats(game) {
    const statsEl = document.getElementById('debug-stats');
    if (!statsEl || !game.chunkManager) return;

    // FPS calculation (rolling over ~1 second window)
    _fpsFrames++;
    const now = performance.now();
    if (now - _fpsLastTime >= 1000) {
      _currentFps = Math.round(_fpsFrames * 1000 / (now - _fpsLastTime));
      _fpsFrames = 0;
      _fpsLastTime = now;
    }

    // Count active chunks (with mesh rendered) and dirty count
    let activeChunks = 0, dirtyCount = 0;
    for (const [, entry] of game.chunkManager.loadedChunks) {
      if (entry.mesh || entry.transMesh || entry.cutoutMesh) activeChunks++;
      if (entry.dirty) dirtyCount++;
    }

    // Update DOM elements
    const fpsEl = document.getElementById('stats-fps');
    const chunksEl = document.getElementById('stats-chunks');
    const dirtyEl = document.getElementById('stats-dirty');
    const manifestEl = document.getElementById('stats-manifest');

    if (fpsEl) fpsEl.textContent = `FPS: ${_currentFps}`;
    if (chunksEl) chunksEl.textContent = `Chunks: ${activeChunks} / ${game.chunkManager.loadedChunks.size}`;
    if (dirtyEl) dirtyEl.textContent = `Dirty: ${dirtyCount}`;
    if (manifestEl && game.chunkManager.stats) {
      manifestEl.textContent = `Manifest writes: ${game.chunkManager.stats.manifestWrites || 0}`;
    }
  }

  function setupPauseMenu(game) {
    const pauseMenu = document.getElementById('pause-menu');
    const resumeBtn = document.getElementById('btn-resume-game');
    const debugStats = document.getElementById('debug-stats');

    // Settings sliders
    const tickSlider = document.getElementById('setting-tick-interval');
    const chunksSlider = document.getElementById('setting-chunks-per-tick');
    const distanceSlider = document.getElementById('setting-render-distance');

    // Value displays
    const tickVal = document.getElementById('tick-val');
    const chunksVal = document.getElementById('chunks-val');
    const distanceVal = document.getElementById('distance-val');

    if (!pauseMenu || !resumeBtn) return;

    // Show debug stats overlay when game starts
    if (debugStats) {
      debugStats.classList.remove('hidden');
    }

    // Toggle pause on Escape key
    document.addEventListener('keydown', function onPause(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        const isPaused = !pauseMenu.classList.contains('hidden');

        if (!isPaused) {
          // Pause game
          game.running = false;
          pauseMenu.classList.remove('hidden');
          document.exitPointerLock();
          // Stop chunk tick timer while paused
          if (game.chunkManager) game.chunkManager.stopTickTimer();
        } else {
          // Resume game
          resumeGame();
        }
      }
    });

    function resumeGame() {
      game.running = true;
      pauseMenu.classList.add('hidden');
      canvas.requestPointerLock();
      // Restart chunk tick timer
      if (game.chunkManager) game.chunkManager.startTickTimer();
    }

    resumeBtn.addEventListener('click', resumeGame);

    // Settings: Chunk Tick Interval
    if (tickSlider && tickVal) {
      tickSlider.value = game.chunkManager.tickIntervalMs;
      tickVal.textContent = tickSlider.value;
      tickSlider.addEventListener('input', () => {
        const val = parseInt(tickSlider.value);
        tickVal.textContent = val;
        if (game.chunkManager) {
          game.chunkManager.stopTickTimer();
          game.chunkManager.tickIntervalMs = val;
          if (game.running) game.chunkManager.startTickTimer();
        }
      });
    }

    // Settings: Chunks Per Tick
    if (chunksSlider && chunksVal) {
      chunksSlider.value = game.chunkManager.chunksPerTick;
      chunksVal.textContent = chunksSlider.value;
      chunksSlider.addEventListener('input', () => {
        const val = parseInt(chunksSlider.value);
        chunksVal.textContent = val;
        if (game.chunkManager) {
          game.chunkManager.chunksPerTick = val;
        }
      });
    }

    // Settings: Render Distance
    if (distanceSlider && distanceVal) {
      distanceSlider.value = game.chunkManager.renderDistance;
      distanceVal.textContent = distanceSlider.value;
      distanceSlider.addEventListener('input', () => {
        const val = parseInt(distanceSlider.value);
        distanceVal.textContent = val;
        if (game.chunkManager) {
          game.chunkManager.setRenderDistance(val);
        }
      });
    }
  }

  // ============================================================
  // Mobile Detection
  // ============================================================

  function detectMobile() {
    const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    const isNarrowScreen = window.innerWidth < 768;

    if (isTouchDevice || isNarrowScreen) {
      document.getElementById('touch-controls').classList.remove('hidden');
      _log('[Cuubz] Mobile/touch controls enabled');
    }
  }

  // ============================================================
  // Initialization
  // ============================================================

  async function init() {
    _log('[Cuubz] INIT STARTING');
    try {
      _log('[Cuubz] Initializing...');

      // Initialize PersistenceManager (IndexedDB)
      const persistence = new PersistenceManager();
      await persistence.init();
      _log('[Cuubz] IndexedDB initialized');

      // Initialize CharacterManager
      characterManager = new BrowserCharacterManager(persistence);
      await characterManager.init();
      _log(`[Cuubz] Loaded ${characterManager.getAllCharacters().length} characters`);

      // Initialize WorldManager
      worldManager = new BrowserWorldManager(persistence);
      await worldManager.init();
      _log(`[Cuubz] Loaded ${worldManager.getAllWorlds().length} worlds`);

      _log('[Cuubz] Calling initMenuNavigation');
      try {
        initMenuNavigation();
      } catch (e) {
        console.error('[Cuubz] initMenuNavigation ERROR:', e);
      }

      try {
        detectMobile();
      } catch (e) {
        console.error('[Cuubz] detectMobile ERROR:', e);
      }

      showScreen('mainMenu');
      console.error('[Cuubz] === INIT COMPLETE ===');
    } catch (err) {
      console.error('[Cuubz] FATAL init error:', err.message, err.stack);
    }
  }

  // Start when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();