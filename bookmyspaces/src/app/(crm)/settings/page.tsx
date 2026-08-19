'use client'

import { useEffect, useState } from 'react'
import {
  Settings,
  Bell,
  MessageSquare,
  Brain,
  Building2,
  Save,
  CheckCircle,
  AlertCircle,
  Phone,
  Mail,
  Globe,
  Key,
  Link2,
} from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────

interface VenueSettings {
  venueName: string
  phone: string
  email: string
  website: string
  address: string
  standardCapacity: number
  hallCapacity: number
  currency: string
}

interface AISettings {
  model: string
  maxTokens: number
  temperature: number
  systemLanguage: string
  autoReply: boolean
  replyDelay: number
  confidenceThreshold: number
  autoHandoff: boolean
}

interface NotificationSettings {
  hotLeadAlert: boolean
  newInquiryAlert: boolean
  followUpReminder: boolean
  dailySummary: boolean
  adminEmail: string
}

interface WhatsAppSettings {
  verifyToken: string
  phoneNumberId: string
  accessTokenSet: boolean
  webhookUrl: string
}

interface AppSettings {
  venue: VenueSettings
  ai: AISettings
  notifications: NotificationSettings
  whatsapp: WhatsAppSettings
}

// ─── Defaults ─────────────────────────────────────────────────────────────────

const defaultSettings: AppSettings = {
  venue: {
    venueName: 'BookMySpaces',
    phone: '9830509991',
    email: 'info@bookmyspaces.in',
    website: 'https://bookmyspaces.in',
    address: 'Kolkata, West Bengal, India',
    standardCapacity: 70,
    hallCapacity: 120,
    currency: 'INR',
  },
  ai: {
    model: 'claude-haiku-4-5-20251001',
    maxTokens: 800,
    temperature: 0.7,
    systemLanguage: 'auto',
    autoReply: true,
    replyDelay: 0,
    confidenceThreshold: 0.6,
    autoHandoff: true,
  },
  notifications: {
    hotLeadAlert: true,
    newInquiryAlert: true,
    followUpReminder: true,
    dailySummary: true,
    adminEmail: 'admin@bookmyspaces.in',
  },
  whatsapp: {
    verifyToken: '',
    phoneNumberId: '',
    accessTokenSet: false,
    webhookUrl: '',
  },
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionHeader({
  icon: Icon,
  title,
  description,
}: {
  icon: React.ElementType
  title: string
  description: string
}) {
  return (
    <div className="flex items-start gap-3 mb-6">
      <div className="p-2 bg-blue-50 rounded-lg">
        <Icon className="w-5 h-5 text-blue-600" />
      </div>
      <div>
        <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
        <p className="text-sm text-gray-500">{description}</p>
      </div>
    </div>
  )
}

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      {children}
      {hint && <p className="mt-1 text-xs text-gray-400">{hint}</p>}
    </div>
  )
}

function TextInput({
  value,
  onChange,
  placeholder,
  type = 'text',
  disabled,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  type?: string
  disabled?: boolean
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      disabled={disabled}
      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50 disabled:text-gray-400"
    />
  )
}

