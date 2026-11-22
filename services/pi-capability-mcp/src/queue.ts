import { createHash, randomUUID } from "node:crypto";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { Queue, QueueEvents, Worker, type ConnectionOptions, type Job } from "bullmq";
import { Redis } from "ioredis";
import type { CapabilityAdapters } from "./catalog.js";
import type { ServiceConfig } from "./config.js";

type Family = "image" | "web" | "classifier";
const FAMILIES: readonly Family[] = ["image", "web", "classifier"];

interface JobData {
  toolName: string;
  args: Record<string, unknown>;
}

type CapabilityJob = Job<JobData, CallToolResult, string>;

export interface SubmitInput {
  toolName: string;
  family: Family;
  paid: boolean;
  principalId: string;
  args: Record<string, unknown>;
  idempotencyKey: string | undefined;
}

export interface CapabilityRuntime {
  submit(input: SubmitInput, signal: AbortSignal | undefined): Promise<CallToolResult>;
  close(): Promise<void>;
}

interface Waiter {
  readonly id: symbol;
  active: boolean;
}

interface JobState {
  readonly jobId: string;
  readonly controller: AbortController;
  readonly waiters: Set<Waiter>;
  terminal: boolean;
}

const CLAIM_SCRIPT = `
local existing = redis.call('GET', KEYS[1])
if existing then
  if existing == ARGV[1] then return 'match' end
  return 'conflict'
end
redis.call('SET', KEYS[1], ARGV[1])
return 'created'
`;

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (typeof value === "object" && value !== null) {
    const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const key of Object.keys(value).sort()) {
      Object.defineProperty(result, key, {
        value: canonical((value as Record<string, unknown>)[key]),
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    return result;
  }
  return value;
}

function asCallToolResult(value: unknown): CallToolResult {
  if (
    typeof value === "object" && value !== null &&
    Array.isArray((value as { content?: unknown }).content)
  ) {
    return value as CallToolResult;
  }
  throw new Error("Queue job returned an invalid MCP result");
}

function combineSignals(signals: readonly (AbortSignal | undefined)[]): AbortSignal {
  const controller = new AbortController();
  const abort = (reason: unknown): void => controller.abort(reason);
  for (const signal of signals) {
    if (signal === undefined) continue;
    if (signal.aborted) {
      controller.abort(signal.reason);
      break;
    }
    signal.addEventListener("abort", () => abort(signal.reason), { once: true });
  }
  return controller.signal;
}

function addWaiter(state: JobState): Waiter {
  const waiter: Waiter = { id: Symbol("mcp-waiter"), active: true };
  state.waiters.add(waiter);
  return waiter;
}

function deactivateWaiter(state: JobState, waiter: Waiter): void {
  if (!waiter.active) return;
  waiter.active = false;
  if (state.terminal) return;
  for (const candidate of state.waiters) {
    if (candidate.active) return;
  }
  state.controller.abort(new Error("All callers for this job cancelled or timed out"));
}

function markTerminal(groups: Map<string, JobState>, state: JobState): void {
  state.terminal = true;
  if (state.waiters.size === 0) groups.delete(state.jobId);
}

function releaseWaiter(groups: Map<string, JobState>, state: JobState, waiter: Waiter): void {
  state.waiters.delete(waiter);
  if (state.terminal && state.waiters.size === 0) groups.delete(state.jobId);
}

function waitWithCancellation<T>(
  promise: Promise<T>,
  signal: AbortSignal,
  onCancel: () => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const cleanup = (): void => signal.removeEventListener("abort", abort);
    const abort = (): void => {
      if (settled) return;
      settled = true;
      cleanup();
      onCancel();
      reject(signal.reason instanceof Error ? signal.reason : new Error("MCP request was cancelled"));
    };
    if (signal.aborted) {
      abort();
      return;
    }
    signal.addEventListener("abort", abort, { once: true });
    promise.then(
      (value) => { if (!settled) { settled = true; cleanup(); resolve(value); } },
      (error: unknown) => { if (!settled) { settled = true; cleanup(); reject(error); } },
    );
  });
}

