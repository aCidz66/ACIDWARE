// Real-time monitoring of all tokens
const statusReport = (manager) => {
  const statuses = Array.from(manager.clients.values()).map(c => ({
    tag: c.user?.tag,
    id: c.user?.id,
    guilds: c.guilds.cache.size,
    status: c.ws.status
  }));
  return statuses;
};

module.exports = { statusReport };