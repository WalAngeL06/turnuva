/**
 * CloudSync - Zero-Button Real-Time Cloud Synchronization
 * Powered by MQTT over WebSockets (HiveMQ + EMQX dual redundant brokers)
 * with optional Firebase Realtime Database bridge & PIN auth verification.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CloudSync = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const BROKERS = [
    { host: 'broker.hivemq.com', port: 8884, path: '/mqtt', ssl: true, name: 'HiveMQ' },
    { host: 'broker.emqx.io', port: 8084, path: '/mqtt', ssl: true, name: 'EMQX' }
  ];

  const DEFAULT_TOPIC = 'tobbetu/turnuva/2026/live_state';
  const SALT = '_tobbetu_tt_2026_salt';

  function computeAuthToken(pin) {
    const raw = String(pin || '1923') + SALT;
    let hash = 0;
    for (let i = 0; i < raw.length; i++) {
      hash = ((hash << 5) - hash) + raw.charCodeAt(i);
      hash |= 0;
    }
    let b64 = '';
    try {
      b64 = (typeof btoa === 'function' ? btoa(raw) : Buffer.from(raw).toString('base64')).slice(0, 16);
    } catch (_) {
      b64 = 'salt_hash';
    }
    return 'tk_' + Math.abs(hash).toString(36) + '_' + b64;
  }

  class CloudSyncManager {
    constructor() {
      this.clientId = 'tt_' + Math.random().toString(36).substring(2, 9) + '_' + Date.now().toString(36);
      this.topic = DEFAULT_TOPIC;
      this.currentBrokerIndex = 0;
      this.client = null;
      this.status = 'offline'; // 'offline' | 'connecting' | 'connected' | 'syncing'
      this.statusListeners = [];
      this.updateListeners = [];
      this.reconnectTimer = null;
      this.reconnectAttempts = 0;
      this.lastProcessedTimestamp = null;
      this.firebaseUrl = null;
      this.firebaseEventSource = null;
      this.activePinGetter = () => '1923';
      this.isDestroyed = false;
    }

    init(options = {}) {
      if (options.topic) this.topic = options.topic;
      if (typeof options.getAdminPin === 'function') this.activePinGetter = options.getAdminPin;
      if (options.firebaseUrl) this.firebaseUrl = options.firebaseUrl;

      // Check localStorage for optional Firebase URL
      try {
        if (!this.firebaseUrl && typeof localStorage !== 'undefined') {
          this.firebaseUrl = localStorage.getItem('turnuva_firebase_url') || null;
        }
      } catch (_) {}

      this.connect();
      this.initFirebase();

      // Auto reconnect on tab focus / mobile resume
      if (typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', () => {
          if (!document.hidden && this.status !== 'connected') {
            this.connect();
          }
        });
      }
    }

    setStatus(newStatus, details = {}) {
      this.status = newStatus;
      for (const fn of this.statusListeners) {
        try { fn(newStatus, details); } catch (e) { console.error('Status listener err:', e); }
      }
    }

    onStatusChange(fn) {
      if (typeof fn === 'function') this.statusListeners.push(fn);
    }

    onRemoteUpdate(fn) {
      if (typeof fn === 'function') this.updateListeners.push(fn);
    }

    isConnected() {
      return this.status === 'connected';
    }

    connect() {
      if (this.isDestroyed) return;
      if (typeof Paho === 'undefined' || !Paho.MQTT || !Paho.MQTT.Client) {
        console.warn('CloudSync: Paho MQTT library is not loaded yet, retrying in 1s...');
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = setTimeout(() => this.connect(), 1000);
        return;
      }

      if (this.client && this.client.isConnected && this.client.isConnected()) {
        return;
      }

      const broker = BROKERS[this.currentBrokerIndex % BROKERS.length];
      this.setStatus('connecting', { broker: broker.name });

      try {
        if (this.client) {
          try { this.client.disconnect(); } catch (_) {}
          this.client = null;
        }

        const client = new Paho.MQTT.Client(broker.host, broker.port, broker.path, this.clientId);
        this.client = client;

        client.onConnectionLost = (responseObject) => {
          console.warn('CloudSync: MQTT Connection lost from ' + broker.name + ':', responseObject.errorMessage);
          this.setStatus('offline', { error: responseObject.errorMessage });
          this.scheduleReconnect(true); // Switch broker on loss
        };

        client.onMessageArrived = (message) => {
          this.handleIncomingMessage(message);
        };

        client.connect({
          useSSL: broker.ssl,
          timeout: 6,
          keepAliveInterval: 30,
          cleanSession: false,
          onSuccess: () => {
            this.reconnectAttempts = 0;
            this.setStatus('connected', { broker: broker.name });
            console.log(`CloudSync: Connected to ${broker.name} over WSS (${this.topic})`);
            client.subscribe(this.topic, {
              qos: 1,
              onSuccess: () => {
                console.log('CloudSync: Subscribed to live channel successfully.');
              },
              onFailure: (err) => {
                console.warn('CloudSync: Subscribe failed:', err);
              }
            });
          },
          onFailure: (err) => {
            console.warn(`CloudSync: Failed to connect to ${broker.name}:`, err);
            this.setStatus('offline', { error: err.errorMessage || 'Connection failed' });
            this.scheduleReconnect(true); // Switch to backup broker
          }
        });
      } catch (err) {
        console.error('CloudSync: Exception creating MQTT client:', err);
        this.scheduleReconnect(true);
      }
    }

    scheduleReconnect(switchBroker = false) {
      if (this.isDestroyed) return;
      clearTimeout(this.reconnectTimer);
      if (switchBroker) {
        this.currentBrokerIndex = (this.currentBrokerIndex + 1) % BROKERS.length;
      }
      this.reconnectAttempts++;
      const delay = Math.min(1000 * Math.pow(1.5, Math.min(this.reconnectAttempts, 6)), 12000);
      this.reconnectTimer = setTimeout(() => this.connect(), delay);
    }

    handleIncomingMessage(message) {
      try {
        const payloadStr = message.payloadString;
        if (!payloadStr) return;
        const msg = JSON.parse(payloadStr);

        // Ignore echo of own broadcast
        if (msg.sender === this.clientId) {
          return;
        }

        // Verify PIN Auth Token
        const expectedToken = computeAuthToken(this.activePinGetter());
        if (msg.auth_token !== expectedToken) {
          console.warn('CloudSync: Rejected message with invalid or unauthorized auth token.');
          return;
        }

        // Timestamp check (Last-Write-Wins)
        if (msg.timestamp && this.lastProcessedTimestamp && msg.timestamp <= this.lastProcessedTimestamp) {
          return;
        }

        if (msg.timestamp) {
          this.lastProcessedTimestamp = msg.timestamp;
        }

        if (msg.state) {
          for (const listener of this.updateListeners) {
            try { listener(msg.state, msg.timestamp, msg.sender); } catch (e) { console.error('Listener err:', e); }
          }
        }
      } catch (err) {
        console.error('CloudSync: Error parsing incoming message:', err);
      }
    }

    async broadcast(tournamentState, pin = null) {
      const currentPin = pin || this.activePinGetter();
      const authToken = computeAuthToken(currentPin);
      const timestamp = tournamentState.last_updated || new Date().toISOString();
      this.lastProcessedTimestamp = timestamp;

      const payload = {
        sender: this.clientId,
        timestamp: timestamp,
        auth_token: authToken,
        state: tournamentState
      };

      const payloadJson = JSON.stringify(payload);
      let mqttSuccess = false;

      // 1. Send via MQTT WebSocket (Sub-second broadcast with retain)
      if (this.client && this.client.isConnected && this.client.isConnected()) {
        try {
          const msg = new Paho.MQTT.Message(payloadJson);
          msg.destinationName = this.topic;
          msg.retained = true;
          msg.qos = 1;
          this.client.send(msg);
          mqttSuccess = true;
        } catch (err) {
          console.error('CloudSync: MQTT send failed:', err);
        }
      } else {
        // Reconnect immediately if sending while disconnected
        this.connect();
      }

      // 2. Optional Firebase Realtime DB bridge
      if (this.firebaseUrl) {
        this.pushToFirebase(payload).catch((e) => console.warn('Firebase sync warning:', e));
      }

      return mqttSuccess;
    }

    // Optional Firebase RTDB implementation
    initFirebase() {
      if (!this.firebaseUrl || typeof EventSource === 'undefined') return;
      try {
        if (this.firebaseEventSource) {
          this.firebaseEventSource.close();
        }
        const sseUrl = this.firebaseUrl.replace(/\/+$/, '') + '/turnuva.json';
        this.firebaseEventSource = new EventSource(sseUrl);
        this.firebaseEventSource.addEventListener('put', (e) => {
          try {
            const data = JSON.parse(e.data);
            if (data && data.data) {
              const msg = data.data;
              if (msg && msg.state && msg.sender !== this.clientId) {
                const expectedToken = computeAuthToken(this.activePinGetter());
                if (msg.auth_token === expectedToken) {
                  if (!this.lastProcessedTimestamp || msg.timestamp > this.lastProcessedTimestamp) {
                    this.lastProcessedTimestamp = msg.timestamp;
                    for (const fn of this.updateListeners) {
                      fn(msg.state, msg.timestamp, msg.sender);
                    }
                  }
                }
              }
            }
          } catch (_) {}
        });
      } catch (err) {
        console.warn('CloudSync: Firebase init error:', err);
      }
    }

    async pushToFirebase(payload) {
      if (!this.firebaseUrl) return;
      const url = this.firebaseUrl.replace(/\/+$/, '') + '/turnuva.json';
      await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    }

    destroy() {
      this.isDestroyed = true;
      clearTimeout(this.reconnectTimer);
      if (this.client) {
        try { this.client.disconnect(); } catch (_) {}
      }
      if (this.firebaseEventSource) {
        try { this.firebaseEventSource.close(); } catch (_) {}
      }
    }
  }

  const instance = new CloudSyncManager();
  instance.computeAuthToken = computeAuthToken;
  return instance;
});
