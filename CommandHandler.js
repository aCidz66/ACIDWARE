// Command processing and registration
class CommandHandler {
  constructor(prefix = '!') {
    this.prefix = prefix;
    this.commands = new Map();
    this.cooldowns = new Map(); // userId -> { commandName -> timestamp }
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
    const userId = message.author?.id;
    if (command.cooldown > 0 && userId) {
      if (!this.cooldowns.has(userId)) {
        this.cooldowns.set(userId, {});
      }
      const userCooldowns = this.cooldowns.get(userId);
      const now = Date.now();
      const lastExecuted = userCooldowns[commandName] || 0;
      
      if (now - lastExecuted < command.cooldown) {
        const remaining = Math.ceil((command.cooldown - (now - lastExecuted)) / 1000);
        message.reply(`Command on cooldown. Try again in ${remaining}s`).catch(() => {});
        return;
      }
      
      userCooldowns[commandName] = now;
    }

    // Permission check (not implemented yet)
    if (command.adminOnly && !this.isAdmin(message)) {
      message.reply('Admin only command').catch(() => {});
      return;
    }

    // Execute
    try {
      await command.executor(message, args, client, manager);
    } catch (err) {
      console.error(`Command error: ${commandName}`, err);
      message.reply(`Error executing command: ${err.message}`).catch(() => {});
    }
  }

  isAdmin(message) {
    // TODO: Implement admin check (owner, roles, permissions)
    return message.author?.id === message.guild?.ownerId;
  }
}

module.exports = CommandHandler;
