import { expect } from '@playwright/test'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { GameInfo } from '../src/common/types'
import { electronTest } from './helpers'

declare const window: { api: typeof import('../src/preload/api').default }

function gameInfo(executable = '/games/Main Game.exe'): GameInfo {
  return {
    app_name: 'additional-application-test',
    runner: 'sideload',
    title: 'Additional application test',
    install: { executable, platform: 'Windows' },
    art_cover: '',
    art_square: '',
    is_installed: true,
    canRunOffline: true
  }
}

electronTest(
  'additional application settings persist and can be disabled',
  async (_app, page) => {
    const info = gameInfo()
    await page.evaluate((info) => window.api.addNewApp(info), info)
    const settingsButton = page.getByTitle(
      'Settings (Additional application test)',
      { exact: true }
    )
    await settingsButton.click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('tab', { name: 'Advanced', exact: true }).click()
    const enabled = dialog.getByLabel('Enable additional application', {
      exact: true
    })
    const path = dialog.getByLabel('Application path', { exact: true })
    const delay = dialog.getByLabel('Delay between applications (seconds)', {
      exact: true
    })
    const first = dialog.getByLabel('Run the additional application first', {
      exact: true
    })
    await expect(enabled).not.toBeChecked()
    await expect(path).toBeDisabled()
    await dialog.locator('label[for="additional-application-enabled"]').click()
    await path.fill('/games/Companion App.exe')
    await path.blur()
    await delay.fill('3')
    await dialog.locator('label[for="additional-application-first"]').click()
    const expected = {
      enabled: true,
      path: '/games/Companion App.exe',
      delay: 3,
      runFirst: true
    }
    await expect
      .poll(async () =>
        page.evaluate(
          async (id) =>
            (await window.api.requestGameSettings(id)).additionalApplication,
          info.app_name
        )
      )
      .toEqual(expected)
    await dialog.getByRole('button', { name: 'close', exact: true }).click()
    await settingsButton.click()
    await expect(path).toHaveValue(expected.path)
    await expect(delay).toHaveValue('3')
    await expect(first).toBeChecked()
    await dialog.locator('label[for="additional-application-enabled"]').click()
    await expect(path).toBeDisabled()
    await expect(delay).toBeDisabled()
    await expect(first).toBeDisabled()
    await expect
      .poll(async () =>
        page.evaluate(
          async (id) =>
            (await window.api.requestGameSettings(id)).additionalApplication,
          info.app_name
        )
      )
      .toEqual({ ...expected, enabled: false })
  }
)

// Exercise the actual IPC -> game launch -> Wine command path with a recording
// Wine stand-in. This verifies arguments and prefix propagation without games,
// account credentials, or an installed Wine distribution.
for (const mode of [
  'application-first',
  'game-first',
  'proton',
  'disabled',
  'missing'
] as const) {
  electronTest(`additional application launch: ${mode}`, async (_app, page) => {
    const directory = mkdtempSync(join(tmpdir(), 'heroic-companion-'))
    try {
      const wine = join(directory, 'wine')
      const prefix = join(directory, 'shared prefix')
      const main = join(directory, 'Main Game.exe')
      const companion = join(directory, 'Companion App.exe')
      const log = join(directory, 'calls.jsonl')
      mkdirSync(join(prefix, 'drive_c'), { recursive: true })
      mkdirSync(join(prefix, 'dosdevices'))
      for (const file of ['system.reg', 'user.reg', 'userdef.reg']) {
        writeFileSync(join(prefix, file), '#arch=win64\n')
      }
      if (mode === 'proton') {
        mkdirSync(join(prefix, 'pfx', 'drive_c'), { recursive: true })
        mkdirSync(join(prefix, 'pfx', 'dosdevices'))
        for (const file of ['system.reg', 'user.reg', 'userdef.reg']) {
          writeFileSync(join(prefix, 'pfx', file), '#arch=win64\n')
        }
        for (const file of [
          'pfx.lock',
          'tracked_files',
          'version',
          'config_info'
        ]) {
          writeFileSync(join(prefix, file), '')
        }
      }
      writeFileSync(main, '')
      if (mode !== 'missing') writeFileSync(companion, '')
      writeFileSync(
        wine,
        `#!/usr/bin/env node
const fs = require('fs')
const args = process.argv.slice(2)
if (['run', 'runinprefix', 'waitforexitandrun'].includes(args[0])) args.shift()
if (args[0] === '--wait' || args[0] === 'wineboot') process.exit(0)
fs.appendFileSync(process.env.COMPANION_TEST_LOG, JSON.stringify({ args, prefix: process.env.WINEPREFIX, compat: process.env.STEAM_COMPAT_DATA_PATH, cwd: process.cwd(), time: Date.now() }) + '\\n')
if (args[0] !== 'start') setTimeout(() => {}, 1800)
`,
        { mode: 0o755 }
      )
      const info = gameInfo(main)
      await page.evaluate(
        async ({ info, wine, prefix, companion, log, mode }) => {
          window.api.addNewApp(info)
          // The config loader initializes asynchronously on first access.
          await window.api.requestGameSettings(info.app_name)
          const settings = {
            wineVersion: {
              name: 'Recording Wine',
              type: mode === 'proton' ? ('proton' as const) : ('wine' as const),
              bin: wine,
              wineserver: wine
            },
            winePrefix: prefix,
            disableUMU: true,
            autoInstallDxvk: false,
            autoInstallDxvkNvapi: false,
            autoInstallVkd3d: false,
            eacRuntime: false,
            battlEyeRuntime: false,
            useGameMode: false,
            launcherArgs: '--test-argument "two words"',
            enviromentOptions: [{ key: 'COMPANION_TEST_LOG', value: log }],
            additionalApplication: {
              enabled: mode !== 'disabled',
              path: companion,
              delay: 1,
              runFirst: mode !== 'game-first'
            }
          }
          for (const [key, value] of Object.entries(settings)) {
            window.api.setSetting({ appName: info.app_name, key, value })
          }
        },
        { info, wine, prefix, companion, log, mode }
      )
      const result = await page.evaluate(
        (appName) => window.api.launch({ appName, runner: 'sideload' }),
        info.app_name
      )
      expect(result.status).toBe('done')
      const calls = readFileSync(log, 'utf8')
        .trim()
        .split('\n')
        .map(
          (line) =>
            JSON.parse(line) as {
              args: string[]
              prefix: string
              compat?: string
              cwd: string
              time: number
            }
        )
      const gameCall = calls.find(({ args }) => args[0] === main)
      expect(gameCall?.args).toEqual([main, '--test-argument', 'two words'])
      expect(calls.every((call) => call.prefix === prefix)).toBe(true)
      if (mode === 'proton') {
        expect(calls.every((call) => call.compat === prefix)).toBe(true)
      }
      if (mode === 'disabled' || mode === 'missing') {
        expect(calls).toHaveLength(1)
      } else {
        expect(calls).toHaveLength(2)
        expect(calls.find(({ args }) => args[0] === 'start')?.args).toEqual([
          'start',
          '/unix',
          companion
        ])
        expect(calls[0].args[0]).toBe(mode === 'game-first' ? main : 'start')
        expect(calls[1].time - calls[0].time).toBeGreaterThanOrEqual(950)
      }
    } catch (error) {
      await _app.close()
      throw error
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
}
