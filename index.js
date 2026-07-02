// Environment setup - must be first
const ConfigLoader = require('./ConfigLoader');

// Main entry point
const path = require('path');
const ClientManager = require('./ClientManager');
const CommandHandler = require('./CommandHandler');
const ConsoleController = require('./ConsoleController');

const manager = new ClientManager({ 
  proxyUrl: ConfigLoader.get('DISCORD_PROXY_URL', null)
});
const commands = new CommandHandler('!');

// Register commands
commands.register('ping', (msg) => msg.reply('Pong!'));
commands.register('status', () => {
  console.log(`Connected clients: ${manager.getClients().length}`);
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
  const tokensPath = path.resolve(__dirname, 'tokens.json');
  await manager.loadTokensFromFile(tokensPath);
  console.log(`${manager.readyCount} clients ready`);

  const controller = new ConsoleController(manager);
  controller.start();
})();
