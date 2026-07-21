'use client'

// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/app/(crm)/knowledge-base/page.tsx
// V3 Phase 2c — admin UI for the CRM-editable AI knowledge base
// (`knowledge_sources`) and versioned AI prompts (`ai_prompts`).
//
// This is where hardcoded AI facts move to: property info, pricing notes,
// policies, FAQs. The AI grounds its customer-facing answers here — editing
// a row here changes what the AI says without a deploy.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useState } from 'react'
import {
  BookOpen, Brain, Plus, Pencil, X, Save, EyeOff, RefreshCw, AlertCircle,
  CheckCircle, History,
} from 'lucide-react'

interface KnowledgeSource {
  id: string
  category: string
  title: string
  content: string
  is_active: boolean
  has_embedding: boolean
}

interface AIPrompt {
  id: string
  name: string
  prompt_template: string
  version: number
  is_active: boolean
  created_at: string
}

const CATEGORIES = ['property', 'rooms', 'pricing', 'packages', 'policies', 'faq', 'offers', 'general']

export default function KnowledgeBasePage() {
  const [tab, setTab] = useState<'knowledge' | 'prompts'>('knowledge')
  const [sources, setSources] = useState<KnowledgeSource[]>([])
  const [prompts, setPrompts] = useState<AIPrompt[]>([])
  const [showInactive, setShowInactive] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  // knowledge form
  const [formOpen, setFormOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [category, setCategory] = useState('general')
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [saving, setSaving] = useState(false)

  // prompt form
  const [promptFormOpen, setPromptFormOpen] = useState(false)
  const [promptName, setPromptName] = useState('')
  const [promptTemplate, setPromptTemplate] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      if (tab === 'knowledge') {
        const res = await fetch(`/api/admin/knowledge-sources${showInactive ? '?includeInactive=1' : ''}`)
        if (!res.ok) throw new Error(String(res.status))
        setSources((await res.json()).sources ?? [])
      } else {
        const res = await fetch('/api/admin/ai-prompts')
        if (!res.ok) throw new Error(String(res.status))
        setPrompts((await res.json()).prompts ?? [])
      }
    } catch {
      setError('Failed to load. You may need admin access, or the V3 migration may not be applied yet.')
    } finally {
      setLoading(false)
    }
  }, [tab, showInactive])

  useEffect(() => { load() }, [load])

  function openCreate() {
    setEditingId(null); setCategory('general'); setTitle(''); setContent(''); setFormOpen(true)
  }
  function openEdit(s: KnowledgeSource) {
    setEditingId(s.id); setCategory(s.category); setTitle(s.title); setContent(s.content); setFormOpen(true)
  }

  async function saveKnowledge(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true); setError(null); setNotice(null)
    try {
      const res = await fetch(
        editingId ? `/api/admin/knowledge-sources/${editingId}` : '/api/admin/knowledge-sources',
        {
          method: editingId ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ category, title, content }),
        }
      )
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error || `save failed (${res.status})`)
      if (json.source && !json.source.has_embedding) {
        setNotice('Saved. Embedding could not be generated (missing OpenAI key?) — keyword retrieval still works; re-save later to embed.')
      }
      setFormOpen(false)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function deactivateKnowledge(s: KnowledgeSource) {
    if (!window.confirm(`Deactivate "${s.title}"? The AI will stop using it.`)) return
    const res = await fetch(`/api/admin/knowledge-sources/${s.id}`, { method: 'DELETE' })
    if (res.ok) await load()
    else setError('Failed to deactivate')
  }

  async function savePrompt(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true); setError(null)
    try {
      const res = await fetch('/api/admin/ai-prompts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: promptName, prompt_template: promptTemplate }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error || `save failed (${res.status})`)
      setPromptFormOpen(false)
      setPromptName(''); setPromptTemplate('')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function activateVersion(p: AIPrompt) {
    if (!window.confirm(`Activate "${p.name}" v${p.version}? This becomes the live prompt immediately.`)) return
    const res = await fetch(`/api/admin/ai-prompts/${p.id}`, { method: 'POST' })
    if (res.ok) await load()
    else setError('Failed to activate version')
  }

  function newVersionOf(p: AIPrompt) {
    setPromptName(p.name)
    setPromptTemplate(p.prompt_template)
    setPromptFormOpen(true)
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">AI Knowledge Base</h1>
            <p className="text-sm text-gray-500">
              What the AI knows and how it speaks — edits apply without a deploy
            </p>
          </div>
          <button
            onClick={() => (tab === 'knowledge' ? openCreate() : setPromptFormOpen(true))}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
          >
            <Plus className="w-4 h-4" />
            {tab === 'knowledge' ? 'New Entry' : 'New Prompt Version'}
          </button>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-6">
        <div className="flex gap-1 bg-white border border-gray-200 rounded-xl p-1 mb-4">
          <button
            onClick={() => setTab('knowledge')}
            className={`flex items-center gap-2 flex-1 justify-center px-4 py-2.5 rounded-lg text-sm font-medium ${
              tab === 'knowledge' ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-50'
            }`}
          >
            <BookOpen className="w-4 h-4" /> Knowledge Entries
          </button>
          <button
            onClick={() => setTab('prompts')}
            className={`flex items-center gap-2 flex-1 justify-center px-4 py-2.5 rounded-lg text-sm font-medium ${
              tab === 'prompts' ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-50'
            }`}
          >
            <Brain className="w-4 h-4" /> AI Prompts
          </button>
        </div>

        {tab === 'knowledge' && (
          <div className="flex items-center justify-between mb-4">
            <label className="flex items-center gap-2 text-sm text-gray-600">
              <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} className="rounded border-gray-300" />
              Show deactivated
            </label>
            <button onClick={load} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800">
              <RefreshCw className="w-3.5 h-3.5" /> Refresh
            </button>
          </div>
        )}

        {error && (
          <div className="flex items-center gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-4 py-3 mb-4">
            <AlertCircle className="w-4 h-4 shrink-0" /> {error}
          </div>
        )}
        {notice && (
          <div className="flex items-center gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 mb-4">
            <AlertCircle className="w-4 h-4 shrink-0" /> {notice}
          </div>
        )}

        {/* Knowledge form */}
        {tab === 'knowledge' && formOpen && (
          <form onSubmit={saveKnowledge} className="bg-white rounded-xl border border-blue-200 p-6 mb-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold text-gray-900">{editingId ? 'Edit Entry' : 'New Entry'}</h2>
              <button type="button" onClick={() => setFormOpen(false)} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
                <select value={category} onChange={(e) => setCategory(e.target.value)} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm">
                  {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Title<span className="text-red-500 ml-0.5">*</span></label>
                <input value={title} onChange={(e) => setTitle(e.target.value)} required className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" placeholder="e.g. Rooftop wedding package pricing" />
              </div>
            </div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Content<span className="text-red-500 ml-0.5">*</span></label>
            <textarea value={content} onChange={(e) => setContent(e.target.value)} required rows={8} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm font-mono" placeholder="Facts the AI should use when answering customers…" />
            <div className="flex justify-end gap-2 mt-4">
              <button type="button" onClick={() => setFormOpen(false)} className="px-4 py-2 text-sm text-gray-600">Cancel</button>
              <button type="submit" disabled={saving} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium disabled:opacity-60">
                <Save className="w-4 h-4" /> {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </form>
        )}

        {/* Prompt form */}
        {tab === 'prompts' && promptFormOpen && (
          <form onSubmit={savePrompt} className="bg-white rounded-xl border border-blue-200 p-6 mb-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold text-gray-900">New Prompt Version</h2>
              <button type="button" onClick={() => setPromptFormOpen(false)} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
            </div>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">Prompt Name<span className="text-red-500 ml-0.5">*</span></label>
              <input value={promptName} onChange={(e) => setPromptName(e.target.value)} required pattern="[a-z0-9_.-]+" className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm font-mono" placeholder="e.g. system.customer_chat" />
              <p className="text-xs text-gray-400 mt-1">Saving under an existing name creates the next version and activates it. Old versions stay for rollback.</p>
            </div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Template<span className="text-red-500 ml-0.5">*</span></label>
            <textarea value={promptTemplate} onChange={(e) => setPromptTemplate(e.target.value)} required rows={12} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm font-mono" />
            <div className="flex justify-end gap-2 mt-4">
              <button type="button" onClick={() => setPromptFormOpen(false)} className="px-4 py-2 text-sm text-gray-600">Cancel</button>
              <button type="submit" disabled={saving} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium disabled:opacity-60">
                <Save className="w-4 h-4" /> {saving ? 'Saving…' : 'Save & Activate'}
              </button>
            </div>
          </form>
        )}

        {/* Lists */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          {loading ? (
            <div className="p-8 text-center text-sm text-gray-500">Loading…</div>
          ) : tab === 'knowledge' ? (
            sources.length === 0 ? (
              <div className="p-8 text-center text-sm text-gray-500">No knowledge entries yet. Add property facts, pricing, policies and FAQs here.</div>
            ) : (
              <ul className="divide-y divide-gray-50">
                {sources.map((s) => (
                  <li key={s.id} className="px-5 py-4 hover:bg-gray-50">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="inline-flex px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 text-xs">{s.category}</span>
                          {!s.is_active && <span className="inline-flex px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 text-xs">inactive</span>}
                          {s.has_embedding
                            ? <span className="inline-flex items-center gap-1 text-xs text-green-600"><CheckCircle className="w-3 h-3" /> embedded</span>
                            : <span className="inline-flex items-center gap-1 text-xs text-amber-600"><AlertCircle className="w-3 h-3" /> keyword-only</span>}
                        </div>
                        <p className="text-sm font-medium text-gray-900 mt-1">{s.title}</p>
                        <p className="text-sm text-gray-500 mt-0.5 line-clamp-2">{s.content}</p>
                      </div>
                      <div className="shrink-0 whitespace-nowrap">
                        <button onClick={() => openEdit(s)} className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-800 text-sm mr-3"><Pencil className="w-3.5 h-3.5" /> Edit</button>
                        {s.is_active && (
                          <button onClick={() => deactivateKnowledge(s)} className="inline-flex items-center gap-1 text-gray-400 hover:text-red-600 text-sm"><EyeOff className="w-3.5 h-3.5" /> Deactivate</button>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )
          ) : prompts.length === 0 ? (
            <div className="p-8 text-center text-sm text-gray-500">
              No prompts yet. The AI currently uses its built-in default prompt; create <code className="font-mono">system.customer_chat</code> to override it.
            </div>
          ) : (
            <ul className="divide-y divide-gray-50">
              {prompts.map((p) => (
                <li key={p.id} className="px-5 py-4 hover:bg-gray-50">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-mono font-medium text-gray-900">{p.name}</span>
                        <span className="text-xs text-gray-400">v{p.version}</span>
                        {p.is_active && <span className="inline-flex px-2 py-0.5 rounded-full bg-green-50 text-green-700 text-xs">active</span>}
                      </div>
                      <p className="text-sm text-gray-500 mt-1 line-clamp-2 font-mono">{p.prompt_template}</p>
                    </div>
                    <div className="shrink-0 whitespace-nowrap">
                      <button onClick={() => newVersionOf(p)} className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-800 text-sm mr-3"><Pencil className="w-3.5 h-3.5" /> New version</button>
                      {!p.is_active && (
                        <button onClick={() => activateVersion(p)} className="inline-flex items-center gap-1 text-gray-500 hover:text-gray-800 text-sm"><History className="w-3.5 h-3.5" /> Activate</button>
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
