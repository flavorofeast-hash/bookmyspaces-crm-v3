'use client'

import { useState, useEffect, useCallback } from 'react'
import { toast } from 'sonner'
import Link from 'next/link'
import {
  FileText, Send, Eye, Clock, CheckCircle2, XCircle,
  AlertTriangle, Flame, RefreshCw, Download, MessageSquare,
  Mail, Copy, Phone, TrendingUp, Zap, ChevronDown, ChevronUp,
  BarChart3, Filter, Search, Plus, IndianRupee, Receipt,
  X, Loader2, BookOpen, Wallet,
} from 'lucide-react'
import {
  computeProposalUrgency,
  ProposalUrgencyResult,
  ProposalSnapshot,
  LeadSnapshot,
  ProposalNextAction,
} from '@/lib/proposal-intelligence'

// ─── Types ────────────────────────────────────────────────────────────────────

type ProposalStatus = 'draft'|'generated'|'sent'|'viewed'|'followed_up'|'accepted'|'rejected'|'expired'
type PaymentStatus  = 'pending'|'advance_paid'|'partially_paid'|'fully_paid'
type RiskLevel      = 'low'|'medium'|'high'|'critical'
type FilterTab      = 'all'|'action_needed'|'hot'|'viewed'|'sent'|'accepted'

interface ProposalWithLead {
  id                  : string
  proposal_number     : string|null
  lead_id             : string|null
  client_name         : string|null
  client_phone        : string|null
  event_type          : string|null
  event_date          : string|null
  guest_count         : number|null
  package_name        : string|null
  total_price         : number|null
  status              : ProposalStatus
  payment_status      : PaymentStatus|null
  advance_paid        : number|null
  balance_due         : number|null
  urgency_score       : number|null
  risk_level          : RiskLevel|null
  next_action         : ProposalNextAction|null
  escalation_required : boolean|null
  engagement_score    : number|null
  viewed_count        : number|null
  sent_at             : string|null
  first_viewed_at     : string|null
  last_viewed_at      : string|null
  followed_up_at      : string|null
  created_at          : string
  updated_at          : string
  ai_summary          : string|null
  recommended_package : string|null
  venue_fit_reasoning : string|null
  urgency_cta         : string|null
  confidence_score    : number|null
  leads               : LeadSnapshotRaw|null
}

interface LeadSnapshotRaw {
  id:string; name:string|null; phone:string|null; ai_score:number|null
  lead_temperature:string|null; urgency_level:string|null; lead_stage:string|null
  estimated_revenue:number|null; budget:string|null; event_type:string|null; venue:string|null
}

// ─── Payment record shape (from GET /api/proposals/[id]/payment) ──────────────

interface PaymentRecord {
  id             : string
  receipt_number : string
  amount         : number
  payment_date   : string
  payment_mode   : string
  transaction_ref: string|null
  notes          : string|null
  payment_type   : string
  created_at     : string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatINR(n:number):string {
  if (n>=100_000) return `₹${(n/100_000).toFixed(1)}L`
  if (n>=1_000)   return `₹${(n/1_000).toFixed(0)}K`
  return `₹${n}`
}

function fmtINRFull(n:number):string {
  return '₹' + Number(n).toLocaleString('en-IN')
}

function fmtDate(iso:string|null|undefined):string {
  if (!iso) return '—'
  try { return new Date(iso).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}) }
  catch { return iso }
}

function timeAgo(iso:string|null):string {
  if (!iso) return '—'
  const mins=Math.floor((Date.now()-new Date(iso).getTime())/60_000)
  if (mins<60)   return `${mins}m ago`
  if (mins<1440) return `${Math.floor(mins/60)}h ago`
  return `${Math.floor(mins/1440)}d ago`
}

function modeLabel(m:string):string {
  const map:Record<string,string>={cash:'Cash',upi:'UPI',card:'Card',bank_transfer:'Bank Transfer',cheque:'Cheque'}
  return map[m]??m
}

function modeIcon(m:string):string {
  const map:Record<string,string>={upi:'📱',cash:'💵',card:'💳',bank_transfer:'🏦',cheque:'📄'}
  return map[m]??'💰'
}

function toLeadSnapshot(raw:LeadSnapshotRaw|null):LeadSnapshot {
  return {
    id:raw?.id??'', name:raw?.name??null, phone:raw?.phone??null, email:null,
    event_type:raw?.event_type??null, event_date:null, guest_count:null,
    budget:raw?.budget??null, venue:raw?.venue??null, ai_score:raw?.ai_score??null,
    lead_temperature:raw?.lead_temperature??null, urgency_level:raw?.urgency_level??null,
    lead_stage:raw?.lead_stage??null, estimated_revenue:raw?.estimated_revenue??null,
    score_breakdown:null,
  }
}

function toProposalSnapshot(p:ProposalWithLead):ProposalSnapshot {
  return {
    id:p.id, status:p.status, total_price:p.total_price, package_name:p.package_name,
    guest_count:p.guest_count, event_type:p.event_type, sent_at:p.sent_at,
    first_viewed_at:p.first_viewed_at, last_viewed_at:p.last_viewed_at,
    followed_up_at:p.followed_up_at, viewed_count:p.viewed_count??0,
    engagement_score:p.engagement_score??0, created_at:p.created_at,
  }
}

// ─── Status configs ───────────────────────────────────────────────────────────

const STATUS_CONFIG:Record<ProposalStatus,{label:string;pill:string;icon:React.ElementType}> = {
  draft      :{label:'Draft',      pill:'bg-gray-100 text-gray-600 border border-gray-200',         icon:FileText},
  generated  :{label:'Generated',  pill:'bg-blue-50 text-blue-700 border border-blue-200',          icon:Zap},
  sent       :{label:'Sent',       pill:'bg-indigo-50 text-indigo-700 border border-indigo-200',    icon:Send},
  viewed     :{label:'Viewed',     pill:'bg-amber-50 text-amber-700 border border-amber-200',       icon:Eye},
  followed_up:{label:'Followed Up',pill:'bg-orange-50 text-orange-700 border border-orange-200',   icon:MessageSquare},
  accepted   :{label:'Accepted',   pill:'bg-emerald-50 text-emerald-700 border border-emerald-200', icon:CheckCircle2},
  rejected   :{label:'Rejected',   pill:'bg-red-50 text-red-700 border border-red-200',             icon:XCircle},
  expired    :{label:'Expired',    pill:'bg-gray-50 text-gray-400 border border-gray-200',          icon:Clock},
}

const PAYMENT_CONFIG:Record<PaymentStatus,{label:string;color:string}> = {
  pending        :{label:'Payment Pending',  color:'text-gray-500  bg-gray-50   border-gray-200'},
  advance_paid   :{label:'Advance Paid',     color:'text-blue-700  bg-blue-50   border-blue-200'},
  partially_paid :{label:'Partially Paid',   color:'text-amber-700 bg-amber-50  border-amber-200'},
  fully_paid     :{label:'Fully Paid',       color:'text-emerald-700 bg-emerald-50 border-emerald-200'},
}

