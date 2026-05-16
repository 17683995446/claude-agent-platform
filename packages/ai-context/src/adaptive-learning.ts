// ============================================================
// Module 10: Adaptive Learning System
// User preferences, pattern recognition, feedback incorporation
// ============================================================

export interface UserInteraction {
  type: 'code_request' | 'correction' | 'approval' | 'rejection' | 'question' | 'exploration';
  input: string;
  output?: string;
  timestamp: number;
  context?: Record<string, unknown>;
  satisfaction?: number; // 0-1
}

export interface PredictionResult {
  intent: string;
  confidence: number;
  suggestedCompletion: string;
}

export interface ApproachSuggestion {
  name: string;
  description: string;
  confidence: number;
  reasoning: string;
}

export interface LearnedPattern {
  id: string;
  pattern: string;
  frequency: number;
  lastSeen: number;
  context: string;
  successRate: number;
}

let patternIdCounter = 0;
function newPatternId(): string {
  return `pattern_${++patternIdCounter}_${Date.now()}`;
}

export class AdaptiveLearningSystem {
  private interactions: UserInteraction[] = [];
  private preferences: Map<string, string> = new Map();
  private patterns: Map<string, LearnedPattern> = new Map();
  private approachSuccess: Map<string, { attempts: number; successes: number }> = new Map();
  private maxInteractions: number;

  constructor(maxInteractions: number = 1000) {
    this.maxInteractions = maxInteractions;
  }

  recordInteraction(interaction: UserInteraction): void {
    this.interactions.push(interaction);

    // Trim old interactions
    if (this.interactions.length > this.maxInteractions) {
      this.interactions.shift();
    }

    // Learn from the interaction
    this.learnPreferences(interaction);
    this.learnPatterns(interaction);
    this.learnApproachSuccess(interaction);
  }

  predictIntent(partialInput: string): PredictionResult[] {
    const predictions: PredictionResult[] = [];
    const normalizedInput = partialInput.toLowerCase().trim();

    // Find similar past interactions
    for (const interaction of this.interactions) {
      const similarity = this.computeSimilarity(normalizedInput, interaction.input.toLowerCase());
      if (similarity > 0.3) {
        predictions.push({
          intent: interaction.type,
          confidence: similarity,
          suggestedCompletion: interaction.output || '',
        });
      }
    }

    // Sort by confidence
    predictions.sort((a, b) => b.confidence - a.confidence);

    return predictions.slice(0, 5);
  }

  suggestApproach(task: string): ApproachSuggestion[] {
    const suggestions: ApproachSuggestion[] = [];
    const normalizedTask = task.toLowerCase();

    // Check learned patterns for matching approaches
    for (const [, pattern] of this.patterns) {
      const similarity = this.computeSimilarity(normalizedTask, pattern.pattern.toLowerCase());
      if (similarity > 0.2 && pattern.successRate > 0.5) {
        suggestions.push({
          name: pattern.context,
          description: `Pattern seen ${pattern.frequency} times with ${Math.round(pattern.successRate * 100)}% success`,
          confidence: similarity * pattern.successRate,
          reasoning: `This approach has worked well for similar tasks in the past`,
        });
      }
    }

    // Check approach success history
    for (const [approach, stats] of this.approachSuccess) {
      if (stats.successes > 0) {
        const successRate = stats.successes / stats.attempts;
        if (successRate > 0.6) {
          suggestions.push({
            name: approach,
            description: `Used ${stats.attempts} times, ${stats.successes} successful`,
            confidence: successRate * 0.8,
            reasoning: 'High historical success rate for this approach',
          });
        }
      }
    }

    // Sort by confidence
    suggestions.sort((a, b) => b.confidence - a.confidence);

    return suggestions.slice(0, 5);
  }

  getLearnedPatterns(): LearnedPattern[] {
    return Array.from(this.patterns.values()).sort((a, b) => b.frequency - a.frequency);
  }

  getPreference(key: string): string | undefined {
    return this.preferences.get(key);
  }

  getAllPreferences(): Map<string, string> {
    return new Map(this.preferences);
  }

  getInteractionCount(): number {
    return this.interactions.length;
  }

