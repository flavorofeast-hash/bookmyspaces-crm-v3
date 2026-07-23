# Pipeline Status Representation & Lifecycle Naming — Architecture Decision

Status: **DESIGN REVIEW ONLY. No code, no migrations.** Resolves an open question from `audit/CUSTOMER_LIFECYCLE_REDESIGN.md` (which options A originally, provisionally). This document supersedes that provisional choice with a full comparison.

---

## Option comparison

| Dimension | A: `status = NULL` | B: dedicated value (`no_active_pipeline`) | C: separate `sales_opportunities` entity |
|---|---|---|---|
| **Reporting** | Every existing report touching `status` must become NULL-aware. Postgres three-valued logic means `status != 'confirmed'` silently **excludes** NULL rows rather than including them — a correctness trap, not a style issue. | No change to any existing report — `'no_active_pipeline'` behaves exactly like any other status value already does in every current query. | Best long-term: pipeline reports aggregate opportunities directly, with accurate per-opportunity timestamps instead of inferring history from overwritten status mutations. Requires new reporting code to realize this, though. |
| **Filtering** | `.eq('status', x)` — the exact pattern used throughout this codebase (e.g. `src/app/api/leads/route.ts`) — does **not** correctly express "is null" in Supabase/PostgREST; every filter call site needs a special case (`.is('status', null)`) or it silently returns zero matches instead of the intended set. | `.eq('status', 'no_active_pipeline')` works unmodified, identical to every other status filter already in the codebase. | Requires a join (`leads` ⋈ `sales_opportunities`) everywhere pipeline filtering happens today — largest rewrite of the three. |
| **Analytics** | Ambiguous at the SQL level whether NULL means "not applicable" or "not yet set" — every analyst/dashboard has to know the out-of-band convention. | Explicit, named bucket in every `GROUP BY status` — self-documenting the same way `'rejected'`/`'future_prospect'` already are. | Most powerful eventually — true multi-opportunity analytics per customer (lifetime opportunity count, win rate over time) — but only once analytics code is built to use it; pure cost until then. |
| **Simplicity** | Zero migration — but not actually simpler once counted honestly: it defers the cost onto every current and future call site touching `status`, indefinitely, rather than paying it once. | One additive CHECK-constraint value, using the exact playbook already proven safe in this repo three times (010, 016, 017). | Substantial new surface: new table, new relationships, every module currently reading `leads.status`/`lead_stage` (~15 files found this session: hot-lead dashboard, dashboard stats, kanban, proposal intelligence, escalation engine, followup cron, and more) needs to change what it points at. |
| **Backward compatibility** | Perfect — no constraint or existing-row change at all. | Perfect — purely additive, no existing row affected, same safety profile as 016/017. | Weakest of the three short-term — this is a genuine schema-shape change, not an additive extension; every existing reader of `status` changes what "current status" means architecturally. |
| **Future scalability** | Same structural ceiling as B: a single column on `leads` can represent only one current opportunity per person, ever. Doesn't solve concurrent opportunities. | Same ceiling as A on this specific point — solves today's problem, not the multi-opportunity one. | The only option that actually removes the ceiling: a repeat/corporate customer with two simultaneous event inquiries (a real, not hypothetical, scenario for this business) becomes naturally representable instead of forcing a choice between them. |
| **Migration complexity** | None now — but see Simplicity: the cost is deferred, not eliminated, and deferred costs in this exact codebase have already caused two production incidents this session (the proposal/source bug, the Lead Import status/source bug) via the same mechanism — an undocumented convention nobody downstream knew to handle. | Low — same additive pattern as three already-shipped migrations. | High — would need staged rollout (new table, dual-write period, gradual read migration, only then deprecate `leads.status`), realistically a multi-quarter effort, not a single migration, and carries real risk of the same production-vs-repository drift already seen repeatedly in this project if rushed. |

---

## Recommendation: B now, C later — not A

