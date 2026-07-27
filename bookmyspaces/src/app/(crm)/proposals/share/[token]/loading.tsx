// RC hardening (Phase 7, UI/UX polish) — this route's page.tsx is a Server
// Component that awaits a Supabase read before rendering anything (see its
// own header comment: no client-side fetch, no loading state of its own).
// Without a loading.tsx, Next.js shows a blank white page for the entire
// server-side fetch duration — the worst possible first impression on a
// customer-facing, unauthenticated page that may be opened over a slow
// mobile connection. Next.js App Router automatically wraps page.tsx in a
// Suspense boundary using this file, so this is a pure addition — it
// changes nothing about how the real page fetches or renders once ready.
// Colors/shape match page.tsx's own palette (#f8f6f2 background, navy
// header gradient, gold accents) so the transition from skeleton to real
// content doesn't flash or jump.
export default function ProposalShareLoading() {
  return (
    <div className="min-h-screen bg-[#f8f6f2] py-10 px-4">
      <div className="max-w-4xl mx-auto bg-white rounded-3xl shadow-sm overflow-hidden border border-[#e7dcc7] animate-pulse">
        <div className="bg-gradient-to-r from-[#0d1b2a] to-[#1b263b] px-10 py-12">
          <div className="h-10 w-64 bg-white/20 rounded mb-4" />
          <div className="h-3 w-48 bg-white/10 rounded" />
          <div className="h-12 w-80 bg-white/20 rounded mt-16 mb-4" />
          <div className="h-3 w-56 bg-white/10 rounded" />
        </div>

        <div className="p-10 space-y-10">
          <div className="space-y-3">
            <div className="h-3 w-32 bg-[#f0ead9] rounded" />
            <div className="h-4 w-full bg-[#f5f1e6] rounded" />
            <div className="h-4 w-5/6 bg-[#f5f1e6] rounded" />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="border border-[#e7dcc7] rounded-2xl p-6 space-y-3">
              <div className="h-3 w-28 bg-[#f0ead9] rounded" />
              <div className="h-3 w-full bg-[#f5f1e6] rounded" />
              <div className="h-3 w-4/5 bg-[#f5f1e6] rounded" />
              <div className="h-3 w-3/5 bg-[#f5f1e6] rounded" />
            </div>
            <div className="border border-[#e7dcc7] rounded-2xl p-6 space-y-3">
              <div className="h-3 w-28 bg-[#f0ead9] rounded" />
              <div className="h-3 w-full bg-[#f5f1e6] rounded" />
              <div className="h-3 w-4/5 bg-[#f5f1e6] rounded" />
            </div>
          </div>

          <div className="space-y-4">
            <div className="h-16 w-full bg-[#f0ead9] rounded-2xl" />
            <div className="h-16 w-full bg-[#f0ead9] rounded-2xl" />
          </div>
        </div>
      </div>
    </div>
  )
}
