#!/usr/bin/env python3
"""
Cuubz Texture Generator
=======================
Generates all 32x32 PNG textures for the Cuubz voxel game using procedural
noise and patterns. No external assets required — everything is generated
algorithmically.

Usage:
    python3 scripts/generate_textures.py [--output textures/]

Textures generated (26 total):
    - Terrain blocks: grass_top, grass_side, dirt, stone, sand, gravel, snow, ice
    - Water & lava: water, lava
    - Wood/plants: wood_log, leaves, apple
    - Building: planks, bedrock, obsidian, blackstone, bed
    - Ores: coal_ore, iron_ore, gold_ore, diamond_ore
    - Corrupt biome: corrupt_stone, toxic_slime, corrupt_cry
    - Items: quest_key

Author: Cuubz Autonomous Builder
Date: 2026-05-23
"""

import argparse
import math
import os
import random
import struct
import sys
from PIL import Image, ImageDraw


# ============================================================================
# Noise Functions (pure Python — no external deps besides Pillow)
# ============================================================================

class PerlinNoise:
    """Simple 1D/2D/3D value noise with smooth interpolation."""

    def __init__(self, seed=42):
        self.seed = seed
        random.seed(seed)
        # Build permutation table
        self.perm = list(range(256))
        random.shuffle(self.perm)
        self.perm = self.perm + self.perm  # Double for overflow safety

    def _fade(self, t):
        """Smoothstep: 6t^5 - 15t^4 + 10t^3"""
        return t * t * t * (t * (t * 6 - 15) + 10)

    def _lerp(self, a, b, t):
        return a + t * (b - a)

    def _hash1d(self, x):
        return self.perm[x & 255] / 255.0

    def _hash2d(self, x, y):
        return self.perm[(self.perm[x & 255] + y) & 255] / 255.0

    def noise1d(self, x):
        xi = int(math.floor(x)) & 255
        xf = x - math.floor(x)
        u = self._fade(xf)
        return self._lerp(self._hash1d(xi), self._hash1d(xi + 1), u)

    def noise2d(self, x, y):
        xi = int(math.floor(x)) & 255
        yi = int(math.floor(y)) & 255
        xf = x - math.floor(x)
        yf = y - math.floor(y)
        u = self._fade(xf)
        v = self._fade(yf)
        aa = self._hash2d(xi, yi)
        ab = self._hash2d(xi, yi + 1)
        ba = self._hash2d(xi + 1, yi)
        bb = self._hash2d(xi + 1, yi + 1)
        return self._lerp(
            self._lerp(aa, ba, u),
            self._lerp(ab, bb, u),
            v
        )

    def octave_noise2d(self, x, y, octaves=4, persistence=0.5):
        total = 0.0
        frequency = 1.0
        amplitude = 1.0
        max_value = 0.0
        for _ in range(octaves):
            total += self.noise2d(x * frequency, y * frequency) * amplitude
            max_value += amplitude
            amplitude *= persistence
            frequency *= 2.0
        return total / max_value if max_value > 0 else 0.0


# ============================================================================
# Color Utilities
# ============================================================================

def clamp_color(val):
    """Clamp a color value to 0-255."""
    return max(0, min(255, int(val)))

def blend_colors(c1, c2, t):
    """Linearly blend between two RGB tuples."""
    return (
        clamp_color(c1[0] + (c2[0] - c1[0]) * t),
        clamp_color(c1[1] + (c2[1] - c1[1]) * t),
        clamp_color(c1[2] + (c2[2] - c1[2]) * t),
    )

def add_noise(color, amount=15):
    """Add random noise to an RGB color."""
    r = max(0, min(255, color[0] + random.randint(-amount, amount)))
    g = max(0, min(255, color[1] + random.randint(-amount, amount)))
    b = max(0, min(255, color[2] + random.randint(-amount, amount)))
    return (r, g, b)

