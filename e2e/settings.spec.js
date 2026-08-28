// @ts-check
import { test, expect } from '@playwright/test'
import { bootApp, navTo, unlockMaster } from './helpers.js'

// TEST-005: Settings — язык и тема. Контракты, что проверяем:
//   Язык — useLang (LangProvider): localStorage 'vaultbase_lang' ('en' по умолчанию,
//          запись в стор только при переключении). Поверхности: Settings → General
//          (EN/RU) и сайдбар-кнопка 'Language: EN' (aria-label 'Language: …').
//          Подписи через t(): nav_cards 'Cards'/'Карты', nav_orders 'Orders'/'Заказы',
//          settings_bin_enrichment 'BIN Enrichment'/'BIN Обогащение'.
//   Тема — useTheme: localStorage 'theme' + data-theme на <html>; режимы
//          system/light/dark, дефолт 'dark'. Реальная покраска — tokens.css:
//          [data-theme='light'] и корневые токены светлые, [data-theme='dark'] и
//          @media (prefers-color-scheme: dark) { [data-theme='system'] } тёмные;
//          body { background: var(--bg) }. Быстрый переключатель в сайдбаре
//          (aria-label 'Appearance: …') циклит system → light → dark.

const dataTheme = page => page.evaluate(() => document.documentElement.getAttribute('data-theme'))
const stored = (page, key) => page.evaluate(k => localStorage.getItem(k), key)
const bodyBg = page => page.evaluate(() => getComputedStyle(document.body).backgroundColor)
const LIGHT_BG = 'rgb(236, 236, 236)' // tokens.css --bg светлой темы
const DARK_BG = 'rgb(12, 13, 16)' // tokens.css --bg тёмной темы

function settingsUi(page) {
  const langRow = page.locator('.setting-row').filter({ hasText: 'Language' })
  const tabs = page.getByRole('group', { name: 'Appearance' })
  return {
    langRow,
    enBtn: langRow.getByRole('button', { name: 'EN', exact: true }),
    ruBtn: langRow.getByRole('button', { name: 'RU', exact: true }),
    tabs,
    systemTab: tabs.getByRole('button', { name: 'System', exact: true }),
    lightTab: tabs.getByRole('button', { name: 'Light', exact: true }),
    darkTab: tabs.getByRole('button', { name: 'Dark', exact: true }),
  }
}

const mainShell = page => page.locator('.main-content-wrapper')
const navBtn = (page, label) => page.locator('button.sbi', { hasText: label }).first()

