import { index, integer, jsonb, pgTable, text } from "drizzle-orm/pg-core";

import { ts } from "./columns";
import {
  pipelineActorTypeEnum,
  pipelineEnum,
  pipelineLayerEnum,
  pipelineStatusEnum,
} from "./enums";
import { users } from "./users";

/**
 * What the system did, and how it went.
 *
 * WHY THIS IS NOT THE AUDIT LOG
 * -----------------------------
 * `audit_logs` answers *who decided what*: an operator approved a verification,
 * a deposit was credited. It is a record of authority and it is append-only
 * because somebody may later have to answer for it.
 *
 * This table answers *what happened when I clicked the button*. It records the
 * mechanical steps — a Supabase call, a database transaction, a TronGrid page,
 * an email handed off — with timings, an outcome and a correlation id that ties
 * the steps of one request together. Most of its rows describe operations
 * nobody decided: a scanner poll, a session refresh, a failed query.
 *
 * They are separate because they are read for different reasons and have
 * different lifetimes. An audit entry is evidence and must be kept; a pipeline
 * event is diagnostics and can be pruned.
 *
 * WHAT MUST NEVER GO IN HERE
 * --------------------------
 * Passwords, access or refresh tokens, session cookies, the Supabase
 * service-role key, the TronGrid API key, private keys, whole bank account
 * numbers, identity document numbers. `metadata` is free-form jsonb, which
 * makes it the easiest place in the schema to leak something by accident — so
 * the recording helper takes an explicit, named payload and nothing writes
 * whole request bodies into it.
 */
export const pipelineEvents = pgTable(
  "pipeline_events",
  {
    id: text("id").primaryKey(),

    /** Which part of the system. */
    pipeline: pipelineEnum("pipeline").notNull(),
    /** Which tier: client, server, database, external, blockchain. */
    layer: pipelineLayerEnum("layer").notNull().default("server"),
    /** The specific step, e.g. `kyc.submit` or `db.users.findByAuthId`. */
    operation: text("operation").notNull(),
    status: pipelineStatusEnum("status").notNull(),

    /**
     * The route the request was for, e.g. `/wallet` or `/admin/kyc`.
     *
     * Recorded because "which page is slow" is the first question anybody asks
     * and reconstructing it from an operation name does not work — the same
     * service runs under half a dozen routes.
     */
    route: text("route"),
    /** user / admin / system. */
    actorType: pipelineActorTypeEnum("actor_type").notNull().default("system"),

    occurredAt: ts("occurred_at").notNull(),
    /** Wall-clock duration of the step, where it was measured. */
    durationMs: integer("duration_ms"),

    /**
     * Ties every step of one request together.
     *
     * Generated once per server action or scheduled run and threaded through
     * whatever it calls, so "what happened when I clicked Submit KYC" is one
     * filter rather than a guess based on timestamps.
     */
    correlationId: text("correlation_id").notNull(),

    /**
     * The account the operation concerned, when there is one.
     *
     * `set null` rather than `cascade`: deleting an account should not silently
     * erase the record of what the system did on its behalf.
     */
    userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
    /** The operator, when one caused it. Not a foreign key — agents outlive rows. */
    actorId: text("actor_id"),
    actorName: text("actor_name"),

    /** What the operation was about: a deposit, a submission, a withdrawal. */
    subjectType: text("subject_type"),
    subjectId: text("subject_id"),

    /** One line a human can read. */
    message: text("message").notNull(),
    /** Present exactly when `status = 'failed'`. */
    errorMessage: text("error_message"),

    /** Named, non-sensitive diagnostic fields. See the warning above. */
    metadata: jsonb("metadata").$type<Record<string, string | number | boolean>>(),

    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("pipeline_events_occurred_idx").on(table.occurredAt),
    index("pipeline_events_pipeline_idx").on(table.pipeline),
    index("pipeline_events_status_idx").on(table.status),
    index("pipeline_events_correlation_idx").on(table.correlationId),
    index("pipeline_events_user_idx").on(table.userId),
    index("pipeline_events_subject_idx").on(table.subjectType, table.subjectId),
    index("pipeline_events_layer_idx").on(table.layer),
    index("pipeline_events_route_idx").on(table.route),
  ],
);
