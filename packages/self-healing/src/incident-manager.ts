// src/incident-manager.ts - Incident Manager Module

export type IncidentSeverity = 'P1' | 'P2' | 'P3' | 'P4';
export type IncidentStatus = 'detected' | 'investigating' | 'mitigating' | 'resolving' | 'resolved' | 'post-mortem';

export interface Incident {
  id?: string;
  title: string;
  description: string;
  severity: IncidentSeverity;
  status: IncidentStatus;
  componentId?: string;
  detectedAt: number;
  assignedTo?: string;
  tags?: string[];
  relatedIncidentIds?: string[];
}

export interface IncidentUpdate {
  status?: IncidentStatus;
  assignedTo?: string;
  description?: string;
  tags?: string[];
}

export interface TimelineEvent {
  id: string;
  incidentId: string;
  type: 'status_change' | 'assignment' | 'note' | 'escalation' | 'resolution';
  description: string;
  timestamp: number;
  author?: string;
}

export interface PostMortem {
  incidentId: string;
  title: string;
  summary: string;
  timeline: TimelineEvent[];
  rootCause: string;
  impact: string;
  resolution: string;
  lessonsLearned: string[];
  actionItems: string[];
  createdAt: number;
}

export interface SLAConfig {
  P1: number; // minutes
  P2: number;
  P3: number;
  P4: number;
}

interface IncidentRecord {
  incident: Incident;
  timeline: TimelineEvent[];
  createdAt: number;
  updatedAt: number;
}

export class IncidentManager {
  private incidents = new Map<string, IncidentRecord>();
  private incidentIdCounter = 0;
  private timelineIdCounter = 0;
  private slaConfig: SLAConfig;
  private escalationCheckInterval: ReturnType<typeof setInterval> | null = null;

  constructor(slaConfig?: Partial<SLAConfig>) {
    this.slaConfig = {
      P1: 15,  // 15 minutes
      P2: 60,  // 1 hour
      P3: 240, // 4 hours
      P4: 1440, // 24 hours
      ...slaConfig,
    };
  }

