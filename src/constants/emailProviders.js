/**
 * Email provider configurations for IMAP and SMTP
 */

export const IMAP_PROVIDERS = {
  'gmail.com': { host: 'imap.gmail.com', port: 993 },
  'googlemail.com': { host: 'imap.gmail.com', port: 993 },
  'yahoo.com': { host: 'imap.mail.yahoo.com', port: 993 },
  'ymail.com': { host: 'imap.mail.yahoo.com', port: 993 },
  'yahoo.co.uk': { host: 'imap.mail.yahoo.com', port: 993 },
  'outlook.com': { host: 'outlook.office365.com', port: 993 },
  'hotmail.com': { host: 'outlook.office365.com', port: 993 },
  'live.com': { host: 'outlook.office365.com', port: 993 },
  'msn.com': { host: 'outlook.office365.com', port: 993 },
  'icloud.com': { host: 'imap.mail.me.com', port: 993 },
  'me.com': { host: 'imap.mail.me.com', port: 993 },
  'mac.com': { host: 'imap.mail.me.com', port: 993 },
  'aol.com': { host: 'imap.aol.com', port: 993 },
  'zoho.com': { host: 'imap.zoho.com', port: 993 },
  'protonmail.com': { host: '127.0.0.1', port: 1143 },
  'proton.me': { host: '127.0.0.1', port: 1143 },
  'mail.com': { host: 'imap.mail.com', port: 993 },
  'gmx.com': { host: 'imap.gmx.com', port: 993 },
  'gmx.net': { host: 'imap.gmx.net', port: 993 },
  'rambler.ru': { host: 'imap.rambler.ru', port: 993 },
  'mail.ru': { host: 'imap.mail.ru', port: 993 },
  'yandex.ru': { host: 'imap.yandex.ru', port: 993 },
  'yandex.com': { host: 'imap.yandex.com', port: 993 },
}

export const SMTP_PROVIDERS = {
  'gmail.com': { host: 'smtp.gmail.com', port: 587, use_tls: false, use_starttls: true },
  'googlemail.com': { host: 'smtp.gmail.com', port: 587, use_tls: false, use_starttls: true },
  'yahoo.com': { host: 'smtp.mail.yahoo.com', port: 587, use_tls: false, use_starttls: true },
  'ymail.com': { host: 'smtp.mail.yahoo.com', port: 587, use_tls: false, use_starttls: true },
  'yahoo.co.uk': { host: 'smtp.mail.yahoo.com', port: 587, use_tls: false, use_starttls: true },
  'outlook.com': { host: 'smtp-mail.outlook.com', port: 587, use_tls: false, use_starttls: true },
  'hotmail.com': { host: 'smtp-mail.outlook.com', port: 587, use_tls: false, use_starttls: true },
  'live.com': { host: 'smtp-mail.outlook.com', port: 587, use_tls: false, use_starttls: true },
  'msn.com': { host: 'smtp-mail.outlook.com', port: 587, use_tls: false, use_starttls: true },
  'icloud.com': { host: 'smtp.mail.me.com', port: 587, use_tls: false, use_starttls: true },
  'me.com': { host: 'smtp.mail.me.com', port: 587, use_tls: false, use_starttls: true },
  'mac.com': { host: 'smtp.mail.me.com', port: 587, use_tls: false, use_starttls: true },
  'aol.com': { host: 'smtp.aol.com', port: 587, use_tls: false, use_starttls: true },
  'zoho.com': { host: 'smtp.zoho.com', port: 587, use_tls: false, use_starttls: true },
  'protonmail.com': { host: '127.0.0.1', port: 1025, use_tls: false, use_starttls: false },
  'proton.me': { host: '127.0.0.1', port: 1025, use_tls: false, use_starttls: false },
  'mail.com': { host: 'smtp.mail.com', port: 587, use_tls: false, use_starttls: true },
  'gmx.com': { host: 'mail.gmx.com', port: 587, use_tls: false, use_starttls: true },
  'gmx.net': { host: 'mail.gmx.net', port: 587, use_tls: false, use_starttls: true },
  'mail.ru': { host: 'smtp.mail.ru', port: 465, use_tls: true, use_starttls: false },
  'rambler.ru': { host: 'smtp.rambler.ru', port: 587, use_tls: false, use_starttls: true },
  'yandex.ru': { host: 'smtp.yandex.ru', port: 465, use_tls: true, use_starttls: false },
  'yandex.com': { host: 'smtp.yandex.com', port: 465, use_tls: true, use_starttls: false },
}

/**
 * Detect IMAP configuration from email address
 * @param {string} email - Email address
 * @returns {object|null} IMAP config or null
 */
export function detectImapConfig(email) {
  const domain = email.split('@')[1]?.toLowerCase()
  return domain ? IMAP_PROVIDERS[domain] ?? null : null
}

/**
 * Detect SMTP configuration from email address
 * @param {string} email - Email address
 * @returns {object|null} SMTP config or null
 */
export function detectSmtpConfig(email) {
  const domain = email.split('@')[1]?.toLowerCase()
  return domain ? SMTP_PROVIDERS[domain] ?? null : null
}
