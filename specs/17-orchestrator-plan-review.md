# 17 - Orchestrator Plan Review

This spec supplements Spec 06 (Orchestrator flow), Spec 02 (StreamEvent), and Spec 09 (frontend architecture).

## Goal

AgentHub pauses an Orchestrator run after Stage 1 planning and before Stage 2 DAG execution so the user can review, edit, approve, or reject the dispatch plan.

## Lifecycle

1. The Orchestrator calls `plan_tasks`.
2. AgentRunner parses the raw plan, runs `compileDispatchPlan`, and validates the compiled plan.
3. AgentRunner registers a pending plan review and publishes `dispatch.plan.pending`.
4. The frontend renders the plan in review mode.
5. The user approves as-is, edits and approves, or rejects.
6. On approval, the server compiles and validates the submitted plan again.
7. AgentRunner publishes the normal `dispatch.plan` event and executes the approved plan.
8. On rejection or parent run abort, no child agent runs are launched.

## Pending Dispatch Plan

```typescript
interface PendingDispatchPlan {
  id: string
  conversationId: string
  agentId: string
  runId: string
  plan: DispatchPlanItem[]
  createdAt: number
}
```

Pending plans are in-memory process state, matching pending writes/questions. They are recoverable through a GET endpoint while the server process is alive, but they are not persisted across dev server restarts.

## Stream Events

```typescript
| { type: 'dispatch.plan.pending', pendingPlan: PendingDispatchPlan }
| { type: 'dispatch.plan.resolved', pendingId: string, runId: string, approved: boolean }
```

`dispatch.plan.pending` means a plan is waiting for user action. `dispatch.plan` remains the execution-start event and is emitted only after approval.

## REST API

```text
GET  /api/conversations/:id/pending-dispatch-plans
POST /api/conversations/:id/pending-dispatch-plans/:planId
```

POST body:

```typescript
type ResolvePendingDispatchPlanBody =
  | { action: 'approve'; plan: DispatchPlanItem[] }
  | { action: 'reject' }
```

Invalid bodies return 400. Invalid edited plans return 400 and keep the pending plan open.

## Editable Fields

The UI may edit:

- `task`
- `agentId`
- `dependsOn`
- `expectedOutputs`
- `inputs`
- `acceptanceCriteria`

The server is the source of truth. UI validation can help format input, but execution depends only on server-side compilation and validation.

## Rejection Semantics

Rejecting a plan is an explicit user decision to stop that Orchestrator dispatch. The system publishes `dispatch.plan.resolved` with `approved=false`, launches no child runs, and does not run aggregation.

## Non-goals

- Persisting pending plan reviews in SQLite.
- Adding a workflow/DAG framework such as LangGraph.
- Adding conversation-level plan approval settings.
- Supporting drag-and-drop DAG editing in this change.