test.describe('TEST-005: Язык (Settings)', () => {
  test.beforeEach(async ({ page }) => {
    await bootApp(page)
    await navTo(page, 'Settings')
    await expect(settingsUi(page).tabs).toBeVisible()
  })

  test('дефолт EN: активна кнопка EN, сайдбар английский, стор не записан', async ({ page }) => {
    const ui = settingsUi(page)
    await expect(ui.langRow).toBeVisible()
    await expect(ui.enBtn).toHaveClass(/btn-b/)
    await expect(ui.ruBtn).toHaveClass(/btn-ghost/)
    await expect(navBtn(page, 'Cards')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Language: EN' })).toBeVisible()
    expect(await stored(page, 'vaultbase_lang')).toBeNull()
  })

  test('EN → RU → EN: подписи переключаются, выбор пишется в localStorage', async ({ page }) => {
    const ui = settingsUi(page)
    await ui.ruBtn.click()
    await expect(navBtn(page, 'Карты')).toBeVisible()
    await expect(navBtn(page, 'Заказы')).toBeVisible()
    await expect(page.locator('.ptitle').filter({ hasText: 'BIN Обогащение' })).toBeVisible()
    expect(await stored(page, 'vaultbase_lang')).toBe('ru')
    await expect(ui.ruBtn).toHaveClass(/btn-b/)
    await expect(ui.enBtn).toHaveClass(/btn-ghost/)

    await ui.enBtn.click()
    await expect(navBtn(page, 'Cards')).toBeVisible()
    await expect(page.locator('.ptitle').filter({ hasText: 'BIN Enrichment' })).toBeVisible()
    expect(await stored(page, 'vaultbase_lang')).toBe('en')
    await expect(ui.enBtn).toHaveClass(/btn-b/)
  })

  test('RU переживает перезагрузку страницы', async ({ page }) => {
    const ui = settingsUi(page)
    await ui.ruBtn.click()
    await expect(navBtn(page, 'Карты')).toBeVisible()
    await page.reload()
    await unlockMaster(page)
    await expect(mainShell(page)).toBeVisible({ timeout: 20000 })
    await expect(navBtn(page, 'Карты')).toBeVisible()
    expect(await stored(page, 'vaultbase_lang')).toBe('ru')
  })

  test('сайдбар-переключатель Language: EN тоже включает RU (состояние общее)', async ({ page }) => {
    const ui = settingsUi(page)
    await page.getByRole('button', { name: 'Language: EN' }).click()
    await expect(navBtn(page, 'Карты')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Language: RU' })).toBeVisible()
    await expect(ui.ruBtn).toHaveClass(/btn-b/)
    expect(await stored(page, 'vaultbase_lang')).toBe('ru')
  })
})

test.describe('TEST-005: Тема (Settings → Appearance)', () => {
  test.beforeEach(async ({ page }) => {
    await bootApp(page)
    await navTo(page, 'Settings')
    await expect(settingsUi(page).tabs).toBeVisible()
  })

  test('без сохранённой темы — тёмная по умолчанию', async ({ page }) => {
    const ui = settingsUi(page)
    expect(await dataTheme(page)).toBe('dark')
    expect(await bodyBg(page)).toBe(DARK_BG)
    expect(await stored(page, 'theme')).toBeNull()
    await expect(ui.darkTab).toHaveClass(/active/)
    await expect(ui.darkTab).toHaveAttribute('aria-pressed', 'true')
    await expect(ui.lightTab).toHaveAttribute('aria-pressed', 'false')
  })

  test('вкладка Light: data-theme, фон, active/aria-pressed, localStorage', async ({ page }) => {
    const ui = settingsUi(page)
    await ui.lightTab.click()
    expect(await dataTheme(page)).toBe('light')
    expect(await bodyBg(page)).toBe(LIGHT_BG)
    expect(await stored(page, 'theme')).toBe('light')
    await expect(ui.lightTab).toHaveClass(/active/)
    await expect(ui.lightTab).toHaveAttribute('aria-pressed', 'true')
    await expect(ui.systemTab).toHaveAttribute('aria-pressed', 'false')
    await expect(ui.darkTab).toHaveAttribute('aria-pressed', 'false')
  })

  test('вкладка Dark возвращает тёмную тему после светлой', async ({ page }) => {
    const ui = settingsUi(page)
    await ui.lightTab.click()
    expect(await dataTheme(page)).toBe('light')
    await ui.darkTab.click()
    expect(await dataTheme(page)).toBe('dark')
    expect(await bodyBg(page)).toBe(DARK_BG)
    expect(await stored(page, 'theme')).toBe('dark')
    await expect(ui.darkTab).toHaveClass(/active/)
    await expect(ui.lightTab).toHaveAttribute('aria-pressed', 'false')
  })

  test('вкладка System: следование prefers-color-scheme', async ({ page }) => {
    const ui = settingsUi(page)
    await ui.systemTab.click()
    expect(await dataTheme(page)).toBe('system')
    expect(await stored(page, 'theme')).toBe('system')
    await expect(ui.systemTab).toHaveAttribute('aria-pressed', 'true')
    await page.emulateMedia({ colorScheme: 'dark' })
    expect(await bodyBg(page)).toBe(DARK_BG)
    await page.emulateMedia({ colorScheme: 'light' })
    expect(await bodyBg(page)).toBe(LIGHT_BG)
  })

  test('выбранная тема переживает перезагрузку страницы', async ({ page }) => {
    const ui = settingsUi(page)
    await ui.lightTab.click()
    await page.reload()
    await unlockMaster(page)
    await expect(mainShell(page)).toBeVisible({ timeout: 20000 })
    expect(await dataTheme(page)).toBe('light')
    expect(await bodyBg(page)).toBe(LIGHT_BG)
    expect(await stored(page, 'theme')).toBe('light')
  })

  test('сайдбар-цикл dark → system → light → dark синхронен с Settings', async ({ page }) => {
    const ui = settingsUi(page)
    await page.getByRole('button', { name: 'Appearance: Dark', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Appearance: System', exact: true })).toBeVisible()
    expect(await dataTheme(page)).toBe('system')

    await page.getByRole('button', { name: 'Appearance: System', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Appearance: Light', exact: true })).toBeVisible()
    expect(await dataTheme(page)).toBe('light')

    await page.getByRole('button', { name: 'Appearance: Light', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Appearance: Dark', exact: true })).toBeVisible()
    expect(await dataTheme(page)).toBe('dark')
    expect(await stored(page, 'theme')).toBe('dark')
    // вкладки на открытой странице Settings показывают тот же режим
    await expect(ui.darkTab).toHaveAttribute('aria-pressed', 'true')
    await expect(ui.systemTab).toHaveAttribute('aria-pressed', 'false')
  })

  test('язык и тема независимы: RU + Light одновременно живут в localStorage', async ({ page }) => {
    const ui = settingsUi(page)
    await ui.ruBtn.click()
    await expect(navBtn(page, 'Карты')).toBeVisible()
    await ui.lightTab.click()
    await page.reload()
    await unlockMaster(page)
    await expect(mainShell(page)).toBeVisible({ timeout: 20000 })
    expect(await stored(page, 'vaultbase_lang')).toBe('ru')
    expect(await stored(page, 'theme')).toBe('light')
    await expect(navBtn(page, 'Карты')).toBeVisible()
    expect(await bodyBg(page)).toBe(LIGHT_BG)
  })
})
