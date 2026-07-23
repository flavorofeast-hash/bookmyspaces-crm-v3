# Customer Bulk Import — Validation Test Plan

**Scope:** `src/app/api/leads/import/route.ts`, `src/lib/excel-parser.ts`, `src/app/(crm)/dashboard/leads/import/page.tsx`, `leads` table (Migration 018 fields), `lead_imports` table, `admin_audit_log`.

**Out of scope (not implemented, not tested here):** email-based duplicate rejection on import, existing-lead update/merge on import, date format validation in the parser (explicitly deferred), a dedicated batch-rollback API/UI.

**Environment note:** every test below must run against verified production schema/constraints (Migration 018 columns + `leads_imported_via_import_id_fkey`, both confirmed deployed), never against assumptions from migration files. Use a staging/test Supabase project with the same schema, or execute read-only/cleanup-guarded tests against production data with explicit approval.

---

## 1. Happy Path

| ID | Preconditions | Test Data | Expected Result | Pass/Fail Criteria |
|---|---|---|---|---|
| HP-1 | Authenticated session. No existing lead with the test phone numbers. | 3-row CSV, all 14 columns populated: Name, Phone, Email, Company, Source, Notes, City, State, Country, Address, Date of Visit, Birthday, Anniversary, Preferred Channel. | `summary.inserted = 3`, `summary.invalid = 0`. Each new `leads` row has all 9 Migration-018 columns populated with the file's values, `imported_via_import_id` = the returned `importId`. | Fail if any column is null/mismatched, or if `imported_via_import_id` is null. |
| HP-2 | Authenticated session. No existing lead with the test phone. | 1-row CSV: Name + Phone only, all other columns blank. | `summary.inserted = 1`. The 9 Migration-018 columns are `NULL`. `company`, `email`, `notes` are `NULL`. `source` = `excel_import` (fallback). `status` = `new_inquiry`. | Fail if insert is rejected, or if any optional column being blank causes a validation error. |
| HP-3 | Authenticated session. No existing lead with the test phone. | 1-row CSV: Name, Phone, Email, Source populated; Company, Notes, and all 8 Migration-018 optional columns blank. | `summary.inserted = 1`. Populated fields match; unpopulated optional fields are `NULL`. | Fail if partially-populated rows are rejected or if omitted columns leak stale/previous-row data. |

---

## 2. Parser Validation

| ID | Preconditions | Test Data | Expected Result | Pass/Fail Criteria |
|---|---|---|---|---|
| PV-1 | — | Header row using aliases: `Full Name`, `Mobile`, `Mail`, `Org`, `Lead Source`, `Remarks`, `Province`, `Street Address`, `Visit Date`, `DOB`, `Preferred Channel`. | All aliased columns map correctly (per `headerMap` in `excel-parser.ts`): `Province`→state, `Street Address`→address, `Visit Date`→date_of_visit, `DOB`→birthday. Row parses as valid. | Fail if any alias fails to map, or maps to the wrong field (e.g. `Mobile` landing in `email`). |
| PV-2 | — | Row missing the Name column value. | Row is rejected into `invalid` with error `"Name is required"`. Not inserted. | Fail if the row is silently inserted with `name = null`, or if the error message differs. |
| PV-3 | — | Row missing the Phone column value. | Row is rejected into `invalid` with error `"Phone is required"`. Not inserted. | Fail if inserted, or if a different/missing error is returned. |
| PV-4 | — | A fully empty row (all cells blank) inside an otherwise valid file. | Row is rejected into `invalid` with both `"Name is required"` and `"Phone is required"`. Does not crash parsing of subsequent rows. | Fail if the empty row throws an unhandled exception or halts the rest of the file. |
| PV-5 | — | Header row in mixed case: `NAME`, `Phone`, `eMail`, `city`, `STATE`. | All headers map correctly — `mapHeaders()` lowercases and trims before lookup. | Fail if any case variant fails to map. |
| PV-6 | — | File includes columns not in the header map, e.g. `Referral Code`, `Internal ID`. | Unknown columns are silently ignored (not present in `RawLeadRow`/`ParsedLead`, no error raised). Recognized columns on the same row still parse correctly. | Fail if unknown columns cause a parse error or get inserted into an unrelated field. |
| PV-7 | — | `Preferred Channel` header present but `channel` alone also present as a separate column intending to mean "lead source". | `channel` maps to `source` (existing behavior, unchanged). `Preferred Channel` maps to `preferred_channel`. The two do not collide. | Fail if `channel` is mis-mapped to `preferred_channel` or vice versa. |
| PV-8 | — | Phone value in an unrecognized format (letters, too short: `"12345"`). | Row rejected into `invalid` with `"Invalid phone: 12345"` (or equivalent per `isValidPhone`). | Fail if an invalid phone is normalized/accepted. |

