# Customer Lifecycle Redesign — Identity vs. Pipeline

Status: **DESIGN REVIEW ONLY. No code, no migrations.** Supersedes Section 1 ("Customer Lifecycle") of `audit/CUSTOMER_DATA_ARCHITECTURE_REVIEW.md` — that document's `'customer'` status-value proposal is withdrawn in favor of what follows. Everything else in that document and `audit/CUSTOMER_DATA_MANAGEMENT_MARKETING_HUB_DESIGN.md` is unaffected.

You're right to reject overloading `status` — a single field can't cleanly carry both "where is this opportunity in the pipeline" and "who is this person" without one meaning leaking into the other the moment they diverge (exactly what would have happened the first time a repeat customer opened a *new* inquiry while already being a `'customer'`).

---

## Redesigned model

```
Identity (leads core: name, phone, email)
    ↓
Customer Type / Relationship  ← NEW, independent axis
    ↓
Sales Pipeline Status         ← unchanged, untouched
    ↓
Marketing Consent             ← already scoped separately (prior doc, Section 5)
    ↓
Campaign Segmentation         ← already scoped separately (prior doc, Sections 6/8)
    ↓
Customer Relationship (accumulated metrics)
```

### Identity
Unchanged — `name`/`phone`/`email` + the identity-resolution logic already reviewed. Answers "is this the same person."

### Customer Type / Relationship — the new axis

Your example list — Lead, Customer, Repeat Customer, Corporate, VIP — mixes two genuinely different kinds of classification, and that distinction is the actual design decision here:

- **A primary state** (Lead vs. Customer): mutually exclusive by definition — a person is either still a prospect or already an established customer, never both at once. This is the one part of your list that's a true single-value "type."
- **Attributes/segments** (Repeat Customer, Corporate, VIP): **not** mutually exclusive with each other or with the primary state — someone can be a Customer *and* Corporate *and* VIP *and* a Repeat Customer, all simultaneously. Collapsing these into one single-value field alongside Lead/Customer would force a false choice the moment two of them apply to the same person, which is the common case, not the edge case.

So this isn't one new field — it's a primary state plus a set of orthogonal flags. Concretely, checked against what's actually in the schema and code today:

| Concept | Status | Evidence |
|---|---|---|
| Lead vs. Customer (primary state) | **Doesn't exist — new field needed** | Nothing today distinguishes "still a prospect" from "established customer" independent of pipeline stage |
| VIP | **Already exists and is live/maintained** | `is_vip BOOLEAN` (migration 004), actively read *and written* — `src/lib/ai-summary.ts:162` sets it based on a scoring threshold, `src/lib/campaigns.ts:110-111` already filters segments on it |
| Repeat Customer | **Column exists, but is dead** | `repeat_customer BOOLEAN` (migration 004) — zero reads or writes anywhere in `src/`. It's schema, not behavior; nothing has ever set it |
| Corporate | **Doesn't exist as a stable flag** | Only appears as an ephemeral auto-tag (`autoTags.push("CORPORATE")` in `src/lib/lead-scorer.ts`) inside the `tags` array, which gets stripped and regenerated on every scoring pass — not a durable classification |

**Recommendation:**

