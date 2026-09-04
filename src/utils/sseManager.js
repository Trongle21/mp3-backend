const UserPresence = require('../models/UserPresence');

class SSEManager {
  constructor() {
    // userId (string) -> Set of Express Response objects
    this.connections = new Map();
  }

  /**
   * Register an SSE connection for a user.
   */
  addConnection(userId, res) {
    const uid = userId.toString();

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders?.();

    // Initial message
    res.write(`: connected\n\n`);

    if (!this.connections.has(uid)) {
      this.connections.set(uid, new Set());
      // Marked as online when first connection opens
      UserPresence.findOneAndUpdate(
        { user: uid },
        { isOnline: true, lastSeen: new Date() },
        { upsert: true }
      ).catch((err) => console.warn('[sse] update online presence failed:', err.message));
    }

    const userConns = this.connections.get(uid);
    userConns.add(res);

    // Keep-alive heartbeat every 25 seconds
    const intervalId = setInterval(() => {
      try {
        res.write(`: ping\n\n`);
      } catch (err) {
        clearInterval(intervalId);
      }
    }, 25000);

    const cleanup = () => {
      clearInterval(intervalId);
      const set = this.connections.get(uid);
      if (set) {
        set.delete(res);
        if (set.size === 0) {
          this.connections.delete(uid);
          // Marked as offline when all connections close
          UserPresence.findOneAndUpdate(
            { user: uid },
            { isOnline: false, lastSeen: new Date() },
            { upsert: true }
          ).catch((err) => console.warn('[sse] update offline presence failed:', err.message));
        }
      }
    };

    res.on('close', cleanup);
    res.on('error', cleanup);
  }

  /**
   * Send an event to a single user.
   */
  sendToUser(userId, event, data) {
    const uid = userId.toString();
    const set = this.connections.get(uid);
    if (!set || set.size === 0) return false;

    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of set) {
      try {
        res.write(payload);
      } catch (err) {
        console.warn(`[sse] failed sending to user ${uid}:`, err.message);
      }
    }
    return true;
  }

  /**
   * Send an event to multiple users (e.g. all members of a conversation).
   */
  sendToUsers(userIds, event, data) {
    if (!Array.isArray(userIds)) return;
    for (const uid of userIds) {
      this.sendToUser(uid, event, data);
    }
  }

  /**
   * Check if a user is currently connected to SSE.
   */
  isUserOnline(userId) {
    const uid = userId.toString();
    const set = this.connections.get(uid);
    return Boolean(set && set.size > 0);
  }
}

module.exports = new SSEManager();
