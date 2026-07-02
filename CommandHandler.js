// src/commands/CommandHandler.js
class CommandHandler {
  constructor(prefix = '!') {
    this.prefix = prefix;
    this.commands = new Map();
  }

  register(name, executor, options = {}) {
    this.commands.set(name.toLowerCase(), { 
      executor, 
      description: options.description,
      adminOnly: options.adminOnly || false,
      cooldown: options.cooldown || 0
    });
  }

  async process(message, client, manager) {
    if (!message.content || !message.content.startsWith(this.prefix)) return;
    if (message.author?.id === client.user?.id) return;

    const args = message.content.slice(this.prefix.length).trim().split(/\s+/);
    const commandName = args.shift().toLowerCase();
    
    const command = this.commands.get(commandName);
    if (!command) return;

    // Cooldown check
    // Permission check
    // Execute
    try {
      await command.executor(message, args, client, manager);
    } catch (err) {
      console.error(`Command error: ${commandName}`, err);
    }
  }
}

module.exports = CommandHandler;