function NumberInput({
  value,
  onChange,
  min,
  max,
  step,
}: {
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
  step?: number
}) {
  return (
    <input
      type="number"
      value={value}
      min={min}
      max={max}
      step={step}
      onChange={(e) => onChange(Number(e.target.value))}
      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
    />
  )
}

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
}) {
  return (
    <div className="flex items-center justify-between py-2">
      <span className="text-sm text-gray-700">{label}</span>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 ${
          checked ? 'bg-blue-600' : 'bg-gray-200'
        }`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
            checked ? 'translate-x-6' : 'translate-x-1'
          }`}
        />
      </button>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const [settings, setSettings] = useState<AppSettings>(defaultSettings)
  const [activeTab, setActiveTab] = useState<'venue' | 'ai' | 'notifications' | 'whatsapp' | 'integrations'>('venue')
  const [saving, setSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'success' | 'error'>('idle')
  const [loading, setLoading] = useState(true)

  // Load persisted settings from the backend (V3 Phase 2a — replaces the old
  // localStorage-only store). Defaults render immediately; saved values
  // overwrite them when the fetch resolves.
  useEffect(() => {
    let cancelled = false
    fetch('/api/settings')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((json) => {
        if (!cancelled && json?.settings) setSettings(json.settings)
      })
      .catch(() => {
        // Keep defaults; the page stays editable and Save will surface errors.
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  function updateVenue(key: keyof VenueSettings, value: string | number) {
    setSettings((prev) => ({
      ...prev,
      venue: { ...prev.venue, [key]: value },
    }))
  }

  function updateAI(key: keyof AISettings, value: string | number | boolean) {
    setSettings((prev) => ({
      ...prev,
      ai: { ...prev.ai, [key]: value },
    }))
  }

  function updateNotifications(key: keyof NotificationSettings, value: string | boolean) {
    setSettings((prev) => ({
      ...prev,
      notifications: { ...prev.notifications, [key]: value },
    }))
  }

  function updateWhatsApp(key: keyof WhatsAppSettings, value: string | boolean) {
    setSettings((prev) => ({
      ...prev,
      whatsapp: { ...prev.whatsapp, [key]: value },
    }))
  }

  async function handleSave() {
    setSaving(true)
    setSaveStatus('idle')
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      })
      if (!res.ok) throw new Error(`save failed: ${res.status}`)
      const json = await res.json()
      if (json?.settings) setSettings(json.settings)
      setSaveStatus('success')
      setTimeout(() => setSaveStatus('idle'), 3000)
    } catch {
      setSaveStatus('error')
    } finally {
      setSaving(false)
    }
  }

  const tabs = [
    { id: 'venue' as const, label: 'Venue', icon: Building2 },
    { id: 'ai' as const, label: 'AI Engine', icon: Brain },
    { id: 'notifications' as const, label: 'Notifications', icon: Bell },
    { id: 'whatsapp' as const, label: 'WhatsApp', icon: MessageSquare },
    { id: 'integrations' as const, label: 'Integrations', icon: Link2 },
  ]

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Settings className="w-6 h-6 text-gray-700" />
            <div>
              <h1 className="text-xl font-semibold text-gray-900">Settings</h1>
              <p className="text-sm text-gray-500">Configure your CRM platform</p>
            </div>
          </div>

          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-60 transition-colors"
          >
            {saving ? (
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              <Save className="w-4 h-4" />
            )}
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>

      {/* Save status */}
      {saveStatus !== 'idle' && (
        <div
          className={`max-w-4xl mx-auto mt-4 px-6 flex items-center gap-2 text-sm font-medium ${
            saveStatus === 'success' ? 'text-green-700' : 'text-red-700'
          }`}
        >
          {saveStatus === 'success' ? (
            <CheckCircle className="w-4 h-4" />
          ) : (
            <AlertCircle className="w-4 h-4" />
          )}
          {saveStatus === 'success' ? 'Settings saved successfully.' : 'Failed to save settings. Please try again.'}
        </div>
      )}

      <div className="max-w-4xl mx-auto px-6 py-6">
        {/* Tabs */}
        <div className="flex gap-1 bg-white border border-gray-200 rounded-xl p-1 mb-6">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 flex-1 justify-center px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${
                activeTab === tab.id
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
              }`}
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
            </button>
          ))}
        </div>

        {/* Venue Settings */}
        {activeTab === 'venue' && (
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <SectionHeader
              icon={Building2}
              title="Venue Information"
              description="Basic details about your venue shown to customers and used in AI replies"
            />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Venue Name">
                <TextInput
                  value={settings.venue.venueName}
                  onChange={(v) => updateVenue('venueName', v)}
                  placeholder="BookMySpaces"
                />
              </Field>
              <Field label="Phone Number">
                <div className="relative">
                  <Phone className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
                  <input
                    type="tel"
                    value={settings.venue.phone}
                    onChange={(e) => updateVenue('phone', e.target.value)}
                    className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </Field>
              <Field label="Email Address">
                <div className="relative">
                  <Mail className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
                  <input
                    type="email"
                    value={settings.venue.email}
                    onChange={(e) => updateVenue('email', e.target.value)}
                    className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </Field>
              <Field label="Website">
                <div className="relative">
                  <Globe className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
                  <input
                    type="url"
                    value={settings.venue.website}
                    onChange={(e) => updateVenue('website', e.target.value)}
                    className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </Field>
              <Field label="Address" hint="Used in WhatsApp replies and proposals">
                <TextInput
                  value={settings.venue.address}
                  onChange={(v) => updateVenue('address', v)}
                  placeholder="City, State, Country"
                />
              </Field>
              <Field label="Currency">
                <select
                  value={settings.venue.currency}
                  onChange={(e) => updateVenue('currency', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="INR">INR — Indian Rupee</option>
                  <option value="USD">USD — US Dollar</option>
                  <option value="GBP">GBP — British Pound</option>
                </select>
              </Field>
              <Field
                label="Standard Capacity"
                hint="Maximum guests without hall arrangement"
              >
                <NumberInput
                  value={settings.venue.standardCapacity}
                  onChange={(v) => updateVenue('standardCapacity', v)}
                  min={1}
                  max={500}
                />
              </Field>
              <Field
                label="Hall Capacity (Maximum)"
                hint="Absolute maximum with full hall arrangement"
              >
                <NumberInput
                  value={settings.venue.hallCapacity}
                  onChange={(v) => updateVenue('hallCapacity', v)}
                  min={1}
                  max={1000}
                />
              </Field>
            </div>
          </div>
        )}

        {/* AI Settings */}
        {activeTab === 'ai' && (
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <SectionHeader
              icon={Brain}
              title="AI Engine Configuration"
              description="Control how the AI assistant generates replies for your customers"
            />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Anthropic Model" hint="Haiku is fastest and most cost-efficient">
                <select
                  value={settings.ai.model}
                  onChange={(e) => updateAI('model', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="claude-haiku-4-5-20251001">Claude Haiku 4.5 (Fast — default)</option>
                  <option value="claude-3-haiku-20240307">Claude 3 Haiku (Legacy)</option>
                  <option value="claude-3-5-haiku-20241022">Claude 3.5 Haiku</option>
                  <option value="claude-3-5-sonnet-20241022">Claude 3.5 Sonnet</option>
                  <option value="claude-sonnet-4-20250514">Claude Sonnet 4</option>
                </select>
              </Field>
              <Field label="Max Reply Tokens" hint="Keep low for WhatsApp (200-400 recommended)">
                <NumberInput
                  value={settings.ai.maxTokens}
                  onChange={(v) => updateAI('maxTokens', v)}
                  min={100}
                  max={2000}
                  step={50}
                />
              </Field>
              <Field label="Response Language" hint="Auto-detect matches customer language">
                <select
                  value={settings.ai.systemLanguage}
                  onChange={(e) => updateAI('systemLanguage', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="auto">Auto-detect (Recommended)</option>
                  <option value="en">English only</option>
                  <option value="hi">Hindi only</option>
                  <option value="bn">Bengali only</option>
                </select>
              </Field>
              <Field label="Reply Delay (seconds)" hint="Adds a natural pause before sending">
                <NumberInput
                  value={settings.ai.replyDelay}
                  onChange={(v) => updateAI('replyDelay', v)}
                  min={0}
                  max={30}
                />
              </Field>
              <Field
                label="Human Handoff Confidence"
                hint="Below this confidence the AI escalates the conversation to a human"
              >
                <select
                  value={String(settings.ai.confidenceThreshold)}
                  onChange={(e) => updateAI('confidenceThreshold', Number(e.target.value))}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="0.4">Low (0.40) — escalate rarely</option>
                  <option value="0.5">Balanced (0.50)</option>
                  <option value="0.6">Standard (0.60) — recommended</option>
                  <option value="0.7">Cautious (0.70)</option>
                  <option value="0.8">Strict (0.80) — escalate often</option>
                </select>
              </Field>
              <div className="md:col-span-2 border-t border-gray-100 pt-4 space-y-1">
                <Toggle
                  checked={settings.ai.autoReply}
                  onChange={(v) => updateAI('autoReply', v)}
                  label="Enable automatic AI replies"
                />
                <Toggle
                  checked={settings.ai.autoHandoff}
                  onChange={(v) => updateAI('autoHandoff', v)}
                  label="Automatically hand off to a human when AI confidence is low"
                />
              </div>
            </div>
          </div>
        )}

        {/* Notification Settings */}
        {activeTab === 'notifications' && (
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <SectionHeader
              icon={Bell}
              title="Notification Preferences"
              description="Choose which events trigger alerts and where they are sent"
            />
            <div className="space-y-2 mb-6">
              <Toggle
                checked={settings.notifications.hotLeadAlert}
                onChange={(v) => updateNotifications('hotLeadAlert', v)}
                label="Alert when a lead is scored HOT"
              />
              <Toggle
                checked={settings.notifications.newInquiryAlert}
                onChange={(v) => updateNotifications('newInquiryAlert', v)}
                label="Alert on every new WhatsApp inquiry"
              />
              <Toggle
                checked={settings.notifications.followUpReminder}
                onChange={(v) => updateNotifications('followUpReminder', v)}
                label="Follow-up reminders for stale leads"
              />
              <Toggle
                checked={settings.notifications.dailySummary}
                onChange={(v) => updateNotifications('dailySummary', v)}
                label="Daily AI-generated summary email"
              />
            </div>
            <Field label="Admin Email" hint="All system notifications are sent here">
              <div className="relative">
                <Mail className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
                <input
                  type="email"
                  value={settings.notifications.adminEmail}
                  onChange={(e) => updateNotifications('adminEmail', e.target.value)}
                  className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </Field>
          </div>
        )}

        {/* WhatsApp Settings */}
        {activeTab === 'whatsapp' && (
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <SectionHeader
              icon={MessageSquare}
              title="WhatsApp Cloud API"
              description="Connect your Meta Business WhatsApp number to receive and send messages"
            />
            <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg">
              <p className="text-sm text-amber-700">
                Sensitive credentials like your access token are stored as Vercel environment variables,
                not here. Update them in your Vercel project settings.
              </p>
            </div>
            <div className="grid grid-cols-1 gap-4">
              <Field
                label="Webhook Verify Token"
                hint="Must match WHATSAPP_WEBHOOK_VERIFY_TOKEN in Vercel env vars"
              >
                <div className="relative">
                  <Key className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
                  <input
                    type="text"
                    value={settings.whatsapp.verifyToken}
                    onChange={(e) => updateWhatsApp('verifyToken', e.target.value)}
                    className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="your-verify-token"
                  />
                </div>
              </Field>
              <Field
                label="Phone Number ID"
                hint="Numeric ID from Meta Business dashboard — not the display number"
              >
                <TextInput
                  value={settings.whatsapp.phoneNumberId}
                  onChange={(v) => updateWhatsApp('phoneNumberId', v)}
                  placeholder="1170851372767802"
                />
              </Field>
              <Field
                label="Webhook URL"
                hint="Set this URL in your Meta App webhook configuration"
              >
                <TextInput
                  value={settings.whatsapp.webhookUrl}
                  onChange={(v) => updateWhatsApp('webhookUrl', v)}
                  placeholder="https://yourdomain.vercel.app/api/whatsapp/webhook"
                  disabled
                />
              </Field>
              <div className="flex items-center gap-3 p-3 rounded-lg bg-gray-50">
                <div
                  className={`w-2.5 h-2.5 rounded-full ${
                    settings.whatsapp.accessTokenSet ? 'bg-green-500' : 'bg-gray-300'
                  }`}
                />
                <span className="text-sm text-gray-600">
                  {settings.whatsapp.accessTokenSet
                    ? 'Access token is configured in Vercel'
                    : 'Access token not yet set — add WHATSAPP_ACCESS_TOKEN to Vercel env vars'}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Integrations */}
        {activeTab === 'integrations' && (
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <SectionHeader
              icon={Link2}
              title="Integrations"
              description="Connect external accounts used by the CRM"
            />
            <div className="border border-gray-200 rounded-lg p-4 flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-gray-800">Google Business Profile</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  Connect your Google Business Profile account for future GBP features (setup only — no data is synced yet).
                </p>
              </div>
              <a
                href="/api/google/gbp/connect"
                className="shrink-0 flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
              >
                <Link2 className="w-4 h-4" /> Connect Google Business
              </a>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
