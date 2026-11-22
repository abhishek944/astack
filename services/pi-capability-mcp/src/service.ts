#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import type { AddressInfo } from "node:net";
import { createProductionAdapters } from "./adapters.js";
import type { CapabilityAdapters } from "./catalog.js";
import { loadConfig, type ServiceConfig } from "./config.js";
import { createCapabilityRuntime } from "./queue.js";
import { createHttpSurface } from "./server.js";

export interface StartedService {
  readonly address: AddressInfo | null;
  close(): Promise<void>;
}

export interface StartOptions {
  config: ServiceConfig;
  adapters?: CapabilityAdapters;
}

/** Compose the transport, runtime and capability adapters into one local service. */
export async function startCapabilityService(options: StartOptions): Promise<StartedService> {
  const adapters = options.adapters ?? await createProductionAdapters(options.config);
  const runtime = await createCapabilityRuntime(options.config, adapters);
  const surface = createHttpSurface(options.config, adapters, runtime);

  await new Promise<void>((startResolve, startReject) => {
    surface.http.once("error", startReject);
    surface.http.listen(options.config.port, options.config.host, () => {
      surface.http.off("error", startReject);
      startResolve();
    });
  });

  let closing: Promise<void> | undefined;
  return {
    address: surface.http.address() as AddressInfo | null,
    close() {
      closing ??= (async () => {
        await surface.close();
        await runtime.close();
        await adapters.close?.();
      })();
      return closing;
    },
  };
}

function isMainModule(): boolean {
  const entry = process.argv[1];
  return entry !== undefined && resolve(entry) === fileURLToPath(import.meta.url);
}

if (isMainModule()) {
  const started = await startCapabilityService({ config: loadConfig(process.env) })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`${JSON.stringify({ event: "service.start_failed", message })}\n`);
      process.exit(1);
    });
  process.stderr.write(`${JSON.stringify({ event: "service.ready", address: started.address })}\n`);
  const stop = (signal: string): void => {
    void started.close().then(() => {
      process.stderr.write(`${JSON.stringify({ event: "service.stopped", signal })}\n`);
      process.exit(0);
    });
  };
  process.once("SIGINT", () => stop("SIGINT"));
  process.once("SIGTERM", () => stop("SIGTERM"));
}