---

## 3. Duplicate Handling

| ID | Preconditions | Test Data | Expected Result | Pass/Fail Criteria |
|---|---|---|---|---|
| DH-1 | No existing lead with the test phone. | Single file, two rows with the identical phone number (different names). | Intra-chunk dedup (`seenInChunk` Set) keeps the first occurrence; the second is skipped. `summary.skipped ≥ 1`. Only one `leads` row exists for that phone. | Fail if two rows are inserted for the same phone, or if the wrong row (not the first) is kept. |
| DH-2 | An existing `leads` row already has the test phone number (created via any channel). | File with one row using that same phone. | Row is skipped via the `existingPhones` DB check (`.in('phone', phones)`). Not inserted. `summary.skipped ≥ 1`. No duplicate row created. | Fail if a second `leads` row with the same phone is created — `leads.phone` has a UNIQUE index, so this should be structurally impossible, but the app-level skip must also behave correctly. |
| DH-3 | No existing lead with either phone in this test. | Two rows with different phone numbers but the identical email address. | **Both rows are inserted** — the import route performs no email-based dedup (unlike `/api/leads` POST, which calls `resolveIdentity()`; this route does not). This is documented existing behavior, not a defect. | Fail the test if this behavior is being validated as a defect. Pass if both rows insert as two separate `leads`. Flag as a known gap if stakeholders expect email dedup — do not fix without a new approved change request. |
| DH-4 | An existing `leads` row has the test phone with `name = "Old Name"`. | Import row with the same phone, `name = "New Name"`. | Row is **skipped**, not merged/updated. The existing lead's `name` remains `"Old Name"`. No "existing lead update" behavior exists in this route. | Fail if the existing row's fields are overwritten — that would be undocumented new behavior. Pass only if the existing row is left untouched and the import row is counted as skipped. |
| DH-5 | No existing lead with either phone. `chunkSize = 100`. | A single file with ≥150 rows, where row 1 and row 101 (i.e., chunk 1 and chunk 2) share the identical phone number. | Row 1 (chunk 1) inserts. Chunk 1's insert commits to `leads` (chunks are processed sequentially, awaited) before chunk 2 begins. When chunk 2 runs its `existingPhones` check, it now finds the phone (just inserted by chunk 1) and skips row 101. Net result: exactly one `leads` row for that phone. | Fail if both rows insert (would indicate chunks aren't actually sequential/awaited, or the existing-phone check isn't re-run per chunk). This is the critical cross-chunk dedup case — `seenInChunk` alone would NOT catch this since it resets every chunk. |

---

## 4. Database Validation

