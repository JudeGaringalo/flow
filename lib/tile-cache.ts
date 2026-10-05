type CacheOptions = {
  maxBytes: number;
  maxEntries: number;
  ttlMs: number;
};

type CachedTile = { data: Uint8Array; expiresAt: number };
type PendingTile = {
  controller: AbortController;
  promise: Promise<Uint8Array>;
  users: number;
};

export function createTileCache(options: CacheOptions) {
  const tiles = new Map<string, CachedTile>();
  const pending = new Map<string, PendingTile>();
  let bytes = 0;

  function remove(key: string) {
    const tile = tiles.get(key);
    if (tile) bytes -= tile.data.byteLength;
    tiles.delete(key);
  }

  function remember(key: string, data: Uint8Array) {
    remove(key);
    if (data.byteLength > options.maxBytes) return;
    while (tiles.size && (bytes + data.byteLength > options.maxBytes ||
        tiles.size >= options.maxEntries)) {
      remove(tiles.keys().next().value!);
    }
    tiles.set(key, { data, expiresAt: Date.now() + options.ttlMs });
    bytes += data.byteLength;
  }

  async function get(key: string, signal: AbortSignal,
    load: (signal: AbortSignal) => Promise<Uint8Array>): Promise<Uint8Array> {
    signal.throwIfAborted();
    const cached = tiles.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      tiles.delete(key);
      tiles.set(key, cached);
      return cached.data.slice();
    }
    if (cached) remove(key);

    let entry = pending.get(key);
    if (!entry) {
      const controller = new AbortController();
      const created: PendingTile = {
        controller,
        users: 0,
        promise: Promise.resolve().then(async () => {
          controller.signal.throwIfAborted();
          const data = await load(controller.signal);
          controller.signal.throwIfAborted();
          remember(key, data);
          return data;
        }).finally(() => {
          if (pending.get(key) === created) pending.delete(key);
        }),
      };
      entry = created;
      pending.set(key, entry);
    }
    const request = entry;
    request.users++;

    return new Promise<Uint8Array>((resolve, reject) => {
      let finished = false;
      const finish = () => {
        if (finished) return false;
        finished = true;
        signal.removeEventListener('abort', abort);
        request.users--;
        return true;
      };
      const abort = () => {
        if (!finish()) return;
        if (request.users === 0 && pending.get(key) === request) {
          pending.delete(key);
          request.controller.abort();
        }
        reject(signal.reason ?? new DOMException('Tile request cancelled', 'AbortError'));
      };
      signal.addEventListener('abort', abort, { once: true });
      request.promise.then(data => {
        if (finish()) resolve(data.slice());
      }, error => {
        if (finish()) reject(error);
      });
      if (signal.aborted) abort();
    });
  }

  return { get };
}
