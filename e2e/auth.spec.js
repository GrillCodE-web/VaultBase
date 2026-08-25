// @ts-check
import { test, expect } from '@playwright/test'
import { setupApp, bootApp, unlockMaster } from './helpers.js'

test.describe('Auth (Tauri IPC mock)', () => {
  test('полный путь: лицензия активна → экран мастер-пароля → Unlock → app-shell', async ({ page }) => {
    await setupApp(page)
    // Реальная цепочка App.jsx: get_license_status → view 'auth' (Login, unlock)
    const pwInput = page.locator('.auth-input[placeholder="••••••••••••"]').first()
    await expect(pwInput).toBeVisible({ timeout: 15000 })
    await expect(page.getByRole('button', { name: 'Unlock' })).toBeVisible()

    await unlockMaster(page)
    // handleUnlocked → resumeSession/autoLogin (solo admin) → MainShell
    await expect(page.locator('.main-content-wrapper')).toBeVisible({ timeout: 20000 })
    await expect(page.locator('button.sbi', { hasText: 'Cards' })).toBeVisible()
  })

  test('Try_auto_login выключен → после Unlock появляется экран входа пользователя', async ({ page }) => {
    await setupApp(page, { autoLogin: false })
    await unlockMaster(page)
    await expect(page.locator('.auth-card')).toBeVisible()
    await expect(page.locator('input[placeholder="Имя пользователя"]')).toBeVisible()
    await expect(page.locator('input[placeholder="Пароль"]')).toBeVisible()
  })

  test('Ручной вход admin открывает приложение', async ({ page }) => {
    await setupApp(page, { autoLogin: false })
    await unlockMaster(page)
    await page.locator('input[placeholder="Имя пользователя"]').fill('admin')
    await page.locator('input[placeholder="Пароль"]').fill('admin')
    await page.getByRole('button', { name: 'Войти' }).click()
    await expect(page.locator('.main-content-wrapper')).toBeVisible({ timeout: 15000 })
  })

  test('Кнопка входа заблокирована при незаполненных полях', async ({ page }) => {
    await setupApp(page, { autoLogin: false })
    await unlockMaster(page)
    await expect(page.getByRole('button', { name: 'Войти' })).toBeDisabled()
  })
})
