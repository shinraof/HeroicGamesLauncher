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
    const config = settings(true)
    config.disableUMU = false
    const env = setupWineEnvVars(config)
    expect(env.PROTON_VERB).toBe('run')
    expect(env.UMU_CONTAINER_NSENTER).toBe('1')
    expect(env.WINEPREFIX).toBe('/prefix')
    expect(env.STEAM_COMPAT_DATA_PATH).toBe('/prefix')
  })

  test('direct Proton wrappers do not wait for the companion to exit', async () => {
    expect(
      setupWineEnvVars(settings(true)).UMU_CONTAINER_NSENTER
    ).toBeUndefined()
    const flags = await getWineFlags(settings(true), 'gamemoderun')
    expect(flags['--wrapper']).toBe('gamemoderun "/proton/proton" run')
  })

  test('disabled companions preserve the standard Proton launch mode', async () => {
    expect(setupWineEnvVars(settings(false)).PROTON_VERB).toBeUndefined()
    expect(
      setupWineEnvVars(settings(false)).UMU_CONTAINER_NSENTER
    ).toBeUndefined()
    const flags = await getWineFlags(settings(false), 'gamemoderun')
    expect(flags['--wrapper']).toBe(
      'gamemoderun "/proton/proton" waitforexitandrun'
    )
  })
})
