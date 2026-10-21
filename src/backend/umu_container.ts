import { execFile } from 'child_process'
import { createHash } from 'crypto'
import { realpath } from 'fs/promises'
import { setTimeout } from 'timers/promises'

/** Wait for UMU's per-prefix launcher service before starting a second runner.
 * UMU 1.4+ names the service using the MD5 of the resolved prefix path.
 * Sharing WINEPREFIX alone does not put both processes in the same container.
 */
export async function waitForUmuContainer(
  prefix: string,
  signal: AbortSignal
): Promise<void> {
  signal.throwIfAborted()
  const resolvedPrefix = await realpath(prefix)
  const busName =
    'com.steampowered.App' +
    createHash('md5').update(resolvedPrefix).digest('hex')
  const deadline = Date.now() + 60000

  do {
    const stdout = await new Promise<string>((resolve, reject) => {
      execFile(
        'dbus-send',
        [
          '--session',
          '--print-reply',
          '--reply-timeout=1000',
          '--dest=org.freedesktop.DBus',
          '/org/freedesktop/DBus',
          'org.freedesktop.DBus.NameHasOwner',
          `string:${busName}`
        ],
        { signal, timeout: 2000 },
        (error, stdout) => {
          if (error) {
            reject(
              new Error(
                `Unable to query UMU's session D-Bus: ${error.message}`,
                {
                  cause: error
                }
              )
            )
          } else {
            resolve(stdout)
          }
        }
      )
    })
    if (/^\s*boolean true\s*$/m.test(stdout)) return
    await setTimeout(250, undefined, { signal })
  } while (Date.now() < deadline)

  throw new Error(
    'Timed out waiting for the shared UMU container. Container sharing requires UMU 1.4 or newer and a working session D-Bus.'
  )
}
