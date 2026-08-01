const PRIORITY_ORDER = ['critical', 'revenue', 'customer_reply', 'proposal', 'research', 'cleanup'];
const DEFAULT_PRIORITY = 'normal';

function priorityRank(priority) {
  const label = priority || DEFAULT_PRIORITY;
  const idx = PRIORITY_ORDER.indexOf(label);
  if (idx >= 0) return idx + 1;
  if (label === 'normal') return PRIORITY_ORDER.length + 1;
  return PRIORITY_ORDER.length + 2;
}

function readySteps(steps, doneKeys) {
  const done = new Set(doneKeys || []);
  return (steps || [])
    .filter(s => s.status === 'pending' && (!s.depends_on || s.depends_on.every(d => done.has(d))))
    .sort((a, b) => {
      const byPriority = priorityRank(a.priority) - priorityRank(b.priority);
      if (byPriority !== 0) return byPriority;
      return (a.id || 0) - (b.id || 0);
    });
}

function createQueue() {
  const items = [];
  return {
    push(step) {
      items.push(step);
      return items.length;
    },
    next() {
      if (!items.length) return null;
      items.sort((a, b) => {
        const byPriority = priorityRank(a.priority) - priorityRank(b.priority);
        if (byPriority !== 0) return byPriority;
        return (a.id || 0) - (b.id || 0);
      });
      return items.shift();
    },
    peek() {
      if (!items.length) return null;
      items.sort((a, b) => {
        const byPriority = priorityRank(a.priority) - priorityRank(b.priority);
        if (byPriority !== 0) return byPriority;
        return (a.id || 0) - (b.id || 0);
      });
      return items[0];
    },
    size() {
      return items.length;
    },
    clear() {
      items.length = 0;
    }
  };
}

module.exports = { PRIORITY_ORDER, DEFAULT_PRIORITY, priorityRank, readySteps, createQueue };
