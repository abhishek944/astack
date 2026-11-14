# Standalone Pi-AI generation observation

`tracing.generation({ model, provider }, context)` observes a model call executed
outside an AgentSession, for example independent title naming. It shares the
instance's lazy private exporter and caller-owned `flush()` / `dispose()` lifecycle.
Never use it for a call already observed by `.extension()`.

```ts
const observation = tracing.generation({ model: model.id, provider: model.provider }, {
  sessionId: opaqueConversationId,
  userId: opaqueUserId,
  traceName: "chat.title",
});
try {
  const message = await models.completeSimple(model, context, options);
  observation.end({
    outcome: message.stopReason === "error" ? "error"
      : message.stopReason === "aborted" ? "aborted" : "completed",
    usage: message.usage,
    durationMs: message.durationMs,
  });
} catch {
  observation.end({ outcome: "error" });
}
```

The seam is metadata-only even when session capture is full. It accepts no prompts,
outputs, thinking, tool bodies, media or raw errors. Callers supply only safe model,
provider and public context labels; the normal configured-key scrubber is applied.
It has an explicit root context (no ambient OTel parent), fixed span name, measured
usage/cost projection and fixed error status labels. Zero unmeasured usage is not free.
`end()` is synchronous, idempotent and fail-open, including exporter/diagnostic failures.
Automatic flush is fire-and-forget; explicit lifecycle APIs keep their normal contract.
Missing configuration, explicit disable or disposed instances create no runtime.
