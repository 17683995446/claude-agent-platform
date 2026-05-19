// ============================================================================
// FeedbackLoop - Execution Feedback and Retry System
// ============================================================================

import type { FeedbackResult, RetryConfig } from './types.js';

// ---- Default retry configuration ----

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelay: 1000,
  maxDelay: 30000,
  backoffMultiplier: 2,
  jitter: true,
};

// ---- FeedbackLoop Class ----

export class FeedbackLoop {
  private retryConfig: RetryConfig;
  private feedbackHistory: Map<string, FeedbackResult[]> = new Map();
  private userPreferences: Map<string, number> = new Map();
  private onFeedback?: (result: FeedbackResult) => void;

  constructor(config?: Partial<RetryConfig>) {
    this.retryConfig = { ...DEFAULT_RETRY_CONFIG, ...config };
  }

  /** Get retry configuration */
  getRetryConfig(): RetryConfig {
    return { ...this.retryConfig };
  }

  /** Update retry configuration */
  updateRetryConfig(config: Partial<RetryConfig>): void {
    this.retryConfig = { ...this.retryConfig, ...config };
  }

  /** Set feedback callback */
  setOnFeedback(callback: (result: FeedbackResult) => void): void {
    this.onFeedback = callback;
  }

  /** Evaluate a task execution result */
  evaluate(
    taskId: string,
    success: boolean,
    message: string,
    duration?: number,
  ): FeedbackResult {
    const history = this.feedbackHistory.get(taskId) ?? [];
    const score = this.calculateScore(success, duration, history.length);

    const result: FeedbackResult = {
      taskId,
      success,
      score,
      message,
      shouldRetry: !success && history.length < this.retryConfig.maxRetries,
      retryCount: history.length + 1,
      maxRetries: this.retryConfig.maxRetries,
      nextRetryDelay: success ? 0 : this.calculateRetryDelay(history.length),
    };

    history.push(result);
    this.feedbackHistory.set(taskId, history);

    this.onFeedback?.(result);
    return result;
  }

  /** Submit user feedback for a task */
  submitUserFeedback(taskId: string, feedback: string): void {
    const history = this.feedbackHistory.get(taskId);
    if (history && history.length > 0) {
      const lastResult = history[history.length - 1]!;
      lastResult.userFeedback = feedback;

      // Learn from user feedback
      if (feedback.includes('好') || feedback.includes('good') || feedback.includes('ok')) {
        this.userPreferences.set(taskId, (this.userPreferences.get(taskId) ?? 0) + 1);
      } else if (feedback.includes('差') || feedback.includes('bad') || feedback.includes('不好')) {
        this.userPreferences.set(taskId, (this.userPreferences.get(taskId) ?? 0) - 1);
      }
    }
  }

  /** Calculate score based on execution result */
  private calculateScore(success: boolean, duration?: number, attemptCount: number): number {
    if (!success) return 0;

    let score = 100;

    // Penalize long durations
    if (duration !== undefined) {
      if (duration > 30000) score -= 20;
      else if (duration > 10000) score -= 10;
      else if (duration > 5000) score -= 5;
    }

    // Penalize retries
    score -= attemptCount * 15;

    return Math.max(0, score);
  }

  /** Calculate retry delay with exponential backoff */
  private calculateRetryDelay(retryCount: number): number {
    const delay = Math.min(
      this.retryConfig.baseDelay * Math.pow(this.retryConfig.backoffMultiplier, retryCount),
      this.retryConfig.maxDelay,
    );

    if (this.retryConfig.jitter) {
      const jitter = delay * 0.2 * (Math.random() - 0.5);
      return Math.floor(delay + jitter);
    }

    return delay;
  }

  /** Get feedback history for a task */
  getHistory(taskId: string): FeedbackResult[] {
    return [...(this.feedbackHistory.get(taskId) ?? [])];
  }

  /** Get all feedback history */
  getAllHistory(): Map<string, FeedbackResult[]> {
    return new Map(this.feedbackHistory);
  }

  /** Get user preference score for a task */
  getUserPreference(taskId: string): number {
    return this.userPreferences.get(taskId) ?? 0;
  }

  /** Get success rate across all tasks */
  getSuccessRate(): number {
    let total = 0;
    let successes = 0;

    for (const history of this.feedbackHistory.values()) {
      for (const result of history) {
        total++;
        if (result.success) successes++;
      }
    }

    return total === 0 ? 0 : successes / total;
  }

  /** Clear all feedback history */
  clear(): void {
    this.feedbackHistory.clear();
    this.userPreferences.clear();
  }
}
