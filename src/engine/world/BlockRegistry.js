/**
 * Cuubz — Block Registry (Single Source of Truth)
 * 
 * Every block is defined here: ID, name, texture mapping, properties.
 * Replaces BLOCK_TYPES and BLOCK_PROPERTIES from chunkData.js.
 * 
 * Texture format:
 *   { all: 'name' }                    → single texture for all 6 faces
 *   { side: 'name', top: 'name_top' }  → different top/bottom vs sides
 *   { top, side, bottom, front }       → full per-face control
 * 
 * Categories: 'air' | 'solid' | 'cutout' | 'transparent'
 *   solid       → fully opaque, standard face culling
 *   cutout      → alpha-tested (discard transparent pixels): leaves, flowers, torches
 *   transparent → alpha-blended: water, ice, glass
 * 
 * Loaded FIRST in index.html — everything depends on it.
 */

export const BLOCK_REGISTRY = [
  // ═══════════════════════════════════════════════════════════
  // ID 0 — AIR
  // ═══════════════════════════════════════════════════════════
  { id: 0,  name: 'air',            texture: null,                        category: 'air',         hardness: 0 },

  // ═══════════════════════════════════════════════════════════
  // IDs 1–20 — Stone variants
  // ═══════════════════════════════════════════════════════════
  { id: 1,  name: 'bedrock',        texture: { all: 'bedrock' },            category: 'solid',   hardness: -1,   tool: 'pickaxe' },
  { id: 2,  name: 'stone',          texture: { all: 'stone' },              category: 'solid',   hardness: 3.0,  tool: 'pickaxe' },
  { id: 3,  name: 'cobblestone',    texture: { all: 'cobblestone' },        category: 'solid',   hardness: 2.0,  tool: 'pickaxe' },
  { id: 4,  name: 'andesite',       texture: { all: 'andesite' },           category: 'solid',   hardness: 3.0,  tool: 'pickaxe' },
  { id: 5,  name: 'diorite',        texture: { all: 'diorite' },            category: 'solid',   hardness: 3.0,  tool: 'pickaxe' },
  { id: 6,  name: 'granite',        texture: { all: 'granite' },            category: 'solid',   hardness: 3.0,  tool: 'pickaxe' },
  { id: 7,  name: 'tuff',           texture: { all: 'tuff' },               category: 'solid',   hardness: 3.0,  tool: 'pickaxe' },
  { id: 8,  name: 'deepslate',      texture: { all: 'deepslate' },          category: 'solid',   hardness: 3.0,  tool: 'pickaxe' },
  { id: 9,  name: 'cobbled_deepslate', texture: { all: 'cobbled_deepslate' }, category: 'solid', hardness: 3.0,  tool: 'pickaxe' },
  { id: 10, name: 'polished_andesite', texture: { all: 'polished_andesite' }, category: 'solid', hardness: 3.0,  tool: 'pickaxe' },
  { id: 11, name: 'polished_diorite', texture: { all: 'polished_diorite' },  category: 'solid', hardness: 3.0,  tool: 'pickaxe' },
  { id: 12, name: 'polished_granite', texture: { all: 'polished_granite' },  category: 'solid', hardness: 3.0,  tool: 'pickaxe' },
  { id: 13, name: 'polished_deepslate', texture: { all: 'polished_deepslate' }, category:'solid', hardness: 3.0,  tool: 'pickaxe' },
  { id: 14, name: 'deepslate_bricks', texture: { all: 'deepslate_bricks' },   category: 'solid', hardness: 3.0,  tool: 'pickaxe' },
  { id: 15, name: 'deepslate_tiles', texture: { all: 'deepslate_tiles' },     category: 'solid', hardness: 3.0,  tool: 'pickaxe' },
  { id: 16, name: 'stone_bricks',   texture: { all: 'stone_bricks' },         category: 'solid',   hardness: 3.0,  tool: 'pickaxe' },
  { id: 17, name: 'mossy_stone_bricks', texture: { all: 'mossy_stone_bricks' }, category: 'solid', hardness: 3.0,  tool: 'pickaxe' },
  { id: 18, name: 'cracked_stone_bricks', texture: { all: 'cracked_stone_bricks' }, category:'solid', hardness: 3.0,  tool: 'pickaxe' },
  { id: 19, name: 'chiseled_stone_bricks', texture: { all: 'chiseled_stone_bricks' }, category:'solid', hardness: 3.0,  tool: 'pickaxe' },
  { id: 20, name: 'moss_block',     texture: { all: 'moss_block' },           category: 'solid',   hardness: 0.5,  tool: 'shovel' },

  // ═══════════════════════════════════════════════════════════
  // IDs 21–35 — Ores
  // ═══════════════════════════════════════════════════════════
  { id: 21, name: 'coal_ore',       texture: { all: 'coal_ore' },            category: 'solid',   hardness: 3.0,  tool: 'pickaxe' },
  { id: 22, name: 'iron_ore',       texture: { all: 'iron_ore' },            category: 'solid',   hardness: 3.0,  tool: 'pickaxe' },
  { id: 23, name: 'gold_ore',       texture: { all: 'gold_ore' },            category: 'solid',   hardness: 3.0,  tool: 'pickaxe' },
  { id: 24, name: 'diamond_ore',    texture: { all: 'diamond_ore' },         category: 'solid',   hardness: 5.0,  tool: 'pickaxe' },
  { id: 25, name: 'copper_ore',     texture: { all: 'copper_ore' },          category: 'solid',   hardness: 3.0,  tool: 'pickaxe' },
  { id: 26, name: 'emerald_ore',    texture: { all: 'emerald_ore' },         category: 'solid',   hardness: 3.0,  tool: 'pickaxe' },
  { id: 27, name: 'lapis_ore',      texture: { all: 'lapis_ore' },           category: 'solid',   hardness: 3.0,  tool: 'pickaxe' },
  { id: 28, name: 'redstone_ore',   texture: { all: 'redstone_ore' },        category: 'solid',   hardness: 3.0,  tool: 'pickaxe' },
  { id: 29, name: 'nether_gold_ore', texture: { all: 'nether_gold_ore' },    category: 'solid',   hardness: 3.0,  tool: 'pickaxe' },
  { id: 30, name: 'deepslate_coal_ore', texture: { all: 'deepslate_coal_ore' }, category: 'solid', hardness: 3.0, tool: 'pickaxe' },
  { id: 31, name: 'deepslate_iron_ore', texture: { all: 'deepslate_iron_ore' }, category: 'solid', hardness: 3.0, tool: 'pickaxe' },
  { id: 32, name: 'deepslate_gold_ore', texture: { all: 'deepslate_gold_ore' }, category: 'solid', hardness: 3.0, tool: 'pickaxe' },
  { id: 33, name: 'deepslate_diamond_ore', texture: { all: 'deepslate_diamond_ore' }, category:'solid', hardness: 5.0, tool: 'pickaxe' },
  { id: 34, name: 'deepslate_copper_ore', texture: { all: 'deepslate_copper_ore' }, category: 'solid', hardness: 3.0, tool: 'pickaxe' },
  { id: 35, name: 'deepslate_emerald_ore', texture: { all: 'deepslate_emerald_ore' }, category: 'solid', hardness: 3.0, tool: 'pickaxe' },

  // ═══════════════════════════════════════════════════════════
  // IDs 36–45 — Metal blocks
  // ═══════════════════════════════════════════════════════════
  { id: 36, name: 'coal_block',     texture: { all: 'coal_block' },          category: 'solid',   hardness: 5.0,  tool: 'pickaxe' },
  { id: 37, name: 'iron_block',     texture: { all: 'iron_block' },          category: 'solid',   hardness: 5.0,  tool: 'pickaxe' },
  { id: 38, name: 'gold_block',     texture: { all: 'gold_block' },          category: 'solid',   hardness: 5.0,  tool: 'pickaxe' },
  { id: 39, name: 'diamond_block',  texture: { all: 'diamond_block' },       category: 'solid',   hardness: 5.0,  tool: 'pickaxe' },
  { id: 40, name: 'copper_block',   texture: { all: 'copper_block' },        category: 'solid',   hardness: 3.0,  tool: 'pickaxe' },
  { id: 41, name: 'emerald_block',  texture: { all: 'emerald_block' },       category: 'solid',   hardness: 5.0,  tool: 'pickaxe' },
  { id: 42, name: 'lapis_block',    texture: { all: 'lapis_block' },         category: 'solid',   hardness: 3.0,  tool: 'pickaxe' },
  { id: 43, name: 'redstone_block', texture: { all: 'redstone_block' },      category: 'solid',   hardness: 5.0,  tool: 'pickaxe' },
  { id: 44, name: 'netherite_block', texture: { all: 'netherite_block' },    category: 'solid',   hardness: -1,   tool: 'pickaxe' },
  { id: 45, name: 'raw_iron_block', texture: { all: 'raw_iron_block' },      category: 'solid',   hardness: 3.0,  tool: 'pickaxe' },

  // ═══════════════════════════════════════════════════════════
  // IDs 46–47 — Fluids
  // ═══════════════════════════════════════════════════════════
  { id: 46, name: 'water',          texture: { all: 'water' },               category: 'transparent', hardness: 0,  opacity: 0.6 },
  { id: 47, name: 'lava',           texture: { all: 'lava' },                category: 'transparent', hardness: 0,  emissive: 0.9, opacity: 0.7 },

  // ═══════════════════════════════════════════════════════════
  // IDs 48–60 — Surface blocks
  // ═══════════════════════════════════════════════════════════
  { id: 48, name: 'dirt',           texture: { all: 'dirt' },                category: 'solid',   hardness: 0.5,  tool: 'shovel' },
  { id: 49, name: 'grass_block',    texture: { top: 'grass_block_top', side: 'grass_block_side', bottom: 'dirt' }, overlay: { side: 'grass_block_side_overlay' }, category: 'solid', hardness: 0.6, tool: 'shovel' },
  { id: 50, name: 'sand',           texture: { all: 'sand' },                category: 'solid',   hardness: 0.5,  tool: 'shovel', gravity: true },
  { id: 51, name: 'gravel',         texture: { all: 'gravel' },              category: 'solid',   hardness: 0.6,  tool: 'shovel', gravity: true },
  { id: 52, name: 'red_sand',       texture: { all: 'red_sand' },            category: 'solid',   hardness: 0.5,  tool: 'shovel', gravity: true },
  { id: 53, name: 'clay',           texture: { all: 'clay' },                category: 'solid',   hardness: 0.5,  tool: 'shovel' },
  { id: 54, name: 'snow',           texture: { all: 'snow' },                category: 'solid',   hardness: 0.3,  tool: 'shovel' },
  { id: 55, name: 'podzol',         texture: { top: 'podzol_top', side: 'podzol_side', bottom: 'dirt' }, category: 'solid', hardness: 0.5, tool: 'shovel' },
  { id: 56, name: 'coarse_dirt',    texture: { all: 'coarse_dirt' },         category: 'solid',   hardness: 0.5,  tool: 'shovel' },
  { id: 57, name: 'mycelium',       texture: { top: 'mycelium_top', side: 'mycelium_side', bottom: 'dirt' }, category: 'solid', hardness: 0.6, tool: 'shovel' },
  { id: 58, name: 'terracotta',     texture: { all: 'terracotta' },          category: 'solid',   hardness: 1.5,  tool: 'pickaxe' },
  { id: 59, name: 'smooth_stone',   texture: { all: 'smooth_stone' },        category: 'solid',   hardness: 3.0,  tool: 'pickaxe' },
  { id: 60, name: 'calcite',        texture: { all: 'calcite' },             category: 'solid',   hardness: 0.5,  tool: 'shovel' },

  // ═══════════════════════════════════════════════════════════
  // IDs 61–64 — Ice variants (solid: true so player can stand on them)
  // ═══════════════════════════════════════════════════════════
  { id: 61, name: 'ice',            texture: { all: 'ice' },                 category: 'transparent', hardness: 0.5,  opacity: 0.4, solid: true },
  { id: 62, name: 'packed_ice',     texture: { all: 'packed_ice' },          category: 'transparent', hardness: 0.5,  opacity: 0.3, solid: true },
  { id: 63, name: 'blue_ice',       texture: { all: 'blue_ice' },            category: 'transparent', hardness: 0.5,  opacity: 0.2, solid: true },
  { id: 64, name: 'frosted_ice',    texture: { all: 'frosted_ice_0' },       category: 'transparent', hardness: 0.5,  opacity: 0.4, solid: true },

  // ═══════════════════════════════════════════════════════════
  // IDs 65–90 — Wood logs + tops
  // ═══════════════════════════════════════════════════════════
  { id: 65, name: 'oak_log',        texture: { side: 'oak_log', top: 'oak_log_top', bottom: 'oak_log_top' }, category: 'solid', hardness: 2.0, tool: 'axe' },
  { id: 66, name: 'spruce_log',     texture: { side: 'spruce_log', top: 'spruce_log_top', bottom: 'spruce_log_top' }, category: 'solid', hardness: 2.0, tool: 'axe' },
  { id: 67, name: 'birch_log',      texture: { side: 'birch_log', top: 'birch_log_top', bottom: 'birch_log_top' }, category: 'solid', hardness: 2.0, tool: 'axe' },
  { id: 68, name: 'jungle_log',     texture: { side: 'jungle_log', top: 'jungle_log_top', bottom: 'jungle_log_top' }, category: 'solid', hardness: 2.0, tool: 'axe' },
  { id: 69, name: 'acacia_log',     texture: { side: 'acacia_log', top: 'acacia_log_top', bottom: 'acacia_log_top' }, category: 'solid', hardness: 2.0, tool: 'axe' },
  { id: 70, name: 'dark_oak_log',   texture: { side: 'dark_oak_log', top: 'dark_oak_log_top', bottom: 'dark_oak_log_top' }, category: 'solid', hardness: 2.0, tool: 'axe' },
  { id: 71, name: 'cherry_log',     texture: { side: 'cherry_log', top: 'cherry_log_top', bottom: 'cherry_log_top' }, category: 'solid', hardness: 2.0, tool: 'axe' },
  { id: 72, name: 'mangrove_log',   texture: { side: 'mangrove_log', top: 'mangrove_log_top', bottom: 'mangrove_log_top' }, category: 'solid', hardness: 2.0, tool: 'axe' },
  { id: 73, name: 'pale_oak_log',   texture: { side: 'pale_oak_log', top: 'pale_oak_log_top', bottom: 'pale_oak_log_top' }, category: 'solid', hardness: 2.0, tool: 'axe' },
  { id: 74, name: 'poplar_log',     texture: { side: 'poplar_log', top: 'poplar_log_top', bottom: 'poplar_log_top' }, category: 'solid', hardness: 2.0, tool: 'axe' },
  { id: 75, name: 'bamboo_block',   texture: { side: 'bamboo_block', top: 'bamboo_block_top', bottom: 'bamboo_block_top' }, category: 'solid', hardness: 2.0, tool: 'axe' },
  { id: 76, name: 'crimson_stem',   texture: { side: 'crimson_stem', top: 'crimson_stem_top', bottom: 'crimson_stem_top' }, category: 'solid', hardness: 2.0, tool: 'axe' },
  { id: 77, name: 'warped_stem',    texture: { side: 'warped_stem', top: 'warped_stem_top', bottom: 'warped_stem_top' }, category: 'solid', hardness: 2.0, tool: 'axe' },
  { id: 78, name: 'stripped_oak_log', texture: { side: 'stripped_oak_log', top: 'stripped_oak_log_top', bottom: 'stripped_oak_log_top' }, category: 'solid', hardness: 2.0, tool: 'axe' },
  { id: 79, name: 'stripped_spruce_log', texture: { side: 'stripped_spruce_log', top: 'stripped_spruce_log_top', bottom: 'stripped_spruce_log_top' }, category: 'solid', hardness: 2.0, tool: 'axe' },
  { id: 80, name: 'stripped_birch_log', texture: { side: 'stripped_birch_log', top: 'stripped_birch_log_top', bottom: 'stripped_birch_log_top' }, category: 'solid', hardness: 2.0, tool: 'axe' },
  { id: 81, name: 'stripped_jungle_log', texture: { side: 'stripped_jungle_log', top: 'stripped_jungle_log_top', bottom: 'stripped_jungle_log_top' }, category: 'solid', hardness: 2.0, tool: 'axe' },
  { id: 82, name: 'stripped_acacia_log', texture: { side: 'stripped_acacia_log', top: 'stripped_acacia_log_top', bottom: 'stripped_acacia_log_top' }, category: 'solid', hardness: 2.0, tool: 'axe' },
  { id: 83, name: 'stripped_dark_oak_log', texture: { side: 'stripped_dark_oak_log', top: 'stripped_dark_oak_log_top', bottom: 'stripped_dark_oak_log_top' }, category: 'solid', hardness: 2.0, tool: 'axe' },
  { id: 84, name: 'stripped_cherry_log', texture: { side: 'stripped_cherry_log', top: 'stripped_cherry_log_top', bottom: 'stripped_cherry_log_top' }, category: 'solid', hardness: 2.0, tool: 'axe' },
  { id: 85, name: 'stripped_mangrove_log', texture: { side: 'stripped_mangrove_log', top: 'stripped_mangrove_log_top', bottom: 'stripped_mangrove_log_top' }, category: 'solid', hardness: 2.0, tool: 'axe' },
  { id: 86, name: 'stripped_pale_oak_log', texture: { side: 'stripped_pale_oak_log', top: 'stripped_pale_oak_log_top', bottom: 'stripped_pale_oak_log_top' }, category: 'solid', hardness: 2.0, tool: 'axe' },
  { id: 87, name: 'stripped_poplar_log', texture: { side: 'stripped_poplar_log', top: 'stripped_poplar_log_top', bottom: 'stripped_poplar_log_top' }, category: 'solid', hardness: 2.0, tool: 'axe' },
  { id: 88, name: 'stripped_bamboo_block', texture: { side: 'stripped_bamboo_block', top: 'stripped_bamboo_block_top', bottom: 'stripped_bamboo_block_top' }, category: 'solid', hardness: 2.0, tool: 'axe' },
  { id: 89, name: 'stripped_crimson_stem', texture: { side: 'stripped_crimson_stem', top: 'stripped_crimson_stem_top', bottom: 'stripped_crimson_stem_top' }, category: 'solid', hardness: 2.0, tool: 'axe' },
  { id: 90, name: 'stripped_warped_stem', texture: { side: 'stripped_warped_stem', top: 'stripped_warped_stem_top', bottom: 'stripped_warped_stem_top' }, category: 'solid', hardness: 2.0, tool: 'axe' },

  // ═══════════════════════════════════════════════════════════
  // IDs 91–103 — Planks
  // ═══════════════════════════════════════════════════════════
  { id: 91, name: 'oak_planks',     texture: { all: 'oak_planks' },          category: 'solid',   hardness: 1.5,  tool: 'axe' },
  { id: 92, name: 'spruce_planks',  texture: { all: 'spruce_planks' },       category: 'solid',   hardness: 1.5,  tool: 'axe' },
  { id: 93, name: 'birch_planks',   texture: { all: 'birch_planks' },        category: 'solid',   hardness: 1.5,  tool: 'axe' },
  { id: 94, name: 'jungle_planks',  texture: { all: 'jungle_planks' },       category: 'solid',   hardness: 1.5,  tool: 'axe' },
  { id: 95, name: 'acacia_planks',  texture: { all: 'acacia_planks' },       category: 'solid',   hardness: 1.5,  tool: 'axe' },
  { id: 96, name: 'dark_oak_planks', texture: { all: 'dark_oak_planks' },    category: 'solid',   hardness: 1.5,  tool: 'axe' },
  { id: 97, name: 'cherry_planks',  texture: { all: 'cherry_planks' },       category: 'solid',   hardness: 1.5,  tool: 'axe' },
  { id: 98, name: 'mangrove_planks', texture: { all: 'mangrove_planks' },    category: 'solid',   hardness: 1.5,  tool: 'axe' },
  { id: 99, name: 'pale_oak_planks', texture: { all: 'pale_oak_planks' },    category: 'solid',   hardness: 1.5,  tool: 'axe' },
  { id: 100, name: 'poplar_planks', texture: { all: 'poplar_planks' },       category: 'solid',   hardness: 1.5,  tool: 'axe' },
  { id: 101, name: 'bamboo_planks', texture: { all: 'bamboo_planks' },       category: 'solid',   hardness: 1.5,  tool: 'axe' },
  { id: 102, name: 'crimson_planks', texture: { all: 'crimson_planks' },     category: 'solid',   hardness: 1.5,  tool: 'axe' },
  { id: 103, name: 'warped_planks', texture: { all: 'warped_planks' },       category: 'solid',   hardness: 1.5,  tool: 'axe' },

  // ═══════════════════════════════════════════════════════════
  // IDs 104–114 — Leaves
  // ═══════════════════════════════════════════════════════════
  { id: 104, name: 'oak_leaves',       texture: { all: 'oak_leaves' },         category: 'cutout',  hardness: 0.2,  tool: 'shears' },
  { id: 105, name: 'spruce_leaves',    texture: { all: 'spruce_leaves' },      category: 'cutout',  hardness: 0.2,  tool: 'shears' },
  { id: 106, name: 'birch_leaves',     texture: { all: 'birch_leaves' },       category: 'cutout',  hardness: 0.2,  tool: 'shears' },
  { id: 107, name: 'jungle_leaves',    texture: { all: 'jungle_leaves' },      category: 'cutout',  hardness: 0.2,  tool: 'shears' },
  { id: 108, name: 'acacia_leaves',    texture: { all: 'acacia_leaves' },      category: 'cutout',  hardness: 0.2,  tool: 'shears' },
  { id: 109, name: 'dark_oak_leaves',  texture: { all: 'dark_oak_leaves' },    category: 'cutout',  hardness: 0.2,  tool: 'shears' },
  { id: 110, name: 'cherry_leaves',    texture: { all: 'cherry_leaves' },      category: 'cutout',  hardness: 0.2,  tool: 'shears' },
  { id: 111, name: 'mangrove_leaves',  texture: { all: 'mangrove_leaves' },    category: 'cutout',  hardness: 0.2,  tool: 'shears' },
  { id: 112, name: 'pale_oak_leaves',  texture: { all: 'pale_oak_leaves' },    category: 'cutout',  hardness: 0.2,  tool: 'shears' },
  { id: 113, name: 'orange_poplar_leaves', texture: { all: 'orange_poplar_leaves' }, category: 'cutout', hardness: 0.2, tool: 'shears' },
  { id: 114, name: 'red_poplar_leaves',  texture: { all: 'red_poplar_leaves' }, category: 'cutout',  hardness: 0.2,  tool: 'shears' },
  // id 192, not 115: the colored-block range below starts at 115, so this entry
  // collided with white_concrete and was silently shadowed (BLOCK_BY_ID is built by
  // iteration, so the later entry won). Moved to the first free id rather than
  // shifting the 32 concrete/wool blocks, which would reinterpret saved chunks.
  { id: 192, name: 'yellow_poplar_leaves', texture: { all: 'yellow_poplar_leaves' }, category: 'cutout', hardness: 0.2, tool: 'shears' },

  // ═══════════════════════════════════════════════════════════
  // IDs 115–146 — Colored blocks (16 concrete + 16 wool)
  // ═══════════════════════════════════════════════════════════
  { id: 115, name: 'white_concrete',   texture: { all: 'white_concrete' },   category: 'solid',   hardness: 1.5,  tool: 'pickaxe' },
  { id: 116, name: 'orange_concrete',  texture: { all: 'orange_concrete' },  category: 'solid',   hardness: 1.5,  tool: 'pickaxe' },
  { id: 117, name: 'magenta_concrete', texture: { all: 'magenta_concrete' }, category: 'solid',   hardness: 1.5,  tool: 'pickaxe' },
  { id: 118, name: 'light_blue_concrete', texture: { all: 'light_blue_concrete' }, category: 'solid', hardness: 1.5, tool: 'pickaxe' },
  { id: 119, name: 'yellow_concrete',  texture: { all: 'yellow_concrete' },  category: 'solid',   hardness: 1.5,  tool: 'pickaxe' },
  { id: 120, name: 'lime_concrete',    texture: { all: 'lime_concrete' },    category: 'solid',   hardness: 1.5,  tool: 'pickaxe' },
  { id: 121, name: 'pink_concrete',    texture: { all: 'pink_concrete' },    category: 'solid',   hardness: 1.5,  tool: 'pickaxe' },
  { id: 122, name: 'gray_concrete',    texture: { all: 'gray_concrete' },    category: 'solid',   hardness: 1.5,  tool: 'pickaxe' },
  { id: 123, name: 'light_gray_concrete', texture: { all: 'light_gray_concrete' }, category: 'solid', hardness: 1.5, tool: 'pickaxe' },
  { id: 124, name: 'cyan_concrete',    texture: { all: 'cyan_concrete' },    category: 'solid',   hardness: 1.5,  tool: 'pickaxe' },
  { id: 125, name: 'purple_concrete',  texture: { all: 'purple_concrete' },  category: 'solid',   hardness: 1.5,  tool: 'pickaxe' },
  { id: 126, name: 'blue_concrete',    texture: { all: 'blue_concrete' },    category: 'solid',   hardness: 1.5,  tool: 'pickaxe' },
  { id: 127, name: 'brown_concrete',   texture: { all: 'brown_concrete' },   category: 'solid',   hardness: 1.5,  tool: 'pickaxe' },
  { id: 128, name: 'green_concrete',   texture: { all: 'green_concrete' },   category: 'solid',   hardness: 1.5,  tool: 'pickaxe' },
  { id: 129, name: 'red_concrete',     texture: { all: 'red_concrete' },     category: 'solid',   hardness: 1.5,  tool: 'pickaxe' },
  { id: 130, name: 'black_concrete',   texture: { all: 'black_concrete' },   category: 'solid',   hardness: 1.5,  tool: 'pickaxe' },
  { id: 131, name: 'white_wool',       texture: { all: 'white_wool' },       category: 'solid',   hardness: 0.8,  tool: 'shears' },
  { id: 132, name: 'orange_wool',      texture: { all: 'orange_wool' },      category: 'solid',   hardness: 0.8,  tool: 'shears' },
  { id: 133, name: 'magenta_wool',     texture: { all: 'magenta_wool' },     category: 'solid',   hardness: 0.8,  tool: 'shears' },
  { id: 134, name: 'light_blue_wool',  texture: { all: 'light_blue_wool' },  category: 'solid',   hardness: 0.8,  tool: 'shears' },
  { id: 135, name: 'yellow_wool',      texture: { all: 'yellow_wool' },      category: 'solid',   hardness: 0.8,  tool: 'shears' },
  { id: 136, name: 'lime_wool',        texture: { all: 'lime_wool' },        category: 'solid',   hardness: 0.8,  tool: 'shears' },
  { id: 137, name: 'pink_wool',        texture: { all: 'pink_wool' },        category: 'solid',   hardness: 0.8,  tool: 'shears' },
  { id: 138, name: 'gray_wool',        texture: { all: 'gray_wool' },        category: 'solid',   hardness: 0.8,  tool: 'shears' },
  { id: 139, name: 'light_gray_wool',  texture: { all: 'light_gray_wool' },  category: 'solid',   hardness: 0.8,  tool: 'shears' },
  { id: 140, name: 'cyan_wool',        texture: { all: 'cyan_wool' },        category: 'solid',   hardness: 0.8,  tool: 'shears' },
  { id: 141, name: 'purple_wool',      texture: { all: 'purple_wool' },      category: 'solid',   hardness: 0.8,  tool: 'shears' },
  { id: 142, name: 'blue_wool',        texture: { all: 'blue_wool' },        category: 'solid',   hardness: 0.8,  tool: 'shears' },
  { id: 143, name: 'brown_wool',       texture: { all: 'brown_wool' },       category: 'solid',   hardness: 0.8,  tool: 'shears' },
  { id: 144, name: 'green_wool',       texture: { all: 'green_wool' },       category: 'solid',   hardness: 0.8,  tool: 'shears' },
  { id: 145, name: 'red_wool',         texture: { all: 'red_wool' },         category: 'solid',   hardness: 0.8,  tool: 'shears' },
  { id: 146, name: 'black_wool',       texture: { all: 'black_wool' },       category: 'solid',   hardness: 0.8,  tool: 'shears' },

  // ═══════════════════════════════════════════════════════════
  // IDs 147–157 — Nether
  // ═══════════════════════════════════════════════════════════
  { id: 147, name: 'netherrack',       texture: { all: 'netherrack' },           category: 'solid',   hardness: 0.5,  tool: 'pickaxe' },
  { id: 148, name: 'basalt',           texture: { side: 'basalt_side', top: 'basalt_top', bottom: 'basalt_top' }, category: 'solid', hardness: 1.5, tool: 'pickaxe' },
  { id: 149, name: 'blackstone',       texture: { side: 'blackstone', top: 'blackstone_top', bottom: 'blackstone_top' }, category: 'solid', hardness: 2.0, tool: 'pickaxe' },
  { id: 150, name: 'soul_sand',        texture: { all: 'soul_sand' },            category: 'solid',   hardness: 0.5,  tool: 'shovel' },
  { id: 151, name: 'soul_soil',        texture: { all: 'soul_soil' },            category: 'solid',   hardness: 0.5,  tool: 'shovel' },
  { id: 152, name: 'crimson_nylium',   texture: { side: 'crimson_nylium', top: 'crimson_nylium_side', bottom: 'crimson_nylium' }, category: 'solid', hardness: 0.5, tool: 'shovel' },
  { id: 153, name: 'warped_nylium',    texture: { side: 'warped_nylium', top: 'warped_nylium_side', bottom: 'warped_nylium' }, category: 'solid', hardness: 0.5, tool: 'shovel' },
  { id: 154, name: 'crying_obsidian',  texture: { all: 'crying_obsidian' },      category: 'solid',   hardness: -1,   tool: 'pickaxe' },
  { id: 155, name: 'magma',            texture: { all: 'magma' },                category: 'solid',   hardness: 0.5,  tool: 'pickaxe', emissive: 0.5 },
  { id: 156, name: 'ancient_debris',   texture: { side: 'ancient_debris_side', top: 'ancient_debris_top', bottom: 'ancient_debris_top' }, category: 'solid', hardness: -1, tool: 'pickaxe' },
  { id: 157, name: 'nether_bricks',    texture: { all: 'nether_bricks' },        category: 'solid',   hardness: 2.0,  tool: 'pickaxe' },

  // ═══════════════════════════════════════════════════════════
  // IDs 158–160 — End
  // ═══════════════════════════════════════════════════════════
  { id: 158, name: 'end_stone',        texture: { all: 'end_stone' },            category: 'solid',   hardness: 3.0,  tool: 'pickaxe' },
  { id: 159, name: 'end_stone_bricks', texture: { all: 'end_stone_bricks' },     category: 'solid',   hardness: 3.0,  tool: 'pickaxe' },
  { id: 160, name: 'purpur_block',     texture: { side: 'purpur_block', top: 'purpur_pillar_top', bottom: 'purpur_pillar_top' }, category: 'solid', hardness: 1.5, tool: 'pickaxe' },

  // ═══════════════════════════════════════════════════════════
  // IDs 161–176 — Decorations
  // ═══════════════════════════════════════════════════════════
  { id: 161, name: 'bookshelf',        texture: { all: 'bookshelf' },            category: 'solid',   hardness: 1.5,  tool: 'axe' },
  { id: 162, name: 'crafting_table',   texture: { top: 'crafting_table_top', side: 'crafting_table_side', front: 'crafting_table_front', bottom: 'crafting_table_top' }, category: 'solid', hardness: 1.5, tool: 'axe' },
  { id: 163, name: 'furnace',          texture: { top: 'furnace_top', side: 'furnace_side', front: 'furnace_front', bottom: 'furnace_top' }, category: 'solid', hardness: 3.0, tool: 'pickaxe' },
  { id: 164, name: 'smoker',           texture: { top: 'smoker_top', side: 'smoker_side', front: 'smoker_front', bottom: 'smoker_bottom' }, category: 'solid', hardness: 3.0, tool: 'pickaxe' },
  { id: 165, name: 'blast_furnace',    texture: { top: 'blast_furnace_top', side: 'blast_furnace_side', front: 'blast_furnace_front', bottom: 'blast_furnace_top' }, category: 'solid', hardness: 3.0, tool: 'pickaxe' },
  { id: 166, name: 'barrel',           texture: { top: 'barrel_top', side: 'barrel_side', front: 'barrel_side', bottom: 'barrel_bottom' }, category: 'solid', hardness: 1.5, tool: 'axe' },
  { id: 167, name: 'chest',            texture: { top: 'barrel_top', side: 'barrel_side', front: 'barrel_side', bottom: 'barrel_bottom' }, category: 'solid', hardness: 1.5, tool: 'axe' },
  { id: 168, name: 'ladder',           texture: { all: 'ladder' },               category: 'cutout',  hardness: 0.4,  tool: 'axe' },
  { id: 169, name: 'hay_block',        texture: { side: 'hay_block_side', top: 'hay_block_top', bottom: 'hay_block_top' }, category: 'solid', hardness: 0.5, tool: 'axe' },
  { id: 170, name: 'glowstone',        texture: { all: 'glowstone' },            category: 'cutout',  hardness: 0.3,  tool: 'pickaxe', emissive: 1.0 },
  { id: 171, name: 'sea_lantern',      texture: { all: 'sea_lantern' },          category: 'solid',   hardness: 0.3,  tool: 'pickaxe', emissive: 1.0 },
  { id: 172, name: 'torch',            texture: { all: 'torch' },                category: 'cutout',  hardness: 0.0,  emissive: 0.8 },
  { id: 173, name: 'lantern',          texture: { all: 'lantern' },              category: 'cutout',  hardness: 0.3,  tool: 'pickaxe', emissive: 0.7 },
  { id: 174, name: 'soul_lantern',     texture: { all: 'soul_lantern' },         category: 'cutout',  hardness: 0.3,  tool: 'pickaxe', emissive: 0.7 },
  { id: 175, name: 'campfire',         texture: { all: 'campfire_log_lit' },     category: 'cutout',  hardness: 0.0,  emissive: 0.8 },
  { id: 176, name: 'target',           texture: { side: 'target_side', top: 'target_top', bottom: 'target_top' }, category: 'solid', hardness: 1.5, tool: 'axe' },

  // ═══════════════════════════════════════════════════════════
  // IDs 177–187 — Plants
  // ═══════════════════════════════════════════════════════════
  { id: 177, name: 'short_grass',      texture: { all: 'short_grass' },          category: 'cutout',  hardness: 0.0, meshType: 'crossbillboard', meshHeight: 1 },
  { id: 178, name: 'tall_grass',       texture: { side: 'tall_grass_top', top: 'tall_grass_top', bottom: 'tall_grass_bottom' }, category: 'cutout', hardness: 0.0, meshType: 'crossbillboard_stacked', meshHeight: 2 },
  { id: 179, name: 'red_flower',       texture: { all: 'pink_petals' }, color: [1, 0.25, 0.25], category: 'cutout',  hardness: 0.0, meshType: 'topface' },
  { id: 180, name: 'yellow_flower',    texture: { all: 'pink_petals' }, color: [1, 1, 0.25],   category: 'cutout',  hardness: 0.0, meshType: 'topface' },
  { id: 181, name: 'brown_mushroom',   texture: { all: 'brown_mushroom_block' }, category: 'cutout',  hardness: 0.0 },
  { id: 182, name: 'red_mushroom',     texture: { all: 'red_mushroom_block' },   category: 'cutout',  hardness: 0.0 },
  { id: 183, name: 'weeping_vines',    texture: { all: 'weeping_vines' },        category: 'cutout',  hardness: 0.0 },
  { id: 184, name: 'twisting_vines',   texture: { all: 'twisting_vines' },       category: 'cutout',  hardness: 0.0 },
  { id: 185, name: 'cactus',           texture: { side: 'cactus_side', top: 'cactus_top', bottom: 'cactus_bottom' }, category: 'solid', hardness: 0.4, tool: 'axe' },
  { id: 186, name: 'glow_lichen',      texture: { all: 'glow_lichen' },          category: 'cutout',  hardness: 0.0,  emissive: 0.3 },
  { id: 187, name: 'vine',             texture: { all: 'weeping_vines' },        category: 'cutout',  hardness: 0.0 },

  // ═══════════════════════════════════════════════════════════
  // IDs 188–191 — Game-specific (Cuubz)
  // ═══════════════════════════════════════════════════════════
  { id: 188, name: 'toxic_slime',      texture: { all: 'slime_block' },          category: 'transparent', hardness: 0.5,  opacity: 0.6 },
  { id: 189, name: 'corrupt_crystal',  texture: { all: 'amethyst_cluster' },     category: 'cutout',  hardness: 2.0,  tool: 'pickaxe' },
  { id: 190, name: 'apple',            texture: { side: 'melon_side', top: 'melon_top', bottom: 'melon_top' }, category: 'cutout', hardness: 0.1 },
  { id: 191, name: 'quest_key',        texture: { all: 'iron_bars' },            category: 'cutout',  hardness: 0.1 },

  // ═══════════════════════════════════════════════════════════
  // IDs 193–195 — The Corrupt biome (S4)
  // ═══════════════════════════════════════════════════════════
  //
  // **Zero new art.** Every texture here is a PNG that has shipped in
  // `textures/blocks/` all along and that no registry entry referenced, which is why
  // none of them appear in `manifest.json` today — the generator emits only what the
  // registry names. Adding these three means re-running `npm run generate-manifest`,
  // and `test/unit/meta/textureCoverage.test.js` is where forgetting shows up.
  //
  // Lava needs nothing: `netherrack`, `basalt`, `blackstone`, `magma`, `soul_sand`,
  // `soul_soil`, `crying_obsidian`, `soul_lantern` and `lava` are all already here.
  { id: 193, name: 'corrupt_grass',    texture: { side: 'warped_nylium_side', top: 'warped_nylium', bottom: 'dirt' }, category: 'solid', hardness: 0.6, tool: 'shovel' },
  { id: 194, name: 'corrupt_stone',    texture: { all: 'sculk' },                category: 'solid',   hardness: 3.0,  tool: 'pickaxe' },
  { id: 195, name: 'corrupt_vein',     texture: { all: 'sculk_vein' },           category: 'cutout',  hardness: 0.0 },

  // ═══════════════════════════════════════════════════════════
  // IDs 196–198 — Content the 28-quest storyline assumes and the registry lacked
  // ═══════════════════════════════════════════════════════════
  //
  // `quest_implementation.md` §2.5 lists two gaps (`bed`, `bread`). Writing the quest
  // definitions found two more, and every one of the four is a quest requirement that
  // could never be met:
  //
  //   • **obsidian** — Q13 asks for 5, Q14 for 15, Q16 for 10. The registry had only
  //     `crying_obsidian`, at hardness **-1**, which `getBlockDrop` returns `null` for.
  //     `BLOCK_TYPES.OBSIDIAN` was a legacy *alias* pointing at it, so "collect obsidian"
  //     meant "mine an unbreakable block that drops nothing" — three quests in Act 3 dead
  //     behind a texture that was already on disk.
  //   • **sandstone** — Q22 asks for 15 and §7.3 builds the Buried Hall out of it. No
  //     entry at all, though `sandstone.png` / `_top` / `_bottom` have always shipped.
  //
  // 193–195 are left free: `quest_implementation.md` §3.4 assigns them to the three
  // Corrupt blocks in S4, and taking them here would make that plan's ids wrong.
  { id: 196, name: 'obsidian',         texture: { all: 'obsidian' },             category: 'solid',   hardness: 10.0, tool: 'pickaxe' },
  { id: 197, name: 'sandstone',        texture: { side: 'sandstone', top: 'sandstone_top', bottom: 'sandstone_bottom' }, category: 'solid', hardness: 1.5, tool: 'pickaxe' },
  // The bed is a crafted block, not a generated one. No bed texture ships, and rather
  // than draw one it is what a bed is in a voxel world: wool over planks. Q06 asks the
  // player to build a place to rest, and this is a thing you can place and stand on.
  { id: 198, name: 'bed',              texture: { side: 'oak_planks', top: 'white_wool', bottom: 'oak_planks' }, category: 'solid', hardness: 0.2, tool: 'axe' },
];

