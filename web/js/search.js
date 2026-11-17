const norm = (s) => String(s == null ? '' : s).normalize('NFKC').toLowerCase();

export function filterParticipants(list, query, selectedFields) {
  const terms = norm(query).split(/\s+/).filter(Boolean);
  const sel = selectedFields || [];
  return list.filter((p) => {
    if (sel.length && !sel.some((f) => (p.fields || []).includes(f))) return false;
    if (!terms.length) return true;
    const hay = norm([p.name, p.job, p.challenge, p.strengths, p.needs, (p.fields || []).join(' ')].join(' '));
    return terms.every((t) => hay.includes(t));
  });
}
