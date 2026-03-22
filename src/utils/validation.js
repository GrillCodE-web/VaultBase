/**
 * Input validation utilities
 */

/**
 * Validate email format
 * @param {string} email - Email address
 * @returns {boolean} True if valid
 */
export function isValidEmail(email) {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  return re.test(email)
}

/**
 * Validate card number (Luhn algorithm)
 * @param {string} cardNumber - Card number
 * @returns {boolean} True if valid
 */
export function isValidCardNumber(cardNumber) {
  const cleaned = cardNumber.replace(/\D/g, '')
  if (cleaned.length < 13 || cleaned.length > 19) return false

  let sum = 0
  let isEven = false

  for (let i = cleaned.length - 1; i >= 0; i--) {
    let digit = parseInt(cleaned[i], 10)

    if (isEven) {
      digit *= 2
      if (digit > 9) digit -= 9
    }

    sum += digit
    isEven = !isEven
  }

  return sum % 10 === 0
}

/**
 * Validate expiry date (MM/YY format, not expired)
 * @param {string} expiry - Expiry date in MM/YY format
 * @returns {boolean} True if valid and not expired
 */
export function isValidExpiry(expiry) {
  if (!expiry) return false
  const match = expiry.match(/^(\d{2})\/(\d{2})$/)
  if (!match) return false

  const month = parseInt(match[1], 10)
  const year = 2000 + parseInt(match[2], 10)

  if (month < 1 || month > 12) return false

  const expiryDate = new Date(year, month, 0)
  return expiryDate > new Date()
}

/**
 * Validate CVV
 * @param {string} cvv - CVV code
 * @returns {boolean} True if valid (3-4 digits)
 */
export function isValidCVV(cvv) {
  return /^\d{3,4}$/.test(cvv)
}

/**
 * Validate ZIP code
 * @param {string} zip - ZIP/postal code
 * @returns {boolean} True if valid
 */
export function isValidZip(zip) {
  // US ZIP: 5 digits or 5+4
  // Other formats: alphanumeric, 3-10 chars
  return /^[\w\s-]{3,10}$/.test(zip)
}

/**
 * Validate URL
 * @param {string} url - URL string
 * @returns {boolean} True if valid
 */
export function isValidUrl(url) {
  try {
    new URL(url)
    return true
  } catch {
    return false
  }
}

/**
 * Validate port number
 * @param {number|string} port - Port number
 * @returns {boolean} True if valid (1-65535)
 */
export function isValidPort(port) {
  const num = parseInt(port, 10)
  return !isNaN(num) && num >= 1 && num <= 65535
}
