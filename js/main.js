/**
 * Cuubz — Main Entry Point
 * Menu system, play/host/join flow, screen management
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
  // Menu Navigation
  // ============================================================

  function initMenuNavigation() {
    // Main menu buttons
    document.getElementById('btn-play-solo').addEventListener('click', () => {
      showScreen('characterScreen');
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

    // Character screen
    document.getElementById('btn-back-char').addEventListener('click', () => {
      showScreen('mainMenu');
    });

    document.getElementById('btn-create-char').addEventListener('click', () => {
      screens.createCharModal.classList.remove('hidden');
    });

    document.getElementById('btn-cancel-char').addEventListener('click', () => {
      screens.createCharModal.classList.add('hidden');
    });

    document.getElementById('btn-save-char').addEventListener('click', () => {
      const name = document.getElementById('char-name').value.trim();
      const color = document.getElementById('char-color').value;
      if (name.length > 0) {
        console.log(`[Cuubz] Character created: ${name} (${color})`);
        // TODO: Save to IndexedDB via persistence.js
        screens.createCharModal.classList.add('hidden');
        showScreen('worldScreen');
      }
    });

    // World screen
    document.getElementById('btn-back-world').addEventListener('click', () => {
      showScreen('characterScreen');
    });

    document.getElementById('btn-create-world').addEventListener('click', () => {
      console.log('[Cuubz] Creating new world...');
      // TODO: Generate world via worldGenerator.js
      showScreen('modeScreen');
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
    
    // Show loading screen
    showScreen('loadingScreen');
    
    // TODO: Initialize Three.js renderer, world generation, etc.
    // For now, simulate a brief loading period then return to menu
    
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
      
      // Update status messages
      for (const step of steps) {
        if (progress >= step.at) {
          loadingStatus.textContent = step.msg;
        }
      }
      
      if (loadingProgress) {
        loadingProgress.style.width = progress + '%';
      }

      if (progress >= 100) {
        clearInterval(interval);
        // For now, just log and return to menu (no engine yet)
        console.log('[Cuubz] Game would start here. Engine modules not yet built.');
        
        // Hide loading, show HUD placeholder
        setTimeout(() => {
          Object.values(screens).forEach(el => {
            if (el) el.classList.add('hidden');
          });
          
          // Show a basic canvas message for now
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

  function init() {
    console.log('[Cuubz] Initializing...');
    
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
