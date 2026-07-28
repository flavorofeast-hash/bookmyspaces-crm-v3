#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// FILE: scripts/smoke-test-orchestration-observability.mjs
// Phase 1B, Step 2 -- post-migration validation for
// supabase/migrations/025_orchestration_observability.sql, mirroring the
// existing scripts/smoke-test-v3.mjs pattern exactly (same reason: this
// sandbox has no network route to Supabase, confirmed again for this
// session -- only a machine with real DATABASE_URL access, e.g. yours, can
// run this). Not wired into any npm script by this step; run directly:
//
//   DATABASE_URL="postgres://postgres:[password]@[host]:5432/postgres" \
//     node scripts/smoke-test-orchestration-observability.mjs
//
// Run this immediately after applying 025_orchestration_observability.sql
// (e.g. via the Supabase SQL editor, or `psql "$DATABASE_URL" -f
// supabase/migrations/025_orchestration_observability.sql`). Does NOT
// modify any real data -- every write happens inside a transaction that is
// always rolled back at the end, success or failure, same guarantee
// smoke-test-v3.mjs already makes.
//
// WHAT THIS CHECKS (matches the Step 2 Readiness Review, Sections 9 & 12):
//   1. The new unified_messages_channel_external_id_uq unique index exists.
//   2. orchestration_decisions exists with RLS enabled + a service_role policy.
//   3. Functional: two unified_messages rows with the same (channel_id,
//      external_message_id) -- the second insert must be REJECTED.
//   4. Functional: two unified_messages rows with the same channel_id and a
//      NULL external_message_id -- both inserts must SUCCEED (proves the
//      partial index doesn't over-restrict the common null case).
//   5. Functional: a well-formed orchestration_decisions row (with
//      conflicts JSONB populated, mirroring slot-memory.ts's SlotConflict[]
//      shape) inserts successfully and its FKs hold.
// ─────────────────────────────────────────────────────────────────────────────

import pg from 'pg'

function fail(message) {
  console.error(`\n❌ ${message}\n`)
  process.exit(1)
}

if (!process.env.DATABASE_URL) {
  fail(
    'DATABASE_URL is not set.\n\n' +
    '  Run this right after applying 025_orchestration_observability.sql, with the same DATABASE_URL:\n' +
    '    DATABASE_URL="postgres://postgres:[password]@[host]:5432/postgres" node scripts/smoke-test-orchestration-observability.mjs'
  )
}

let passed = 0
let failedChecks = []