**Option A is withdrawn.** On paper it looked like the "no schema change" answer, and that's genuinely how it was proposed in the prior document — but working through Filtering and Reporting side by side against B exposes that it isn't actually lower-cost, just lower-*visibility* cost: it silently requires every current and future call site touching `status` to be individually correct about NULL handling, with no migration-time forcing function to catch the ones that aren't. Given this exact codebase has already shipped two production bugs this session from exactly that failure shape — a value nobody told the downstream code to expect — recommending a design that manufactures more of that same risk, on purpose, isn't defensible once the comparison is made explicit like this. Thank you for pushing for the full comparison; it changed the answer.

**Recommend Option B now.** It has every practical advantage claimed for A (fully additive, zero data risk, uses a pattern this team has now shipped three times safely) without A's silent-failure surface, at the cost of one CHECK-constraint value — which is not really a cost, given the identical pattern is already routine here.

**Recommend Option C as a planned, evidence-triggered future migration, not designed in detail now.** It's the structurally correct 3-5 year answer — the only option of the three that actually removes the one-opportunity-per-customer ceiling — but designing it in full today, before there's a real instance of a customer needing two concurrent tracked opportunities, would be exactly the kind of speculative schema investment the earlier AI-readiness review argued against (Section 9, `audit/CUSTOMER_DATA_ARCHITECTURE_REVIEW.md`). Concrete trigger condition to watch for: a repeat or corporate customer genuinely needing two open opportunities tracked at once becomes a recurring situation, not a one-off. When that happens, Option C is the answer to build — flagging it now so it's a deliberate future decision, not a surprise redesign.

---

## `relationship_type` vs. `lifecycle_stage`

Reconsidering the name, not just defending the earlier choice:

**Case for `relationship_type`:** deliberately reads as a different *kind* of field than `status`, which helps avoid a future engineer wondering why there are two "stage" columns on the same table. Matches your own framing from the prior turn almost exactly ("customer classification should describe who the person is").

**Case for `lifecycle_stage`:** lead → customer is not a static category the way `is_vip`/`is_corporate` are — it's a one-directional progression, which is literally what "stage" means. This is also the established term of art for exactly this concept in mainstream CRM data models (HubSpot's contact schema, for one, has a "Lifecycle Stage" property covering precisely this subscriber → lead → customer progression) — closer to industry-standard vocabulary than "relationship_type," which isn't a term with the same external precedent. It also fits this field's likely future growth better: if `lapsed_customer`, `churned`, or `reactivated_lead` get added later (all genuinely progressive, not type-like), "stage" describes them naturally; "type" would start to feel like a misnomer for values that aren't really categories.

**Recommendation: rename to `lifecycle_stage`.** The progression argument is the deciding one — this field's actual values (today and foreseeably) describe *where someone is*, not *what kind of thing they are*, and that's a stage, not a type. The "confusion with `status`" concern is real but solvable without sacrificing the more accurate name: document the two fields with explicitly distinct vocabulary — `status` as the **pipeline stage** (of the current opportunity) and this field as the **lifecycle stage** (of the person's relationship with the business overall) — rather than avoiding "stage" language altogether. Renaming `status` itself to `pipeline_status` for symmetry is not recommended here — that would touch every one of the ~15 existing call sites for a purely cosmetic gain, which isn't worth the churn; the conceptual distinction can live in documentation and naming of the *new* field alone.

Values stay minimal for now (`lead`, `customer`) — not expanding to `lapsed_customer`/`churned` etc. today, per "smallest safe change." The point of the naming discussion is that `lifecycle_stage` is the name that won't need to change again when those values eventually do get added.

---

## Updated summary

| Field | Final recommendation |
|---|---|
| Pipeline representation for "no active opportunity" | `status = 'no_active_pipeline'` (Option B) — additive CHECK-constraint value, not NULL |
| New identity/relationship field name | `lifecycle_stage` (not `relationship_type`), values `lead`/`customer` for now |
| Multi-opportunity architecture (Option C) | Deferred — planned future migration, triggered by real evidence of concurrent-opportunity need, not designed further today |

Nothing else from `audit/CUSTOMER_LIFECYCLE_REDESIGN.md` or the two earlier design documents changes — `is_vip` (reuse as-is), `repeat_customer` (needs wiring), `is_corporate` (new column), per-channel consent, `campaign_recipients`, and the tags/`campaign_tags` split all stand as previously reviewed.
