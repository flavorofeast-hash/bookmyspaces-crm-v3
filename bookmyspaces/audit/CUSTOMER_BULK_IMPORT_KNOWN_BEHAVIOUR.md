# Customer Bulk Import — Known Behaviour (Not Defects)

This document lists behavior that testers and users may notice and could reasonably assume is a bug. It is not — each item is a deliberate, current-scope design choice. Do not log these as defects during UAT; if any of them needs to change, that requires a new, separately approved change request (Phase 1 scope is frozen).

## 1. Existing phone numbers are skipped, not updated

If an imported row's phone number already matches an existing lead, the row is **skipped**. The existing lead's data (name, company, notes, etc.) is **not** overwritten or merged with the new row's data.

*Why:* Bulk Import has no update/merge logic. It only ever creates new leads. This is different from the manual "Add Lead" form, which does detect and return an existing match by phone.

*What testers will see:* re-uploading a file (or uploading a file with a customer who already exists) results in that row being counted under "Skipped," with the original lead record completely unchanged.

## 2. Email is not used for duplicate detection

Two rows with different phone numbers but the same email address will both be imported as separate leads. Only the phone number is checked for duplicates.

*Why:* `leads.email` has no uniqueness constraint at the database level, and Bulk Import does not perform email-based identity resolution (unlike the manual lead-creation API, which flags — but does not block — likely email duplicates for human review).

*What testers will see:* uploading two rows with the same email but different phone numbers produces two separate lead records.

## 3. Imports are append-only

Bulk Import only ever adds new rows. There is no "update existing customers" mode, no overwrite option, and no way to bulk-edit existing leads through this feature.

*Why:* This is the full extent of Phase 1 scope. Update/overwrite workflows were explicitly not built.

*What testers will see:* the only way to change a lead's existing information via this workflow is to have it be a genuinely new phone number, which creates a new record — it does not touch anything already in the database.

## 4. Cross-chunk processing is sequential by design

Large files are processed in batches of 100 rows ("chunks"). If the same phone number appears twice in the same file — once in chunk 1 and once in chunk 2 (i.e., more than 100 rows apart) — only the first occurrence is imported. The second is correctly skipped as a duplicate, because chunk 1 finishes and commits to the database before chunk 2 begins checking for existing phone numbers.

*Why:* Chunks are processed one at a time, in order, and each chunk's database check looks at the live state of the `leads` table — which already reflects every earlier chunk in the same upload. This is intentional and is what makes duplicate detection work correctly even for very large files.

*What testers will see:* no double-imports even for repeated phone numbers far apart in a large file. Processing time scales roughly linearly with file size, since chunks cannot run in parallel.
