/**
 * Cuubz — Item Texture Atlas (2D UI Atlas for Hotbar/Inventory)
 * 
 * Loads item textures from textures/items/ folder and builds a single
 * diffuse atlas canvas for rendering item icons in the hotbar and inventory UI.
 * 
 * Each item gets one atlas slot. The atlas uses nearest-neighbor filtering
 * for a crisp pixel-art look in the UI.
 * 
 * Tile size: 64×64 px (items are displayed at 48×48 in hotbar, 64 gives headroom)
 * Grid: auto-sized square grid to fit all items
 */

class ItemTextureAtlas {
  constructor(options = {}) {
    this.tileSize = options.tileSize || 64;
    this.canvas = null;
    this.texture = null; // THREE.CanvasTexture
    this.loaded = false;

    // itemKey → { col, row }
    // itemKey is either a named item string ('coal', 'wooden_sword') or a block ID number
    this.slotMap = {};

    // itemKey → item metadata { name, displayName }
    this.itemRegistry = {};

    // Grid dimensions
    this.gridW = 0;
    this.gridH = 0;
    this._gap = 1; // 1px gap between tiles
  }

  /**
   * Build the item texture atlas.
   * Returns a promise that resolves when all textures are loaded.
   */
  async buildAtlas() {
    // 1. Build item registry from manifest + inline defaults
    const items = this._buildItemRegistry();
    this.itemRegistry = items;

    const totalItems = Object.keys(items).length;
    if (totalItems === 0) {
      console.warn('[ItemTextureAtlas] No items registered');
      return this;
    }

    // 2. Calculate grid size
    const gridSize = Math.ceil(Math.sqrt(totalItems));
    this.gridW = gridSize;
    this.gridH = gridSize;

    const canvasSize = gridSize * this.tileSize + (gridSize + 1) * this._gap;
    console.log(`[ItemTextureAtlas] ${totalItems} items → ${gridSize}×${gridSize} grid, ${canvasSize}×${canvasSize} px atlas`);

    // 3. Create canvas
    this.canvas = document.createElement('canvas');
    this.canvas.width = canvasSize;
    this.canvas.height = canvasSize;

    // 4. Assign slots and load textures
    const loadPromises = [];
    let slotIndex = 0;

    for (const [itemKey, itemData] of Object.entries(items)) {
      const col = slotIndex % gridSize;
      const row = Math.floor(slotIndex / gridSize);
      this.slotMap[itemKey] = { col, row };

      loadPromises.push(this._loadItemTexture(itemKey, itemData, col, row));
      slotIndex++;
    }

    await Promise.all(loadPromises);

    // 5. Create THREE.CanvasTexture
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.magFilter = THREE.NearestFilter;
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.generateMipmaps = false;
    this.texture.wrapS = THREE.ClampToEdgeWrapping;
    this.texture.wrapT = THREE.ClampToEdgeWrapping;

    this.loaded = true;
    console.log(`[ItemTextureAtlas] Atlas built: ${totalItems} items, ${Object.keys(this.slotMap).length} slots`);
    return this;
  }

