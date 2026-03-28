import { expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import { StdioServerTransport } from "../src/stdioTransport";

class FakeStdin extends EventEmitter {
  paused = false;

  emitData(chunk: unknown): void {
    this.emit("data", chunk);
  }

  emitFailure(error: Error): void {
    this.emit("error", error);
  }

  pause(): this {
    this.paused = true;
    return this;
  }
}

class FakeStdout extends EventEmitter {
  writes: string[] = [];
  backpressure = false;

  write(chunk: string): boolean {
    this.writes.push(chunk);
    return !this.backpressure;
  }

  emitDrain(): void {
    this.emit("drain");
  }
}

test("stdio transport parses split chunks and continues after invalid JSON", async () => {
  const stdin = new FakeStdin();
  const stdout = new FakeStdout();
  const transport = new StdioServerTransport({ stdin, stdout });
  const messages: JSONRPCMessage[] = [];
  const errors: string[] = [];

  transport.onmessage = (message) => {
    messages.push(message);
  };
  transport.onerror = (error) => {
    errors.push(error.message);
  };

  await transport.start();

  stdin.emitData('{"jsonrpc":"2.0","id":1,');
  stdin.emitData('"method":"ping"}\r\n\n{"jsonrpc":"2.0","id":2,"method":"ok"}\n');
  stdin.emitData('{"jsonrpc":"2.0","id":3,invalid}\n');
  stdin.emitData('{"jsonrpc":"2.0","id":4,"method":"after-error"}\n');

  expect(messages.map((message) => ("id" in message ? message.id : null))).toEqual([1, 2, 4]);
  expect(errors).toHaveLength(1);
  expect(errors[0]).toContain("JSON");
});

test("stdio transport waits for drain before resolving send", async () => {
  const stdin = new FakeStdin();
  const stdout = new FakeStdout();
  stdout.backpressure = true;
  const transport = new StdioServerTransport({ stdin, stdout });
  const message = { jsonrpc: "2.0", id: 1, result: { ok: true } } satisfies JSONRPCMessage;
  let resolved = false;

  const pending = transport.send(message).then(() => {
    resolved = true;
  });

  await Bun.sleep(0);
  expect(resolved).toBe(false);
  expect(stdout.writes).toEqual(['{"jsonrpc":"2.0","id":1,"result":{"ok":true}}\n']);

  stdout.emitDrain();
  await pending;

  expect(resolved).toBe(true);
});

test("stdio transport closes listeners and only pauses stdin when no other data listeners remain", async () => {
  const stdin = new FakeStdin();
  const stdout = new FakeStdout();
  const transport = new StdioServerTransport({ stdin, stdout });
  const extraListener = () => undefined;
  let closed = false;

  transport.onclose = () => {
    closed = true;
  };

  stdin.on("data", extraListener);
  await transport.start();
  await transport.close();

  expect(closed).toBe(true);
  expect(stdin.paused).toBe(false);
  expect(stdin.listenerCount("data")).toBe(1);

  stdin.off("data", extraListener);

  const secondTransport = new StdioServerTransport({ stdin, stdout });
  await secondTransport.start();
  await secondTransport.close();

  expect(stdin.paused).toBe(true);
  expect(stdin.listenerCount("data")).toBe(0);
});

test("stdio transport forwards stdin errors", async () => {
  const stdin = new FakeStdin();
  const stdout = new FakeStdout();
  const transport = new StdioServerTransport({ stdin, stdout });
  const errors: string[] = [];

  transport.onerror = (error) => {
    errors.push(error.message);
  };

  await transport.start();
  stdin.emitFailure(new Error("stdin failed"));

  expect(errors).toEqual(["stdin failed"]);
});
