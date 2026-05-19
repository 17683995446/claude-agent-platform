// src/protocol-negotiator.ts - 协议协商器

export type ProtocolType = 'json-rpc' | 'graphql' | 'grpc-like' | 'custom-binary';

export interface ProtocolVersion {
  protocol: ProtocolType;
  version: string;
  features: string[];
}

export interface AgentCapabilities {
  agentId: string;
  protocols: ProtocolVersion[];
  supportedFeatures: {
    compression: string[];
    encryption: string[];
    streaming: boolean;
  };
  maxMessageSize: number;
}

export interface NegotiationResult {
  protocol: ProtocolType;
  version: string;
  features: {
    compression: string;
    encryption: string;
    streaming: boolean;
  };
  maxMessageSize: number;
  negotiated: boolean;
}

function parseVersion(v: string): number[] {
  return v.split('.').map(Number);
}

function versionGte(a: string, b: string): boolean {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const va = pa[i] ?? 0;
    const vb = pb[i] ?? 0;
    if (va > vb) return true;
    if (va < vb) return false;
  }
  return true;
}

export class ProtocolNegotiator {
  private capabilities: Map<string, AgentCapabilities> = new Map();
  private localCapabilities: AgentCapabilities | null = null;

  setLocalCapabilities(capabilities: AgentCapabilities): void {
    this.localCapabilities = capabilities;
  }

  advertise(capabilities: AgentCapabilities): void {
    this.capabilities.set(capabilities.agentId, capabilities);
  }

  discover(agentId: string): AgentCapabilities | undefined {
    return this.capabilities.get(agentId);
  }

  negotiate(agentId: string): NegotiationResult {
    const remote = this.capabilities.get(agentId);
    if (!remote) {
      return {
        protocol: 'json-rpc',
        version: '1.0',
        features: { compression: 'none', encryption: 'none', streaming: false },
        maxMessageSize: 1024 * 1024,
        negotiated: false,
      };
    }

    // Find common protocols
    const commonProtocols = this.findCommonProtocols(remote);
    if (commonProtocols.length === 0) {
      // Fallback to lowest common denominator
      return {
        protocol: 'json-rpc',
        version: '1.0',
        features: { compression: 'none', encryption: 'none', streaming: false },
        maxMessageSize: Math.min(1024 * 1024, remote.maxMessageSize),
        negotiated: false,
      };
    }

    // Pick the highest priority common protocol
    const selected = commonProtocols[0];

    // Negotiate features
    const compression = this.negotiateFeature(
      ['gzip', 'deflate', 'none'],
      remote.supportedFeatures.compression,
    );
    const encryption = this.negotiateFeature(
      ['aes-256-gcm', 'tls', 'none'],
      remote.supportedFeatures.encryption,
    );
    // COMM-19: AND local and remote streaming capabilities.
    // When no local capabilities are configured, fall back to remote value (backward compatible).
    const streaming = this.localCapabilities
      ? (this.localCapabilities.supportedFeatures.streaming && remote.supportedFeatures.streaming)
      : remote.supportedFeatures.streaming;

    return {
      protocol: selected.protocol,
      version: selected.version,
      features: { compression, encryption, streaming },
      maxMessageSize: Math.min(10 * 1024 * 1024, remote.maxMessageSize),
      negotiated: true,
    };
  }

  getAllCapabilities(): Map<string, AgentCapabilities> {
    return new Map(this.capabilities);
  }

  removeAgent(agentId: string): boolean {
    return this.capabilities.delete(agentId);
  }

  private findCommonProtocols(remote: AgentCapabilities): ProtocolVersion[] {
    // Priority order for protocols
    const priority: ProtocolType[] = ['grpc-like', 'json-rpc', 'graphql', 'custom-binary'];

    const localProtocols = this.localCapabilities?.protocols;

    const common: ProtocolVersion[] = [];
    for (const proto of priority) {
      const remoteVersion = remote.protocols.find((p) => p.protocol === proto);
      // COMM-18: Check both local and remote capabilities when local is set.
      // When no local capabilities are configured, fall back to accepting all remote protocols
      // (backward compatible behavior).
      if (remoteVersion) {
        if (localProtocols) {
          const localVersion = localProtocols.find((p) => p.protocol === proto);
          if (!localVersion) continue;
          // Use the lower version of the two
          const version = versionGte(localVersion.version, remoteVersion.version)
            ? remoteVersion.version
            : localVersion.version;
          common.push({ ...remoteVersion, version });
        } else {
          common.push(remoteVersion);
        }
      }
    }
    return common;
  }

  private negotiateFeature(preferences: string[], available: string[]): string {
    for (const pref of preferences) {
      if (available.includes(pref)) return pref;
    }
    return 'none';
  }
}
