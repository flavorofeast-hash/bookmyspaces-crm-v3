// Shared payment-amount business rules for the Record Payment flow.
// Used by both the modal (client) and the payment API route (server) so the
// same rule is enforced on both sides.

export function computeOutstanding(totalPrice: number | null | undefined, advancePaid: number | null | undefined): number {
  return Math.max(0, (totalPrice ?? 0) - (advancePaid ?? 0))
}

// Returns an error message if the amount is invalid, or null if it's OK.
export function validatePaymentAmount(amount: number, outstanding: number): string | null {
  if (!amount || amount <= 0) return 'Enter a valid amount'
  if (amount > outstanding + 0.01) return `Amount cannot exceed the outstanding balance of ₹${outstanding.toLocaleString('en-IN')}`
  return null
}