| ID | Preconditions | Test Data | Expected Result | Pass/Fail Criteria |
|---|---|---|---|---|
| DB-1 | No existing lead with the test phones. Chunk contains ≥2 rows, one with a garbage date value. | A chunk where one row has `Date of Visit = "not-a-date"` and the other rows in the *same chunk* are otherwise valid. | Postgres rejects the multi-row `INSERT` for the **entire chunk atomically** (documented in the route's own comment: "Postgres fails a multi-row INSERT atomically — every row in this chunk was rejected, not just one"). All rows in that chunk — including the otherwise-valid ones — land in `dbErrors`, counted in `summary.invalid`, none inserted. | Fail if only the bad row is rejected while valid rows in the same chunk are inserted — that would contradict the route's actual (all-or-nothing per chunk) behavior. Pass if the whole chunk fails together and the error message references the DB rejection. |
| DB-2 | No existing lead with the test phone. | Row with `Source = "totally_unknown_value"`. | `resolveSource()` does not reject it — it silently falls back to `"excel_import"` (the value is not in `ALLOWED_LEAD_SOURCES`). Row inserts successfully with `source = "excel_import"`, not with the original bogus value. | Fail if the row is rejected, or if the bogus source value is passed through unchanged. |
| DB-3 | No existing lead with the test phone. | Row with Name + Phone only; all 9 Migration-018 columns and Company blank. | Row inserts. All blank optional columns are `NULL` in the database (not empty string). | Fail if any blank optional field is stored as `""` instead of `NULL`, or if `NOT NULL` is unexpectedly enforced on any of these columns (none should be, per Migration 018 — purely additive, nullable). |
| DB-4 | `lead_imports` row exists (created at the start of the import request) with a known UUID. | Any successful import request. | Every inserted `leads` row's `imported_via_import_id` equals the `lead_imports.id` created for that request. `leads_imported_via_import_id_fkey` holds (no orphaned reference possible via this route, since the ID always comes from a freshly-inserted `lead_imports` row in the same request). | Fail if `imported_via_import_id` is null on a successful import, or points to a different import's ID. |
| DB-5 | Direct DB/SQL access (not via the app). | Attempt `UPDATE leads SET imported_via_import_id = '<a UUID that does not exist in lead_imports>' WHERE id = '<any lead>'`. | Postgres rejects the update — `leads_imported_via_import_id_fkey` enforces referential integrity at the database level, independent of application code. | Fail if the update succeeds (would mean the FK is missing or misconfigured in the environment under test). This is a schema-level sanity check, not reachable through the app's own code paths. |

---

## 5. Authentication

| ID | Preconditions | Test Data | Expected Result | Pass/Fail Criteria |
|---|---|---|---|---|
| AU-1 | Valid authenticated session (cookie/session present). | `POST /api/leads/import` with a valid file. | Request proceeds normally; import completes; `lead_imports.imported_by` = the session's `user.id`. | Fail if a valid session is rejected, or if `imported_by` is null/wrong. |
| AU-2 | No session / expired session. | `POST /api/leads/import` with a valid file, no auth cookie. | `401 { error: "Unauthorized" }`. No file parsing occurs, no `lead_imports` row is created, no `leads` rows are inserted. | Fail if the request is processed despite no session, or if any DB write occurs before the 401 is returned. |
| AU-3 | Valid authenticated session. | `GET /api/leads/import`. | Returns `{ imports: [...] }`, the last 20 import records, ordered by `created_at` descending. | Fail if history is returned without auth, or if an authenticated request is rejected. |
| AU-4 | No session / expired session. | `GET /api/leads/import`. | `401 { error: "Unauthorized" }`. No `lead_imports` data returned. | Fail if import history is exposed to an unauthenticated caller. |

---

## 6. Audit Logging

| ID | Preconditions | Test Data | Expected Result | Pass/Fail Criteria |
|---|---|---|---|---|
| AL-1 | Authenticated session. Clean `admin_audit_log` baseline (or filter by timestamp/entityId for this test). | Import a file with, e.g., 250 rows across 3 chunks (100/100/50). | Exactly **one** `admin_audit_log` row is written for this request, with `action = 'lead_import.completed'`. | Fail if zero rows are written (audit call didn't fire) or more than one row is written (would indicate per-chunk or per-row logging, violating "once per batch"). |
| AL-2 | Same as AL-1. | — | `actor` on the audit row equals the authenticated user's email (or their `id` if email is unset) — matches the same `email ?? id` convention used by every other `auditLog()` call site in the codebase. | Fail if `actor` is null, generic (e.g. `"admin"`), or doesn't match the session's identity. |
| AL-3 | Same as AL-1, with known/controlled row outcomes: e.g. of 250 rows, 240 insert, 5 are skipped as duplicates, 5 are invalid. | — | `detail.total_rows = 250`, `detail.imported_rows = 240`, `detail.skipped_rows = 5`, `detail.failed_rows = 5`, `detail.filename` matches the uploaded file's name, `detail.completed_at` is a valid ISO timestamp close to request completion time. | Fail if any count is wrong, or if counts don't reconcile with the response's `summary` object (they must match exactly — both are computed from the same variables). |
| AL-4 | Same as AL-1. | — | `entityId` on the audit row equals `importRecord.id` (the same ID returned to the client as `importId` and written to every inserted lead's `imported_via_import_id`). `entityType = 'lead_imports'`. | Fail if `entityId` is null, or doesn't match the `lead_imports` row / response `importId` / leads' `imported_via_import_id` — all three must be the same value. |
| AL-5 | Authenticated session. Simulate an `admin_audit_log` write failure (e.g. temporarily revoke insert permission on that table, if testable in staging). | Import a valid file. | The import itself still completes successfully (`summary`, `leads` rows, `lead_imports` row all correct) — `auditLog()` is fire-and-forget and must not fail the request. The failure is only logged via `logger.warn`. | Fail if the import request itself errors out or rolls back because the audit write failed — that would violate the documented fire-and-forget contract. |

---

## 7. Performance

| ID | Preconditions | Test Data | Expected Result | Pass/Fail Criteria |
|---|---|---|---|---|
| PF-1 | No existing leads with the test phones. `chunkSize = 100`, so this is exactly 1 chunk. | 100-row file, all unique valid phones, mixed populated/blank optional columns. | All 100 rows insert in a single chunk iteration. Completes well within the 30s `maxDuration` (Vercel function limit declared in the route). | Fail if the request times out, or if `summary.inserted ≠ 100` with no duplicates/invalids in the input. Record actual wall-clock time as a baseline. |
| PF-2 | No existing leads with the test phones. | 500-row file — 5 full chunks. | All 5 chunks process sequentially; `summary.inserted = 500` (assuming a clean, unique dataset). Completes within `maxDuration`. | Fail on timeout or incorrect final counts. Record wall-clock time and compare scaling against PF-1 (should be roughly linear, not exponential — chunking should prevent any accidental O(n²) behavior from the per-chunk `existingPhones` query). |
| PF-3 | No existing leads with the test phones. | 1000-row file — 10 full chunks. | All 10 chunks process; `summary.inserted = 1000` for a clean dataset. **This is the case most likely to approach or exceed the 30s `maxDuration`** — treat this test as also validating whether the current chunking strategy is sufficient at this volume, not just a functional check. | Fail on timeout (note: a timeout here is a legitimate finding, not just a test failure — if it times out, this is a real capacity limit worth flagging back before this file size is advertised as supported). Record wall-clock time. |
| PF-4 | No existing leads. File sized to exactly 100 rows (1 full chunk) vs. 101 rows (chunk 1 = 100, chunk 2 = 1). | Two files as described. | Both process correctly with no off-by-one error: the 101-row file produces exactly 2 chunk iterations (100 + 1), not 1 or 3. `summary.inserted` matches row count in both cases (clean data). | Fail if the 101st row is dropped, duplicated, or if the loop miscounts at the boundary (`for (let i = 0; i < valid.length; i += chunkSize)` — verify against `valid.length`, not `totalRows`, since `invalid` rows are excluded before chunking). |

---

## 8. Rollback

**Note:** there is no dedicated "rollback a batch" API or UI in the current implementation. These test cases validate that `imported_via_import_id` provides sufficient, safe traceability to perform a manual, targeted rollback via direct SQL — which is the entire stated purpose of that column and its FK (per Migration 018's own PURPOSE comment: "traceability, reporting, and rollback identification"). This is a data-operations procedure test, not an app-feature test.

| ID | Preconditions | Test Data | Expected Result | Pass/Fail Criteria |
|---|---|---|---|---|
| RB-1 | Two separate import batches have been run (Batch A: `importId = A`, 50 rows; Batch B: `importId = B`, 50 rows, different phones). | `SELECT COUNT(*) FROM leads WHERE imported_via_import_id = 'A';` | Returns exactly 50 (or the actual inserted count from Batch A, accounting for any skipped duplicates in that batch). | Fail if the count includes rows from Batch B, or omits rows that were actually inserted by Batch A. |
| RB-2 | Same as RB-1. | `DELETE FROM leads WHERE imported_via_import_id = 'A';` (executed manually, with a prior `SELECT COUNT(*)` safety check per standard practice). | Only Batch A's ~50 rows are removed. Batch B's rows are completely unaffected — verify `SELECT COUNT(*) FROM leads WHERE imported_via_import_id = 'B'` is unchanged before/after. | Fail if any Batch B row is deleted, or if any row from Batch A survives. |
| RB-3 | Same as RB-1, before RB-2's delete. | Attempt to delete only rows from Batch A where a specific sub-condition also holds (e.g. `AND city = 'Mumbai'`), simulating a partial/targeted rollback. | Only the rows matching both `imported_via_import_id = 'A'` and the sub-condition are removed; the rest of Batch A and all of Batch B remain. | Fail if the sub-condition is ignored or if it accidentally matches rows outside Batch A (this is really testing that `imported_via_import_id` is a reliable, precise filter to combine with other conditions). |
| RB-4 | After RB-2 (Batch A deleted). | `SELECT * FROM lead_imports WHERE id = 'A';` | The `lead_imports` audit/history row for Batch A **still exists** — deleting the `leads` rows does not cascade-delete the `lead_imports` record, since the FK direction is `leads.imported_via_import_id → lead_imports.id`, not the reverse. History of the batch (including the `admin_audit_log` entry from AL-1–AL-4) is preserved even after a rollback. | Fail if the `lead_imports` row or the `admin_audit_log` row was also deleted — losing the audit trail of a rollback would be a regression in exactly the traceability this column was built for. |

---

## Summary

Total test cases: 8 categories, 34 individual cases (HP: 3, PV: 8, DH: 5, DB: 5, AU: 4, AL: 5, PF: 4, RB: 4).

Cases DH-3, DH-4, and the Section 8 note flag existing behaviors/gaps (no email dedup, no update-on-duplicate, no dedicated rollback feature) that should be treated as documented current scope, not defects — any change to that scope requires a new, separately approved change request, consistent with this project's "no new features without approval" rule.
