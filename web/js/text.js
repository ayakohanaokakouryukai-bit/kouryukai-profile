export function initialOf(name) {
  const first = Array.from(String(name == null ? '' : name).trim())[0];
  return first || '?';
}
