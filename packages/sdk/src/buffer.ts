/**
 * Ring buffer for storing analytics events in-memory.
 * Implements fire-and-forget pattern: never blocks, drops oldest event if full.
 * Async flush runs independently without blocking the GraphQL execution path.
 */

export interface BufferEvent {
  operationName: string | null;
  operationType: 'query' | 'mutation' | 'subscription';
  fields: FieldUsage[];
  durationMs: number;
  resolverTimings: ResolverTiming[];
  clientName?: string;
  timestamp: number;
  hasErrors: boolean;
  queryDepth: number;
  fieldCount: number;
  complexityScore: number;
}

export interface FieldUsage {
  typeName: string;
  fieldName: string;
}

export interface ResolverTiming {
  path: string;
  durationMs: number;
}

export interface RingBufferOptions {
  capacity?: number; // default 1000
  flushIntervalMs?: number; // default 2000 (2 seconds)
  flushThreshold?: number; // default 100 events
  onFlush?: (events: BufferEvent[]) => Promise<void> | void;
}

/**
 * Thread-safe ring buffer for analytics events.
 * - Capacity: fixed size, drops oldest on overflow
 * - Flush trigger: every flushIntervalMs OR when flushThreshold events queued
 * - Flush is async and non-blocking
 * - All errors swallowed silently
 */
export class RingBuffer {
  private buffer: (BufferEvent | null)[];
  private writeIndex = 0;
  private readIndex = 0;
  private count = 0;
  private readonly capacity: number;
  private readonly flushIntervalMs: number;
  private readonly flushThreshold: number;
  private readonly onFlush?: (events: BufferEvent[]) => Promise<void> | void;
  private flushIntervalId?: NodeJS.Timeout;
  private isFlushing = false;
  private dropCount = 0;

  constructor(options: RingBufferOptions = {}) {
    this.capacity = options.capacity ?? 1000;
    this.flushIntervalMs = options.flushIntervalMs ?? 2000;
    this.flushThreshold = options.flushThreshold ?? 100;
    this.onFlush = options.onFlush;
    this.buffer = new Array(this.capacity).fill(null);
    this.scheduleIntervalFlush();
  }

  /**
   * Push an event to the buffer.
   * If full, drops the oldest event (never blocks).
   */
  push(event: BufferEvent): void {
    try {
      if (this.count >= this.capacity) {
        // Circular buffer is full, drop oldest event
        this.readIndex = (this.readIndex + 1) % this.capacity;
        this.dropCount++;
      } else {
        this.count++;
      }

      this.buffer[this.writeIndex] = event;
      this.writeIndex = (this.writeIndex + 1) % this.capacity;

      // Trigger immediate flush if threshold reached — handled by next interval
      if (this.count >= this.flushThreshold) {
        this.flush().catch(() => { /* swallow */ });
      }
    } catch (err) {
      // Silently swallow errors — never crash the user's server
      this.dropCount++;
    }
  }

  /**
   * Get current number of events in buffer.
   */
  getCount(): number {
    return this.count;
  }

  /**
   * Get number of events dropped due to buffer full or errors.
   */
  getDropCount(): number {
    return this.dropCount;
  }

  /**
   * Manually trigger a flush (for testing/shutdown).
   * Does not await completion.
   */
  async flush(): Promise<void> {
    if (this.isFlushing || this.count === 0) return;

    this.isFlushing = true;
    try {
      const events = this.collectEvents();
      if (events.length > 0 && this.onFlush) {
        // Non-blocking flush — never await in the event path
        const result = this.onFlush(events);
        if (result && typeof result.catch === 'function') {
          result.catch(() => {
            // Silently swallow flush errors
          });
        }
      }
      this.resetBuffer();
    } catch (err) {
      // Silently swallow errors
    } finally {
      this.isFlushing = false;
    }
  }

  /**
   * Stop the buffer and trigger final flush.
   */
  async shutdown(): Promise<void> {
    if (this.flushIntervalId) {
      clearInterval(this.flushIntervalId);
      this.flushIntervalId = undefined;
    }
    await this.flush();
  }

  private scheduleIntervalFlush(): void {
    this.flushIntervalId = setInterval(() => {
      this.flush().catch(() => {
        // Silently swallow errors
      });
    }, this.flushIntervalMs);
  }

  private collectEvents(): BufferEvent[] {
    const events: BufferEvent[] = [];

    for (let i = 0; i < this.count; i++) {
      const idx = (this.readIndex + i) % this.capacity;
      const event = this.buffer[idx];
      if (event) {
        events.push(event);
      }
    }

    return events;
  }

  private resetBuffer(): void {
    this.buffer = new Array(this.capacity).fill(null);
    this.writeIndex = 0;
    this.readIndex = 0;
    this.count = 0;
  }
}