/** Build the three family queues and their in-process workers. */
export async function createCapabilityRuntime(
  config: ServiceConfig,
  adapters: CapabilityAdapters,
): Promise<CapabilityRuntime> {
  const connection = (): ConnectionOptions => ({
    url: config.redisUrl,
    maxRetriesPerRequest: null,
  });
  const idempotencyRedis = new Redis(config.redisUrl);
  const queues = new Map<Family, Queue<JobData>>();
  const events = new Map<Family, QueueEvents>();
  const workers: Worker<JobData>[] = [];
  const groups = new Map<string, JobState>();
  const enqueues = new Map<string, Promise<CapabilityJob>>();

  for (const family of FAMILIES) {
    const name = `pi-capability-mcp-${family}`;
    queues.set(family, new Queue<JobData>(name, { connection: connection() }));
    events.set(family, new QueueEvents(name, { connection: connection() }));
  }

  await Promise.all([
    idempotencyRedis.ping(),
    ...[...queues.values()].map((queue) => queue.waitUntilReady()),
    ...[...events.values()].map((eventStream) => eventStream.waitUntilReady()),
  ]);

  for (const family of FAMILIES) {
    const worker = new Worker<JobData>(
      `pi-capability-mcp-${family}`,
      async (job) => {
        const executor = adapters.executors[job.data.toolName];
        if (executor === undefined) throw new Error(`No adapter for ${job.data.toolName}`);
        const state = job.id === undefined ? undefined : groups.get(job.id);
        const signal = state?.controller.signal ?? new AbortController().signal;
        if (signal.aborted) {
          if (state !== undefined) markTerminal(groups, state);
          throw new Error("Job was cancelled before execution");
        }
        try {
          const result = await executor(job.data.args, signal);
          if (state !== undefined) markTerminal(groups, state);
          return result;
        } catch (error) {
          if (state !== undefined) markTerminal(groups, state);
          throw error;
        }
      },
      { connection: connection(), maxStartedAttempts: 1 },
    );
    workers.push(worker);
  }

  return {
    async submit(input, callerSignal) {
      if (callerSignal?.aborted === true) {
        throw callerSignal.reason instanceof Error
          ? callerSignal.reason
          : new Error("MCP request was cancelled");
      }

      const deadline = new AbortController();
      const deadlineError = new Error(`MCP job wait timeout (${config.jobWaitTimeoutMs}ms) exceeded`);
      const timer = setTimeout(() => deadline.abort(deadlineError), config.jobWaitTimeoutMs);
      const signal = combineSignals([callerSignal, deadline.signal]);

      const queue = queues.get(input.family);
      const eventStream = events.get(input.family);
      if (queue === undefined || eventStream === undefined) {
        clearTimeout(timer);
        throw new Error(`Unknown capability family: ${input.family}`);
      }

      let state: JobState | undefined;
      let waiter: Waiter | undefined;
      let jobId: string | undefined;
      let claim: string | undefined;
      try {
        jobId = randomUUID();
        if (input.paid) {
          if (input.idempotencyKey === undefined) throw new Error("Paid calls require an idempotency key");
          const keyHash = sha256(`${input.principalId}\u0000${input.idempotencyKey}`);
          const inputHash = sha256(JSON.stringify(canonical({
            principalId: input.principalId,
            toolName: input.toolName,
            args: input.args,
          })));
          const claimResult: unknown = await idempotencyRedis.eval(
            CLAIM_SCRIPT,
            1,
            `pi-capability-mcp:idem:${keyHash}`,
            inputHash,
          );
          if (claimResult !== "created" && claimResult !== "match" && claimResult !== "conflict") {
            throw new Error("Unexpected idempotency claim result");
          }
          claim = claimResult;
          if (claim === "conflict") throw new Error("Idempotency key was already used with different input");
          jobId = `${keyHash.slice(0, 8)}-${keyHash.slice(8, 12)}-${keyHash.slice(12, 16)}-${keyHash.slice(16, 20)}-${keyHash.slice(20, 32)}`;

          if (claim === "created") {
            const enqueue = queue.add("capability-call", {
              toolName: input.toolName,
              args: input.args,
            }, { jobId, attempts: 1 });
            enqueues.set(jobId, enqueue);
          }
        }

        const prior = groups.get(jobId);
        if (prior?.controller.signal.aborted === true) {
          throw new Error("The job for this idempotency key was cancelled; use a new key");
        }
        state = prior ?? { jobId, controller: new AbortController(), waiters: new Set(), terminal: false };
        groups.set(jobId, state);
        waiter = addWaiter(state);
        if (signal.aborted) deactivateWaiter(state, waiter);

        let job: CapabilityJob;
        if (enqueues.has(jobId)) {
          job = await enqueues.get(jobId)!;
        } else if (input.paid) {
          const existing = await queue.getJob(jobId);
          if (existing === undefined || existing === null) {
            throw new Error("Idempotency key was used but its job is no longer retained");
          }
          job = existing;
        } else {
          const enqueue = queue.add("capability-call", {
            toolName: input.toolName,
            args: input.args,
          }, { jobId, attempts: 1 });
          enqueues.set(jobId, enqueue);
          job = await enqueue;
        }

        return await waitWithCancellation(
          job.waitUntilFinished(eventStream, config.jobWaitTimeoutMs)
            .then(asCallToolResult)
            .catch((error: unknown) => {
              if (state !== undefined && waiter !== undefined) deactivateWaiter(state, waiter);
              throw error;
            }),
          signal,
          () => {
            if (state !== undefined && waiter !== undefined) deactivateWaiter(state, waiter);
          },
        );
      } catch (error) {
        if (state !== undefined && waiter === undefined) markTerminal(groups, state);
        throw error;
      } finally {
        if (state !== undefined && waiter !== undefined) releaseWaiter(groups, state, waiter);
        if (jobId !== undefined) enqueues.delete(jobId);
        clearTimeout(timer);
      }
    },
    async close() {
      for (const state of groups.values()) state.controller.abort();
      await Promise.all(workers.map((worker) => worker.close()));
      await Promise.all([...events.values()].map((eventStream) => eventStream.close()));
      await Promise.all([...queues.values()].map((queue) => queue.close()));
      await idempotencyRedis.quit();
      groups.clear();
      enqueues.clear();
    },
  };
}