def noise_image(width, height, base_color, variation=20, noise_scale=8.0, seed=42):
    """Generate a 32x32 image with smooth noise on a base color."""
    img = Image.new("RGB", (width, height))
    n = PerlinNoise(seed)
    pixels = []
    for y in range(height):
        row = []
        for x in range(width):
            nx = x / noise_scale
            ny = y / noise_scale
            nv = n.octave_noise2d(nx, ny, octaves=3, persistence=0.5)
            # Map 0-1 noise to -variation/+variation
            offset = (nv - 0.5) * 2 * variation
            r = clamp_color(base_color[0] + offset)
            g = clamp_color(base_color[1] + offset)
            b = clamp_color(base_color[2] + offset)
            row.append((r, g, b))
        pixels.extend(row)
    img.putdata(pixels)
    return img

def speckle_image(width, height, base_color, speckle_color, density=0.15, seed=42):
    """Add random speckles/dots to a base color image."""
    random.seed(seed)
    img = Image.new("RGB", (width, height), base_color)
    pixels = img.load()
    for y in range(height):
        for x in range(width):
            if random.random() < density:
                pixels[x, y] = add_noise(speckle_color, 10)
            else:
                pixels[x, y] = add_noise(base_color, 8)
    return img


# ============================================================================
# Individual Texture Generators
# ============================================================================

def gen_grass_top(seed=100):
    """Green noise with lighter patches — grass block top face."""
    random.seed(seed)
    base = (76, 153, 49)       # Minecraft-like grass green
    img = Image.new("RGB", (32, 32))
    n = PerlinNoise(seed)
    for y in range(32):
        for x in range(32):
            nv = n.octave_noise2d(x / 6.0, y / 6.0, octaves=3, persistence=0.5)
            # Green variation: some pixels lighter (sunlit), some darker
            green_offset = (nv - 0.5) * 40
            r = clamp_color(76 + green_offset * 0.3)
            g = clamp_color(153 + green_offset)
            b = clamp_color(49 + green_offset * 0.2)
            img.putpixel((x, y), (r, g, b))
    return img


def gen_grass_side(seed=101):
    """Dirt base with green top stripe — grass block side face."""
    random.seed(seed)
    img = Image.new("RGB", (32, 32))
    n_dirt = PerlinNoise(seed)
    n_grass = PerlinNoise(seed + 1000)
    for y in range(32):
        for x in range(32):
            if y < 4:
                # Green top stripe (grass)
                nv = n_grass.noise2d(x / 8.0, y / 4.0)
                r = clamp_color(76 + (nv - 0.5) * 30)
                g = clamp_color(153 + (nv - 0.5) * 30)
                b = clamp_color(49 + (nv - 0.5) * 20)
            else:
                # Dirt base
                nv = n_dirt.noise2d(x / 8.0, y / 8.0)
                r = clamp_color(134 + (nv - 0.5) * 30)
                g = clamp_color(96 + (nv - 0.5) * 25)
                b = clamp_color(67 + (nv - 0.5) * 20)
            # Add pixel-level noise
            r += random.randint(-5, 5)
            g += random.randint(-5, 5)
            b += random.randint(-5, 5)
            img.putpixel((x, y), (clamp_color(r), clamp_color(g), clamp_color(b)))
    return img


def gen_dirt(seed=102):
    """Brown noise with darker speckles."""
    random.seed(seed)
    img = Image.new("RGB", (32, 32))
    n = PerlinNoise(seed)
    for y in range(32):
        for x in range(32):
            nv = n.octave_noise2d(x / 7.0, y / 7.0, octaves=3, persistence=0.5)
            r = clamp_color(134 + (nv - 0.5) * 40)
            g = clamp_color(96 + (nv - 0.5) * 35)
            b = clamp_color(67 + (nv - 0.5) * 25)
            img.putpixel((x, y), (r, g, b))
    return img


