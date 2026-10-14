import { setupWineEnvVars } from '../launcher'
import { getWineFlags } from '../utils/compatibility_layers'
import type { GameSettings } from 'common/types'

jest.mock('electron')
jest.mock('../logger')
jest.mock('../dialog/dialog')

describe('Proton launch mode with an additional application', () => {
  function settings(enabled: boolean): GameSettings {
    const config: Partial<GameSettings> = {
      wineVersion: { type: 'proton', bin: '/proton/proton', name: 'Proton' },
      winePrefix: '/prefix',
      enviromentOptions: [],
      disableUMU: true,
      additionalApplication: {
        enabled,
        path: '/companion.exe',
        delay: 0,
        runFirst: false
      }
    }
    return config as GameSettings
  }

  test('GOG and other store launchers tell UMU to run alongside existing prefix processes', () => {
    const env = setupWineEnvVars(settings(true))
    expect(env.PROTON_VERB).toBe('run')
    expect(env.WINEPREFIX).toBe('/prefix')
    expect(env.STEAM_COMPAT_DATA_PATH).toBe('/prefix')
  })

  test('direct Proton wrappers do not wait for the companion to exit', async () => {
    const flags = await getWineFlags(settings(true), 'gamemoderun')
    expect(flags['--wrapper']).toBe('gamemoderun "/proton/proton" run')
  })

  test('disabled companions preserve the standard Proton launch mode', async () => {
    expect(setupWineEnvVars(settings(false)).PROTON_VERB).toBeUndefined()
    const flags = await getWineFlags(settings(false), 'gamemoderun')
    expect(flags['--wrapper']).toBe(
      'gamemoderun "/proton/proton" waitforexitandrun'
    )
  })
})
