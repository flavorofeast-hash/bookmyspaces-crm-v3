'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  FileText, User, Phone, Mail, Calendar, Users, MapPin,
  Package, IndianRupee, MessageSquare, ArrowLeft, Plus,
  Trash2, Sparkles, ChevronRight, CheckCircle2, AlertCircle,
  Loader2, BedDouble, Wand2,
} from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Addon    { name: string; price: number }
interface RoomItem { room_type: string; quantity: number; nights: number; rate: number }

// Direct Event Sales Engine, Section 4 — Smart Proposal Generator.
// Shape returned by GET /api/packages (src/lib/packages/package-service.ts's
// EventPackage, already camelCased for the client — reused as-is, not
// redefined server-side).
interface EventPackageOption {
  id: string
  name: string
  venue: string
  hall: string | null
  basePrice: number
  maxGuests: number | null
  inclusions: string[]
  addons: Addon[]
  addonServiceIds: string[]
  isActive: boolean
}

interface FormState {
  client_name         : string
  client_phone        : string
  client_email        : string
  event_type          : string
  event_date          : string
  event_time          : string
  guest_count         : string
  venue               : string
  hall                : string
  package_name        : string
  base_price          : string
  addons              : Addon[]
  room_items          : RoomItem[]
  discount_amount     : string
  discount_reason     : string
  special_requirements: string
  lead_id             : string
  package_id          : string
  addon_service_ids   : string[]
}

const EMPTY: FormState = {
  client_name         : '',
  client_phone        : '',
  client_email        : '',
  event_type          : 'Birthday Party',
  event_date          : '',
  event_time          : '',
  guest_count         : '',
  venue               : 'Rooftop Terrace',
  hall                : '',
  package_name        : 'Silver',
  base_price          : '',
  addons              : [],
  room_items          : [],
  discount_amount     : '',
  discount_reason     : '',
  special_requirements: '',
  lead_id             : '',
  package_id          : '',
  addon_service_ids   : [],
}

const EVENT_TYPES = [
  'Birthday Party','Anniversary','Engagement','Baby Shower',
  'Corporate Event','Family Gathering','Rooftop Dining',
  'Room Stay','Product Launch','Other',
]
const VENUES   = ['Rooftop Terrace','Celebration Hall','MonuRama Café','Private Suite','Entire Property']
const PACKAGES = ['Silver','Gold','Platinum','Custom','Rooms Only']
const ROOM_TYPES = ['Deluxe Room','Premium Room','Family Room','Suite','Standard Room','AC Room']

// ─── Helpers ──────────────────────────────────────────────────────────────────

const roomSub = (r: RoomItem) => (r.quantity||0)*(r.nights||0)*(r.rate||0)

function calcTotal(f: FormState): number {
  const base  = parseFloat(f.base_price) || 0
  const addon = f.addons.reduce((s,a) => s+(a.price||0), 0)
  const rooms = f.room_items.reduce((s,r) => s+roomSub(r), 0)
  const disc  = parseFloat(f.discount_amount) || 0
  return Math.max(0, base+addon+rooms-disc)
}

function fmt(n: number): string {
  return new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:0}).format(n)
}

// ─── UI primitives ────────────────────────────────────────────────────────────

function Label({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-widest mb-1.5">
      {children}{required && <span className="text-red-400 ml-0.5">*</span>}
    </label>
  )
}

