// ============================================================================
// @claude-agent/observer - Observer Pattern
// ============================================================================

import type { LoggerInterface } from '@claude-agent/types';
import { Logger } from '@claude-agent/logger';

// ---- Observer Interface ----
export interface IObserver<T = unknown> {
  readonly id: string;
  update(data: T): void | Promise<void>;
}

// ---- Subject Interface ----
export interface ISubject<T = unknown> {
  attach(observer: IObserver<T>): () => void;
  detach(observerId: string): void;
  notify(data: T): void;
  getObserverCount(): number;
}

// ---- Basic Subject ----
export class Subject<T = unknown> implements ISubject<T> {
  private observers: Map<string, IObserver<T>> = new Map();
  private logger: LoggerInterface;

  constructor(logger?: LoggerInterface) {
    this.logger = logger ?? new Logger();
  }

  attach(observer: IObserver<T>): () => void {
    this.observers.set(observer.id, observer);
    this.logger.debug(`Observer attached: ${observer.id}`);
    return () => this.detach(observer.id);
  }

  detach(observerId: string): void {
    this.observers.delete(observerId);
    this.logger.debug(`Observer detached: ${observerId}`);
  }

  notify(data: T): void {
    for (const observer of this.observers.values()) {
      try {
        const result = observer.update(data);
        if (result instanceof Promise) {
          result.catch(err => this.logger.error('Observer error', { observerId: observer.id, error: String(err) }));
        }
      } catch (err) {
        this.logger.error('Observer error', { observerId: observer.id, error: String(err) });
      }
    }
  }

  getObserverCount(): number {
    return this.observers.size;
  }

  clear(): void {
    this.observers.clear();
  }
}

// ---- Pub/Sub Channel ----
export class PubSub {
  private channels: Map<string, Subject> = new Map();
  private logger: LoggerInterface;

  constructor(logger?: LoggerInterface) {
    this.logger = logger ?? new Logger();
  }

  subscribe<T>(channel: string, observer: IObserver<T>): () => void {
    if (!this.channels.has(channel)) {
      this.channels.set(channel, new Subject(this.logger));
    }
    return this.channels.get(channel)!.attach(observer);
  }

  unsubscribe(channel: string, observerId: string): void {
    this.channels.get(channel)?.detach(observerId);
  }

  publish<T>(channel: string, data: T): void {
    this.channels.get(channel)?.notify(data);
  }

  getChannelCount(): number {
    return this.channels.size;
  }

  getSubscriberCount(channel: string): number {
    return this.channels.get(channel)?.getObserverCount() ?? 0;
  }

  destroyChannel(channel: string): void {
    this.channels.get(channel)?.clear();
    this.channels.delete(channel);
  }

  clear(): void {
    for (const channel of this.channels.values()) channel.clear();
    this.channels.clear();
  }
}

// ---- Lifecycle Manager ----
export type LifecyclePhase = 'created' | 'initialized' | 'started' | 'stopped' | 'destroyed';

export class ObservableLifecycle {
  private phase: LifecyclePhase = 'created';
  private subject: Subject<LifecyclePhase>;
  private cleanupCallbacks: (() => void)[] = [];

  constructor(logger?: LoggerInterface) {
    this.subject = new Subject(logger);
  }

  getPhase(): LifecyclePhase {
    return this.phase;
  }

  onPhaseChange(observer: IObserver<LifecyclePhase>): () => void {
    return this.subject.attach(observer);
  }

  setPhase(phase: LifecyclePhase): void {
    this.phase = phase;
    this.subject.notify(phase);
  }

  onCleanup(callback: () => void): void {
    this.cleanupCallbacks.push(callback);
  }

  async cleanup(): Promise<void> {
    this.setPhase('destroyed');
    for (const cb of this.cleanupCallbacks) {
      try { cb(); } catch {}
    }
    this.cleanupCallbacks = [];
    this.subject.clear();
  }
}

// ---- Auto-Cleanup Observer ----
export class AutoCleanupObserver<T> implements IObserver<T> {
  readonly id: string;
  private handler: (data: T) => void | Promise<void>;
  private subject: ISubject<T> | null = null;
  private maxNotifications: number;
  private count: number = 0;
  private ttl: number;
  private createdAt: number;

  constructor(
    id: string,
    handler: (data: T) => void | Promise<void>,
    options?: { maxNotifications?: number; ttlMs?: number },
  ) {
    this.id = id;
    this.handler = handler;
    this.maxNotifications = options?.maxNotifications ?? Infinity;
    this.ttl = options?.ttlMs ?? Infinity;
    this.createdAt = Date.now();
  }

  bind(subject: ISubject<T>): () => void {
    this.subject = subject;
    return subject.attach(this);
  }

  update(data: T): void | Promise<void> {
    this.count++;
    if (this.count >= this.maxNotifications || Date.now() - this.createdAt > this.ttl) {
      this.dispose();
      return;
    }
    return this.handler(data);
  }

  dispose(): void {
    if (this.subject) {
      this.subject.detach(this.id);
      this.subject = null;
    }
  }

  get isDisposed(): boolean {
    return this.subject === null;
  }
}

// ---- Observer Factory ----
let observerCounter = 0;
export function createObserver<T>(handler: (data: T) => void | Promise<void>, options?: { maxNotifications?: number; ttlMs?: number }): AutoCleanupObserver<T> {
  observerCounter++;
  return new AutoCleanupObserver(
    `obs-${observerCounter.toString(36).padStart(4, '0')}`,
    handler,
    options,
  );
}
