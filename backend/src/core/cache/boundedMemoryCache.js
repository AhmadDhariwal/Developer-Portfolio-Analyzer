// Entry deadlines belong to the source. Reads update recency without extending TTL.
class BoundedMemoryCache extends Map {
  constructor(maxEntries) {
    super();
    if (!Number.isSafeInteger(maxEntries) || maxEntries < 1)
      throw new RangeError('Cache capacity must be a positive integer.');
    this.maxEntries = maxEntries;
  }

  get(key) {
    const entry = super.get(key);
    if (!entry) return entry;
    const expiresAt =
      entry.expiresAt === undefined ? Infinity : new Date(entry.expiresAt).getTime();
    if (Number.isNaN(expiresAt) || expiresAt <= Date.now()) {
      this.delete(key);
      return undefined;
    }
    super.delete(key);
    super.set(key, entry);
    return entry;
  }

  set(key, value) {
    super.delete(key);
    while (this.size >= this.maxEntries) super.delete(this.keys().next().value);
    return super.set(key, value);
  }
}

module.exports = BoundedMemoryCache;
