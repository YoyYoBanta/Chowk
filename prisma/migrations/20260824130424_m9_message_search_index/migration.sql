-- M9 (implementation-plan.md): in-thread message search (Message.body
-- substring search via src/data/messages.ts's listMessagesPage) needs to
-- stay fast at the 10,000+ messages-per-conversation performance target.
-- A plain `ILIKE '%term%'` (Prisma's `contains`, case-insensitive) cannot
-- use a normal btree index because of the leading wildcard — pg_trgm's
-- trigram GIN index is what makes that query plan use an index scan
-- instead of a sequential scan.
--
-- Not expressed in schema.prisma: this Prisma version has no stable,
-- declarative way to add a GIN(gin_trgm_ops) index without enabling
-- preview features this project hasn't otherwise needed — hand-written
-- SQL, same precedent as several earlier migrations in this history
-- (e.g. the M7/M8 relations migration).
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX "Message_body_trgm_idx" ON "Message" USING gin ("body" gin_trgm_ops);
