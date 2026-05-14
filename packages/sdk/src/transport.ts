/**
 * UDP transport for sending batched events to collector.
 * Fire-and-forget pattern: no retries, no queuing, silent drop on error.
 */

import { createSocket, Socket } from 'dgram';
import { OperationEvent } from './schema';

export interface TransportOptions {
  host: string;
  port: number;
  batchSize?: number; // default 10 (events per UDP packet)
}

/**
 * Serializes events to a simple JSON format (protobuf integration can be added later).
 * Each event is roughly 200-500 bytes depending on field count.
 * Max UDP packet: 65507 bytes, so batching 10 events per packet is safe.
 */
function serializeEvents(events: OperationEvent[]): Buffer {
  const payload = JSON.stringify(events);
  return Buffer.from(payload, 'utf-8');
}

/**
 * UDP transport for sending analytics events to the collector.
 * - Sends in batches to reduce UDP overhead
 * - No retries: fire-and-forget pattern
 * - All errors silently swallowed
 * - Tracks drop count for debugging
 */
export class UDPTransport {
  private socket: Socket | null = null;
  private host: string;
  private port: number;
  private batchSize: number;
  private dropCount = 0;
  private isShutdown = false;

  constructor(options: TransportOptions) {
    this.host = options.host;
    this.port = options.port;
    this.batchSize = options.batchSize ?? 10;
    this.initSocket();
  }

  private initSocket(): void {
    try {
      this.socket = createSocket('udp4');
      this.socket.on('error', () => {
        // Silently swallow socket errors
        this.socket = null;
      });
    } catch (err) {
      // Silently swallow init errors
      this.socket = null;
    }
  }

  /**
   * Send events to collector via UDP.
   * Batches multiple events per packet if size permits.
   * Never throws, never blocks.
   */
  send(events: OperationEvent[]): void {
    if (!events.length || this.isShutdown) return;

    try {
      // Batch events to reduce UDP overhead
      for (let i = 0; i < events.length; i += this.batchSize) {
        const batch = events.slice(i, i + this.batchSize);
        const payload = serializeEvents(batch);

        // Guard against packet size overflow
        if (payload.length > 65507) {
          this.dropCount++;
          continue;
        }

        if (!this.socket) {
          this.initSocket();
        }

        if (this.socket) {
          this.socket.send(
            payload,
            0,
            payload.length,
            this.port,
            this.host,
            (err: Error | null) => {
              if (err) {
                this.dropCount++;
              }
            }
          );
        }
      }
    } catch (err) {
      // Silently swallow all errors
      this.dropCount++;
    }
  }

  /**
   * Get number of events dropped due to errors or oversized packets.
   */
  getDropCount(): number {
    return this.dropCount;
  }

  /**
   * Close the UDP socket gracefully.
   */
  close(): void {
    this.isShutdown = true;
    if (this.socket) {
      try {
        this.socket.close();
      } catch (err) {
        // Silently swallow close errors
      }
      this.socket = null;
    }
  }
}