  /**
   * Build the item registry — maps item keys to texture source info.
   * Combines inline definitions with any manifest data.
   */
  _buildItemRegistry() {
    const items = {};

    // ── Named items (non-block inventory items) ──
    // These use textures from textures/items/ folder
    // Only items with textures that actually exist are mapped
    const namedItems = [
      // Resources
      { key: 'coal', name: 'Coal', texture: 'coal' },
      { key: 'stick', name: 'Stick', texture: 'stick' },
      { key: 'redstone', name: 'Redstone', texture: 'redstone' },
      { key: 'gunpowder', name: 'Gunpowder', texture: 'gunpowder' },
      { key: 'glowstone_dust', name: 'Glowstone Dust', texture: 'glowstone_dust' },
      { key: 'sugar', name: 'Sugar', texture: 'sugar' },
      // Food
      { key: 'cookie', name: 'Cookie', texture: 'cookie' },
      { key: 'egg', name: 'Egg', texture: 'egg' },
      { key: 'blue_egg', name: 'Blue Egg', texture: 'blue_egg' },
      { key: 'brown_egg', name: 'Brown Egg', texture: 'brown_egg' },
      { key: 'snowball', name: 'Snowball', texture: 'snowball' },
      // Quest items
      { key: 'ender_pearl', name: 'Ender Pearl', texture: 'ender_pearl' },
      { key: 'ender_eye', name: 'Eye of Ender', texture: 'ender_eye' },
      { key: 'quest_key', name: 'Quest Key', texture: 'disc_fragment_5' },
      // Tools — Wooden tier
      { key: 'wooden_sword', name: 'Wooden Sword', texture: 'wooden_sword' },
      { key: 'wooden_pickaxe', name: 'Wooden Pickaxe', texture: 'wooden_pickaxe' },
      { key: 'wooden_axe', name: 'Wooden Axe', texture: 'wooden_axe' },
      { key: 'wooden_shovel', name: 'Wooden Shovel', texture: 'wooden_shovel' },
      { key: 'wooden_hoe', name: 'Wooden Hoe', texture: 'wooden_hoe' },
      { key: 'wooden_spear', name: 'Wooden Spear', texture: 'wooden_spear' },
      // Tools — Stone tier
      { key: 'stone_sword', name: 'Stone Sword', texture: 'stone_sword' },
      { key: 'stone_pickaxe', name: 'Stone Pickaxe', texture: 'stone_pickaxe' },
      { key: 'stone_axe', name: 'Stone Axe', texture: 'stone_axe' },
      { key: 'stone_shovel', name: 'Stone Shovel', texture: 'stone_shovel' },
      { key: 'stone_hoe', name: 'Stone Hoe', texture: 'stone_hoe' },
      { key: 'stone_spear', name: 'Stone Spear', texture: 'stone_spear' },
      // Tools — Iron tier
      { key: 'iron_sword', name: 'Iron Sword', texture: 'iron_sword' },
      { key: 'iron_pickaxe', name: 'Iron Pickaxe', texture: 'iron_pickaxe' },
      { key: 'iron_axe', name: 'Iron Axe', texture: 'iron_axe' },
      { key: 'iron_shovel', name: 'Iron Shovel', texture: 'iron_shovel' },
      { key: 'iron_hoe', name: 'Iron Hoe', texture: 'iron_hoe' },
      { key: 'iron_spear', name: 'Iron Spear', texture: 'iron_spear' },
      // Tools — Copper tier
      { key: 'copper_sword', name: 'Copper Sword', texture: 'copper_sword' },
      { key: 'copper_pickaxe', name: 'Copper Pickaxe', texture: 'copper_pickaxe' },
      { key: 'copper_axe', name: 'Copper Axe', texture: 'copper_axe' },
      { key: 'copper_shovel', name: 'Copper Shovel', texture: 'copper_shovel' },
      { key: 'copper_hoe', name: 'Copper Hoe', texture: 'copper_hoe' },
      { key: 'copper_spear', name: 'Copper Spear', texture: 'copper_spear' },
      // Tools — Gold tier
      { key: 'golden_sword', name: 'Golden Sword', texture: 'golden_sword' },
      { key: 'golden_pickaxe', name: 'Golden Pickaxe', texture: 'golden_pickaxe' },
      { key: 'golden_axe', name: 'Golden Axe', texture: 'golden_axe' },
      { key: 'golden_shovel', name: 'Golden Shovel', texture: 'golden_shovel' },
      { key: 'golden_hoe', name: 'Golden Hoe', texture: 'golden_hoe' },
      { key: 'golden_spear', name: 'Golden Spear', texture: 'golden_spear' },
      // Tools — Diamond tier
      { key: 'diamond_sword', name: 'Diamond Sword', texture: 'diamond_sword' },
      { key: 'diamond_pickaxe', name: 'Diamond Pickaxe', texture: 'diamond_pickaxe' },
      { key: 'diamond_axe', name: 'Diamond Axe', texture: 'diamond_axe' },
      { key: 'diamond_shovel', name: 'Diamond Shovel', texture: 'diamond_shovel' },
      { key: 'diamond_hoe', name: 'Diamond Hoe', texture: 'diamond_hoe' },
      { key: 'diamond_spear', name: 'Diamond Spear', texture: 'diamond_spear' },
      // Tools — Netherite tier
      { key: 'netherite_sword', name: 'Netherite Sword', texture: 'netherite_sword' },
      { key: 'netherite_pickaxe', name: 'Netherite Pickaxe', texture: 'netherite_pickaxe' },
      { key: 'netherite_axe', name: 'Netherite Axe', texture: 'netherite_axe' },
      { key: 'netherite_shovel', name: 'Netherite Shovel', texture: 'netherite_shovel' },
      { key: 'netherite_hoe', name: 'Netherite Hoe', texture: 'netherite_hoe' },
      { key: 'netherite_spear', name: 'Netherite Spear', texture: 'netherite_spear' },
      // Armor — Wooden
      { key: 'wooden_helmet', name: 'Wooden Helmet', texture: 'wooden_helmet' },
      { key: 'wooden_chestplate', name: 'Wooden Chestplate', texture: 'wooden_chestplate' },
      { key: 'wooden_leggings', name: 'Wooden Leggings', texture: 'wooden_leggings' },
      { key: 'wooden_boots', name: 'Wooden Boots', texture: 'wooden_boots' },
      // Armor — Leather
      { key: 'leather_helmet', name: 'Leather Helmet', texture: 'leather_helmet' },
      { key: 'leather_chestplate', name: 'Leather Chestplate', texture: 'leather_chestplate' },
      { key: 'leather_leggings', name: 'Leather Leggings', texture: 'leather_leggings' },
      { key: 'leather_boots', name: 'Leather Boots', texture: 'leather_boots' },
      // Armor — Chainmail
      { key: 'chainmail_helmet', name: 'Chainmail Helmet', texture: 'chainmail_helmet' },
      { key: 'chainmail_chestplate', name: 'Chainmail Chestplate', texture: 'chainmail_chestplate' },
      { key: 'chainmail_leggings', name: 'Chainmail Leggings', texture: 'chainmail_leggings' },
      { key: 'chainmail_boots', name: 'Chainmail Boots', texture: 'chainmail_boots' },
      // Armor — Iron
      { key: 'iron_helmet', name: 'Iron Helmet', texture: 'iron_helmet' },
      { key: 'iron_chestplate', name: 'Iron Chestplate', texture: 'iron_chestplate' },
      { key: 'iron_leggings', name: 'Iron Leggings', texture: 'iron_leggings' },
      { key: 'iron_boots', name: 'Iron Boots', texture: 'iron_boots' },
      // Armor — Gold
      { key: 'golden_helmet', name: 'Golden Helmet', texture: 'golden_helmet' },
      { key: 'golden_chestplate', name: 'Golden Chestplate', texture: 'golden_chestplate' },
      { key: 'golden_leggings', name: 'Golden Leggings', texture: 'golden_leggings' },
      { key: 'golden_boots', name: 'Golden Boots', texture: 'golden_boots' },
      // Armor — Diamond
      { key: 'diamond_helmet', name: 'Diamond Helmet', texture: 'diamond_helmet' },
      { key: 'diamond_chestplate', name: 'Diamond Chestplate', texture: 'diamond_chestplate' },
      { key: 'diamond_leggings', name: 'Diamond Leggings', texture: 'diamond_leggings' },
      { key: 'diamond_boots', name: 'Diamond Boots', texture: 'diamond_boots' },
      // Armor — Netherite
      { key: 'netherite_helmet', name: 'Netherite Helmet', texture: 'netherite_helmet' },
      { key: 'netherite_chestplate', name: 'Netherite Chestplate', texture: 'netherite_chestplate' },
      { key: 'netherite_leggings', name: 'Netherite Leggings', texture: 'netherite_leggings' },
      { key: 'netherite_boots', name: 'Netherite Boots', texture: 'netherite_boots' },
      // Mob Drops
      { key: 'rotten_flesh', name: 'Rotten Flesh', texture: 'rotten_flesh' },
      { key: 'bone', name: 'Bone', texture: 'bone' },
      { key: 'rabbit_hide', name: 'Rabbit Hide', texture: 'rabbit_hide' },
      { key: 'rabbit_meat', name: 'Raw Rabbit', texture: 'rabbit_meat' },
      { key: 'raw_venison', name: 'Raw Venison', texture: 'raw_venison' },
      { key: 'corrupt_fang', name: 'Corrupt Fang', texture: 'corrupt_fang' },
      // Misc
      { key: 'compass', name: 'Compass', texture: 'compass_00' },
      { key: 'firework_rocket', name: 'Firework Rocket', texture: 'firework_rocket' },
    ];

    for (const item of namedItems) {
      items[item.key] = {
        name: item.name,
        displayName: item.name,
        textureName: item.texture,
        texturePath: `textures/items/${item.texture}.png`,
        isBlock: false,
      };
    }

    // ── Block items (numeric IDs) ──
    // For blocks, use the block's top face texture from the blocks atlas
    // We register common block IDs so they can be looked up by number
    const blockItems = [
      { id: 1, name: 'Bedrock' },
      { id: 2, name: 'Stone' },
      { id: 3, name: 'Dirt' },
      { id: 4, name: 'Grass Block' },
      { id: 5, name: 'Sand' },
      { id: 6, name: 'Gravel' },
      { id: 8, name: 'Coal Ore' },
      { id: 9, name: 'Iron Ore' },
      { id: 10, name: 'Gold Ore' },
      { id: 11, name: 'Diamond Ore' },
      { id: 13, name: 'Snow' },
      { id: 14, name: 'Snow Stone' },
      { id: 16, name: 'Terracotta' },
      { id: 17, name: 'Red Sand' },
      { id: 18, name: 'Ice' },
      { id: 19, name: 'Clay' },
      { id: 32, name: 'Wood Log' },
      { id: 33, name: 'Leaves' },
      { id: 34, name: 'Planks' },
      { id: 35, name: 'Obsidian' },
      { id: 36, name: 'Blackstone' },
      { id: 38, name: 'Corrupt Crystal' },
      { id: 39, name: 'Bed' },
      { id: 40, name: 'Apple' }, // block form of apple
      { id: 41, name: 'Quest Key' },
      { id: 42, name: 'Red Flower' },
      { id: 43, name: 'Yellow Flower' },
      { id: 44, name: 'Cave Torch' },
      { id: 45, name: 'Glowstone' },
    ];

    for (const block of blockItems) {
      items[block.id] = {
        name: block.name,
        displayName: block.name,
        blockId: block.id,
        isBlock: true,
      };
    }

    return items;
  }

