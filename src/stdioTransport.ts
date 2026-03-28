import type { JSONRPCMessage, MessageExtraInfo } from "@modelcontextprotocol/sdk/types.js";
import type { Transport, TransportSendOptions } from "@modelcontextprotocol/sdk/shared/transport.js";

const textDecoder = new TextDecoder();

interface StdioInputLike {
  on(event: "data" | "error", listener: (value: unknown) => void): unknown;
  off(event: "data" | "error", listener: (value: unknown) => void): unknown;
  listenerCount(event: "data" | "error"): number;
  pause(): unknown;
}

interface StdioOutputLike {
  write(chunk: string): boolean;
  once(event: "drain", listener: () => void): unknown;
}

export interface StdioServerTransportOptions {
  stdin?: StdioInputLike;
  stdout?: StdioOutputLike;
}

function chunkToString(chunk: unknown): string {
  if (typeof chunk === "string") {
    return chunk;
  }

  if (chunk instanceof Uint8Array) {
    return textDecoder.decode(chunk, { stream: true });
  }

  return String(chunk);
}

export class StdioServerTransport implements Transport {
  private readonly stdin: StdioInputLike;
  private readonly stdout: StdioOutputLike;
  private buffer = "";
  private started = false;

  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: <T extends JSONRPCMessage>(message: T, extra?: MessageExtraInfo) => void;

  constructor(options: StdioServerTransportOptions = {}) {
    this.stdin = options.stdin ?? process.stdin;
    this.stdout = options.stdout ?? process.stdout;
  }

  private readonly handleData = (chunk: unknown) => {
    this.buffer += chunkToString(chunk);
    this.processBuffer();
  };

  private readonly handleError = (error: Error) => {
    this.onerror?.(error);
  };

  async start(): Promise<void> {
    if (this.started) {
      throw new Error(
        "StdioServerTransport already started! If using Server class, note that connect() calls start() automatically.",
      );
    }

    this.started = true;
    this.stdin.on("data", this.handleData);
    this.stdin.on("error", this.handleError);
  }

  async send(message: JSONRPCMessage, _options?: TransportSendOptions): Promise<void> {
    const serialized = `${JSON.stringify(message)}\n`;

    await new Promise<void>((resolve) => {
      if (this.stdout.write(serialized)) {
        resolve();
        return;
      }

      this.stdout.once("drain", resolve);
    });
  }

  async close(): Promise<void> {
    this.stdin.off("data", this.handleData);
    this.stdin.off("error", this.handleError);

    if (this.stdin.listenerCount("data") === 0) {
      this.stdin.pause();
    }

    this.buffer = "";
    this.onclose?.();
  }

  private processBuffer() {
    while (true) {
      const newlineIndex = this.buffer.indexOf("\n");

      if (newlineIndex === -1) {
        return;
      }

      const line = this.buffer.slice(0, newlineIndex).replace(/\r$/, "");
      this.buffer = this.buffer.slice(newlineIndex + 1);

      if (!line) {
        continue;
      }

      try {
        this.onmessage?.(JSON.parse(line) as JSONRPCMessage);
      } catch (error) {
        this.onerror?.(error instanceof Error ? error : new Error(String(error)));
      }
    }
  }
}
