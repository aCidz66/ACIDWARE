const { Client } = require('discord.js-selfbot-v13');
const { HttpsProxyAgent } = require('https-proxy-agent');

const createProxiedClient = (proxyUrl, options = {}) => {
  return new Client({
    http: { agent: new HttpsProxyAgent(proxyUrl) },
    ws: { agent: new HttpsProxyAgent(proxyUrl) },
    ...options
  });
};

module.exports = { createProxiedClient };