  /**
   * Load a single item's texture into the atlas at the given grid position.
   */
  async _loadItemTexture(itemKey, itemData, col, row) {
    const x = this._gap + col * (this.tileSize + this._gap);
    const y = this._gap + row * (this.tileSize + this._gap);
    const ctx = this.canvas.getContext('2d');

    if (itemData.isBlock) {
      // For blocks, draw a placeholder using block color
      // The actual block texture will be drawn from the block atlas at render time
      this._drawBlockPlaceholder(ctx, x, y, itemData);
      return;
    }

    // For named items, load from textures/items/
    if (itemData.texturePath) {
      await this._loadImage(itemData.texturePath, ctx, x, y);
    } else {
      // Fallback: draw a colored placeholder
      this._drawPlaceholder(ctx, x, y, itemData.name);
    }
  }

  /**
   * Draw a colored placeholder for block items.
   * The actual texture comes from the block atlas at render time.
   */
  _drawBlockPlaceholder(ctx, x, y, itemData) {
    const colors = {
      1: '#333333', 2: '#808080', 3: '#8B4513', 4: '#4a8c3f',
      5: '#F4A460', 6: '#808080', 8: '#2c2c2c', 9: '#CD853F',
      10: '#FFD700', 11: '#00CED1', 13: '#FFFFFF', 14: '#DCDCDC',
      16: '#B22222', 17: '#FF6347', 18: '#87CEEB', 19: '#B0C4DE',
      32: '#8B4513', 33: '#228B22', 34: '#DEB887', 35: '#1a0a2e',
      36: '#36454F', 38: '#9400D3', 39: '#8B0000', 40: '#FF0000',
      41: '#FFD700', 42: '#FF69B4', 43: '#FFD700', 44: '#FFA500',
      45: '#FFFF00',
    };
    const color = colors[itemData.blockId] || '#888888';
    ctx.fillStyle = color;
    ctx.fillRect(x, y, this.tileSize, this.tileSize);

    // Draw block name initial
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.font = `bold ${this.tileSize / 2}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(itemData.name.charAt(0), x + this.tileSize / 2, y + this.tileSize / 2);
  }

  /**
   * Draw a generic placeholder for missing textures.
   */
  _drawPlaceholder(ctx, x, y, name) {
    ctx.fillStyle = '#555555';
    ctx.fillRect(x, y, this.tileSize, this.tileSize);
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = `${this.tileSize / 3}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('?', x + this.tileSize / 2, y + this.tileSize / 2);
  }

