// src/index.js
const path = require('path');
const ClientManager = require('./clients/ClientManager');
const CommandHandler = require('./commands/CommandHandler');
const ConsoleController = require('./ConsoleController');
const { statusReport } = require('./commands/modules/TokenStatus');

const manager = new ClientManager({ proxyUrl: process.env.DISCORD_PROXY_URL || null });
const commands = new CommandHandler('!');

// Register commands
commands.register('ping', (msg) => msg.reply('Pong!'));
commands.register('status', () => {
  console.log(statusReport(manager));
});
commands.register('broadcast', (msg, args, client, mgr) => {
  const message = args.join(' ');
  mgr.broadcast((c) => c.channels.cache.get(msg.channel.id)?.send(message));
});

// Event wiring
manager.on('message', (msg, client) => {
  commands.process(msg, client, manager);
});

// Load and start
(async () => {
  const tokensPath = path.resolve(__dirname, '..', 'tokens.json');
  await manager.loadTokensFromFile(tokensPath);
  console.log(`${manager.readyCount} clients ready`);

  const controller = new ConsoleController(manager);
  controller.start();
})();