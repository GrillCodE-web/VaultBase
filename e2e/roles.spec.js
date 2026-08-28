// @ts-check
// TEST-006: роли admin vs operator.
// Мок расширяется через window.__e2e (базовый tauri-mock.js не трогаем — там
// живёт WIP сессии TEST-005 @a). Init-скрипт регистрируется ПЕРЕД goto, поэтому
// он исполняется раньше скрипта мока и не может ссылаться на __e2e сразу —
// только подменить invoke-функцию и подождать появления __e2e.handlers для
// регистрации стабов. Роль вычисляется на каждый вызов (location.search), так
// что один context безопасно переиспользуется разными тестами.
// ВАЖНО: MainShell сначала делает resumeSession() по токену из localStorage,
// потом try_auto_login — оба перехватываются в обёртке invoke, иначе после
// unlock в context с чужим cc_session_token достанется дефолтная админская
// сессия базового мока.
import { test, expect } from '@playwright/test'
import { setupApp, bootApp, unlockMaster } from './helpers.js'

/** Подменяет invoke для auth-команд под роль из location.search (?e2e-role=). */
async function mockRoles(page) {
  await page.addInitScript(() => {
    const w = /** @type {any} */ (window)
    const q = () => new URLSearchParams(w.location.search)
    const permsOf = r =>
      r === 'admin' ? { cards: 7, orders: 7, profiles: 7, shops: 7 } : ['manage_orders']
    const sessionOf = (r, username) => ({
      token: 'e2e-token-' + r,
      username: username || r,
      role: r,
      expires_at: '2099-12-31 23:59:59',
      permissions: permsOf(r),
    })
    // Подмена invoke: перехватываем только auth-команды при активной роли,
    // всё остальное уходит в базовый мок как раньше.
    let patched = false
    const timer = setInterval(() => {
      if (patched || !w.__TAURI_INTERNALS__ || !w.__TAURI_INTERNALS__.invoke) return
      patched = true
      clearInterval(timer)
      const orig = w.__TAURI_INTERNALS__.invoke.bind(w.__TAURI_INTERNALS__)
      w.__TAURI_INTERNALS__.invoke = function (cmd, args) {
        const role = q().get('e2e-role')
        if (role) {
          if (cmd === 'user_login') return Promise.resolve(sessionOf(role, args && args.username))
          if (cmd === 'try_auto_login') {
            return Promise.resolve(w.__e2e.autoLogin === false ? null : sessionOf(role))
          }
          if (cmd === 'resume_session') return Promise.resolve(sessionOf(role))
          if (cmd === 'refresh_session') return Promise.resolve(sessionOf(role))
          if (cmd === 'get_current_user') return Promise.resolve(sessionOf(role))
        }
        return orig(cmd, args)
      }
    }, 5)
    // Стабы для UsersPage (admin-ветка): рендерится только при данных.
    const stubs = setInterval(() => {
      if (!w.__e2e || !w.__e2e.handlers) return
      clearInterval(stubs)
      w.__e2e.handlers.get_users_stats = function () {
        return [
          {
            user_id: 1,
            username: 'admin',
            role: 'admin',
            orders_total: 2,
            revenue: 179.98,
            success_rate: 50,
          },
        ]
      }
      w.__e2e.handlers.get_admin_overview = function () {
        return { users_total: 1, orders_today: 1, revenue_today: 59.98 }
      }
    }, 5)
  })
}

/** Boot с ролью: setupApp → проставить ?e2e-role → goto('/') (init-скрипты сработают). */
async function bootAs(page, role) {
  await mockRoles(page)
  await setupApp(page, { autoLogin: role === 'admin' })
  if (role !== 'admin') {
    // autoLogin=false → экран логина; логинимся ролью вручную
    await unlockMaster(page)
    await page.locator('input[placeholder="Имя пользователя"]').fill(role)
    await page.locator('input[placeholder="Пароль"]').fill('pass-' + role)
    await page.evaluate(r => {
      const u = new URL(window.location.href)
      u.searchParams.set('e2e-role', r)
      history.replaceState(null, '', u.toString())
    }, role)
    await page.getByRole('button', { name: 'Войти' }).click()
    await expect(page.locator('.main-content-wrapper')).toBeVisible({ timeout: 15000 })
    return
  }
  await unlockMaster(page)
  await expect(page.locator('.main-content-wrapper')).toBeVisible({ timeout: 20000 })
}

test.describe('TEST-006: роли (admin vs operator)', () => {
  test('admin: видны пункты Users и Team Statistics', async ({ page }) => {
    await bootAs(page, 'admin')
    await expect(page.locator('button.sbi', { hasText: 'Users' })).toBeVisible()
    await expect(page.locator('button.sbi', { hasText: 'Team Statistics' })).toBeVisible()
  })

  test('operator: пунктов Users и Team Statistics нет в сайдбаре', async ({ page }) => {
    await bootAs(page, 'operator')
    await expect(page.locator('button.sbi', { hasText: 'Users' })).toHaveCount(0)
    await expect(page.locator('button.sbi', { hasText: 'Team Statistics' })).toHaveCount(0)
    // Базовая навигация при этом на месте
    await expect(page.locator('button.sbi', { hasText: 'Cards' })).toBeVisible()
  })

  test('operator без manage_proxies: пункта Proxies нет', async ({ page }) => {
    await bootAs(page, 'operator')
    await expect(page.locator('button.sbi', { hasText: 'Proxies' })).toHaveCount(0)
  })

  test('admin: страница Users рендерится и зовёт admin-команды', async ({ page }) => {
    await bootAs(page, 'admin')
    await page.locator('button.sbi', { hasText: 'Users' }).click()
    await expect(page.getByText('Пользователи')).toBeVisible({ timeout: 15000 })
    await expect(page.getByText('admin').first()).toBeVisible({ timeout: 15000 })
    const called = await page.evaluate(() => {
      const cmds = /** @type {any} */ (window).__e2e.commands
      return cmds.filter(/** @param {string} c */ c =>
        ['get_users_stats', 'get_admin_overview'].includes(c)
      )
    })
    expect(called).toEqual(expect.arrayContaining(['get_users_stats', 'get_admin_overview']))
  })
})
