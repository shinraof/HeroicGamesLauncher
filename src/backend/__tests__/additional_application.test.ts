import { launchWithAdditionalApplication } from '../additional_application'
import type { AdditionalApplicationSettings } from 'common/types'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('additional application launch sequencing', () => {
  const application: AdditionalApplicationSettings = {
    enabled: true,
    path: '/games/Companion App.exe',
    delay: 2,
    runFirst: false
  }

  afterEach(() => jest.useRealTimers())

  function setup(
    overrides: Partial<AdditionalApplicationSettings> = {},
    gameStarted = Promise.resolve()
  ) {
    const game = deferred<boolean>()
    const controller = new AbortController()
    const launchGame = jest.fn(() => game.promise)
    const launchApplication = jest.fn(async () => {})
    const onError = jest.fn()
    const run = () =>
      launchWithAdditionalApplication({
        application: { ...application, ...overrides },
        launchGame,
        gameStarted,
        launchApplication,
        signal: controller.signal,
        onError
      })
    return { game, controller, launchGame, launchApplication, onError, run }
  }

  test('starts the companion first and delays the game without waiting for the companion to exit', async () => {
    jest.useFakeTimers()
    const context = setup({ runFirst: true })
    const result = context.run()
    await jest.advanceTimersByTimeAsync(0)
    expect(context.launchApplication).toHaveBeenCalledTimes(1)
    expect(context.launchGame).not.toHaveBeenCalled()
    await jest.advanceTimersByTimeAsync(1999)
    expect(context.launchGame).not.toHaveBeenCalled()
    await jest.advanceTimersByTimeAsync(1)
    expect(context.launchGame).toHaveBeenCalledTimes(1)
    context.game.resolve(true)
    await expect(result).resolves.toBe(true)
  })

  test('starts the game first and launches the companion after the configured delay', async () => {
    jest.useFakeTimers()
    const context = setup()
    const result = context.run()
    expect(context.launchGame).toHaveBeenCalledTimes(1)
    expect(context.launchApplication).not.toHaveBeenCalled()
    await jest.advanceTimersByTimeAsync(1999)
    expect(context.launchApplication).not.toHaveBeenCalled()
    await jest.advanceTimersByTimeAsync(1)
    expect(context.launchApplication).toHaveBeenCalledTimes(1)
    context.game.resolve(true)
    await expect(result).resolves.toBe(true)
  })

  test('waits for the game to finish preparation before starting the companion delay', async () => {
    jest.useFakeTimers()
    const gameStarted = deferred<void>()
    const context = setup({}, gameStarted.promise)
    const result = context.run()
    await jest.advanceTimersByTimeAsync(10000)
    expect(context.launchApplication).not.toHaveBeenCalled()
    gameStarted.resolve()
    await jest.advanceTimersByTimeAsync(1999)
    expect(context.launchApplication).not.toHaveBeenCalled()
    await jest.advanceTimersByTimeAsync(1)
    expect(context.launchApplication).toHaveBeenCalledTimes(1)
    context.game.resolve(true)
    await expect(result).resolves.toBe(true)
  })

  test('does not wait forever if the game fails before reaching playing status', async () => {
    const gameStarted = deferred<void>()
    const context = setup({}, gameStarted.promise)
    const result = context.run()
    context.game.resolve(false)
    await expect(result).resolves.toBe(false)
    expect(context.launchApplication).not.toHaveBeenCalled()
  })

  test.each([true, false])(
    'does not start a delayed companion after the game exits (%s)',
    async (success) => {
      const context = setup()
      const result = context.run()
      context.game.resolve(success)
      await expect(result).resolves.toBe(success)
      expect(context.launchApplication).not.toHaveBeenCalled()
      expect(context.onError).not.toHaveBeenCalled()
    }
  )

  test('does not start a companion after a launch exception', async () => {
    const context = setup()
    const result = context.run()
    context.game.reject(new Error('Game failed'))
    await expect(result).rejects.toThrow('Game failed')
    expect(context.launchApplication).not.toHaveBeenCalled()
  })

  test('cancels the delayed game when stopped while launching the companion first', async () => {
    const context = setup({ runFirst: true })
    const result = context.run()
    context.controller.abort()
    await expect(result).resolves.toBe(false)
    expect(context.launchGame).not.toHaveBeenCalled()
    expect(context.onError).not.toHaveBeenCalled()
  })

  test('logs companion failures and still launches the game', async () => {
    const context = setup({ runFirst: true, delay: 0 })
    context.launchApplication.mockRejectedValue(new Error('Executable missing'))
    const result = context.run()
    context.game.resolve(true)
    await expect(result).resolves.toBe(true)
    expect(context.onError).toHaveBeenCalledWith(
      new Error('Executable missing')
    )
    expect(context.launchGame).toHaveBeenCalledTimes(1)
  })

  test('launches both with zero delay', async () => {
    const context = setup({ delay: 0 })
    const started = deferred<void>()
    context.launchApplication.mockImplementation(() => {
      started.resolve()
      return Promise.resolve()
    })
    const result = context.run()
    await started.promise
    context.game.resolve(true)
    await expect(result).resolves.toBe(true)
    expect(context.launchApplication).toHaveBeenCalledTimes(1)
  })
})