// ─── Convenience lookups (computed once at load) ─────────────────────

export const BLOCK_BY_ID = {};
export const BLOCK_BY_NAME = {};
export let MAX_BLOCK_ID = 0;

for (const block of BLOCK_REGISTRY) {
  BLOCK_BY_ID[block.id] = block;
  BLOCK_BY_NAME[block.name] = block;
  if (block.id > MAX_BLOCK_ID) MAX_BLOCK_ID = block.id;
}

// ─── Backward compatibility: BLOCK_PROPERTIES (old-style property map) ───
// Populated from registry so old code referencing BLOCK_PROPERTIES[id] still works.

export const BLOCK_PROPERTIES = {};
for (const block of BLOCK_REGISTRY) {
  BLOCK_PROPERTIES[block.id] = {
    name: block.name,
    solid: block.solid !== undefined ? block.solid : block.category === 'solid',
    hardness: block.hardness || 0,
    tool: block.tool || null,
    category: block.category,
    emissive: block.emissive || 0,
    opacity: block.opacity || 1.0,
    gravity: block.gravity || false,
  };
}

// ─── Backward compatibility: BLOCK_TYPES (old-style constant map) ───
// Populated from registry so old code referencing BLOCK_TYPES.X still works.

export const BLOCK_TYPES = {
  AIR:             BLOCK_BY_NAME['air'].id,
  BEDROCK:         BLOCK_BY_NAME['bedrock'].id,
  STONE:           BLOCK_BY_NAME['stone'].id,
  COBBLESTONE:     BLOCK_BY_NAME['cobblestone'].id,
  ANDESITE:        BLOCK_BY_NAME['andesite'].id,
  DIORITE:         BLOCK_BY_NAME['diorite'].id,
  GRANITE:         BLOCK_BY_NAME['granite'].id,
  TUFF:            BLOCK_BY_NAME['tuff'].id,
  DEEPSLATE:       BLOCK_BY_NAME['deepslate'].id,
  COAL_ORE:        BLOCK_BY_NAME['coal_ore'].id,
  IRON_ORE:        BLOCK_BY_NAME['iron_ore'].id,
  GOLD_ORE:        BLOCK_BY_NAME['gold_ore'].id,
  DIAMOND_ORE:     BLOCK_BY_NAME['diamond_ore'].id,
  COPPER_ORE:      BLOCK_BY_NAME['copper_ore'].id,
  EMERALD_ORE:     BLOCK_BY_NAME['emerald_ore'].id,
  LAPIS_ORE:       BLOCK_BY_NAME['lapis_ore'].id,
  REDSTONE_ORE:    BLOCK_BY_NAME['redstone_ore'].id,
  DEEPSLATE_COAL_ORE:    BLOCK_BY_NAME['deepslate_coal_ore'].id,
  DEEPSLATE_IRON_ORE:    BLOCK_BY_NAME['deepslate_iron_ore'].id,
  DEEPSLATE_GOLD_ORE:    BLOCK_BY_NAME['deepslate_gold_ore'].id,
  DEEPSLATE_DIAMOND_ORE: BLOCK_BY_NAME['deepslate_diamond_ore'].id,
  DEEPSLATE_COPPER_ORE:  BLOCK_BY_NAME['deepslate_copper_ore'].id,
  DEEPSLATE_EMERALD_ORE: BLOCK_BY_NAME['deepslate_emerald_ore'].id,
  WATER:           BLOCK_BY_NAME['water'].id,
  LAVA:            BLOCK_BY_NAME['lava'].id,
  DIRT:            BLOCK_BY_NAME['dirt'].id,
  GRASS:           BLOCK_BY_NAME['grass_block'].id,
  SAND:            BLOCK_BY_NAME['sand'].id,
  GRAVEL:          BLOCK_BY_NAME['gravel'].id,
  RED_SAND:        BLOCK_BY_NAME['red_sand'].id,
  CLAY:            BLOCK_BY_NAME['clay'].id,
  SNOW:            BLOCK_BY_NAME['snow'].id,
  PODZOL:          BLOCK_BY_NAME['podzol'].id,
  COARSE_DIRT:     BLOCK_BY_NAME['coarse_dirt'].id,
  MOSS_BLOCK:      BLOCK_BY_NAME['moss_block'].id,
  MYCELIUM:        BLOCK_BY_NAME['mycelium'].id,
  TERRACOTTA:      BLOCK_BY_NAME['terracotta'].id,
  ICE:             BLOCK_BY_NAME['ice'].id,
  PACKED_ICE:      BLOCK_BY_NAME['packed_ice'].id,
  BLUE_ICE:        BLOCK_BY_NAME['blue_ice'].id,
  OAK_LOG:         BLOCK_BY_NAME['oak_log'].id,
  SPRUCE_LOG:      BLOCK_BY_NAME['spruce_log'].id,
  BIRCH_LOG:       BLOCK_BY_NAME['birch_log'].id,
  JUNGLE_LOG:      BLOCK_BY_NAME['jungle_log'].id,
  ACACIA_LOG:      BLOCK_BY_NAME['acacia_log'].id,
  DARK_OAK_LOG:    BLOCK_BY_NAME['dark_oak_log'].id,
  CHERRY_LOG:      BLOCK_BY_NAME['cherry_log'].id,
  MANGROVE_LOG:    BLOCK_BY_NAME['mangrove_log'].id,
  PALE_OAK_LOG:    BLOCK_BY_NAME['pale_oak_log'].id,
  POPLAR_LOG:      BLOCK_BY_NAME['poplar_log'].id,
  BAMBOO_BLOCK:    BLOCK_BY_NAME['bamboo_block'].id,
  CRIMSON_STEM:    BLOCK_BY_NAME['crimson_stem'].id,
  WARPED_STEM:     BLOCK_BY_NAME['warped_stem'].id,
  OAK_PLANKS:      BLOCK_BY_NAME['oak_planks'].id,
  SPRUCE_PLANKS:   BLOCK_BY_NAME['spruce_planks'].id,
  BIRCH_PLANKS:    BLOCK_BY_NAME['birch_planks'].id,
  JUNGLE_PLANKS:   BLOCK_BY_NAME['jungle_planks'].id,
  ACACIA_PLANKS:   BLOCK_BY_NAME['acacia_planks'].id,
  DARK_OAK_PLANKS: BLOCK_BY_NAME['dark_oak_planks'].id,
  CHERRY_PLANKS:   BLOCK_BY_NAME['cherry_planks'].id,
  MANGROVE_PLANKS: BLOCK_BY_NAME['mangrove_planks'].id,
  PALE_OAK_PLANKS: BLOCK_BY_NAME['pale_oak_planks'].id,
  POPLAR_PLANKS:   BLOCK_BY_NAME['poplar_planks'].id,
  BAMBOO_PLANKS:   BLOCK_BY_NAME['bamboo_planks'].id,
  CRIMSON_PLANKS:  BLOCK_BY_NAME['crimson_planks'].id,
  WARPED_PLANKS:   BLOCK_BY_NAME['warped_planks'].id,
  OAK_LEAVES:      BLOCK_BY_NAME['oak_leaves'].id,
  SPRUCE_LEAVES:   BLOCK_BY_NAME['spruce_leaves'].id,
  BIRCH_LEAVES:    BLOCK_BY_NAME['birch_leaves'].id,
  JUNGLE_LEAVES:   BLOCK_BY_NAME['jungle_leaves'].id,
  ACACIA_LEAVES:   BLOCK_BY_NAME['acacia_leaves'].id,
  DARK_OAK_LEAVES: BLOCK_BY_NAME['dark_oak_leaves'].id,
  CHERRY_LEAVES:   BLOCK_BY_NAME['cherry_leaves'].id,
  MANGROVE_LEAVES: BLOCK_BY_NAME['mangrove_leaves'].id,
  PALE_OAK_LEAVES: BLOCK_BY_NAME['pale_oak_leaves'].id,
  ORANGE_POPLAR_LEAVES: BLOCK_BY_NAME['orange_poplar_leaves'].id,
  RED_POPLAR_LEAVES:    BLOCK_BY_NAME['red_poplar_leaves'].id,
  YELLOW_POPLAR_LEAVES: BLOCK_BY_NAME['yellow_poplar_leaves'].id,
  WHITE_CONCRETE:  BLOCK_BY_NAME['white_concrete'].id,
  ORANGE_CONCRETE: BLOCK_BY_NAME['orange_concrete'].id,
  MAGENTA_CONCRETE:BLOCK_BY_NAME['magenta_concrete'].id,
  LIGHT_BLUE_CONCRETE: BLOCK_BY_NAME['light_blue_concrete'].id,
  YELLOW_CONCRETE: BLOCK_BY_NAME['yellow_concrete'].id,
  LIME_CONCRETE:   BLOCK_BY_NAME['lime_concrete'].id,
  PINK_CONCRETE:   BLOCK_BY_NAME['pink_concrete'].id,
  GRAY_CONCRETE:   BLOCK_BY_NAME['gray_concrete'].id,
  LIGHT_GRAY_CONCRETE: BLOCK_BY_NAME['light_gray_concrete'].id,
  CYAN_CONCRETE:   BLOCK_BY_NAME['cyan_concrete'].id,
  PURPLE_CONCRETE: BLOCK_BY_NAME['purple_concrete'].id,
  BLUE_CONCRETE:   BLOCK_BY_NAME['blue_concrete'].id,
  BROWN_CONCRETE:  BLOCK_BY_NAME['brown_concrete'].id,
  GREEN_CONCRETE:  BLOCK_BY_NAME['green_concrete'].id,
  RED_CONCRETE:    BLOCK_BY_NAME['red_concrete'].id,
  BLACK_CONCRETE:  BLOCK_BY_NAME['black_concrete'].id,
  WHITE_WOOL:      BLOCK_BY_NAME['white_wool'].id,
  ORANGE_WOOL:     BLOCK_BY_NAME['orange_wool'].id,
  MAGENTA_WOOL:    BLOCK_BY_NAME['magenta_wool'].id,
  LIGHT_BLUE_WOOL: BLOCK_BY_NAME['light_blue_wool'].id,
  YELLOW_WOOL:     BLOCK_BY_NAME['yellow_wool'].id,
  LIME_WOOL:       BLOCK_BY_NAME['lime_wool'].id,
  PINK_WOOL:       BLOCK_BY_NAME['pink_wool'].id,
  GRAY_WOOL:       BLOCK_BY_NAME['gray_wool'].id,
  LIGHT_GRAY_WOOL: BLOCK_BY_NAME['light_gray_wool'].id,
  CYAN_WOOL:       BLOCK_BY_NAME['cyan_wool'].id,
  PURPLE_WOOL:     BLOCK_BY_NAME['purple_wool'].id,
  BLUE_WOOL:       BLOCK_BY_NAME['blue_wool'].id,
  BROWN_WOOL:      BLOCK_BY_NAME['brown_wool'].id,
  GREEN_WOOL:      BLOCK_BY_NAME['green_wool'].id,
  RED_WOOL:        BLOCK_BY_NAME['red_wool'].id,
  BLACK_WOOL:      BLOCK_BY_NAME['black_wool'].id,
  NETHERRACK:      BLOCK_BY_NAME['netherrack'].id,
  BASALT:          BLOCK_BY_NAME['basalt'].id,
  BLACKSTONE:      BLOCK_BY_NAME['blackstone'].id,
  SOUL_SAND:       BLOCK_BY_NAME['soul_sand'].id,
  SOUL_SOIL:       BLOCK_BY_NAME['soul_soil'].id,
  CRIMSON_NYLIUM:  BLOCK_BY_NAME['crimson_nylium'].id,
  WARPED_NYLIUM:   BLOCK_BY_NAME['warped_nylium'].id,
  CRYING_OBSIDIAN: BLOCK_BY_NAME['crying_obsidian'].id,
  MAGMA:           BLOCK_BY_NAME['magma'].id,
  ANCIENT_DEBRIS:  BLOCK_BY_NAME['ancient_debris'].id,
  END_STONE:       BLOCK_BY_NAME['end_stone'].id,
  END_STONE_BRICKS:BLOCK_BY_NAME['end_stone_bricks'].id,
  PURPUR_BLOCK:    BLOCK_BY_NAME['purpur_block'].id,
  BOOKSHELF:       BLOCK_BY_NAME['bookshelf'].id,
  CRAFTING_TABLE:  BLOCK_BY_NAME['crafting_table'].id,
  FURNACE:         BLOCK_BY_NAME['furnace'].id,
  SMOKER:          BLOCK_BY_NAME['smoker'].id,
  BLAST_FURNACE:   BLOCK_BY_NAME['blast_furnace'].id,
  BARREL:          BLOCK_BY_NAME['barrel'].id,
  CHEST:           BLOCK_BY_NAME['chest'].id,
  LADDER:          BLOCK_BY_NAME['ladder'].id,
  HAY_BLOCK:       BLOCK_BY_NAME['hay_block'].id,
  GLOWSTONE:       BLOCK_BY_NAME['glowstone'].id,
  SEA_LANTERN:     BLOCK_BY_NAME['sea_lantern'].id,
  TORCH:           BLOCK_BY_NAME['torch'].id,
  LANTERN:         BLOCK_BY_NAME['lantern'].id,
  SOUL_LANTERN:    BLOCK_BY_NAME['soul_lantern'].id,
  CAMPFIRE:        BLOCK_BY_NAME['campfire'].id,
  TARGET:          BLOCK_BY_NAME['target'].id,
  SHORT_GRASS:     BLOCK_BY_NAME['short_grass'].id,
  TALL_GRASS:      BLOCK_BY_NAME['tall_grass'].id,
  RED_FLOWER:      BLOCK_BY_NAME['red_flower'].id,
  YELLOW_FLOWER:   BLOCK_BY_NAME['yellow_flower'].id,
  BROWN_MUSHROOM:  BLOCK_BY_NAME['brown_mushroom'].id,
  RED_MUSHROOM:    BLOCK_BY_NAME['red_mushroom'].id,
  WEEPING_VINES:   BLOCK_BY_NAME['weeping_vines'].id,
  TWISTING_VINES:  BLOCK_BY_NAME['twisting_vines'].id,
  CACTUS:          BLOCK_BY_NAME['cactus'].id,
  GLOW_LICHEN:     BLOCK_BY_NAME['glow_lichen'].id,
  VINE:            BLOCK_BY_NAME['vine'].id,
  TOXIC_SLIME:     BLOCK_BY_NAME['toxic_slime'].id,
  CORRUPT_CRYSTAL: BLOCK_BY_NAME['corrupt_crystal'].id,
  APPLE:           BLOCK_BY_NAME['apple'].id,
  QUEST_KEY:       BLOCK_BY_NAME['quest_key'].id,
  OBSIDIAN:        BLOCK_BY_NAME['obsidian'].id,
  SANDSTONE:       BLOCK_BY_NAME['sandstone'].id,
  BED:             BLOCK_BY_NAME['bed'].id,
  CORRUPT_GRASS:   BLOCK_BY_NAME['corrupt_grass'].id,
  CORRUPT_STONE:   BLOCK_BY_NAME['corrupt_stone'].id,
  CORRUPT_VEIN:    BLOCK_BY_NAME['corrupt_vein'].id,
  // Legacy aliases (old code may reference these)
  WOOD_LOG:        BLOCK_BY_NAME['oak_log'].id,
  LEAVES:          BLOCK_BY_NAME['oak_leaves'].id,
  PLANKS:          BLOCK_BY_NAME['oak_planks'].id,
  // `OBSIDIAN` used to be here, aliased to `crying_obsidian` — an **unbreakable** block
  // that drops nothing (hardness -1). Three Act 3 quests asked the player to collect it.
  // It is a real block above; this line is kept only as the note that the alias moved.
  CRYING_OBSIDIAN: BLOCK_BY_NAME['crying_obsidian'].id,
  CAVE_AIR:        BLOCK_BY_NAME['air'].id,  // CAVE_AIR → same as AIR in new system
  SNOW_STONE:      BLOCK_BY_NAME['coarse_dirt'].id,
  CAVE_TORCH:      BLOCK_BY_NAME['torch'].id,
  GRASS_BLOCK:     BLOCK_BY_NAME['grass_block'].id,
};

