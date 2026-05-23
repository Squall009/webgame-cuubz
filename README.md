# Cuubz — Voxel Multiplayer Web Game

A web-based Minecraft-style voxel game with full multiplayer support for up to 4 players, procedural texture generation, and persistent worlds.

## Features

- 🌍 **Voxel World** — Procedurally generated terrain with multiple biomes
- 👥 **Multiplayer** — Host/Join session system for up to 4 players
- 💾 **Persistent Worlds** — Save/load up to 3 worlds per device via IndexedDB
- 📱 **Mobile-First** — Touch controls with virtual joystick and swipe-to-look
- 🎨 **Procedural Textures** — All textures generated via code (32×32 PNG assets)
- 🔊 **Procedural Audio** — Sound effects and ambient music via Web Audio API

## Tech Stack

- Three.js (local CDN) for 3D voxel rendering
- Vanilla JavaScript, no build tooling
- WebSocket multiplayer (ws library)
- IndexedDB for world persistence
- Canvas API for texture generation
- Web Audio API for procedural sound/music

## Status

🟡 Approved — Plan created, awaiting review before implementation begins.

## Created

May 23, 2026
