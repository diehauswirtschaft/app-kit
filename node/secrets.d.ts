export class UnsafeSecret extends Error {
  constructor(message?: string);
}

/**
 * Read an ASCII runtime secret from a private (0400/0600) regular file.
 * Rejects symlinks, hardlinks, group/world permissions and non-printable bytes.
 */
export function readSecret(path: string | URL): string;
