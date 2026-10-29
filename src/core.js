/* MyMoney Local 2 — deterministic, offline interpretation and accounting. */
(function (root) {
  'use strict';
  const CATEGORIES = ['Casa', 'Spesa', 'Mangiare fuori', 'Trasporti', 'Auto', 'Viaggi', 'Salute', 'Sport', 'Shopping', 'Abbonamenti', 'Assicurazioni', 'Pensione', 'Utenze', 'Regali', 'Lavoro', 'Stipendio', 'Rimborsi', 'Altro'];
  const MONTHS = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
  const DAYS = ['domenica', 'lunedi', 'martedi', 'mercoledi', 'giovedi', 'venerdi', 'sabato'];
  const EN_MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
  const EN_DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const LIMIT = 9000000000;
  const norm = s => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[’‘]/g, "'");
  const pad = n => String(n).padStart(2, '0');
  const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const dateObj = s => new Date(`${s}T12:00:00`);
  const today = () => iso(new Date());
  const clone = o => JSON.parse(JSON.stringify(o));
  const money = n => new Intl.NumberFormat('it-IT', {style:'currency', currency:'EUR', useGrouping:'always'}).format(n / 100);
  const id = () => globalThis.crypto?.randomUUID?.() || `m-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  // Reject invalid calendar dates rather than rolling into the next month.
  function validDate(s) {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    const d = dateObj(s);
    return Number.isFinite(+d) && iso(d) === s && +s.slice(0, 4) >= 2000 && +s.slice(0, 4) <= 2199;
  }
  function makeDate(y, m, d) {
    const result = `${y}-${pad(m)}-${pad(d)}`;
    return validDate(result) ? result : null;
  }
  function shiftDays(s, n) { const d = dateObj(s); d.setDate(d.getDate() + n); return iso(d); }
  function shiftMonths(s, n) {
    const d = dateObj(s), day = d.getDate();
    d.setDate(1); d.setMonth(d.getMonth() + n);
    d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
    return iso(d);
  }

  // Store money as integer cents and accept Italian or decimal-dot input.
  function cents(value) {
    let s = String(value).trim().replace(/\s/g, '').replace(/€/g, '');
    if (/^-/.test(s)) throw Error('Usa un importo positivo e scegli Entrata o Uscita.');
    if (/^\d{1,3}(,\d{3})+\.\d{1,2}$/.test(s)) s = s.replace(/,/g, '');
    else if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
    else if (/^\d+(?:[.,]\d{1,2})?$/.test(s)) s = s.replace(',', '.');
    else throw Error('Importo non valido. Esempio: 50,00 oppure 1.250,50.');
    const [a, b = ''] = s.split('.');
    const n = Number(a) * 100 + Number(b.padEnd(2, '0'));
    if (!Number.isSafeInteger(n) || n > LIMIT) throw Error('Importo troppo grande.');
    return n;
  }
  function numberWord(n) {
    const small = ['zero','uno','due','tre','quattro','cinque','sei','sette','otto','nove','dieci','undici','dodici','tredici','quattordici','quindici','sedici','diciassette','diciotto','diciannove'];
    if (n < 20) return small[n];
    if (n < 100) {
      const tens = ['','','venti','trenta','quaranta','cinquanta','sessanta','settanta','ottanta','novanta'];
      let t = tens[Math.floor(n / 10)], u = n % 10;
      if (u === 1 || u === 8) t = t.slice(0, -1);
      return t + (u ? small[u] : '');
    }
    if (n < 1000) {
      let h = (n < 200 ? '' : small[Math.floor(n / 100)]) + 'cento', rem = n % 100;
      if (rem === 8 || (rem >= 80 && rem < 90)) h = h.slice(0, -1);
      return h + (rem ? numberWord(rem) : '');
    }
    return (n < 2000 ? 'mille' : numberWord(Math.floor(n / 1000)) + 'mila') + (n % 1000 ? numberWord(n % 1000) : '');
  }
  const WORDS = new Map();
  for (let n = 0; n <= 9999; n++) WORDS.set(numberWord(n), n);
  WORDS.set('un', 1); WORDS.set('una', 1);
  const EN_SMALL = 'zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen'.split(' ');
  const EN_TENS = 'zero ten twenty thirty forty fifty sixty seventy eighty ninety'.split(' ');
  function englishNumber(value) {
    const s = norm(value).replace(/-/g, ' ').trim().replace(/\s+/g, ' ');
    const small = EN_SMALL.indexOf(s); if (small >= 0) return small;
    const tens = s.match(/^(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)(?: (one|two|three|four|five|six|seven|eight|nine))?$/);
    if (tens) return EN_TENS.indexOf(tens[1]) * 10 + (tens[2] ? EN_SMALL.indexOf(tens[2]) : 0);
    const scale = s.match(/^(one|two|three|four|five|six|seven|eight|nine) (thousand|hundred)(?: (?:and )?(.+))?$/);
    if (!scale) return undefined;
    const unit = scale[2] === 'thousand' ? 1000 : 100, rest = scale[3] ? englishNumber(scale[3]) : 0;
    return Number.isFinite(rest) && rest < unit ? EN_SMALL.indexOf(scale[1]) * unit + rest : undefined;
  }
  const wordNumber = s => /^\d+$/.test(s) ? Number(s) : WORDS.get(norm(s).replace(/\s+/g, '')) ?? englishNumber(s);
  const has = (s, phrase) => ` ${norm(s).replace(/[^a-z0-9]+/g, ' ').trim()} `.includes(` ${norm(phrase).replace(/[^a-z0-9]+/g, ' ').trim()} `);

  // Recognize local payment dates before searching for an amount.
  function parseDate(text, ref = today()) {
    if (!validDate(ref)) throw Error('Data di riferimento non valida.');
    const s = norm(text), hits = [], spans = [], base = dateObj(ref);
    const past = /\b(pagato|speso|comprato|acquistato|ricevuto|ieri|scorso|scorsa|paid|spent|bought|purchased|received|yesterday|last|ago)\b/.test(s);
    const add = (match, value, reason) => {
      const start = match.index, end = start + match[0].length;
      if (spans.some(p => start < p[1] && end > p[0])) return;
      spans.push([start, end]); hits.push({date:value, reason, text:match[0]});
    };
    const each = (re, fn) => { for (const m of s.matchAll(re)) fn(m); };
    each(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/g, m => add(m, makeDate(+m[1], +m[2], +m[3]), 'Data esplicita'));
    each(/\b(\d{1,2})[\/-](\d{1,2})(?:[\/-](\d{2}|20\d{2}))?\b/g, m => {
      if(/\brat[ae]\s*$/.test(s.slice(0,m.index)))return;
      let y = m[3] ? (+m[3] < 100 ? 2000 + +m[3] : +m[3]) : base.getFullYear();
      let d = makeDate(y, +m[2], +m[1]);
      if (!m[3] && d && !past && d < ref) d = makeDate(y + 1, +m[2], +m[1]);
      if (!m[3] && d && past && d > ref) d = makeDate(y - 1, +m[2], +m[1]);
      add(m, d, m[3] ? 'Data esplicita' : 'Anno dedotto: controllalo');
    });
    each(new RegExp(`\\b(\\d{1,2})\\s+(?:di\\s+)?(${MONTHS.join('|')})(?:\\s+(20\\d{2}))?\\b`, 'g'), m => {
      let y = m[3] ? +m[3] : base.getFullYear(), month = MONTHS.indexOf(m[2]) + 1;
      let d = makeDate(y, month, +m[1]);
      if (!m[3] && d && !past && d < ref) d = makeDate(y + 1, month, +m[1]);
      if (!m[3] && d && past && d > ref) d = makeDate(y - 1, month, +m[1]);
      add(m, d, m[3] ? 'Data esplicita' : 'Anno dedotto: controllalo');
    });
    const englishDate = (m, day, month, year) => {
      let y = year ? +year : base.getFullYear(), d = makeDate(y, EN_MONTHS.indexOf(month) + 1, +day);
      if (!year && d && ((!past && d < ref) || (past && d > ref))) d = makeDate(y + (past ? -1 : 1), EN_MONTHS.indexOf(month) + 1, +day);
      add(m, d, year ? 'Data esplicita' : 'Anno dedotto: controllalo');
    };
    each(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${EN_MONTHS.join('|')})(?:,?\\s+(20\\d{2}))?\\b`, 'g'), m => englishDate(m, m[1], m[2], m[3]));
    each(new RegExp(`\\b(${EN_MONTHS.join('|')})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(20\\d{2}))?\\b`, 'g'), m => englishDate(m, m[2], m[1], m[3]));
    each(/\b(dopodomani|domani|avantieri|l'altro ieri|ieri|oggi|stasera|stamattina)(?:\s+(?:mattina|pomeriggio|sera|notte))?\b/g, m => {
      const offset = {dopodomani:2, domani:1, avantieri:-2, "l'altro ieri":-2, ieri:-1, oggi:0, stasera:0, stamattina:0};
      add(m, shiftDays(ref, offset[m[1]]), `${m[1]} rispetto al ${ref}`);
    });
    each(/\b(the day after tomorrow|the day before yesterday|tomorrow|yesterday|today|tonight|this morning|this evening)(?:\s+(?:morning|afternoon|evening|night))?\b/g, m => {
      const offset = {'the day after tomorrow':2, 'the day before yesterday':-2, tomorrow:1, yesterday:-1, today:0, tonight:0, 'this morning':0, 'this evening':0};
      add(m, shiftDays(ref, offset[m[1]]), `${m[1]} rispetto al ${ref}`);
    });
    each(/\b(?:tra|fra)\s+(\d+|[a-z]+)\s+(giorn[oi]|settiman[ae]|mesi|mese)\b/g, m => {
      const n = wordNumber(m[1]);
      add(m, Number.isFinite(n) ? (m[2].startsWith('mes') ? shiftMonths(ref, n) : shiftDays(ref, n * (m[2].startsWith('settiman') ? 7 : 1))) : null, 'Intervallo dalla data di oggi');
    });
    each(/\b(\d+|[a-z]+)\s+(giorn[oi]|settiman[ae]|mesi|mese)\s+fa\b/g, m => {
      const n = wordNumber(m[1]);
      add(m, Number.isFinite(n) ? (m[2].startsWith('mes') ? shiftMonths(ref, -n) : shiftDays(ref, -n * (m[2].startsWith('settiman') ? 7 : 1))) : null, 'Intervallo nel passato');
    });
    each(new RegExp(`\\b(${DAYS.join('|')})(?:\\s+(prossim[oa]|scors[oa]|passat[oa]))?\\b`, 'g'), m => {
      let diff = (DAYS.indexOf(m[1]) - base.getDay() + 7) % 7;
      if (m[2]?.startsWith('scors') || m[2]?.startsWith('passat')) diff = diff === 0 ? -7 : diff - 7;
      else if (m[2] && diff === 0) diff = 7;
      add(m, shiftDays(ref, diff), m[2] ? 'Giorno della settimana' : 'Prossima occorrenza del giorno indicato');
    });
    each(/\b(?:in\s+(\d+|[a-z]+)\s+(days?|weeks?|months?)|(\d+|[a-z]+)\s+(days?|weeks?|months?)\s+ago)\b/g, m => {
      const n = wordNumber(m[1] || m[3]), unit = m[2] || m[4], direction = m[3] ? -1 : 1;
      add(m, Number.isFinite(n) ? (unit.startsWith('month') ? shiftMonths(ref, direction * n) : shiftDays(ref, direction * n * (unit.startsWith('week') ? 7 : 1))) : null, 'Intervallo dalla data di oggi');
    });
    each(new RegExp(`\\b(?:(next|last)\\s+)?(${EN_DAYS.join('|')})\\b`, 'g'), m => {
      let diff = (EN_DAYS.indexOf(m[2]) - base.getDay() + 7) % 7;
      if (m[1] === 'last') diff = diff === 0 ? -7 : diff - 7;
      else if (m[1] === 'next' && diff === 0) diff = 7;
      add(m, shiftDays(ref, diff), 'Giorno della settimana');
    });
    each(/\b(fine mese|fine del mese|inizio del prossimo mese|inizio mese prossimo)\b/g, m => {
      add(m, m[1].startsWith('fine') ? iso(new Date(base.getFullYear(), base.getMonth() + 1, 0, 12)) : iso(new Date(base.getFullYear(), base.getMonth() + 1, 1, 12)), 'Confine del mese');
    });
    each(/\b(?:il|giorno)\s+(\d{1,2})(?:\s+del\s+(mese prossimo|prossimo mese))?\b/g, m => {
      let d = makeDate(base.getFullYear(), base.getMonth() + 1, +m[1]);
      if (m[2] || (d && !past && d < ref)) {
        const next = dateObj(shiftMonths(ref, 1)); d = makeDate(next.getFullYear(), next.getMonth() + 1, +m[1]);
      }
      add(m, d, 'Mese dedotto: controllalo');
    });
    let masked = s.split(''); for (const [a,b] of spans) for (let i=a; i<b; i++) masked[i] = ' ';
    const dates = [...new Set(hits.map(h => h.date))];
    if (hits.some(h => !h.date)) return {date:null, masked:masked.join(''), spans, explicit:true, warning:'La data non è valida o non è precisa. Sceglila tu.', reason:''};
    if (dates.length > 1) return {date:null, masked:masked.join(''), spans, explicit:true, warning:'Hai indicato più date. Scegli la data del pagamento, non quella del viaggio o della consegna.', reason:''};
    if (dates.length === 1) return {date:dates[0], masked:masked.join(''), spans, explicit:true, warning:'', reason:hits.map(h=>h.reason).join(' · ')};
    if (/\b(prossim[oa]|scors[oa]|settimana|mese|natale|pasqua|tra qualche|fra qualche|next week|last week|next month|last month|christmas|easter)\b/.test(s)) return {date:null, masked:s, spans, explicit:true, warning:'La data è poco precisa. Indica un giorno o selezionalo.', reason:''};
    return {date:ref, masked:s, spans, explicit:false, warning:'', reason:'Oggi: nessuna data indicata'};
  }

  // Currency markers take priority; dates and installment numbers are excluded.
  function parseAmount(text) {
    const s = norm(text), numeric = '(?:\\d{1,3}(?:,\\d{3})+\\.\\d{1,2}|\\d{1,3}(?:[. ]\\d{3})+(?:,\\d{1,2})?|\\d+(?:[.,]\\d{1,2})?)';
    let found = [], spans = [];
    const unresolved = warning => ({amountCents:null, warning, spans});
    const amountValue = value => {
      if (/\b(euros|spent|paid|bought|purchased|received|salary)\b/.test(s) && /^\d+\.\d{3}$/.test(value)) throw Error('Ambiguous decimal amount');
      return cents(value);
    };
    if (/(?:^|[\s(€])[-−]\s*\d|\beur(?:os?)?\s*[-−]\s*\d|\b(?:meno|minus|negative)\s+(?:\d|[a-z])/.test(s)) return unresolved('Indica un importo positivo e scegli il tipo di movimento.');
    // Validate the entire currency token before attempting any partial match.
    for (const m of s.matchAll(/(?:(?:€|\beur(?:os?)?\b)\s*(\d[\d.,]*(?:[ ]\d{3})*)|(\d[\d.,]*(?:[ ]\d{3})*)\s*(?:euros?\b|eur\b|€))/g)) {
      try { amountValue(m[1] || m[2]); } catch (_) { return unresolved('Importo non valido: controlla separatori e decimali.'); }
    }
    const store = (start, end, amount) => {
      if (!spans.some(([a,b]) => start < b && end > a)) { found.push(amount); spans.push([start,end]); }
    };
    const fractionAt = end => {
      const tail = s.slice(end).match(/^\s+(?:e|and)\s+([a-z0-9]+(?:[- ]+[a-z]+){0,3})\b/);
      if (!tail) return {fraction:0, end};
      const tokens = [...tail[1].matchAll(/[a-z0-9]+/g)];
      for (let count = tokens.length; count > 0; count--) {
        const last = tokens[count - 1], part = tail[1].slice(0, last.index + last[0].length), fraction = wordNumber(part);
        if (fraction === undefined || fraction < 0 || fraction >= 100) continue;
        let next = end + tail[0].length - tail[1].length + part.length;
        const unit = s.slice(next).match(/^\s+(?:centesimi|cents?)\b/); if (unit) next += unit[0].length;
        return {fraction, end:next};
      }
      return {fraction:0, end};
    };
    for (const m of s.matchAll(new RegExp(`(?:(?:€|\\beur(?:os?)?\\b)\\s*(${numeric})|\\b(${numeric})\\s*(?:euros?\\b|eur\\b|€))`, 'g'))) {
      try {
        const value = m[1] || m[2], end = m.index + m[0].length;
        const fraction = /[.,]\d{1,2}$/.test(value) ? {fraction:0,end} : fractionAt(end);
        store(m.index, fraction.end, amountValue(value) + fraction.fraction);
      } catch (_) { return unresolved('Importo non valido.'); }
    }
    // Only mask the number-word suffix, preserving any preceding product or merchant.
    for (const m of s.matchAll(/\b([a-z]+(?:[-\s]+[a-z]+){0,8})\s+euros?\b/g)) {
      const parts = [...m[1].matchAll(/[a-z]+/g)]; let whole, start;
      for (const part of parts) {
        whole = wordNumber(m[1].slice(part.index));
        if (whole !== undefined) { start = m.index + part.index; break; }
      }
      if (whole === undefined) continue;
      const fraction = fractionAt(m.index + m[0].length);
      store(start, fraction.end, whole * 100 + fraction.fraction);
    }
    if (found.length > 1) return unresolved('Ci sono più importi: separa i movimenti con un punto e virgola o una nuova riga.');
    if (!found.length) {
      // Replacing by equal-length spaces keeps offsets valid for the original sentence.
      const cleaned = s.replace(/\b(?:rata\s*)?\d+\s*(?:di|\/)\s*\d+\b/g, m=>' '.repeat(m.length)).replace(/\b\d+\s+rate\b/g, m=>' '.repeat(m.length));
      const candidates = [...cleaned.matchAll(new RegExp(`\\b${numeric}\\b`, 'g'))];
      if (candidates.length === 1) {
        try { store(candidates[0].index, candidates[0].index + candidates[0][0].length, amountValue(candidates[0][0])); } catch (_) { /* Leave invalid input unresolved. */ }
      }
      if (candidates.length > 1) return unresolved('Più numeri senza valuta: indica chiaramente l’importo in euro.');
    }
    if (!found.length || found[0] <= 0) return unresolved('Non ho trovato un importo positivo. Inseriscilo nel campo Importo.');
    return {amountCents:found[0], warning:'', spans};
  }

  // Names use only recognized spans, never a blanket removal of digits or brands.
  function entryName(text, ref = today(), dateInfo = parseDate(text, ref), amountInfo = parseAmount(dateInfo.masked)) {
    const normalized = norm(text);
    const withPrefix = (spans, pattern) => spans.map(([a,b]) => {
      const prefix = normalized.slice(0,a).match(pattern);
      return [prefix ? a - prefix[0].length : a,b];
    });
    const spans = [
      ...withPrefix(dateInfo.spans, /\b(?:a partire da|il|dal|dalla|del|di|per|on|from|starting|the)\s*$/),
      ...withPrefix(amountInfo.spans, /\b(?:di|da|a|per|for|of|costing)\s*$/)
    ]; let position = 0;
    let name = Array.from(String(text)).map(char => {
      const start = position; position += norm(char).length;
      return spans.some(([a,b]) => start < b && position > a) ? ' ' : char;
    }).join('');
    name = name
      .replace(/\b(?:(?:pagat[oaie]|paid)\s+)?(?:con|tramite|via|using|with|by)\s+(?:(?:la|il|the|my)\s+)?(?:carta(?:\s+di\s+(?:credito|debito))?|bancomat|contanti|bonifico|paypal|apple pay|google pay|credit card|debit card|card|cash|bank transfer)\b/gi, ' ')
      .replace(/\b(?:(?:pagat[oaie]|paid)\s+)?(?:in contanti|in cash)\b/gi, ' ')
      .replace(/\b(?:paypal|klarna)\s+(?=(?:rata|installment)\b)/gi, ' ')
      .replace(/\b(?:e|and)\s+(?:ho\s+)?(?:pagato|paid)\b/gi, ' ')
      .replace(/\b(?:rata|installment)\s+\d+\s*(?:di|of|\/)\s*\d+\b/gi, ' ')
      .replace(/\b(?:io\s+)?ho\s+(?:fatto|speso|pagato|comprato|acquistato|preso|ricevuto|incassato|versato|messo)(?:\s+(?:il|lo|la|un|una))?\b/gi, ' ')
      .replace(/\b(?:devo pagare|da pagare|pagher[oò]|spender[oò]|comprer[oò]|mi coster[aà]|mi [eè] costato|ho bisogno di registrare|vorrei registrare)\b/gi, ' ')
      .replace(/\b(?:i(?:['’]ve| have)?\s+(?:spent|paid|bought|purchased|received|earned)|i(?:['’]ll| will)\s+(?:spend|pay|buy)|i need to pay|it cost me)(?:\s+(?:a|an))?\b/gi, ' ')
      .replace(/^(?:\s*(?:vorrei registrare|vorrei aggiungere|i want to record|i want to add|i would like to record|i would like to add|per favore|please|registra|aggiungi|segna|registrami|segnami|add|record|spent|paid)\b[,:]?)+/gi, ' ')
      .replace(/^[\s,.:;!?–—-]+|[\s,.:;!?–—-]+$/g, '').replace(/\s+/g, ' ');
    const connector = '(?:di|da|dal|dalla|dallo|dai|dagli|dalle|a|al|alla|allo|ai|agli|alle|in|con|per|del|della|dello|dei|degli|delle|on|for|at|from|to|with|of)';
    name = name.replace(new RegExp(`^(?:${connector}\\s+(?:(?:il|lo|la|un|una|the|a|an)\\s+)?)+`, 'i'), '')
      .replace(new RegExp(`(?:\\s+${connector})+$`, 'i'), '').trim();
    // Keep intentional mixed-case brands such as iPhone and eBay.
    return name && !/[A-ZÀ-Ý]/.test(name.split(/\s/)[0].slice(1)) ? name[0].toLocaleUpperCase() + name.slice(1) : name;
  }

  // Score complete words and phrases; product context beats generic retailers.
  const RULES = [
    ['Casa',10,'tavolo|tavolino|sedia|sedie|divano|poltrona|letto|materasso|armadio|libreria|comodino|lampada|lampadario|scaffale|arredamento|mobili|lenzuola|asciugamani|pentola|padella|aspirapolvere|lavatrice|lavastoviglie|frigorifero|affitto|mutuo'],
    ['Casa',5,'ikea|leroy merlin|mondo convenienza'],
    ['Spesa',8,'supermercato|conad|lidl|coop|esselunga|carrefour|eurospin|aldi|md discount|fruttivendolo|macelleria|pescheria|alimentari|spesa alimentare'],
    ['Spesa',4,'pane|latte|frutta|verdura|uova|spesa al mercato'],
    ['Mangiare fuori',9,'ristorante|ristoranti|pizzeria|pizza|cena|pranzo|colazione|aperitivo|apericena|sushi|caffe|cappuccino|cornetto|spritz|pub|bar|trattoria|gelato|mcdonald|mcdonalds|burger king|deliveroo|glovo|just eat|ho mangiato fuori'],
    ['Trasporti',10,'benzina|carburante|gasolio|diesel|pieno|distributore|ricarica tesla|ricarica auto|colonnina|colonnine|supercharger|parcheggio|pedaggio|casello|telepass|taxi|uber|autobus|metro|metropolitana'],
    ['Trasporti',7,'eni|q8|esso|ip distributore|enilive'],
    ['Auto',10,'rata macchina|rata auto|meccanico|gommista|pneumatici|tagliando|revisione auto|bollo|carrozziere'],
    ['Auto',2,'auto|macchina|tesla'],
    ['Viaggi',10,'volo|voli|aereo|aerei|biglietto aereo|hotel|albergo|ostello|airbnb|ryanair|easyjet|wizzair|wizz air|ita airways|booking|vacanza|vacanze|traghetto|trenitalia|italo|treno'],
    ['Salute',10,'farmacia|farmaci|medicine|medicinali|tachipirina|dentista|medico|visita medica|analisi|fisioterapia|oculista|ottico|lenti'],
    ['Sport',10,'palestra|piscina|padel|padbol|calcetto|personal trainer|abbonamento palestra|tennis|yoga|pilates|crossfit'],
    ['Sport',4,'decathlon'],
    ['Shopping',9,'scarpe|maglietta|maglione|pantaloni|vestiti|jeans|giacca|zaino|borsa|telefono|iphone|computer|macbook|auricolari|cuffie|libro|videogioco'],
    ['Shopping',2,'amazon|ebay|zalando|zara|h&m|shein|vinted|aliexpress'],
    ['Abbonamenti',12,'wifi tesla|wi fi tesla|wi-fi tesla|netflix|spotify|disney|icloud|youtube premium|prime video|chatgpt|abbonamento streaming'],
    ['Pensione',15,'fondo pensione|pensione privata|fondo pensionistico|fondo pensione privato'],
    ['Assicurazioni',13,'assicurazione|polizza|rc auto'],
    ['Utenze',12,'bolletta|bollette|elettricita|fibra|internet casa|luce e gas|luce|gas|acqua|ricarica telefonica|ricarica cellulare|ricarica vodafone|ricarica tim|ricarica iliad|vodafone|iliad|fastweb'],
    ['Regali',15,'regalo|regali|compleanno|donazione|beneficenza'],
    ['Lavoro',12,'commercialista|ordine professionale|partita iva|cancelleria'],
    ['Stipendio',20,'stipendio|busta paga|tredicesima|quattordicesima|bonus'],
    ['Rimborsi',16,'rimborso|rimborsato|rimborso ricevuto'],
    ['Casa',10,'rent|mortgage|furniture|sofa|table|mattress'],
    ['Spesa',8,'groceries|supermarket'],
    ['Mangiare fuori',9,'restaurant|dinner|lunch|breakfast|coffee'],
    ['Trasporti',10,'petrol|gasoline|fuel|parking|toll|bus|subway'],
    ['Viaggi',10,'flight|train|holiday'],
    ['Salute',10,'pharmacy|medicine|dentist|doctor'],
    ['Sport',10,'gym|swimming pool'],
    ['Shopping',9,'shoes|clothes|headphones'],
    ['Assicurazioni',13,'insurance'],
    ['Utenze',12,'electricity|utility bill|phone bill'],
    ['Stipendio',20,'salary|paycheck|paycheque|wages'],
    ['Rimborsi',16,'refund|reimbursement'],
    ['Regali',15,'gift|gifts|birthday|donation'],
    ['Pensione',15,'pension fund|retirement fund'],
    ['Lavoro',12,'accountant|office supplies']
  ];

  // Small, local example model. No transaction is used as training data: only
  // categories explicitly remembered by this user are eligible to teach it.
  // TF-IDF rewards distinctive words, while coverage and competing neighbours
  // make unknown merchants and mixed descriptions abstain instead of guessing.
  const CATEGORY_EXAMPLES = [
    ['Casa', 'home furnishings furniture|arredo casa mobili|house rental housing rent'],
    ['Spesa', 'weekly grocery groceries supermarket|grocery shopping|spesa settimanale alimentari'],
    ['Mangiare fuori', 'takeaway takeout meal|cafe cafeteria espresso|dining out eating out|cena fuori ristorante|pranzo fuori trattoria'],
    ['Trasporti', 'cab ride taxi fare|public transit transportation|bus ticket bus pass|carburante trasporto urbano'],
    ['Auto', 'car repair mechanic servicing|tyres tires vehicle maintenance|riparazione veicolo officina'],
    ['Viaggi', 'airfare airline travel accommodation|railway train ticket|prenotazione viaggio pernottamento'],
    ['Salute', 'medical prescription healthcare|dental checkup treatment|visita sanitaria medicinali'],
    ['Sport', 'fitness workout training|exercise sports membership|corso sportivo allenamento'],
    ['Shopping', 'clothing clothing store|electronics purchase|abbigliamento accessori acquisti'],
    ['Abbonamenti', 'streaming subscription membership|software subscription monthly|abbonamento digitale piattaforma'],
    ['Assicurazioni', 'insurance policy premium|premio assicurativo polizza'],
    ['Pensione', 'retirement pension contribution|contributo previdenziale pensionistico'],
    ['Utenze', 'broadband internet bill|water electricity utilities|fornitura energia utenza'],
    ['Regali', 'birthday present gift|charitable charity donation|regalo compleanno beneficenza'],
    ['Lavoro', 'business professional expenses|office stationery accountant|materiale ufficio professione'],
    ['Stipendio', 'monthly payroll salary|monthly earnings wages|retribuzione mensile stipendio'],
    ['Rimborsi', 'purchase refund reimbursement|spese rimborsate rimborso']
  ];
  const CATEGORY_STOP_WORDS = new Set(('a al alla allo ai agli alle da dal dalla dallo dai dagli dalle di del della dello dei degli delle e il lo la i gli le un uno una in nel nella sul sulla con per che ho hai ha fatto fare speso pagato comprato acquistato preso ieri oggi domani euro euros eur the a an at on in of for to from with and my i me we you it this that was were have had paid spent bought yesterday today tomorrow payment pagamento costo cost please add record registra aggiungi segna favore').split(' '));
  const categoryTokens = text => [...new Set(norm(text).match(/[a-z]+/g) || [])].filter(w => w.length >= 3 && !CATEGORY_STOP_WORDS.has(w));
  let categoryModelCache;
  function categoryModel(preferences) {
    const key = JSON.stringify(preferences);
    if (categoryModelCache?.key === key) return categoryModelCache.model;
    const examples = CATEGORY_EXAMPLES.flatMap(([category, phrases]) => phrases.split('|').map(phrase => ({category, phrase})))
      .concat(preferences.map(r => ({...r, remembered:true})))
      .map(example => ({...example, tokens:categoryTokens(example.phrase)})).filter(example => example.tokens.length);
    const frequency = new Map();
    for (const example of examples) for (const token of example.tokens) frequency.set(token, (frequency.get(token)||0) + 1);
    const idf = token => 1 + Math.log((examples.length + 1) / ((frequency.get(token)||0) + 1));
    const vector = tokens => {
      const weights = new Map(tokens.map(token => [token, idf(token)]));
      const length = Math.hypot(...weights.values()) || 1;
      return new Map([...weights].map(([token, weight]) => [token, weight / length]));
    };
    const model = {vector, examples:examples.map(example => ({...example, vector:vector(example.tokens)}))};
    // Only one user's current preference set is retained, and removal invalidates
    // the cache. Nothing is persisted, shared, or sent to a model provider.
    categoryModelCache = {key, model};
    return model;
  }
  function categoryByExample(text, preferences) {
    const tokens = categoryTokens(text);
    if (!tokens.length) return null;
    const model = categoryModel(preferences), query = model.vector(tokens), best = new Map();
    for (const example of model.examples) {
      const matches = tokens.filter(token => example.vector.has(token));
      if (matches.length / tokens.length < .5) continue;
      const score = matches.reduce((sum, token) => sum + query.get(token) * example.vector.get(token), 0);
      if (score > (best.get(example.category)?.score || 0)) best.set(example.category, {...example, score});
    }
    const [first, second] = [...best.values()].sort((a,b) => b.score - a.score);
    if (!first || first.score < .5 || (second && first.score - second.score < .14)) return null;
    return {category:first.category, confidence:'medium', reason:`${first.category}: ${first.remembered ? 'Preferenza simile' : 'Descrizione simile'}: ${first.phrase}. Controlla la categoria.`};
  }
  function classify(text, learned = []) {
    const preferences = (Array.isArray(learned) ? learned : []).filter(r => r && CATEGORIES.includes(r.category) && typeof r.phrase === 'string' && r.phrase.trim().length >= 3 && r.phrase.length <= 100).slice(0,300).map(({phrase,category}) => ({phrase,category}));
    // Spoken self-corrections such as "non cena ma supermercato" use the
    // corrected description, without attempting to infer arbitrary negations.
    const context = norm(text).replace(/\b(?:non|not)\b[^.!?]*?\b(?:ma|but)\b\s*/g, ' ');
    // An explicit correction is stronger than any automatic keyword score.
    // The most specific matching phrase wins; equally specific conflicts abstain.
    const remembered = preferences.filter(r => has(context,r.phrase)).map(r => ({...r, specificity:categoryTokens(r.phrase).length * 100 + norm(r.phrase).trim().length})).sort((a,b) => b.specificity - a.specificity);
    if (remembered.length) {
      const first = remembered[0], conflict = remembered.find(r => r.specificity === first.specificity && r.category !== first.category);
      if (conflict) return {category:'', confidence:'low', reason:`Categoria ambigua: ${first.category} oppure ${conflict.category}. Scegli tu.`};
      return {category:first.category, confidence:'high', reason:`${first.category}: Preferenza: ${first.phrase}`};
    }
    const scores = new Map(), evidence = new Map();
    const add = (cat, score, why) => { scores.set(cat, (scores.get(cat)||0)+score); evidence.set(cat, [...(evidence.get(cat)||[]),why]); };
    for (const [cat,score,phrases] of RULES) {
      const matches = phrases.split('|').filter(p=>has(context,p));
      if (matches.length) add(cat, score + Math.min(3,matches.length-1), matches.join(', '));
    }
    const sorted = [...scores].sort((a,b)=>b[1]-a[1]);
    if (!sorted.length) return categoryByExample(context, preferences) || {category:'', confidence:'low', reason:'Descrizione non riconosciuta: scegli la categoria, senza supposizioni.'};
    const [cat,score] = sorted[0], margin = score-(sorted[1]?.[1]||0);
    if (sorted[1] && margin < 3) return {category:'', confidence:'low', reason:`Categoria ambigua: ${cat} oppure ${sorted[1][0]}. Scegli tu.`};
    if (score < 8) {
      const example = categoryByExample(context, preferences);
      if (example) return example;
    }
    return {category:cat, confidence:score >= 8 ? 'high' : 'medium', reason:`${cat}: ${evidence.get(cat).join(' · ')}${score < 8 ? '. Negozio generico: controlla la categoria.' : ''}`};
  }

  // Multiple amounts must be separate drafts, never silently merged.
  function splitEntries(text) {
    const chunks = text.split(/[;\n]+/).map(s=>s.trim()).filter(Boolean);
    return chunks.flatMap(s=>s.split(/\s+(?:e(?:\s+poi)?|poi|inoltre|and(?:\s+then)?|then)\s+(?=(?:(?:oggi|ieri|domani|dopodomani|today|yesterday|tomorrow)\s+)?\d+(?:[.,]\d{1,2})?\s*(?:€|euros?)\b)/i)).filter(Boolean);
  }
  function parseEntry(text, ref = today(), learned = []) {
    const d = parseDate(text,ref), a = parseAmount(d.masked), cat = classify(text,learned);
    const type = /\b(stipendio|tredicesima|quattordicesima|bonus|accreditato|accredito|ricevuto|incassato|incasso|entrata|rimborso|rimborsato|salary|paycheck|paycheque|wages|received|earned|refund|reimbursement)\b/.test(norm(text)) ? 'income' : 'expense';
    const futureIntent = /\b(devo pagare|da pagare|paghero|spendero|comprero|previsto|prevista|preventivo|mi costera|i will pay|i'll pay|i need to pay|i will spend|i'll spend|i will buy|i'll buy)\b/.test(norm(text));
    const note = entryName(text, ref, d, a), nameWarning = !note ? 'Dai un nome a questo movimento.' : note.length > 150 ? 'Usa un nome di massimo 150 caratteri.' : '';
    return {id:id(), amountCents:a.amountCents, date:d.date, type, category:cat.category, status:(d.date && d.date > ref)||futureIntent ? 'planned' : 'paid', note, includedInOpening:false, countBudget:true, recurringId:null, dueDate:null, confidence:cat.confidence, reason:cat.reason, dateReason:d.reason, warnings:[d.warning,a.warning,nameWarning].filter(Boolean)};
  }
  function interpret(text, ref = today(), learned = []) {
    if (!String(text).trim()) throw Error('Scrivi o detta una spesa.');
    if (text.length > 4000) throw Error('Testo troppo lungo: usa meno di 4.000 caratteri.');
    const chunks = splitEntries(text);
    if (chunks.length > 12) throw Error('Inserisci al massimo 12 movimenti alla volta.');
    return chunks.map(s=>parseEntry(s,ref,learned));
  }

  // Recurrences are commitments, not bank movements until explicitly confirmed.
  function occurrences(r, start, end) {
    if (!r.active || !r.startDate || !validDate(r.startDate)) return [];
    const out = [];
    for (let n=0; n<2400; n++) {
      const d = shiftMonths(r.startDate,n*r.months);
      if (d >= end) break;
      if (d >= start) out.push(d);
    }
    return out;
  }
  function cycle(ref, payday) {
    const d = dateObj(ref);
    let start = makeDate(d.getFullYear(),d.getMonth()+1,Math.min(payday,28));
    if (start > ref) start = shiftMonths(start,-1);
    return {start, end:shiftMonths(start,1)};
  }
  const within = (d,b) => d >= b.start && d < b.end;
  function totals(state, ref = today()) {
    const b = cycle(ref,state.settings.payday);
    const paid = state.transactions.filter(t=>t.status==='paid');
    const balance = state.settings.openingBalanceCents + paid.filter(t=>!t.includedInOpening && t.date <= ref).reduce((s,t)=>s+(t.type==='income'?t.amountCents:-t.amountCents),0);
    const expenses = paid.filter(t=>t.type==='expense' && t.countBudget && within(t.date,b) && t.date<=ref);
    const active = state.recurring.filter(r=>r.active && r.startDate);
    const fixedEquivalent = Math.round(active.reduce((s,r)=>s+r.amountCents/r.months,0));
    const activeIds = new Set(active.map(r=>r.id));
    const paidVariable = expenses.filter(t=>!activeIds.has(t.recurringId)).reduce((s,t)=>s+t.amountCents,0);
    const plannedVariable = state.transactions.filter(t=>t.status==='planned' && t.type==='expense' && t.countBudget && within(t.date,b) && !activeIds.has(t.recurringId)).reduce((s,t)=>s+t.amountCents,0);
    const spent = expenses.reduce((s,t)=>s+t.amountCents,0);
    return {...b, balance, spent, fixedEquivalent, paidVariable, plannedVariable, available:state.settings.budgetCents-fixedEquivalent-paidVariable-plannedVariable};
  }
  function blank() {
    return {schemaVersion:2, revision:0, updatedAt:new Date().toISOString(), settings:{initialized:false, openingDate:today(), openingBalanceCents:0, salaryCents:0, budgetCents:0, savingsGoalCents:0, separateSavingsCents:null, payday:27}, transactions:[], recurring:[], rules:[], notes:[], lastBackup:null};
  }

  // Validate a whole proposed batch before saving any part of it. Repeated
  // ordinary purchases are legitimate; only an identified instalment is unique.
  function validateTransactionBatch(items, existing = [], options = {}) {
    if (!Array.isArray(items) || !items.length) throw Error('Nessun movimento da salvare.');
    const replacing = new Set(options.replacingIds || []), ref = options.ref || today();
    const retained = existing.filter(t => !replacing.has(t.id));
    const ids = new Set(retained.map(t => t.id));
    const occurrences = new Set(retained.filter(t => t.recurringId).map(t => `${t.recurringId}:${t.dueDate || t.date}`));
    for (const t of items) {
      if (!t || typeof t.id !== 'string' || ids.has(t.id)) throw Error('Movimento duplicato o non valido.');
      if (!String(t.note || '').trim()) throw Error('Dai un nome a questo movimento.');
      if (t.note.length > 150) throw Error('Usa un nome di massimo 150 caratteri.');
      if (!validDate(t.date) || !Number.isSafeInteger(t.amountCents) || t.amountCents <= 0 || t.amountCents > LIMIT || !['income','expense'].includes(t.type) || !['paid','planned'].includes(t.status) || !CATEGORIES.includes(t.category)) throw Error('Movimento non valido.');
      if (t.status === 'paid' && t.date > ref) throw Error('Una data futura deve restare prevista.');
      if (t.status === 'planned' && t.includedInOpening) throw Error('Una previsione non può essere già nel saldo iniziale.');
      if (t.recurringId) {
        if (!validDate(t.dueDate)) throw Error('Scadenza collegata non valida.');
        const k = `${t.recurringId}:${t.dueDate}`;
        if (occurrences.has(k)) throw Error('Questa rata è già registrata. Aprila dal Piano per modificarla.');
        occurrences.add(k);
      }
      ids.add(t.id);
    }
    return true;
  }

  // Reject malformed imports before touching the existing local archive.
  function validate(raw) {
    if (!raw || raw.schemaVersion!==2 || !raw.settings || !Array.isArray(raw.transactions) || !Array.isArray(raw.recurring) || !Array.isArray(raw.rules)) throw Error('Backup MyMoney 2 non valido.');
    const s=raw.settings, checkAmount=(n,name,positive=false)=>{if(!Number.isSafeInteger(n)||n<(positive?1:0)||n>LIMIT)throw Error(`Importo non valido: ${name}.`);};
    if (!validDate(s.openingDate) || !Number.isInteger(s.payday) || s.payday<1 || s.payday>28 || typeof s.initialized!=='boolean') throw Error('Impostazioni non valide.');
    ['openingBalanceCents','salaryCents','budgetCents','savingsGoalCents'].forEach(k=>checkAmount(s[k],k));
    if (s.separateSavingsCents!==null)checkAmount(s.separateSavingsCents,'risparmi separati');
    if (raw.transactions.length>40000 || raw.recurring.length>200 || raw.rules.length>300)throw Error('Backup troppo grande.');
    const ids=new Set();
    for(const r of raw.recurring){
      if(typeof r.id!=='string'||ids.has(r.id)||typeof r.name!=='string'||r.name.length>150||!CATEGORIES.includes(r.category)||!Number.isInteger(r.months)||r.months<1||r.months>60||typeof r.active!=='boolean'||typeof r.automatic!=='boolean'||(r.startDate!==null&&!validDate(r.startDate))||(r.active&&!r.startDate))throw Error('Ricorrenza non valida.');
      checkAmount(r.amountCents,'ricorrenza',true);ids.add(r.id);
    }
    const txIds=new Set();
    for(const t of raw.transactions){
      if(typeof t.id!=='string'||txIds.has(t.id)||!validDate(t.date)||!['income','expense'].includes(t.type)||!['paid','planned'].includes(t.status)||!CATEGORIES.includes(t.category)||typeof t.note!=='string'||t.note.length>4000||typeof t.includedInOpening!=='boolean'||typeof t.countBudget!=='boolean')throw Error('Movimento non valido.');
      if(t.recurringId!==null&&!ids.has(t.recurringId))throw Error('Ricorrenza collegata non trovata.');
      if(t.dueDate!==null&&!validDate(t.dueDate))throw Error('Scadenza collegata non valida.');
      if(t.status==='planned'&&t.includedInOpening)throw Error('Una previsione non può essere già nel saldo iniziale.');
      checkAmount(t.amountCents,'movimento',true);txIds.add(t.id);
    }
    for(const r of raw.rules)if(typeof r.phrase!=='string'||r.phrase.length<3||r.phrase.length>100||!CATEGORIES.includes(r.category))throw Error('Regola non valida.');
    if(!Array.isArray(raw.notes)||raw.notes.some(n=>typeof n!=='string'||n.length>2000))throw Error('Note non valide.');
    const clean=clone(raw);
    clean.revision=Number.isSafeInteger(raw.revision)?raw.revision:0;
    clean.lastBackup=typeof raw.lastBackup==='string'?raw.lastBackup:null;
    return clean;
  }

  // Migrate the original prototype without discarding user-entered movements.
  function migrate(old, ref=today(), knownSettings=null) {
    if(old?.schemaVersion===2)return validate(old);
    if(!old||!Array.isArray(old.transactions)||!Array.isArray(old.recurring))throw Error('Backup non riconosciuto.');
    const data=blank();
    if(knownSettings?.initialized)data.settings=clone(knownSettings);
    else data.settings.initialized=false;
    const categoryMap={Alimentari:'Spesa',Benzina:'Trasporti',Ristoranti:'Mangiare fuori'};
    data.recurring=old.recurring.map((r,i)=>{
      const name=String(r.name||'Ricorrenza'), n=norm(name);
      const parsed=parseDate(String(r.due||''),ref);
      let startDate=parsed.explicit?parsed.date:null;
      const day=String(r.due||'').match(/^(\d{1,2}) di ogni mese/);
      if(day){const b=dateObj(ref);startDate=makeDate(b.getFullYear(),b.getMonth()+1,+day[1]);if(startDate&&startDate<ref)startDate=shiftMonths(startDate,1);}
      return {id:`legacy-rec-${i}`,name,amountCents:Math.round(Number(r.amount)*100),months:Number(r.months),startDate,active:!!startDate,automatic:!!r.automatic,estimated:n.includes('assicura'),category:n.includes('pension')?'Pensione':n.includes('assicura')?'Assicurazioni':n.includes('wifi')||n.includes('wi-fi')?'Abbonamenti':'Auto'};
    });
    data.transactions=old.transactions.map(t=>({id:String(t.id||id()),date:String(t.date),type:t.type,amountCents:Math.round(Number(t.amount)*100),category:categoryMap[t.category]||t.category||'Altro',note:String(t.note||''),includedInOpening:!!t.included,status:t.date>ref?'planned':'paid',countBudget:true,recurringId:null,dueDate:null}));
    data.notes=['Importazione dal prototipo: il vecchio backup non contiene il saldo iniziale. Se necessario configurarlo in Dati. Rivedi i movimenti interpretati male nella vecchia versione. Le spese incluse nel saldo iniziale ora possono contare nel budget, senza modificare il conto.'];
    return validate(data);
  }
  const api={CATEGORIES,MONTHS,norm,iso,today,dateObj,validDate,makeDate,shiftDays,shiftMonths,cents,money,id,clone,has,parseDate,parseAmount,entryName,classify,splitEntries,parseEntry,interpret,occurrences,cycle,within,totals,blank,validate,validateTransactionBatch,migrate};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  root.MM=api;
})(typeof globalThis!=='undefined'?globalThis:this);
