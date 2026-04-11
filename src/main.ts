// ============================================================
// H4KKEN - Entry Point
// ============================================================

import { Game } from './game/Game';

Game.create()
  .then((game) => {
    console.log('[H4KKEN] Renderer:', game.engine.description);
    return game.init();
  })
  .catch((err) => {
    console.error('Failed to initialize H4KKEN:', err);
    const loadingText = document.getElementById('loading-text');
    if (loadingText) {
      loadingText.textContent = `Error loading game: ${err.message}`;
      loadingText.style.color = '#ff4444';
    }
  });