  exportModel(format: 'json'): string {
    const model = {
      preferences: Object.fromEntries(this.preferences),
      patterns: Array.from(this.patterns.values()),
      approachSuccess: Object.fromEntries(
        Array.from(this.approachSuccess.entries()).map(([k, v]) => [k, v])
      ),
      interactionCount: this.interactions.length,
      exportedAt: Date.now(),
    };
    return JSON.stringify(model, null, 2);
  }

  importModel(data: string): void {
    try {
      const model = JSON.parse(data);

      if (model.preferences) {
        for (const [key, value] of Object.entries(model.preferences)) {
          this.preferences.set(key, value as string);
        }
      }

      if (model.patterns) {
        for (const pattern of model.patterns as LearnedPattern[]) {
          this.patterns.set(pattern.pattern, pattern);
        }
      }

      if (model.approachSuccess) {
        for (const [key, value] of Object.entries(model.approachSuccess)) {
          this.approachSuccess.set(key, value as { attempts: number; successes: number });
        }
      }
    } catch {
      throw new Error('Invalid model data format');
    }
  }

  clear(): void {
    this.interactions = [];
    this.preferences.clear();
    this.patterns.clear();
    this.approachSuccess.clear();
  }

  private learnPreferences(interaction: UserInteraction): void {
    // Detect coding style preferences
    const input = interaction.input;

    // Quote style
    const singleQuotes = (input.match(/'/g) || []).length;
    const doubleQuotes = (input.match(/"/g) || []).length;
    if (singleQuotes > doubleQuotes * 2) {
      this.preferences.set('quoteStyle', 'single');
    } else if (doubleQuotes > singleQuotes * 2) {
      this.preferences.set('quoteStyle', 'double');
    }

    // Semicolon preference
    if (input.includes(';') && !input.includes('}')) {
      this.preferences.set('semicolons', 'yes');
    }

    // Framework preference
    const frameworks = ['react', 'vue', 'angular', 'svelte', 'next', 'nuxt', 'express', 'fastify'];
    for (const fw of frameworks) {
      if (input.toLowerCase().includes(fw)) {
        this.preferences.set('framework', fw);
      }
    }

    // Language preference
    const languages = ['typescript', 'javascript', 'python', 'rust', 'go', 'java'];
    for (const lang of languages) {
      if (input.toLowerCase().includes(lang)) {
        this.preferences.set('language', lang);
      }
    }

    // Satisfaction-based learning
    if (interaction.satisfaction !== undefined) {
      if (interaction.satisfaction > 0.8 && interaction.output) {
        this.preferences.set('preferredStyle', interaction.output.slice(0, 100));
      }
    }
  }

  private learnPatterns(interaction: UserInteraction): void {
    // Extract common patterns from input
    const words = interaction.input.split(/\s+/).filter(w => w.length > 3);
    const keyPhrase = words.slice(0, 3).join(' ');

    if (!keyPhrase) return;

    const existing = this.patterns.get(keyPhrase);
    if (existing) {
      existing.frequency++;
      existing.lastSeen = Date.now();
      if (interaction.satisfaction !== undefined) {
        existing.successRate = existing.successRate * 0.8 + interaction.satisfaction * 0.2;
      }
    } else {
      this.patterns.set(keyPhrase, {
        id: newPatternId(),
        pattern: keyPhrase,
        frequency: 1,
        lastSeen: Date.now(),
        context: interaction.type,
        successRate: interaction.satisfaction ?? 0.5,
      });
    }
  }

  private learnApproachSuccess(interaction: UserInteraction): void {
    if (!interaction.context?.approach) return;

    const approach = String(interaction.context.approach);
    const existing = this.approachSuccess.get(approach);

    if (existing) {
      existing.attempts++;
      if (interaction.satisfaction !== undefined && interaction.satisfaction > 0.7) {
        existing.successes++;
      }
    } else {
      this.approachSuccess.set(approach, {
        attempts: 1,
        successes: interaction.satisfaction !== undefined && interaction.satisfaction > 0.7 ? 1 : 0,
      });
    }
  }

  private computeSimilarity(a: string, b: string): number {
    const wordsA = new Set(a.split(/\s+/));
    const wordsB = new Set(b.split(/\s+/));
    let intersection = 0;
    for (const word of wordsA) {
      if (wordsB.has(word)) intersection++;
    }
    const union = new Set([...wordsA, ...wordsB]).size;
    return union > 0 ? intersection / union : 0;
  }
}
