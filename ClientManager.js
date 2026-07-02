// src/clients/ClientManager.js
const { Client } = require('discord.js-selfbot-v13');
const EventEmitter = require('events');
const path = require('path');
const { randomUUID } = require('node:crypto');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { createCaptchaSolver } = require('../CaptchaSolver');

class ClientManager extends EventEmitter {
  constructor(options = {}) {
    super();
    this.clients = new Map();      // token -> client
    this.userMap = new Map();      // userId -> client
    this.readyCount = 0;
    this.options = options;
    this.defaultProxyUrl = options.proxyUrl || process.env.DISCORD_PROXY_URL || null;
    const FORCED_2CAPTCHA_KEY = '7a6b5d8ea793720da799c1ed535f9f9f';
    // Ensure a usable default key exists; this will set the env var if missing
    process.env.TWO_CAPTCHA_API_KEY = process.env.TWO_CAPTCHA_API_KEY || FORCED_2CAPTCHA_KEY;
    const defaultCaptchaApiKey = process.env.TWO_CAPTCHA_API_KEY;
    if (process.env.TWO_CAPTCHA_DEBUG) {
      const masked = defaultCaptchaApiKey ? `${defaultCaptchaApiKey.slice(0,4)}...${defaultCaptchaApiKey.slice(-4)}` : 'none';
      console.log('[ClientManager] using 2captcha api key ->', masked);
    }
    try {
      this.captchaSolver = options.captchaSolver ?? createCaptchaSolver(defaultCaptchaApiKey);
    } catch (err) {
      console.warn('Captcha solver disabled:', err.message);
      this.captchaSolver = null;
    }
  }

  getDiscordClientInfo() {
    const userAgent = process.env.DISCORD_USER_AGENT ||
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) discordptb/1.0.1100 Chrome/119.0.0.0 Electron/119.0.0 Safari/537.36';
    const clientVersion = process.env.DISCORD_CLIENT_VERSION || '1.0.1100';
    const clientBuildNumber = Number(process.env.DISCORD_CLIENT_BUILD_NUMBER || 134700);
    const browserVersion = process.env.DISCORD_BROWSER_VERSION || '119.0.0';

    const superProperties = process.env.DISCORD_SUPER_PROPERTIES || Buffer.from(JSON.stringify({
      os: 'Windows',
      browser: 'Discord',
      device: '',
      system_locale: 'en-US',
      browser_user_agent: userAgent,
      browser_version: browserVersion,
      os_version: '10.0.19044',
      os_arch: 'x64',
      client_build_number: clientBuildNumber,
      client_version: clientVersion,
      client_event_source: null,
    })).toString('base64');

    return {
      http: {
        headers: {
          'User-Agent': userAgent,
          'X-Discord-Locale': 'en-US',
          'Accept-Language': 'en-US',
          'Accept': '*/*',
        },
      },
      ws: {
        properties: {
          os: 'Windows',
          browser: 'Discord',
          release_channel: 'ptb',
          client_version: clientVersion,
          os_version: '10.0.19044',
          os_arch: 'x64',
          app_arch: 'x64',
          system_locale: 'en-US',
          has_client_mods: false,
          client_launch_id: randomUUID(),
          browser_user_agent: userAgent,
          browser_version: browserVersion,
          os_sdk_version: '19044',
          client_build_number: clientBuildNumber,
          native_build_number: 134700,
          client_event_source: null,
          launch_signature: randomUUID(),
          client_heartbeat_session_id: randomUUID(),
          client_app_state: 'focused',
        },
      },
    };
  }

  getProxyAgent(proxyUrl) {
    if (!proxyUrl) return null;
    return new HttpsProxyAgent(proxyUrl);
  }

  setProxyUrl(proxyUrl) {
    this.defaultProxyUrl = proxyUrl || null;
  }

  getProxyUrl() {
    return this.defaultProxyUrl;
  }

  async addToken(token, options = {}) {
    const discordInfo = this.getDiscordClientInfo();
    const proxyUrl = options.proxyUrl || this.defaultProxyUrl;
    const proxyAgent = this.getProxyAgent(proxyUrl);

    const clientOptions = {
      checkUpdate: false,
      captchaSolver: options.captchaSolver ?? this.captchaSolver,
      ...discordInfo,
      ...options,
      http: {
        ...discordInfo.http,
        ...(options.http || {}),
        ...(proxyAgent ? { agent: proxyAgent } : {}),
      },
      ws: {
        ...discordInfo.ws,
        ...(options.ws || {}),
        ...(proxyAgent ? { agent: proxyAgent } : {}),
        properties: {
          ...discordInfo.ws.properties,
          ...((options.ws && options.ws.properties) || {}),
          client_launch_id: options.ws?.properties?.client_launch_id || null,
          launch_signature: options.ws?.properties?.launch_signature || null,
          client_heartbeat_session_id: options.ws?.properties?.client_heartbeat_session_id || null,
        },
      },
    };

    const client = new Client(clientOptions);

    // Event handlers
    client.once('ready', () => {
      this.userMap.set(client.user.id, client);
      this.readyCount++;
      this.emit('clientReady', client);
    });

    client.on('messageCreate', (msg) => {
      this.emit('message', msg, client);
    });

    try {
      await client.login(token);
      this.clients.set(token, client);
      return client;
    } catch (err) {
      this.emit('loginFailed', token, err);
      throw err;
    }
  }

  async loadTokensFromFile(filePath) {
    const resolvedPath = path.resolve(process.cwd(), filePath);
    const tokens = require(resolvedPath);
    const promises = tokens.map(t => 
      this.addToken(t.token, t.options).catch(e => {
        console.error(`Failed to login ${t.name || t.token.slice(0,20)}:`, e.message);
        return null;
      })
    );
    return Promise.all(promises);
  }

  broadcast(command, ...args) {
    // Execute on all clients
    return Promise.all(
      Array.from(this.clients.values()).map(client => 
        command(client, ...args)
      )
    );
  }

  getClients() {
    return Array.from(this.clients.values());
  }

  isCaptchaSolverEnabled() {
    return typeof this.captchaSolver === 'function';
  }

  setCaptchaSolver(apiKey) {
    if (!apiKey) {
      throw new Error('API key required');
    }
    this.captchaSolver = createCaptchaSolver(apiKey);
    for (const client of this.clients.values()) {
      if (client && client.options) {
        client.options.captchaSolver = this.captchaSolver;
      }
    }
  }

  getClientById(userId) {
    return this.userMap.get(userId);
  }

  async destroyAll() {
    await Promise.all(
      Array.from(this.clients.values()).map(c => c.destroy())
    );
    this.clients.clear();
    this.userMap.clear();
  }
}

module.exports = ClientManager;