// src/notification-history.ts - Notification History Module

import type { Notification, NotificationType, NotificationChannel } from './notification-center.ts';
import type { SendResult } from './notification-center.ts';

export interface NotificationRecord {
  id: string;
  notification: Notification;
  results: SendResult[];
  timestamp: number;
}

export interface HistoryFilter {
  type?: NotificationType;
  channel?: string;
  status?: 'success' | 'failed';
  recipient?: string;
  startTime?: number;
  endTime?: number;
  limit?: number;
  offset?: number;
}

export type AggregateDimension = 'type' | 'channel' | 'status' | 'recipient' | 'day';

export interface AggregateResult {
  dimension: AggregateDimension;
  period: string;
  buckets: Record<string, number>;
  total: number;
}

export class NotificationHistory {
  private records: NotificationRecord[] = [];
  private recordCounter = 0;
  private storageType: 'memory' | 'file';
  private filePath?: string;

  constructor(storageType: 'memory' | 'file' = 'memory', filePath?: string) {
    this.storageType = storageType;
    this.filePath = filePath;
  }

  record(notification: Notification, result: SendResult[]): void {
    const record: NotificationRecord = {
      id: `rec_${++this.recordCounter}`,
      notification,
      results: result,
      timestamp: notification.timestamp || Date.now(),
    };
    this.records.push(record);
  }

  query(filter: HistoryFilter): NotificationRecord[] {
    let results = [...this.records];

    if (filter.type) {
      results = results.filter(r => r.notification.type === filter.type);
    }
    if (filter.channel) {
      results = results.filter(r =>
        r.results.some(res => res.channel === filter.channel)
      );
    }
    if (filter.status) {
      results = results.filter(r =>
        r.results.some(res =>
          filter.status === 'success' ? res.success : !res.success
        )
      );
    }
    if (filter.recipient) {
      results = results.filter(r => r.notification.recipient === filter.recipient);
    }
    if (filter.startTime) {
      results = results.filter(r => r.timestamp >= filter.startTime!);
    }
    if (filter.endTime) {
      results = results.filter(r => r.timestamp <= filter.endTime!);
    }

    // Sort by timestamp descending
    results.sort((a, b) => b.timestamp - a.timestamp);

    if (filter.offset) {
      results = results.slice(filter.offset);
    }
    if (filter.limit) {
      results = results.slice(0, filter.limit);
    }

    return results;
  }

  aggregate(dimension: AggregateDimension, period?: string): AggregateResult {
    const buckets: Record<string, number> = {};
    let total = 0;

    for (const record of this.records) {
      total++;
      let key: string;

      switch (dimension) {
        case 'type':
          key = record.notification.type;
          break;
        case 'channel':
          key = record.results.map(r => r.channel).join(',') || 'none';
          break;
        case 'status':
          key = record.results.every(r => r.success) ? 'success' : 'failed';
          break;
        case 'recipient':
          key = record.notification.recipient || 'unknown';
          break;
        case 'day':
          key = new Date(record.timestamp).toISOString().split('T')[0];
          break;
        default:
          key = 'unknown';
      }

      buckets[key] = (buckets[key] || 0) + 1;
    }

    return {
      dimension,
      period: period || 'all',
      buckets,
      total,
    };
  }

  cleanup(retentionDays: number): number {
    const cutoff = Date.now() - (retentionDays * 86400000);
    const before = this.records.length;
    this.records = this.records.filter(r => r.timestamp >= cutoff);
    return before - this.records.length;
  }

  exportData(format: 'json' | 'csv'): string {
    if (format === 'json') {
      return JSON.stringify(this.records, null, 2);
    }

    // CSV format
    const headers = 'id,type,priority,title,channel,success,timestamp,recipient';
    const rows = this.records.map(r => {
      const ch = r.results.map(res => res.channel).join(';');
      const success = r.results.every(res => res.success);
      return [
        r.id,
        r.notification.type,
        r.notification.priority,
        `"${r.notification.title.replace(/"/g, '""')}"`,
        ch,
        success ? 'true' : 'false',
        r.timestamp,
        r.notification.recipient || '',
      ].join(',');
    });

    return [headers, ...rows].join('\n');
  }

  getCount(): number {
    return this.records.length;
  }

  clear(): void {
    this.records = [];
  }
}