1. **New field:** `relationship_type TEXT DEFAULT 'lead' CHECK (relationship_type IN ('lead', 'customer'))`. This directly replaces the withdrawn `'customer'` status-value idea, but as its own concept: bulk-imported records get `relationship_type = 'customer'` immediately, with no fabricated pipeline history. An organic lead flips to `'customer'` on conversion (exact trigger — e.g. proposal accepted, booking confirmed — is a product decision, not an architecture one, and doesn't need to be settled today).
2. **Reuse `is_vip` as-is** — it's already correct, live, and maintained. No change.
3. **`repeat_customer` needs to actually be wired up, not just reused.** It exists but nothing populates it — recommending "reuse it" without saying that plainly would be recommending reliance on a column that's currently always `false`/`null` for every row. Whoever implements this needs a real trigger for it (e.g., set `true` when a second confirmed booking/proposal is found for the same phone) as part of this work, not a follow-up someone forgets.
4. **New field:** `is_corporate BOOLEAN DEFAULT FALSE` — promotes "Corporate" from an ephemeral scoring artifact to a stable, queryable classification, consistent with how `is_vip` already works.

This gives four independent, co-occurring signals (`relationship_type`, `is_vip`, `repeat_customer`, `is_corporate`) instead of one field trying to be five things at once — and it's consistent with the tags decision you just approved: `campaign_tags` remains available for anything more ad hoc than these four (e.g. `"wedding_2025_guest"`), without needing a dedicated column for every possible customer descriptor.

### Sales Pipeline Status — unchanged, and here's why no schema change is needed

`status` stays exactly as it is (`new_inquiry → followup_pending → proposal_sent → negotiation → confirmed/rejected/future_prospect`), describing the *current opportunity* only, never the person. The open question this redesign has to answer: what does a bulk-imported customer — who has no current opportunity — get for `status`?

**Recommendation: `NULL`.** The `status` column's `CHECK` constraint doesn't require `NOT NULL` (not present in `001_initial_schema.sql`'s definition, though this is worth confirming live alongside everything else still pending verification) — and in Postgres, a `CHECK` constraint passes on `NULL` by design (three-valued logic: `NULL` isn't `FALSE`, so it isn't rejected). `NULL` is also the semantically correct value here — "no pipeline stage" is exactly what "not applicable" means, not a new enum value pretending to be one.

This is what makes the model actually work end to end: a repeat customer (`relationship_type = 'customer'`) who opens a *new* inquiry later gets a real, fresh `status` value (`'new_inquiry'`, tracking *that* opportunity) while `relationship_type` stays `'customer'` throughout — the two axes finally move independently, which was the whole point of separating them.

**No migration needed for `status` itself** — this is a usage convention (application code simply omits/nulls `status` on customer-type imports instead of inventing a value), not a constraint change.

### Marketing Consent, Campaign Segmentation
Unchanged from the prior review — per-channel tri-state consent (Section 5) and segments/lists/`campaign_recipients` (Sections 6, 8). This redesign doesn't touch either; `relationship_type`/`is_vip`/`is_corporate`/`repeat_customer` simply become additional filter dimensions `buildSegment()` can use, same as city/tags/consent already will be.

### Customer Relationship (accumulated metrics)
This is the layer describing the relationship's *history*, distinct from the point-in-time classification above: `lifetime_value` (exists), `repeat_customer` (exists, needs wiring as above), plus the `last_engagement_at`/`last_engagement_channel` pair already recommended in the prior review's Section 9. No new schema beyond what's already proposed — this section is really just naming a layer that the existing/already-proposed fields collectively make up, so it's not skipped in the model.

---

## Schema changes required — summary

| Field | Change |
|---|---|
| `relationship_type` | **New column** (`lead`/`customer`, default `'lead'`) |
| `is_corporate` | **New column** (boolean, default `false`) |
| `is_vip` | No change — already correct |
| `repeat_customer` | No schema change, but needs an application-code trigger to actually populate it (currently dead) |
| `status` | **No schema change** — `NULL` used for "no current opportunity," which the existing `CHECK` constraint already permits |

Two new boolean/enum columns total — smaller than the single status-value change originally proposed, and it avoids the correctness problem that approach had.

---

## Open item
Confirm `leads.status` genuinely allows `NULL` in production (no `NOT NULL` constraint) — add this to the still-outstanding verification batch alongside the CHECK-constraint and phone-UNIQUE checks already requested. If it turns out `status` is `NOT NULL` in production (undocumented drift, same pattern as everything else found so far), the fallback is a `'no_pipeline'` sentinel value added to `leads_status_check` instead of `NULL` — worth knowing which before this gets written into a migration, not after.