  createIncident(incident: Incident): string {
    const id = `inc-${++this.incidentIdCounter}`;
    const fullIncident: Incident = {
      ...incident,
      id,
      detectedAt: incident.detectedAt || Date.now(),
      status: incident.status || 'detected',
    };

    const record: IncidentRecord = {
      incident: fullIncident,
      timeline: [{
        id: `tl-${++this.timelineIdCounter}`,
        incidentId: id,
        type: 'status_change',
        description: `Incident created: ${fullIncident.title}`,
        timestamp: Date.now(),
      }],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    this.incidents.set(id, record);
    return id;
  }

  updateIncident(incidentId: string, update: IncidentUpdate): void {
    const record = this.incidents.get(incidentId);
    if (!record) return;

    if (update.status && update.status !== record.incident.status) {
      record.timeline.push({
        id: `tl-${++this.timelineIdCounter}`,
        incidentId,
        type: 'status_change',
        description: `Status changed from ${record.incident.status} to ${update.status}`,
        timestamp: Date.now(),
      });
      record.incident.status = update.status;
    }

    if (update.assignedTo && update.assignedTo !== record.incident.assignedTo) {
      record.timeline.push({
        id: `tl-${++this.timelineIdCounter}`,
        incidentId,
        type: 'assignment',
        description: `Assigned to ${update.assignedTo}`,
        timestamp: Date.now(),
      });
      record.incident.assignedTo = update.assignedTo;
    }

    if (update.description) {
      record.incident.description = update.description;
    }

    if (update.tags) {
      record.incident.tags = update.tags;
    }

    record.updatedAt = Date.now();
  }

  resolveIncident(incidentId: string, resolution: string): void {
    const record = this.incidents.get(incidentId);
    if (!record) return;

    record.incident.status = 'resolved';
    record.timeline.push({
      id: `tl-${++this.timelineIdCounter}`,
      incidentId,
      type: 'resolution',
      description: `Incident resolved: ${resolution}`,
      timestamp: Date.now(),
    });
    record.updatedAt = Date.now();
  }

  escalateIncident(incidentId: string, reason: string): void {
    const record = this.incidents.get(incidentId);
    if (!record) return;

    // Increase severity
    const severityOrder: IncidentSeverity[] = ['P4', 'P3', 'P2', 'P1'];
    const currentIndex = severityOrder.indexOf(record.incident.severity);
    if (currentIndex < severityOrder.length - 1) {
      record.incident.severity = severityOrder[currentIndex + 1]!;
    }

    record.timeline.push({
      id: `tl-${++this.timelineIdCounter}`,
      incidentId,
      type: 'escalation',
      description: `Escalated to ${record.incident.severity}: ${reason}`,
      timestamp: Date.now(),
    });
    record.updatedAt = Date.now();
  }

  getActiveIncidents(): Incident[] {
    const active: Incident[] = [];
    for (const record of this.incidents.values()) {
      if (record.incident.status !== 'resolved' && record.incident.status !== 'post-mortem') {
        active.push(record.incident);
      }
    }
    return active.sort((a, b) => {
      const severityOrder: Record<string, number> = { P1: 0, P2: 1, P3: 2, P4: 3 };
      return severityOrder[a.severity]! - severityOrder[b.severity]!;
    });
  }

  getIncidentTimeline(incidentId: string): TimelineEvent[] {
    return this.incidents.get(incidentId)?.timeline ?? [];
  }

  generatePostMortem(incidentId: string): PostMortem {
    const record = this.incidents.get(incidentId);
    if (!record) {
      return {
        incidentId,
        title: 'Unknown Incident',
        summary: 'Incident not found',
        timeline: [],
        rootCause: 'Unknown',
        impact: 'Unknown',
        resolution: 'Unknown',
        lessonsLearned: [],
        actionItems: [],
        createdAt: Date.now(),
      };
    }

    const incident = record.incident;
    const resolutionEvent = record.timeline.find((t) => t.type === 'resolution');
    const escalationEvents = record.timeline.filter((t) => t.type === 'escalation');

    record.incident.status = 'post-mortem';

    return {
      incidentId,
      title: incident.title,
      summary: incident.description,
      timeline: record.timeline,
      rootCause: `Root cause analysis for ${incident.severity} incident`,
      impact: `Severity ${incident.severity} incident affecting ${incident.componentId ?? 'unknown component'}`,
      resolution: resolutionEvent?.description ?? 'No resolution recorded',
      lessonsLearned: escalationEvents.length > 0
        ? [`Incident was escalated ${escalationEvents.length} time(s) - review escalation triggers`]
        : ['Incident was resolved without escalation'],
      actionItems: [
        'Review monitoring and alerting configuration',
        'Update runbook for similar incidents',
        'Consider adding automated remediation',
      ],
      createdAt: Date.now(),
    };
  }

  getIncident(incidentId: string): Incident | null {
    return this.incidents.get(incidentId)?.incident ?? null;
  }

  getAllIncidents(): Incident[] {
    return [...this.incidents.values()].map((r) => r.incident);
  }

  correlateIncidents(incidentId: string): Incident[] {
    const record = this.incidents.get(incidentId);
    if (!record) return [];

    const related: Incident[] = [];
    const incident = record.incident;

    for (const [, otherRecord] of this.incidents) {
      if (otherRecord.incident.id === incidentId) continue;
      const other = otherRecord.incident;

      // Correlate by component
      if (incident.componentId && other.componentId && incident.componentId === other.componentId) {
        related.push(other);
        continue;
      }

      // Correlate by tags
      if (incident.tags && other.tags) {
        const commonTags = incident.tags.filter((t) => other.tags!.includes(t));
        if (commonTags.length > 0) {
          related.push(other);
        }
      }
    }

    return related;
  }

  checkSLACompliance(): { incidentId: string; severity: IncidentSeverity; breached: boolean; remainingMinutes: number }[] {
    const results: { incidentId: string; severity: IncidentSeverity; breached: boolean; remainingMinutes: number }[] = [];
    const now = Date.now();

    for (const [id, record] of this.incidents) {
      if (record.incident.status === 'resolved' || record.incident.status === 'post-mortem') continue;

      const slaMinutes = this.slaConfig[record.incident.severity];
      const elapsedMinutes = (now - record.incident.detectedAt) / 60000;
      const remaining = slaMinutes - elapsedMinutes;
      const breached = remaining < 0;

      results.push({
        incidentId: id,
        severity: record.incident.severity,
        breached,
        remainingMinutes: Math.round(remaining),
      });
    }

    return results;
  }

  startAutoEscalation(checkIntervalMs = 60000): void {
    if (this.escalationCheckInterval) return;

    this.escalationCheckInterval = setInterval(() => {
      const slaResults = this.checkSLACompliance();
      for (const result of slaResults) {
        if (result.breached) {
          this.escalateIncident(result.incidentId, `SLA breached for ${result.severity} incident`);
        }
      }
    }, checkIntervalMs);
  }

  stopAutoEscalation(): void {
    if (this.escalationCheckInterval) {
      clearInterval(this.escalationCheckInterval);
      this.escalationCheckInterval = null;
    }
  }

  getIncidentCount(): number {
    return this.incidents.size;
  }
}
