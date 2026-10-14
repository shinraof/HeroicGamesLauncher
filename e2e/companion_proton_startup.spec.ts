import { _electron as electron, expect, test } from '@playwright/test'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

declare const window: { api: typeof import('../src/preload/api').default }

// Model Proton's real waitforexitandrun behaviour with a helper process that
// stays alive until the game starts, retaining its output pipes as well.
// The old runner fixture exited immediately after recording `start`, hiding
// both the wineserver wait gate and waiting for the helper's pipes to close.
for (const umu of [false, true]) {
  for (const runFirst of [false, true]) {
    test(`persistent companion: ${umu ? 'UMU' : 'direct Proton'}, ${runFirst ? 'helper first' : 'game first'}`, async () => {
      const directory = mkdtempSync(join(tmpdir(), 'heroic-proton-startup-'))
      const prefix = join(directory, 'prefix')
      const main = join(directory, 'Main Game.exe')
      const companion = join(directory, 'Companion.exe')
      const log = join(directory, 'launches.jsonl')
      const helperMarker = log + '.helper'
      const startedMarker = log + '.started'
      const blockedMarker = log + '.blocked'
      for (const folder of ['drive_c', 'dosdevices']) {
        mkdirSync(join(prefix, 'pfx', folder), { recursive: true })
      }
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
      for (const file of [main, companion]) writeFileSync(file, '')
      const runner = `#!/usr/bin/env node
const fs = require('fs')
const path = require('path')
const args = process.argv.slice(2)
const isUmu = path.basename(process.argv[1]) === 'umu-run'
const verb = isUmu ? (process.env.PROTON_VERB || 'waitforexitandrun') : args.shift()
if (args[0] === 'wineboot' || args[0] === 'createprefix' || verb === '--wait') process.exit(0)
const log = process.env.COMPANION_TEST_LOG
const helper = log + '.helper'
const started = log + '.started'
const blocked = log + '.blocked'
const record = (kind) => fs.appendFileSync(log, JSON.stringify({kind, verb, args, prefix: process.env.WINEPREFIX, compat: process.env.STEAM_COMPAT_DATA_PATH, gameId: process.env.GAMEID, helperAlive: fs.existsSync(helper)}) + '\\n')
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
;(async () => {
  if (args[0] === 'start') {
    fs.writeFileSync(helper, String(process.pid))
    record('companion')
    // Keep the runner and its output pipes open while the helper is active.
    while (!fs.existsSync(started)) await sleep(25)
    record('companion observed game')
    fs.unlinkSync(helper)
  } else {
    // Model the game runner still initializing when a zero-delay helper starts.
    await sleep(600)
    if (verb === 'waitforexitandrun' && fs.existsSync(helper)) {
      fs.writeFileSync(blocked, String(process.pid))
      while (fs.existsSync(helper)) await sleep(25)
    }
    record('game')
    fs.writeFileSync(started, 'started')
    await sleep(900)
  }
})().catch(error => { console.error(error); process.exitCode = 1 })
`
      const proton = join(directory, 'proton')
      writeFileSync(proton, runner, { mode: 0o755 })
      if (umu)
        writeFileSync(join(directory, 'umu-run'), runner, { mode: 0o755 })
      const executablePath = process.env.HEROIC_TEST_EXECUTABLE
      const application = await electron.launch({
        executablePath,
        args: executablePath
          ? ['--no-sandbox']
          : [join(__dirname, '../build/main/main.js')],
        env: { ...process.env, PATH: `${directory}:${process.env.PATH}` }
      })
      try {
        const page = await application.firstWindow()
        await page.evaluate(
          async ({ main, companion, proton, prefix, log, umu, runFirst }) => {
            const appName = 'persistent-companion'
            window.api.addNewApp({
              app_name: appName,
              runner: 'sideload',
              title: 'Persistent companion',
              install: { executable: main, platform: 'Windows' },
              is_installed: true,
              art_cover: '',
              art_square: '',
              canRunOffline: true
            })
            await window.api.requestGameSettings(appName)
            const settings = {
              wineVersion: {
                type: 'proton' as const,
                name: 'Recording Proton',
                bin: proton
              },
              winePrefix: prefix,
              disableUMU: !umu,
              autoInstallDxvk: false,
              autoInstallDxvkNvapi: false,
              autoInstallVkd3d: false,
              eacRuntime: false,
              battlEyeRuntime: false,
              useGameMode: false,
              enviromentOptions: [{ key: 'COMPANION_TEST_LOG', value: log }],
              additionalApplication: {
                enabled: true,
                path: companion,
                delay: 0,
                runFirst
              }
            }
            for (const [key, value] of Object.entries(settings)) {
              window.api.setSetting({ appName, key, value })
            }
          },
          { main, companion, proton, prefix, log, umu, runFirst }
        )
        const result = page
          .evaluate(() =>
            window.api.launch({
              appName: 'persistent-companion',
              runner: 'sideload'
            })
          )
          .catch(() => null)
        await expect
          .poll(
            () =>
              existsSync(blockedMarker)
                ? 'blocked'
                : existsSync(startedMarker)
                  ? 'started'
                  : 'pending',
            { timeout: 25000 }
          )
          .not.toBe('pending')
        expect(
          existsSync(blockedMarker),
          'Proton waited for the companion to exit instead of starting the main game'
        ).toBe(false)
        expect((await result)?.status).toBe('done')
        const calls = readFileSync(log, 'utf8')
          .trim()
          .split('\n')
          .map(
            (line) =>
              JSON.parse(line) as {
                kind: string
                verb: string
                prefix: string
                compat: string
                gameId?: string
                helperAlive: boolean
              }
          )
        const game = calls.find((call) => call.kind === 'game')
        const helper = calls.find((call) => call.kind === 'companion')
        expect(game?.verb).toBe('run')
        expect(helper?.verb).toBe('runinprefix')
        expect(game?.helperAlive).toBe(true)
        expect(helper?.gameId).toBe('umu-0')
        expect(
          calls.some((call) => call.kind === 'companion observed game')
        ).toBe(true)
        expect(
          calls.every(
            (call) => call.prefix === prefix && call.compat === prefix
          )
        ).toBe(true)
      } finally {
        for (const marker of [helperMarker, blockedMarker]) {
          if (!existsSync(marker)) continue
          try {
            process.kill(Number(readFileSync(marker, 'utf8')), 'SIGTERM')
          } catch {
            /* process already exited */
          }
        }
        await application.close()
        rmSync(directory, { recursive: true, force: true })
      }
    })
  }
}
