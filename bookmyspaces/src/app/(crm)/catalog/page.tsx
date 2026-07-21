'use client'

// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/app/(crm)/catalog/page.tsx
// V3 Phase 2b — Admin CRUD UI for the hospitality catalog
// (VERSION1_1_ROADMAP.md Tier 1 #1: previously raw Supabase SQL only).
//
// One page, five entity tabs (properties / rooms & venues / rate plans /
// meal plans / add-ons), each driven by a shared field-config table rather
// than five hand-written forms. Talks to /api/admin/catalog/[entity].
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Building2, BedDouble, IndianRupee, UtensilsCrossed, Sparkles,
  Plus, Pencil, X, Save, EyeOff, RefreshCw, AlertCircle,
} from 'lucide-react'

type Entity = 'properties' | 'inventory-items' | 'rate-plans' | 'meal-plans' | 'addon-services'

type FieldType = 'text' | 'number' | 'textarea' | 'select' | 'checkbox' | 'date' | 'csv'

interface FieldDef {
  key: string
  label: string
  type: FieldType
  required?: boolean
  options?: { value: string; label: string }[]
  /** options loaded at runtime: 'properties' | 'inventory-items' */
  optionsFrom?: 'properties' | 'inventory-items'
  hint?: string
}

type Row = Record<string, unknown>

const INVENTORY_TYPES = [
  'room', 'suite', 'apartment', 'banquet_hall', 'conference_hall',
  'rooftop', 'restaurant_event_area', 'wedding_venue', 'birthday_venue', 'meeting_room',
]
const RATE_TYPES = ['base', 'weekend', 'seasonal', 'festival', 'holiday', 'corporate', 'ota', 'promotional']
const MEAL_CODES = [
  { value: 'room_only', label: 'Room Only (EP)' },
  { value: 'breakfast', label: 'Breakfast (CP)' },
  { value: 'map', label: 'Breakfast + 1 Meal (MAP)' },
  { value: 'ap', label: 'All Meals (AP)' },
]

const ENTITY_CONFIG: Record<Entity, {
  label: string
  icon: React.ElementType
  fields: FieldDef[]
  listColumns: { key: string; label: string }[]
}> = {
  'properties': {
    label: 'Properties',
    icon: Building2,
    fields: [
      { key: 'name', label: 'Name', type: 'text', required: true },
      { key: 'slug', label: 'Slug', type: 'text', required: true, hint: 'lowercase-with-hyphens, stable id' },
      { key: 'address', label: 'Address', type: 'textarea' },
      { key: 'city', label: 'City', type: 'text' },
      { key: 'contact_phone', label: 'Contact Phone', type: 'text' },
      { key: 'contact_email', label: 'Contact Email', type: 'text' },
      { key: 'gst_number', label: 'GST Number', type: 'text' },
      { key: 'google_maps_url', label: 'Google Maps URL', type: 'text' },
      { key: 'amenities', label: 'Amenities', type: 'csv', hint: 'comma-separated, e.g. WiFi, Parking, AC' },
      { key: 'policies', label: 'Policies', type: 'textarea' },
    ],
    listColumns: [
      { key: 'name', label: 'Name' },
      { key: 'slug', label: 'Slug' },
      { key: 'city', label: 'City' },
      { key: 'contact_phone', label: 'Phone' },
    ],
  },
  'inventory-items': {
    label: 'Rooms & Venues',
    icon: BedDouble,
    fields: [
      { key: 'property_id', label: 'Property', type: 'select', required: true, optionsFrom: 'properties' },
      {
        key: 'inventory_type', label: 'Type', type: 'select', required: true,
        options: INVENTORY_TYPES.map((t) => ({ value: t, label: t.replace(/_/g, ' ') })),
      },
      { key: 'name', label: 'Name', type: 'text', required: true },
      { key: 'description', label: 'Description', type: 'textarea' },
      { key: 'max_occupancy', label: 'Max Occupancy', type: 'number' },
      { key: 'base_capacity', label: 'Base Capacity', type: 'number' },
    ],
    listColumns: [
      { key: 'name', label: 'Name' },
      { key: 'inventory_type', label: 'Type' },
      { key: 'max_occupancy', label: 'Max Occ.' },
      { key: 'base_capacity', label: 'Base Cap.' },
    ],
  },
  'rate-plans': {
    label: 'Rate Plans',
    icon: IndianRupee,
    fields: [
      { key: 'inventory_item_id', label: 'Room / Venue', type: 'select', required: true, optionsFrom: 'inventory-items' },
      {
        key: 'rate_type', label: 'Rate Type', type: 'select', required: true,
        options: RATE_TYPES.map((t) => ({ value: t, label: t })),
      },
      { key: 'price', label: 'Price', type: 'number', required: true },
      { key: 'start_date', label: 'Start Date', type: 'date', hint: 'blank = always applies' },
      { key: 'end_date', label: 'End Date', type: 'date' },
      { key: 'priority', label: 'Priority', type: 'number', hint: 'higher wins when ranges overlap' },
    ],
    listColumns: [
      { key: 'rate_type', label: 'Type' },
      { key: 'price', label: 'Price' },
      { key: 'start_date', label: 'From' },
      { key: 'end_date', label: 'To' },
      { key: 'priority', label: 'Priority' },
    ],
  },
  'meal-plans': {
    label: 'Meal Plans',
    icon: UtensilsCrossed,
    fields: [
      { key: 'property_id', label: 'Property', type: 'select', required: true, optionsFrom: 'properties' },
      { key: 'code', label: 'Plan Code', type: 'select', required: true, options: MEAL_CODES },
      { key: 'name', label: 'Name', type: 'text', required: true },
      { key: 'description', label: 'Description', type: 'textarea' },
      { key: 'price', label: 'Price (per person/night)', type: 'number', required: true },
    ],
    listColumns: [
      { key: 'name', label: 'Name' },
      { key: 'code', label: 'Code' },
      { key: 'price', label: 'Price' },
    ],
  },
  'addon-services': {
    label: 'Add-on Services',
    icon: Sparkles,
    fields: [
      { key: 'property_id', label: 'Property', type: 'select', required: true, optionsFrom: 'properties' },
      { key: 'name', label: 'Name', type: 'text', required: true },
      { key: 'category', label: 'Category', type: 'text', hint: 'e.g. transport, decoration, photography' },
      { key: 'price', label: 'Price', type: 'number', required: true },
    ],
    listColumns: [
      { key: 'name', label: 'Name' },
      { key: 'category', label: 'Category' },
      { key: 'price', label: 'Price' },
    ],
  },
}

