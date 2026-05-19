// src/communication-metrics.ts - 通信指标收集

import type { Message } from './message-bus.ts';

export interface MessageEvent {
  message: Message;
  eventType: 'sent' | 'received' | 'delivered' | 'failed' | 'timeout' | 'retry';
  latency?: number;
  topic: string;
  agentId: string;
  timestamp: number;
}

export interface CommunicationMetricsReport {
  totalMessages: number;
  messagesPerSecond: number;
  totalErrors: number;
  errorRate: number;
  averageLatency: number;
  p50Latency: number;
  p95Latency: number;
  p99Latency: number;
  topTopics: TopicStats[];
  activeAgents: number;
  windowStart: number;
  windowEnd: number;
}

export interface AgentCommunicationStats {
  agentId: string;
  messagesSent: number;
  messagesReceived: number;
  messagesFailed: number;
  averageLatency: number;
  lastActivity: number;
}

export interface TopicStats {
  topic: string;
  messageCount: number;
  errorCount: number;
  averageLatency: number;
  lastActivity: number;
}

export class CommunicationMetrics {
  private events: MessageEvent[] = [];
  private agentStats: Map<string, { sent: number; received: number; failed: number; latencies: number[]; lastActivity: number }> = new Map();
  private topicStats: Map<string, { count: number; errors: number; latencies: number[]; lastActivity: number }> = new Map();
  private windowStart = Date.now();
  // COMM-23: Running counters for O(1) getMetrics
  private _totalMessages = 0;
  private _totalErrors = 0;
  private _totalLatency = 0;
  private _latencyCount = 0;
  private _allLatencies: number[] = [];
  private static readonly MAX_EVENTS_SIZE = 10000;

  recordMessage(event: MessageEvent): void {
    // COMM-22: Trim events array if it exceeds max size
    if (this.events.length >= CommunicationMetrics.MAX_EVENTS_SIZE) {
      this.events.shift();
    }
    this.events.push(event);

    // COMM-23: Update running counters
    this._totalMessages++;
    if (event.eventType === 'failed' || event.eventType === 'timeout') {
      this._totalErrors++;
    }
    if (event.latency !== undefined) {
      this._totalLatency += event.latency;
      this._latencyCount++;
      this._allLatencies.push(event.latency);
      if (this._allLatencies.length > 10000) {
        this._allLatencies.shift();
      }
    }

    // Update agent stats
    const agent = this.agentStats.get(event.agentId) ?? {
      sent: 0,
      received: 0,
      failed: 0,
      latencies: [],
      lastActivity: 0,
    };

    if (event.eventType === 'sent') agent.sent++;
    if (event.eventType === 'received' || event.eventType === 'delivered') agent.received++;
    if (event.eventType === 'failed' || event.eventType === 'timeout') agent.failed++;
    if (event.latency !== undefined) {
      agent.latencies.push(event.latency);
      if (agent.latencies.length > 1000) agent.latencies.shift();
    }
    agent.lastActivity = event.timestamp;
    this.agentStats.set(event.agentId, agent);

    // Update topic stats
    const topic = this.topicStats.get(event.topic) ?? {
      count: 0,
      errors: 0,
      latencies: [],
      lastActivity: 0,
    };

    topic.count++;
    if (event.eventType === 'failed' || event.eventType === 'timeout') topic.errors++;
    if (event.latency !== undefined) {
      topic.latencies.push(event.latency);
      if (topic.latencies.length > 1000) topic.latencies.shift();
    }
    topic.lastActivity = event.timestamp;
    this.topicStats.set(event.topic, topic);
  }

  getMetrics(): CommunicationMetricsReport {
    const now = Date.now();
    const windowDuration = (now - this.windowStart) / 1000 || 1;

    // COMM-23: Use running counters for O(1) total counts
    const totalMessages = this._totalMessages;
    const totalErrors = this._totalErrors;
    const averageLatency = this._latencyCount > 0 ? this._totalLatency / this._latencyCount : 0;

    // Percentiles still need sorted array, but use the trimmed _allLatencies
    const sorted = [...this._allLatencies].sort((a, b) => a - b);

    return {
      totalMessages,
      messagesPerSecond: totalMessages / windowDuration,
      totalErrors,
      errorRate: totalMessages > 0 ? totalErrors / totalMessages : 0,
      averageLatency,
      p50Latency: this.percentile(sorted, 50),
      p95Latency: this.percentile(sorted, 95),
      p99Latency: this.percentile(sorted, 99),
      topTopics: this.getTopTopics(5),
      activeAgents: this.agentStats.size,
      windowStart: this.windowStart,
      windowEnd: now,
    };
  }

  getAgentMetrics(agentId: string): AgentCommunicationStats | undefined {
    const stats = this.agentStats.get(agentId);
    if (!stats) return undefined;

    return {
      agentId,
      messagesSent: stats.sent,
      messagesReceived: stats.received,
      messagesFailed: stats.failed,
      averageLatency:
        stats.latencies.length > 0
          ? stats.latencies.reduce((a, b) => a + b, 0) / stats.latencies.length
          : 0,
      lastActivity: stats.lastActivity,
    };
  }

  getTopicMetrics(topic: string): TopicStats | undefined {
    const stats = this.topicStats.get(topic);
    if (!stats) return undefined;

    return {
      topic,
      messageCount: stats.count,
      errorCount: stats.errors,
      averageLatency:
        stats.latencies.length > 0
          ? stats.latencies.reduce((a, b) => a + b, 0) / stats.latencies.length
          : 0,
      lastActivity: stats.lastActivity,
    };
  }

  getEventCount(): number {
    return this.events.length;
  }

  private percentile(sorted: number[], p: number): number {
    if (sorted.length === 0) return 0;
    const index = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)];
  }

  private getTopTopics(limit: number): TopicStats[] {
    return [...this.topicStats.entries()]
      .map(([topic, stats]) => ({
        topic,
        messageCount: stats.count,
        errorCount: stats.errors,
        averageLatency:
          stats.latencies.length > 0
            ? stats.latencies.reduce((a, b) => a + b, 0) / stats.latencies.length
            : 0,
        lastActivity: stats.lastActivity,
      }))
      .sort((a, b) => b.messageCount - a.messageCount)
      .slice(0, limit);
  }

  reset(): void {
    this.events = [];
    this.agentStats.clear();
    this.topicStats.clear();
    this.windowStart = Date.now();
    this._totalMessages = 0;
    this._totalErrors = 0;
    this._totalLatency = 0;
    this._latencyCount = 0;
    this._allLatencies = [];
  }
}
