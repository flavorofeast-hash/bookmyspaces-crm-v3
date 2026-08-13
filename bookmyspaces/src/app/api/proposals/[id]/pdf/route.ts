export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { logger } from '@/lib/logger'
import { getSupabaseAdmin } from '@/lib/supabase'
import { generateProposalHTML } from '@/lib/proposal-pdf'
import { requireAuth } from '@/lib/auth-guard'

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  // FIX: Wrap the entire handler and surface detailed errors.
  // Previously a failure inside generateProposalHTML or getSupabaseAdmin
  // would return a generic 500 with no diagnostic info.
  // Now errors log the exact failure point so you can see it in Vercel logs.

  // SECURITY: this route was previously unauthenticated — any caller who
  // could guess/enumerate a proposal UUID could read full client PII and
  // pricing. The client-facing share flow uses a separate token-based route
  // (src/app/api/proposal/share/[token]/route.ts) and does not depend on
  // this one; this route is for CRM staff to generate a PDF from within the
  // authenticated app, so it belongs behind requireAuth() like the sibling
  // invoice/receipt routes.
  const auth = await requireAuth()
  if (!auth.ok) return auth.response

  const supabaseAdmin = getSupabaseAdmin()

  let proposal: Record<string, unknown> | null = null

  // ── 1. Fetch proposal from Supabase ────────────────────────────────────────
  try {
    const { data, error } = await supabaseAdmin
      .from('proposals')
      .select('*')
      .eq('id', params.id)
      .single()

    if (error) {
      logger.error('proposals-pdf', 'Supabase fetch error', {
        id: params.id,
        message: error.message,
        code: error.code,
      })
      return new NextResponse(
        `Proposal not found (DB error: ${error.message})`,
        { status: 404 }
      )
    }

    if (!data) {
      return new NextResponse('Proposal not found', { status: 404 })
    }

    proposal = data as Record<string, unknown>
  } catch (dbErr) {
    logger.error('proposals-pdf', 'Unexpected DB error', dbErr)
    return new NextResponse('Database error — check Vercel logs', { status: 500 })
  }

  // ── 2. Generate HTML ────────────────────────────────────────────────────────
  let baseHtml: string
  try {
    baseHtml = generateProposalHTML(proposal as any)
  } catch (htmlErr) {
    // This is the most common failure on Vercel — generateProposalHTML
    // may reference env vars or Node APIs unavailable at edge.
    // The runtime = 'nodejs' export above should prevent edge execution,
    // but this catch makes failures visible instead of silent 500s.
    logger.error('proposals-pdf', 'HTML generation failed', htmlErr)
    return new NextResponse(
      `PDF generation failed: ${
        htmlErr instanceof Error ? htmlErr.message : String(htmlErr)
      }`,
      { status: 500 }
    )
  }

  // ── 3. Inject print styles + auto-print script ──────────────────────────────
  const printEnhancements = `
<style>
  @media print {
    @page { size: A4; margin: 0; }
    html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
    body { overflow: visible !important; }
    .no-break { page-break-inside: avoid; break-inside: avoid; }
    .page-break { page-break-after: always; break-after: always; }
  }
  @media screen {
    .pdf-loading-overlay {
      position: fixed; inset: 0;
      background: rgba(15,25,35,0.85);
      display: flex; flex-direction: column;
      align-items: center; justify-content: center;
      z-index: 9999; color: white;
      font-family: 'DM Sans',system-ui,sans-serif; gap: 16px;
    }
    .pdf-spinner {
      width: 40px; height: 40px;
      border: 3px solid rgba(255,255,255,0.2);
      border-top-color: #c9a84c;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
  }
</style>
<div class="pdf-loading-overlay" id="pdf-overlay">
  <div class="pdf-spinner"></div>
  <div style="font-size:16px;font-weight:600;">Preparing PDF…</div>
  <div style="font-size:13px;color:rgba(255,255,255,0.7);text-align:center;max-width:300px;line-height:1.5;">
    In the print dialog, select <strong>Save as PDF</strong>.
    Set paper size to <strong>A4</strong> and margins to <strong>None</strong>.
  </div>
</div>
<script>
  window.addEventListener('load', function() {
    setTimeout(function() {
      var overlay = document.getElementById('pdf-overlay');
      window.onafterprint = function() {
        if (overlay) {
          overlay.innerHTML = '<div style="color:white;text-align:center;padding:24px"><div style="font-size:18px;font-weight:600;margin-bottom:8px">✓ Done</div><div style="font-size:13px;opacity:0.7">You can close this tab.</div></div>';
          setTimeout(function(){ overlay.style.display = 'none'; }, 2000);
        }
      };
      if (overlay) overlay.style.display = 'none';
      window.print();
    }, 800);
  });
</script>`

  const finalHtml = baseHtml.replace('</head>', printEnhancements + '</head>')

  // ── 4. Build filename ───────────────────────────────────────────────────────
  const proposalNum = (
    (proposal.proposal_number as string) ?? `proposal-${params.id.slice(0, 8)}`
  ).replace(/[^a-zA-Z0-9\-]/g, '-')

  const clientSlug = ((proposal.client_name as string) ?? 'client')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '-')
    .slice(0, 30)

  const filename = `BookMySpaces-${proposalNum}-${clientSlug}.pdf`

  return new NextResponse(finalHtml, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Disposition': `filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  })
}
