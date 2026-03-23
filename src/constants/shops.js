/**
 * Shop-related constants and flag definitions
 */

import { STATUS_COLORS } from './colors.js'

// Shop requirement flags with display configuration
export const SHOP_FLAGS = [
  {
    key: 'requires_cvv_match',
    label: 'CVV Match',
    bg: STATUS_COLORS.infoBg,
    color: STATUS_COLORS.info,
  },
  {
    key: 'blocks_vpn',
    label: 'Blocks VPN',
    bg: STATUS_COLORS.errorBg,
    color: STATUS_COLORS.error,
  },
  {
    key: 'phone_must_match',
    label: 'Phone Match',
    bg: STATUS_COLORS.warningBg,
    color: STATUS_COLORS.warning,
  },
  {
    key: 'accepts_amex',
    label: 'Amex OK',
    bg: STATUS_COLORS.successBg,
    color: STATUS_COLORS.success,
  },
  {
    key: 'requires_avs',
    label: 'AVS',
    bg: STATUS_COLORS.warningBg,
    color: STATUS_COLORS.warning,
  },
  {
    key: 'high_cancel_risk',
    label: 'Cancel Risk',
    bg: STATUS_COLORS.errorBg,
    color: STATUS_COLORS.error,
  },
]

/**
 * Get active flags for a shop
 * @param {object} shop - Shop object
 * @returns {Array} Array of active flag configurations
 */
export function getActiveShopFlags(shop) {
  return SHOP_FLAGS.filter(f => shop[f.key])
}
