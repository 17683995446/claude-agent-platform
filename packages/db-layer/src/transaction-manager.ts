// ============================================================
// Module 5: Transaction Manager
// ============================================================

export type IsolationLevel = 'READ UNCOMMITTED' | 'READ COMMITTED' | 'REPEATABLE READ' | 'SERIALIZABLE';

export interface Transaction {
  id: string;
  isolationLevel: IsolationLevel;
  readonly createdAt: number;
  readonly savepoints: string[];
  isCommitted: boolean;
  isRolledBack: boolean;
}

export interface TransactionEvent {
  type: 'begin' | 'commit' | 'rollback' | 'savepoint' | 'release' | 'error';
  transactionId: string;
  timestamp: number;
  detail?: string;
}

export type TransactionEventHandler = (event: TransactionEvent) => void;

export class TransactionManager {
  private activeTransactions: Map<string, Transaction> = new Map();
  private eventHandlers: Set<TransactionEventHandler> = new Set();
  private transactionCounter = 0;
  private executeSqlFn: (sql: string) => Promise<void>;

  constructor(executeSql: (sql: string) => Promise<void>) {
    this.executeSqlFn = executeSql;
  }

  onEvent(handler: TransactionEventHandler): () => void {
    this.eventHandlers.add(handler);
    return () => this.eventHandlers.delete(handler);
  }

  private emit(event: TransactionEvent): void {
    for (const handler of this.eventHandlers) {
      handler(event);
    }
  }

  async beginTransaction(isolation: IsolationLevel = 'READ COMMITTED'): Promise<Transaction> {
    this.transactionCounter++;
    const id = `tx-${this.transactionCounter}`;

    const sql = `BEGIN TRANSACTION ISOLATION LEVEL ${isolation}`;
    await this.executeSqlFn(sql);

    const transaction: Transaction = {
      id,
      isolationLevel: isolation,
      createdAt: Date.now(),
      savepoints: [],
      isCommitted: false,
      isRolledBack: false,
    };

    this.activeTransactions.set(id, transaction);
    this.emit({ type: 'begin', transactionId: id, timestamp: Date.now() });
    return transaction;
  }

  async commit(transaction: Transaction): Promise<void> {
    if (!this.activeTransactions.has(transaction.id)) {
      throw new Error(`Transaction ${transaction.id} is not active`);
    }
    if (transaction.isCommitted || transaction.isRolledBack) {
      throw new Error(`Transaction ${transaction.id} is already finalized`);
    }

    await this.executeSqlFn('COMMIT');
    transaction.isCommitted = true;
    this.activeTransactions.delete(transaction.id);
    this.emit({ type: 'commit', transactionId: transaction.id, timestamp: Date.now() });
  }

  async rollback(transaction: Transaction): Promise<void> {
    if (!this.activeTransactions.has(transaction.id)) {
      throw new Error(`Transaction ${transaction.id} is not active`);
    }
    if (transaction.isCommitted || transaction.isRolledBack) {
      throw new Error(`Transaction ${transaction.id} is already finalized`);
    }

    await this.executeSqlFn('ROLLBACK');
    transaction.isRolledBack = true;
    this.activeTransactions.delete(transaction.id);
    this.emit({ type: 'rollback', transactionId: transaction.id, timestamp: Date.now() });
  }

  async createSavepoint(transaction: Transaction, name?: string): Promise<string> {
    if (!this.activeTransactions.has(transaction.id)) {
      throw new Error(`Transaction ${transaction.id} is not active`);
    }

    const savepointName = name ?? `sp-${transaction.savepoints.length + 1}`;
    await this.executeSqlFn(`SAVEPOINT ${savepointName}`);
    transaction.savepoints.push(savepointName);
    this.emit({
      type: 'savepoint',
      transactionId: transaction.id,
      timestamp: Date.now(),
      detail: savepointName,
    });
    return savepointName;
  }

  async rollbackToSavepoint(transaction: Transaction, name: string): Promise<void> {
    if (!this.activeTransactions.has(transaction.id)) {
      throw new Error(`Transaction ${transaction.id} is not active`);
    }
    if (!transaction.savepoints.includes(name)) {
      throw new Error(`Savepoint ${name} not found in transaction ${transaction.id}`);
    }

    await this.executeSqlFn(`ROLLBACK TO SAVEPOINT ${name}`);
    this.emit({
      type: 'rollback',
      transactionId: transaction.id,
      timestamp: Date.now(),
      detail: `Rollback to savepoint: ${name}`,
    });
  }

  async releaseSavepoint(transaction: Transaction, name: string): Promise<void> {
    if (!this.activeTransactions.has(transaction.id)) {
      throw new Error(`Transaction ${transaction.id} is not active`);
    }

    await this.executeSqlFn(`RELEASE SAVEPOINT ${name}`);
    const idx = transaction.savepoints.indexOf(name);
    if (idx >= 0) {
      transaction.savepoints.splice(idx, 1);
    }
    this.emit({
      type: 'release',
      transactionId: transaction.id,
      timestamp: Date.now(),
      detail: name,
    });
  }

  async runInTransaction<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
    const tx = await this.beginTransaction();
    try {
      const result = await fn(tx);
      await this.commit(tx);
      return result;
    } catch (err) {
      await this.rollback(tx);
      this.emit({
        type: 'error',
        transactionId: tx.id,
        timestamp: Date.now(),
        detail: String(err),
      });
      throw err;
    }
  }

  getActiveTransaction(id: string): Transaction | undefined {
    return this.activeTransactions.get(id);
  }

  getActiveTransactions(): Transaction[] {
    return Array.from(this.activeTransactions.values());
  }

  getActiveCount(): number {
    return this.activeTransactions.size;
  }

  isActive(transactionId: string): boolean {
    return this.activeTransactions.has(transactionId);
  }
}