const NUMBER_KEYS = new Set(['price', 'priority', 'max_occupancy', 'base_capacity'])

function toPayload(entity: Entity, form: Record<string, string>): Row {
  const payload: Row = {}
  for (const field of ENTITY_CONFIG[entity].fields) {
    const raw = form[field.key] ?? ''
    if (raw === '') {
      // omit empty optional fields entirely; required empties are caught by the API
      continue
    }
    if (field.type === 'number' || NUMBER_KEYS.has(field.key)) payload[field.key] = Number(raw)
    else if (field.type === 'csv') payload[field.key] = raw.split(',').map((s) => s.trim()).filter(Boolean)
    else payload[field.key] = raw
  }
  return payload
}

function rowToForm(entity: Entity, row: Row): Record<string, string> {
  const form: Record<string, string> = {}
  for (const field of ENTITY_CONFIG[entity].fields) {
    const v = row[field.key]
    if (v === null || v === undefined) form[field.key] = ''
    else if (Array.isArray(v)) form[field.key] = v.join(', ')
    else form[field.key] = String(v)
  }
  return form
}

export default function CatalogPage() {
  const [entity, setEntity] = useState<Entity>('properties')
  const [rows, setRows] = useState<Row[]>([])
  const [propertyOptions, setPropertyOptions] = useState<{ value: string; label: string }[]>([])
  const [inventoryOptions, setInventoryOptions] = useState<{ value: string; label: string }[]>([])
  const [showInactive, setShowInactive] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

  const cfg = ENTITY_CONFIG[entity]

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/catalog/${entity}${showInactive ? '?includeInactive=1' : ''}`)
      if (!res.ok) throw new Error(String(res.status))
      const json = await res.json()
      setRows(json.rows ?? [])
    } catch {
      setError('Failed to load. You may need admin access, or the V3 migration may not be applied yet.')
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [entity, showInactive])

  useEffect(() => {
    load()
  }, [load])

  // reference data for select fields
  useEffect(() => {
    fetch('/api/admin/catalog/properties')
      .then((r) => (r.ok ? r.json() : { rows: [] }))
      .then((j) => setPropertyOptions((j.rows ?? []).map((p: Row) => ({ value: String(p.id), label: String(p.name) }))))
      .catch(() => setPropertyOptions([]))
    fetch('/api/admin/catalog/inventory-items')
      .then((r) => (r.ok ? r.json() : { rows: [] }))
      .then((j) => setInventoryOptions((j.rows ?? []).map((i: Row) => ({ value: String(i.id), label: String(i.name) }))))
      .catch(() => setInventoryOptions([]))
  }, [entity, formOpen])

  const optionsFor = useMemo(
    () => (field: FieldDef) => {
      if (field.optionsFrom === 'properties') return propertyOptions
      if (field.optionsFrom === 'inventory-items') return inventoryOptions
      return field.options ?? []
    },
    [propertyOptions, inventoryOptions]
  )

  function openCreate() {
    setEditingId(null)
    setForm({})
    setFormOpen(true)
  }

  function openEdit(row: Row) {
    setEditingId(String(row.id))
    setForm(rowToForm(entity, row))
    setFormOpen(true)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const payload = toPayload(entity, form)
      const url = editingId ? `/api/admin/catalog/${entity}/${editingId}` : `/api/admin/catalog/${entity}`
      const res = await fetch(url, {
        method: editingId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const json = await res.json()
      if (!res.ok) {
        const detail = Array.isArray(json?.issues)
          ? json.issues.map((i: { path: string; message: string }) => `${i.path}: ${i.message}`).join('; ')
          : json?.error
        throw new Error(detail || `save failed (${res.status})`)
      }
      setFormOpen(false)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function handleDeactivate(row: Row) {
    if (!window.confirm(`Deactivate "${row.name ?? row.id}"? It will stop appearing in booking flows but history is kept.`)) return
    try {
      const res = await fetch(`/api/admin/catalog/${entity}/${row.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error(String(res.status))
      await load()
    } catch {
      setError('Failed to deactivate')
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">Catalog</h1>
            <p className="text-sm text-gray-500">
              Properties, rooms &amp; venues, pricing, meal plans and add-ons — the single source the booking engine and AI quote from
            </p>
          </div>
          <button
            onClick={openCreate}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
          >
            <Plus className="w-4 h-4" />
            New {cfg.label.replace(/s$/, '')}
          </button>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-6">
        {/* Entity tabs */}
        <div className="flex gap-1 bg-white border border-gray-200 rounded-xl p-1 mb-4 overflow-x-auto">
          {(Object.keys(ENTITY_CONFIG) as Entity[]).map((key) => {
            const tab = ENTITY_CONFIG[key]
            return (
              <button
                key={key}
                onClick={() => { setEntity(key); setFormOpen(false) }}
                className={`flex items-center gap-2 flex-1 justify-center px-4 py-2.5 rounded-lg text-sm font-medium whitespace-nowrap transition-all ${
                  entity === key ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                }`}
              >
                <tab.icon className="w-4 h-4" />
                {tab.label}
              </button>
            )
          })}
        </div>

        <div className="flex items-center justify-between mb-4">
          <label className="flex items-center gap-2 text-sm text-gray-600">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(e) => setShowInactive(e.target.checked)}
              className="rounded border-gray-300"
            />
            Show deactivated
          </label>
          <button onClick={load} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800">
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </button>
        </div>

        {error && (
          <div className="flex items-center gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-4 py-3 mb-4">
            <AlertCircle className="w-4 h-4 shrink-0" /> {error}
          </div>
        )}

        {/* Create / edit form */}
        {formOpen && (
          <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-blue-200 p-6 mb-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold text-gray-900">
                {editingId ? `Edit ${cfg.label.replace(/s$/, '')}` : `New ${cfg.label.replace(/s$/, '')}`}
              </h2>
              <button type="button" onClick={() => setFormOpen(false)} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {cfg.fields.map((field) => (
                <div key={field.key} className={field.type === 'textarea' ? 'md:col-span-2' : ''}>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {field.label}
                    {field.required && <span className="text-red-500 ml-0.5">*</span>}
                  </label>
                  {field.type === 'select' ? (
                    <select
                      value={form[field.key] ?? ''}
                      onChange={(e) => setForm((f) => ({ ...f, [field.key]: e.target.value }))}
                      required={field.required}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">— select —</option>
                      {optionsFor(field).map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  ) : field.type === 'textarea' ? (
                    <textarea
                      value={form[field.key] ?? ''}
                      onChange={(e) => setForm((f) => ({ ...f, [field.key]: e.target.value }))}
                      rows={3}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  ) : (
                    <input
                      type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'}
                      step={field.type === 'number' ? 'any' : undefined}
                      value={form[field.key] ?? ''}
                      onChange={(e) => setForm((f) => ({ ...f, [field.key]: e.target.value }))}
                      required={field.required}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  )}
                  {field.hint && <p className="text-xs text-gray-400 mt-1">{field.hint}</p>}
                </div>
              ))}
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button
                type="button"
                onClick={() => setFormOpen(false)}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-60"
              >
                <Save className="w-4 h-4" />
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </form>
        )}

        {/* List */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          {loading ? (
            <div className="p-8 text-center text-sm text-gray-500">Loading…</div>
          ) : rows.length === 0 ? (
            <div className="p-8 text-center text-sm text-gray-500">
              Nothing here yet. Use “New {cfg.label.replace(/s$/, '')}” to add the first one.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                  {cfg.listColumns.map((c) => (
                    <th key={c.key} className="px-4 py-3 font-medium">{c.label}</th>
                  ))}
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={String(row.id)} className="border-b border-gray-50 hover:bg-gray-50">
                    {cfg.listColumns.map((c) => (
                      <td key={c.key} className="px-4 py-3 text-gray-800">
                        {row[c.key] === null || row[c.key] === undefined || row[c.key] === '' ? '—' : String(row[c.key])}
                      </td>
                    ))}
                    <td className="px-4 py-3">
                      {row.is_active === false ? (
                        <span className="inline-flex px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 text-xs">inactive</span>
                      ) : (
                        <span className="inline-flex px-2 py-0.5 rounded-full bg-green-50 text-green-700 text-xs">active</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <button
                        onClick={() => openEdit(row)}
                        className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-800 mr-3"
                      >
                        <Pencil className="w-3.5 h-3.5" /> Edit
                      </button>
                      {row.is_active !== false && (
                        <button
                          onClick={() => handleDeactivate(row)}
                          className="inline-flex items-center gap-1 text-gray-400 hover:text-red-600"
                        >
                          <EyeOff className="w-3.5 h-3.5" /> Deactivate
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
