# 09_VISIT_MANAGEMENT.md — Business Knowledge Base

Confirmed process for handling a site-visit request.

## When a customer requests a visit, capture

- Name
- Mobile
- Date
- Time
- Purpose
- Guest Count
- Budget

A Site Visit record should be created automatically from this data.

## Dashboard requirement

A Site Visit dashboard/list must show, per visit:

- Time
- Customer
- Property
- Purpose
- Mobile

## Status: not yet built

`docs/engineering/MASTER_DATABASE.md`'s full table inventory (52 tables across 25 migrations) has no `site_visits` (or equivalent) table, and no visit-capture UI or dashboard is described in any existing MASTER/growth doc. This is a **net-new capability** — it does not exist in the current system.

This document does not create the table or UI (BUILD MODE is documentation-only for this task). It records the confirmed requirement so a future migration/feature can be scoped correctly: an additive `site_visits` table (name, mobile, date, time, purpose, guest_count, budget, property, created_at) plus a dashboard view filtered/sorted by time, following the existing additive-migration and RLS conventions in `MASTER_DATABASE.md`.

## Open questions

**UNKNOWN - FOUNDER INPUT REQUIRED:**

- Budget field: currency, free text, or bucketed ranges?
- Should a Site Visit link to an existing `lead` record, or always create one if none exists?
- Any reminder/notification requirement (e.g., notify operator N hours before scheduled visit)?

## Cross-references

- Suggested backlog placement: `docs/engineering/MASTER_BACKLOG.md` (new ENG ticket) or `docs/growth/21_BACKLOG.md` if treated as a growth-platform feature.
