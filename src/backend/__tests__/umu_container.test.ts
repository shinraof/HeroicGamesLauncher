import { execFile } from 'child_process'
import { createHash } from 'crypto'
import { realpath } from 'fs/promises'
import { waitForUmuContainer } from '../umu_container'

jest.mock('child_process')
jest.mock('fs/promises')

const runCommand = jest.mocked(execFile)
const resolvePath = jest.mocked(realpath)

describe('waiting for a shared UMU container', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    resolvePath.mockResolvedValue('/real/prefix')
  })
  afterEach(() => jest.restoreAllMocks())

  function replies(...responses: string[]) {
    for (const response of responses) {
      runCommand.mockImplementationOnce((...args: unknown[]) => {
        const callback = args[args.length - 1] as (
          error: Error | null,
          stdout: string,
          stderr: string
        ) => void
        callback(null, response, '')
        return {} as ReturnType<typeof execFile>
      })
    }
  }

  test('waits for the exact resolved prefix service rather than starting a second container', async () => {
    replies('   boolean false\n', '   boolean false\n', '   boolean true\n')
    const signal = new AbortController().signal
    let ready = false
    const result = waitForUmuContainer('/symlink/prefix', signal).then(() => {
      ready = true
    })
    await new Promise(setImmediate)
    expect(ready).toBe(false)
    expect(runCommand).toHaveBeenCalledTimes(1)
    await result
    expect(runCommand).toHaveBeenCalledTimes(3)
    const hash = createHash('md5').update('/real/prefix').digest('hex')
    expect(runCommand).toHaveBeenLastCalledWith(
      'dbus-send',
      expect.arrayContaining([
        '--session',
        'org.freedesktop.DBus.NameHasOwner',
        `string:com.steampowered.App${hash}`
      ]),
      expect.objectContaining({ signal, timeout: 2000 }),
      expect.any(Function)
    )
  })

  test('cancels readiness polling when the game is stopped', async () => {
    replies('   boolean false\n')
    const controller = new AbortController()
    const result = waitForUmuContainer('/prefix', controller.signal)
    const assertion = expect(result).rejects.toThrow()
    await new Promise(setImmediate)
    controller.abort()
    await assertion
    expect(runCommand).toHaveBeenCalledTimes(1)
  })

  test('reports an unavailable launcher service instead of waiting indefinitely', async () => {
    replies('   boolean false\n')
    jest.spyOn(Date, 'now').mockReturnValueOnce(0).mockReturnValue(60000)
    await expect(
      waitForUmuContainer('/prefix', new AbortController().signal)
    ).rejects.toThrow('requires UMU 1.4 or newer')
    expect(runCommand).toHaveBeenCalledTimes(1)
  })
})
