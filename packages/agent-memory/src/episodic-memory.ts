/**
 * EpisodicMemory - Store and retrieve past experiences/episodes.
 */

export interface Episode {
  id: string;
  context: string;
  actions: string[];
  outcome: string;
  emotion: 'positive' | 'negative' | 'neutral' | 'surprise' | 'frustration' | 'satisfaction';
  timestamp: number;
  importance: number;
  tags: string[];
  lessons: string[];
}

export interface RecallOptions {
  limit?: number;
  minImportance?: number;
  emotions?: Episode['emotion'][];
  tags?: string[];
  startTime?: number;
  endTime?: number;
}

export class EpisodicMemory {
  private episodes: Map<string, Episode> = new Map();
  private idCounter: number = 0;

  record(episode: Omit<Episode, 'id' | 'timestamp'>): Episode {
    const id = `ep-${++this.idCounter}`;
    const full: Episode = {
      ...episode,
      id,
      timestamp: Date.now(),
      tags: episode.tags ?? [],
      lessons: episode.lessons ?? [],
    };
    this.episodes.set(id, full);
    return full;
  }

  recall(query: string, options: RecallOptions = {}): Episode[] {
    const lowerQuery = query.toLowerCase();
    let results = Array.from(this.episodes.values()).filter((ep) => {
      const matchesQuery =
        ep.context.toLowerCase().includes(lowerQuery) ||
        ep.outcome.toLowerCase().includes(lowerQuery) ||
        ep.actions.some((a) => a.toLowerCase().includes(lowerQuery)) ||
        ep.lessons.some((l) => l.toLowerCase().includes(lowerQuery));
      const matchesImportance =
        options.minImportance === undefined || ep.importance >= options.minImportance;
      const matchesEmotions =
        options.emotions === undefined ||
        options.emotions.length === 0 ||
        options.emotions.includes(ep.emotion);
      const matchesTags =
        options.tags === undefined ||
        options.tags.length === 0 ||
        options.tags.some((t) => ep.tags.includes(t));
      const matchesTime =
        (options.startTime === undefined || ep.timestamp >= options.startTime) &&
        (options.endTime === undefined || ep.timestamp <= options.endTime);
      return matchesQuery && matchesImportance && matchesEmotions && matchesTags && matchesTime;
    });
    // Sort by relevance (importance + query match count)
    results.sort((a, b) => b.importance - a.importance);
    if (options.limit !== undefined && options.limit > 0) {
      results = results.slice(0, options.limit);
    }
    return results;
  }

  forget(episodeId: string): boolean {
    return this.episodes.delete(episodeId);
  }

  getTimeline(): Episode[] {
    return Array.from(this.episodes.values()).sort((a, b) => a.timestamp - b.timestamp);
  }

  getByEmotion(emotion: Episode['emotion']): Episode[] {
    return Array.from(this.episodes.values())
      .filter((ep) => ep.emotion === emotion)
      .sort((a, b) => b.timestamp - a.timestamp);
  }

  getByContext(context: string): Episode[] {
    const lowerCtx = context.toLowerCase();
    return Array.from(this.episodes.values())
      .filter((ep) => ep.context.toLowerCase().includes(lowerCtx))
      .sort((a, b) => b.importance - a.importance);
  }

  summarize(period: { start: number; end: number }): string {
    const eps = Array.from(this.episodes.values()).filter(
      (ep) => ep.timestamp >= period.start && ep.timestamp <= period.end
    );
    if (eps.length === 0) return 'No episodes in the specified period.';
    const positive = eps.filter((e) => e.emotion === 'positive' || e.emotion === 'satisfaction').length;
    const negative = eps.filter((e) => e.emotion === 'negative' || e.emotion === 'frustration').length;
    const lessons = eps.flatMap((e) => e.lessons);
    return `Period summary: ${eps.length} episodes (${positive} positive, ${negative} negative). Key lessons: ${lessons.length > 0 ? lessons.slice(0, 3).join('; ') : 'none extracted'}.`;
  }

  extractLessons(): string[] {
    const allLessons = new Set<string>();
    for (const ep of this.episodes.values()) {
      for (const lesson of ep.lessons) {
        allLessons.add(lesson);
      }
    }
    return Array.from(allLessons);
  }

  getAll(): Episode[] {
    return Array.from(this.episodes.values());
  }

  getStats(): { episodeCount: number; emotionDistribution: Record<string, number>; averageImportance: number } {
    const all = this.getAll();
    const dist: Record<string, number> = {};
    let totalImportance = 0;
    for (const ep of all) {
      dist[ep.emotion] = (dist[ep.emotion] ?? 0) + 1;
      totalImportance += ep.importance;
    }
    return {
      episodeCount: all.length,
      emotionDistribution: dist,
      averageImportance: all.length > 0 ? totalImportance / all.length : 0,
    };
  }
}
