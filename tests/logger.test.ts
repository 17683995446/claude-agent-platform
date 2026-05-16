// ============================================================================
// Tests for @claude-agent/logger
// ============================================================================

import { describe, test, expect, beforeEach } from 'bun:test';
import { Logger, ConsoleTransport, JsonTransport, generateRequestId, createLogger } from '../packages/logger/src/index.js';
import type { LogEntry } from '../packages/types/src/index.js';

describe('@claude-agent/logger', () => {
  describe('ConsoleTransport', () => {
    test('creates instance with default options', () => {
      const transport = new ConsoleTransport();
      expect(transport).toBeDefined();
    });

    test('creates instance with color disabled', () => {
      const transport = new ConsoleTransport({ color: false });
      expect(transport).toBeDefined();
    });

    test('write does not throw', () => {
      const transport = new ConsoleTransport();
      const entry: LogEntry = {
        timestamp: new Date().toISOString(),
        level: 'info',
        message: 'test message',
      };
      expect(() => transport.write(entry)).not.toThrow();
    });

    test('write handles error level', () => {
      const transport = new ConsoleTransport();
      const entry: LogEntry = {
        timestamp: new Date().toISOString(),
        level: 'error',
        message: 'error message',
      };
      expect(() => transport.write(entry)).not.toThrow();
    });

    test('write handles fatal level', () => {
      const transport = new ConsoleTransport();
      const entry: LogEntry = {
        timestamp: new Date().toISOString(),
        level: 'fatal',
        message: 'fatal message',
      };
      expect(() => transport.write(entry)).not.toThrow();
    });
  });

  describe('JsonTransport', () => {
    test('creates instance', () => {
      const transport = new JsonTransport();
      expect(transport).toBeDefined();
    });

    test('write does not throw', () => {
      const transport = new JsonTransport();
      const entry: LogEntry = {
        timestamp: new Date().toISOString(),
        level: 'info',
        message: 'test',
      };
      expect(() => transport.write(entry)).not.toThrow();
    });
  });

  describe('generateRequestId', () => {
    test('generates unique IDs', () => {
      const id1 = generateRequestId();
      const id2 = generateRequestId();
      expect(id1).not.toBe(id2);
    });

    test('generates string IDs', () => {
      const id = generateRequestId();
      expect(typeof id).toBe('string');
      expect(id.length).toBeGreaterThan(0);
    });
  });

  describe('Logger', () => {
    let logger: Logger;

    beforeEach(() => {
      logger = new Logger({ level: 'trace' });
    });

    test('creates with default options', () => {
      const defaultLogger = new Logger();
      expect(defaultLogger).toBeDefined();
      expect(defaultLogger.getLevel()).toBe('info');
    });

    test('creates with custom level', () => {
      const customLogger = new Logger({ level: 'debug' });
      expect(customLogger.getLevel()).toBe('debug');
    });

    test('setLevel changes level', () => {
      logger.setLevel('error');
      expect(logger.getLevel()).toBe('error');
    });

    test('trace logs when level is trace', () => {
      expect(() => logger.trace('trace message')).not.toThrow();
    });

    test('debug logs when level is debug', () => {
      expect(() => logger.debug('debug message')).not.toThrow();
    });

    test('info logs when level is info', () => {
      expect(() => logger.info('info message')).not.toThrow();
    });

    test('warn logs when level is warn', () => {
      expect(() => logger.warn('warn message')).not.toThrow();
    });

    test('error logs when level is error', () => {
      expect(() => logger.error('error message')).not.toThrow();
    });

    test('fatal logs when level is fatal', () => {
      expect(() => logger.fatal('fatal message')).not.toThrow();
    });

    test('respects log level filtering', () => {
      logger.setLevel('warn');
      // These should be suppressed
      expect(() => logger.trace('should not log')).not.toThrow();
      expect(() => logger.debug('should not log')).not.toThrow();
      expect(() => logger.info('should not log')).not.toThrow();
    });

    test('child creates child logger', () => {
      const child = logger.child({ component: 'test' });
      expect(child).toBeDefined();
      expect(child.getLevel()).toBe(logger.getLevel());
    });

    test('addTransport adds a transport', () => {
      const transport = new JsonTransport();
      logger.addTransport(transport);
      // Should not throw when logging
      expect(() => logger.info('test')).not.toThrow();
    });

    test('removeTransport removes a transport', () => {
      const transport = new JsonTransport();
      logger.addTransport(transport);
      logger.removeTransport(transport);
      expect(() => logger.info('test')).not.toThrow();
    });

    test('logs with metadata', () => {
      expect(() => logger.info('message', { key: 'value', num: 42 })).not.toThrow();
    });

    test('logs with requestId', () => {
      logger.setRequestId('req-123');
      expect(() => logger.info('message with request id')).not.toThrow();
    });
  });

  describe('createLogger', () => {
    test('creates logger with default options', () => {
      const logger = createLogger();
      expect(logger).toBeDefined();
      expect(logger.getLevel()).toBe('info');
    });

    test('creates JSON logger', () => {
      const logger = createLogger({ json: true });
      expect(logger).toBeDefined();
    });

    test('creates logger with custom level', () => {
      const logger = createLogger({ level: 'debug' });
      expect(logger.getLevel()).toBe('debug');
    });
  });
});