def gen_stone(seed=103):
    """Gray noise with subtle crack patterns."""
    random.seed(seed)
    img = Image.new("RGB", (32, 32))
    n = PerlinNoise(seed)
    n_crack = PerlinNoise(seed + 500)
    for y in range(32):
        for x in range(32):
            nv = n.octave_noise2d(x / 6.0, y / 6.0, octaves=3, persistence=0.5)
            base_val = clamp_color(130 + (nv - 0.5) * 40)
            # Crack lines: dark lines where crack noise crosses threshold
            cn = n_crack.noise2d(x / 3.0, y / 3.0)
            if abs(cn - 0.5) < 0.04:
                base_val = clamp_color(base_val - 30)
            img.putpixel((x, y), (base_val, base_val, clamp_color(base_val + 2)))
    return img


def gen_sand(seed=104):
    """Yellow noise with grain variation."""
    random.seed(seed)
    img = Image.new("RGB", (32, 32))
    n = PerlinNoise(seed)
    for y in range(32):
        for x in range(32):
            nv = n.octave_noise2d(x / 5.0, y / 5.0, octaves=4, persistence=0.4)
            r = clamp_color(219 + (nv - 0.5) * 30)
            g = clamp_color(203 + (nv - 0.5) * 28)
            b = clamp_color(147 + (nv - 0.5) * 20)
            # Random grain specks
            if random.random() < 0.1:
                r -= 15
                g -= 15
                b -= 10
            img.putpixel((x, y), (clamp_color(r), clamp_color(g), clamp_color(b)))
    return img


def gen_gravel(seed=105):
    """Mixed gray/brown small squares (pebble-like)."""
    random.seed(seed)
    img = Image.new("RGB", (32, 32))
    # Pebble colors: range of grays and browns
    pebble_colors = [
        (100, 100, 100), (120, 115, 110), (80, 75, 70),
        (140, 135, 130), (90, 85, 80), (110, 100, 95),
        (70, 68, 65), (130, 125, 120), (105, 100, 95),
    ]
    n = PerlinNoise(seed)
    for y in range(32):
        for x in range(32):
            # Each "pebble" is ~3-4 pixels wide
            px = int(x / 3.5) * 3.5
            py = int(y / 3.5) * 3.5
            nv = n.noise2d(px / 16.0, py / 16.0)
            ci = int(nv * len(pebble_colors)) % len(pebble_colors)
            color = pebble_colors[ci]
            r = clamp_color(color[0] + random.randint(-8, 8))
            g = clamp_color(color[1] + random.randint(-8, 8))
            b = clamp_color(color[2] + random.randint(-8, 8))
            img.putpixel((x, y), (r, g, b))
    return img


def gen_water(seed=106):
    """Blue semi-transparent wave pattern."""
    random.seed(seed)
    img = Image.new("RGBA", (32, 32))
    n = PerlinNoise(seed)
    for y in range(32):
        for x in range(32):
            nv = n.octave_noise2d(x / 8.0 + 0.5, y / 12.0, octaves=2, persistence=0.5)
            # Wave pattern: horizontal ripple
            wave = math.sin(x * 0.5 + y * 0.3) * 0.5 + 0.5
            r = clamp_color(30 + nv * 30 + wave * 10)
            g = clamp_color(80 + nv * 40 + wave * 15)
            b = clamp_color(180 + nv * 40 + wave * 20)
            a = clamp_color(160 + nv * 40)  # Semi-transparent
            img.putpixel((x, y), (r, g, b, a))
    return img


def gen_wood_log(seed=107):
    """Brown rings/circles — vertical grain pattern."""
    random.seed(seed)
    img = Image.new("RGB", (32, 32))
    cx, cy = 16, 16
    n = PerlinNoise(seed)
    for y in range(32):
        for x in range(32):
            # Distance from center for ring pattern
            dx = x - cx
            dy = y - cy
            dist = math.sqrt(dx * dx + dy * dy)
            # Concentric rings
            ring = math.sin(dist * 1.2) * 0.5 + 0.5
            nv = n.noise2d(x / 4.0, y / 4.0) * 0.3
            val = ring * 0.7 + nv
            r = clamp_color(90 + val * 60)
            g = clamp_color(65 + val * 45)
            b = clamp_color(35 + val * 25)
            img.putpixel((x, y), (r, g, b))
    return img


