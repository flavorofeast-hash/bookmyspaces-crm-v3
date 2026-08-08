'use client'

// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/app/(crm)/business-packages/page.tsx
// Business Package Engine — CRM UI. Talks to /api/business-packages
// (list/create) and /api/business-packages/[id] (update/retire). Follows
// the same list+form-panel conventions already established by the Drip
// Sequences page (src/app/(crm)/whatsapp/drip-sequences/page.tsx).
//
// marketing_segment is edited as raw JSON (SegmentFilter shape, e.g.
// {"event_type":"wedding"}) rather than a bespoke builder UI — the same
// filter keys already documented in src/lib/campaigns.ts's SegmentFilter,
// not a new segment language.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Package, Plus, X, Save, Loader2, Pencil, Ban, Power, PlayCircle } from 'lucide-react'

interface BusinessPackage {
  id: string
  name: string
  category: string | null
  description: string | null
  targetAudience: string | null
  highlights: string[]
  budgetRange: string | null
  cta: string | null
  landingPageSlug: string | null
  pricingPackageId: string | null
  proposalTemplateNotes: string | null
  aiPrompt: string | null
  hashtags: string[]
  recommendedMedia: string | null
  recommendedPostingTime: string | null
  whatsappTemplate: string | null
  emailSubjectTemplate: string | null
  emailTemplate: string | null
  followUpSequenceId: string | null
  marketingSegment: Record<string, unknown>
  status: 'active' | 'inactive' | 'retired'
}

interface DripSequenceOption { id: string; name: string }
interface PricingPackageOption { id: string; name: string; venue: string }

const STATUS_STYLES: Record<BusinessPackage['status'], string> = {
  active: 'bg-green-50 text-green-700',
  inactive: 'bg-amber-50 text-amber-700',
  retired: 'bg-gray-100 text-gray-500',
}

const SUGGESTED_CATEGORIES = [
  'Wedding', 'Engagement', 'Anniversary', 'Birthday', 'Baby Shower', 'Private Party',
  'Private Dining', 'Corporate', 'Room Stay', 'Restaurant', 'Seasonal',
]

const emptyForm = {
  name: '', category: '', description: '', targetAudience: '', highlights: '', budgetRange: '',
  cta: '', landingPageSlug: '', pricingPackageId: '', proposalTemplateNotes: '', aiPrompt: '',
  hashtags: '', recommendedMedia: '', recommendedPostingTime: '', whatsappTemplate: '',
  emailSubjectTemplate: '', emailTemplate: '', followUpSequenceId: '', marketingSegment: '{}',
  status: 'active' as BusinessPackage['status'],
}

