// src/consensus-engine.ts - 共识引擎

export type VoteType = 'for' | 'against' | 'abstain';
export type ConsensusAlgorithm = 'majority' | 'unanimous' | 'weighted' | 'supermajority';

export interface Proposal {
  id: string;
  topic: string;
  description: string;
  proposer: string;
  payload: unknown;
  createdAt: number;
  timeout: number;
}

export interface Vote {
  proposalId: string;
  agentId: string;
  vote: VoteType;
  weight: number;
  timestamp: number;
  delegatedFrom?: string;
}

export interface ConsensusResult {
  proposalId: string;
  accepted: boolean;
  forVotes: number;
  againstVotes: number;
  abstainVotes: number;
  totalWeight: number;
  forWeight: number;
  againstWeight: number;
  algorithm: ConsensusAlgorithm;
}

export interface ConsensusState {
  proposal: Proposal;
  votes: Vote[];
  result?: ConsensusResult;
  expired: boolean;
}

function generateProposalId(): string {
  return `prop_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export class ConsensusEngine {
  private proposals: Map<string, ConsensusState> = new Map();
  private agentWeights: Map<string, number> = new Map();
  private voteDelegations: Map<string, string> = new Map(); // delegator -> delegate
  private defaultAlgorithm: ConsensusAlgorithm = 'majority';
  private defaultTimeout = 30000;
  private proposalTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();

  private proposalResolvers: Map<string, (result: ConsensusResult) => void> = new Map();

  setAgentWeight(agentId: string, weight: number): void {
    this.agentWeights.set(agentId, weight);
  }

  setDefaultAlgorithm(algorithm: ConsensusAlgorithm): void {
    this.defaultAlgorithm = algorithm;
  }

  setDefaultTimeout(timeout: number): void {
    this.defaultTimeout = timeout;
  }

  delegateVote(fromAgentId: string, toAgentId: string): void {
    // BUG-FIX-005 [MEDIUM]: Reject self-delegation to prevent semantic confusion
    if (fromAgentId === toAgentId) {
      throw new Error('Cannot delegate vote to self');
    }
    this.voteDelegations.set(fromAgentId, toAgentId);
  }

  async propose(
    proposal: Partial<Proposal> & { topic: string; description: string; proposer: string },
    algorithm?: ConsensusAlgorithm,
  ): Promise<ConsensusResult> {
    const fullProposal: Proposal = {
      id: proposal.id ?? generateProposalId(),
      topic: proposal.topic,
      description: proposal.description,
      proposer: proposal.proposer,
      payload: proposal.payload,
      createdAt: proposal.createdAt ?? Date.now(),
      timeout: proposal.timeout ?? this.defaultTimeout,
    };

    const state: ConsensusState = {
      proposal: fullProposal,
      votes: [],
      expired: false,
    };
    this.proposals.set(fullProposal.id, state);

    // Wait for timeout then resolve
    return new Promise<ConsensusResult>((resolve) => {
      // BUG-FIX-002 [CRITICAL]: Store resolver so reset() can resolve pending proposals
      // instead of leaving them hanging forever.
      this.proposalResolvers.set(fullProposal.id, resolve);
      const timer = setTimeout(() => {
        this.proposalTimers.delete(fullProposal.id);
        this.proposalResolvers.delete(fullProposal.id);
        const currentState = this.proposals.get(fullProposal.id);
        if (!currentState) {
          // Proposal was cleared (reset), resolve with default
          resolve({
            proposalId: fullProposal.id,
            accepted: false,
            forVotes: 0,
            againstVotes: 0,
            abstainVotes: 0,
            totalWeight: 0,
            forWeight: 0,
            againstWeight: 0,
            algorithm: algorithm ?? this.defaultAlgorithm,
          });
          return;
        }
        currentState.expired = true;
        const result = this.tallyVotes(fullProposal.id, algorithm ?? this.defaultAlgorithm);
        currentState.result = result;
        resolve(result);
      }, fullProposal.timeout);
      this.proposalTimers.set(fullProposal.id, timer);
    });
  }

  vote(proposalId: string, agentId: string, vote: VoteType): void {
    const state = this.proposals.get(proposalId);
    if (!state || state.expired) return;

    // COMM-32: Prevent double voting
    const alreadyVoted = state.votes.some((v) => v.agentId === agentId);
    if (alreadyVoted) return;

    const weight = this.agentWeights.get(agentId) ?? 1;

    const voteRecord: Vote = {
      proposalId,
      agentId,
      vote,
      weight,
      timestamp: Date.now(),
    };
    state.votes.push(voteRecord);

    // COMM-20 & COMM-21: Process delegations with transitive resolution.
    // When an agent votes, all agents that delegated to this agent (directly or transitively)
    // also have their vote recorded with the same vote type. Each agent's own weight is used,
    // so delegation transfers voting intent, not weight. This means the delegating agent's
    // weight is counted independently (no duplicate weight).
    const visited = new Set<string>([agentId]);
    this.processDelegations(state, proposalId, agentId, vote, visited);
  }

  /**
   * COMM-20: Walk the delegation chain transitively.
   * COMM-21: Each delegating agent's own weight is used (no duplicate weight).
   * Delegation only transfers the vote direction, not the delegator's weight to the delegate.
   */
  private processDelegations(
    state: ConsensusState,
    proposalId: string,
    delegateAgentId: string,
    vote: VoteType,
    visited: Set<string>,
  ): void {
    for (const [delegator, delegate] of this.voteDelegations.entries()) {
      if (delegate === delegateAgentId && !visited.has(delegator)) {
        visited.add(delegator);
        const delegatorAlreadyVoted = state.votes.some((v) => v.agentId === delegator);
        if (!delegatorAlreadyVoted) {
          state.votes.push({
            proposalId,
            agentId: delegator,
            vote,
            weight: this.agentWeights.get(delegator) ?? 1,
            timestamp: Date.now(),
            delegatedFrom: delegateAgentId,
          });
        }
        // COMM-20: Transitively resolve - check if this delegator also has delegators
        this.processDelegations(state, proposalId, delegator, vote, visited);
      }
    }
  }

  getConsensus(proposalId: string): ConsensusState | undefined {
    return this.proposals.get(proposalId);
  }

  getProposalCount(): number {
    return this.proposals.size;
  }

  private tallyVotes(proposalId: string, algorithm: ConsensusAlgorithm): ConsensusResult {
    const state = this.proposals.get(proposalId);
    if (!state) {
      return {
        proposalId,
        accepted: false,
        forVotes: 0,
        againstVotes: 0,
        abstainVotes: 0,
        totalWeight: 0,
        forWeight: 0,
        againstWeight: 0,
        algorithm,
      };
    }
    const votes = state.votes;

    const forVotes = votes.filter((v) => v.vote === 'for');
    const againstVotes = votes.filter((v) => v.vote === 'against');
    const abstainVotes = votes.filter((v) => v.vote === 'abstain');

    const forWeight = forVotes.reduce((sum, v) => sum + v.weight, 0);
    const againstWeight = againstVotes.reduce((sum, v) => sum + v.weight, 0);
    const totalWeight = votes.reduce((sum, v) => sum + v.weight, 0);

    let accepted = false;
    const totalNonAbstain = forVotes.length + againstVotes.length;

    switch (algorithm) {
      case 'unanimous':
        accepted = againstVotes.length === 0 && forVotes.length > 0;
        break;
      case 'majority':
        accepted = forVotes.length > againstVotes.length;
        break;
      case 'supermajority':
        accepted = totalNonAbstain > 0 && forVotes.length / totalNonAbstain >= 2 / 3;
        break;
      case 'weighted':
        accepted = forWeight > againstWeight;
        break;
    }

    return {
      proposalId,
      accepted,
      forVotes: forVotes.length,
      againstVotes: againstVotes.length,
      abstainVotes: abstainVotes.length,
      totalWeight,
      forWeight,
      againstWeight,
      algorithm,
    };
  }

  reset(): void {
    // BUG-FIX-002 [CRITICAL]: Resolve all pending proposal promises before clearing,
    // preventing callers from hanging forever.
    for (const [proposalId, resolver] of this.proposalResolvers.entries()) {
      resolver({
        proposalId,
        accepted: false,
        forVotes: 0,
        againstVotes: 0,
        abstainVotes: 0,
        totalWeight: 0,
        forWeight: 0,
        againstWeight: 0,
        algorithm: this.defaultAlgorithm,
      });
    }
    for (const timer of this.proposalTimers.values()) {
      clearTimeout(timer);
    }
    this.proposalTimers.clear();
    this.proposalResolvers.clear();
    this.proposals.clear();
    this.agentWeights.clear();
    this.voteDelegations.clear();
  }
}
