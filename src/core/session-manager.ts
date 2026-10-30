import { AuthenticatedUser, SpaceItem } from '../connectors/connector.interface.js';

export type DialogState =
  | 'UNAUTHENTICATED'
  | 'AWAITING_EMAIL'
  | 'AWAITING_OTP'
  | 'AUTHENTICATED'
  | 'SELECTING_DATE'
  | 'SELECTING_SPACE'
  | 'CONFIRMING_BOOKING';

export interface UserSession {
  phone: string;
  state: DialogState;
  user?: AuthenticatedUser;
  pendingEmail?: string;
  selectedDate?: string;
  selectedSpace?: SpaceItem;
  availableSpaces?: SpaceItem[];
  pendingEventName?: string;
  pendingStartHour?: string;
  pendingEndHour?: string;
  lastActivityAt: number;
}

export class SessionManager {
  private sessions: Map<string, UserSession> = new Map();
  private readonly ttlMs: number;
  private cleanupInterval?: NodeJS.Timeout;

  constructor(ttlMinutes: number = 60) {
    this.ttlMs = ttlMinutes * 60 * 1000;

    // Limpeza periódica de sessões expiradas a cada 10 minutos
    this.cleanupInterval = setInterval(() => {
      this.clearExpiredSessions();
    }, 10 * 60 * 1000);

    // Permitir finalização do processo Node sem travar o event loop
    if (this.cleanupInterval.unref) {
      this.cleanupInterval.unref();
    }
  }

  public normalizePhone(phone: string): string {
    return phone.replace(/\D/g, '');
  }

  public getSession(rawPhone: string): UserSession {
    const phone = this.normalizePhone(rawPhone);
    const now = Date.now();
    const existing = this.sessions.get(phone);

    if (existing) {
      if (now - existing.lastActivityAt > this.ttlMs) {
        this.sessions.delete(phone);
      } else {
        existing.lastActivityAt = now;
        return existing;
      }
    }

    const newSession: UserSession = {
      phone,
      state: 'UNAUTHENTICATED',
      lastActivityAt: now,
    };

    this.sessions.set(phone, newSession);
    return newSession;
  }

  public updateSession(rawPhone: string, partial: Partial<UserSession>): UserSession {
    const session = this.getSession(rawPhone);
    Object.assign(session, partial, { lastActivityAt: Date.now() });
    this.sessions.set(session.phone, session);
    return session;
  }

  public resetSession(rawPhone: string): UserSession {
    const phone = this.normalizePhone(rawPhone);
    const resetData: UserSession = {
      phone,
      state: 'UNAUTHENTICATED',
      lastActivityAt: Date.now(),
    };
    this.sessions.set(phone, resetData);
    return resetData;
  }

  public deleteSession(rawPhone: string): void {
    const phone = this.normalizePhone(rawPhone);
    this.sessions.delete(phone);
  }

  public clearExpiredSessions(): number {
    const now = Date.now();
    let count = 0;
    for (const [phone, session] of this.sessions.entries()) {
      if (now - session.lastActivityAt > this.ttlMs) {
        this.sessions.delete(phone);
        count++;
      }
    }
    return count;
  }

  public getActiveSessionsCount(): number {
    return this.sessions.size;
  }

  public destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
  }
}