def gen_leaves(seed=108):
    """Green noise with darker spots — leafy texture."""
    random.seed(seed)
    img = Image.new("RGBA", (32, 32))
    n = PerlinNoise(seed)
    for y in range(32):
        for x in range(32):
            nv = n.octave_noise2d(x / 5.0, y / 5.0, octaves=4, persistence=0.4)
            # Darker spots for leaf variation
            spot = n.noise2d(x / 2.0, y / 2.0)
            if spot < 0.3:
                r = clamp_color(30 + nv * 20)
                g = clamp_color(80 + nv * 40)
                b = clamp_color(20 + nv * 15)
            else:
                r = clamp_color(50 + nv * 30)
                g = clamp_color(130 + nv * 50)
                b = clamp_color(30 + nv * 20)
            a = clamp_color(180 + nv * 50)
            img.putpixel((x, y), (r, g, b, a))
    return img


def gen_snow(seed=109):
    """White/light gray minimal noise."""
    random.seed(seed)
    img = Image.new("RGB", (32, 32))
    n = PerlinNoise(seed)
    for y in range(32):
        for x in range(32):
            nv = n.noise2d(x / 10.0, y / 10.0)
            val = clamp_color(230 + (nv - 0.5) * 25)
            img.putpixel((x, y), (val, val, clamp_color(val + 3)))
    return img


def gen_ice(seed=110):
    """Light blue translucent."""
    random.seed(seed)
    img = Image.new("RGBA", (32, 32))
    n = PerlinNoise(seed)
    for y in range(32):
        for x in range(32):
            nv = n.octave_noise2d(x / 8.0, y / 8.0, octaves=2, persistence=0.5)
            r = clamp_color(170 + (nv - 0.5) * 30)
            g = clamp_color(210 + (nv - 0.5) * 25)
            b = clamp_color(240 + (nv - 0.5) * 15)
            a = clamp_color(180 + nv * 40)
            img.putpixel((x, y), (r, g, b, a))
    return img


def gen_bedrock(seed=111):
    """Dark gray/black heavy noise."""
    random.seed(seed)
    img = Image.new("RGB", (32, 32))
    n = PerlinNoise(seed)
    n2 = PerlinNoise(seed + 500)
    for y in range(32):
        for x in range(32):
            nv1 = n.octave_noise2d(x / 4.0, y / 4.0, octaves=4, persistence=0.5)
            nv2 = n2.noise2d(x / 2.0, y / 2.0)
            val = clamp_color(40 + nv1 * 50 + nv2 * 20)
            img.putpixel((x, y), (val, val, clamp_color(val + 2)))
    return img


def gen_planks(seed=112):
    """Wood grain horizontal lines."""
    random.seed(seed)
    img = Image.new("RGB", (32, 32))
    n = PerlinNoise(seed)
    for y in range(32):
        for x in range(32):
            # Horizontal plank lines: each row of ~8 pixels is one plank
            plank_id = int(y / 8)
            plank_y = y % 8
            # Darker line at plank boundary
            if plank_y < 1 or plank_y > 6:
                base_r, base_g, base_b = 140, 105, 55
            else:
                base_r, base_g, base_b = 170, 130, 75
            # Wood grain variation
            nv = n.noise2d(x / 6.0 + plank_id * 10.0, y / 20.0)
            r = clamp_color(base_r + (nv - 0.5) * 30)
            g = clamp_color(base_g + (nv - 0.5) * 25)
            b = clamp_color(base_b + (nv - 0.5) * 15)
            img.putpixel((x, y), (r, g, b))
    return img


def gen_obsidian(seed=113):
    """Very dark purple-black glossy."""
    random.seed(seed)
    img = Image.new("RGB", (32, 32))
    n = PerlinNoise(seed)
    for y in range(32):
        for x in range(32):
            nv = n.noise2d(x / 12.0, y / 12.0)
            # Glossy highlight: subtle purple sheen
            r = clamp_color(15 + nv * 20)
            g = clamp_color(8 + nv * 10)
            b = clamp_color(30 + nv * 40)
            img.putpixel((x, y), (r, g, b))
    return img


