/**
 * Descriptor-based runtime secrets; no values escape through configuration errors.
 * Mirrors src/app_kit/secrets.py (ASI-004, ASI-012).
 */

import { constants, openSync, fstatSync, readSync, closeSync } from 'node:fs'

export class UnsafeSecret extends Error {
  constructor(message) {
    super(message)
    this.name = 'UnsafeSecret'
  }
}

/**
 * Read an ASCII runtime secret from a private 0400/0600 regular file.
 * @param {string | URL} path
 * @returns {string}
 */
export function readSecret(path) {
  // ASI-004/012: reject symlinks, group/world-accessible files and blocking devices.
  const flags =
    constants.O_RDONLY |
    (constants.O_NOFOLLOW ?? 0) |
    (constants.O_NONBLOCK ?? 0) |
    (constants.O_CLOEXEC ?? 0)
  let fd
  try {
    fd = openSync(path, flags)
  } catch {
    throw new UnsafeSecret('Secret unavailable')
  }
  try {
    const info = fstatSync(fd)
    const uid = typeof process.getuid === 'function' ? process.getuid() : info.uid
    if (
      !info.isFile() ||
      (info.uid !== 0 && info.uid !== uid) ||
      (info.mode & 0o077) !== 0 ||
      info.nlink !== 1
    ) {
      throw new UnsafeSecret('Unsafe secret source')
    }
    const buf = Buffer.alloc(8193)
    let total = 0
    while (total < buf.length) {
      const n = readSync(fd, buf, total, buf.length - total, null)
      if (n === 0) break
      total += n
    }
    if (total > 8192) {
      throw new UnsafeSecret('Invalid secret source')
    }
    const raw = buf.subarray(0, total)
    for (const byte of raw) {
      if (byte > 0x7f) throw new UnsafeSecret('Invalid secret source')
    }
    const value = raw.toString('ascii').trim()
    if (!value) throw new UnsafeSecret('Invalid secret source')
    for (let i = 0; i < value.length; i++) {
      const code = value.charCodeAt(i)
      if (code < 33 || code > 126) throw new UnsafeSecret('Invalid secret source')
    }
    return value
  } catch (error) {
    if (error instanceof UnsafeSecret) throw error
    throw new UnsafeSecret('Secret unavailable')
  } finally {
    closeSync(fd)
  }
}
