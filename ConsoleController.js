const readline = require('readline');

const colors = {
  purple: '\u001b[35m',
  reset: '\u001b[0m',
  cyan: '\u001b[36m',
  white: '\u001b[97m'
};

class ConsoleController {
  constructor(manager) {
    this.manager = manager;
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: `${colors.purple}ACIDWARE>${colors.reset} `
    });
  }

  start() {
    this.printHeader();
    this.showMenu();
    this.rl.prompt();

    this.rl.on('line', async (line) => {
      const input = line.trim();
      if (!input) {
        this.rl.prompt();
        return;
      }

      const [command, ...args] = input.split(/\s+/);
      try {
        switch (command.toLowerCase()) {
          case 'list':
            this.listClients();
            break;
          case 'join':
            await this.joinServer(args[0], args[1]);
            break;
          case 'send':
            await this.sendMessage(args[0], args.slice(1).join(' '));
            break;
          case 'status':
            this.printStatus();
            break;
          case 'solver':
            this.printSolverStatus();
            break;
          case 'captcha':
            await this.setCaptchaKey(args[0]);
            break;
          case 'proxy':
            await this.setProxy(args[0]);
            break;
          case 'clear':
            console.clear();
            this.showMenu();
            break;
          case 'help':
            this.showMenu();
            break;
          case 'exit':
          case 'quit':
            await this.shutdown();
            return;
          default:
            console.log(`Unknown command: ${command}`);
            this.showMenu();
        }
      } catch (err) {
        console.error('Controller error:', err.message || err);
      }

      this.rl.prompt();
    });

    this.rl.on('SIGINT', async () => {
      await this.shutdown();
    });
  }

  printHeader() {
    console.log(colors.purple + '  ______    _____ ____  _    _    _    _          ' + colors.reset);
    console.log(colors.purple + ' |  ____|  / ____/ __ \| |  | |  / \  | |         ' + colors.reset);
    console.log(colors.purple + ' | |__    | |   | |  | | |  | | / _ \ | |         ' + colors.reset);
    console.log(colors.purple + ' |  __|   | |   | |  | | |  | |/ ___ \| |         ' + colors.reset);
    console.log(colors.purple + ' | |      | |___| |__| | |__| /_/   \_\ |____     ' + colors.reset);
    console.log(colors.purple + ' |_|       \_____\____/ \____/      \_\______|    ' + colors.reset);
    console.log(colors.cyan + '               ACIDWARE CONSOLE CONTROLLER       ' + colors.reset);
    console.log(colors.white + 'Type help for command list' + colors.reset);
  }

  showMenu() {
    console.log('\n' + colors.purple + 'Available commands:' + colors.reset);
    console.log(colors.white + '  list                     ' + colors.reset + '- Show connected clients');
    console.log(colors.white + '  join <invite> [delay]    ' + colors.reset + '- Join a server using invite URL or code');
    console.log(colors.white + '  send <channelId> <text>  ' + colors.reset + '- Send a message from all clients');
    console.log(colors.white + '  status                   ' + colors.reset + '- Show client readiness status');
    console.log(colors.white + '  solver                   ' + colors.reset + '- Show captcha solver status');
    console.log(colors.white + '  captcha <apiKey>         ' + colors.reset + '- Set 2captcha API key at runtime');
    console.log(colors.white + '  proxy [url|clear]        ' + colors.reset + '- Set or clear the default proxy for new clients');
    console.log(colors.white + '  clear                    ' + colors.reset + '- Clear the console display');
    console.log(colors.white + '  help                     ' + colors.reset + '- Show this menu');
    console.log(colors.white + '  exit                     ' + colors.reset + '- Shutdown all clients and quit');
    console.log(colors.cyan + '\nInvite format example: join https://discord.gg/3hWFWKH8w' + colors.reset);
  }

  listClients() {
    const clients = this.manager.getClients();
    if (!clients.length) {
      console.log('No connected clients.');
      return;
    }
    clients.forEach((client, index) => {
      console.log(`${index + 1}. ${client.user?.tag || 'unknown'} (${client.user?.id || 'no id'})`);
    });
  }

  async joinServer(inviteCodeOrUrl, delay = 1000) {
    if (!inviteCodeOrUrl) {
      console.log('Usage: join <inviteCode|inviteUrl> [delayMs]');
      return;
    }

    const inviteCode = this.extractInviteCode(inviteCodeOrUrl);
    if (!inviteCode) {
      console.log('Invalid invite format. Example: join https://discord.gg/3hWFWKH8w');
      return;
    }

    const delayMs = Number(delay) || 1000;
    const clients = this.manager.getClients();
    if (!clients.length) {
      console.log('No connected clients available to join the invite. Use status to verify connected clients.');
      return;
    }

    console.log(`Joining invite ${inviteCode} with ${clients.length} clients...`);
    console.log(`Captcha solver enabled: ${this.manager.isCaptchaSolverEnabled()}`);
    console.log(`Default proxy: ${this.manager.getProxyUrl() || 'none'}`);

    for (const client of clients) {
      const displayName = `${client.user?.tag || 'unknown'} (${client.user?.id || 'no id'})`;
      console.log(`Attempting join for ${displayName}...`);

      const start = Date.now();
      let settled = false;
      const timeoutMs = Number(process.env.JOIN_TIMEOUT_MS || 300000); // default 5 minutes to allow captcha solving

      const joinPromise = (async () => {
        try {
          const res = await client.acceptInvite(inviteCode, { bypassOnboarding: true, bypassVerify: true });
          settled = true;
          return res;
        } catch (e) {
          settled = true;
          throw e;
        }
      })();

      const heartbeat = setInterval(() => {
        if (!settled) {
          const elapsed = Math.floor((Date.now() - start) / 1000);
          console.log(`[join] still waiting for ${displayName} - ${elapsed}s elapsed`);
        }
      }, 5000);

      try {
        await Promise.race([
          joinPromise,
          new Promise((_, reject) => setTimeout(() => reject(new Error(`Invite join timed out after ${timeoutMs}ms`)), timeoutMs)),
        ]);
        console.log(`Joined with ${displayName}`);
      } catch (err) {
        const diagnosis = this.classifyInviteError(err);
        console.error(`Failed to join with ${displayName}: ${diagnosis}`);
        this.printInviteFailure(err);
      } finally {
        clearInterval(heartbeat);
      }

      await this.wait(delayMs);
    }
  }

  async sendMessage(channelId, text) {
    if (!channelId || !text) {
      console.log('Usage: send <channelId> <text>');
      return;
    }

    const clients = this.manager.getClients();
    console.log(`Sending message to ${channelId} from ${clients.length} clients...`);

    for (const client of clients) {
      try {
        const channel = client.channels.cache.get(channelId);
        if (!channel) {
          console.error(`${client.user?.tag}: channel not found in cache`);
          continue;
        }
        await channel.send(text);
        console.log(`Sent from ${client.user?.tag}`);
      } catch (err) {
        console.error(`Failed send from ${client.user?.tag}:`, err.message || err);
      }
    }
  }

  printStatus() {
    const clients = this.manager.getClients();
    console.log(`Connected clients: ${clients.length}`);
    console.log(`Captcha solver enabled: ${this.manager.isCaptchaSolverEnabled()}`);
    console.log(`Default proxy: ${this.manager.getProxyUrl() || 'none'}`);
    clients.forEach(client => {
      console.log(`- ${client.user?.tag || 'unknown'} [ws=${client.ws.status}]`);
    });
  }

  async shutdown() {
    console.log('Shutting down clients...');
    await this.manager.destroyAll();
    this.rl.close();
    process.exit(0);
  }

  printSolverStatus() {
    console.log(`Captcha solver enabled: ${this.manager.isCaptchaSolverEnabled()}`);
  }

  async setCaptchaKey(apiKey) {
    if (!apiKey) {
      console.log('Usage: captcha <apiKey>');
      return;
    }

    try {
      this.manager.setCaptchaSolver(apiKey);
      process.env.TWO_CAPTCHA_API_KEY = apiKey;
      console.log('2Captcha API key set at runtime.');
    } catch (err) {
      console.error('Failed to set captcha solver:', err.message || err);
    }
  }

  async setProxy(proxyUrl) {
    if (!proxyUrl) {
      console.log(`Current proxy: ${this.manager.getProxyUrl() || 'none'}`);
      console.log('Usage: proxy <url> | proxy clear');
      return;
    }

    if (proxyUrl.toLowerCase() === 'clear') {
      this.manager.setProxyUrl(null);
      console.log('Proxy cleared. Existing clients keep their current connections.');
      return;
    }

    this.manager.setProxyUrl(proxyUrl);
    console.log(`Default proxy set for new clients: ${proxyUrl}`);
  }

  extractInviteCode(invite) {
    if (!invite) return null;
    const normalized = invite.trim();
    const urlMatch = normalized.match(/(?:https?:\/\/)?(?:www\.)?(?:discord\.gg|discord\.com\/invite)\/([A-Za-z0-9]+)/i);
    if (urlMatch) return urlMatch[1];
    const codeMatch = normalized.match(/^([A-Za-z0-9]+)$/);
    return codeMatch ? codeMatch[1] : null;
  }

  classifyInviteError(err) {
    const message = String(err?.message || err || '').toLowerCase();
    if (message.includes('captcha')) {
      return 'Captcha required';
    }
    if (message.includes('proxy') || message.includes('econnrefused') || message.includes('connect') || message.includes('timed out')) {
      return 'Proxy/network failure';
    }
    if (message.includes('401') || message.includes('unauthorized') || message.includes('invalid token')) {
      return 'Invalid/expired token';
    }
    if (message.includes('unknown invite') || message.includes('not found')) {
      return 'Invalid invite code';
    }
    return message || 'Unknown error';
  }

  printInviteFailure(err) {
    if (!err) {
      console.error('No error object available.');
      return;
    }

    const details = {
      type: err.name || typeof err,
      message: err.message || '',
      httpStatus: err.httpStatus ?? err.status ?? null,
      errorCode: err.code ?? null,
      captcha: err.captcha ?? null,
      requestPath: err.path ?? err.request?.path ?? null,
      requestMethod: err.method ?? err.request?.method ?? null,
      requestHeaders: err.requestData?.headers ?? err.request?.options?.headers ?? null,
      retryAfter: err.retry_after ?? err.request?.options?.headers?.['retry-after'] ?? null,
    };

    console.error('Invite failure details:');
    console.error(JSON.stringify(details, null, 2));
    if (err.stack) {
      console.error('Stack trace:', err.stack);
    }
  }

  wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = ConsoleController;
