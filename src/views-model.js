/* Pure view models: filtering never changes the archive or collapses movements. */
(function (root) {
  'use strict';
  const M = typeof module !== 'undefined' && module.exports ? require('./core.js') : root.MM;
  const absent = value => value === undefined || value === null || value === '';

  function validateFilters(options = {}) {
    const errors = [], filters = {
      query:String(options.query ?? '').trim(), from:absent(options.from) ? '' : options.from, to:absent(options.to) ? '' : options.to,
      category:options.category || '', minCents:absent(options.minCents) ? null : options.minCents,
      maxCents:absent(options.maxCents) ? null : options.maxCents, status:options.status || 'all',
      categoryLabel:typeof options.categoryLabel === 'function' ? options.categoryLabel : null
    };
    for (const field of ['from', 'to']) if (filters[field] !== '' && !M.validDate(filters[field])) errors.push({field, code:'invalid-date'});
    if (M.validDate(filters.from) && M.validDate(filters.to) && filters.from > filters.to) errors.push({field:'dates', code:'reversed-date-range'});
    for (const field of ['minCents', 'maxCents']) {
      const amount = filters[field];
      // UI parses localized euros first. This boundary accepts integer cents only.
      if (amount !== null && (!Number.isSafeInteger(amount) || amount < 0)) errors.push({field, code:'invalid-amount'});
    }
    if (!errors.some(error => error.code === 'invalid-amount') && filters.minCents !== null && filters.maxCents !== null && filters.minCents > filters.maxCents) errors.push({field:'amounts', code:'reversed-amount-range'});
    if (filters.category && !M.CATEGORIES.includes(filters.category)) errors.push({field:'category', code:'invalid-category'});
    if (!['all', 'paid', 'planned'].includes(filters.status)) errors.push({field:'status', code:'invalid-status'});
    return {valid:!errors.length, errors, filters};
  }

  function filterTransactions(items, options = {}) {
    const result = validateFilters(options);
    if (!result.valid) {
      const error = new Error('invalid-filters'); error.code = 'invalid-filters'; error.errors = result.errors; throw error;
    }
    const f = result.filters, query = M.norm(f.query);
    return items.filter(t => {
      const amount = Math.abs(t.amountCents);
      return (f.status === 'all' || t.status === f.status)
        && (!f.from || t.date >= f.from) && (!f.to || t.date <= f.to)
        && (!f.category || t.category === f.category)
        && (f.minCents === null || amount >= f.minCents) && (f.maxCents === null || amount <= f.maxCents)
        && (!query || M.norm(`${t.note || ''} ${t.category || ''} ${f.categoryLabel?.(t.category) || ''}`).includes(query));
    });
  }

  const dueKey = t => M.validDate(t.dueDate) ? t.dueDate : t.date;
  const compareDates = (a,b) => a.nextDate.localeCompare(b.nextDate) || a.dueDate.localeCompare(b.dueDate);

  function planRows(state, ref = M.today()) {
    if (!M.validDate(ref)) {const error = new Error('invalid-reference-date'); error.code = 'invalid-reference-date'; throw error;}
    const records = state.recurring || [], transactions = state.transactions || [];
    const ids = new Set(records.map(r => r.id)), linked = new Map();
    for (const t of transactions) if (t.recurringId && t.type === 'expense') {
      if (!linked.has(t.recurringId)) linked.set(t.recurringId, []);
      linked.get(t.recurringId).push(t);
    }
    const opening = M.validDate(state.settings?.openingDate) ? state.settings.openingDate : ref;
    const recurring = records.map(record => {
      const payments = linked.get(record.id) || [], paid = new Set(), plans = new Map(), issues = [];
      for (const t of payments.filter(t => t.status === 'paid')) {
        const key = dueKey(t);
        if (paid.has(key) && !issues.includes('duplicate-confirmed-occurrence')) issues.push('duplicate-confirmed-occurrence');
        paid.add(key);
      }
      for (const t of payments.filter(t => t.status === 'planned')) {
        const key = dueKey(t);
        if (paid.has(key)) continue; // A stale draft never reopens an already paid occurrence.
        if (!plans.has(key)) plans.set(key, []);
        plans.get(key).push(t);
      }
      const candidates = new Map();
      // Explicit plans survive pausing a recurrence or adjusting its start date.
      // Keep the original due date for editing; display the actual planned date.
      for (const [dueDate, entries] of plans) {
        const transaction = [...entries].sort((a,b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))[0];
        if (entries.length > 1 && !issues.includes('duplicate-planned-occurrence')) issues.push('duplicate-planned-occurrence');
        candidates.set(dueDate, {dueDate, nextDate:transaction.date, amountCents:transaction.amountCents, transaction});
      }
      const missingDate = !M.validDate(record.startDate);
      if (record.active && !missingDate) {
        // Search past the latest linked occurrence, not an arbitrary 6-month
        // calendar window. This also finds annual or five-year commitments.
        const anchor = [ref, opening, record.startDate, ...payments.map(dueKey).filter(M.validDate)].sort().at(-1);
        const shiftedEnd = M.shiftMonths(anchor, record.months + 1);
        const end = Number(shiftedEnd.slice(0,4)) > 2199 ? '2200-01-01' : shiftedEnd;
        for (const dueDate of M.occurrences(record, opening, end)) {
          if (paid.has(dueDate) || candidates.has(dueDate)) continue;
          candidates.set(dueDate, {dueDate, nextDate:dueDate, amountCents:record.amountCents, transaction:null});
        }
      }
      const pending = [...candidates.values()].sort(compareDates), next = pending[0];
      const overdue = Boolean(next && next.nextDate < ref);
      return {
        record, nextDate:next?.nextDate || null, dueDate:next?.dueDate || null,
        amountCents:next?.amountCents ?? record.amountCents, transaction:next?.transaction || null,
        state:!record.active ? 'inactive' : missingDate ? 'missing-date' : !next ? 'no-next-date' : overdue ? 'overdue' : next.nextDate === ref ? 'today' : 'upcoming',
        overdue, overdueCount:pending.filter(item => item.nextDate < ref).length,
        active:Boolean(record.active), missingDate, automatic:Boolean(record.automatic), estimated:Boolean(record.estimated), issues
      };
    });
    // Unlinked one-offs, incoming payments, and orphaned legacy links must stay
    // visible. They are not recurring expenses and are never deduplicated here.
    const planned = transactions.filter(t => t.status === 'planned' && (!t.recurringId || !ids.has(t.recurringId) || t.type !== 'expense'))
      .slice().sort((a,b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
    return {recurring, planned};
  }

  const api = {validateFilters, filterTransactions, planRows};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.MMViews = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
