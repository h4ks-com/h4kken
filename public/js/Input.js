// ============================================================
// H4KKEN - Input Manager
// Tap W/S = sidestep, Hold W = jump, Hold S = crouch
// ============================================================

export class InputManager {
  constructor() {
    this.keys = {};
    this.previousKeys = {};
    this.inputBuffer = [];
    this.bufferSize = 10;

    // Double-tap detection
    this.lastTapTime = { left: 0, right: 0, up: 0, down: 0 };
    this.doubleTapWindow = 12;

    // Tap-vs-hold detection for W and S
    // holdThreshold: frames a key must be held to count as "hold" (jump/crouch)
    this.holdThreshold = 8;  // ~133ms at 60fps
    this.upHeldFrames = 0;   // how many frames W has been held
    this.downHeldFrames = 0; // how many frames S has been held
    this.upConsumed = false;  // true once we've triggered jump for this press
    this.downConsumed = false;

    this.frameCount = 0;

    this.onKeyDown = this.onKeyDown.bind(this);
    this.onKeyUp = this.onKeyUp.bind(this);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
  }

  onKeyDown(e) {
    if (e.repeat) return;
    this.keys[e.code] = true;
  }

  onKeyUp(e) {
    this.keys[e.code] = false;
  }

  getInput() {
    const input = {
      up: this.isPressed('KeyW') || this.isPressed('ArrowUp'),
      down: this.isPressed('KeyS') || this.isPressed('ArrowDown'),
      left: this.isPressed('KeyA') || this.isPressed('ArrowLeft'),
      right: this.isPressed('KeyD') || this.isPressed('ArrowRight'),
      lp: this.isPressed('KeyU'),
      rp: this.isPressed('KeyI'),
      lk: this.isPressed('KeyJ'),
      rk: this.isPressed('KeyK'),
      upJust: this.justPressed('KeyW') || this.justPressed('ArrowUp'),
      downJust: this.justPressed('KeyS') || this.justPressed('ArrowDown'),
      leftJust: this.justPressed('KeyA') || this.justPressed('ArrowLeft'),
      rightJust: this.justPressed('KeyD') || this.justPressed('ArrowRight'),
      lpJust: this.justPressed('KeyU'),
      rpJust: this.justPressed('KeyI'),
      lkJust: this.justPressed('KeyJ'),
      rkJust: this.justPressed('KeyK'),
    };
    return input;
  }

  getRelativeInput(rawInput, facing) {
    const rel = { ...rawInput };
    if (facing > 0) {
      rel.forward = rawInput.right;
      rel.back = rawInput.left;
      rel.forwardJust = rawInput.rightJust;
      rel.backJust = rawInput.leftJust;
    } else {
      rel.forward = rawInput.left;
      rel.back = rawInput.right;
      rel.forwardJust = rawInput.leftJust;
      rel.backJust = rawInput.rightJust;
    }
    return rel;
  }

  isPressed(code) {
    return !!this.keys[code];
  }

  justPressed(code) {
    return !!this.keys[code] && !this.previousKeys[code];
  }

  update() {
    const input = this.getInput();
    this.frameCount++;

    // ── Tap-vs-Hold for W (up) ──
    if (input.up) {
      this.upHeldFrames++;
      if (this.upHeldFrames >= this.holdThreshold && !this.upConsumed) {
        // Held long enough → jump
        input.upJust = true;  // trigger jump (handleStandingState checks upJust)
        this.upConsumed = true;
      }
      // While held but not yet at threshold, suppress upJust so jump doesn't fire early
      if (this.upHeldFrames < this.holdThreshold) {
        input.upJust = false;
      }
    } else {
      // Key was released
      if (this.upHeldFrames > 0 && this.upHeldFrames < this.holdThreshold && !this.upConsumed) {
        // Short tap → sidestep up
        input.sideStepUp = true;
      }
      this.upHeldFrames = 0;
      this.upConsumed = false;
    }

    // Suppress normal up/down for crouch/jump until threshold
    // (game reads input.down for crouch, input.upJust for jump)
    if (this.upHeldFrames > 0 && this.upHeldFrames < this.holdThreshold) {
      // Don't let anything trigger yet
      input.up = false;
    }

    // ── Tap-vs-Hold for S (down) ──
    if (input.down) {
      this.downHeldFrames++;
      if (this.downHeldFrames < this.holdThreshold) {
        // Suppress crouch until held long enough
        input.down = false;
        input.downJust = false;
      }
      // Once at threshold, input.down stays true → crouch activates naturally
    } else {
      // Key was released
      if (this.downHeldFrames > 0 && this.downHeldFrames < this.holdThreshold && !this.downConsumed) {
        // Short tap → sidestep down
        input.sideStepDown = true;
      }
      this.downHeldFrames = 0;
      this.downConsumed = false;
    }

    // ── Double-tap dash detection ──
    if (input.leftJust) {
      if (this.frameCount - this.lastTapTime.left < this.doubleTapWindow) {
        input.dashLeft = true;
      }
      this.lastTapTime.left = this.frameCount;
    }
    if (input.rightJust) {
      if (this.frameCount - this.lastTapTime.right < this.doubleTapWindow) {
        input.dashRight = true;
      }
      this.lastTapTime.right = this.frameCount;
    }

    // Store in buffer
    this.inputBuffer.push({ ...input });
    if (this.inputBuffer.length > this.bufferSize) {
      this.inputBuffer.shift();
    }

    // Update previous state
    this.previousKeys = { ...this.keys };

    return input;
  }

  checkMotion(motionSequence, buttonCheck) {
    if (this.inputBuffer.length < motionSequence.length + 1) return false;
    const recentInputs = this.inputBuffer.slice(-(motionSequence.length + 1));
    let motionIdx = 0;
    for (let i = 0; i < recentInputs.length - 1 && motionIdx < motionSequence.length; i++) {
      const inp = recentInputs[i];
      const dir = motionSequence[motionIdx];
      if (this.matchDirection(inp, dir)) {
        motionIdx++;
      }
    }
    const lastInput = recentInputs[recentInputs.length - 1];
    return motionIdx >= motionSequence.length && buttonCheck(lastInput);
  }

  matchDirection(input, dir) {
    switch (dir) {
      case 'down': return input.down && !input.forward && !input.back;
      case 'forward': return input.forward && !input.down;
      case 'back': return input.back && !input.down;
      case 'df': return input.down && input.forward;
      case 'db': return input.down && input.back;
      default: return false;
    }
  }

  destroy() {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
  }
}
