import { User } from "../session/User";

/**
 * SessionManager — thin lookup for User objects.
 *
 * Keeps User objects alive across glasses reconnects so that
 * conversation history, location, and other state survive
 * network blips and idle socket timeouts.
 */
export class SessionManager {
  private users: Map<string, User> = new Map();
  private removalTimers: Map<string, Timer> = new Map();

  /** Grace period before fully removing a disconnected user (5 minutes) */
  private readonly REMOVAL_GRACE_MS = 5 * 60 * 1000;

  /** Get an existing user or create a new one */
  getOrCreate(userId: string): User {
    // Cancel any pending removal — user is reconnecting
    this.cancelRemovalTimer(userId);

    let user = this.users.get(userId);
    if (!user) {
      user = new User(userId);
      this.users.set(userId, user);
      console.log(`[SessionManager] Created user: ${userId}`);
    }
    return user;
  }

  /** Get an existing user (undefined if not found) */
  get(userId: string): User | undefined {
    // Cancel any pending removal — something is actively using this user
    const user = this.users.get(userId);
    if (user) {
      this.cancelRemovalTimer(userId);
    }
    return user;
  }

  /**
   * Soft disconnect — clear the glasses session but keep the User
   * alive for a grace period so reconnects are seamless.
   */
  softDisconnect(userId: string): void {
    const user = this.users.get(userId);
    if (!user) return;

    // Detach glasses but preserve all state (history, location, etc.)
    user.clearAppSession();
    console.log(`[SessionManager] Soft disconnect for ${userId} (grace period: ${this.REMOVAL_GRACE_MS / 1000}s)`);

    // Schedule full removal after grace period
    this.cancelRemovalTimer(userId);
    const timer = setTimeout(() => {
      this.removalTimers.delete(userId);
      // Only remove if still disconnected (no appSession)
      const current = this.users.get(userId);
      if (current && !current.appSession) {
        current.cleanup();
        this.users.delete(userId);
        console.log(`[SessionManager] Removed user after grace period: ${userId}`);
      }
    }, this.REMOVAL_GRACE_MS);
    this.removalTimers.set(userId, timer);
  }

  /** Immediate removal — for explicit cleanup (e.g., server shutdown) */
  remove(userId: string): void {
    this.cancelRemovalTimer(userId);
    const user = this.users.get(userId);
    if (user) {
      user.cleanup();
      this.users.delete(userId);
      console.log(`[SessionManager] Removed user: ${userId}`);
    }
  }

  /** Cancel a pending removal timer */
  private cancelRemovalTimer(userId: string): void {
    const timer = this.removalTimers.get(userId);
    if (timer) {
      clearTimeout(timer);
      this.removalTimers.delete(userId);
    }
  }
}

/** Singleton — import this everywhere */
export const sessions = new SessionManager();
