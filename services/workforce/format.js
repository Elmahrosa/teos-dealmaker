function minutesFromNow(minutes) {
  return new Date(Date.now() + minutes * 60000).toISOString();
}

function latestOf(runs) {
  return runs.reduce((a, b) => {
    if (!a) return b;
    return (b.id || 0) > (a.id || 0) ? b : a;
  }, null);
}

function shortTime(iso) {
  if (!iso) return '—';
  return String(iso).slice(11, 16) + ' UTC';
}

module.exports = { minutesFromNow, latestOf, shortTime };
