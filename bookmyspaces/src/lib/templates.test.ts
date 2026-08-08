import { describe, it, expect } from 'vitest'
import { WHATSAPP_MESSAGES } from './templates'

// Customer Loyalty & Referral Experience — new loyaltyPointsUpdate /
// referralRewardUpdate templates, plus backward-compatibility verification
// for postStayThankYou/eventThankYou now that they accept optional
// loyaltyPoints/loyaltyTier params.

describe('WHATSAPP_MESSAGES.loyaltyPointsUpdate', () => {
  it('includes points earned, balance, tier, and next-tier target', () => {
    const msg = WHATSAPP_MESSAGES.loyaltyPointsUpdate({
      name: 'Priya', pointsEarned: 250, balance: 750, tier: 'Silver', nextTierName: 'Gold', pointsToNextTier: 1250,
    })
    expect(msg).toContain('Priya')
    expect(msg).toContain('250')
    expect(msg).toContain('750')
    expect(msg).toContain('Silver')
    expect(msg).toContain('1,250')
    expect(msg).toContain('Gold')
    expect(msg).not.toContain('Congratulations')
  })

  it('announces a tier upgrade when upgradedTo is set', () => {
    const msg = WHATSAPP_MESSAGES.loyaltyPointsUpdate({ pointsEarned: 100, balance: 2100, tier: 'Gold', upgradedTo: 'Gold' })
    expect(msg).toContain('Congratulations')
    expect(msg).toContain('Gold')
  })

  it('shows a top-tier message when there is no next tier target', () => {
    const msg = WHATSAPP_MESSAGES.loyaltyPointsUpdate({ pointsEarned: 100, balance: 6000, tier: 'VIP' })
    expect(msg).toContain('top tier')
  })
})

describe('WHATSAPP_MESSAGES.referralRewardUpdate', () => {
  it('describes an earned reward with details and referral stats', () => {
    const msg = WHATSAPP_MESSAGES.referralRewardUpdate({ name: 'Amit', status: 'earned', rewardType: 'flat_credit', rewardValue: 500, totalReferrals: 3 })
    expect(msg).toContain('Amit')
    expect(msg).toContain('earned')
    expect(msg).toContain('flat credit')
    expect(msg).toContain('500')
    expect(msg).toContain('3')
    expect(msg).toContain('customers')
  })

  it('omits the reward-detail line when reward_type is unspecified', () => {
    const msg = WHATSAPP_MESSAGES.referralRewardUpdate({ status: 'pending' })
    expect(msg).not.toContain('🎁 Reward:')
    expect(msg).toContain('pending')
  })

  it('handles a singular referral count without pluralizing', () => {
    const msg = WHATSAPP_MESSAGES.referralRewardUpdate({ status: 'earned', totalReferrals: 1 })
    expect(msg).toContain('1 customer ')
  })

  it('covers redeemed and cancelled statuses', () => {
    expect(WHATSAPP_MESSAGES.referralRewardUpdate({ status: 'redeemed' })).toContain('redeemed')
    expect(WHATSAPP_MESSAGES.referralRewardUpdate({ status: 'cancelled' })).toContain('cancelled')
  })
})

describe('WHATSAPP_MESSAGES.postStayThankYou / eventThankYou — backward compatibility', () => {
  it('postStayThankYou is byte-for-byte unchanged when loyalty params are omitted', () => {
    const withoutLoyalty = WHATSAPP_MESSAGES.postStayThankYou({ name: 'Rahul', venue: 'Skyline Rooftop' })
    expect(withoutLoyalty).not.toContain('loyalty points')
    expect(withoutLoyalty).toBe(
      `🙏 Thank you Rahul for staying with *BookMySpaces* at Skyline Rooftop!\n\nWe hope you had a wonderful experience. It was a pleasure hosting you. 🎉\n\nCome back and see us again soon! 😊`
    )
  })

  it('postStayThankYou includes a loyalty standing line when points/tier are provided', () => {
    const withLoyalty = WHATSAPP_MESSAGES.postStayThankYou({ name: 'Rahul', venue: 'Skyline Rooftop', loyaltyPoints: 1200, loyaltyTier: 'Gold' })
    expect(withLoyalty).toContain('1,200')
    expect(withLoyalty).toContain('Gold')
  })

  it('eventThankYou is byte-for-byte unchanged when loyalty params are omitted', () => {
    const withoutLoyalty = WHATSAPP_MESSAGES.eventThankYou({ name: 'Neha', venue: 'Garden Hall', eventType: 'Wedding' })
    expect(withoutLoyalty).toBe(
      `🙏 Thank you Neha for celebrating your wedding with *BookMySpaces* at Garden Hall!\n\nWe hope it was everything you dreamed of. It was a pleasure hosting you. 🎉\n\nCome celebrate with us again soon! 😊`
    )
  })

  it('eventThankYou defaults the tier label to Bronze when points are present but tier is not', () => {
    const msg = WHATSAPP_MESSAGES.eventThankYou({ name: 'Neha', loyaltyPoints: 50, loyaltyTier: null })
    expect(msg).toContain('Bronze')
  })
})
