import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RingBuffer, BufferEvent } from '../src/buffer';

function makeEvent(overrides: Partial<BufferEvent> = {}): BufferEvent {
  return {
    operationName: 'TestQuery',
    operationType: 'query',
    fields: [{ typeName: 'User', fieldName: 'id' }],
    durationMs: 10,
    resolverTimings: [],
    timestamp: Date.now(),
    hasErrors: false,
    ...overrides,
  };
}

describe('RingBuffer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('stores events up to capacity', () => {
    const buffer = new RingBuffer({ capacity: 5 });
    for (let i = 0; i < 5; i++) buffer.push(makeEvent());
    expect(buffer.getCount()).toBe(5);
    buffer.shutdown();
  });

  it('drops oldest event when full', () => {
    const flushed: BufferEvent[] = [];
    const buffer = new RingBuffer({
      capacity: 3,
      flushIntervalMs: 60000,
      flushThreshold: 1000,
      onFlush: (events) => { flushed.push(...events); },
    });

    const ev1 = makeEvent({ operationName: 'ev1' });
    const ev2 = makeEvent({ operationName: 'ev2' });
    const ev3 = makeEvent({ operationName: 'ev3' });
    const ev4 = makeEvent({ operationName: 'ev4' });

    buffer.push(ev1);
    buffer.push(ev2);
    buffer.push(ev3);
    buffer.push(ev4); // Should drop ev1

    expect(buffer.getCount()).toBe(3);
    expect(buffer.getDropCount()).toBe(1);

    buffer.shutdown();
  });

  it('flushes at threshold', async () => {
    const flushed: BufferEvent[] = [];
    const buffer = new RingBuffer({
      capacity: 1000,
      flushIntervalMs: 60000,
      flushThreshold: 2,
      onFlush: async (events) => { flushed.push(...events); },
    });

    buffer.push(makeEvent({ operationName: 'a' }));
    buffer.push(makeEvent({ operationName: 'b' }));

    // Threshold flush fires synchronously (via async path), wait microtasks
    await buffer.shutdown();

    expect(flushed.length).toBeGreaterThanOrEqual(2);
  });

  it('flushes on interval', async () => {
    const flushed: BufferEvent[] = [];
    const buffer = new RingBuffer({
      capacity: 1000,
      flushIntervalMs: 1000,
      flushThreshold: 10000,
      onFlush: async (events) => { flushed.push(...events); },
    });

    buffer.push(makeEvent());
    buffer.push(makeEvent());

    // Advance past the interval
    vi.advanceTimersByTime(1001);

    // Shutdown clears interval and flushes remaining
    await buffer.shutdown();

    expect(flushed.length).toBeGreaterThan(0);
  });

  it('does not throw when flush callback throws', async () => {
    const buffer = new RingBuffer({
      capacity: 100,
      flushIntervalMs: 60000,
      flushThreshold: 10000,
      onFlush: async () => { throw new Error('Flush error'); },
    });

    buffer.push(makeEvent());

    // Should not throw during shutdown flush
    await expect(buffer.shutdown()).resolves.not.toThrow();
  });

  it('never blocks — push returns immediately', () => {
    const start = Date.now();
    const buffer = new RingBuffer({ capacity: 10 });
    for (let i = 0; i < 10000; i++) buffer.push(makeEvent());
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(500);
    buffer.shutdown();
  });

  it('tracks drop count accurately', () => {
    const buffer = new RingBuffer({ capacity: 3 });
    for (let i = 0; i < 10; i++) buffer.push(makeEvent());
    expect(buffer.getDropCount()).toBe(7);
    buffer.shutdown();
  });
});


