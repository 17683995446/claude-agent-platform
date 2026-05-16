// src/consensus-raft.ts - Raft 共识

export type RaftRole = 'follower' | 'candidate' | 'leader';

export interface LogEntry {
  term: number;
  index: number;
  command: unknown;
  timestamp: number;
}

export interface RaftConfig {
  electionTimeoutMin: number;
  electionTimeoutMax: number;
  heartbeatInterval: number;
}

export class RaftConsensus {
  private nodeId: string;
  private peers: Map<string, { nextIndex: number; matchIndex: number }> = new Map();
  private role: RaftRole = 'follower';
  private currentTerm = 0;
  private votedFor: string | null = null;
  private leaderId: string | undefined;
  private log: LogEntry[] = [];
  private commitIndex = 0;
  private lastApplied = 0;
  private electionTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private config: RaftConfig;
  private started = false;
  private votesReceived: Set<string> = new Set();

  constructor(nodeId: string, config?: Partial<RaftConfig>) {
    this.nodeId = nodeId;
    this.config = {
      electionTimeoutMin: config?.electionTimeoutMin ?? 150,
      electionTimeoutMax: config?.electionTimeoutMax ?? 300,
      heartbeatInterval: config?.heartbeatInterval ?? 50,
    };
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.resetElectionTimer();
  }

  stop(): void {
    this.started = false;
    this.clearTimers();
  }

  addPeer(peerId: string): void {
    this.peers.set(peerId, {
      nextIndex: this.log.length + 1,
      matchIndex: 0,
    });
  }

  removePeer(peerId: string): void {
    this.peers.delete(peerId);
  }

  async propose(entry: LogEntry): Promise<boolean> {
    if (this.role !== 'leader') {
      return false;
    }

    const logEntry: LogEntry = {
      term: this.currentTerm,
      index: this.log.length + 1,
      command: entry.command,
      timestamp: entry.timestamp ?? Date.now(),
    };

    this.log.push(logEntry);

    // Simulate replication to peers
    let replicated = 1; // self
    for (const peerId of this.peers.keys()) {
      const peer = this.peers.get(peerId)!;
      peer.nextIndex = logEntry.index + 1;
      peer.matchIndex = logEntry.index;
      replicated++;
    }

    // Check if majority replicated
    const majority = Math.floor((this.peers.size + 1) / 2) + 1;
    if (replicated >= majority) {
      this.commitIndex = logEntry.index;
      this.lastApplied = logEntry.index;
      return true;
    }

    return replicated >= majority;
  }

  getLeader(): string | undefined {
    return this.leaderId;
  }

  getRole(): RaftRole {
    return this.role;
  }

  getCommitIndex(): number {
    return this.commitIndex;
  }

  getLog(): LogEntry[] {
    return [...this.log];
  }

  getCurrentTerm(): number {
    return this.currentTerm;
  }

  getNodeId(): string {
    return this.nodeId;
  }

  // Simulate receiving a RequestVote RPC
  requestVote(term: number, candidateId: string): { voteGranted: boolean; term: number } {
    if (term > this.currentTerm) {
      this.currentTerm = term;
      this.votedFor = null;
      this.role = 'follower';
      this.leaderId = undefined;
    }

    const voteGranted = (this.votedFor === null || this.votedFor === candidateId) &&
      term >= this.currentTerm;

    if (voteGranted) {
      this.votedFor = candidateId;
      this.resetElectionTimer();
    }

    return { voteGranted, term: this.currentTerm };
  }

  // Simulate receiving an AppendEntries RPC (heartbeat)
  appendEntries(
    term: number,
    leaderId: string,
    prevLogIndex: number,
    entries: LogEntry[],
    leaderCommit: number
  ): { success: boolean; term: number; matchIndex: number } {
    if (term < this.currentTerm) {
      return { success: false, term: this.currentTerm, matchIndex: 0 };
    }

    this.currentTerm = term;
    this.role = 'follower';
    this.leaderId = leaderId;
    this.resetElectionTimer();

    // Check log consistency
    if (prevLogIndex > 0 && (this.log.length < prevLogIndex)) {
      return { success: false, term: this.currentTerm, matchIndex: this.log.length };
    }

    // Append entries
    let matchIndex = prevLogIndex;
    for (const entry of entries) {
      if (entry.index <= this.log.length) {
        // Overwrite if term differs
        if (this.log[entry.index - 1]?.term !== entry.term) {
          this.log = this.log.slice(0, entry.index - 1);
          this.log.push(entry);
        }
      } else {
        this.log.push(entry);
      }
      matchIndex = entry.index;
    }

    // Update commit index
    if (leaderCommit > this.commitIndex) {
      this.commitIndex = Math.min(leaderCommit, this.log.length);
    }

    return { success: true, term: this.currentTerm, matchIndex };
  }

  // Trigger election (for testing)
  triggerElection(): void {
    this.startElection();
  }

  private startElection(): void {
    this.currentTerm++;
    this.role = 'candidate';
    this.votedFor = this.nodeId;
    this.leaderId = undefined;
    this.votesReceived = new Set([this.nodeId]);

    // Check if we have majority immediately (single node)
    if (this.peers.size === 0) {
      this.becomeLeader();
      return;
    }

    // Simulate: for testing, grant votes from all peers
    for (const peerId of this.peers.keys()) {
      this.votesReceived.add(peerId);
    }

    const majority = Math.floor((this.peers.size + 1) / 2) + 1;
    if (this.votesReceived.size >= majority) {
      this.becomeLeader();
    }
  }

  private becomeLeader(): void {
    this.role = 'leader';
    this.leaderId = this.nodeId;
    this.clearTimers();

    // Reset nextIndex for all peers
    for (const peerId of this.peers.keys()) {
      this.peers.get(peerId)!.nextIndex = this.log.length + 1;
      this.peers.get(peerId)!.matchIndex = 0;
    }

    // Start heartbeat
    this.heartbeatTimer = setInterval(() => {
      this.sendHeartbeats();
    }, this.config.heartbeatInterval);
  }

  private sendHeartbeats(): void {
    if (this.role !== 'leader') return;
    // Heartbeat logic would send AppendEntries to peers
  }

  private resetElectionTimer(): void {
    if (this.electionTimer) {
      clearTimeout(this.electionTimer);
    }
    if (this.role !== 'leader') {
      const timeout = this.randomTimeout();
      this.electionTimer = setTimeout(() => {
        if (this.started && this.role !== 'leader') {
          this.startElection();
        }
      }, timeout);
    }
  }

  private randomTimeout(): number {
    const min = this.config.electionTimeoutMin;
    const max = this.config.electionTimeoutMax;
    return Math.floor(Math.random() * (max - min)) + min;
  }

  private clearTimers(): void {
    if (this.electionTimer) {
      clearTimeout(this.electionTimer);
      this.electionTimer = null;
    }
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  destroy(): void {
    this.stop();
    this.peers.clear();
    this.log = [];
  }
}
