// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { PaymentModal, PaymentModalProposal } from './PaymentModal'

afterEach(cleanup)

// Mirrors the parent's mount site: `{payModal && <PaymentModal key={payModal.id} .../>}`
function renderForProposal(proposal: PaymentModalProposal) {
  return render(
    <PaymentModal key={proposal.id} proposal={proposal} onClose={() => {}} onSuccess={() => {}} />
  )
}

const proposalA: PaymentModalProposal = {
  id: 'proposal-026', client_name: 'Sneha Mukherjee', proposal_number: 'BMS-2026-026',
  total_price: 25000, advance_paid: 0,
}
const proposalB: PaymentModalProposal = {
  id: 'proposal-028', client_name: 'Mia Amore', proposal_number: 'BMS-2026-028',
  total_price: 3000, advance_paid: 0,
}

describe('PaymentModal — cross-proposal state isolation (regression for the ₹25,000 carry-over bug)', () => {
  it('initializes the amount from proposal A\'s own outstanding balance', () => {
    renderForProposal(proposalA)
    expect(screen.getByLabelText(/Amount/i)).toHaveValue(25000)
  })

  it('does NOT carry proposal A\'s amount into proposal B — opens B pre-filled with B\'s own balance', () => {
    const { unmount } = renderForProposal(proposalA)
    const amountFieldA = screen.getByLabelText(/Amount/i) as HTMLInputElement
    expect(amountFieldA).toHaveValue(25000)

    // Close (unmount, exactly as `onClose => setPayModal(null)` does in the parent)
    unmount()

    // Open Record Payment for a different, much smaller proposal
    renderForProposal(proposalB)
    const amountFieldB = screen.getByLabelText(/Amount/i) as HTMLInputElement
    expect(amountFieldB).toHaveValue(3000)
    expect(amountFieldB).not.toHaveValue(25000)
  })

  it('resets stale fields (mode/type/date/ref/notes) when switching proposals', async () => {
    const user = (await import('@testing-library/user-event')).default.setup()
    const { unmount } = renderForProposal(proposalA)

    await user.selectOptions(screen.getByLabelText(/Payment Mode/i), 'cash')
    await user.selectOptions(screen.getByLabelText(/Payment Type/i), 'final')
    await user.type(screen.getByLabelText(/Transaction Reference/i), 'CHQ-9999')
    await user.type(screen.getByLabelText(/Notes/i), 'stale note from proposal A')

    unmount()
    renderForProposal(proposalB)

    expect(screen.getByLabelText(/Payment Mode/i)).toHaveValue('upi')
    expect(screen.getByLabelText(/Payment Type/i)).toHaveValue('advance')
    expect(screen.getByLabelText(/Transaction Reference/i)).toHaveValue('')
    expect(screen.getByLabelText(/Notes/i)).toHaveValue('')
  })

  it('rejects an amount greater than the outstanding balance on submit', async () => {
    const user = (await import('@testing-library/user-event')).default.setup()
    const onSuccess = vi.fn()
    render(<PaymentModal proposal={proposalB} onClose={() => {}} onSuccess={onSuccess} />)

    const amountField = screen.getByLabelText(/Amount/i)
    await user.clear(amountField)
    await user.type(amountField, '25000')
    await user.click(screen.getByRole('button', { name: /Record Payment/i }))

    expect(await screen.findByText(/cannot exceed the outstanding balance/i)).toBeInTheDocument()
    expect(onSuccess).not.toHaveBeenCalled()
  })

  it('accepts a valid amount within the outstanding balance', async () => {
    const user = (await import('@testing-library/user-event')).default.setup()
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ payment: {} }) }) as any
    const onSuccess = vi.fn()
    render(<PaymentModal proposal={proposalB} onClose={() => {}} onSuccess={onSuccess} />)

    await user.click(screen.getByRole('button', { name: /Record Payment/i }))

    expect(await screen.findByText(/Saving/i)).toBeInTheDocument()
  })

  it('has an accessible close button (preserves the existing aria-label)', () => {
    renderForProposal(proposalA)
    expect(screen.getByRole('button', { name: /close/i })).toBeInTheDocument()
  })
})