// ─── Block drops ───────────────────────────────────────────────────────
// Keyed by block NAME, never by id: ids have been renumbered before (b287569)
// and the previous id-keyed drop table in inventory.js silently rotted when they
// were — breaking andesite dropped cobblestone and deepslate dropped coal.
//
// Only exceptions are listed. Every unlisted breakable block drops itself, and
// any block with hardness -1 (bedrock, crying_obsidian) drops nothing.
export const BLOCK_DROP_OVERRIDES = {
  air:             null,        // nothing to drop
  water:           null,
  lava:            null,
  grass_block:     'dirt',      // block name — resolved to an id by getBlockDrop
  coal_ore:        'item:coal', // 'item:' prefix — a NAMED_ITEMS entry, not a block
  iron_ore:        'item:iron_ore',
  gold_ore:        'item:gold_ore',
  diamond_ore:     'item:diamond',
  corrupt_crystal: 'item:corrupt_crystal',
  apple:           'item:apple',
  // Breaking corrupted ground gives you ordinary dirt, exactly as `grass_block` does.
  // The corruption is a surface condition, not a material — which is also why the
  // hazard is "the block I am standing on", not "a thing I am carrying" (§3.5).
  corrupt_grass:   'dirt',
  corrupt_vein:    null,
};

/**
 * Resolve what breaking a block yields.
 * @param {number} blockId
 * @returns {number|string|null} block id, named-item string, or null for no drop.
 */
export function getBlockDrop(blockId) {
  const block = BLOCK_BY_ID[blockId];
  if (!block) return null;
  const props = BLOCK_PROPERTIES[blockId];
  if (props && props.hardness === -1) return null; // unbreakable
  if (!Object.prototype.hasOwnProperty.call(BLOCK_DROP_OVERRIDES, block.name)) {
    return blockId; // default: drops itself
  }
  const override = BLOCK_DROP_OVERRIDES[block.name];
  if (override === null) return null;
  if (override.startsWith('item:')) return override.slice(5);
  const target = BLOCK_BY_NAME[override];
  return target ? target.id : null;
}
