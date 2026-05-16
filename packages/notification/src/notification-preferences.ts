// src/notification-preferences.ts - Notification Preferences Module

import type { Notification, NotificationPriority, NotificationType } from './notification-center.ts';

export interface UserPreferences {
  userId: string;
  channels: Record<string, boolean>;
  quietHours: {
    enabled: boolean;
    startHour: number;
    endHour: number;
    timezone?: string;
  };
  minPriority: NotificationPriority;
  enabledCategories: string[];
  disabledCategories: string[];
  digestEnabled: boolean;
  digestFrequency: 'hourly' | 'daily' | 'weekly';
  maxPerDay: number;
  dailyCount: number;
  lastResetDay: number;
}

export interface PreferenceDefaults {
  channels: Record<string, boolean>;
  quietHours: UserPreferences['quietHours'];
  minPriority: NotificationPriority;
  digestEnabled: boolean;
  digestFrequency: 'hourly' | 'daily' | 'weekly';
  maxPerDay: number;
}

export class NotificationPreferences {
  private preferences: Map<string, UserPreferences> = new Map();
  private defaults: PreferenceDefaults;

  constructor(defaults?: Partial<PreferenceDefaults>) {
    this.defaults = {
      channels: {
        console: true,
        file: true,
        webhook: true,
        email: true,
        'in-app': true,
      },
      quietHours: {
        enabled: false,
        startHour: 22,
        endHour: 8,
      },
      minPriority: 'low',
      digestEnabled: false,
      digestFrequency: 'daily',
      maxPerDay: 100,
      ...defaults,
    };
  }

  getPreferences(userId: string): UserPreferences {
    const existing = this.preferences.get(userId);
    if (existing) {
      this.resetDailyCountIfNeeded(existing);
      return existing;
    }

    const prefs: UserPreferences = {
      userId,
      channels: { ...this.defaults.channels },
      quietHours: { ...this.defaults.quietHours },
      minPriority: this.defaults.minPriority,
      enabledCategories: [],
      disabledCategories: [],
      digestEnabled: this.defaults.digestEnabled,
      digestFrequency: this.defaults.digestFrequency,
      maxPerDay: this.defaults.maxPerDay,
      dailyCount: 0,
      lastResetDay: new Date().getDate(),
    };

    this.preferences.set(userId, prefs);
    return prefs;
  }

  setPreferences(userId: string, prefs: Partial<UserPreferences>): void {
    const existing = this.getPreferences(userId);
    const updated = { ...existing, ...prefs, userId };
    if (prefs.channels) {
      updated.channels = { ...existing.channels, ...prefs.channels };
    }
    if (prefs.quietHours) {
      updated.quietHours = { ...existing.quietHours, ...prefs.quietHours };
    }
    this.preferences.set(userId, updated);
  }

  shouldNotify(userId: string, notification: Notification): boolean {
    const prefs = this.getPreferences(userId);

    // Check daily limit
    if (prefs.dailyCount >= prefs.maxPerDay) {
      return false;
    }

    // Check quiet hours
    if (this.isQuietHours(userId) && notification.priority !== 'critical') {
      return false;
    }

    // Check priority threshold
    if (!this.meetsPriorityThreshold(notification.priority, prefs.minPriority)) {
      return false;
    }

    // Check category filters
    const category = (notification.data?.category as string) || 'general';
    if (prefs.disabledCategories.includes(category)) {
      return false;
    }
    if (prefs.enabledCategories.length > 0 && !prefs.enabledCategories.includes(category)) {
      return false;
    }

    return true;
  }

  isQuietHours(userId: string): boolean {
    const prefs = this.getPreferences(userId);
    if (!prefs.quietHours.enabled) return false;

    const now = new Date();
    const currentHour = now.getHours();

    if (prefs.quietHours.startHour > prefs.quietHours.endHour) {
      // Spans midnight (e.g., 22:00 - 08:00)
      return currentHour >= prefs.quietHours.startHour || currentHour < prefs.quietHours.endHour;
    } else {
      // Same day (e.g., 12:00 - 14:00)
      return currentHour >= prefs.quietHours.startHour && currentHour < prefs.quietHours.endHour;
    }
  }

  incrementDailyCount(userId: string): void {
    const prefs = this.getPreferences(userId);
    prefs.dailyCount++;
  }

  resetDailyCount(userId: string): void {
    const prefs = this.getPreferences(userId);
    prefs.dailyCount = 0;
    prefs.lastResetDay = new Date().getDate();
  }

  setDefaultChannelEnabled(channel: string, enabled: boolean): void {
    this.defaults.channels[channel] = enabled;
  }

  setDefaultMinPriority(priority: NotificationPriority): void {
    this.defaults.minPriority = priority;
  }

  setDefaultQuietHours(startHour: number, endHour: number): void {
    this.defaults.quietHours = { ...this.defaults.quietHours, enabled: true, startHour, endHour };
  }

  getUserCount(): number {
    return this.preferences.size;
  }

  clear(): void {
    this.preferences.clear();
  }

  private meetsPriorityThreshold(notificationPriority: NotificationPriority, minPriority: NotificationPriority): boolean {
    const levels: Record<NotificationPriority, number> = {
      low: 0,
      normal: 1,
      high: 2,
      critical: 3,
    };
    return levels[notificationPriority] >= levels[minPriority];
  }

  private resetDailyCountIfNeeded(prefs: UserPreferences): void {
    const today = new Date().getDate();
    if (prefs.lastResetDay !== today) {
      prefs.dailyCount = 0;
      prefs.lastResetDay = today;
    }
  }
}