def gen_blackstone(seed=114):
    """Dark gray with subtle texture."""
    random.seed(seed)
    img = Image.new("RGB", (32, 32))
    n = PerlinNoise(seed)
    for y in range(32):
        for x in range(32):
            nv = n.octave_noise2d(x / 5.0, y / 5.0, octaves=3, persistence=0.5)
            val = clamp_color(60 + (nv - 0.5) * 30)
            img.putpixel((x, y), (val, val, clamp_color(val + 1)))
    return img


def gen_lava(seed=115):
    """Orange/red flow pattern."""
    random.seed(seed)
    img = Image.new("RGB", (32, 32))
    n = PerlinNoise(seed)
    for y in range(32):
        for x in range(32):
            nv = n.octave_noise2d(x / 6.0, y / 6.0, octaves=3, persistence=0.5)
            # Flow: warm orange center with darker edges
            r = clamp_color(200 + nv * 55)
            g = clamp_color(80 + nv * 100)
            b = clamp_color(10 + nv * 30)
            img.putpixel((x, y), (r, g, b))
    return img


def gen_corrupt_stone(seed=116):
    """Dark purple crystalline."""
    random.seed(seed)
    img = Image.new("RGB", (32, 32))
    n = PerlinNoise(seed)
    n_crystal = PerlinNoise(seed + 500)
    for y in range(32):
        for x in range(32):
            nv = n.noise2d(x / 6.0, y / 6.0)
            crystal = n_crystal.octave_noise2d(x / 4.0, y / 4.0, octaves=3, persistence=0.5)
            # Base dark purple stone with crystalline highlights
            r = clamp_color(40 + nv * 30 + crystal * 40)
            g = clamp_color(20 + nv * 15 + crystal * 10)
            b = clamp_color(60 + nv * 40 + crystal * 50)
            img.putpixel((x, y), (r, g, b))
    return img


def gen_toxic_slime(seed=117):
    """Bright purple translucent pool."""
    random.seed(seed)
    img = Image.new("RGBA", (32, 32))
    n = PerlinNoise(seed)
    for y in range(32):
        for x in range(32):
            nv = n.octave_noise2d(x / 7.0, y / 7.0, octaves=2, persistence=0.5)
            wave = math.sin(x * 0.4 + y * 0.3) * 0.5 + 0.5
            r = clamp_color(150 + nv * 60 + wave * 30)
            g = clamp_color(30 + nv * 20 + wave * 10)
            b = clamp_color(180 + nv * 40 + wave * 30)
            a = clamp_color(150 + nv * 60)
            img.putpixel((x, y), (r, g, b, a))
    return img


def gen_coal_ore(seed=118):
    """Stone base with black ore spots."""
    random.seed(seed)
    stone_img = gen_stone(seed)
    n = PerlinNoise(seed + 500)
    pixels = stone_img.load()
    for y in range(32):
        for x in range(32):
            # Ore clusters: where noise is high, place coal spots
            nv = n.noise2d(x / 4.0, y / 4.0)
            if nv > 0.65 and random.random() < 0.7:
                pixels[x, y] = (clamp_color(30 + random.randint(-10, 10)),
                                clamp_color(28 + random.randint(-10, 10)),
                                clamp_color(28 + random.randint(-10, 10)))
    return stone_img


def gen_iron_ore(seed=119):
    """Stone base with light gray/tan ore spots."""
    random.seed(seed)
    stone_img = gen_stone(seed)
    n = PerlinNoise(seed + 500)
    pixels = stone_img.load()
    for y in range(32):
        for x in range(32):
            nv = n.noise2d(x / 4.0, y / 4.0)
            if nv > 0.65 and random.random() < 0.7:
                pixels[x, y] = (clamp_color(180 + random.randint(-15, 15)),
                                clamp_color(160 + random.randint(-15, 15)),
                                clamp_color(140 + random.randint(-15, 15)))
    return stone_img