  /**
   * Load a single image and draw it onto the canvas.
   */
  _loadImage(url, ctx, x, y) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(img, x, y, this.tileSize, this.tileSize);
        resolve();
      };
      img.onerror = () => {
        // Fallback placeholder
        ctx.fillStyle = '#555555';
        ctx.fillRect(x, y, this.tileSize, this.tileSize);
        resolve();
      };
      img.src = url;
    });
  }

  /**
   * Get UV coordinates for an item key (string name or block ID number).
   * Returns { u, v, size } for use with the item atlas texture.
   */
  getItemUV(itemKey) {
    const slot = this.slotMap[itemKey];
    if (!slot) {
      // Try string conversion for numeric keys
      const strKey = String(itemKey);
      const strSlot = this.slotMap[strKey];
      if (!strSlot) {
        return null;
      }
      return this._slotToUV(strSlot.col, strSlot.row);
    }
    return this._slotToUV(slot.col, slot.row);
  }

  /**
   * Convert a grid slot to UV coordinates.
   */
  _slotToUV(col, row) {
    const atlasSize = this.gridW * this.tileSize + (this.gridW + 1) * this._gap;
    const cellFrac = (this.tileSize + this._gap) / atlasSize;
    const gapFrac = this._gap / atlasSize;
    return {
      u: gapFrac + col * cellFrac,
      v: 1.0 - (row + 1) * cellFrac,
      size: this.tileSize / atlasSize,
    };
  }

  /**
   * Get display name for an item key.
   */
  getDisplayName(itemKey) {
    const item = this.itemRegistry[itemKey];
    if (!item) {
      const strKey = String(itemKey);
      const strItem = this.itemRegistry[strKey];
      return strItem ? strItem.displayName : String(itemKey);
    }
    return item.displayName;
  }

  /**
   * Get the item texture (THREE.CanvasTexture).
   */
  getTexture() {
    return this.texture;
  }

  /**
   * Get the raw canvas (for debugging).
   */
  getCanvas() {
    return this.canvas;
  }
}

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ItemTextureAtlas;
}
