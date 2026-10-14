import type { AdditionalApplicationSettings } from 'common/types'

/** Launch both applications without waiting for the companion to exit. */
export async function launchWithAdditionalApplication({
  application,
  launchGame,
  gameStarted,
  launchApplication,
  signal,
  onError
}: {
  application: AdditionalApplicationSettings
  launchGame: () => Promise<boolean>
  gameStarted: Promise<void>
  // This must resolve when the application starts, rather than when it exits.
  launchApplication: (signal: AbortSignal) => Promise<void>
  signal: AbortSignal
  onError: (error: unknown) => void
}): Promise<boolean> {
  const controller = new AbortController()
  const launchSignal = AbortSignal.any([signal, controller.signal])
  const seconds = Number.isFinite(application.delay)
    ? Math.min(60, Math.max(0, application.delay))
    : 0
  const delay = () =>
    new Promise<void>((resolve, reject) => {
      launchSignal.throwIfAborted()
      const onAbort = () => {
        clearTimeout(timer)
        reject(new Error('Additional application launch cancelled'))
      }
      const timer = setTimeout(() => {
        launchSignal.removeEventListener('abort', onAbort)
        resolve()
      }, seconds * 1000)
      launchSignal.addEventListener('abort', onAbort, { once: true })
    })

  const startApplication = async () => {
    try {
      launchSignal.throwIfAborted()
      await launchApplication(launchSignal)
    } catch (error) {
      if (!launchSignal.aborted) onError(error)
    }
  }

  try {
    if (application.runFirst) {
      await startApplication()
      await delay()
      return await launchGame()
    }

    const game = launchGame().finally(() => controller.abort())
    const applicationLaunch = Promise.race([
      gameStarted,
      game.then(
        () => undefined,
        () => undefined
      )
    ])
      .then(delay)
      .then(startApplication)
      .catch((error) => {
        if (!launchSignal.aborted) throw error
      })

    const [result] = await Promise.all([game, applicationLaunch])
    return result
  } catch (error) {
    if (signal.aborted) return false
    throw error
  } finally {
    controller.abort()
  }
}
