// ============================================================
// H4KKEN - Network Client
// ============================================================

export class Network {
  constructor() {
    this.ws = null;
    this.connected = false;
    this.playerIndex = -1;
    this.opponentName = '';
    this.roomId = null;
    this.handlers = {};
  }

  on(event, handler) {
    if (!this.handlers[event]) this.handlers[event] = [];
    this.handlers[event].push(handler);
  }

  emit(event, data) {
    if (this.handlers[event]) {
      this.handlers[event].forEach(h => h(data));
    }
  }

  connect() {
    return new Promise((resolve, reject) => {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const url = `${protocol}//${window.location.host}`;
      
      this.ws = new WebSocket(url);

      this.ws.onopen = () => {
        this.connected = true;
        resolve();
      };

      this.ws.onclose = () => {
        this.connected = false;
        this.emit('disconnected');
      };

      this.ws.onerror = (err) => {
        reject(err);
      };

      this.ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        this.handleMessage(msg);
      };
    });
  }

  handleMessage(msg) {
    switch (msg.type) {
      case 'waiting':
        this.emit('waiting');
        break;
      case 'matched':
        this.playerIndex = msg.playerIndex;
        this.opponentName = msg.opponentName;
        this.roomId = msg.roomId;
        this.emit('matched', msg);
        break;
      case 'countdown':
        this.emit('countdown', msg);
        break;
      case 'fight':
        this.emit('fight');
        break;
      case 'opponentInput':
        this.emit('opponentInput', msg);
        break;
      case 'gameState':
        this.emit('gameState', msg);
        break;
      case 'roundResult':
        this.emit('roundResult', msg);
        break;
      case 'opponentLeft':
        this.emit('opponentLeft');
        break;
      case 'error':
        this.emit('error', msg);
        break;
    }
  }

  send(msg) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  joinMatch(name) {
    this.send({ type: 'join', name });
  }

  sendInput(frame, input) {
    this.send({ type: 'input', frame, input });
  }

  sendGameState(frame, state) {
    this.send({ type: 'gameState', frame, state });
  }

  sendRoundResult(winner, p1Wins, p2Wins, matchOver) {
    this.send({ type: 'roundResult', winner, p1Wins, p2Wins, matchOver });
  }

  leave() {
    this.send({ type: 'leave' });
    this.playerIndex = -1;
    this.roomId = null;
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}
