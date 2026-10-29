/* MyMoney — explainable, local purchase simulation. Never writes a movement. */
(function (root) {
  'use strict';
  const M = typeof module !== 'undefined' && module.exports ? require('./core.js') : root.MM;
  const sum = values => values.reduce((a, b) => a + b, 0);
  const days = (a, b) => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 86400000);
  const key = t => t.recurringId ? t.recurringId + ':' + (t.dueDate || t.date) : null;
  const regularSalary = t => t.type === 'income' && t.category === 'Stipendio' && !/\b(bonus|tredicesima|quattordicesima|extra|13th|14th|thirteenth|fourteenth)\b/.test(M.norm(t.note || ''));

  function isPurchaseQuestion(text) {
    const s = M.norm(text);
    return /\b(?:posso|potrei|possiamo|potremmo)\s+(?:ancora\s+)?(?:permetter(?:e|mi|ci|melo|celo|le|lo|la|mele|cele)|comprare|comprarmi|acquistare|acquistarmi|spendere|prendere|prendermi)\b/.test(s)
      || /\b(?:me lo posso permettere|posso permettermelo|ho abbastanza|mi bastano|quanto posso spendere)\b/.test(s)
      || /\b(?:vorrei|mi piacerebbe)\s+(?:comprare|comprarmi|acquistare|acquistarmi|prendere|prendermi)\b/.test(s)
      || /\b(?:mi conviene|conviene|riesco a|riusciamo a)\s+(?:comprare|comprarmi|acquistare|acquistarmi|prendere|prendermi|spendere|permettermi|permetterci)\b/.test(s)
      || /\b(?:can|could|should)\s+(?:i|we)\s+(?:still\s+)?(?:afford|buy|purchase|spend|get)\b/.test(s)
      || /\b(?:do i have enough|how much can i spend|(?:i would|i'd|i want to)\s+(?:like to\s+)?(?:buy|purchase))\b/.test(s);
  }

  function isQuestion(text) {
    const s = M.norm(text).trim();
    return isPurchaseQuestion(s) || M.unsupportedRequest?.(s) || /[?？]/.test(s)
      || /^(?:posso|potrei|possiamo|potremmo|calcola|calcolami|dimmi|calculate|compute|tell|se)\b/.test(s)
      || /^(?:(?:ciao|ehi|senti|scusa|hey|hi|please|per favore)[,\s]+)*(?:quanto|quanta|quanti|quante|come|quando|perche|dove|chi|cosa|che cosa|e se|se invece|secondo te|dimmi se|mi dici se|what|how|when|why|where|who|and if|what if|do you think|tell me if)\b/.test(s);
  }

  function resolveFollowUp(text, previousAnswer, ref, language = 'it') {
    const pattern = /^(?:(?:e\s+)?se\s+(?:invece\s+)?(?:costasse|costassero|fosse|fossero|spendessi)|(?:what|and)\s+if\s+(?:(?:it|they|that|this)\s+)?(?:costs?|were|was))\s+/i;
    if (!pattern.test(String(text).trim()) || previousAnswer?.mode !== 'purchase' || previousAnswer.verdict === 'unknown' || !previousAnswer.item || previousAnswer.context?.asOf !== ref) return null;
    const en = String(language).startsWith('en');
    let resolved = String(text).trim().replace(pattern, `${en ? 'Can I afford' : 'Posso comprare'} ${previousAnswer.item} ${en ? 'for' : 'da'} `);
    if (previousAnswer.context.purchaseDate && previousAnswer.context.purchaseDate > ref) resolved += ` ${previousAnswer.context.purchaseDate}`;
    return resolved;
  }

  function purchaseName(text, ref, dateInfo, amountInfo) {
    let name = M.entryName(text, ref, dateInfo, amountInfo)
      .replace(/^(?:(?:ciao|senti|scusa|ehi|hey|hi|please|per favore)[,\s]+)+/i, '')
      .replace(/^(?:(?:secondo te|mi dici se|dimmi se|do you think|tell me if)\s+)?/i, '')
      .replace(/^(?:mi conviene|conviene|riesco a|riusciamo a)\s+(?:comprare|comprarmi|acquistare|acquistarmi|prendere|prendermi|spendere|permettermi|permetterci)\s*/i, '')
      .replace(/^(?:(?:(?:mi|ci)\s+)?(?:posso|potrei|possiamo|potremmo)\s+(?:ancora\s+)?(?:permettermi|permetterci|permettermelo|permettere|comprare|comprarmi|acquistare|acquistarmi|prendere|prendermi|spendere)|(?:vorrei|mi piacerebbe)\s+(?:comprare|comprarmi|acquistare|acquistarmi|prendere|prendermi)|(?:can|could|should)\s+(?:i|we)\s+(?:still\s+)?(?:afford|buy|purchase|spend|get)|(?:i would|i['’]d|i want to)\s+(?:like to\s+)?(?:buy|purchase)|do i have enough(?:\s+money)?\s+for|ho abbastanza(?:\s+soldi)?\s+per)\s*/i, '')
      .replace(/\s*(?:me (?:lo|le) posso permettere|posso permetterm(?:elo|ele)|can i afford (?:it|this|that))\s*[?.!]*$/i, '')
      .replace(/^(?:(?:un paio di|a pair of|di|per|for|on|to|buy|comprare|un|uno|una|il|lo|la|le|i|gli|questo|questa|queste|questi|a|an|the|these|those|this|that)\s+)+/i, '')
      .replace(/\b(?:che costa|che costano|costing|costs?|worth)\s*$/i, '')
      .replace(/[?!.,:;]+$/g, '').trim();
    if (/^(?:spendere|spend|permettermelo|afford|it|this|that)$/i.test(name)) name = '';
    return name && !/[A-ZÀ-Ý]/.test(name.split(/\s/)[0].slice(1)) ? name[0].toLocaleUpperCase() + name.slice(1) : name;
  }

  function interpret(text, state, ref = M.today(), language = 'it', context = {}) {
    text = resolveFollowUp(text, context.previousAnswer, ref, language) || String(text || '');
    if (!isQuestion(String(text || ''))) return null;
    const en = String(language).startsWith('en');
    const tr = (it, english) => en ? english : it;
    const money = n => new Intl.NumberFormat(en ? 'en-IE' : 'it-IT', {style:'currency', currency:'EUR', maximumFractionDigits:n % 100 ? 2 : 0}).format(n / 100);
    const date = value => new Intl.DateTimeFormat(en ? 'en-GB' : 'it-IT', {day:'numeric', month:'long'}).format(M.dateObj(value));
    const isLimit = /\b(?:quanto posso spendere|how much can i spend)\b/i.test(text);
    const result = {kind:'affordability', mode:isLimit ? 'spending-limit' : 'purchase', verdict:'unknown', amountCents:null, item:'', horizonEnd:null, daysRemaining:null,
      remainingCents:null, remainingDailyCents:null, spendingLimitCents:null, dailyLimitCents:null, title:tr('Facciamo due conti.', 'Let’s work it out.'), explanation:'', details:[], reasons:[], model:{}, canRecord:false,
      context:{asOf:ref,question:text,mode:isLimit?'spending-limit':'purchase'}, action:{type:'none',label:''},
      dataQuality:{level:'missing',label:tr('Da completare', 'Needs details'),issues:[],historyDays:0}};
    const unknown = (code, message) => {
      result.reasons.push(code); result.explanation = message; result.dataQuality.issues.push(code);result.dataQuality.level='missing';result.dataQuality.label=tr('Da completare','Needs details');
      result.action = ['missing-balance','unconfirmed-opening-balance'].includes(code) ? {type:'open-preferences',field:'opening',label:tr('Verifica il saldo iniziale','Check opening balance')} : code==='ambiguous-commitments' ? {type:'open-plan',label:tr('Verifica il piano','Review commitments')} : {type:'rephrase',label:tr('Riformula','Try again')};
      return result;
    };
    if (!isPurchaseQuestion(text)) return unknown('unsupported-question', tr('Mi occupo solo di MyMoney: spese, piano e acquisti. Per cambiare una preferenza, usa un comando esplicito come «Imposta budget a 800 euro».', 'I only handle MyMoney: expenses, your plan and purchases. To change a preference, use an explicit command such as “Set budget to 800 euros”.'));
    if (!M.validDate(ref)) return unknown('invalid-date', tr('Non riesco a verificare la data di oggi.', 'I can’t verify today’s date.'));
    if (/[$£¥]|\b(?:dollars?|dollari|sterline|pounds?|usd|gbp|jpy|chf|franchi)\b/i.test(text)) return unknown('unsupported-currency', tr('Il tuo archivio è in euro: indicami il prezzo in euro, senza conversioni indovinate.', 'Your records use euros: tell me the price in euros so I do not guess an exchange rate.'));
    const dateInfo = isLimit ? {date:ref,masked:M.norm(text),spans:[],explicit:false} : M.parseDate(text, ref), amountInfo = isLimit ? {amountCents:0,spans:[]} : M.parseAmount(dateInfo.masked);
    if (!isLimit && /\b(?:rate|rata|al mese|ogni mese|mensil[ei]|instalments?|installments?|per month|every month|monthly|finanziamento|loan)\b/i.test(text)) return unknown('repeating-purchase', tr('Per rate o abbonamenti servono costo totale, durata e scadenze. Non considero una rata come prezzo dell’intero acquisto.', 'Instalments or subscriptions need a total cost, duration and due dates. One instalment is not the full purchase price.'));
    if (!isLimit && (/\b(?:ciascuno|ciascuna|cadauno|cadauna|l['’]uno|l['’]una|a testa|a persona|each|apiece|per person|per ticket|unitario)\b/i.test(text) || /\b(?:comprare|comprarmi|acquistare|prendere|permettermi|buy|purchase|afford)\s+(?:(?:questi|queste|these|those)\s+)?(?:\d+|due|tre|quattro|cinque|sei|sette|otto|nove|dieci|two|three|four|five|six|seven|eight|nine|ten)\s+(?!euro)/i.test(text) || /\d\s*[x×*]\s*\d/.test(text))) return unknown('quantity-price', tr('Per più pezzi, dimmi il prezzo totale. Per esempio: «Posso spendere 100 euro in biglietti?»', 'For several items, tell me the total price. For example: “Can I spend 100 euros on tickets?”'));
    // Product model numbers (iPhone 17) are not prices. A price must carry a
    // currency, or be introduced by an explicit price/spending expression.
    const amountSpan = amountInfo.spans[0];
    const currencyPrice = amountSpan && /€|\beur(?:os?)?\b/.test(dateInfo.masked.slice(...amountSpan));
    const priceContext = amountSpan && /\b(?:da|per|a|for|costing|costs?|worth|spendere|spend)\s*$/.test(dateInfo.masked.slice(0, amountSpan[0]));
    if (amountInfo.amountCents && !currencyPrice && !priceContext) return unknown('missing-price', tr('Quel numero potrebbe essere il modello del prodotto. Dimmi il prezzo in euro.', 'That number could be a product model. Tell me the price in euros.'));
    if (amountSpan) {
      const unused = Array.from(dateInfo.masked).map((char, i) => amountInfo.spans.some(([a,b]) => i >= a && i < b) ? ' ' : char).join('');
      const competingNumber = [...unused.matchAll(/\b\d+(?:[.,]\d+)?\b/g)].some(m => /\b(?:o|oppure|or|e|and|vs|versus|anziche|invece|instead|da|per|a|for|costing|costs?|worth)\s*$/.test(unused.slice(0, m.index)));
      const alternative = unused.match(/\b(?:o|oppure|or|versus|vs|anziche|instead)\s+(.+)$/);
      const alternativePrice = alternative && (/[0-9]/.test(alternative[1]) || M.parseAmount(alternative[1].replace(/[?.!]+$/, '') + ' euro').amountCents);
      if (competingNumber || alternativePrice) return unknown('ambiguous-price', tr('Ho sentito più prezzi. Dimmi un solo acquisto con il suo prezzo in euro.', 'I heard more than one price. Tell me one purchase and its price in euros.'));
    }
    result.amountCents = amountInfo.amountCents;
    result.item = isLimit ? '' : purchaseName(text, ref, dateInfo, amountInfo);
    result.context.purchaseDate=dateInfo.date;result.context.item=result.item;result.context.amountCents=result.amountCents;
    if (!isLimit && (!Number.isSafeInteger(result.amountCents) || result.amountCents <= 0)) return unknown('missing-price', tr('Dimmi un solo prezzo, per esempio: «Posso comprare scarpe da 180 euro?»', 'Tell me one price, for example: “Can I afford shoes for 180 euros?”'));
    if (!dateInfo.date) return unknown('ambiguous-date', tr('Indica una sola data per l’acquisto.', 'Tell me one date for the purchase.'));
    if (!state?.settings?.initialized || !M.validDate(state.settings.openingDate) || state.settings.openingDate > ref) return unknown('missing-balance', tr('Prima imposta saldo e data iniziali nelle Preferenze: mi servono per fare un conto attendibile.', 'First set your opening balance and date in Preferences so I can calculate reliably.'));
    if (state.settings.openingBalanceCents === 0 && context.balanceConfirmed !== true) return unknown('unconfirmed-opening-balance', tr('Il saldo iniziale risulta zero, ma potrebbe non essere stato dichiarato. Confermalo nelle Preferenze, anche se è davvero zero.', 'Your opening balance is zero, but it may never have been declared. Confirm it in Preferences, even if zero is correct.'));
    const s = state.settings, transactions = state.transactions || [], recurring = state.recurring || [];
    const cycle = M.cycle(ref, s.payday), paid = transactions.filter(t => t.status === 'paid' && t.date <= ref);
    const balance = s.openingBalanceCents + sum(paid.filter(t => !t.includedInOpening).map(t => t.type === 'income' ? t.amountCents : -t.amountCents));
    const plannedSalaries = transactions.filter(t => t.status === 'planned' && regularSalary(t) && t.date > ref && t.amountCents > 0).sort((a,b) => a.date.localeCompare(b.date));
    const nextSalary = plannedSalaries[0];
    // A dated salary overrides the general payday. Bonuses never shorten the horizon.
    const hasPayday = Boolean(nextSalary || s.salaryCents > 0);
    const horizonEnd = nextSalary?.date || (hasPayday ? cycle.end : M.iso(new Date(M.dateObj(ref).getFullYear(), M.dateObj(ref).getMonth() + 1, 1, 12)));
    Object.assign(result, {horizonEnd, daysRemaining:Math.max(1, days(ref, horizonEnd))});
    if (dateInfo.explicit && dateInfo.date >= horizonEnd) return unknown('purchase-after-payday', tr('Quell’acquisto è nel prossimo periodo. Chiedimelo di nuovo quando l’entrata sarà registrata: non considero già disponibili soldi futuri.', 'That purchase is in the next period. Ask again once the income is recorded: future money is not available yet.'));
    if (dateInfo.explicit && dateInfo.date < ref) return unknown('past-purchase', tr('Questo è un conto prima di comprare. Per una spesa già fatta, dimmi nome, data e importo.', 'This is a check before buying. For an expense already paid, tell me the name, date and amount.'));

    const paidKeys = new Set(), duplicateKeys = new Set();
    for (const t of paid.filter(t => t.type === 'expense')) {const k = key(t); if (k && paidKeys.has(k)) duplicateKeys.add(k); if (k) paidKeys.add(k);}
    const planned = [], plannedKeys = new Set();
    for (const t of transactions.filter(t => t.status === 'planned' && t.type === 'expense')) {
      const k = key(t);
      if (k && paidKeys.has(k)) continue;
      if (k && plannedKeys.has(k)) {duplicateKeys.add(k); continue;}
      if (k) plannedKeys.add(k);
      planned.push(t);
    }
    const obligations = planned.filter(t => t.date < horizonEnd).map(t => ({id:t.id,date:t.date,amountCents:t.amountCents,recurring:Boolean(t.recurringId),countBudget:t.countBudget,source:'planned'}));
    for (const r of recurring.filter(r => r.active && r.startDate)) {
      for (const due of M.occurrences(r, s.openingDate, horizonEnd)) {
        const k = r.id + ':' + due;
        if (paidKeys.has(k) || plannedKeys.has(k)) continue;
        obligations.push({id:r.id,date:due,amountCents:r.amountCents,recurring:true,countBudget:true,source:'recurring'});
      }
    }
    const committedCents = sum(obligations.map(t => t.amountCents));
    const overdueCents = sum(obligations.filter(t => t.date < ref).map(t => t.amountCents));
    // Cash and a monthly budget are independent constraints: take their minimum,
    // never subtract the same commitment twice from one combined balance.
    const protectedSavingsCents = s.savingsGoalCents || 0;
    const cashRemainingCents = balance - committedCents - protectedSavingsCents - result.amountCents;
    const activeIds = new Set(recurring.filter(r => r.active && r.startDate && r.startDate < cycle.end).map(r => r.id));
    const fixedProvisionCents = Math.round(sum(recurring.filter(r => activeIds.has(r.id)).map(r => r.amountCents / r.months)));
    const paidVariableBudget = sum(paid.filter(t => t.type === 'expense' && t.countBudget && M.within(t.date, cycle) && !activeIds.has(t.recurringId)).map(t => t.amountCents));
    const plannedVariableBudget = sum(planned.filter(t => t.countBudget && M.within(t.date, cycle) && !activeIds.has(t.recurringId)).map(t => t.amountCents));
    const budgetRemainingCents = s.budgetCents > 0 ? s.budgetCents - fixedProvisionCents - paidVariableBudget - plannedVariableBudget - result.amountCents : null;
    result.remainingCents = budgetRemainingCents === null ? cashRemainingCents : Math.min(cashRemainingCents, budgetRemainingCents);
    result.remainingDailyCents = Math.floor(result.remainingCents / result.daysRemaining);

    // One calendar month of recorded variable spending, excluding fixed costs
    // already reserved above. Partial history is shown, but never earns a "yes".
    const historyFrom = [s.openingDate, M.shiftMonths(ref, -1)].sort().at(-1);
    const historyDays = Math.max(0, days(historyFrom, ref));
    const history = paid.filter(t => t.type === 'expense' && !t.recurringId && t.date >= historyFrom && t.date < ref);
    const historyCents = sum(history.map(t => t.amountCents));
    const historyBudgetCents = sum(history.filter(t => t.countBudget).map(t => t.amountCents));
    const fullHistory = historyFrom === M.shiftMonths(ref, -1) && historyCents > 0;
    const dailyCents = historyDays ? historyCents / historyDays : 0;
    const dailyBudgetCents = historyDays ? historyBudgetCents / historyDays : 0;
    // Future variable plans are already reserved: only reserve the part of the
    // historical forecast not covered by those plans. Overdue items are extra.
    const futureVariable = obligations.filter(t => !t.recurring && t.date >= ref);
    const forecastCents = Math.max(0, Math.ceil(dailyCents * result.daysRemaining) - sum(futureVariable.map(t => t.amountCents)));
    const forecastBudgetCents = Math.max(0, Math.ceil(dailyBudgetCents * result.daysRemaining) - sum(futureVariable.filter(t => t.countBudget && M.within(t.date, cycle)).map(t => t.amountCents)));
    const unknownFixedDates = recurring.some(r => r.active && !r.startDate);
    const overdueSalary = transactions.some(t => t.status === 'planned' && regularSalary(t) && t.date <= ref);
    const budgetCrossesCycle = budgetRemainingCents !== null && horizonEnd > cycle.end;
    const issues = [!fullHistory&&'limited-history',!hasPayday&&'unknown-next-income',overdueSalary&&'unconfirmed-salary',overdueCents>0&&'unconfirmed-commitments',budgetCrossesCycle&&'budget-horizon'].filter(Boolean);
    result.dataQuality={level:issues.length?'limited':'ready',label:issues.length?tr('Stima prudente','Cautious estimate'):tr('Dati sufficienti per una stima','Enough data for an estimate'),issues,historyDays,completeHistory:fullHistory};
    if(!hasPayday)result.action={type:'open-preferences',field:'salary',label:tr('Imposta la prossima entrata','Set expected income')};
    else if(overdueSalary)result.action={type:'open-history',label:tr('Verifica lo stipendio','Check salary')};
    else if(overdueCents>0)result.action={type:'open-plan',label:tr('Verifica gli impegni','Review commitments')};
    Object.assign(result.model, {asOf:ref, balanceCents:balance, cashRemainingCents, budgetRemainingCents, committedCents, overdueCents,
      protectedSavingsCents, separateSavingsUsedCents:0, fixedProvisionCents, historyFrom, historyDays, historyCents,
      dailyBaselineCents:Math.round(dailyCents), forecastCents, forecastBudgetCents, completeHistory:fullHistory,
      horizonSource:nextSalary ? 'planned-salary' : hasPayday ? 'configured-payday' : 'calendar-month',
      expectedSalaryCents:nextSalary?.amountCents ?? s.salaryCents, futureIncomeIncludedCents:0,
      obligations, budgetCrossesCycle, duplicateRecurringPayments:duplicateKeys.size});
    const period = hasPayday ? tr(`fino al ${date(horizonEnd)}`, `until ${date(horizonEnd)}`) : tr('fino a fine mese', 'until month end');
    const remainder = tr(`Dopo l’acquisto resterebbero ${money(result.remainingCents)} per ${result.daysRemaining} giorni, ${period}.`, `After buying, you would have ${money(result.remainingCents)} for ${result.daysRemaining} days, ${period}.`);
    result.details.push(tr('Calcolo locale sui movimenti registrati; nessuna spesa viene aggiunta.', 'Local calculation from recorded transactions; no expense is added.'));
    result.details.push(tr(`Saldo: ${money(balance)}. Impegni: ${money(committedCents)}. Obiettivo risparmio protetto: ${money(protectedSavingsCents)}.`, `Balance: ${money(balance)}. Commitments: ${money(committedCents)}. Savings goal protected: ${money(protectedSavingsCents)}.`));
    if (budgetRemainingCents !== null) result.details.push(tr(`Rispetto anche il budget del ciclo: ${money(budgetRemainingCents)} dopo l’acquisto.`, `The cycle budget also applies: ${money(budgetRemainingCents)} after the purchase.`));
    if (historyCents > 0) result.details.push(tr(`Stima delle spese variabili: ${money(Math.round(dailyCents))} al giorno, dai ${historyDays} giorni registrati. Non è una garanzia.`, `Variable spending estimate: ${money(Math.round(dailyCents))} a day, from ${historyDays} recorded days. This is not a guarantee.`));
    result.details.push(tr('Entrate future e risparmi separati non sono aggiunti al saldo spendibile.', 'Future income and separate savings are not added to spendable funds.'));
    if (nextSalary) result.details.push(tr(`Uso la data dello stipendio previsto (${date(horizonEnd)}), senza anticiparne l’importo.`, `I use the planned salary date (${date(horizonEnd)}), without spending that income early.`));
    if (overdueCents > 0) result.details.push(tr(`${money(overdueCents)} di impegni passati risultano ancora da confermare: li tengo da parte.`, `${money(overdueCents)} of earlier commitments are still unconfirmed, so I keep that money aside.`));
    if (!hasPayday) result.details.push(tr('Non conosco la prossima entrata: la fine del mese è solo il limite della simulazione.', 'I do not know your next income date: month end is only the simulation boundary.'));
    if (budgetCrossesCycle) result.details.push(tr('Il prossimo accredito supera il ciclo corrente: il budget del ciclo successivo non è ancora verificato.', 'The next payday is beyond this cycle: the following cycle’s budget has not been checked.'));
    if (overdueSalary) result.details.push(tr('C’è uno stipendio previsto scaduto: verifica se è arrivato e registralo.', 'A planned salary is overdue: check whether it arrived and record it.'));
    if (duplicateKeys.size || unknownFixedDates) return unknown('ambiguous-commitments', tr('Prima verifica gli impegni: alcuni hanno pagamenti duplicati o una data mancante. Non voglio dirti «sì» usando un conto incompleto.', 'Please check commitments first: some have duplicate payments or missing dates. I can’t give a reliable answer from incomplete records.'));
    if (cashRemainingCents < 0 || (budgetRemainingCents !== null && budgetRemainingCents < 0)) {
      result.verdict = 'no'; result.title = tr('Meglio di no, per ora.', 'Better not, for now.'); result.reasons.push(cashRemainingCents < 0 ? 'cash-shortfall' : 'budget-shortfall');
      result.explanation = cashRemainingCents < 0 ? tr(`Mancherebbero ${money(-cashRemainingCents)} per coprire acquisto, impegni e obiettivo risparmio.`, `You would be ${money(-cashRemainingCents)} short after the purchase, commitments and savings goal.`) : tr(`Supereresti il budget del ciclo di ${money(-budgetRemainingCents)}. ${period[0].toLocaleUpperCase() + period.slice(1)} mancano ${result.daysRemaining} giorni.`, `You would exceed the cycle budget by ${money(-budgetRemainingCents)}. There are ${result.daysRemaining} days ${period}.`);
    } else if (!fullHistory || !hasPayday || overdueSalary || budgetCrossesCycle) {
      result.verdict = 'caution'; result.title = tr('Ci stai, con una riserva.', 'It fits, with a caveat.'); result.reasons.push(!fullHistory ? 'limited-history' : !hasPayday ? 'unknown-next-income' : overdueSalary ? 'unconfirmed-salary' : 'budget-horizon');
      result.explanation = remainder + ' ' + (!fullHistory ? tr('Mi manca un mese completo di spese per stimare bene il quotidiano.', 'I need a full month of expenses to estimate everyday spending reliably.') : tr('La prossima entrata o il budget futuro richiedono conferma.', 'The next income or future budget needs confirmation.'));
    } else if (cashRemainingCents < forecastCents || (budgetRemainingCents !== null && budgetRemainingCents < forecastBudgetCents)) {
      result.verdict = 'caution'; result.title = tr('Io aspetterei.', 'I would wait.'); result.reasons.push('daily-spending-shortfall');
      result.explanation = remainder + ' ' + tr('Al tuo ritmo recente, potrebbero non bastare per le altre spese.', 'At your recent spending pace, that may not cover the other expenses.');
    } else {
      result.verdict = 'yes'; result.title = tr('Sì, dai conti ci stai.', 'Yes, the numbers work.'); result.reasons.push('within-known-limits');
      result.explanation = remainder + ' ' + tr('Impegni, risparmio e spese quotidiane stimate restano coperti, se hai registrato tutto.', 'Commitments, savings and estimated everyday spending remain covered, if your records are complete.');
    }
    if (isLimit) {
      // The daily envelope includes everyday spending. The extra margin below
      // also reserves that historical spending through the next payday.
      result.dailyLimitCents = Math.max(0, Math.floor(result.remainingCents / result.daysRemaining));
      result.spendingLimitCents = Math.max(0, Math.min(cashRemainingCents - forecastCents, budgetRemainingCents === null ? Infinity : budgetRemainingCents - forecastBudgetCents));
      const todayOnly = /\b(?:oggi|today)\b/i.test(text);
      const estimate = !fullHistory || !hasPayday || overdueSalary || budgetCrossesCycle;
      result.title = todayOnly ? tr(`${money(result.dailyLimitCents)} al giorno`, `${money(result.dailyLimitCents)} a day`) : tr(`${money(result.spendingLimitCents)} di margine extra`, `${money(result.spendingLimitCents)} extra headroom`);
      result.explanation = todayOnly ? tr(`Dividendo il margine dopo impegni e risparmio sui ${result.daysRemaining} giorni ${period}, hai ${money(result.dailyLimitCents)} al giorno per le spese variabili.`, `Spreading the funds after commitments and savings over ${result.daysRemaining} days ${period} gives you ${money(result.dailyLimitCents)} a day for variable spending.`) : tr(`Dopo impegni, risparmio e spese variabili stimate restano ${money(result.spendingLimitCents)} ${period}.`, `After commitments, savings and estimated variable spending, ${money(result.spendingLimitCents)} remains ${period}.`);
      if(estimate){result.verdict='caution';result.explanation+=' '+tr('È un limite provvisorio: i dati sono ancora incompleti.','This is a provisional limit: the records are still incomplete.');}
      if(cashRemainingCents<0 || (budgetRemainingCents!==null&&budgetRemainingCents<0)){result.verdict='no';result.explanation=tr('Gli impegni e il risparmio assorbono già il margine disponibile. Verifica il piano prima di aggiungere altre spese.','Commitments and savings already use the available funds. Review the plan before adding more expenses.');result.action={type:'open-plan',label:tr('Verifica il piano','Review the plan')};}
    }
    return result;
  }
  const api = {interpret, isQuestion, resolveFollowUp};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.MyMoneyAdvisor = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
