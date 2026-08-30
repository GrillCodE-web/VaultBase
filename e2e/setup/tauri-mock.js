/**
 * Tauri v2 IPC mock for Playwright E2E.
 *
 * IMPORTANT: реальный invoke() из node_modules/@tauri-apps/api/core.js идёт через
 * window.__TAURI_INTERNALS__.invoke(cmd, args, options) — мокать нужно именно его.
 * Старая версия мока подменяла window.__TAURI__.core.invoke и не перехватывала
 * ни один вызов из src/.
 *
 * Мок stateful: команды create_/update_/delete_ реально меняют state, поэтому
 * UI-тесты видят последствия своих действий после reload-а списка.
 *
 * Тестам доступно:
 *   window.__e2e.state            — текущие данные (cards/profiles/shops/orders)
 *   window.__e2e.commands         — список вызванных команд (порядок появления)
 *   window.__e2e.handlers         — хендлеры; можно переопределить из addInitScript
 *   window.__e2e.autoLogin        — try_auto_login возвращает сессию (true) или null (false)
 */
export function getTauriMockScript() {
  return `(function () {
  'use strict'

  var seq = 1000
  function nextId() { seq += 1; return seq }
  function nowStr() { return new Date().toISOString().replace('T', ' ').slice(0, 19) }
  function clone(x) { return JSON.parse(JSON.stringify(x)) }
  function paged(list, a) {
    var p = parseInt((a && a.page) || 1, 10)
    var pp = parseInt((a && a.perPage) || 50, 10)
    if (!p || p < 1) p = 1
    if (!pp || pp < 1) pp = 50
    return { items: list.slice((p - 1) * pp, p * pp), total: list.length }
  }
  function hits(text, q) { return String(text || '').toLowerCase().indexOf(String(q).toLowerCase()) !== -1 }
  function hostOf(url) {
    try { return new URL(url).hostname } catch (e) {
      return String(url || '').replace(/^https?:\\/\\//, '').split('/')[0]
    }
  }

  // ── Seed data (поля ровно те, что читают строки списков) ──
  var state = {
    cards: [
      { id: 1, bin: '411111', last4: '1111', holder_name: 'John Doe', status: 'free',
        card_type: 'debit', card_level: 'classic', orders_count: 0, country: 'US',
        city: 'Wilmington', state: 'DE', zip: '19801', bank_name: 'Chase Bank',
        source: 'manual', acquired_at: '2026-06-01 10:00:00', created_at: '2026-06-01 10:00:00',
        expiry_date: '12/28' },
      { id: 2, bin: '555555', last4: '2222', holder_name: 'Jane Roe', status: 'in_use',
        card_type: 'credit', card_level: 'platinum', orders_count: 3, country: 'US',
        city: 'Austin', state: 'TX', zip: '73301', bank_name: 'Capital One',
        source: 'manual', acquired_at: '2026-06-01 09:00:00', created_at: '2026-06-01 09:00:00',
        expiry_date: '09/27' },
    ],
    profiles: [
      { id: 'p1', card_id: 1, holder_masked: 'John Doe', bin: '411111', last4: '1111',
        card_type: 'debit', bank_name: 'Chase Bank', country: 'US', card_status: 'in_use',
        drop_count: 1, order_count: 0, notes: 'e2e seed profile', created_at: '2026-08-20 11:00:00' },
    ],
    drops: {
      p1: [
        { id: 'd1', profile_id: 'p1', recipient_name: 'John Doe', address: '1 Main St',
          city: 'Wilmington', state: 'DE', zip: '19801', country: 'US',
          phone: '+15550001111', is_primary: true },
      ],
    },
    shops: [
      { id: 's1', name: 'Acme Store', domain: 'acme.com', url: 'https://acme.com',
        category: 'Retail', notes: '', requires_cvv_match: false, blocks_vpn: false,
        phone_must_match: false, accepts_amex: false, requires_avs: false,
        high_cancel_risk: false, total_orders: 3, success_rate: 66.7, declined: 1, revenue: 199.5 },
    ],
    orders: [
      { id: 'o1', order_number: 'ORD-1001', profile_id: 'p1', card_id: 1, shop_id: 's1',
        holder_masked: 'John Doe', last4: '1111', shop_name: 'Acme Store', status: 'pending',
        total_amount: 59.98, tracking_number: null, carrier: null, email_addr: 'john@example.com',
        proxy_label: 'proxy-1', notes: 'e2e seed order', created_at: '2026-08-24 10:00:00',
        updated_at: '2026-08-24 10:00:00' },
      { id: 'o2', order_number: 'ORD-1002', profile_id: 'p1', card_id: 1, shop_id: 's1',
        holder_masked: 'John Doe', last4: '1111', shop_name: 'Acme Store', status: 'delivered',
        total_amount: 120.0, tracking_number: '1Z999AA1OLD', carrier: 'FedEx', email_addr: null,
        proxy_label: null, notes: null, created_at: '2026-08-15 08:00:00',
        updated_at: '2026-08-22 08:00:00' },
    ],
    // app-config: get_config/set_config (контракт commands/config.rs + state.rs).
    config: {},
  }

  var session = {
    token: 'e2e-token', username: 'admin', role: 'admin',
    expires_at: '2099-12-31 23:59:59',
    permissions: { cards: 7, orders: 7, profiles: 7, shops: 7 },
  }

  function freeCardList() { return state.cards.filter(function (c) { return c.status === 'free' }) }

  // Контракт state.rs CONFIG_SECRET: ключ-секрет читается только как ключ с
  // суффиксом _set и получает "1"/"0" вместо значения.
  var CONFIG_SECRET = ['bin_api_key', 'tracking_api_key', 'stuffer_api_key']
  function secret_flag_target(key) {
    for (var i = 0; i < CONFIG_SECRET.length; i++) {
      if (key === CONFIG_SECRET[i] + '_set') return CONFIG_SECRET[i]
    }
    return null
  }

  var handlers = {
    // ── boot / auth ──
    get_app_version: function () { return '99.9.9-e2e' },
    get_license_status: function () { return 'active' },
    get_config: function (a) {
      var key = (a && a.key) || ''
      // Секрет напрямую не читается (state.rs: не в CONFIG_READABLE) — только флаг _set.
      if (CONFIG_SECRET.indexOf(key) !== -1) throw 'config_key_not_allowed: ' + key
      var secret = secret_flag_target(key)
      if (secret) return (state.config[secret] || '') !== '' ? '1' : '0'
      return Object.prototype.hasOwnProperty.call(state.config, key) ? state.config[key] : null
    },
    set_config: function (a) {
      state.config[(a && a.key) || ''] = a && a.value != null ? String(a.value) : ''
      return null
    },
    is_password_set: function () { return true },
    is_locked: function () { return false },
    unlock: function () { return true },
    setup_password: function () { return true },
    verify_master_password: function () { return true },
    try_auto_login: function () { return window.__e2e.autoLogin === false ? null : clone(session) },
    resume_session: function () { return null },
    user_login: function (a) { return clone(Object.assign({}, session, { username: (a && a.username) || 'admin' })) },
    user_logout: function () { return true },
    get_current_user: function () { return { username: 'admin', role: 'admin', permissions: session.permissions } },
    refresh_session: function () { return clone(session) },

    // ── shell / dashboard ──
    get_sidebar_badges: function () {
      return { expiring_cards: 0, no_drop_profiles: 0, pending_orders: 1,
               orders_pending: 1, cards_expiring: 0, imap_unread: 0 }
    },
    get_dashboard_stats: function () {
      return { cards_total: state.cards.length, cards_free: freeCardList().length,
               profiles_total: state.profiles.length, orders_total: state.orders.length,
               orders_pending: state.orders.filter(function (o) { return o.status === 'pending' }).length,
               shops_total: state.shops.length, revenue_total: 0 }
    },
    seed_catalog: function () { return { seeded: 0 } },

    // ── settings (маунт страницы Settings — TEST-005) ──
    stuffer_get_config: function () {
      // Контракт commands/stuffer.rs: StufferConfigView { api_key_set, base_url },
      // сам ключ не отдаётся; дефолт URL — constants::STUFFER_BASE_URL.
      return {
        api_key_set: (state.config.stuffer_api_key || '') !== '',
        base_url: state.config.stuffer_base_url || 'https://dash.stockhubdeal.com/api/stuffer/',
      }
    },
    get_catalog_stats: function () {
      // Контракт commands/catalog.rs: CatalogStats { items, shops } (сид-каталог пуст).
      return { items: 0, shops: 0 }
    },
    sync_get_group_status: function () {
      // Контракт commands/sync.rs: SyncGroupStatus (группа не создана).
      return { in_group: false, group_id: null, group_name: null, connected: false, last_sync: null }
    },
    // MGR-013: panic-пароль (sidecar v3) — в e2e-окружении не задан.
    has_panic_password: function () { return false },
    set_panic_password: function () { return null },
    remove_panic_password: function () { return null },

    // ── cards ──
    get_cards: function (a) {
      var f = (a && a.filter) || {}
      var list = state.cards.filter(function (c) {
        if (f.status && f.status !== 'all' && c.status !== f.status) return false
        if (f.country && c.country !== f.country) return false
        if (f.bank_name && c.bank_name !== f.bank_name) return false
        if (f.source && c.source !== f.source) return false
        if (f.search) {
          var q = f.search
          if (!(hits(c.holder_name, q) || hits(c.bin, q) || hits(c.last4, q) || hits(c.bank_name, q))) return false
        }
        return true
      })
      var res = paged(list, a)
      res.free_total = freeCardList().length
      return res
    },
    get_card_filter_meta: function () {
      return { countries: ['US'], banks: ['Chase Bank', 'Capital One'], sources: ['manual'] }
    },
    reveal_card: function (a) {
      var c = state.cards.filter(function (x) { return String(x.id) === String(a.id) })[0]
      if (!c) throw new Error('card not found')
      return clone(Object.assign({ pan_full: '4111111111111111', cvv: '123',
        billing_address: '1 Main St', phone: '+15550001111' }, c))
    },
    update_card_status: function (a) {
      var c = state.cards.filter(function (x) { return String(x.id) === String(a.id) })[0]
      if (!c) throw new Error('card not found')
      c.status = a.status
      return clone(c)
    },
    update_card_notes: function (a) {
      var c = state.cards.filter(function (x) { return String(x.id) === String(a.id) })[0]
      if (!c) throw new Error('card not found')
      c.notes = a.notes
      return clone(c)
    },
    delete_card: function (a) {
      state.cards = state.cards.filter(function (x) { return String(x.id) !== String(a.id) })
      return true
    },
    bulk_delete_cards: function (a) {
      var ids = (a && a.ids) || []
      state.cards = state.cards.filter(function (c) { return !ids.some(function (i) { return String(c.id) === String(i) }) })
      return true
    },
    bulk_update_card_status: function (a) {
      var ids = (a && a.ids) || []
      state.cards.forEach(function (c) {
        if (ids.some(function (i) { return String(c.id) === String(i) })) c.status = a.status
      })
      return true
    },
    bulk_enrich_cards: function (a) { return { enriched: 0, total: (a && a.ids && a.ids.length) || 0 } },

    // в"Ђв"Ђ import/export (РєРѕРЅС‚СЂР°РєС‚ вЂ" commands/cards.rs, parser.rs, database/_cards.rs) в"Ђв"Ђ
    detect_mapping_preview: function (a) {
      var raw = String((a && a.raw) || '')
      var sep = raw.indexOf('|') !== -1 ? '|' : raw.indexOf(';') !== -1 ? ';' : (raw.indexOf('\\t') !== -1 ? '\\t' : ',')
      // parser.rs: preview_rows — максимум 5 строк первого чанка
      var rows = raw.split('\\n').map(function (l) { return l.trim() }).filter(Boolean)
        .slice(0, 5).map(function (l) { return l.split(sep).map(function (c) { return c.trim() }) })
      var detected = (rows[0] || []).map(function (cell) {
        if (/^\\d{13,19}$/.test(cell)) return 'card_number'
        if (/^\\d{2}\\/\\d{2}(\\d{2})?$/.test(cell)) return 'expiry_date'
        return 'skip'
      })
      return { preview_rows: rows, detected_mapping: detected }
    },
    export_cards: function (a) {
      var ids = (a && a.ids) || []
      var csv = (a && a.format) === 'csv'
      // _cards.rs::export_cards (FIX CRIT-02): РЅРѕРјРµСЂ РјР°СЃРєРёСЂСѓРµС‚СЃСЏ ****last4, CVV РЅРµ
      // РІС‹РіСЂСѓР¶Р°РµС‚СЃСЏ РІРѕРѕР±С‰Рµ; CSV вЂ" СЃ Р·Р°РіРѕР»РѕРІРєРѕРј С‡РµСЂРµР· Р·Р°РїСЏС‚СѓСЋ, TXT вЂ" Р±РµР·, С‡РµСЂРµР· '|'.
      var out = csv
        ? 'card_number,expiry_date,holder_name,email,phone,billing_address,city,state,country,zip\\n'
        : ''
      state.cards.filter(function (c) {
        return ids.some(function (i) { return String(c.id) === String(i) })
      }).forEach(function (c) {
        var row = ['****' + c.last4, c.expiry_date || '', c.holder_name || '', '', '', '',
          c.city || '', c.state || '', c.country || '', c.zip || ''].join(csv ? ',' : '|')
        out += row + '\\n'
      })
      return out
    },

    // ── profiles ──
    get_profiles: function (a) {
      var f = (a && a.filter) || {}
      var list = state.profiles.filter(function (p) {
        // has_drop === false — кнопка «No Drop»: бэкенд фильтрует оба варианта (_profiles.rs)
        if (f.has_drop === true && !(p.drop_count > 0)) return false
        if (f.has_drop === false && p.drop_count > 0) return false
        if (f.card_status && f.card_status !== 'all' && p.card_status !== f.card_status) return false
        if (f.search) {
          var q = f.search
          if (!(hits(p.holder_masked, q) || hits(p.bin, q) || hits(p.last4, q) || hits(p.bank_name, q))) return false
        }
        return true
      })
      return paged(list, a)
    },
    get_profile_detail: function (a) {
      var p = state.profiles.filter(function (x) { return x.id === a.id })[0]
      if (!p) throw new Error('profile not found')
      var card = state.cards.filter(function (c) { return String(c.id) === String(p.card_id) })[0] || {}
      return clone({ profile: p, card: card, drops: state.drops[p.id] || [] })
    },
    create_profile: function (a) {
      var card = state.cards.filter(function (c) { return String(c.id) === String(a.cardId) })[0]
      if (!card) throw new Error('card not found')
      card.status = 'in_use'
      seq += 1
      var p = { id: 'p' + seq, card_id: card.id, holder_masked: card.holder_name,
        bin: card.bin, last4: card.last4, card_type: card.card_type,
        bank_name: card.bank_name, country: card.country, card_status: 'in_use',
        drop_count: 0, order_count: 0, notes: a.notes || null, created_at: nowStr() }
      state.profiles.push(p)
      return clone(p)
    },
    add_drop: function (a) {
      var p = state.profiles.filter(function (x) { return x.id === a.profileId })[0]
      if (!p) throw new Error('profile not found')
      seq += 1
      var drop = Object.assign({ id: 'd' + seq, profile_id: p.id }, a.drop)
      if (drop.is_primary === undefined) drop.is_primary = (p.drop_count || 0) === 0
      state.drops[p.id] = state.drops[p.id] || []
      state.drops[p.id].push(drop)
      p.drop_count = state.drops[p.id].length
      return clone(drop)
    },
    delete_profile: function (a) {
      state.profiles = state.profiles.filter(function (x) { return x.id !== a.id })
      delete state.drops[a.id]
      return true
    },
    duplicate_profile: function (a) {
      var p = state.profiles.filter(function (x) { return x.id === a.id })[0]
      if (!p) throw new Error('profile not found')
      seq += 1
      var copy = Object.assign({}, p, { id: 'p' + seq, order_count: 0, created_at: nowStr() })
      state.profiles.push(copy)
      return clone(copy)
    },
    find_duplicate_profiles: function () { return [] },
    get_profile_templates: function () { return [] },
    get_available_emails: function () { return [] },
    get_free_email_for_shop: function () { return null },
    set_profile_email: function () { return true },
    open_float_window: function () { return { ok: true } },

    // ── shops ──
    get_shops: function (a) {
      var q = a && a.search
      var list = state.shops.filter(function (s) {
        if (q) { return hits(s.name, q) || hits(s.domain, q) || hits(s.url, q) }
        return true
      })
      return paged(list, a)
    },
    get_shop: function (a) {
      var s = state.shops.filter(function (x) { return x.id === a.id })[0]
      if (!s) throw new Error('shop not found')
      return clone(Object.assign({}, s, { products: [], orders: [] }))
    },
    create_shop: function (a) {
      var input = (a && a.input) || {}
      seq += 1
      var shop = { id: 's' + seq, name: input.name || '', domain: hostOf(input.url || input.name || ''),
        url: input.url || '', category: input.category || '', notes: input.notes || '',
        requires_cvv_match: !!input.requires_cvv_match, blocks_vpn: !!input.blocks_vpn,
        phone_must_match: !!input.phone_must_match, accepts_amex: !!input.accepts_amex,
        requires_avs: !!input.requires_avs, high_cancel_risk: !!input.high_cancel_risk,
        total_orders: 0, success_rate: 0, declined: 0, revenue: 0 }
      state.shops.push(shop)
      return clone(shop)
    },
    update_shop: function (a) {
      var s = state.shops.filter(function (x) { return x.id === a.id })[0]
      if (!s) throw new Error('shop not found')
      Object.assign(s, a.input, { domain: hostOf(a.input.url || s.url) })
      return clone(s)
    },
    delete_shop: function (a) {
      state.shops = state.shops.filter(function (x) { return x.id !== a.id })
      return true
    },
    get_shop_risk_score: function () { return 25 },
    get_shop_smart_suggestions: function () { return [] },
    search_catalog_shops: function () { return [] },
    search_catalog_items: function () { return [] },

    // ── global search (контракт — database/_imap.rs global_search) ──
    global_search: function (a) {
      var q = String((a && a.query) || '')
      // cards — last4/bin (LIMIT 8); orders — order_number (LIMIT 6);
      // shops — name/domain (LIMIT 5); profiles — имя получателя дрóпа/notes (LIMIT 5)
      if (!q) return { cards: [], profiles: [], orders: [], shops: [], emails: [], proxies: [] }
      var cards = state.cards
        .filter(function (c) { return hits(c.last4, q) || hits(c.bin, q) })
        .map(function (c) {
          return { id: c.id, last4: c.last4, bin: c.bin, bank_name: c.bank_name,
                   card_type: c.card_type, status: c.status, _type: 'card' }
        })
        .slice(0, 8)
      var orders = state.orders
        .filter(function (o) { return hits(o.order_number, q) })
        .map(function (o) {
          return { id: o.id, order_number: o.order_number, status: o.status,
                   shop_name: o.shop_name, _type: 'order' }
        })
        .slice(0, 6)
      var shops = state.shops
        .filter(function (s) { return hits(s.name, q) || hits(s.domain, q) })
        .map(function (s) { return { id: s.id, name: s.name, domain: s.domain, _type: 'shop' } })
        .slice(0, 5)
      var profiles = state.profiles
        .filter(function (p) {
          var drops = state.drops[p.id] || []
          var dropHit = drops.some(function (d) { return hits(d.recipient_name, q) })
          return dropHit || hits(p.notes, q)
        })
        .map(function (p) {
          var d = (state.drops[p.id] || [])[0] || {}
          return { id: p.id, name: d.recipient_name || null, city: d.city || null,
                   country: d.country || null, notes: p.notes, _type: 'profile' }
        })
        .slice(0, 5)
      return { cards: cards, profiles: profiles, orders: orders, shops: shops, emails: [], proxies: [] }
    },

    // ── orders ──
    get_orders: function (a) {
      var f = (a && a.filter) || {}
      var list = state.orders.filter(function (o) {
        if (f.status && f.status !== 'all' && o.status !== f.status) return false
        if (f.shop_id && o.shop_id !== f.shop_id) return false
        if (f.profile_id && o.profile_id !== f.profile_id) return false
        if (f.card_id && String(o.card_id) !== String(f.card_id)) return false
        if (f.search) {
          var q = f.search
          if (!(hits(o.order_number, q) || hits(o.holder_masked, q) || hits(o.last4, q))) return false
        }
        return true
      })
      return paged(list, a)
    },
    create_order: function (a) {
      var input = (a && a.input) || {}
      var prof = state.profiles.filter(function (x) { return x.id === input.profile_id })[0]
      var shop = state.shops.filter(function (x) { return x.id === input.shop_id })[0]
      seq += 1
      var amount = (input.items || []).reduce(function (sum, it) {
        return sum + (parseInt(it.qty, 10) || 1) * (parseFloat(it.price) || 0)
      }, 0)
      var order = { id: 'o' + seq, order_number: input.order_number || 'ORD-' + (1000 + seq),
        profile_id: input.profile_id, card_id: prof ? prof.card_id : null,
        shop_id: input.shop_id, holder_masked: prof ? prof.holder_masked : null,
        last4: prof ? prof.last4 : null, shop_name: shop ? shop.name : null,
        status: 'pending', total_amount: amount || null, tracking_number: null,
        carrier: null, email_addr: null, proxy_label: null, notes: input.notes || null,
        created_at: nowStr(), updated_at: nowStr() }
      state.orders.unshift(order)
      if (prof) prof.order_count += 1
      return clone(order)
    },
    batch_create_orders: function (a) {
      // commands/orders.rs: { created, failed } вЂ" С‡РёСЃР»Р° (html Р±РµСЂС'С' ? Рё СЃРєР»Р°РґС‹РІР°РµС‚)
      var orders = (a && a.orders) || []
      var ok = 0
      var fail = 0
      orders.forEach(function (row) {
        if (!row.profile_id || !row.shop_id) { fail += 1; return }
        var prof = state.profiles.filter(function (x) { return String(x.id) === String(row.profile_id) })[0]
        seq += 1
        state.orders.unshift({
          id: 'o' + seq, order_number: 'ORD-' + (1000 + seq), profile_id: row.profile_id,
          card_id: prof ? prof.card_id : null, shop_id: row.shop_id,
          holder_masked: prof ? prof.holder_masked : null, last4: prof ? prof.last4 : null,
          shop_name: 'Acme Store', status: 'pending',
          total_amount: parseFloat(row.amount) || 0, tracking_number: null, carrier: null,
          email_addr: null, proxy_label: null, notes: row.item_name || null,
          created_at: nowStr(), updated_at: nowStr(),
        })
        ok += 1
      })
      return { created: ok, failed: fail }
    },
    update_order_status: function (a) {
      var o = state.orders.filter(function (x) { return x.id === a.id })[0]
      if (!o) throw new Error('order not found')
      o.status = a.status
      var meta = a.meta
      if (meta && meta.tracking_number) o.tracking_number = meta.tracking_number
      if (meta && meta.carrier) o.carrier = meta.carrier
      o.updated_at = nowStr()
      return clone(o)
    },
    delete_order: function (a) {
      state.orders = state.orders.filter(function (x) { return x.id !== a.id })
      return true
    },
    bulk_update_orders: function (a) {
      var ids = (a && a.ids) || []
      state.orders.forEach(function (o) {
        if (ids.some(function (i) { return o.id === i })) o.status = a.status
      })
      return true
    },
    bulk_delete_orders: function (a) {
      var ids = (a && a.ids) || []
      state.orders = state.orders.filter(function (o) { return !ids.some(function (i) { return o.id === i }) })
      return true
    },
    update_order_tracking: function (a) {
      var o = state.orders.filter(function (x) { return x.id === a.id })[0]
      if (!o) throw new Error('order not found')
      var track = a.trackingNumber !== undefined ? a.trackingNumber : a.tracking_number
      var carrier = a.carrier !== undefined ? a.carrier : a.carrier
      if (track !== undefined) o.tracking_number = track
      if (carrier) o.carrier = carrier
      return clone(o)
    },
    run_risk_check: function () { return { level: 'safe', score: 6, warnings: [], offline: false } },
    get_order_templates: function () { return [] },
    save_order_template: function () { return true },

    // ── REDESIGN-05-5B3: трекинг-перебивка (пустые дефолты) ──
    get_tracking_checkpoints: function () { return [] },
    get_rework_candidates: function () { return [] },
    get_rework_alerts: function () { return [] },
    suggest_tracking_links: function () { return [] },
    complete_rework_session: function (a) {
      var received = (a && a.receivedIds) || []
      var missing = (a && a.missingIds) || []
      state.orders.forEach(function (o) {
        if (received.some(function (i) { return o.id === i })) o.status = 'received'
        else if (missing.some(function (i) { return o.id === i })) o.status = 'shipped'
      })
      return { received: received.length, missing: missing.length }
    },

    // ── stuffer (Couriers): ключ не «настроен» — страница покажет экран настройки ──
    stuffer_get_config: function () {
      return { api_key_set: false, base_url: '', provider: 'swat',
               pay_options: ['%', 'forwarding', 'test', '50/50_admin', '50/50_stuffer', 'sale'] }
    },

    // ── FEAT-012: live-тест записи (Settings → Stuffer), мок без сети ──
    stuffer_test_write: function () {
      return {
        provider: 'swat',
        ok: true,
        steps: [
          { step: 'list_couriers', status: 'ok', detail: '1 assigned courier(s)' },
          { step: 'add_courier', status: 'skipped', detail: 'courier #42 already assigned' },
          { step: 'new_package', status: 'ok', detail: 'package #555 created' },
        ],
      }
    },

    // ── справочники (создание заказа тянет их allSettled) ──
    get_emails: function () { return { items: [], total: 0 } },
    get_proxies: function () { return { items: [], total: 0 } },

    // ── UX-012: @tauri-apps/plugin-notification — разрешение выдано,
    // уведомления пишутся в window.__e2e.notifications для ассертов ──
    'plugin:notification|is_permission_granted': function () { return true },
    'plugin:notification|request_permission': function () { return 'granted' },
    'plugin:notification|notify': function (a) {
      window.__e2e.notifications.push({ title: a && a.title, body: a && a.body })
      return null
    },
  }

  window.__e2e = {
    autoLogin: true,
    state: state,
    handlers: handlers,
    commands: [],
    notifications: [],
  }

  var cbSeq = 0
  var callbacks = {}

  function invoke(cmd, args) {
    if (window.__e2e.commands.indexOf(cmd) === -1) window.__e2e.commands.push(cmd)
    var h = window.__e2e.handlers[cmd]
    if (!h) {
      // Неизвестная команда — не роняем приложение: undefined/[] выбирается компонентами.
      if (window.console) console.warn('[tauri-mock] unhandled command: ' + cmd)
      return Promise.resolve(null)
    }
    try {
      var result = h(args || {})
      if (result && typeof result.then === 'function') return result
      return Promise.resolve(result)
    } catch (e) {
      return Promise.reject(String(e && e.message ? e.message : e))
    }
  }

  window.__TAURI_INTERNALS__ = {
    invoke: invoke,
    transformCallback: function (cb) { cbSeq += 1; callbacks[cbSeq] = cb; return cbSeq },
    unregisterCallback: function (id) { delete callbacks[id] },
    convertFileSrc: function (p) { return p },
    metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
  }
  // Легаси-путь (вдруг что-то всё ещё зовёт через window.__TAURI__.core)
  window.__TAURI__ = window.__TAURI__ || {}
  window.__TAURI__.core = window.__TAURI__.core || {}
  window.__TAURI__.core.invoke = invoke
})()
`
}
