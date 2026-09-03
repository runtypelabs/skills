---
name: tool-design-execution
description: >-
  Use when deciding how an agent tool executes: synchronous versus async job with
  polling, idempotency keys so retries are safe, transactional boundaries,
  compensation for cross-system multi-step operations, and timeout boundaries with
  partial results. Trigger phrases: "long-running tool", "tool times out", "agent
  retried and created a duplicate", "idempotent tool", "job id and poll", "rollback
  when a step fails", "async tool for the agent", "saga".
user-invocable: true
argument-hint: '[tool whose execution semantics to design]'
---

# Tool Execution Design

Agents retry. They retry on timeouts, on ambiguous errors, and sometimes on nothing at
all. Execution design is about making that safe: bounded time, safe repetition, and
consistent state when a multi-step operation fails halfway.

## Procedure

1. **Measure or estimate the wall-clock time** of the operation at p50 and p99.
2. **Pick the access pattern**: synchronous for bounded seconds, async job for minutes,
   streaming when partial output is useful as it arrives, event-driven when the tool
   notifies rather than answers.
3. **For every command tool, decide the retry story**: natural idempotency, an
   idempotency key, or a documented "not safe to retry" with a confirmation gate.
4. **For every multi-step command, decide the consistency story**: a real transaction
   where one system owns all steps, or compensation where several systems do.
5. **Set the timeout** and decide what a timeout returns.

## Rules with examples

### Default to synchronous, and bound it (Synchronous Execution)

Most tools return in the same call within seconds. Set an explicit timeout in the tool
definition, keep the description honest ("returns immediately"), and reach for the
async pattern only when the operation genuinely takes minutes.

### Long work returns a job handle (Async Job)

One tool starts the job and returns immediately; sibling tools poll and fetch:

```json
{
  "jobId": "job_42",
  "status": "queued",
  "estimatedMinutes": 5,
  "nextAction": { "tool": "check_job_status", "args": { "jobId": "job_42" }, "afterSeconds": 30 }
}
```

- `start_*` returns the id, an estimate, and the names of the status and result tools.
- `check_job_status(jobId)` returns `queued | running | succeeded | failed` plus
  progress when available.
- `get_job_result(jobId)` returns the shaped result; `cancel_job(jobId)` exists when the
  work is cancellable.
- The start tool's description says the operation is long and names the polling tool,
  so the agent does not wait on the first call.

### Retries must be harmless (Idempotent Operation)

Query tools are idempotent by nature. Command tools need one of:

- **Natural key**: `create_order(orderId=...)` where the caller's id makes the second
  call a no-op that returns the first result.
- **Idempotency key**: an explicit `idempotencyKey` parameter; the tool stores the
  first result under that key for a documented window and returns it on repeat.
- **Deduplication**: detect an equivalent recent call and return its result.

Document the guarantee in the description ("Safe to retry: repeated calls with the same
`idempotencyKey` return the original payment"). Never let a retry create a second
payment, message, or ticket.

### All or nothing where one system owns the data (Transactional Boundary)

When every step touches one database, wrap them in a transaction: atomic, consistent,
isolated, durable. Keep the transaction short, and state in the description what is
inside it ("Either both accounts are updated or neither is").

### Undo in reverse where systems are separate (Compensation Handler)

Cross-system operations cannot roll back atomically. Track each completed step, define
a compensating action for each, and run them in reverse order on failure:

```text
create_account   -> compensate: delete_account
setup_billing    -> compensate: cancel_billing
grant_access     -> compensate: revoke_access
```

Log every compensation. Say which steps may not be fully reversible (a sent email is
not un-sent) and surface that in the result. For slow undos, compensate asynchronously
and return a job handle.

### Time limits are explicit (Timeout Boundary)

Every tool that calls an external service has a maximum execution time. On timeout:
clean up, return partial results if any exist, and return a `retryable` error that
names the limit and, when one exists, the async alternative. Log timeouts; a rising
timeout rate is the signal to convert the tool to an async job.

### Streaming and events

Streaming suits tools whose partial output is useful before completion (search results
arriving, a document being generated). Event-driven tools push when something happens
and belong behind a subscription tool plus a webhook or queue, not a blocking call.
Both still need the timeout and idempotency decisions above.

## Anti-patterns

- A 45-second report generator exposed as a synchronous tool.
- A `create_*` command with no idempotency story and no confirmation gate.
- Multi-step provisioning that leaves the account created and billing missing with no
  compensation and no partial-success report.
- A timeout that surfaces as a generic failure with no partial result and no
  "try the async variant" hint.
- A polling tool with no `nextAction` and no interval, so the agent polls in a tight
  loop.

## On Runtype

- A runtime tool call is capped at 30 seconds; a `config.timeout` above that is
  rejected at validation. Work that needs longer goes into a flow step (5-minute step
  budget by default) or a subagent, and the tool that triggers it returns the execution
  id for `get_execution_status`.
- Flows are the platform's tool chain with checkpoints: a `conditional` step and
  `errorHandling` on each step express compensation paths, and `paginate-api` fails
  rather than swallows when unset, so partial completions surface.
- Records give command tools a natural idempotency key: upsert by a stable external id
  instead of inserting on every call.
- Read `get_platform_documentation(topic="limits")` for the current step, flow, and
  tool budgets before choosing sync or async.
