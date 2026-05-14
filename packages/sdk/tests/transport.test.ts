import { describe, it, expect, vi } from 'vitest';
import { UDPTransport } from '../src/transport';
import type { OperationEvent } from '../src/schema';

function makeEvent(): OperationEvent {
  return {
    operationName: 'TestQuery',
    operationType: 'query',
    fields: [{ typeName: 'User', fieldName: 'id' }],
    durationMs: 10,
    resolverTimings: [],
    timestamp: Date.now(),
    hasErrors: false,
  };
}

describe('UDPTransport', () => {
  it('creates without throwing', () => {
    const transport = new UDPTransport({ host: 'localhost', port: 9000 });
    expect(transport).toBeDefined();
    transport.close();
  });

  it('starts with drop count 0', () => {
    const transport = new UDPTransport({ host: 'localhost', port: 9000 });
    expect(transport.getDropCount()).toBe(0);
    transport.close();
  });

  it('send() does not throw when collector unreachable', () => {
    const transport = new UDPTransport({ host: '0.0.0.0', port: 1 });
    expect(() => transport.send([makeEvent()])).not.toThrow();
    transport.close();
  });

  it('send() handles empty array gracefully', () => {
    const transport = new UDPTransport({ host: 'localhost', port: 9000 });
    expect(() => transport.send([])).not.toThrow();
    transport.close();
  });

  it('send() handles batch of events', () => {
    const transport = new UDPTransport({ host: 'localhost', port: 9000, batchSize: 3 });
    const events = Array.from({ length: 10 }, makeEvent);
    expect(() => transport.send(events)).not.toThrow();
    transport.close();
  });

  it('close() is idempotent', () => {
    const transport = new UDPTransport({ host: 'localhost', port: 9000 });
    transport.close();
    expect(() => transport.close()).not.toThrow();
  });
});