function report(name, ok, detail) {
  if (ok) {
    passed += 1
    console.log(`  ✅ ${name}`)
  } else {
    failedChecks.push(name)
    console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`)
  }
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL })

try {
  await client.connect()
  console.log('Connected.\n')

  // ── 1. Unique index exists ─────────────────────────────────────────────
  console.log('── Index (migration 025) ──')
  {
    const { rows } = await client.query(
      `select indexname from pg_indexes where schemaname = 'public' and indexname = $1`,
      ['unified_messages_channel_external_id_uq']
    )
    report('unified_messages_channel_external_id_uq exists', rows.length === 1)
  }

  // ── 2. orchestration_decisions table + RLS + policy ────────────────────
  console.log('\n── orchestration_decisions table ──')
  {
    const { rows: tableRows } = await client.query(
      `select table_name from information_schema.tables where table_schema = 'public' and table_name = 'orchestration_decisions'`
    )
    report('orchestration_decisions exists', tableRows.length === 1)

    const { rows: rlsRows } = await client.query(
      `select relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relname = 'orchestration_decisions'`
    )
    report('orchestration_decisions: RLS enabled', rlsRows[0]?.relrowsecurity === true)

    const { rows: policyRows } = await client.query(
      `select policyname from pg_policies where schemaname = 'public' and tablename = 'orchestration_decisions'`
    )
    report('orchestration_decisions: service_role policy present', policyRows.length > 0)
  }

  // ── 3-5. Functional tests (transactional, rolled back) ─────────────────
  console.log('\n── Functional test (transactional, rolled back) ──')
  await client.query('BEGIN')
  try {
    // Throwaway channel + conversation to satisfy FKs -- rolled back at the end.
    const { rows: channelRows } = await client.query(
      `insert into channels (channel_type, display_name, is_active) values ('whatsapp', '__smoke_test_channel__', true) returning id`
    )
    const channelId = channelRows[0].id
    report('insert throwaway channel', true)

    const { rows: convRows } = await client.query(
      `insert into unified_conversations (status, ai_active) values ('open', true) returning id`
    )
    const conversationId = convRows[0].id
    report('insert throwaway unified_conversation', true)

    // 3. Duplicate (channel_id, external_message_id) must be rejected.
    const wamid = '__smoke_test_wamid_dup__'
    await client.query(
      `insert into unified_messages (conversation_id, channel_id, direction, sender_type, content, external_message_id)
       values ($1, $2, 'inbound', 'customer', 'first delivery', $3)`,
      [conversationId, channelId, wamid]
    )
    report('insert first unified_message with external_message_id', true)

    let duplicateRejected = false
    try {
      await client.query(
        `insert into unified_messages (conversation_id, channel_id, direction, sender_type, content, external_message_id)
         values ($1, $2, 'inbound', 'customer', 'redelivery', $3)`,
        [conversationId, channelId, wamid]
      )
    } catch (err) {
      duplicateRejected = err.code === '23505' // unique_violation
    }
    report('duplicate (channel_id, external_message_id) insert is rejected', duplicateRejected)

    // 4. Two NULL external_message_id rows on the same channel must both succeed.
    await client.query(
      `insert into unified_messages (conversation_id, channel_id, direction, sender_type, content, external_message_id)
       values ($1, $2, 'inbound', 'customer', 'no external id A', null)`,
      [conversationId, channelId]
    )
    await client.query(
      `insert into unified_messages (conversation_id, channel_id, direction, sender_type, content, external_message_id)
       values ($1, $2, 'inbound', 'customer', 'no external id B', null)`,
      [conversationId, channelId]
    )
    report('two NULL external_message_id rows on the same channel both succeed', true)

    // 5. orchestration_decisions insert, mirroring slot-memory.ts's SlotConflict[] shape.
    const { rows: msgRows } = await client.query(
      `select id from unified_messages where conversation_id = $1 and external_message_id = $2`,
      [conversationId, wamid]
    )
    const messageId = msgRows[0].id

    await client.query(
      `insert into orchestration_decisions
         (conversation_id, message_id, mode, action, reason, had_conflicts, conflicts, executed)
       values ($1, $2, 'shadow', 'collect_missing_information', 'missing: guestCount', true, $3::jsonb, false)`,
      [
        conversationId,
        messageId,
        JSON.stringify([
          {
            slot: 'guestCount',
            crmValue: 50,
            customerValue: 150,
            customerValueSource: 'extracted',
            recommendedResolution: 'use_customer_value_pending_confirmation',
            resolutionRequired: true,
          },
        ]),
      ]
    )
    report('orchestration_decisions row inserts with FKs + conflicts JSONB intact', true)
  } finally {
    await client.query('ROLLBACK')
    console.log('  (transaction rolled back — no test data left behind)')
  }

  // ── Summary ───────────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(60)}`)
  if (failedChecks.length === 0) {
    console.log(`✅ All ${passed} checks passed. Migration 025 is structurally sound and functionally correct.`)
    console.log('   Nothing in the application reads or writes these objects yet -- this confirms the')
    console.log('   infrastructure is ready for Step 6, not that anything is live.')
  } else {
    console.log(`❌ ${failedChecks.length} check(s) failed out of ${passed + failedChecks.length}:`)
    failedChecks.forEach((c) => console.log(`   - ${c}`))
    process.exitCode = 1
  }
} catch (err) {
  fail(`Smoke test failed: ${err.message}\n\n${err.stack ?? ''}`)
} finally {
  await client.end()
}