function Input({ value, onChange, placeholder, type='text', required, icon: Icon }: {
  value:string; onChange:(v:string)=>void; placeholder?:string
  type?:string; required?:boolean; icon?:React.ElementType
}) {
  return (
    <div className="relative">
      {Icon && <Icon className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none"/>}
      <input type={type} value={value} onChange={e=>onChange(e.target.value)}
        placeholder={placeholder} required={required}
        className={`w-full border border-gray-200 rounded-lg py-2.5 text-sm text-gray-900 bg-white
          focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors placeholder:text-gray-400
          ${Icon?'pl-9 pr-3':'px-3'}`}
      />
    </div>
  )
}

function SelectField({ value, onChange, options, icon: Icon }: {
  value:string; onChange:(v:string)=>void; options:string[]; icon?:React.ElementType
}) {
  return (
    <div className="relative">
      {Icon && <Icon className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none"/>}
      <select value={value} onChange={e=>onChange(e.target.value)}
        className={`w-full border border-gray-200 rounded-lg py-2.5 text-sm text-gray-900 bg-white
          focus:outline-none focus:ring-2 focus:ring-blue-500 appearance-none
          ${Icon?'pl-9 pr-8':'px-3 pr-8'}`}
      >
        {options.map(o=><option key={o} value={o}>{o}</option>)}
      </select>
      <ChevronRight className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 rotate-90 pointer-events-none"/>
    </div>
  )
}

function Section({ title, icon: Icon, badge, children }: {
  title:string; icon:React.ElementType; badge?:string; children:React.ReactNode
}) {
  return (
    <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 bg-gray-50/60">
        <div className="flex items-center gap-2.5">
          <div className="p-1.5 bg-blue-100 rounded-lg"><Icon className="w-3.5 h-3.5 text-blue-600"/></div>
          <h2 className="text-sm font-bold text-gray-800">{title}</h2>
        </div>
        {badge && (
          <span className="text-xs bg-amber-100 text-amber-700 font-semibold px-2 py-0.5 rounded-full border border-amber-200">{badge}</span>
        )}
      </div>
      <div className="p-5">{children}</div>
    </div>
  )
}

// ─── Page inner ───────────────────────────────────────────────────────────────

function NewProposalInner() {
  const router       = useRouter()
  const searchParams = useSearchParams()

  const [form, setForm] = useState<FormState>(() => ({
    ...EMPTY,
    lead_id     : searchParams.get('lead_id') ?? '',
    client_name : searchParams.get('name')    ?? '',
    client_phone: searchParams.get('phone')   ?? '',
    event_type  : searchParams.get('event')   || 'Birthday Party',
    guest_count : searchParams.get('guests')  ?? '',
    event_date  : searchParams.get('date')    ?? '',
  }))

  const [saving,  setSaving]  = useState(false)
  const [error,   setError]   = useState<string|null>(null)
  const [success, setSuccess] = useState(false)

  // Direct Event Sales Engine, Section 4 — Smart Proposal Generator.
  // Event packages (built in Section 2/3) fetched once so an operator can
  // pick one and have the form auto-populate, mirroring the server-side
  // safe-fill in POST /api/proposals's `package_id` handling.
  const [eventPackages, setEventPackages]   = useState<EventPackageOption[]>([])
  const [packagesLoaded, setPackagesLoaded] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch('/api/packages?active=true')
      .then(res => res.ok ? res.json() : { packages: [] })
      .then(data => { if (!cancelled) setEventPackages(data.packages ?? []) })
      .catch(() => { /* non-fatal — form still works without package picker data */ })
      .finally(() => { if (!cancelled) setPackagesLoaded(true) })
    return () => { cancelled = true }
  }, [])

  const isRoomsOnly = form.package_name === 'Rooms Only'
  const total       = calcTotal(form)
  const advance     = Math.round(total * 0.5)

  function set<K extends keyof FormState>(field: K) {
    return (value: FormState[K]) => setForm(prev => ({ ...prev, [field]: value }))
  }
  function setStr(field: keyof FormState) {
    return (value: string) => setForm(prev => ({ ...prev, [field]: value }))
  }

  function applyEventPackage(id: string) {
    if (!id) { setForm(p => ({ ...p, package_id: '' })); return }
    const pkg = eventPackages.find(p => p.id === id)
    if (!pkg) return
    setForm(p => ({
      ...p,
      package_id       : pkg.id,
      package_name     : pkg.name,
      base_price       : String(pkg.basePrice),
      venue            : pkg.venue || p.venue,
      hall             : pkg.hall || p.hall,
      guest_count      : p.guest_count || (pkg.maxGuests ? String(pkg.maxGuests) : p.guest_count),
      addons           : pkg.addons.length > 0 ? pkg.addons.map(a => ({ name: a.name, price: a.price })) : p.addons,
      addon_service_ids: pkg.addonServiceIds.length > 0 ? pkg.addonServiceIds : p.addon_service_ids,
    }))
  }

  // Addons
  const addAddon    = () => setForm(p=>({...p,addons:[...p.addons,{name:'',price:0}]}))
  const removeAddon = (i:number) => setForm(p=>({...p,addons:p.addons.filter((_,j)=>j!==i)}))
  const updateAddon = (i:number, field:keyof Addon, v:string) =>
    setForm(p=>{ const a=[...p.addons]; a[i]={...a[i],[field]:field==='price'?parseFloat(v)||0:v}; return {...p,addons:a} })

  // Rooms
  const addRoom = () => setForm(p=>({...p,room_items:[...p.room_items,{room_type:'Deluxe Room',quantity:1,nights:1,rate:2500}]}))
  const removeRoom = (i:number) => setForm(p=>({...p,room_items:p.room_items.filter((_,j)=>j!==i)}))
  const updateRoom = (i:number, field:keyof RoomItem, v:string) =>
    setForm(p=>{ const r=[...p.room_items]; r[i]={...r[i],[field]:field==='room_type'?v:parseInt(v)||0}; return {...p,room_items:r} })

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    window.scrollTo({ top:0, behavior:'smooth' })

    if (!form.client_name.trim())  { setError('Client name is required.');  return }
    if (!form.client_phone.trim()) { setError('Client phone is required.'); return }
    if (!form.event_type)          { setError('Event type is required.');   return }

    const hasEventPackage = !isRoomsOnly && (parseFloat(form.base_price) > 0)
    const hasRooms        = form.room_items.length > 0

    if (!hasEventPackage && !hasRooms) {
      setError('Please enter a package price or add at least one room.')
      return
    }

    setSaving(true)
    try {
      const res = await fetch('/api/proposals', {
        method : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body   : JSON.stringify({
          lead_id             : form.lead_id || null,
          client_name         : form.client_name.trim(),
          client_phone        : form.client_phone.trim(),
          client_email        : form.client_email.trim() || null,
          event_type          : form.event_type,
          event_date          : form.event_date  || null,
          event_time          : form.event_time  || null,
          guest_count         : form.guest_count ? parseInt(form.guest_count) : null,
          venue               : form.venue,
          hall                : form.hall.trim() || null,
          package_id          : form.package_id || null,
          addon_service_ids   : form.addon_service_ids,
          package_name        : isRoomsOnly ? 'Rooms Only' : form.package_name,
          base_price          : isRoomsOnly ? 0 : (parseFloat(form.base_price) || 0),
          addons              : form.addons.filter(a=>a.name.trim()),
          room_items          : form.room_items.filter(r=>r.room_type && r.rate>0),
          discount_amount     : parseFloat(form.discount_amount) || 0,
          discount_reason     : form.discount_reason.trim() || null,
          special_requirements: form.special_requirements.trim() || null,
          generate_cover_note : true,
        }),
      })

      if (!res.ok) {
        const d = await res.json().catch(()=>({}))
        throw new Error(d.error ?? `Server error ${res.status}`)
      }

      await res.json()
      setSuccess(true)
      setTimeout(() => router.push('/proposals'), 900)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create proposal.')
      setSaving(false)
    }
  }

  if (success) return (
    <div className="min-h-screen bg-gray-50/60 flex items-center justify-center">
      <div className="text-center space-y-3">
        <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto">
          <CheckCircle2 className="w-8 h-8 text-emerald-600"/>
        </div>
        <h2 className="text-lg font-bold text-gray-900">Proposal Created</h2>
        <p className="text-sm text-gray-500">Redirecting…</p>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen bg-gray-50/60">

      {/* Sticky header */}
      <header className="sticky top-0 z-20 bg-white/95 backdrop-blur border-b border-gray-200 px-6 py-3">
        <div className="max-w-3xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <button type="button" onClick={()=>router.back()}
              className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500 transition-colors">
              <ArrowLeft className="w-4 h-4"/>
            </button>
            <div>
              <h1 className="text-sm font-black text-gray-900 flex items-center gap-2">
                <FileText className="w-4 h-4 text-blue-600"/> New Proposal
              </h1>
              {form.lead_id && <p className="text-xs text-gray-400">Linked to lead · {form.lead_id.slice(0,8)}…</p>}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={()=>router.back()}
              className="px-3 py-2 border border-gray-200 rounded-lg text-xs text-gray-600 hover:bg-gray-50">
              Cancel
            </button>
            <button type="submit" form="proposal-form" disabled={saving}
              className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white rounded-lg text-xs font-bold hover:bg-blue-700 disabled:opacity-60">
              {saving ? <><Loader2 className="w-3.5 h-3.5 animate-spin"/>Creating…</> : <><Sparkles className="w-3.5 h-3.5"/>Create Proposal</>}
            </button>
          </div>
        </div>
      </header>

      <form id="proposal-form" onSubmit={handleSubmit} className="max-w-3xl mx-auto px-6 py-6 space-y-4">

        {error && (
          <div className="flex items-start gap-2.5 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
            <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0"/>{error}
          </div>
        )}

        {/* ── 1. Client ── */}
        <Section title="Client Information" icon={User}>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="sm:col-span-1">
              <Label required>Full Name</Label>
              <Input value={form.client_name} onChange={setStr('client_name')} placeholder="Rahul Sharma" icon={User} required/>
            </div>
            <div>
              <Label required>Phone</Label>
              <Input value={form.client_phone} onChange={setStr('client_phone')} placeholder="9XXXXXXXXX" type="tel" icon={Phone} required/>
            </div>
            <div>
              <Label>Email</Label>
              <Input value={form.client_email} onChange={setStr('client_email')} placeholder="client@email.com" type="email" icon={Mail}/>
            </div>
          </div>
        </Section>

        {/* ── 2. Event ── */}
        <Section title="Event Details" icon={Calendar}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label required>Event Type</Label>
              <SelectField value={form.event_type} onChange={setStr('event_type')} options={EVENT_TYPES} icon={Calendar}/>
            </div>
            <div>
              <Label>Event Date</Label>
              <Input value={form.event_date} onChange={setStr('event_date')} type="date" icon={Calendar}/>
            </div>
            <div>
              <Label>Event Time</Label>
              <Input value={form.event_time} onChange={setStr('event_time')} type="time" icon={Calendar}/>
            </div>
            <div>
              <Label>Guest Count</Label>
              <Input value={form.guest_count} onChange={setStr('guest_count')} placeholder="40" type="number" icon={Users}/>
            </div>
          </div>
        </Section>

        {/* ── 3. Venue & Package ── */}
        <Section title="Venue & Package" icon={MapPin}>
          {packagesLoaded && eventPackages.length > 0 && (
            <div className="mb-4">
              <Label>Load from Event Package (optional)</Label>
              <div className="relative">
                <Wand2 className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-violet-500 pointer-events-none"/>
                <select value={form.package_id} onChange={e=>applyEventPackage(e.target.value)}
                  className="w-full border border-violet-200 bg-violet-50/50 rounded-lg py-2.5 pl-9 pr-8 text-sm text-gray-900
                    focus:outline-none focus:ring-2 focus:ring-violet-500 appearance-none">
                  <option value="">— Select a package to auto-fill —</option>
                  {eventPackages.map(pkg => (
                    <option key={pkg.id} value={pkg.id}>
                      {pkg.name} · {pkg.venue} · {fmt(pkg.basePrice)}
                    </option>
                  ))}
                </select>
                <ChevronRight className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 rotate-90 pointer-events-none"/>
              </div>
              {form.package_id && (
                <p className="mt-1.5 text-xs text-violet-700">Venue, price, guests and add-ons filled from this package — edit freely below.</p>
              )}
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label required>Venue</Label>
              <SelectField value={form.venue} onChange={setStr('venue')} options={VENUES} icon={MapPin}/>
            </div>
            <div>
              <Label>Hall</Label>
              <Input value={form.hall} onChange={setStr('hall')} placeholder="e.g. Celebration Hall A (optional)" icon={MapPin}/>
            </div>
            <div>
              <Label required>Package</Label>
              <SelectField value={form.package_name}
                onChange={v => setForm(p=>({...p, package_name:v, package_id:'', base_price: v==='Rooms Only'?'':p.base_price}))}
                options={PACKAGES} icon={Package}/>
            </div>
          </div>
          {isRoomsOnly && (
            <p className="mt-3 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              Rooms Only — package price not required. Add rooms below.
            </p>
          )}
        </Section>

        {/* ── 4. Accommodation ── */}
        <Section title="Accommodation" icon={BedDouble}
          badge={form.room_items.length > 0 ? `${form.room_items.length} room${form.room_items.length>1?'s':''}` : undefined}>
          {form.room_items.length === 0 ? (
            <div className="text-center py-4">
              <p className="text-xs text-gray-400 mb-3">No rooms added. Add rooms if this proposal includes accommodation.</p>
              <button type="button" onClick={addRoom}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-gray-900 text-white rounded-lg text-xs font-semibold hover:bg-gray-800">
                <Plus className="w-3.5 h-3.5"/> Add Room
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-12 gap-2 text-xs font-semibold text-gray-400 uppercase tracking-widest px-1">
                <div className="col-span-4">Room Type</div>
                <div className="col-span-2 text-center">Qty</div>
                <div className="col-span-2 text-center">Nights</div>
                <div className="col-span-3">Rate/Night (₹)</div>
                <div className="col-span-1"></div>
              </div>
              {form.room_items.map((room,i) => (
                <div key={i} className="grid grid-cols-12 gap-2 items-center bg-gray-50 rounded-xl p-3 border border-gray-100">
                  <div className="col-span-4">
                    <select value={room.room_type} onChange={e=>updateRoom(i,'room_type',e.target.value)}
                      className="w-full border border-gray-200 rounded-lg px-2 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 appearance-none">
                      {ROOM_TYPES.map(rt=><option key={rt} value={rt}>{rt}</option>)}
                    </select>
                  </div>
                  <div className="col-span-2">
                    <input type="number" min="1" value={room.quantity||''} onChange={e=>updateRoom(i,'quantity',e.target.value)}
                      className="w-full border border-gray-200 rounded-lg px-2 py-2 text-sm text-center bg-white focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="1"/>
                  </div>
                  <div className="col-span-2">
                    <input type="number" min="1" value={room.nights||''} onChange={e=>updateRoom(i,'nights',e.target.value)}
                      className="w-full border border-gray-200 rounded-lg px-2 py-2 text-sm text-center bg-white focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="1"/>
                  </div>
                  <div className="col-span-3">
                    <input type="number" min="0" value={room.rate||''} onChange={e=>updateRoom(i,'rate',e.target.value)}
                      className="w-full border border-gray-200 rounded-lg px-2 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="2500"/>
                  </div>
                  <div className="col-span-1 flex flex-col items-end gap-1">
                    <button type="button" onClick={()=>removeRoom(i)}
                      className="p-1 text-gray-400 hover:text-red-500 rounded hover:bg-red-50">
                      <Trash2 className="w-3.5 h-3.5"/>
                    </button>
                    {roomSub(room) > 0 && (
                      <span className="text-xs font-semibold text-gray-600 whitespace-nowrap">{fmt(roomSub(room))}</span>
                    )}
                  </div>
                </div>
              ))}
              <button type="button" onClick={addRoom}
                className="flex items-center gap-1.5 text-xs text-blue-600 font-semibold hover:text-blue-700">
                <Plus className="w-3.5 h-3.5"/> Add another room
              </button>
              {form.room_items.length > 0 && (
                <div className="flex justify-end pt-1">
                  <div className="bg-gray-900 text-white rounded-lg px-4 py-2 text-xs">
                    <span className="text-gray-400 mr-2">Accommodation subtotal</span>
                    <span className="font-bold text-amber-400">{fmt(form.room_items.reduce((s,r)=>s+roomSub(r),0))}</span>
                  </div>
                </div>
              )}
            </div>
          )}
        </Section>

        {/* ── 5. Pricing (hidden for Rooms Only) ── */}
        {!isRoomsOnly && (
          <Section title="Pricing" icon={IndianRupee}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
              <div>
                <Label>Base Price (₹)</Label>
                <Input value={form.base_price} onChange={setStr('base_price')} placeholder="15000" type="number" icon={IndianRupee}/>
              </div>
              <div>
                <Label>Discount (₹)</Label>
                <Input value={form.discount_amount} onChange={setStr('discount_amount')} placeholder="0" type="number" icon={IndianRupee}/>
              </div>
              {parseFloat(form.discount_amount) > 0 && (
                <div className="sm:col-span-2">
                  <Label>Discount Reason</Label>
                  <Input value={form.discount_reason} onChange={setStr('discount_reason')} placeholder="Loyalty discount, early booking…"/>
                </div>
              )}
            </div>

            {/* Add-ons */}
            <div className="flex items-center justify-between mb-2">
              <Label>Add-ons</Label>
              <button type="button" onClick={addAddon}
                className="flex items-center gap-1 text-xs text-blue-600 font-semibold hover:text-blue-700">
                <Plus className="w-3.5 h-3.5"/> Add item
              </button>
            </div>
            {form.addons.length === 0 ? (
              <p className="text-xs text-gray-400 py-2">No add-ons added.</p>
            ) : (
              <div className="space-y-2">
                {form.addons.map((a,i) => (
                  <div key={i} className="flex gap-2 items-center">
                    <input type="text" value={a.name} onChange={e=>updateAddon(i,'name',e.target.value)}
                      placeholder="Add-on name"
                      className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"/>
                    <div className="relative w-32">
                      <IndianRupee className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400 pointer-events-none"/>
                      <input type="number" value={a.price||''} onChange={e=>updateAddon(i,'price',e.target.value)}
                        placeholder="0"
                        className="w-full border border-gray-200 rounded-lg pl-7 pr-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"/>
                    </div>
                    <button type="button" onClick={()=>removeAddon(i)}
                      className="p-1.5 text-gray-400 hover:text-red-500 rounded-lg hover:bg-red-50">
                      <Trash2 className="w-3.5 h-3.5"/>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </Section>
        )}

        {/* ── 6. Notes ── */}
        <Section title="Special Requirements" icon={MessageSquare}>
          <Label>Notes for the proposal</Label>
          <textarea value={form.special_requirements}
            onChange={e=>setForm(p=>({...p,special_requirements:e.target.value}))}
            placeholder="Dietary requirements, décor preferences, specific setup requests…"
            rows={3}
            className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm text-gray-900 bg-white
              focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder:text-gray-400 resize-none"/>
        </Section>

        {/* AI note */}
        <div className="flex items-start gap-2.5 px-4 py-3 bg-blue-50 border border-blue-100 rounded-xl">
          <Sparkles className="w-4 h-4 text-blue-500 mt-0.5 flex-shrink-0"/>
          <p className="text-xs text-blue-700 leading-relaxed">
            An AI-written cover note will be generated automatically and included in the proposal PDF.
          </p>
        </div>

        {/* Live total */}
        {total > 0 && (
          <div className="bg-gray-900 rounded-xl px-5 py-4">
            <div className="flex items-center justify-between">
              <div className="space-y-1.5 text-xs text-gray-400">
                {!isRoomsOnly && parseFloat(form.base_price) > 0 && (
                  <div className="flex justify-between gap-12">
                    <span>Package</span>
                    <span className="text-gray-200">{fmt(parseFloat(form.base_price))}</span>
                  </div>
                )}
                {form.room_items.length > 0 && (
                  <div className="flex justify-between gap-12">
                    <span>Accommodation</span>
                    <span className="text-gray-200">{fmt(form.room_items.reduce((s,r)=>s+roomSub(r),0))}</span>
                  </div>
                )}
                {form.addons.length > 0 && (
                  <div className="flex justify-between gap-12">
                    <span>Add-ons</span>
                    <span className="text-gray-200">{fmt(form.addons.reduce((s,a)=>s+(a.price||0),0))}</span>
                  </div>
                )}
                {parseFloat(form.discount_amount) > 0 && (
                  <div className="flex justify-between gap-12">
                    <span>Discount</span>
                    <span className="text-red-400">−{fmt(parseFloat(form.discount_amount))}</span>
                  </div>
                )}
              </div>
              <div className="text-right ml-8">
                <p className="text-xs text-gray-500 mb-0.5">Total</p>
                <p className="text-xl font-black text-white">{fmt(total)}</p>
                <p className="text-xs text-amber-400 mt-0.5">Advance: {fmt(Math.round(total*0.5))}</p>
              </div>
            </div>
          </div>
        )}

        {/* Bottom submit */}
        <div className="flex justify-end gap-3 pt-2 pb-8">
          <button type="button" onClick={()=>router.back()}
            className="px-4 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50">
            Cancel
          </button>
          <button type="submit" disabled={saving}
            className="flex items-center gap-2 px-6 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-bold hover:bg-blue-700 disabled:opacity-60 shadow-sm">
            {saving
              ? <><Loader2 className="w-4 h-4 animate-spin"/>Creating proposal…</>
              : <><Sparkles className="w-4 h-4"/>Create Proposal</>}
          </button>
        </div>

      </form>
    </div>
  )
}

// ─── Page export ──────────────────────────────────────────────────────────────

export default function NewProposalPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gray-50/60 flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-blue-600"/>
      </div>
    }>
      <NewProposalInner/>
    </Suspense>
  )
}
