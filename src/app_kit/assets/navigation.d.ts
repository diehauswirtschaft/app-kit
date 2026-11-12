export function portalHref(entry: unknown): string | null;
export function entryForOrigin(origin: string): string | null;
export function capturePortalEntry(url: URL, storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null): string | null;
export function initials(name: string): string;
export function installHeaderInteractions(root: HTMLElement): () => void;
