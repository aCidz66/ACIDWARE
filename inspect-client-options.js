const ClientManager = require('./src/clients/ClientManager');
const mgr = new ClientManager();
const client = new (require('discord.js-selfbot-v13').Client)(mgr.getDiscordClientInfo());
console.log(JSON.stringify({ http: client.options.http, ws: client.options.ws }, null, 2));
