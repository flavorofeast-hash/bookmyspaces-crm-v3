# Release Notes — Customer Bulk Import (Phase 1)

## Migration 018 summary

Migration `018_customer_bulk_import_fields.sql`, verified deployed to production:

- Adds 9 new, nullable columns to `leads`: `company`*, `city`, `state`, `country`, `address`, `date_of_visit`, `birthday`, `anniversary`, `preferred_channel`, `imported_via_import_id`.
  *(`company` existed as a parsed field before this release but was never written to the database until this release — see "New import fields" below.)*
- Adds a conditional foreign key, `leads_imported_via_import_id_fkey` (`leads.imported_via_import_id → lead_imports.id`). The migration verified, before creating it, that `lead_imports` exists, that `lead_imports.id` exists, is of type `uuid`, and is covered by a single-column PRIMARY KEY or UNIQUE constraint — all four conditions were confirmed true in production, and the FK is live.
- `preferred_channel` is plain `TEXT` with no `CHECK` constraint — validated at the application layer only (there is currently no application-layer validation on it either; it accepts any text).
- No existing column, constraint, or index was modified, renamed, or dropped. The legacy, unused `leads.date` column was deliberately left untouched.
- Purely additive: no existing row was altered by this migration.

## New import fields

Bulk Import now accepts and stores the following in addition to the original Name/Phone/Email/Company/Source/Notes:

City, State, Country, Address, Date of Visit, Birthday, Anniversary, Preferred Channel.

All 8 are optional. `Company` — previously parsed from uploaded files but silently discarded — is now written to the database as well.

## Audit logging

Every completed import batch writes exactly one entry to the existing `admin_audit_log` system (reused, not newly built) — the same system already used for catalog changes, settings updates, and payment refunds.

Each entry records: the authenticated user (`actor`), `action = 'lead_import.completed'`, the import batch's ID (`entityId`, matching `lead_imports.id`), and a `detail` payload with filename, total rows, rows imported, rows skipped, rows failed, and a completion timestamp.

This logging is fire-and-forget: if the audit write itself fails for any reason, the import is unaffected and still completes successfully.

## Authentication

Bulk Import (both uploading a file and viewing import history) requires an authenticated session — this predates this release and was verified, not newly added, during Phase 1. Unauthenticated requests receive `401 Unauthorized` before any file is parsed or any database write occurs.

## Traceability using `imported_via_import_id`

Every lead created via Bulk Import is linked back to the specific import batch that created it, via `imported_via_import_id` (enforced by the new foreign key). This enables:

- **Reporting** — counting or filtering leads by which import batch they came from.
- **Targeted rollback** — leads from a single problematic batch can be identified and removed (`WHERE imported_via_import_id = '<batch id>'`) without affecting leads from any other batch or any other channel (WhatsApp, manual entry, etc.).
- **Audit correlation** — the same batch ID appears in the `lead_imports` history row, the `admin_audit_log` entry, and every lead it created, making it possible to reconstruct exactly what a given import did.

Deleting leads from a batch does not delete the batch's `lead_imports` or `admin_audit_log` records — the history of the batch, including any rollback performed on it, is preserved.
