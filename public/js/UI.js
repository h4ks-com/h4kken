// ============================================================
// H4KKEN - HUD / UI Manager
// ============================================================

export class UI {
  constructor() {
    // Screens
    this.loadingScreen = document.getElementById('loading-screen');
    this.menuScreen = document.getElementById('menu-screen');
    this.waitingScreen = document.getElementById('waiting-screen');
    this.controlsScreen = document.getElementById('controls-screen');
    this.fightHud = document.getElementById('fight-hud');
    this.announcement = document.getElementById('announcement');
    this.announceText = document.getElementById('announce-text');
    this.announceSub = document.getElementById('announce-sub');

    // Loading
    this.loadingBar = document.getElementById('loading-bar');
    this.loadingText = document.getElementById('loading-text');

    // HUD elements
    this.p1Health = document.getElementById('p1-health');
    this.p2Health = document.getElementById('p2-health');
    this.p1HealthDamage = document.getElementById('p1-health-damage');
    this.p2HealthDamage = document.getElementById('p2-health-damage');
    this.p1Name = document.getElementById('p1-name');
    this.p2Name = document.getElementById('p2-name');
    this.p1WinsEl = document.getElementById('p1-wins');
    this.p2WinsEl = document.getElementById('p2-wins');
    this.fightTimer = document.getElementById('fight-timer');

    // Combo displays
    this.p1Combo = document.getElementById('p1-combo');
    this.p2Combo = document.getElementById('p2-combo');
    this.p1ComboHits = document.getElementById('p1-combo-hits');
    this.p2ComboHits = document.getElementById('p2-combo-hits');
    this.p1ComboDamage = document.getElementById('p1-combo-damage');
    this.p2ComboDamage = document.getElementById('p2-combo-damage');

    // Buttons
    this.btnFindMatch = document.getElementById('btn-find-match');
    this.btnPractice = document.getElementById('btn-practice');
    this.btnControls = document.getElementById('btn-controls');
    this.btnBackControls = document.getElementById('btn-back-controls');
    this.btnCancelSearch = document.getElementById('btn-cancel-search');
    this.playerNameInput = document.getElementById('player-name');

    // Internal state
    this.p1HealthTarget = 100;
    this.p2HealthTarget = 100;
    this.p1HealthDamageTarget = 100;
    this.p2HealthDamageTarget = 100;
    this.announcementTimer = null;
  }

  // Screen management
  showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const screen = document.getElementById(screenId);
    if (screen) screen.classList.add('active');
  }

  hideAllScreens() {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  }

  // Loading
  setLoadingProgress(progress) {
    const pct = Math.round(progress * 100);
    this.loadingBar.style.width = pct + '%';
    this.loadingText.textContent = `Loading assets... ${pct}%`;
  }

  setLoadingText(text) {
    this.loadingText.textContent = text;
  }

  // Fight HUD
  showFightHud() {
    this.fightHud.classList.remove('hidden');
  }

  hideFightHud() {
    this.fightHud.classList.add('hidden');
  }

  setPlayerNames(p1Name, p2Name) {
    this.p1Name.textContent = p1Name;
    this.p2Name.textContent = p2Name;
  }

  updateHealth(p1Health, p2Health, maxHealth) {
    const p1Pct = Math.max(0, (p1Health / maxHealth) * 100);
    const p2Pct = Math.max(0, (p2Health / maxHealth) * 100);

    // Smooth health bar animation
    this.p1Health.style.width = p1Pct + '%';
    this.p2Health.style.width = p2Pct + '%';

    // Delayed damage indicator
    setTimeout(() => {
      this.p1HealthDamage.style.width = p1Pct + '%';
      this.p2HealthDamage.style.width = p2Pct + '%';
    }, 400);

    // Color based on health percentage
    this.updateHealthColor(this.p1Health, p1Pct);
    this.updateHealthColor(this.p2Health, p2Pct);
  }

  updateHealthColor(el, pct) {
    el.classList.remove('medium', 'low');
    if (pct <= 25) {
      el.classList.add('low');
    } else if (pct <= 50) {
      el.classList.add('medium');
    }
  }

  updateTimer(seconds) {
    this.fightTimer.textContent = Math.ceil(seconds);
    if (seconds <= 10) {
      this.fightTimer.classList.add('urgent');
    } else {
      this.fightTimer.classList.remove('urgent');
    }
  }

  updateWins(p1Wins, p2Wins, roundsToWin) {
    this.p1WinsEl.innerHTML = '';
    this.p2WinsEl.innerHTML = '';

    for (let i = 0; i < roundsToWin; i++) {
      const dot1 = document.createElement('div');
      dot1.className = 'win-dot' + (i < p1Wins ? ' won' : '');
      this.p1WinsEl.appendChild(dot1);

      const dot2 = document.createElement('div');
      dot2.className = 'win-dot' + (i < p2Wins ? ' won' : '');
      this.p2WinsEl.appendChild(dot2);
    }
  }

  updateCombo(playerIndex, hits, damage) {
    const comboEl = playerIndex === 0 ? this.p1Combo : this.p2Combo;
    const hitsEl = playerIndex === 0 ? this.p1ComboHits : this.p2ComboHits;
    const damageEl = playerIndex === 0 ? this.p1ComboDamage : this.p2ComboDamage;

    if (hits >= 2) {
      comboEl.classList.remove('hidden');
      hitsEl.textContent = hits;
      damageEl.textContent = damage + ' DMG';
    } else {
      comboEl.classList.add('hidden');
    }
  }

  hideCombo(playerIndex) {
    const comboEl = playerIndex === 0 ? this.p1Combo : this.p2Combo;
    comboEl.classList.add('hidden');
  }

  // Announcements
  showAnnouncement(text, sub = '', duration = 2000, cssClass = '') {
    if (this.announcementTimer) clearTimeout(this.announcementTimer);

    this.announceText.textContent = text;
    this.announceText.className = 'announce-text' + (cssClass ? ' ' + cssClass : '');
    this.announceSub.textContent = sub;
    this.announcement.classList.remove('hidden');

    if (duration > 0) {
      this.announcementTimer = setTimeout(() => {
        this.announcement.classList.add('hidden');
      }, duration);
    }
  }

  hideAnnouncement() {
    this.announcement.classList.add('hidden');
    if (this.announcementTimer) clearTimeout(this.announcementTimer);
  }

  // Hit spark effect (CSS-based flash)
  showHitEffect() {
    const flash = document.createElement('div');
    flash.style.cssText = `
      position: fixed; top: 0; left: 0; width: 100%; height: 100%;
      background: rgba(255,255,255,0.15); pointer-events: none; z-index: 45;
    `;
    document.body.appendChild(flash);
    setTimeout(() => flash.remove(), 80);
  }

  showBlockEffect() {
    const flash = document.createElement('div');
    flash.style.cssText = `
      position: fixed; top: 0; left: 0; width: 100%; height: 100%;
      background: rgba(0,150,255,0.1); pointer-events: none; z-index: 45;
    `;
    document.body.appendChild(flash);
    setTimeout(() => flash.remove(), 60);
  }
}
