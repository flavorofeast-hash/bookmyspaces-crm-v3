import { NextRequest, NextResponse } from 'next/server';


import { createServerAuthClient } from '@/lib/supabase-server';
import { parseExcelBuffer, ParsedLead } from '@/lib/excel-parser';
import { auditLog } from '@/lib/audit-log';

export const runtime = 'nodejs';
export const maxDuration = 30;

// Must match the current production `leads_source_check` constraint.
// Verify against the live database before changing this list.
// Do not assume migration files reflect the current production schema.
const ALLOWED_LEAD_SOURCES = [
  'website',
  'whatsapp',
  'instagram',
  'justdial',
  'referral',
  'other',
  'proposal',
  'excel_import',
  'web',
  'whatsapp_website',
  'whatsapp_facebook',
  'whatsapp_instagram',
  'facebook',
] as const;

function resolveSource(rawSource: string | null | undefined): string {
  if (rawSource && (ALLOWED_LEAD_SOURCES as readonly string[]).includes(rawSource)) {
    return rawSource;
  }
  return 'excel_import';
}

export async function POST(req: NextRequest): Promise<NextResponse> {
const supabase = createServerAuthClient();

  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 }
    );
  }

  const formData = await req.formData();

  const file = formData.get('file') as File | null;

  if (!file) {
    return NextResponse.json(
      { error: 'No file uploaded' },
      { status: 400 }
    );
  }

  const ext = file.name.split('.').pop()?.toLowerCase();

  if (!['xlsx', 'xls', 'csv'].includes(ext || '')) {
    return NextResponse.json(
      { error: 'Invalid file type' },
      { status: 400 }
    );
  }

  if (file.size > 5 * 1024 * 1024) {
    return NextResponse.json(
      { error: 'File exceeds 5MB limit' },
      { status: 400 }
    );
  }

  const buffer = await file.arrayBuffer();

  let parsed;

  try {
    parsed = parseExcelBuffer(buffer);
  } catch {
    return NextResponse.json(
      { error: 'Failed to parse file' },
      { status: 400 }
    );
  }

  const { valid, invalid, totalRows } = parsed;

  const { data: importRecord, error: importError } = await supabase
    .from('lead_imports')
    .insert({
      filename: file.name,
      total_rows: totalRows,
      valid_rows: valid.length,
      invalid_rows: invalid.length,
      status: 'processing',
      error_log: invalid,
      imported_by: session.user.id,
    })
    .select('id')
    .single();

  if (importError || !importRecord) {
    return NextResponse.json(
      { error: 'Failed to create import record' },
      { status: 500 }
    );
  }

  let insertedCount = 0;
  let skippedCount = 0;
  let dbErrorCount = 0;

  // Rows that failed for reasons other than the pre-insert validation in
  // excel-parser.ts (currently: the chunk's INSERT was rejected by
  // Postgres). Kept separate from `invalid` so the two failure modes stay
  // distinguishable, but merged into the same error_log/response shape so
  // neither one is silently dropped from the counts the way both used to be.
  const dbErrors: { row: number | null; data: Record<string, unknown>; errors: string[] }[] = [];

  const chunkSize = 100;

  for (let i = 0; i < valid.length; i += chunkSize) {
    const rawChunk: ParsedLead[] = valid.slice(i, i + chunkSize);

    // Intra-file duplicate detection: two rows in the SAME upload can share
    // a phone number. leads.phone has an index but no UNIQUE constraint, so
    // nothing at the DB layer stops both from being inserted. Dedupe within
    // the chunk first (keep the first occurrence), same as we already do
    // against existing DB rows below.
    const seenInChunk = new Set<string>();
    const chunk: ParsedLead[] = [];
    for (const lead of rawChunk) {
      if (seenInChunk.has(lead.phone)) {
        skippedCount += 1;
        continue;
      }
      seenInChunk.add(lead.phone);
      chunk.push(lead);
    }

    const phones = chunk.map((l) => l.phone);

    const { data: existing } = await supabase
      .from('leads')
      .select('phone')
      .in('phone', phones);

    const existingPhones = new Set(
      (existing ?? []).map((r: { phone: string }) => r.phone)
    );

    const newLeadPairs = chunk
      .filter((l) => !existingPhones.has(l.phone))
      .map((lead) => ({
        source: lead,
        row: {
          name: lead.name,
          phone: lead.phone,
          email: lead.email ?? null,
          // Must be one of ALLOWED_LEAD_SOURCES — the CHECK constraint
          // rejects anything else. Free-text Source values from the
          // uploaded file are validated, not passed through blindly.
          source: resolveSource(lead.source),
          notes: lead.notes ?? null,
          // 'new' is not a valid leads.status value (see
          // leads_status_check, 001_initial_schema.sql:32-41).
          // 'new_inquiry' is the constraint's actual "just came in" value.
          status: 'new_inquiry',
          // Migration 018 fields (deployed + verified in production). Parsed
          // in excel-parser.ts as optional, unvalidated strings — no format
          // normalization applied here, per Phase 1B scope (date validation
          // is deferred to a later validation phase). company was already
          // parsed but had never been written to the row until now.
          company: lead.company ?? null,
          city: lead.city ?? null,
          state: lead.state ?? null,
          country: lead.country ?? null,
          address: lead.address ?? null,
          date_of_visit: lead.date_of_visit ?? null,
          birthday: lead.birthday ?? null,
          anniversary: lead.anniversary ?? null,
          preferred_channel: lead.preferred_channel ?? null,
          // Traceability back to this import batch, via the FK added in
          // Migration 018 (leads_imported_via_import_id_fkey).
          imported_via_import_id: importRecord.id,
        },
      }));

    const newLeads = newLeadPairs.map((p) => p.row);

    skippedCount += chunk.length - newLeads.length;

    if (newLeads.length > 0) {
      const { data: inserted, error: insertErr } = await supabase
        .from('leads')
        .insert(newLeads)
        .select('id');

      if (!insertErr && Array.isArray(inserted)) {
        insertedCount += inserted.length;
      } else if (insertErr) {
        // Postgres fails a multi-row INSERT atomically — every row in this
        // chunk was rejected, not just one. Surface all of them instead of
        // letting them vanish from every count (the previous behavior).
        dbErrorCount += newLeadPairs.length;
        for (const pair of newLeadPairs) {
          dbErrors.push({
            row: null,
            data: pair.source as unknown as Record<string, unknown>,
            errors: [`Database rejected this row: ${insertErr.message}`],
          });
        }
      }
    }
  }

  const combinedErrors = [...invalid, ...dbErrors];

  await supabase
    .from('lead_imports')
    .update({
      valid_rows: insertedCount,
      invalid_rows: invalid.length + dbErrorCount,
      status: 'completed',
      error_log: combinedErrors,
      completed_at: new Date().toISOString(),
    })
    .eq('id', importRecord.id);

  // Reuses the existing admin_audit_log system (src/lib/audit-log.ts),
  // already used by other privileged/batch actions (catalog writes,
  // settings updates, payment refunds) — same actor convention
  // (email, falling back to id), same fire-and-forget semantics (an
  // audit-write failure does not fail the import, which has already
  // succeeded and been persisted by this point). One call per completed
  // batch, not per lead.
  auditLog({
    actor: session.user.email ?? session.user.id,
    action: 'lead_import.completed',
    entityType: 'lead_imports',
    entityId: importRecord.id,
    detail: {
      filename: file.name,
      total_rows: totalRows,
      imported_rows: insertedCount,
      skipped_rows: skippedCount,
      failed_rows: invalid.length + dbErrorCount,
      completed_at: new Date().toISOString(),
    },
  });

  return NextResponse.json({
    success: true,
    importId: importRecord.id,
    summary: {
      totalRows,
      inserted: insertedCount,
      skipped: skippedCount,
      invalid: invalid.length + dbErrorCount,
    },
    errors: combinedErrors.slice(0, 20),
  });
}

export async function GET(): Promise<NextResponse> {
  const supabase = createServerAuthClient();

  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 }
    );
  }

  const { data, error } = await supabase
    .from('lead_imports')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(20);

  if (error) {
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }

  return NextResponse.json({
    imports: data ?? [],
  });
}