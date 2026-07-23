import Link from "next/link"
import { notFound } from "next/navigation"
import { getSupabaseAdmin } from "@/lib/supabase"

export const dynamic = "force-dynamic"

interface Props {
  params: {
    token: string;
  };
}

async function getProposal(token: string) {
  // Created lazily, inside the request-time function — not at module scope.
  // getSupabaseAdmin() reads SUPABASE_SERVICE_ROLE_KEY (server-only, never
  // exposed to the browser), matching how every other Server Component/API
  // route in this codebase reads `leads`/`proposals`. This page has no auth
  // check by design — the unguessable share_token in the URL is the access
  // control, not RLS — so the previous anon/browser client (getSupabase(),
  // NEXT_PUBLIC_SUPABASE_ANON_KEY) was both the wrong client for a
  // server-only read and, being constructed at module scope, ran during
  // Next's build-time "Collecting page data" step rather than at an actual
  // request — see the explanation delivered alongside this fix for why
  // `export const dynamic = "force-dynamic"` alone did not prevent that.
  const supabase = getSupabaseAdmin()

  const { data, error } = await supabase
    .from("proposals")
    .select("*")
    .eq("share_token", token)
    .single();

  if (error || !data) {
    return null;
  }

  return data;
}

export default async function ProposalSharePage({ params }: Props) {
  const proposal = await getProposal(params.token);

  if (!proposal) {
    notFound();
  }

  const whatsappMessage = encodeURIComponent(`Hello BookMySpaces,

I would like to confirm my booking.

Proposal: ${proposal.proposal_number}
Client: ${proposal.client_name}
Event: ${proposal.event_type}
Date: ${proposal.event_date}

Please guide me with the next payment steps.`);

  return (
    <div className="min-h-screen bg-[#f8f6f2] py-10 px-4">
      <div className="max-w-4xl mx-auto bg-white rounded-3xl shadow-sm overflow-hidden border border-[#e7dcc7]">
        
        {/* HEADER */}
        <div className="bg-gradient-to-r from-[#0d1b2a] to-[#1b263b] text-white px-10 py-12">
          <div className="flex justify-between items-start">
            <div>
              <h1 className="text-5xl font-serif mb-4">BookMySpaces</h1>
              <p className="uppercase tracking-[0.3em] text-sm text-[#d4af37]">
                Premium Hospitality · Kolkata
              </p>
            </div>

            <div className="text-right">
              <p className="text-sm opacity-70">
                Proposal #{proposal.proposal_number}
              </p>
              <p className="mt-2 text-sm opacity-70">
                {proposal.created_at?.slice(0, 10)}
              </p>
            </div>
          </div>

          <div className="mt-16">
            <h2 className="text-6xl font-serif mb-6">
              Event Proposal
            </h2>

            <p className="uppercase tracking-[0.3em] text-[#d4af37]">
              Prepared for {proposal.client_name}
            </p>
          </div>
        </div>

        {/* CONTENT */}
        <div className="p-10 space-y-10">

          {/* COVER NOTE */}
          <div>
            <h3 className="text-sm uppercase tracking-[0.3em] text-[#c6a55b] mb-6">
              A Note From Us
            </h3>

            <div className="prose max-w-none text-[#1f2937] whitespace-pre-wrap leading-8">
              {proposal.ai_cover_note}
            </div>
          </div>

          {/* EVENT DETAILS */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            
            <div className="border border-[#e7dcc7] rounded-2xl p-6">
              <h4 className="text-sm uppercase tracking-[0.2em] text-[#c6a55b] mb-4">
                Event Details
              </h4>

              <div className="space-y-3 text-[#1f2937]">
                <p><strong>Client:</strong> {proposal.client_name}</p>
                <p><strong>Phone:</strong> {proposal.client_phone}</p>
                <p><strong>Event:</strong> {proposal.event_type}</p>
                <p><strong>Venue:</strong> {proposal.venue}</p>
                <p><strong>Guests:</strong> {proposal.guest_count}</p>
                <p><strong>Date:</strong> {proposal.event_date}</p>
              </div>
            </div>

            <div className="border border-[#e7dcc7] rounded-2xl p-6">
              <h4 className="text-sm uppercase tracking-[0.2em] text-[#c6a55b] mb-4">
                Pricing Summary
              </h4>

              <div className="space-y-3 text-[#1f2937]">
                <p>
                  <strong>Package:</strong> {proposal.package_name}
                </p>

                <p>
                  <strong>Total Package Value:</strong> ₹
                  {proposal.total_price}
                </p>

                <p className="text-2xl font-bold text-[#b7791f] mt-6">
                  Advance: ₹{proposal.advance_required}
                </p>

                <p className="text-sm text-gray-500">
                  Remaining balance due on event day
                </p>
              </div>
            </div>
          </div>

          {/* SPECIAL REQUIREMENTS */}
          {proposal.special_requirements && (
            <div className="border border-[#e7dcc7] rounded-2xl p-6">
              <h4 className="text-sm uppercase tracking-[0.2em] text-[#c6a55b] mb-4">
                Special Requirements
              </h4>

              <p className="text-[#1f2937]">
                {proposal.special_requirements}
              </p>
            </div>
          )}

          {/* VALIDITY */}
          <div className="bg-[#eef4ff] border border-[#b6ccff] rounded-2xl p-5 text-[#1d4ed8]">
            <strong>Proposal Validity:</strong> This proposal is valid for 7 days from the date of issue. Weekend slots fill quickly — we recommend confirming early.
          </div>

          {/* ACTION BUTTONS */}
          <div className="space-y-4">

            <a
              href={`https://wa.me/919051459463?text=${whatsappMessage}`}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full bg-[#25D366] hover:bg-[#1ebe5d] text-white font-semibold py-5 rounded-2xl flex items-center justify-center text-xl transition-all"
            >
              Confirm on WhatsApp
            </a>

            <a
              href="tel:+919051459463"
              className="w-full bg-[#0d1b2a] hover:bg-[#16263a] text-white font-semibold py-5 rounded-2xl flex items-center justify-center text-xl transition-all"
            >
              Call Us: +91 9051459463
            </a>

            <Link
              href={`/api/proposals/${proposal.id}/pdf`}
              target="_blank"
              className="w-full border-2 border-[#d4af37] text-[#b7791f] font-semibold py-5 rounded-2xl flex items-center justify-center text-xl hover:bg-[#fff7e6] transition-all"
            >
              Download PDF
            </Link>
          </div>
        </div>

        {/* FOOTER */}
        <div className="border-t border-[#ece7da] px-10 py-8 text-center text-sm text-gray-500">
          <p className="font-semibold text-[#374151]">
            BookMySpaces
          </p>

          <p className="mt-2">
            Mukundapur · Near EM Bypass · Kolkata
          </p>

          <p className="mt-2">
            9051459463 · 9830509991
          </p>

          <p className="mt-2 text-[#c6a55b]">
            www.bookmyspaces.in
          </p>
        </div>
      </div>
    </div>
  );
}