const RISK_CONFIG:Record<RiskLevel,{label:string;color:string}> = {
  low     :{label:'Low Risk',   color:'text-emerald-600 bg-emerald-50 border border-emerald-200'},
  medium  :{label:'Medium Risk',color:'text-amber-600 bg-amber-50 border border-amber-200'},
  high    :{label:'High Risk',  color:'text-orange-600 bg-orange-50 border border-orange-200'},
  critical:{label:'Critical',   color:'text-red-700 bg-red-50 border border-red-200'},
}

// ─── Shared modal shell ───────────────────────────────────────────────────────

function ModalShell({title,sub,onClose,children}:{
  title:string; sub:string; onClose:()=>void; children:React.ReactNode
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 bg-gray-900 text-white flex-shrink-0">
          <div>
            <p className="text-xs text-gray-400 mb-0.5">{sub}</p>
            <p className="text-sm font-bold">{title}</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="p-1.5 rounded-lg hover:bg-white/10 transition-colors">
            <X className="w-4 h-4"/>
          </button>
        </div>
        <div className="overflow-y-auto flex-1">{children}</div>
      </div>
    </div>
  )
}

// ─── Record Payment Modal (UNCHANGED) ────────────────────────────────────────

function PaymentModal({
  proposal, onClose, onSuccess,
}: {
  proposal:ProposalWithLead; onClose:()=>void; onSuccess:()=>void
}) {
  const [amount, setAmount] = useState('')
  const [date,   setDate]   = useState(new Date().toISOString().slice(0,10))
  const [mode,   setMode]   = useState('upi')
  const [ref,    setRef]    = useState('')
  const [notes,  setNotes]  = useState('')
  const [type,   setType]   = useState('advance')
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState<string|null>(null)

  async function submit(e:React.FormEvent) {
    e.preventDefault()
    if (!amount||parseFloat(amount)<=0){setError('Enter a valid amount');return}
    setSaving(true)
    try {
      const res=await fetch(`/api/proposals/${proposal.id}/payment`,{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({amount:parseFloat(amount),payment_date:date,payment_mode:mode,transaction_ref:ref||null,notes:notes||null,payment_type:type}),
      })
      if (!res.ok){const d=await res.json().catch(()=>({}));throw new Error(d.error??`Error ${res.status}`)}
      onSuccess()
    } catch(err:any){setError(err.message??'Failed to record payment');setSaving(false)}
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 bg-gray-900 text-white">
          <div>
            <p className="text-xs text-gray-400 mb-0.5">Record Payment</p>
            <p className="text-sm font-bold">{proposal.client_name} · {proposal.proposal_number}</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="p-1.5 rounded-lg hover:bg-white/10 transition-colors"><X className="w-4 h-4"/></button>
        </div>
        <form onSubmit={submit} className="p-5 space-y-4">
          {error&&<div className="px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">{error}</div>}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-widest mb-1.5">Amount (₹) *</label>
              <input type="number" value={amount} onChange={e=>setAmount(e.target.value)} placeholder="25000" required
                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"/>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-widest mb-1.5">Date</label>
              <input type="date" value={date} onChange={e=>setDate(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"/>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-widest mb-1.5">Payment Mode</label>
              <select value={mode} onChange={e=>setMode(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 appearance-none bg-white">
                <option value="upi">UPI</option><option value="cash">Cash</option>
                <option value="card">Card</option><option value="bank_transfer">Bank Transfer</option>
                <option value="cheque">Cheque</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-widest mb-1.5">Payment Type</label>
              <select value={type} onChange={e=>setType(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 appearance-none bg-white">
                <option value="advance">Advance</option><option value="partial">Partial</option>
                <option value="final">Final Payment</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-widest mb-1.5">Transaction Reference</label>
            <input type="text" value={ref} onChange={e=>setRef(e.target.value)} placeholder="UPI ref / cheque no."
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"/>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-widest mb-1.5">Notes</label>
            <textarea value={notes} onChange={e=>setNotes(e.target.value)} rows={2} placeholder="Optional notes…"
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"/>
          </div>
          {proposal.total_price&&(
            <div className="bg-gray-50 rounded-xl px-4 py-3 text-xs space-y-1">
              <div className="flex justify-between text-gray-500">
                <span>Proposal Total</span><span className="font-medium text-gray-700">{formatINR(proposal.total_price)}</span>
              </div>
              {(proposal.advance_paid??0)>0&&(
                <div className="flex justify-between text-blue-600">
                  <span>Already Paid</span><span className="font-medium">− {formatINR(proposal.advance_paid??0)}</span>
                </div>
              )}
              {amount&&parseFloat(amount)>0&&(
                <div className="flex justify-between text-green-600 border-t border-gray-200 pt-1 mt-1">
                  <span>Balance After This</span>
                  <span className="font-bold">{formatINR(Math.max(0,(proposal.total_price??0)-(proposal.advance_paid??0)-parseFloat(amount)))}</span>
                </div>
              )}
            </div>
          )}
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 px-4 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50">Cancel</button>
            <button type="submit" disabled={saving}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-gray-900 text-white rounded-xl text-sm font-bold hover:bg-gray-800 disabled:opacity-60">
              {saving?<><Loader2 className="w-4 h-4 animate-spin"/>Saving…</>:<><IndianRupee className="w-4 h-4"/>Record Payment</>}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── NEW: Advance Receipts Modal ──────────────────────────────────────────────

function ReceiptsModal({proposal, onClose}:{proposal:ProposalWithLead; onClose:()=>void}) {
  const [payments, setPayments] = useState<PaymentRecord[]>([])
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState<string|null>(null)

  useEffect(()=>{
    setLoading(true)
    fetch(`/api/proposals/${proposal.id}/payment`)
      .then(r=>r.json())
      .then(d=>{
        setPayments(Array.isArray(d.payments)?d.payments:[])
        setLoading(false)
      })
      .catch(()=>{setError('Failed to load payments');setLoading(false)})
  },[proposal.id])

  return (
    <ModalShell
      title={`Advance Receipts — ${proposal.proposal_number}`}
      sub={proposal.client_name??''}
      onClose={onClose}
    >
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-5 h-5 animate-spin text-gray-400"/>
        </div>
      ) : error ? (
        <div className="p-5 text-sm text-red-600">{error}</div>
      ) : payments.length === 0 ? (
        <div className="p-8 text-center">
          <Receipt className="w-10 h-10 text-gray-200 mx-auto mb-3"/>
          <p className="text-sm text-gray-400 font-medium">No payments recorded yet.</p>
          <p className="text-xs text-gray-300 mt-1">Receipts will appear here after recording a payment.</p>
        </div>
      ) : (
        <div className="divide-y divide-gray-100">
          {/* Summary header */}
          <div className="px-5 py-3 bg-gray-50 flex items-center justify-between">
            <span className="text-xs text-gray-500">{payments.length} payment{payments.length!==1?'s':''} recorded</span>
            <span className="text-xs font-bold text-emerald-700">
              Total: {fmtINRFull(payments.reduce((s,p)=>s+Number(p.amount),0))}
            </span>
          </div>

          {payments.map((p,i)=>(
            <div key={p.id} className="px-5 py-4">
              {/* Row header */}
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="text-base">{modeIcon(p.payment_mode)}</span>
                  <div>
                    <p className="text-xs font-bold text-gray-800 font-mono tracking-wide">{p.receipt_number}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{fmtDate(p.payment_date)}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-base font-black text-gray-900">{fmtINRFull(Number(p.amount))}</p>
                  <p className="text-xs text-gray-400 capitalize mt-0.5">{modeLabel(p.payment_mode)}</p>
                </div>
              </div>

              {/* Meta row */}
              <div className="flex items-center gap-2 flex-wrap mb-3">
                <span className="inline-flex items-center px-2 py-0.5 bg-gray-100 text-gray-600 text-xs rounded-full border border-gray-200 capitalize">
                  {(p.payment_type||'advance').replace('_',' ')}
                </span>
                {p.transaction_ref && (
                  <span className="inline-flex items-center px-2 py-0.5 bg-blue-50 text-blue-700 text-xs rounded-full border border-blue-200 font-mono">
                    {p.transaction_ref}
                  </span>
                )}
                {p.notes && (
                  <span className="text-xs text-gray-400 italic truncate max-w-[180px]">{p.notes}</span>
                )}
              </div>

              {/* Action buttons */}
              <div className="flex gap-2">
                <button
                  onClick={()=>window.open(`/api/proposals/${proposal.id}/receipt?payment_id=${p.id}`,'_blank')}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 bg-teal-50 text-teal-700 border border-teal-200 rounded-lg text-xs font-semibold hover:bg-teal-100 transition-colors">
                  <Receipt className="w-3.5 h-3.5"/> View Receipt
                </button>
                <button
                  onClick={()=>window.open(`/api/proposals/${proposal.id}/receipt?payment_id=${p.id}&print=1`,'_blank')}
                  className="inline-flex items-center justify-center gap-1.5 px-3 py-2 bg-gray-100 text-gray-700 border border-gray-200 rounded-lg text-xs font-semibold hover:bg-gray-200 transition-colors">
                  🖨 Print
                </button>
              </div>

              {i < payments.length-1 && <div className="mt-4 border-b border-dashed border-gray-100"/>}
            </div>
          ))}
        </div>
      )}
    </ModalShell>
  )
}

// ─── NEW: Financial Documents Modal ──────────────────────────────────────────

function FinanceModal({proposal, onClose}:{proposal:ProposalWithLead; onClose:()=>void}) {
  const [payments,     setPayments]     = useState<PaymentRecord[]>([])
  const [loading,      setLoading]      = useState(true)
  const [error,        setError]        = useState<string|null>(null)
  // Task 1 (proposal email actions): which email action is in flight —
  // 'invoice/email' | 'booking-confirmation' | 'payment-reminder' | null.
  // One at a time; all three buttons disable while any send runs.
  const [emailAction,  setEmailAction]  = useState<string|null>(null)

  async function sendEmailAction(kind:'invoice/email'|'booking-confirmation'|'payment-reminder', label:string) {
    setEmailAction(kind)
    try {
      const res  = await fetch(`/api/proposals/${proposal.id}/${kind}`, { method:'POST' })
      const data = await res.json().catch(()=>({}))
      if (!res.ok) throw new Error(data?.error || `Failed (${res.status})`)
      toast.success(`${label} sent${data?.sent_to ? ` to ${data.sent_to}` : ''}.`)
    } catch (err) {
      toast.error(`Could not send ${label.toLowerCase()}: ${err instanceof Error ? err.message : 'unknown error'}`)
    } finally {
      setEmailAction(null)
    }
  }

  useEffect(()=>{
    setLoading(true)
    fetch(`/api/proposals/${proposal.id}/payment`)
      .then(r=>r.json())
      .then(d=>{
        setPayments(Array.isArray(d.payments)?d.payments:[])
        setLoading(false)
      })
      .catch(()=>{setError('Failed to load payment data');setLoading(false)})
  },[proposal.id])

  const totalReceived = payments.reduce((s,p)=>s+Number(p.amount),0)
  const grandTotal    = Number(proposal.total_price??0)
  const balanceDue    = Math.max(0, grandTotal - totalReceived)
  const isFullyPaid   = balanceDue <= 0

  return (
    <ModalShell
      title="Financial Documents"
      sub={`${proposal.proposal_number} — ${proposal.client_name}`}
      onClose={onClose}
    >
      <div className="p-5 space-y-4">

        {/* Financial summary card */}
        <div className="bg-gray-900 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-white/10">
            <p className="text-xs text-gray-400 font-semibold uppercase tracking-widest">Financial Summary</p>
            <p className="text-xs text-gray-500 mt-0.5">{proposal.proposal_number}</p>
          </div>
          <div className="px-4 py-3 space-y-2">
            <div className="flex justify-between items-center">
              <span className="text-xs text-gray-400">Grand Total</span>
              <span className="text-sm font-bold text-white">{fmtINRFull(grandTotal)}</span>
            </div>
            {loading ? (
              <div className="flex items-center gap-2 text-xs text-gray-500">
                <Loader2 className="w-3 h-3 animate-spin"/> Loading payments…
              </div>
            ) : error ? (
              <p className="text-xs text-red-400">{error}</p>
            ) : (
              <>
                <div className="flex justify-between items-center">
                  <span className="text-xs text-gray-400">
                    Amount Received
                    {payments.length>0&&<span className="ml-1 text-gray-600">({payments.length} payment{payments.length!==1?'s':''})</span>}
                  </span>
                  <span className="text-sm font-bold text-emerald-400">{fmtINRFull(totalReceived)}</span>
                </div>
                <div className="h-px bg-white/10 my-1"/>
                <div className="flex justify-between items-center">
                  <span className="text-xs font-semibold text-gray-300">{isFullyPaid?'✓ Fully Settled':'Balance Due'}</span>
                  <span className={`text-base font-black ${isFullyPaid?'text-emerald-400':'text-amber-400'}`}>
                    {fmtINRFull(balanceDue)}
                  </span>
                </div>
              </>
            )}
          </div>
          {!loading && !error && payments.length > 0 && (
            <div className="px-4 pb-3">
              <div className="bg-white/5 rounded-lg p-2.5 space-y-1.5">
                <p className="text-xs text-gray-500 uppercase tracking-widest mb-1">Payment History</p>
                {payments.map(p=>(
                  <div key={p.id} className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <span className="text-gray-500 font-mono">{p.receipt_number}</span>
                      <span className="text-gray-600">{fmtDate(p.payment_date)}</span>
                      <span className="text-gray-600">{modeLabel(p.payment_mode)}</span>
                    </div>
                    <span className="text-white font-semibold">{fmtINRFull(Number(p.amount))}</span>
                  </div>
                ))}
                <div className="h-px bg-white/10 mt-1 pt-1">
                  <div className="flex justify-between text-xs pt-1">
                    <span className="text-gray-400 font-semibold">Total Received</span>
                    <span className="text-emerald-400 font-bold">{fmtINRFull(totalReceived)}</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Document actions */}
        <div className="space-y-2">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest">Generate Documents</p>

          {/* Latest Invoice */}
          <button
            onClick={()=>window.open(`/api/proposals/${proposal.id}/invoice`,'_blank')}
            className="w-full flex items-center justify-between px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl hover:bg-amber-100 transition-colors group">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-amber-100 rounded-lg group-hover:bg-amber-200 transition-colors">
                <FileText className="w-4 h-4 text-amber-700"/>
              </div>
              <div className="text-left">
                <p className="text-sm font-bold text-amber-900">Generate Latest Invoice</p>
                <p className="text-xs text-amber-600 mt-0.5">
                  {loading ? 'Loading…' : `Shows ${fmtINRFull(grandTotal)} total · ${fmtINRFull(totalReceived)} received · ${fmtINRFull(balanceDue)} due`}
                </p>
              </div>
            </div>
            <Download className="w-4 h-4 text-amber-500"/>
          </button>

          {/* Consolidated Statement = invoice with print=1 */}
          <button
            onClick={()=>window.open(`/api/proposals/${proposal.id}/invoice?print=1`,'_blank')}
            className="w-full flex items-center justify-between px-4 py-3 bg-blue-50 border border-blue-200 rounded-xl hover:bg-blue-100 transition-colors group">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-100 rounded-lg group-hover:bg-blue-200 transition-colors">
                <BookOpen className="w-4 h-4 text-blue-700"/>
              </div>
              <div className="text-left">
                <p className="text-sm font-bold text-blue-900">Generate Consolidated Statement</p>
                <p className="text-xs text-blue-600 mt-0.5">Full invoice with complete payment history — ready to print</p>
              </div>
            </div>
            <Download className="w-4 h-4 text-blue-500"/>
          </button>

          {/* Print Outstanding Balance */}
          {!isFullyPaid && (
            <button
              onClick={()=>{
                const w=window.open('','_blank')
                if (!w) return
                w.document.write(`<!DOCTYPE html><html><head><title>Outstanding Balance</title>
<style>
  body{font-family:system-ui,sans-serif;padding:40px;color:#1a1a1a;max-width:500px;margin:0 auto}
  h1{font-size:22px;margin-bottom:4px}
  .sub{font-size:13px;color:#6a6a7a;margin-bottom:24px}
  .row{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #f0f0f0;font-size:14px}
  .total{font-size:20px;font-weight:700;margin-top:12px}
  .ref{font-size:11px;color:#9a9aaa;margin-top:20px}
  @media print{@page{margin:20mm}}
</style></head><body>
<h1>Outstanding Balance Notice</h1>
<div class="sub">${proposal.client_name} · ${proposal.proposal_number}</div>
<div class="row"><span>Booking Value</span><span>${fmtINRFull(grandTotal)}</span></div>
<div class="row"><span>Amount Received</span><span style="color:#15803d">${fmtINRFull(totalReceived)}</span></div>
<div class="row total"><span>Balance Due</span><span style="color:#d97706">${fmtINRFull(balanceDue)}</span></div>
<div class="ref">BookMySpaces · ${proposal.proposal_number} · ${new Date().toLocaleDateString('en-IN')}</div>
<script>setTimeout(()=>window.print(),500)</script>
</body></html>`)
                w.document.close()
              }}
              className="w-full flex items-center justify-between px-4 py-3 bg-orange-50 border border-orange-200 rounded-xl hover:bg-orange-100 transition-colors group">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-orange-100 rounded-lg group-hover:bg-orange-200 transition-colors">
                  <Wallet className="w-4 h-4 text-orange-700"/>
                </div>
                <div className="text-left">
                  <p className="text-sm font-bold text-orange-900">Print Outstanding Balance</p>
                  <p className="text-xs text-orange-600 mt-0.5">
                    Quick notice — Balance due: <strong>{fmtINRFull(balanceDue)}</strong>
                  </p>
                </div>
              </div>
              <Download className="w-4 h-4 text-orange-500"/>
            </button>
          )}

          {isFullyPaid && (
            <div className="flex items-center gap-3 px-4 py-3 bg-emerald-50 border border-emerald-200 rounded-xl">
              <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0"/>
              <div>
                <p className="text-sm font-bold text-emerald-800">Fully Settled</p>
                <p className="text-xs text-emerald-600">All payments received. No outstanding balance.</p>
              </div>
            </div>
          )}
        </div>

        {/* Email actions — Task 1: wire the three existing email APIs
            (invoice/email, booking-confirmation, payment-reminder) */}
        <div className="space-y-2">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest">Email Documents</p>

          <button
            onClick={()=>sendEmailAction('invoice/email','Invoice')}
            disabled={emailAction!==null}
            className="w-full flex items-center justify-between px-4 py-3 bg-violet-50 border border-violet-200 rounded-xl hover:bg-violet-100 transition-colors group disabled:opacity-60 disabled:cursor-not-allowed">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-violet-100 rounded-lg group-hover:bg-violet-200 transition-colors">
                {emailAction==='invoice/email'
                  ? <Loader2 className="w-4 h-4 text-violet-700 animate-spin"/>
                  : <Receipt className="w-4 h-4 text-violet-700"/>}
              </div>
              <div className="text-left">
                <p className="text-sm font-bold text-violet-900">{emailAction==='invoice/email' ? 'Sending Invoice…' : 'Send Invoice'}</p>
                <p className="text-xs text-violet-600 mt-0.5">Emails the latest invoice to the customer</p>
              </div>
            </div>
            <Mail className="w-4 h-4 text-violet-500"/>
          </button>

          <button
            onClick={()=>sendEmailAction('booking-confirmation','Booking confirmation')}
            disabled={emailAction!==null}
            className="w-full flex items-center justify-between px-4 py-3 bg-emerald-50 border border-emerald-200 rounded-xl hover:bg-emerald-100 transition-colors group disabled:opacity-60 disabled:cursor-not-allowed">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-emerald-100 rounded-lg group-hover:bg-emerald-200 transition-colors">
                {emailAction==='booking-confirmation'
                  ? <Loader2 className="w-4 h-4 text-emerald-700 animate-spin"/>
                  : <CheckCircle2 className="w-4 h-4 text-emerald-700"/>}
              </div>
              <div className="text-left">
                <p className="text-sm font-bold text-emerald-900">{emailAction==='booking-confirmation' ? 'Sending Confirmation…' : 'Send Booking Confirmation'}</p>
                <p className="text-xs text-emerald-600 mt-0.5">Emails the booking confirmation to the customer</p>
              </div>
            </div>
            <Mail className="w-4 h-4 text-emerald-500"/>
          </button>

          <button
            onClick={()=>sendEmailAction('payment-reminder','Payment reminder')}
            disabled={emailAction!==null || isFullyPaid}
            title={isFullyPaid ? 'No outstanding balance — reminder not applicable' : undefined}
            className="w-full flex items-center justify-between px-4 py-3 bg-orange-50 border border-orange-200 rounded-xl hover:bg-orange-100 transition-colors group disabled:opacity-60 disabled:cursor-not-allowed">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-orange-100 rounded-lg group-hover:bg-orange-200 transition-colors">
                {emailAction==='payment-reminder'
                  ? <Loader2 className="w-4 h-4 text-orange-700 animate-spin"/>
                  : <Wallet className="w-4 h-4 text-orange-700"/>}
              </div>
              <div className="text-left">
                <p className="text-sm font-bold text-orange-900">{emailAction==='payment-reminder' ? 'Sending Reminder…' : 'Send Payment Reminder'}</p>
                <p className="text-xs text-orange-600 mt-0.5">
                  {isFullyPaid ? 'Fully settled — nothing due' : <>Reminds the customer of the <strong>{fmtINRFull(balanceDue)}</strong> balance due</>}
                </p>
              </div>
            </div>
            <Mail className="w-4 h-4 text-orange-500"/>
          </button>
        </div>

      </div>
    </ModalShell>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatusPill({status}:{status:ProposalStatus}) {
  const cfg=STATUS_CONFIG[status]; const Icon=cfg.icon
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${cfg.pill}`}>
      <Icon className="w-3 h-3"/>{cfg.label}
    </span>
  )
}

function PaymentPill({status}:{status:PaymentStatus|null}) {
  if (!status||status==='pending') return null
  const cfg=PAYMENT_CONFIG[status]
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold border ${cfg.color}`}>
      <IndianRupee className="w-2.5 h-2.5"/>{cfg.label}
    </span>
  )
}

function UrgencyBar({score}:{score:number}) {
  const color=score>=75?'bg-red-500':score>=50?'bg-amber-500':score>=25?'bg-blue-500':'bg-gray-200'
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{width:`${score}%`}}/>
      </div>
      <span className="text-xs font-bold text-gray-600 tabular-nums w-6 text-right">{score}</span>
    </div>
  )
}

function EngagementDots({count}:{count:number}) {
  const dots=Math.min(count,5)
  return (
    <div className="flex gap-0.5">
      {Array.from({length:5}).map((_,i)=>(
        <span key={i} className={`w-2 h-2 rounded-full ${i<dots?'bg-blue-500':'bg-gray-200'}`}
          title={`${count} view${count!==1?'s':''}`}/>
      ))}
    </div>
  )
}

function IntelligencePanel({proposal,urgency,onAction}:{
  proposal:ProposalWithLead; urgency:ProposalUrgencyResult
  onAction:(action:string,proposalId:string)=>void
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 bg-gray-50/80 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-blue-600"/>
          <span className="text-sm font-bold text-gray-900">Intelligence</span>
          {urgency.escalationRequired&&(
            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-red-600 text-white text-xs font-bold rounded animate-pulse">
              <AlertTriangle className="w-2.5 h-2.5"/> PRIORITY
            </span>
          )}
        </div>
        {urgency.riskLevel&&(
          <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${RISK_CONFIG[urgency.riskLevel].color}`}>
            {RISK_CONFIG[urgency.riskLevel].label}
          </span>
        )}
      </div>
      <div className="px-4 py-3 space-y-3">
        <div>
          <p className="text-xs text-gray-400 mb-1 font-medium">URGENCY SCORE</p>
          <UrgencyBar score={urgency.urgencyScore}/>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="bg-gray-50 rounded-lg p-2.5">
            <p className="text-xs text-gray-400">Views</p>
            <div className="flex items-center gap-1.5 mt-1">
              <EngagementDots count={proposal.viewed_count??0}/>
              <span className="text-xs font-bold text-gray-700">{proposal.viewed_count??0}</span>
            </div>
          </div>
          <div className="bg-gray-50 rounded-lg p-2.5">
            <p className="text-xs text-gray-400">Engagement</p>
            <p className="text-sm font-bold text-gray-700 mt-0.5">{proposal.engagement_score??0}/100</p>
          </div>
          <div className="bg-gray-50 rounded-lg p-2.5">
            <p className="text-xs text-gray-400">Last Viewed</p>
            <p className="text-xs font-semibold text-gray-700 mt-0.5">{timeAgo(proposal.last_viewed_at)}</p>
          </div>
          <div className="bg-gray-50 rounded-lg p-2.5">
            <p className="text-xs text-gray-400">Since Sent</p>
            <p className={`text-xs font-semibold mt-0.5 ${urgency.hoursWithoutResponse&&urgency.hoursWithoutResponse>48?'text-red-600':'text-gray-700'}`}>
              {urgency.hoursWithoutResponse!==null?`${urgency.hoursWithoutResponse}h`:'—'}
            </p>
          </div>
        </div>
        {urgency.recommendation&&(
          <div className="bg-blue-50 rounded-lg p-2.5 border border-blue-100">
            <p className="text-xs font-semibold text-blue-700 mb-0.5">Recommendation</p>
            <p className="text-xs text-blue-600">{urgency.recommendation}</p>
          </div>
        )}
        <button onClick={()=>onAction(urgency.nextAction,proposal.id)}
          className={`w-full flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-bold border transition-colors ${
            urgency.urgencyScore>=70?'bg-red-600 text-white border-red-700 hover:bg-red-700':
            urgency.urgencyScore>=40?'bg-amber-500 text-white border-amber-600 hover:bg-amber-600':
            'bg-blue-600 text-white border-blue-700 hover:bg-blue-700'}`}>
          <Zap className="w-3.5 h-3.5"/>{urgency.actionLabel}
        </button>
      </div>
    </div>
  )
}

// ─── Proposal card ────────────────────────────────────────────────────────────

function ProposalCard({proposal,onAction,onStatusUpdate,onPayment,onReceipts,onFinance}:{
  proposal       : ProposalWithLead
  onAction       : (action:string,proposalId:string)=>void
  onStatusUpdate : (id:string,status:ProposalStatus)=>void
  onPayment      : (proposal:ProposalWithLead)=>void
  onReceipts     : (proposal:ProposalWithLead)=>void   // NEW
  onFinance      : (proposal:ProposalWithLead)=>void   // NEW
}) {
  const [expanded,setExpanded]=useState(false)
  const lead    = toLeadSnapshot(proposal.leads)
  const snap    = toProposalSnapshot(proposal)
  const urgency = computeProposalUrgency(snap,lead)
  const temp    = proposal.leads?.lead_temperature

  const borderColor=
    urgency.riskLevel==='critical'?'border-l-red-500':
    urgency.riskLevel==='high'    ?'border-l-amber-500':
    urgency.riskLevel==='medium'  ?'border-l-blue-400':'border-l-gray-200'

  const isAccepted = proposal.status==='accepted'
  const payStatus  = proposal.payment_status ?? 'pending'
  const hasPaid    = (proposal.advance_paid??0) > 0

  return (
    <div className={`bg-white rounded-xl border border-gray-200 border-l-4 ${borderColor} overflow-hidden transition-shadow hover:shadow-md`}>
      <div className="px-4 py-3">
        <div className="flex items-start justify-between gap-3 mb-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-bold text-gray-900 truncate">{proposal.client_name??'Unknown Client'}</span>
              {proposal.proposal_number&&<span className="text-xs text-gray-400 font-mono">{proposal.proposal_number}</span>}
              {temp==='HOT'&&<span className="inline-flex items-center gap-0.5 text-xs font-semibold text-red-600"><Flame className="w-3 h-3"/> HOT</span>}
              {urgency.escalationRequired&&(
                <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-red-600 text-white text-xs font-bold rounded">
                  <AlertTriangle className="w-2.5 h-2.5"/> PRIORITY
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              <StatusPill status={proposal.status}/>
              <PaymentPill status={payStatus}/>
              {proposal.event_type&&<span className="text-xs text-gray-500 capitalize">{proposal.event_type}</span>}
              {proposal.event_date&&(
                <span className="text-xs text-gray-400">
                  {new Date(proposal.event_date).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'})}
                </span>
              )}
            </div>
          </div>

          {/* Right column — value + finance summary */}
          <div className="text-right flex-shrink-0">
            {proposal.total_price&&<p className="text-base font-black text-gray-900">{formatINR(proposal.total_price)}</p>}
            {isAccepted&&hasPaid&&(
              <div className="mt-1 space-y-0.5">
                <p className="text-xs text-emerald-600 font-medium">
                  Paid: {formatINR(proposal.advance_paid??0)}
                </p>
                {(proposal.balance_due??0)>0
                  ? <p className="text-xs text-amber-600 font-semibold">Due: {formatINR(proposal.balance_due??0)}</p>
                  : <p className="text-xs text-emerald-700 font-bold">✓ Settled</p>
                }
              </div>
            )}
            {proposal.guest_count&&<p className="text-xs text-gray-400 mt-1">{proposal.guest_count} guests</p>}
          </div>
        </div>
        <div className="mb-2"><UrgencyBar score={urgency.urgencyScore}/></div>
        <div className="flex items-center gap-3 text-xs text-gray-500">
          {proposal.sent_at&&<span className="flex items-center gap-1"><Send className="w-3 h-3"/>{timeAgo(proposal.sent_at)}</span>}
          {(proposal.viewed_count??0)>0&&(
            <span className="flex items-center gap-1 text-blue-600 font-medium">
              <Eye className="w-3 h-3"/>{proposal.viewed_count} view{proposal.viewed_count!==1?'s':''}
            </span>
          )}
          {proposal.last_viewed_at&&<span className="flex items-center gap-1"><Clock className="w-3 h-3"/>last {timeAgo(proposal.last_viewed_at)}</span>}
          {/* Quick finance summary inline — shown when accepted and has payments */}
          {isAccepted&&hasPaid&&(
            <span className="ml-auto text-xs text-gray-400">
              {formatINR(proposal.total_price??0)} · {formatINR(proposal.advance_paid??0)} paid
            </span>
          )}
        </div>
      </div>

      {/* ── Action strip ─────────────────────────────────────────────────── */}
      <div className="px-4 py-2 bg-gray-50/60 border-t border-gray-100 flex items-center gap-1.5 flex-wrap">

        {/* Standard actions — always visible */}
        <button onClick={()=>onAction('send_via_whatsapp',proposal.id)}
          className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-green-50 text-green-700 border border-green-200 rounded-lg text-xs font-semibold hover:bg-green-100 transition-colors">
          <MessageSquare className="w-3 h-3"/> WhatsApp
        </button>
        <button onClick={()=>onAction('send_via_email',proposal.id)}
          className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-blue-50 text-blue-700 border border-blue-200 rounded-lg text-xs font-semibold hover:bg-blue-100 transition-colors">
          <Mail className="w-3 h-3"/> Email
        </button>
        <button onClick={()=>window.open(`/api/proposals/${proposal.id}/pdf`,'_blank')}
          className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-purple-50 text-purple-700 border border-purple-200 rounded-lg text-xs font-semibold hover:bg-purple-100 transition-colors">
          <Download className="w-3 h-3"/> PDF
        </button>
        <button onClick={()=>{navigator.clipboard.writeText(`${window.location.origin}/proposals/share/${proposal.id}`);alert('Share link copied!')}}
          className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-gray-100 text-gray-600 border border-gray-200 rounded-lg text-xs font-semibold hover:bg-gray-200 transition-colors">
          <Copy className="w-3 h-3"/> Copy Link
        </button>

        {/* Payment actions — accepted proposals only */}
        {isAccepted && (
          <>
            {/* Record Payment */}
            <button onClick={()=>onPayment(proposal)}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-emerald-600 text-white rounded-lg text-xs font-semibold hover:bg-emerald-700 transition-colors">
              <IndianRupee className="w-3 h-3"/> Record Payment
            </button>

            {/* ── NEW: Advance Receipts ── */}
            <button onClick={()=>onReceipts(proposal)}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-teal-50 text-teal-700 border border-teal-200 rounded-lg text-xs font-semibold hover:bg-teal-100 transition-colors">
              <Receipt className="w-3 h-3"/> Advance Receipts
              {hasPaid&&(
                <span className="ml-0.5 bg-teal-200 text-teal-800 text-xs font-bold px-1 py-0 rounded-full leading-4">
                  ✓
                </span>
              )}
            </button>

            {/* ── NEW: Financial Documents ── */}
            <button onClick={()=>onFinance(proposal)}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-amber-50 text-amber-700 border border-amber-200 rounded-lg text-xs font-semibold hover:bg-amber-100 transition-colors">
              <Wallet className="w-3 h-3"/> Financial Documents
            </button>

            {/* V3 Sprint 3 — Convert Proposal -> Reservation. Only offered once
                accepted (converting a still-negotiating proposal into a real
                inventory hold would be premature). Pre-fills the Reservation
                Dashboard's New Reservation modal from this proposal's data;
                the operator still picks/confirms dates + inventory there. */}
            <Link href={`/reservations?fromProposalId=${proposal.id}`}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-lg text-xs font-semibold hover:bg-indigo-100 transition-colors">
              <BookOpen className="w-3 h-3"/> Convert to Reservation
            </Link>
          </>
        )}

        {!isAccepted&&(
          <button onClick={()=>onStatusUpdate(proposal.id,'accepted')}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-lg text-xs font-semibold hover:bg-emerald-100 transition-colors ml-auto">
            <CheckCircle2 className="w-3 h-3"/> Mark Accepted
          </button>
        )}

        <button onClick={()=>setExpanded(p=>!p)}
          className="ml-auto p-1 text-gray-400 hover:text-gray-600" title="Toggle intelligence">
          {expanded?<ChevronUp className="w-4 h-4"/>:<ChevronDown className="w-4 h-4"/>}
        </button>
      </div>

      {/* Intelligence panel */}
      {expanded&&(
        <div className="px-4 pb-4 pt-2 border-t border-gray-100 grid grid-cols-1 md:grid-cols-2 gap-4">
          <IntelligencePanel proposal={proposal} urgency={urgency} onAction={onAction}/>
          <div className="space-y-3">
            {proposal.ai_summary&&(
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">AI Summary</p>
                <p className="text-sm text-gray-700 leading-relaxed">{proposal.ai_summary}</p>
              </div>
            )}
            {proposal.urgency_cta&&(
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                <p className="text-xs font-bold text-amber-700 mb-1">Urgency Message</p>
                <p className="text-xs text-amber-600">{proposal.urgency_cta}</p>
              </div>
            )}
            {proposal.client_phone&&(
              <a href={`tel:${proposal.client_phone}`}
                className="inline-flex items-center gap-2 px-3 py-2 bg-gray-100 text-gray-700 rounded-lg text-xs font-semibold hover:bg-gray-200 transition-colors w-full justify-center">
                <Phone className="w-3.5 h-3.5"/> Call {proposal.client_name??'Client'}
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function ProposalsPage() {
  const [proposals,    setProposals]    = useState<ProposalWithLead[]>([])
  const [loading,      setLoading]      = useState(true)
  const [filter,       setFilter]       = useState<FilterTab>('all')
  const [search,       setSearch]       = useState('')
  const [sortBy,       setSortBy]       = useState<'urgency'|'created'|'value'>('urgency')
  const [lastRefresh,  setLastRefresh]  = useState(new Date())

  // ── Modal state ────────────────────────────────────────────────────────
  const [payModal,      setPayModal]      = useState<ProposalWithLead|null>(null)
  const [receiptsModal, setReceiptsModal] = useState<ProposalWithLead|null>(null) // NEW
  const [financeModal,  setFinanceModal]  = useState<ProposalWithLead|null>(null) // NEW

  const fetchProposals = useCallback(async()=>{
    setLoading(true)
    try {
      const res  = await fetch('/api/proposals/intelligence')
      const data = await res.json() as {proposals?:ProposalWithLead[]}
      setProposals(Array.isArray(data)?data:data.proposals??[])
      setLastRefresh(new Date())
    } catch(err) { console.error('[Proposals] fetch error:',err) }
    finally { setLoading(false) }
  },[])

  useEffect(()=>{ fetchProposals() },[fetchProposals])

  async function handleStatusUpdate(id:string,status:ProposalStatus) {
    try {
      await fetch('/api/proposals',{
        method:'PATCH',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({id,status,...(status==='accepted'?{accepted_at:new Date().toISOString()}:{})}),
      })
      setProposals(prev=>prev.map(p=>p.id===id?{...p,status}:p))
    } catch(err) { console.error('[Proposals] status update error:',err) }
  }

  async function handleSendEmail(proposalId:string) {
    try {
      const res = await fetch('/api/proposals/email', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ proposal_id: proposalId }),
      })
      const data = await res.json().catch(()=>({}))
      if (!res.ok) {
        alert(data.error ? `Could not send email: ${data.error}` : 'Could not send email.')
        return
      }
      if (data.method === 'email') {
        alert(`Proposal emailed to ${data.sent_to}.`)
      } else if (data.method === 'mailto') {
        // No email provider configured yet — same graceful fallback the
        // backend has always had (see src/app/api/proposals/email/route.ts).
        window.open(data.mailto_url, '_blank')
      }
      handleStatusUpdate(proposalId, 'sent')
    } catch {
      alert('Could not send email — please try again.')
    }
  }

  function handleAction(action:string,proposalId:string) {
    const proposal=proposals.find(p=>p.id===proposalId); if (!proposal) return
    if (action==='send_via_whatsapp'&&proposal.client_phone) {
      const msg=encodeURIComponent(`Dear ${proposal.client_name??'Sir/Ma\'am'}, please find your proposal: ${window.location.origin}/proposals/share/${proposalId}`)
      window.open(`https://wa.me/${proposal.client_phone.replace(/\D/g,'')}?text=${msg}`,'_blank')
      handleStatusUpdate(proposalId,'sent')
    } else if (action==='send_via_email') {
      // ISS-041 fix: this used to just open a mailto: link directly in the
      // browser and never called the backend at all. Now it calls the real
      // email-sending route (src/app/api/proposals/email/route.ts), which
      // sends a real email via Resend and only falls back to mailto: if no
      // provider is configured.
      handleSendEmail(proposalId)
    } else if (action==='follow_up_now') {
      handleStatusUpdate(proposalId,'followed_up')
    } else if (action==='mark_accepted') {
      handleStatusUpdate(proposalId,'accepted')
    } else if (action==='escalate_to_sales') {
      alert(`Escalated: ${proposal.client_name} — ${proposal.proposal_number}`)
    }
  }

  // ── Derived stats (UNCHANGED) ──────────────────────────────────────────
  const actionNeededCount = proposals.filter(p=>{
    const u=computeProposalUrgency(toProposalSnapshot(p),toLeadSnapshot(p.leads))
    return u.followUpRequired||u.resendRecommended||u.escalationRequired
  }).length

  const totalValue       = proposals.reduce((s,p)=>s+(p.total_price??0),0)
  const acceptedValue    = proposals.filter(p=>p.status==='accepted').reduce((s,p)=>s+(p.total_price??0),0)
  const outstandingTotal = proposals.filter(p=>p.status==='accepted'&&(p.balance_due??0)>0).reduce((s,p)=>s+(p.balance_due??0),0)
  const advanceTotal     = proposals.reduce((s,p)=>s+(p.advance_paid??0),0)
  const fullyPaidCount   = proposals.filter(p=>p.payment_status==='fully_paid').length

  // ── Filter + sort (UNCHANGED) ──────────────────────────────────────────
  const displayed = proposals
    .filter(p=>{
      const u=computeProposalUrgency(toProposalSnapshot(p),toLeadSnapshot(p.leads))
      const matchesFilter=
        filter==='all'           ?true:
        filter==='action_needed' ?(u.followUpRequired||u.resendRecommended||u.escalationRequired):
        filter==='hot'           ?p.leads?.lead_temperature==='HOT':
        filter==='viewed'        ?p.status==='viewed':
        filter==='sent'          ?p.status==='sent':
        filter==='accepted'      ?p.status==='accepted':true
      const matchesSearch=!search||[p.client_name,p.client_phone,p.event_type,p.proposal_number]
        .some(f=>f?.toLowerCase().includes(search.toLowerCase()))
      return matchesFilter&&matchesSearch
    })
    .sort((a,b)=>{
      if (sortBy==='urgency') return (b.urgency_score??0)-(a.urgency_score??0)
      if (sortBy==='value')   return (b.total_price??0)-(a.total_price??0)
      return new Date(b.created_at).getTime()-new Date(a.created_at).getTime()
    })

  const FILTER_TABS:{id:FilterTab;label:string;count?:number}[] = [
    {id:'all',          label:'All',            count:proposals.length},
    {id:'action_needed',label:'⚡ Action Needed',count:actionNeededCount},
    {id:'hot',          label:'🔥 HOT Leads'},
    {id:'viewed',       label:'👁 Viewed'},
    {id:'sent',         label:'📨 Sent'},
    {id:'accepted',     label:'✅ Accepted'},
  ]

  return (
    <div className="min-h-screen bg-gray-50/60">

      {/* ── Modals ── */}
      {payModal && (
        <PaymentModal
          proposal={payModal}
          onClose={()=>setPayModal(null)}
          onSuccess={()=>{ setPayModal(null); fetchProposals() }}
        />
      )}
      {/* NEW: Advance Receipts modal */}
      {receiptsModal && (
        <ReceiptsModal
          proposal={receiptsModal}
          onClose={()=>setReceiptsModal(null)}
        />
      )}
      {/* NEW: Financial Documents modal */}
      {financeModal && (
        <FinanceModal
          proposal={financeModal}
          onClose={()=>setFinanceModal(null)}
        />
      )}

      {/* Header — UNCHANGED */}
      <header className="sticky top-0 z-20 bg-white/95 backdrop-blur border-b border-gray-200 px-6 py-3">
        <div className="max-w-screen-xl mx-auto flex items-center justify-between gap-4">
          <div>
            <h1 className="text-base font-black text-gray-900 flex items-center gap-2">
              <FileText className="w-4 h-4 text-blue-600"/> Proposal Intelligence
            </h1>
            <p className="text-xs text-gray-400">
              {proposals.length} proposals · {actionNeededCount} need action · {lastRefresh.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'})}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {actionNeededCount>0&&(
              <button onClick={()=>setFilter('action_needed')}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-red-600 text-white rounded-lg text-xs font-bold animate-pulse hover:bg-red-700">
                <AlertTriangle className="w-3.5 h-3.5"/> {actionNeededCount} need action
              </button>
            )}
            <button onClick={fetchProposals} disabled={loading}
              className="flex items-center gap-1.5 px-3 py-2 border border-gray-200 rounded-lg text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-50">
              <RefreshCw className={`w-3.5 h-3.5 ${loading?'animate-spin':''}`}/> Refresh
            </button>
            <Link href="/proposals/new"
              className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 text-white rounded-lg text-xs font-bold hover:bg-blue-700 transition-colors">
              <Plus className="w-3.5 h-3.5"/> New Proposal
            </Link>
          </div>
        </div>
      </header>

      <div className="max-w-screen-xl mx-auto px-6 py-5 space-y-5">

        {/* KPI strip — UNCHANGED */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            {label:'Total Proposals',  value:proposals.length,                                                                          icon:FileText,     color:'bg-gray-100 text-gray-600'},
            {label:'Action Needed',    value:actionNeededCount,                                                                         icon:AlertTriangle,color:'bg-red-100 text-red-600'},
            {label:'Pipeline Value',   value:formatINR(totalValue),                                                                     icon:TrendingUp,   color:'bg-blue-100 text-blue-600'},
            {label:'Won Revenue',      value:formatINR(acceptedValue),                                                                  icon:CheckCircle2, color:'bg-emerald-100 text-emerald-600'},
            {label:'Outstanding',      value:formatINR(outstandingTotal),                                                               icon:AlertTriangle,color:'bg-amber-100 text-amber-600'},
            {label:'Advance Received', value:formatINR(advanceTotal),                                                                   icon:IndianRupee,  color:'bg-teal-100 text-teal-600'},
            {label:'Fully Paid',       value:fullyPaidCount,                                                                            icon:CheckCircle2, color:'bg-green-100 text-green-600'},
            {label:'Pending Invoice',  value:proposals.filter(p=>p.status==='accepted'&&p.payment_status!=='fully_paid').length,        icon:Receipt,      color:'bg-purple-100 text-purple-600'},
          ].map(card=>(
            <div key={card.label} className="bg-white rounded-xl border border-gray-200 p-4">
              <div className="flex items-start justify-between mb-2">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest">{card.label}</p>
                <div className={`p-1.5 rounded-xl ${card.color}`}><card.icon className="w-4 h-4"/></div>
              </div>
              <p className="text-2xl font-black text-gray-900">{card.value}</p>
            </div>
          ))}
        </div>

        {/* Filters — UNCHANGED */}
        <div className="bg-white rounded-2xl border border-gray-200 px-4 py-3">
          <div className="flex flex-wrap items-center gap-1.5 mb-3">
            {FILTER_TABS.map(f=>(
              <button key={f.id} onClick={()=>setFilter(f.id)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${filter===f.id?'bg-blue-600 text-white shadow-sm':'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                {f.label}
                {f.count!==undefined&&(
                  <span className={`px-1.5 py-0.5 rounded-full text-xs font-bold ${filter===f.id?'bg-white/25 text-white':'bg-gray-200 text-gray-500'}`}>{f.count}</span>
                )}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative">
              <Search className="absolute left-3 top-2.5 w-3.5 h-3.5 text-gray-400"/>
              <input type="text" value={search} onChange={e=>setSearch(e.target.value)}
                placeholder="Client, phone, event..."
                className="pl-8 pr-3 py-2 border border-gray-200 rounded-lg text-xs w-44 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50"/>
            </div>
            <div className="flex items-center gap-1.5 ml-auto">
              <Filter className="w-3.5 h-3.5 text-gray-400"/>
              <select value={sortBy} onChange={e=>setSortBy(e.target.value as typeof sortBy)}
                className="border border-gray-200 rounded-lg text-xs px-2 py-2 focus:outline-none bg-gray-50">
                <option value="urgency">Sort: Urgency</option>
                <option value="value">Sort: Value</option>
                <option value="created">Sort: Newest</option>
              </select>
            </div>
          </div>
        </div>

        {/* Cards */}
        {loading ? (
          <div className="flex justify-center py-16"><RefreshCw className="w-6 h-6 animate-spin text-blue-600"/></div>
        ) : displayed.length===0 ? (
          <div className="text-center py-16 bg-white rounded-2xl border border-gray-200">
            <FileText className="w-10 h-10 text-gray-300 mx-auto mb-3"/>
            <p className="text-sm font-semibold text-gray-500">No proposals match the current filter</p>
            <button onClick={()=>{setFilter('all');setSearch('')}} className="mt-3 text-xs text-blue-600 hover:underline">Clear filters</button>
          </div>
        ) : (
          <div className="space-y-3">
            {displayed.map(proposal=>(
              <ProposalCard
                key={proposal.id}
                proposal={proposal}
                onAction={handleAction}
                onStatusUpdate={handleStatusUpdate}
                onPayment={p=>setPayModal(p)}
                onReceipts={p=>setReceiptsModal(p)}   // NEW
                onFinance={p=>setFinanceModal(p)}      // NEW
              />
            ))}
          </div>
        )}

        {displayed.length>0&&(
          <p className="text-xs text-gray-400 text-center py-2">
            {displayed.length} of {proposals.length} proposals · {formatINR(displayed.reduce((s,p)=>s+(p.total_price??0),0))} total value
          </p>
        )}

      </div>
    </div>
  )
}
