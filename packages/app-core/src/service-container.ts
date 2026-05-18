// ============================================================================
// Module 2: Service Container (IoC/DI)
// ============================================================================

export type ServiceLifecycle = 'singleton' | 'transient' | 'scoped';

export interface ServiceFactory<T = unknown> {
  (container: ServiceContainer): T | Promise<T>;
}

export interface ServiceRegistration<T = unknown> {
  name: string;
  factory: ServiceFactory<T>;
  lifecycle: ServiceLifecycle;
  instance?: T;
  initialized?: boolean;
  dependencies?: string[];
}

export interface ServiceInfo {
  name: string;
  lifecycle: ServiceLifecycle;
  initialized: boolean;
  dependencies: string[];
}

export interface DisposableService {
  dispose?(): Promise<void>;
}

export class ServiceContainer {
  private registrations: Map<string, ServiceRegistration> = new Map();
  private resolutionStack: Set<string> = new Set();
  private scopedInstances: Map<string, Map<string, unknown>> = new Map();

  register<T>(
    name: string,
    factory: ServiceFactory<T>,
    lifecycle: ServiceLifecycle = 'singleton',
  ): void {
    if (this.registrations.has(name)) {
      throw new Error(`Service "${name}" is already registered`);
    }
    this.registrations.set(name, {
      name,
      factory: factory as ServiceFactory,
      lifecycle,
      initialized: false,
      dependencies: [],
    });
  }

  async resolve<T>(name: string): Promise<T> {
    if (this.resolutionStack.has(name)) {
      const chain = Array.from(this.resolutionStack).join(' -> ');
      throw new Error(`Circular dependency detected: ${chain} -> ${name}`);
    }

    const registration = this.registrations.get(name);
    if (!registration) {
      throw new Error(`Service "${name}" is not registered`);
    }

    this.resolutionStack.add(name);

    try {
      switch (registration.lifecycle) {
        case 'singleton': {
          if (!registration.initialized || registration.instance === undefined) {
            const result = registration.factory(this);
            registration.instance = result instanceof Promise ? await result : result;
            registration.initialized = true;
          }
          return registration.instance as T;
        }
        case 'transient': {
          const result = registration.factory(this);
          return (result instanceof Promise ? await result : result) as T;
        }
        case 'scoped': {
          const scopeId = '__default__';
          if (!this.scopedInstances.has(scopeId)) {
            this.scopedInstances.set(scopeId, new Map());
          }
          const scopeMap = this.scopedInstances.get(scopeId)!;
          if (!scopeMap.has(name)) {
            const result = registration.factory(this);
            scopeMap.set(name, result instanceof Promise ? await result : result);
          }
          return scopeMap.get(name) as T;
        }
      }
    } finally {
      this.resolutionStack.delete(name);
    }
  }

  has(name: string): boolean {
    return this.registrations.has(name);
  }

  listServices(): ServiceInfo[] {
    const services: ServiceInfo[] = [];
    for (const [, reg] of this.registrations) {
      services.push({
        name: reg.name,
        lifecycle: reg.lifecycle,
        initialized: reg.initialized ?? false,
        dependencies: reg.dependencies ?? [],
      });
    }
    return services;
  }

  async dispose(): Promise<void> {
    for (const [, reg] of this.registrations) {
      if (reg.instance && typeof (reg.instance as DisposableService).dispose === 'function') {
        try {
          await (reg.instance as DisposableService).dispose();
        } catch {
          // Continue disposing other services
        }
      }
      reg.instance = undefined;
      reg.initialized = false;
    }
    this.scopedInstances.clear();
  }

  remove(name: string): boolean {
    return this.registrations.delete(name);
  }

  reset(): void {
    for (const [, reg] of this.registrations) {
      reg.instance = undefined;
      reg.initialized = false;
    }
    this.scopedInstances.clear();
  }

  getRegistrationCount(): number {
    return this.registrations.size;
  }
}
