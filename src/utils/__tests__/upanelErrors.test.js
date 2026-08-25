import { describe, it, expect } from 'vitest'
import { splitUpanelError, presentUpanelError } from '../upanelErrors'

const t = (key, params) => {
  const map = {
    upanel_invalid_token: 'Invalid token',
    upanel_http_error: `HTTP error {code}`,
    upanel_api_error: 'API error',
  }
  let s = map[key] ?? key
  if (params) for (const [k, v] of Object.entries(params)) s = s.replaceAll(`{${k}}`, String(v))
  return s
}

describe('splitUpanelError', () => {
  it('parses stable codes without detail', () => {
    expect(splitUpanelError('upanel_invalid_token')).toEqual({
      code: 'upanel_invalid_token',
      detail: '',
    })
  })

  it('parses api errors with detail after colon', () => {
    expect(splitUpanelError('upanel_api_error_400: invalid country_code')).toEqual({
      code: 'upanel_api_error_400',
      detail: 'invalid country_code',
    })
  })

  it('returns null for non-upanel errors', () => {
    expect(splitUpanelError('db_query_error: boom')).toBeNull()
    expect(splitUpanelError(new Error('permission_denied:manage_proxies'))).toBeNull()
    expect(splitUpanelError(null)).toBeNull()
  })
})

describe('presentUpanelError', () => {
  it('translates stable codes', () => {
    expect(presentUpanelError('upanel_invalid_token', t)).toBe('Invalid token')
  })

  it('renders HTTP code into the message', () => {
    expect(presentUpanelError('upanel_http_500', t)).toBe('HTTP error 500')
  })

  it('appends detail for api errors', () => {
    expect(presentUpanelError('upanel_api_error_400: bad input', t)).toBe('API error: bad input')
  })

  it('falls back to raw string for unknown errors', () => {
    expect(presentUpanelError('permission_denied:manage_proxies', t)).toBe(
      'permission_denied:manage_proxies'
    )
  })
})