def gen_gold_ore(seed=120):
    """Stone base with yellow ore spots."""
    random.seed(seed)
    stone_img = gen_stone(seed)
    n = PerlinNoise(seed + 500)
    pixels = stone_img.load()
    for y in range(32):
        for x in range(32):
            nv = n.noise2d(x / 4.0, y / 4.0)
            if nv > 0.65 and random.random() < 0.7:
                pixels[x, y] = (clamp_color(220 + random.randint(-10, 10)),
                                clamp_color(195 + random.randint(-10, 10)),
                                clamp_color(40 + random.randint(-10, 10)))
    return stone_img


def gen_diamond_ore(seed=121):
    """Stone base with cyan ore spots."""
    random.seed(seed)
    stone_img = gen_stone(seed)
    n = PerlinNoise(seed + 500)
    pixels = stone_img.load()
    for y in range(32):
        for x in range(32):
            nv = n.noise2d(x / 4.0, y / 4.0)
            if nv > 0.65 and random.random() < 0.7:
                pixels[x, y] = (clamp_color(50 + random.randint(-10, 10)),
                                clamp_color(200 + random.randint(-10, 10)),
                                clamp_color(210 + random.randint(-10, 10)))
    return stone_img


def gen_corrupt_cry(seed=122):
    """Glowing purple crystal — quest item."""
    random.seed(seed)
    img = Image.new("RGBA", (32, 32))
    n = PerlinNoise(seed)
    cx, cy = 16, 16
    for y in range(32):
        for x in range(32):
            dx = x - cx
            dy = y - cy
            dist = math.sqrt(dx * dx + dy * dy)
            # Crystal shape: diamond/rhombus in center
            crystal_mask = abs(dx / 10) + abs(dy / 12) < 1.0
            if crystal_mask:
                nv = n.noise2d(x / 4.0, y / 4.0)
                glow = max(0, 1 - dist / 14)
                r = clamp_color(150 + nv * 60 + glow * 80)
                g = clamp_color(30 + nv * 20 + glow * 20)
                b = clamp_color(200 + nv * 40 + glow * 55)
                a = clamp_color(200 + glow * 55)
            else:
                # Transparent background
                r, g, b, a = 0, 0, 0, 0
            img.putpixel((x, y), (r, g, b, a))
    return img


def gen_apple(seed=123):
    """Red round fruit icon."""
    random.seed(seed)
    img = Image.new("RGBA", (32, 32))
    draw = ImageDraw.Draw(img)
    cx, cy = 16, 18
    r = 10
    # Apple body: red circle
    draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(200, 40, 30))
    # Highlight
    draw.ellipse([cx - 5, cy - 8, cx - 1, cy - 3], fill=(230, 80, 60))
    # Stem
    draw.line([(cx, cy - r), (cx + 2, cy - r - 4)], fill=(80, 50, 20), width=2)
    # Leaf
    draw.ellipse([cx + 1, cy - r - 5, cx + 7, cy - r - 1], fill=(60, 140, 30))
    return img


def gen_quest_key(seed=124):
    """Golden key icon."""
    random.seed(seed)
    img = Image.new("RGBA", (32, 32))
    draw = ImageDraw.Draw(img)
    cx, cy = 16, 16
    # Key ring (circle at top left)
    draw.ellipse([cx - 9, cy - 9, cx - 3, cy - 3], outline=(220, 180, 40), width=3)
    # Key shaft
    draw.line([(cx - 4, cy - 6), (cx + 10, cy - 6)], fill=(220, 180, 40), width=3)
    # Key teeth
    draw.rectangle([cx + 7, cy - 6, cx + 10, cy], fill=(220, 180, 40))
    draw.rectangle([cx + 7, cy + 1, cx + 9, cy + 3], fill=(220, 180, 40))
    # Glow effect
    for dy in range(-1, 2):
        for dx in range(-1, 2):
            if dx != 0 or dy != 0:
                draw.ellipse([cx - 9 + dx, cy - 9 + dy, cx - 3 + dx, cy - 3 + dy],
                            outline=(255, 220, 100), width=1)
    return img


