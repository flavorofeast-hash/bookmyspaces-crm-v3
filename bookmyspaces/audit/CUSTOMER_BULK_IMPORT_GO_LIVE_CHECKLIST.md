# Customer Bulk Import — Go-Live Checklist

Every item below must be checked off before Customer Bulk Import is released for general use. This checklist covers Phase 1 (parser + import route + UI + audit logging) only.

| # | Item | Status | Verified by | Date | Notes |
|---|---|---|---|---|---|
| 1 | **Production backup verified** — a current, restorable backup of the production database exists, taken after Migration 018 was applied. | ☐ Done | | | Confirm restore procedure is documented and tested, not just that a backup file exists. |
| 2 | **Migration 018 verified** — all 9 new columns and the `leads_imported_via_import_id_fkey` foreign key are confirmed present in production (already done this session — see deployment confirmation and Migration 018's own post-flight verification queries). No existing column, constraint, or index was altered. | ☑ Done | Raju | 2026-07-23 | Confirmed via production verification: all 10 columns present, FK present and correctly referencing `lead_imports(id)`. |
| 3 | **Import template verified** — the downloadable CSV template (from the Import page) includes all 14 supported columns in the correct order, and a fresh download/re-upload round-trip has been tested end-to-end. | ☐ Done | | | Covered functionally by UAT case HP-1/HP-2 using the template; confirm explicitly with the template file itself, not just hand-built test files. |
| 4 | **Audit log verified** — importing a file produces exactly one `admin_audit_log` entry per batch, with correct actor, counts, and batch reference. | ☐ Done | | | Corresponds to UAT cases AL-1 through AL-4. |
| 5 | **Rollback procedure documented** — the manual SQL-based rollback procedure (using `imported_via_import_id`) is written down somewhere the on-call/admin team can find it during an incident, not just verified ad hoc during testing. | ☐ Done | | | See Release Notes' "Traceability" section for the mechanism; a short runbook (safety-check query, then scoped `DELETE`) should exist alongside it. Corresponds to UAT Section 8. |
| 6 | **User documentation complete** — the User Guide and Known Behaviour documents are finalized and accessible to whoever will be performing imports (support/ops team, or end customers, depending on rollout audience). | ☐ Done | | | This session's deliverables: `CUSTOMER_BULK_IMPORT_USER_GUIDE.md`, `CUSTOMER_BULK_IMPORT_KNOWN_BEHAVIOUR.md`. |

## Additional pre-release confirmations

| # | Item | Status | Notes |
|---|---|---|---|
| 7 | UAT Checklist fully executed with all 34 cases marked Pass (or explicitly accepted Known Behaviour, or explicitly waived with sign-off). | ☐ Done | See `CUSTOMER_BULK_IMPORT_UAT_CHECKLIST.md`. |
| 8 | Authentication confirmed enforced on both the upload endpoint and the import-history endpoint (already verified this session — Phase 1D). | ☑ Done | No code change was needed; verified as already present. |
| 9 | Performance at expected real-world file sizes (up to 1000 rows) confirmed acceptable, or a documented file-size limit/guidance is communicated to users if 1000-row imports are found to be slow. | ☐ Done | See UAT PF-1 through PF-3. |
| 10 | No production code changes remain uncommitted/unreviewed beyond what's covered by Phases 1A–1E of this release. | ☐ Done | Confirm final diff set matches the five approved phases: parser fields, import route payload, UI guide/template, auth verification (no change), audit logging. |

---

**Release approval**

Approved by: _______________  Role: _______________  Date: _______________

☐ All items above are checked and verified — cleared for release.
☐ Release is blocked pending items: _______________