export default function BusinessPackagesPage() {
  const [packages, setPackages] = useState<BusinessPackage[]>([])
  const [loading, setLoading] = useState(true)
  const [formOpen, setFormOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState(emptyForm)

  const [dripSequences, setDripSequences] = useState<DripSequenceOption[]>([])
  const [pricingPackages, setPricingPackages] = useState<PricingPackageOption[]>([])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/business-packages')
      const data = await res.json()
      setPackages(Array.isArray(data.packages) ? data.packages : [])
    } catch {
      setPackages([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    fetch('/api/whatsapp/drip-sequences')
      .then((res) => res.json())
      .then((data) => setDripSequences(Array.isArray(data.sequences) ? data.sequences.map((s: DripSequenceOption) => ({ id: s.id, name: s.name })) : []))
      .catch(() => setDripSequences([]))
    fetch('/api/packages?active=true')
      .then((res) => res.json())
      .then((data) => setPricingPackages(Array.isArray(data.packages) ? data.packages.map((p: PricingPackageOption) => ({ id: p.id, name: p.name, venue: p.venue })) : []))
      .catch(() => setPricingPackages([]))
  }, [])

  function resetForm() {
    setForm(emptyForm)
    setEditingId(null)
  }

  function openCreate() {
    resetForm()
    setFormOpen(true)
  }

  function openEdit(pkg: BusinessPackage) {
    setForm({
      name: pkg.name,
      category: pkg.category ?? '',
      description: pkg.description ?? '',
      targetAudience: pkg.targetAudience ?? '',
      highlights: pkg.highlights.join(', '),
      budgetRange: pkg.budgetRange ?? '',
      cta: pkg.cta ?? '',
      landingPageSlug: pkg.landingPageSlug ?? '',
      pricingPackageId: pkg.pricingPackageId ?? '',
      proposalTemplateNotes: pkg.proposalTemplateNotes ?? '',
      aiPrompt: pkg.aiPrompt ?? '',
      hashtags: pkg.hashtags.join(', '),
      recommendedMedia: pkg.recommendedMedia ?? '',
      recommendedPostingTime: pkg.recommendedPostingTime ?? '',
      whatsappTemplate: pkg.whatsappTemplate ?? '',
      emailSubjectTemplate: pkg.emailSubjectTemplate ?? '',
      emailTemplate: pkg.emailTemplate ?? '',
      followUpSequenceId: pkg.followUpSequenceId ?? '',
      marketingSegment: JSON.stringify(pkg.marketingSegment ?? {}, null, 2),
      status: pkg.status,
    })
    setEditingId(pkg.id)
    setFormOpen(true)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name.trim()) return

    let marketingSegment: Record<string, unknown>
    try {
      marketingSegment = form.marketingSegment.trim() ? JSON.parse(form.marketingSegment) : {}
    } catch {
      toast.error('Marketing Segment must be valid JSON (e.g. {"event_type":"wedding"})')
      return
    }

    const splitList = (s: string) => s.split(',').map((v) => v.trim()).filter(Boolean)

    const body = {
      name: form.name.trim(),
      category: form.category.trim() || null,
      description: form.description.trim() || null,
      target_audience: form.targetAudience.trim() || null,
      highlights: splitList(form.highlights),
      budget_range: form.budgetRange.trim() || null,
      cta: form.cta.trim() || null,
      landing_page_slug: form.landingPageSlug.trim() || null,
      pricing_package_id: form.pricingPackageId || null,
      proposal_template_notes: form.proposalTemplateNotes.trim() || null,
      ai_prompt: form.aiPrompt.trim() || null,
      hashtags: splitList(form.hashtags),
      recommended_media: form.recommendedMedia.trim() || null,
      recommended_posting_time: form.recommendedPostingTime.trim() || null,
      whatsapp_template: form.whatsappTemplate.trim() || null,
      email_subject_template: form.emailSubjectTemplate.trim() || null,
      email_template: form.emailTemplate.trim() || null,
      follow_up_sequence_id: form.followUpSequenceId || null,
      marketing_segment: marketingSegment,
      status: form.status,
    }

    setSaving(true)
    try {
      const res = await fetch(editingId ? `/api/business-packages/${editingId}` : '/api/business-packages', {
        method: editingId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        const detail = Array.isArray(data?.issues)
          ? data.issues.map((i: { path: string; message: string }) => `${i.path}: ${i.message}`).join('; ')
          : data?.error
        throw new Error(detail || `Save failed (${res.status})`)
      }
      toast.success(editingId ? 'Package updated.' : 'Package created.')
      resetForm()
      setFormOpen(false)
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save package')
    } finally {
      setSaving(false)
    }
  }

  async function handleStatusChange(id: string, status: BusinessPackage['status']) {
    try {
      const res = await fetch(`/api/business-packages/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(data?.error || 'Failed to update status'); return }
      toast.success(`Package ${status}.`)
      await load()
    } catch {
      toast.error('Failed to update status')
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
              <Package className="w-5 h-5" /> Business Packages
            </h1>
            <p className="text-sm text-gray-500">
              Configurable marketing packages — landing page, AI prompt, WhatsApp/email templates, follow-up sequence, and target segment, all editable here.
            </p>
          </div>
          <button
            onClick={openCreate}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
          >
            <Plus className="w-4 h-4" /> New Package
          </button>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-6">
        {formOpen && (
          <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-blue-200 p-6 mb-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold text-gray-900">{editingId ? 'Edit Package' : 'New Package'}</h2>
              <button type="button" onClick={() => { setFormOpen(false); resetForm() }} aria-label="Close" className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Name<span className="text-red-500 ml-0.5">*</span></label>
                <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required
                  placeholder="e.g. Pre-Wedding Celebration"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
                <input value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                  list="business-package-categories" placeholder="e.g. Wedding"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                <datalist id="business-package-categories">
                  {SUGGESTED_CATEGORIES.map((c) => <option key={c} value={c} />)}
                </datalist>
              </div>
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
              <textarea value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} rows={2}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Target Audience</label>
                <input value={form.targetAudience} onChange={(e) => setForm((f) => ({ ...f, targetAudience: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Budget Range</label>
                <input value={form.budgetRange} onChange={(e) => setForm((f) => ({ ...f, budgetRange: e.target.value }))}
                  placeholder="e.g. ₹40,000 – ₹90,000"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">Package Highlights <span className="text-xs text-gray-400">(comma-separated)</span></label>
              <input value={form.highlights} onChange={(e) => setForm((f) => ({ ...f, highlights: e.target.value }))}
                placeholder="Rooftop skyline backdrop, Customizable decor, Photography-friendly lighting"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">CTA</label>
                <input value={form.cta} onChange={(e) => setForm((f) => ({ ...f, cta: e.target.value }))}
                  placeholder="e.g. Book a site visit"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Landing Page Slug</label>
                <input value={form.landingPageSlug} onChange={(e) => setForm((f) => ({ ...f, landingPageSlug: e.target.value.toLowerCase() }))}
                  placeholder="e.g. pre-wedding-celebration"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                <p className="text-xs text-gray-400 mt-1">Renders at bookmyspaces.in/&lt;slug&gt; when Active. Leave empty to reuse an existing landing page.</p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Proposal Template — linked pricing package</label>
                <select value={form.pricingPackageId} onChange={(e) => setForm((f) => ({ ...f, pricingPackageId: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="">None</option>
                  {pricingPackages.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.venue})</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Follow-up Sequence</label>
                <select value={form.followUpSequenceId} onChange={(e) => setForm((f) => ({ ...f, followUpSequenceId: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="">None</option>
                  {dripSequences.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">Proposal Template Notes</label>
              <textarea value={form.proposalTemplateNotes} onChange={(e) => setForm((f) => ({ ...f, proposalTemplateNotes: e.target.value }))} rows={2}
                placeholder="Guidance seeded into the proposal's AI cover note when this package is used"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>

            <div className="rounded-lg border border-violet-100 bg-violet-50 p-3 mb-4">
              <label className="block text-xs font-semibold text-violet-700 mb-1.5">AI Prompt (fed to the AI Content Generator in Content Studio)</label>
              <textarea value={form.aiPrompt} onChange={(e) => setForm((f) => ({ ...f, aiPrompt: e.target.value }))} rows={2}
                className="w-full px-3 py-2 border border-violet-200 rounded-lg text-sm mb-2 focus:outline-none focus:ring-2 focus:ring-violet-400" />
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                <input value={form.hashtags} onChange={(e) => setForm((f) => ({ ...f, hashtags: e.target.value }))}
                  placeholder="Hashtags, comma-separated"
                  className="px-2 py-1.5 border border-violet-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-violet-400" />
                <input value={form.recommendedMedia} onChange={(e) => setForm((f) => ({ ...f, recommendedMedia: e.target.value }))}
                  placeholder="Recommended media"
                  className="px-2 py-1.5 border border-violet-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-violet-400" />
                <input value={form.recommendedPostingTime} onChange={(e) => setForm((f) => ({ ...f, recommendedPostingTime: e.target.value }))}
                  placeholder="Recommended posting time"
                  className="px-2 py-1.5 border border-violet-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-violet-400" />
              </div>
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">WhatsApp Template <span className="text-xs text-gray-400">(use {'{{name}}'} as a placeholder)</span></label>
              <textarea value={form.whatsappTemplate} onChange={(e) => setForm((f) => ({ ...f, whatsappTemplate: e.target.value }))} rows={2}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
              <div className="md:col-span-1">
                <label className="block text-sm font-medium text-gray-700 mb-1">Email Subject</label>
                <input value={form.emailSubjectTemplate} onChange={(e) => setForm((f) => ({ ...f, emailSubjectTemplate: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">Email Template <span className="text-xs text-gray-400">(use {'{{name}}'})</span></label>
                <textarea value={form.emailTemplate} onChange={(e) => setForm((f) => ({ ...f, emailTemplate: e.target.value }))} rows={2}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Marketing Segment <span className="text-xs text-gray-400">(JSON filter)</span></label>
                <textarea value={form.marketingSegment} onChange={(e) => setForm((f) => ({ ...f, marketingSegment: e.target.value }))} rows={2}
                  placeholder='{"event_type":"wedding"}'
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-xs font-mono focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
                <select value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as BusinessPackage['status'] }))}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                  <option value="retired">Retired</option>
                </select>
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => { setFormOpen(false); resetForm() }} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900">Cancel</button>
              <button type="submit" disabled={saving}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-60">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save Package
              </button>
            </div>
          </form>
        )}

        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          {loading ? (
            <div className="p-8 text-center text-sm text-gray-500">Loading…</div>
          ) : packages.length === 0 ? (
            <div className="p-8 text-center text-sm text-gray-500">No packages yet. Use “New Package” to create your first one.</div>
          ) : (
            <ul className="divide-y divide-gray-50">
              {packages.map((pkg) => (
                <li key={pkg.id} className="px-5 py-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-gray-800">{pkg.name}</span>
                        {pkg.category && <span className="text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-700">{pkg.category}</span>}
                        <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_STYLES[pkg.status]}`}>{pkg.status}</span>
                        {pkg.landingPageSlug && <span className="text-xs text-gray-400">/{pkg.landingPageSlug}</span>}
                      </div>
                      {pkg.description && <p className="text-xs text-gray-500 mt-1 line-clamp-2">{pkg.description}</p>}
                    </div>
                    <div className="shrink-0 flex items-center gap-1.5">
                      <button onClick={() => openEdit(pkg)} className="text-xs px-2 py-1 rounded border border-gray-200 text-gray-600 hover:bg-gray-50 inline-flex items-center gap-1">
                        <Pencil className="w-3.5 h-3.5" /> Edit
                      </button>
                      {pkg.status !== 'active' && pkg.status !== 'retired' && (
                        <button onClick={() => handleStatusChange(pkg.id, 'active')} className="text-xs px-2 py-1 rounded border border-emerald-200 text-emerald-700 hover:bg-emerald-50 inline-flex items-center gap-1">
                          <PlayCircle className="w-3.5 h-3.5" /> Activate
                        </button>
                      )}
                      {pkg.status === 'active' && (
                        <button onClick={() => handleStatusChange(pkg.id, 'inactive')} className="text-xs px-2 py-1 rounded border border-amber-200 text-amber-700 hover:bg-amber-50 inline-flex items-center gap-1">
                          <Power className="w-3.5 h-3.5" /> Deactivate
                        </button>
                      )}
                      {pkg.status !== 'retired' && (
                        <button onClick={() => handleStatusChange(pkg.id, 'retired')} className="text-xs px-2 py-1 rounded border border-red-200 text-red-700 hover:bg-red-50 inline-flex items-center gap-1">
                          <Ban className="w-3.5 h-3.5" /> Retire
                        </button>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