def gen_bed(seed=125):
    """Colored bed block texture — red bed with white pillow."""
    random.seed(seed)
    img = Image.new("RGB", (32, 32))
    n = PerlinNoise(seed)
    for y in range(32):
        for x in range(32):
            nv = n.noise2d(x / 8.0, y / 8.0)
            if y < 10:
                # Pillow area (top): white/cream
                r = clamp_color(220 + (nv - 0.5) * 20)
                g = clamp_color(215 + (nv - 0.5) * 20)
                b = clamp_color(200 + (nv - 0.5) * 15)
            else:
                # Bed base: red
                r = clamp_color(180 + (nv - 0.5) * 30)
                g = clamp_color(40 + (nv - 0.5) * 20)
                b = clamp_color(40 + (nv - 0.5) * 20)
            img.putpixel((x, y), (r, g, b))
    return img


def gen_red_flower(seed=126):
    """Red flower — small decorative block for plains biomes."""
    random.seed(seed)
    img = Image.new("RGBA", (32, 32))
    draw = ImageDraw.Draw(img)
    cx, cy = 16, 20
    
    # Stem (green line going up from bottom)
    draw.line([(cx, 31), (cx, cy + 4)], fill=(50, 140, 30), width=2)
    
    # Petals: 5 red petals in a circle
    petal_colors = [(200, 40, 40), (220, 60, 50), (180, 30, 30)]
    for i in range(5):
        angle = math.radians(i * 72 - 90)  # Spread around center
        px = int(cx + math.cos(angle) * 6)
        py = int(cy + math.sin(angle) * 6)
        color = petal_colors[i % len(petal_colors)]
        draw.ellipse([px - 4, py - 4, px + 4, py + 4], fill=color)
    
    # Center: yellow dot
    draw.ellipse([cx - 3, cy - 3, cx + 3, cy + 3], fill=(220, 200, 40))
    
    return img


def gen_yellow_flower(seed=127):
    """Yellow flower — small decorative block for plains biomes."""
    random.seed(seed)
    img = Image.new("RGBA", (32, 32))
    draw = ImageDraw.Draw(img)
    cx, cy = 16, 20
    
    # Stem (green line going up from bottom)
    draw.line([(cx, 31), (cx, cy + 4)], fill=(50, 140, 30), width=2)
    
    # Petals: 5 yellow petals in a circle
    petal_colors = [(220, 200, 40), (240, 210, 50), (200, 180, 30)]
    for i in range(5):
        angle = math.radians(i * 72 - 90)
        px = int(cx + math.cos(angle) * 6)
        py = int(cy + math.sin(angle) * 6)
        color = petal_colors[i % len(petal_colors)]
        draw.ellipse([px - 4, py - 4, px + 4, py + 4], fill=color)
    
    # Center: orange-brown dot
    draw.ellipse([cx - 3, cy - 3, cx + 3, cy + 3], fill=(180, 120, 30))
    
    return img


def gen_cave_torch(seed=128):
    """Cave torch — player placeable light source for caves."""
    random.seed(seed)
    img = Image.new("RGBA", (32, 32))
    draw = ImageDraw.Draw(img)
    
    # Stick: brown vertical line
    draw.line([(16, 8), (16, 28)], fill=(100, 70, 30), width=3)
    
    # Flame: orange-yellow teardrop shape at top
    flame_base = [(14, 10), (18, 10), (16, 2)]
    draw.polygon(flame_base, fill=(255, 180, 30))
    
    # Inner flame: brighter yellow core
    inner_flame = [(15, 9), (17, 9), (16, 4)]
    draw.polygon(inner_flame, fill=(255, 240, 100))
    
    # Glow halo: semi-transparent warm glow around flame
    for r in range(8, 14):
        alpha = max(0, int(40 * (1 - (r - 8) / 6)))
        if alpha > 0:
            draw.ellipse([16 - r, 5 - r + 2, 16 + r, 5 + r + 2],
                        outline=(255, 160, 40, alpha))
    
    return img


