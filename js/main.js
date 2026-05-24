/**
 * Cuubz — Main Entry Point
 * Menu system, play/host/join flow, screen management, character & world management.
 */

(function() {
  'use strict';

  // ============================================================
  // Screen Management
  // ============================================================

  const screens = {
    mainMenu: document.getElementById('main-menu'),
    characterScreen: document.getElementById('character-screen'),
    createCharModal: document.getElementById('create-char-modal'),
    deleteCharModal: document.getElementById('delete-char-modal'),
    worldScreen: document.getElementById('world-screen'),
    modeScreen: document.getElementById('mode-screen'),
    settingsScreen: document.getElementById('settings-screen'),
    lobbyScreen: document.getElementById('lobby-screen'),
    loadingScreen: document.getElementById('loading-screen'),
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
    slot.addEventListener('click', (e) => {
      if (e.target.closest('.char-slot-action-btn')) return; // Don't trigger on action buttons
      if (characterManager) {
        characterManager.selectCharacter(char.id);
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
    screens.createCharModal.classList.remove('hidden');
    setTimeout(() => document.getElementById('char-name').focus(), 100);
  }

  function openEditModal(char) {
    editingCharId = char.id;
    document.getElementById('char-modal-title').textContent = 'Edit Character';
    document.getElementById('btn-save-char').textContent = 'Save';
    document.getElementById('char-name').value = char.name;
    document.getElementById('char-color').value = char.color;
    hideCharError();
    screens.createCharModal.classList.remove('hidden');
    setTimeout(() => {
      const nameInput = document.getElementById('char-name');
      nameInput.focus();
      nameInput.select();
    }, 100);
  }

  function closeCharModal() {
    screens.createCharModal.classList.add('hidden');
    editingCharId = null;
    // Restore color picker visibility
    const colorLabel = document.getElementById('char-color').parentElement;
    if (colorLabel) colorLabel.style.display = '';
  }

  function openDeleteModal(char) {
    document.getElementById('delete-char-name').textContent = `"${char.name}"`;
    screens.deleteCharModal.dataset.charId = char.id;
    screens.deleteCharModal.classList.remove('hidden');
  }

  function closeDeleteModal() {
    screens.deleteCharModal.classList.add('hidden');
    delete screens.deleteCharModal.dataset.charId;
  }

  // ============================================================
  // World Delete Modal Handlers
  // ============================================================

  function openDeleteWorldModal(world) {
    document.getElementById('delete-char-name').textContent = `"${world.name}"`;
    screens.deleteCharModal.dataset.worldId = world.id;
    screens.deleteCharModal.classList.remove('hidden');
  }

  function closeDeleteWorldModal() {
    screens.deleteCharModal.classList.add('hidden');
    delete screens.deleteCharModal.dataset.worldId;
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

      await this.persistence.deleteWorld(id);
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

    selectWorld(id) {
      const world = this.getWorld(id);
      if (!world) return { success: false, error: 'World not found' };
      this.selectedId = id;
      world.lastPlayed = Date.now();
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
    if (!container) return;

    container.innerHTML = '';

    const worlds = worldManager ? worldManager.getAllWorlds() : [];
    
    // Render existing worlds
    worlds.forEach(world => {
      const slot = createWorldSlotElement(world);
      container.appendChild(slot);
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
    slot.addEventListener('click', (e) => {
      if (e.target.closest('.world-slot-action-btn')) return;
      if (worldManager) {
        worldManager.selectWorld(world.id);
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

    // Character modal — save (unified: handles both characters and worlds)
    document.getElementById('btn-save-char').addEventListener('click', async () => {
      const title = document.getElementById('char-modal-title').textContent;

      if (title === 'Create New World') {
        // Creating a world
        const name = document.getElementById('char-name').value.trim();
        if (!name) {
          showCharError('Please enter a world name.');
          return;
        }
        const result = await worldManager.createWorld(name);
        if (result.success) {
          closeCharModal();
          renderWorldSlots();
          console.log(`[Cuubz] World created: ${result.world.name} (seed: ${BrowserWorldManager.formatSeed(result.world.seed)})`);
        } else {
          showCharError(result.error);
        }
      } else {
        // Creating/editing a character
        const name = document.getElementById('char-name').value.trim();
        const color = document.getElementById('char-color').value;

        if (!name) {
          showCharError('Please enter a character name.');
          return;
        }

        let result;
        if (editingCharId) {
          result = await characterManager.updateCharacter(editingCharId, { name, color });
        } else {
          result = await characterManager.createCharacter(name, color);
        }

        if (result.success) {
          closeCharModal();
          renderCharacterSlots();
          console.log(`[Cuubz] Character ${editingCharId ? 'updated' : 'created'}: ${result.character.name} (${result.character.color})`);
        } else {
          showCharError(result.error);
        }
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
      const charId = screens.deleteCharModal.dataset.charId;
      const worldId = screens.deleteCharModal.dataset.worldId;

      if (worldId) {
        // Deleting a world
        const result = await worldManager.deleteWorld(worldId);
        if (result.success) {
          closeDeleteWorldModal();
          renderWorldSlots();
          console.log(`[Cuubz] World deleted: ${worldId}`);
        } else {
          alert(result.error);
        }
      } else if (charId) {
        // Deleting a character
        const result = await characterManager.deleteCharacter(charId);
        if (result.success) {
          closeDeleteModal();
          renderCharacterSlots();
          console.log(`[Cuubz] Character deleted: ${charId}`);
        } else {
          alert(result.error);
        }
      }
    });

    document.getElementById('btn-cancel-delete-char').addEventListener('click', () => {
      if (screens.deleteCharModal.dataset.worldId) {
        closeDeleteWorldModal();
      } else {
        closeDeleteModal();
      }
    });

    // World screen
    document.getElementById('btn-back-world').addEventListener('click', () => {
      showScreen('characterScreen');
    });

    // Create world button → open create modal (reuse char modal)
    document.getElementById('btn-create-world').addEventListener('click', () => {
      if (worldManager && !worldManager.canCreateMore()) return;
      editingCharId = null;
      document.getElementById('char-modal-title').textContent = 'Create New World';
      document.getElementById('btn-save-char').textContent = 'Create World';
      document.getElementById('char-name').value = '';
      const colorLabel = document.getElementById('char-color').parentElement;
      if (colorLabel) colorLabel.style.display = 'none'; // Hide color picker for worlds
      hideCharError();
      screens.createCharModal.classList.remove('hidden');
      setTimeout(() => document.getElementById('char-name').focus(), 100);
    });

    // Mode screen
    document.getElementById('btn-back-mode').addEventListener('click', () => {
      showScreen('worldScreen');
    });

    document.getElementById('btn-survival').addEventListener('click', () => {
      console.log('[Cuubz] Mode: Survival');
      startGame('survival');
    });

    document.getElementById('btn-creative').addEventListener('click', () => {
      console.log('[Cuubz] Mode: Creative');
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

    // Lobby screen
    document.getElementById('btn-back-lobby').addEventListener('click', () => {
      showScreen('mainMenu');
    });
  }

  // ============================================================
  // Game Start
  // ============================================================

  function startGame(mode) {
    console.log(`[Cuubz] Starting game in ${mode} mode...`);

    const selected = characterManager ? characterManager.getSelectedCharacter() : null;
    if (!selected) {
      console.warn('[Cuubz] No character selected!');
      showScreen('characterScreen');
      return;
    }

    console.log(`[Cuubz] Playing as: ${selected.name} (${selected.color})`);

    // Show loading screen
    showScreen('loadingScreen');

    const loadingProgress = document.getElementById('loading-progress');
    const loadingStatus = document.getElementById('loading-status');

    let progress = 0;
    const steps = [
      { at: 10, msg: 'Initializing renderer...' },
      { at: 30, msg: 'Generating terrain...' },
      { at: 50, msg: 'Building chunk meshes...' },
      { at: 70, msg: 'Placing features...' },
      { at: 90, msg: 'Almost ready...' },
    ];

    const interval = setInterval(() => {
      progress += Math.random() * 15;
      if (progress > 100) progress = 100;

      for (const step of steps) {
        if (progress >= step.at) loadingStatus.textContent = step.msg;
      }

      if (loadingProgress) loadingProgress.style.width = progress + '%';

      if (progress >= 100) {
        clearInterval(interval);
        console.log('[Cuubz] Game would start here. Engine modules not yet built.');

        setTimeout(() => {
          Object.values(screens).forEach(el => { if (el) el.classList.add('hidden'); });
          const container = document.getElementById('game-container');
          container.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#4CAF50;font-size:24px;text-align:center;padding:20px;">Cuubz Engine<br><span style="font-size:14px;color:#888;">Engine modules building...</span></div>';
        }, 500);
      }
    }, 200);
  }

  // ============================================================
  // Mobile Detection
  // ============================================================

  function detectMobile() {
    const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    const isNarrowScreen = window.innerWidth < 768;

    if (isTouchDevice || isNarrowScreen) {
      document.getElementById('touch-controls').classList.remove('hidden');
      console.log('[Cuubz] Mobile/touch controls enabled');
    }
  }

  // ============================================================
  // Initialization
  // ============================================================

  async function init() {
    console.log('[Cuubz] Initializing...');

    // Initialize PersistenceManager (IndexedDB)
    const persistence = new PersistenceManager();
    try {
      await persistence.init();
      console.log('[Cuubz] IndexedDB initialized');
    } catch (err) {
      console.error('[Cuubz] Failed to initialize IndexedDB:', err.message);
      // Fallback: use in-memory store if IndexedDB unavailable (e.g., testing)
      console.warn('[Cuubz] Falling back to in-memory character storage');
    }

    // Initialize CharacterManager
    characterManager = new BrowserCharacterManager(persistence);
    try {
      await characterManager.init();
      console.log(`[Cuubz] Loaded ${characterManager.getAllCharacters().length} characters`);
    } catch (err) {
      console.error('[Cuubz] Failed to load characters:', err.message);
    }

    // Initialize WorldManager
    worldManager = new BrowserWorldManager(persistence);
    try {
      await worldManager.init();
      console.log(`[Cuubz] Loaded ${worldManager.getAllWorlds().length} worlds`);
    } catch (err) {
      console.error('[Cuubz] Failed to load worlds:', err.message);
    }

    initMenuNavigation();
    detectMobile();

    // Show main menu
    showScreen('mainMenu');

    console.log('[Cuubz] Ready. Awaiting player input.');
  }

  // Start when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
