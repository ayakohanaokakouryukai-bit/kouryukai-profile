// Splits large strings into chunks for CacheService (each cache value is limited to ~100KB).
// 30000 Japanese characters is roughly 90KB in UTF-8, so one chunk fits in one cache entry.

var CACHE_CHUNK_CHARS = 30000;

function isHighSurrogate(code) {
  return code >= 0xd800 && code <= 0xdbff;
}

// Returns an array of substrings of at most `size` UTF-16 units.
// A surrogate pair (e.g. most emoji) is never split across two parts. The only exception
// is size === 1, where the pair is kept together in one 2-unit part.
// An empty string yields [''] so that joinFromCache(splitForCache('', n)) === ''.
function splitForCache(s, size) {
  if (!Number.isInteger(size) || size <= 0) {
    throw new Error('size must be a positive integer');
  }
  if (s.length === 0) return [''];
  var parts = [];
  var start = 0;
  while (start < s.length) {
    var end = Math.min(start + size, s.length);
    if (end < s.length && isHighSurrogate(s.charCodeAt(end - 1))) {
      end = end - 1 > start ? end - 1 : Math.min(start + 2, s.length);
    }
    parts.push(s.slice(start, end));
    start = end;
  }
  return parts;
}

function joinFromCache(parts) {
  return parts.join('');
}
