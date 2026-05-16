// src/webhook-manager.ts - Webhook Manager Module

import { createHmac, timingSafeEqual } from 'node:crypto';

export interface WebhookConfig {
  id?: string;
  url: string;
  secret: string;
  events: string[];
  headers?: Record<string, string>;
  enabled?: boolean;
  description?: string;
  retryCount?: number;
  retryDelayMs?: number;
}

export interface DeliveryResult {
  webhookId: string;
  url: string;
  event: string;
  success: boolean;
  statusCode?: number;
  timestamp: number;
  attempt: number;
  error?: string;
  duration?: number;
}

export interface DeliveryStatus {
  webhookId: string;
  url: string;
  event: string;
  success: boolean;
  attempts: DeliveryResult[];
  lastAttempt?: number;
  completed: boolean;
}

export class WebhookManager {
  private webhooks: Map<string, WebhookConfig> = new Map();
  private deliveries: Map<string, DeliveryStatus> = new Map();
  private webhookCounter = 0;
  private deliveryCounter = 0;

  register(webhook: WebhookConfig): string {
    const id = webhook.id || `wh_${++this.webhookCounter}`;
    this.webhooks.set(id, {
      ...webhook,
      id,
      enabled: webhook.enabled ?? true,
      retryCount: webhook.retryCount ?? 3,
      retryDelayMs: webhook.retryDelayMs ?? 1000,
    });
    return id;
  }

  unregister(webhookId: string): void {
    this.webhooks.delete(webhookId);
  }

  async trigger(event: string, payload: unknown): Promise<DeliveryResult[]> {
    const results: DeliveryResult[] = [];
    const matchedWebhooks = this.getMatchingWebhooks(event);

    for (const [id, config] of matchedWebhooks) {
      const result = await this.deliver(id, config, event, payload);
      results.push(result);
    }

    return results;
  }

  getDeliveryStatus(webhookId: string): DeliveryStatus[] {
    const statuses: DeliveryStatus[] = [];
    for (const [, status] of this.deliveries) {
      if (status.webhookId === webhookId) {
        statuses.push(status);
      }
    }
    return statuses;
  }

  verifySignature(payload: string, signature: string, secret: string): boolean {
    const expected = this.signPayload(payload, secret);
    try {
      return timingSafeEqual(
        Buffer.from(signature, 'hex'),
        Buffer.from(expected, 'hex')
      );
    } catch {
      return false;
    }
  }

  getWebhook(webhookId: string): WebhookConfig | undefined {
    return this.webhooks.get(webhookId);
  }

  getWebhooks(): WebhookConfig[] {
    return Array.from(this.webhooks.values());
  }

  clear(): void {
    this.webhooks.clear();
    this.deliveries.clear();
  }

  private getMatchingWebhooks(event: string): Map<string, WebhookConfig> {
    const matched = new Map<string, WebhookConfig>();
    for (const [id, config] of this.webhooks) {
      if (config.enabled && config.events.includes(event)) {
        matched.set(id, config);
      }
    }
    return matched;
  }

  private async deliver(
    webhookId: string,
    config: WebhookConfig,
    event: string,
    payload: unknown
  ): Promise<DeliveryResult> {
    const deliveryId = `del_${++this.deliveryCounter}`;
    const payloadStr = JSON.stringify(payload);
    const signature = this.signPayload(payloadStr, config.secret);
    const maxRetries = config.retryCount ?? 3;
    const baseDelay = config.retryDelayMs ?? 1000;

    const status: DeliveryStatus = {
      webhookId,
      url: config.url,
      event,
      success: false,
      attempts: [],
      completed: false,
    };
    this.deliveries.set(deliveryId, status);

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const start = Date.now();
      try {
        // Simulate HTTP delivery
        const success = await this.simulateDelivery(config.url, payloadStr, signature, config.headers);
        const result: DeliveryResult = {
          webhookId,
          url: config.url,
          event,
          success,
          statusCode: success ? 200 : 500,
          timestamp: Date.now(),
          attempt,
          duration: Date.now() - start,
        };
        status.attempts.push(result);
        status.success = success;
        status.lastAttempt = Date.now();

        if (success) {
          status.completed = true;
          return result;
        }

        // Exponential backoff
        if (attempt < maxRetries) {
          await this.sleep(baseDelay * Math.pow(2, attempt - 1));
        }
      } catch (err) {
        const result: DeliveryResult = {
          webhookId,
          url: config.url,
          event,
          success: false,
          timestamp: Date.now(),
          attempt,
          error: err instanceof Error ? err.message : String(err),
          duration: Date.now() - start,
        };
        status.attempts.push(result);
        status.lastAttempt = Date.now();

        if (attempt < maxRetries) {
          await this.sleep(baseDelay * Math.pow(2, attempt - 1));
        }
      }
    }

    status.completed = true;
    return status.attempts[status.attempts.length - 1];
  }

  private signPayload(payload: string, secret: string): string {
    return createHmac('sha256', secret).update(payload).digest('hex');
  }

  private async simulateDelivery(
    url: string,
    _payload: string,
    _signature: string,
    _headers?: Record<string, string>
  ): Promise<boolean> {
    // Simulate delivery - always succeed for testing
    // In production, this would use fetch/HTTP client
    return url.startsWith('http');
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