def gen_glowstone(seed=129):
    """Glowstone — emissive light source block found in caves."""
    random.seed(seed)
    img = Image.new("RGB", (32, 32))
    n = PerlinNoise(seed)
    
    for y in range(32):
        for x in range(32):
            nv = n.octave_noise2d(x / 6.0, y / 6.0, octaves=3, persistence=0.5)
            
            # Bright warm yellow-white glowstone
            r = clamp_color(240 + nv * 15)
            g = clamp_color(220 + nv * 20)
            b = clamp_color(160 + nv * 40)
            
            # Grid pattern: darker lines forming a cross-hatch
            gx = x % 8 < 1 or (x + 4) % 8 < 1
            gy = y % 8 < 1 or (y + 4) % 8 < 1
            if gx or gy:
                r = clamp_color(r - 30)
                g = clamp_color(g - 25)
                b = clamp_color(b - 20)
            
            img.putpixel((x, y), (r, g, b))
    
    return img


# ============================================================================
# Texture Registry — maps filename → generator function
# ============================================================================

TEXTURE_GENERATORS = {
    "grass_top.png": gen_grass_top,
    "grass_side.png": gen_grass_side,
    "dirt.png": gen_dirt,
    "stone.png": gen_stone,
    "sand.png": gen_sand,
    "gravel.png": gen_gravel,
    "water.png": gen_water,
    "wood_log.png": gen_wood_log,
    "leaves.png": gen_leaves,
    "snow.png": gen_snow,
    "ice.png": gen_ice,
    "bedrock.png": gen_bedrock,
    "planks.png": gen_planks,
    "obsidian.png": gen_obsidian,
    "blackstone.png": gen_blackstone,
    "lava.png": gen_lava,
    "corrupt_stone.png": gen_corrupt_stone,
    "toxic_slime.png": gen_toxic_slime,
    "coal_ore.png": gen_coal_ore,
    "iron_ore.png": gen_iron_ore,
    "gold_ore.png": gen_gold_ore,
    "diamond_ore.png": gen_diamond_ore,
    "corrupt_cry.png": gen_corrupt_cry,
    "apple.png": gen_apple,
    "quest_key.png": gen_quest_key,
    "bed.png": gen_bed,
    "red_flower.png": gen_red_flower,
    "yellow_flower.png": gen_yellow_flower,
    "cave_torch.png": gen_cave_torch,
    "glowstone.png": gen_glowstone,
}


# ============================================================================
# Main Entry Point
# ============================================================================

def main():
    parser = argparse.ArgumentParser(description="Generate Cuubz game textures")
    parser.add_argument("--output", default="textures/", help="Output directory for PNG files")
    parser.add_argument("--list", action="store_true", help="List all texture names and exit")
    args = parser.parse_args()

    if args.list:
        print("Available textures:")
        for name in sorted(TEXTURE_GENERATORS.keys()):
            print(f"  {name}")
        return 0

    output_dir = args.output
    os.makedirs(output_dir, exist_ok=True)

    generated = []
    errors = []

    for name, gen_func in TEXTURE_GENERATORS.items():
        try:
            img = gen_func()
            filepath = os.path.join(output_dir, name)
            img.save(filepath, "PNG")
            w, h = img.size
            generated.append(name)
            print(f"  ✅ {name} ({w}x{h})")
        except Exception as e:
            errors.append((name, str(e)))
            print(f"  ❌ {name}: {e}")

    # Summary
    print(f"\n--- Texture Generation Complete ---")
    print(f"Generated: {len(generated)}/{len(TEXTURE_GENERATORS)} textures")
    if errors:
        print(f"Errors: {len(errors)}")
        for name, err in errors:
            print(f"  ❌ {name}: {err}")
        return 1

    # Verify all files exist and are valid PNGs
    all_valid = True
    for name in generated:
        filepath = os.path.join(output_dir, name)
        if not os.path.exists(filepath):
            print(f"  ⚠️  {name} — file missing!")
            all_valid = False
            continue
        size = os.path.getsize(filepath)
        if size < 50:
            print(f"  ⚠️  {name} — suspiciously small ({size} bytes)")
            all_valid = False

    if all_valid:
        print("✅ All textures generated and verified successfully!")
    return 0


if __name__ == "__main__":
    sys.exit(main())
