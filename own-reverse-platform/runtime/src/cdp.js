const http = require('node:http');
const https = require('node:https');
const WebSocket = require('ws');

function hostname(url) {
  return url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
}

function normalizeEndpoint(endpoint) {
  const url = new URL(endpoint || 'http://127.0.0.1:9222');
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('CDP endpoint must use http or https');
  if (!['127.0.0.1', '::1'].includes(hostname(url))) {
    throw new Error(`Refusing non-loopback CDP endpoint: ${url.hostname}`);
  }
  if (url.username || url.password || !['', '/'].includes(url.pathname) || url.search || url.hash) {
    throw new Error('CDP endpoint must be a bare loopback origin without credentials, path, query, or fragment');
  }
  return url;
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    const transport = url.protocol === 'https:' ? https : http;
    const request = transport.get(url, { headers: { accept: 'application/json' } }, response => {
      if (response.statusCode < 200 || response.statusCode >= 300) {
        response.resume();
        reject(new Error(`CDP HTTP ${response.statusCode} for ${url}`));
        return;
      }
      let body = '';
      response.setEncoding('utf8');
      response.on('error', reject);
      response.on('data', chunk => {
        body += chunk;
        if (Buffer.byteLength(body, 'utf8') > 2 * 1024 * 1024) {
          response.destroy();
          reject(new Error('CDP response exceeded 2 MiB'));
        }
      });
      response.on('end', () => {
        try { resolve(JSON.parse(body)); } catch (error) { reject(new Error(`Invalid CDP JSON: ${error.message}`)); }
      });
    });
    request.setTimeout(5000, () => request.destroy(new Error('CDP HTTP timeout')));
    request.on('error', reject);
  });
}

async function listTargets(endpoint) {
  const base = normalizeEndpoint(endpoint);
  const url = new URL('/json/list', base);
  return getJson(url);
}

async function browserVersion(endpoint) {
  const base = normalizeEndpoint(endpoint);
  return getJson(new URL('/json/version', base));
}

function chooseTarget(targets, requestedUrl, endpoint) {
  const pages = targets.filter(target => target.type === 'page' && target.webSocketDebuggerUrl);
  if (!pages.length) throw new Error('No debuggable page target found at the CDP endpoint');
  if (!requestedUrl) throw new Error('An exact authorized page URL is required');
  const selected = pages.find(target => target.url === requestedUrl);
  if (!selected) throw new Error(`No page target exactly matches requested URL: ${requestedUrl}`);
  if (endpoint) validateDebuggerUrl(selected.webSocketDebuggerUrl, endpoint);
  return selected;
}

function validateDebuggerUrl(wsUrl, endpoint) {
  const base = normalizeEndpoint(endpoint);
  const parsed = new URL(wsUrl);
  const expectedProtocol = base.protocol === 'https:' ? 'wss:' : 'ws:';
  const expectedPort = base.port || (base.protocol === 'https:' ? '443' : '80');
  const actualPort = parsed.port || (parsed.protocol === 'wss:' ? '443' : '80');
  if (parsed.protocol !== expectedProtocol || hostname(parsed) !== hostname(base) ||
      parsed.username || parsed.password || parsed.search || parsed.hash || actualPort !== expectedPort ||
      !parsed.pathname.startsWith('/devtools/')) {
    throw new Error('CDP target WebSocket must stay on the authorized loopback endpoint');
  }
  return parsed;
}

class CdpConnection {
  constructor(wsUrl, timeoutMs = 8000) {
    this.wsUrl = wsUrl;
    this.timeoutMs = timeoutMs;
    this.nextId = 0;
    this.pending = new Map();
    this.listeners = new Map();
    this.socket = null;
  }

  async connect() {
    const parsed = new URL(this.wsUrl);
    if (!['ws:', 'wss:'].includes(parsed.protocol)) throw new Error('CDP target must use ws or wss');
    if (!['127.0.0.1', '::1'].includes(hostname(parsed)) || parsed.username || parsed.password || parsed.search || parsed.hash) {
      throw new Error(`Refusing invalid or non-loopback CDP WebSocket: ${parsed.hostname}`);
    }
    this.socket = new WebSocket(this.wsUrl);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('CDP WebSocket timeout')), this.timeoutMs);
      this.socket.once('open', () => { clearTimeout(timer); resolve(); });
      this.socket.once('error', error => { clearTimeout(timer); reject(error); });
    });
    this.socket.on('message', data => {
      try { this.#onMessage(JSON.parse(data.toString())); }
      catch (error) {
        for (const { reject } of this.pending.values()) reject(new Error(`Invalid CDP message: ${error.message}`));
        this.pending.clear();
        this.socket.close();
      }
    });
    this.socket.on('close', () => {
      for (const { reject } of this.pending.values()) reject(new Error('CDP WebSocket closed'));
      this.pending.clear();
    });
    return this;
  }

  on(method, listener) {
    if (!this.listeners.has(method)) this.listeners.set(method, new Set());
    this.listeners.get(method).add(listener);
    return () => this.listeners.get(method)?.delete(listener);
  }

  send(method, params = {}) {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`CDP command timeout: ${method}`)); }, this.timeoutMs);
      this.pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close() { this.socket?.close(); }

  #onMessage(message) {
    if (message.id) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(`${message.error.message} (${message.error.code})`));
      else pending.resolve(message.result || {});
      return;
    }
    for (const listener of this.listeners.get(message.method) || []) listener(message.params || {});
  }
}

module.exports = { CdpConnection, browserVersion, chooseTarget, listTargets, normalizeEndpoint, validateDebuggerUrl };
