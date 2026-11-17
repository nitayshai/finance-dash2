/*
 * core.js — מצפן כספי: כל הלוגיקה החישובית.
 * פונקציות טהורות בלבד, בלי DOM ובלי גישה לאחסון.
 * כל הסכומים נשמרים באגורות (מספרים שלמים). תאריכים הם מחרוזות מקומיות YYYY-MM-DD.
 * נחשף כ-window.FinanceCore בדפדפן וכ-module.exports ב-Node.
 */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.FinanceCore = api;
  else if (root) root.FinanceCore = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var SCHEMA_VERSION = 1;
  var BACKUP_FORMAT = 'matzpen-backup';

  /* ===================== כסף ===================== */

  /** ממיר קלט (מספר או מחרוזת כמו "₪1,234.50") לאגורות שלמות. קלט לא תקין → NaN. */
  function toAgorot(input) {
    if (input === null || input === undefined) return NaN;
    var s;
    if (typeof input === 'number') {
      if (!isFinite(input)) return NaN;
      s = String(input);
      if (/e/i.test(s)) return Math.round(input * 100);
    } else {
      s = String(input).trim();
    }
    // ניקוי סימני מטבע, רווחים ומפרידי אלפים
    s = s.replace(/[₪\s‏‎]|ILS|NIS|ש"ח/gi, '').replace(/,/g, '');
    var neg = false;
    if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
    if (s.charAt(0) === '-') { neg = !neg; s = s.slice(1); }
    else if (s.charAt(0) === '+') s = s.slice(1);
    if (s.slice(-1) === '-') { neg = !neg; s = s.slice(0, -1); } // פורמט בנקאי "123-"
    if (!/^\d*(\.\d*)?$/.test(s) || s === '' || s === '.') return NaN;
    var parts = s.split('.');
    var intPart = parts[0] || '0';
    var dec = (parts[1] || '') + '000';
    var ag = parseInt(intPart, 10) * 100 + parseInt(dec.slice(0, 2), 10);
    if (parseInt(dec.charAt(2), 10) >= 5) ag += 1; // עיגול חצי למעלה
    return neg ? -ag : ag;
  }

  /** אגורות → שקלים (מספר עשרוני, לתצוגה ולחישובי הצגה בלבד). */
  function toShekels(agorot) { return (agorot || 0) / 100; }

  var _fmtCache = {};
  function _nf(decimals) {
    var k = 'd' + decimals;
    if (!_fmtCache[k]) {
      _fmtCache[k] = new Intl.NumberFormat('he-IL', {
        style: 'currency', currency: 'ILS',
        minimumFractionDigits: decimals, maximumFractionDigits: decimals
      });
    }
    return _fmtCache[k];
  }

  /** פורמט ₪ עברי. opts: decimals (ברירת מחדל 0), sign (הוספת + לחיובי), compact. */
  function formatILS(agorot, opts) {
    opts = opts || {};
    var v = (agorot || 0) / 100;
    if (opts.compact && Math.abs(v) >= 10000) {
      var abs = Math.abs(v), str;
      if (abs >= 1e6) str = (abs / 1e6).toFixed(abs >= 1e7 ? 1 : 2).replace(/\.?0+$/, '') + 'M';
      else str = Math.round(abs / 1000) + 'K';
      return (v < 0 ? '-' : (opts.sign && v > 0 ? '+' : '')) + '₪' + str;
    }
    var d = opts.decimals === undefined ? 0 : opts.decimals;
    var s = _nf(d).format(Math.abs(v));
    // Intl עשוי להכניס סימני כיווניות — מנרמלים
    s = s.replace(/[‎‏؜]/g, '');
    if (v < 0 && Math.round(Math.abs(v) * Math.pow(10, d)) !== 0) return '-' + s;
    if (opts.sign && v > 0) return '+' + s;
    return s;
  }

  function formatPct(value, decimals) {
    if (!isFinite(value)) return '—';
    var d = decimals === undefined ? 0 : decimals;
    return value.toFixed(d) + '%';
  }

  /* ===================== תאריכים (מקומיים, בלי UTC) ===================== */

  function pad(n) { return n < 10 ? '0' + n : String(n); }

  function isLeap(y) { return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0; }

  function daysInMonth(y, m) { // m: 1-12
    return [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
  }

  function isValidISO(s) {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    var p = parseISO(s);
    return p.m >= 1 && p.m <= 12 && p.d >= 1 && p.d <= daysInMonth(p.y, p.m);
  }

  function parseISO(s) {
    return { y: parseInt(s.slice(0, 4), 10), m: parseInt(s.slice(5, 7), 10), d: parseInt(s.slice(8, 10), 10) };
  }

  function makeISO(y, m, d) { return y + '-' + pad(m) + '-' + pad(d); }

  /** תאריך היום לפי השעון המקומי. */
  function todayISO(date) {
    var d = date || new Date();
    return makeISO(d.getFullYear(), d.getMonth() + 1, d.getDate());
  }

  /** הוספת חודשים. anchorDay (אופציונלי) קובע את היום המבוקש; חודש קצר → היום האחרון בו. */
  function addMonths(iso, n, anchorDay) {
    var p = parseISO(iso);
    var total = p.y * 12 + (p.m - 1) + n;
    var y = Math.floor(total / 12), m = (total % 12) + 1;
    var day = Math.min(anchorDay || p.d, daysInMonth(y, m));
    return makeISO(y, m, day);
  }

  function addDays(iso, n) {
    var p = parseISO(iso);
    // שימוש ב-Date.UTC רק כאריתמטיקה של ימים — בלי תלות באזור זמן או שעון קיץ
    var t = Date.UTC(p.y, p.m - 1, p.d) + n * 86400000;
    var d = new Date(t);
    return makeISO(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }

  function daysBetween(a, b) {
    var pa = parseISO(a), pb = parseISO(b);
    return Math.round((Date.UTC(pb.y, pb.m - 1, pb.d) - Date.UTC(pa.y, pa.m - 1, pa.d)) / 86400000);
  }

  /** מספר חודשים שלמים מ-a עד b. */
  function monthsBetween(a, b) {
    var pa = parseISO(a), pb = parseISO(b);
    var m = (pb.y - pa.y) * 12 + (pb.m - pa.m);
    if (pb.d < pa.d && !(pb.d === daysInMonth(pb.y, pb.m))) m -= 1;
    return m;
  }

  /* ===================== חודש כלכלי ===================== */

  function clampStartDay(sd) {
    sd = parseInt(sd, 10);
    if (!(sd >= 1)) return 1;
    return Math.min(28, sd);
  }

  /** מפתח החודש הכלכלי (YYYY-MM) שתאריך שייך אליו. חודש כלכלי מתחיל ביום startDay. */
  function finMonthKey(iso, startDay) {
    var sd = clampStartDay(startDay);
    var p = parseISO(iso);
    if (p.d >= sd) return p.y + '-' + pad(p.m);
    var prev = addMonths(makeISO(p.y, p.m, 1), -1);
    return prev.slice(0, 7);
  }

  function shiftMonthKey(key, n) { return addMonths(key + '-01', n).slice(0, 7); }

  /** טווח התאריכים של חודש כלכלי. */
  function finMonthRange(key, startDay) {
    var sd = clampStartDay(startDay);
    var start = key + '-' + pad(sd);
    var end = addDays(shiftMonthKey(key, 1) + '-' + pad(sd), -1);
    return { start: start, end: end };
  }

  /** n מפתחות חודש אחרונים, מהישן לחדש, כולל currentKey. */
  function lastMonthKeys(currentKey, n) {
    var out = [];
    for (var i = n - 1; i >= 0; i--) out.push(shiftMonthKey(currentKey, -i));
    return out;
  }

  var HE_MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
  function monthLabel(key, short) {
    var y = key.slice(0, 4), m = parseInt(key.slice(5, 7), 10);
    var name = HE_MONTHS[m - 1];
    if (short) return name.slice(0, 3) + "' " + y.slice(2);
    return name + ' ' + y;
  }

  function formatDateHe(iso) {
    if (!iso) return '';
    var p = parseISO(iso);
    return pad(p.d) + '/' + pad(p.m) + '/' + p.y;
  }

  /* ===================== תנועות חוזרות ===================== */

  var FREQ_STEP = { monthly: 1, bimonthly: 2, quarterly: 3, yearly: 12 };
  var FREQ_LABEL = { monthly: 'חודשית', bimonthly: 'דו-חודשית', quarterly: 'רבעונית', yearly: 'שנתית', once: 'חד-פעמית' };

  /** גורם להמרה לסכום חודשי שווה ערך. */
  function monthlyFactor(freq) { return FREQ_STEP[freq] ? 1 / FREQ_STEP[freq] : 0; }

  /** כל תאריכי המופעים של סדרה, מתאריך ההתחלה ועד untilISO (כולל), בכפוף לתאריך סיום. */
  function occurrenceDates(series, untilISO) {
    var step = FREQ_STEP[series.freq];
    if (!step || !isValidISO(series.startDate)) return [];
    var end = untilISO;
    if (series.endDate && series.endDate < end) end = series.endDate;
    var anchor = parseISO(series.startDate).d;
    var out = [];
    for (var i = 0; i < 5000; i++) {
      var d = addMonths(series.startDate, i * step, anchor);
      if (d > end) break;
      out.push(d);
    }
    return out;
  }

  /** מזהה דטרמיניסטי למופע: סדרה + תאריך מתוכנן. */
  function occurrenceId(seriesId, iso) { return 'r_' + seriesId + '_' + iso; }

  function txFromSeries(s, date) {
    return {
      id: occurrenceId(s.id, date), kind: s.kind, amount: s.amount, date: date,
      categoryId: s.categoryId, sub: s.sub || '', payment: s.payment || '',
      essential: !!s.essential, note: s.note || '', group: s.group || null,
      incomeType: s.incomeType || null, seriesId: s.id, occDate: date,
      demo: !!s.demo
    };
  }

  /**
   * משלים מופעים חסרים של כל הסדרות עד untilISO. אידמפוטנטי: מופע שקיים (לפי מזהה)
   * או שנמחק במפורש (skips) לא ייווצר שוב. מחזיר מערך חדש + מספר מה שנוסף.
   */
  function materializeRecurring(seriesList, transactions, untilISO) {
    var ids = new Set();
    for (var i = 0; i < transactions.length; i++) ids.add(transactions[i].id);
    var added = [];
    (seriesList || []).forEach(function (s) {
      var skips = new Set(s.skips || []);
      occurrenceDates(s, untilISO).forEach(function (d) {
        var id = occurrenceId(s.id, d);
        if (ids.has(id) || skips.has(d)) return;
        ids.add(id);
        added.push(txFromSeries(s, d));
      });
    });
    return { transactions: added.length ? transactions.concat(added) : transactions, added: added.length };
  }

  /** מחיקת מופע בודד: מסירה את התנועה ומסמנת את התאריך כדילוג בסדרה. */
  function deleteOccurrence(seriesList, transactions, txId) {
    var tx = null;
    var rest = transactions.filter(function (t) { if (t.id === txId) { tx = t; return false; } return true; });
    if (!tx) return { series: seriesList, transactions: transactions };
    var series = seriesList.map(function (s) {
      if (tx.seriesId && s.id === tx.seriesId && tx.occDate) {
        var sk = (s.skips || []).slice();
        if (sk.indexOf(tx.occDate) < 0) sk.push(tx.occDate);
        return Object.assign({}, s, { skips: sk });
      }
      return s;
    });
    return { series: series, transactions: rest };
  }

  /**
   * עריכת סדרה מתאריך מסוים והלאה: הסדרה הישנה מסתיימת יום לפני, נוצרת סדרה חדשה
   * עם השינויים. מופעים עתידיים שלא נערכו ידנית נמחקים ויושלמו מחדש מהסדרה החדשה.
   */
  function splitSeries(seriesList, transactions, seriesId, fromISO, changes) {
    var old = null;
    seriesList.forEach(function (s) { if (s.id === seriesId) old = s; });
    if (!old) return { series: seriesList, transactions: transactions, newId: null };
    var newId = old.id + '~' + fromISO.replace(/-/g, '');
    // תאריך התחלה חדש: המופע הראשון של הסדרה הישנה מ-fromISO והלאה (שומר על הקצב)
    var start = fromISO;
    if (!changes || !changes.startDate) {
      var occ = occurrenceDates(Object.assign({}, old, { endDate: null }), addMonths(fromISO, 13));
      for (var i = 0; i < occ.length; i++) { if (occ[i] >= fromISO) { start = occ[i]; break; } }
    }
    var ns = Object.assign({}, old, changes || {}, { id: newId, startDate: (changes && changes.startDate) || start, skips: [] });
    if (old.endDate && !(changes && 'endDate' in changes)) ns.endDate = old.endDate;
    var oldEnd = addDays(fromISO, -1);
    var series = [];
    seriesList.forEach(function (s) {
      if (s.id !== seriesId) { series.push(s); return; }
      if (oldEnd >= s.startDate) series.push(Object.assign({}, s, { endDate: oldEnd }));
      // אם הסדרה הישנה לא התחילה בכלל — היא מוחלפת לגמרי
    });
    series.push(ns);
    var txs = transactions.filter(function (t) {
      return !(t.seriesId === seriesId && t.occDate >= fromISO && !t.edited);
    });
    return { series: series, transactions: txs, newId: newId };
  }

  /* ===================== סיכומים חודשיים ===================== */

  function inRange(iso, r) { return iso >= r.start && iso <= r.end; }

  function txInMonth(transactions, key, startDay) {
    var r = finMonthRange(key, startDay);
    return transactions.filter(function (t) { return inRange(t.date, r); });
  }

  /** סיכום חודש כלכלי: הכנסות, הוצאות, חיסכון, שיעור חיסכון, פירוט לפי קטגוריה ולפי קבוצה. */
  function summarizeMonth(transactions, key, startDay) {
    var list = txInMonth(transactions, key, startDay);
    var income = 0, expense = 0, essential = 0, discretionary = 0;
    var byCategory = {}, byGroup = { fixed: 0, variable: 0, occasional: 0 };
    list.forEach(function (t) {
      if (t.kind === 'income') income += t.amount;
      else {
        expense += t.amount;
        if (t.essential) essential += t.amount; else discretionary += t.amount;
        byCategory[t.categoryId] = (byCategory[t.categoryId] || 0) + t.amount;
        if (t.group && byGroup[t.group] !== undefined) byGroup[t.group] += t.amount;
      }
    });
    var net = income - expense;
    return {
      key: key, income: income, expense: expense, net: net,
      rate: income > 0 ? (net / income) * 100 : 0,
      essential: essential, discretionary: discretionary,
      byCategory: byCategory, byGroup: byGroup, count: list.length
    };
  }

  function monthlyHistory(transactions, currentKey, n, startDay) {
    return lastMonthKeys(currentKey, n).map(function (k) { return summarizeMonth(transactions, k, startDay); });
  }

  /** ממוצע של חודשים שלמים קודמים שבהם היו תנועות (עד n חודשים). */
  function averageMonths(transactions, currentKey, n, startDay) {
    var hist = [];
    for (var i = 1; i <= n; i++) {
      var s = summarizeMonth(transactions, shiftMonthKey(currentKey, -i), startDay);
      if (s.count > 0) hist.push(s);
    }
    var res = { months: hist.length, income: 0, expense: 0, essential: 0, discretionary: 0, byCategory: {} };
    if (!hist.length) return res;
    hist.forEach(function (h) {
      res.income += h.income; res.expense += h.expense;
      res.essential += h.essential; res.discretionary += h.discretionary;
      Object.keys(h.byCategory).forEach(function (c) { res.byCategory[c] = (res.byCategory[c] || 0) + h.byCategory[c]; });
    });
    var L = hist.length;
    res.income = Math.round(res.income / L); res.expense = Math.round(res.expense / L);
    res.essential = Math.round(res.essential / L); res.discretionary = Math.round(res.discretionary / L);
    Object.keys(res.byCategory).forEach(function (c) { res.byCategory[c] = Math.round(res.byCategory[c] / L); });
    return res;
  }

  /** סכום חודשי שווה ערך מסדרות פעילות (משמש כשאין היסטוריה). */
  function seriesMonthlyTotals(seriesList, todayIso) {
    var income = 0, expense = 0, essential = 0;
    (seriesList || []).forEach(function (s) {
      if (s.endDate && s.endDate < todayIso) return;
      var m = Math.round(s.amount * monthlyFactor(s.freq));
      if (s.kind === 'income') income += m; else { expense += m; if (s.essential) essential += m; }
    });
    return { income: income, expense: expense, essential: essential };
  }

  /** בסיס חודשי לתחזיות: ממוצע 3 חודשים אחרונים, ואם אין — מהסדרות. */
  function monthlyBaseline(state, todayIso) {
    var sd = state.settings.monthStartDay;
    var key = finMonthKey(todayIso, sd);
    var avg = averageMonths(state.transactions, key, 3, sd);
    var ser = seriesMonthlyTotals(state.series, todayIso);
    if (avg.months === 0) return { income: ser.income, expense: ser.expense, essential: ser.essential, discretionary: ser.expense - ser.essential, source: 'series' };
    return { income: avg.income, expense: avg.expense, essential: avg.essential, discretionary: avg.discretionary, source: 'history', months: avg.months };
  }

  /** מצב תקציב לכל קטגוריה עם תקציב: ok / warn (מעל 80%) / over (מעל 100%). */
  function budgetStatus(categories, transactions, key, startDay) {
    var sum = summarizeMonth(transactions, key, startDay);
    return categories.filter(function (c) { return c.kind === 'expense' && c.budget > 0; }).map(function (c) {
      var spent = sum.byCategory[c.id] || 0;
      var pct = (spent / c.budget) * 100;
      return { categoryId: c.id, name: c.name, icon: c.icon, color: c.color, budget: c.budget, spent: spent, pct: pct, status: pct > 100 ? 'over' : pct > 80 ? 'warn' : 'ok' };
    });
  }

  /** השוואה לשיטת 50/30/20. */
  function rule503020(summary) {
    var inc = summary.income;
    if (inc <= 0) return null;
    var savings = inc - summary.expense;
    return {
      needs: (summary.essential / inc) * 100,
      wants: (summary.discretionary / inc) * 100,
      savings: (savings / inc) * 100,
      targets: { needs: 50, wants: 30, savings: 20 }
    };
  }

  /* ===================== נכסים, שווי נקי ===================== */

  var RISK_SD = { low: 3, medium: 10, high: 18 }; // סטיית תקן שנתית ברירת מחדל (%)

  var ACCOUNT_TYPES = {
    checking: 'עו"ש', deposit: 'פיקדון', mmf: 'קרן כספית', hishtalmut: 'קרן השתלמות',
    gemel: 'קופת גמל להשקעה', pension: 'פנסיה', stocks: 'תיק מניות / קרנות סל',
    crypto: 'קריפטו', realestate: 'נדל"ן', other: 'אחר'
  };

  function ageAtDate(settings, todayIso, iso) {
    return (Number(settings.age) || 0) + daysBetween(todayIso, iso) / 365.25;
  }

  /** האם הנכס נזיל בתאריך נתון. */
  function isLiquidAt(account, iso, settings, todayIso) {
    if (account.tax === 'pension' || account.type === 'pension') {
      return ageAtDate(settings, todayIso || iso, iso) >= (Number(settings.retireAge) || 67);
    }
    if (account.type === 'realestate') return false;
    if (account.liquidDate && iso < account.liquidDate) return false;
    return true;
  }

  function netWorth(accounts, liabilities) {
    var assets = 0, debts = 0;
    (accounts || []).forEach(function (a) { assets += a.balance || 0; });
    (liabilities || []).forEach(function (l) { debts += l.balance || 0; });
    return { assets: assets, liabilities: debts, net: assets - debts };
  }

  function liquidAssets(accounts, settings, todayIso) {
    return (accounts || []).reduce(function (s, a) { return s + (isLiquidAt(a, todayIso, settings, todayIso) ? (a.balance || 0) : 0); }, 0);
  }

  /** כרית ביטחון: כמה חודשי הוצאות חיוניות מכוסים מנכסים נזילים. */
  function emergencyMonths(liquid, monthlyEssential) {
    if (!(monthlyEssential > 0)) return null;
    return liquid / monthlyEssential;
  }

  /** צילום שווי נקי חודשי — נוסף רק אם אין צילום לחודש הנוכחי. */
  function ensureSnapshot(snapshots, accounts, liabilities, todayIso) {
    var month = todayIso.slice(0, 7);
    snapshots = snapshots || [];
    var nw = netWorth(accounts, liabilities);
    var idx = -1;
    snapshots.forEach(function (s, i) { if (s.month === month) idx = i; });
    var snap = { month: month, date: todayIso, assets: nw.assets, liabilities: nw.liabilities, net: nw.net };
    if (idx >= 0) {
      // מעדכנים את צילום החודש הנוכחי כדי שישקף את המצב העדכני
      var copy = snapshots.slice(); copy[idx] = snap; return copy;
    }
    return snapshots.concat([snap]).sort(function (a, b) { return a.month < b.month ? -1 : 1; });
  }

  /** דמי ניהול שנתיים בשקלים לנכס (באגורות). */
  function annualFees(a) {
    return Math.round((a.balance || 0) * (a.feeAcc || 0) / 100 + (a.monthly || 0) * 12 * (a.feeDep || 0) / 100);
  }

  /* ===================== מס ===================== */

  /** מס רווח הון על הרווח הריאלי: rate × max(0, שווי − בסיס מוצמד). */
  function capitalGainsTax(value, basis, inflationFactor, rate) {
    var r = rate === undefined ? 0.25 : rate;
    var realGain = value - basis * (inflationFactor || 1);
    return realGain > 0 ? Math.round(realGain * r) : 0;
  }

  /* ===================== תחזית ===================== */

  function monthlyRate(annualPct) {
    var a = Math.max(-99, Number(annualPct) || 0) / 100;
    return Math.pow(1 + a, 1 / 12) - 1;
  }

  /**
   * תחזית צבירה חודש אחר חודש.
   * opts: accounts, years, startISO, inflation (% שנתי), returnAdj (נק' אחוז לתשואה), extraMonthly (אגורות),
   * flowMonthly (אגורות לחודש, שינוי בתזרים מהכנסות/הוצאות), indexDeposits, lifeEvents, settings, noFees, flowReturn.
   * החזר: { points: [...], final, totalDeposits, totalFees }.
   */
  function project(opts) {
    var accounts = (opts.accounts || []).filter(function (a) { return (a.balance || 0) > 0 || (a.monthly || 0) > 0; });
    var months = Math.max(1, Math.round((opts.years || 10) * 12));
    var start = opts.startISO;
    var settings = opts.settings || { age: 35, retireAge: 67 };
    var inflM = monthlyRate(opts.inflation || 0);
    var adj = Number(opts.returnAdj) || 0;
    var rnd = opts.randomReturns || null; // פונקציה (accountIdx, monthIdx) → תשואה חודשית (למונטה קרלו)
    var state = accounts.map(function (a) {
      return {
        a: a, bal: a.balance || 0, basis: a.balance || 0,
        rm: monthlyRate((Number(a.expReturn) || 0) + adj),
        feeM: opts.noFees ? 0 : (Number(a.feeAcc) || 0) / 100 / 12,
        feeDep: opts.noFees ? 0 : (Number(a.feeDep) || 0) / 100
      };
    });
    // דלי "תזרים": כסף נוסף (הפקדה נוספת, שינוי הכנסות/הוצאות, אירועי חיים). נזיל, חייב במס רווח הון.
    var flowRet = opts.flowReturn !== undefined ? opts.flowReturn : 4;
    var flow = { bal: 0, basis: 0, rm: monthlyRate(flowRet + adj) };
    var events = (opts.lifeEvents || []).filter(function (e) { return isValidISO(e.date); });
    var infl = 1, totalDep = 0, totalFees = 0;
    var points = [];
    var push = function (t, date) {
      if (opts.totalsOnly) { // מצב קל למונטה קרלו: רק סך נומינלי
        var tot = flow.bal;
        for (var k = 0; k < state.length; k++) tot += state[k].bal;
        points.push({ t: t, nominal: tot });
        return;
      }
      var nominal = flow.bal, liquid = flow.bal, locked = 0, afterTax = flow.bal - capitalGainsTax(flow.bal, flow.basis, 1);
      state.forEach(function (s) {
        nominal += s.bal;
        if (isLiquidAt(s.a, date, settings, start)) liquid += s.bal; else locked += s.bal;
        var tax = (s.a.tax === 'cgt') ? capitalGainsTax(s.bal, s.basis, 1) : 0;
        afterTax += s.bal - tax;
      });
      points.push({
        t: t, date: date, nominal: Math.round(nominal), real: Math.round(nominal / infl),
        liquid: Math.round(liquid), locked: Math.round(locked),
        liquidReal: Math.round(liquid / infl), lockedReal: Math.round(locked / infl),
        afterTax: Math.round(afterTax), afterTaxReal: Math.round(afterTax / infl),
        deposits: Math.round(totalDep), fees: Math.round(totalFees), infl: infl
      });
    };
    push(0, start);
    for (var t = 1; t <= months; t++) {
      var date = addMonths(start, t);
      var prevInfl = infl;
      infl = infl * (1 + inflM);
      var depIdx = opts.indexDeposits ? prevInfl : 1;
      var retired = ageAtDate(settings, start, date) >= (Number(settings.retireAge) || 67);
      state.forEach(function (s, i) {
        var r = rnd ? rnd(i, t, s.a) : s.rm;
        var dep = (s.a.monthly || 0) * depIdx;
        if (retired && (s.a.type === 'pension' || s.a.tax === 'pension')) dep = 0;
        var growth = s.bal * r;
        var fee = s.bal * s.feeM;
        var depFee = dep * s.feeDep;
        s.bal = s.bal + growth - fee + dep - depFee;
        if (s.bal < 0) s.bal = 0;
        s.basis = s.basis * (1 + inflM) + dep; // בסיס מוצמד למדד → מס על רווח ריאלי בלבד
        totalDep += dep; totalFees += fee + depFee;
      });
      // דלי התזרים
      var fdep = ((opts.extraMonthly || 0) + (opts.flowMonthly || 0)) * (opts.indexDeposits ? prevInfl : 1);
      events.forEach(function (e) {
        var amt = (e.amount || 0) * prevInfl; // סכומי אירועים במחירי היום
        if (e.type === 'oneoff') { if (date.slice(0, 7) === e.date.slice(0, 7)) fdep -= amt; }
        else if (e.type === 'income' && date >= e.date) fdep += amt;
        else if (e.type === 'expense' && date >= e.date) fdep -= amt;
      });
      var fr = rnd ? rnd(-1, t, null) : flow.rm;
      if (flow.bal > 0) flow.bal += flow.bal * fr;
      flow.bal += fdep;
      flow.basis = flow.basis * (1 + inflM) + fdep;
      if (flow.basis < 0) flow.basis = 0;
      totalDep += Math.max(0, fdep);
      push(t, date);
    }
    var last = points[points.length - 1];
    return { points: points, final: last, totalDeposits: Math.round(totalDep), totalFees: Math.round(totalFees) };
  }

  /** תרחישים מוכנים. returnAdj בנקודות אחוז ביחס לתשואה הצפויה של כל נכס. */
  function defaultScenarios(inflation) {
    var base = Number(inflation);
    if (!isFinite(base)) base = 2.5;
    return {
      pess: { name: 'פסימי', returnAdj: -2, inflation: 4, incomeChange: 0, expenseChange: 0, extraMonthly: 0 },
      base: { name: 'בסיסי', returnAdj: 0, inflation: base, incomeChange: 0, expenseChange: 0, extraMonthly: 0 },
      opt: { name: 'אופטימי', returnAdj: 1.5, inflation: 2, incomeChange: 0, expenseChange: 0, extraMonthly: 0 }
    };
  }

  /** ממיר תרחיש + בסיס חודשי לאופציות project(). */
  function scenarioToOptions(scn, baseline, common) {
    var flow = Math.round((baseline.income || 0) * (Number(scn.incomeChange) || 0) / 100 - (baseline.expense || 0) * (Number(scn.expenseChange) || 0) / 100);
    return Object.assign({}, common, {
      inflation: Number(scn.inflation) || 0,
      returnAdj: Number(scn.returnAdj) || 0,
      extraMonthly: scn.extraMonthly || 0,
      flowMonthly: flow
    });
  }

  /* ===================== מונטה קרלו ===================== */

  /** מחולל מספרים אקראיים דטרמיניסטי (mulberry32). */
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** נורמלי סטנדרטי (Box-Muller) מתוך מחולל אחיד. */
  function normalFrom(rng) {
    var u = 0, v = 0;
    while (u === 0) u = rng();
    while (v === 0) v = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  function percentile(sorted, p) {
    if (!sorted.length) return 0;
    var idx = (sorted.length - 1) * p;
    var lo = Math.floor(idx), hi = Math.ceil(idx);
    if (lo === hi) return sorted[lo];
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
  }

  /**
   * מונטה קרלו מחולק לשלבים (כדי לא לתקוע את הממשק).
   * תשואות חודשיות לוג-נורמליות לפי רמת הסיכון; זעזוע שוק משותף לכל הנכסים בכל חודש
   * (הנחה שמרנית של מתאם מלא). seed קבוע → אותם קלטים, אותה תוצאה.
   */
  function createMonteCarlo(opts) {
    var runs = opts.runs || 1000;
    var seed = opts.seed === undefined ? 20240601 : opts.seed;
    var rng = mulberry32(seed);
    var months = Math.max(1, Math.round((opts.years || 10) * 12));
    var adj = Number(opts.returnAdj) || 0;
    var totals = []; // לכל ריצה: מערך ערכים נומינליים לכל חודש
    var done = 0;
    var params = {}; // פרמטרים לוג-נורמליים לפי נכס
    function lnParams(expRet, sdPct) {
      var s = (sdPct / 100) / Math.sqrt(12);
      var mu = Math.log(1 + Math.max(-99, expRet) / 100) / 12 - (s * s) / 2;
      return { mu: mu, s: s };
    }
    var flowP = lnParams((opts.flowReturn !== undefined ? opts.flowReturn : 4) + adj, RISK_SD.medium);
    function step(n) {
      var target = Math.min(runs, done + (n || 100));
      for (; done < target; done++) {
        var zs = new Float64Array(months + 1);
        for (var m = 1; m <= months; m++) zs[m] = normalFrom(rng);
        var res = project(Object.assign({}, opts, {
          totalsOnly: true,
          randomReturns: function (i, t, a) {
            var p;
            if (i < 0) p = flowP;
            else {
              var key = a.id || i;
              if (!params[key]) {
                var sd = Number(a.sd) > 0 ? Number(a.sd) : (RISK_SD[a.risk] || RISK_SD.medium);
                if ((Number(a.expReturn) || 0) === 0 && a.type === 'checking') sd = 0;
                params[key] = lnParams((Number(a.expReturn) || 0) + adj, sd);
              }
              p = params[key];
            }
            return Math.exp(p.mu + p.s * zs[t]) - 1;
          }
        }));
        var arr = new Float64Array(res.points.length);
        for (var k = 0; k < res.points.length; k++) arr[k] = res.points[k].nominal;
        totals.push(arr);
      }
      return done >= runs;
    }
    function result() {
      var len = totals.length ? totals[0].length : 0;
      var inflM = monthlyRate(opts.inflation || 0);
      var out = { p10: [], p50: [], p90: [], p10Real: [], p50Real: [], p90Real: [], runs: totals.length, months: months };
      var col = new Float64Array(totals.length);
      for (var t = 0; t < len; t++) {
        for (var r = 0; r < totals.length; r++) col[r] = totals[r][t];
        var sorted = Array.prototype.slice.call(col).sort(function (a, b) { return a - b; });
        var f = Math.pow(1 + inflM, t);
        var p10 = percentile(sorted, 0.1), p50 = percentile(sorted, 0.5), p90 = percentile(sorted, 0.9);
        out.p10.push(Math.round(p10)); out.p50.push(Math.round(p50)); out.p90.push(Math.round(p90));
        out.p10Real.push(Math.round(p10 / f)); out.p50Real.push(Math.round(p50 / f)); out.p90Real.push(Math.round(p90 / f));
      }
      return out;
    }
    return { step: step, result: result, progress: function () { return done / runs; } };
  }

  function monteCarlo(opts) {
    var mc = createMonteCarlo(opts);
    while (!mc.step(250)) { /* ממשיכים */ }
    return mc.result();
  }

  /* ===================== FIRE ויעדים ===================== */

  /** יעד FIRE: הוצאה שנתית חלקי שיעור משיכה בטוח. */
  function fireTarget(annualExpense, swrPct) {
    var swr = Number(swrPct) > 0 ? Number(swrPct) : 4;
    return Math.round(annualExpense / (swr / 100));
  }

  /** הגיל שבו השווי הריאלי עובר את יעד ה-FIRE לפי תחזית. null אם לא בטווח. */
  function fireAge(points, target, currentAge) {
    for (var i = 0; i < points.length; i++) {
      if (points[i].real >= target) return { age: (Number(currentAge) || 0) + points[i].t / 12, months: points[i].t, date: points[i].date };
    }
    return null;
  }

  /** חודשים עד יעד בהינתן הפקדה חודשית ותשואה שנתית. null אם לא יגיע (עד 100 שנה). */
  function monthsToGoal(current, target, monthly, annualReturnPct) {
    if (current >= target) return 0;
    var r = monthlyRate(annualReturnPct || 0);
    if (!(monthly > 0) && !(r > 0 && current > 0)) return null;
    var bal = current;
    for (var m = 1; m <= 1200; m++) {
      bal = bal * (1 + r) + (monthly || 0);
      if (bal >= target) return m;
    }
    return null;
  }

  /** הפקדה חודשית נדרשת כדי להגיע ליעד בעוד n חודשים (נוסחת PMT). */
  function requiredMonthly(current, target, months, annualReturnPct) {
    if (current >= target) return 0;
    if (!(months > 0)) return Math.max(0, target - current);
    var r = monthlyRate(annualReturnPct || 0);
    if (Math.abs(r) < 1e-12) return Math.ceil((target - current) / months);
    var fvCurrent = current * Math.pow(1 + r, months);
    var need = target - fvCurrent;
    if (need <= 0) return 0;
    return Math.ceil(need * r / (Math.pow(1 + r, months) - 1));
  }

  /** שווי עתידי של הפקדה חודשית קבועה. */
  function futureValueMonthly(monthly, years, annualReturnPct) {
    var n = Math.round(years * 12), r = monthlyRate(annualReturnPct || 0);
    if (Math.abs(r) < 1e-12) return Math.round(monthly * n);
    return Math.round(monthly * (Math.pow(1 + r, n) - 1) / r);
  }

  function goalCurrent(goal, accounts) {
    if (goal.accountId) {
      var a = (accounts || []).filter(function (x) { return x.id === goal.accountId; })[0];
      if (a) return a.balance || 0;
    }
    return goal.saved || 0;
  }

  function goalMonthly(goal, accounts) {
    if (goal.monthly > 0) return goal.monthly;
    if (goal.accountId) {
      var a = (accounts || []).filter(function (x) { return x.id === goal.accountId; })[0];
      if (a) return a.monthly || 0;
    }
    return 0;
  }

  function goalReturn(goal, accounts) {
    if (goal.accountId) {
      var a = (accounts || []).filter(function (x) { return x.id === goal.accountId; })[0];
      if (a) return Number(a.expReturn) || 0;
    }
    return 0;
  }

  /** ניתוח יעד: התקדמות, תאריך הגעה צפוי, הפקדה נדרשת. */
  function analyzeGoal(goal, accounts, todayIso) {
    var cur = goalCurrent(goal, accounts);
    var monthly = goalMonthly(goal, accounts);
    var ret = goalReturn(goal, accounts);
    var pct = goal.target > 0 ? Math.min(100, (cur / goal.target) * 100) : 0;
    var m = monthsToGoal(cur, goal.target, monthly, ret);
    var eta = m === null ? null : addMonths(todayIso, m);
    var monthsLeft = goal.date ? Math.max(0, monthsBetween(todayIso, goal.date)) : null;
    var req = monthsLeft !== null ? requiredMonthly(cur, goal.target, monthsLeft, ret) : null;
    return {
      current: cur, monthly: monthly, pct: pct, reached: cur >= goal.target && goal.target > 0,
      monthsToGoal: m, eta: eta, monthsLeft: monthsLeft, required: req,
      onTrack: goal.date ? (eta !== null && eta <= goal.date) : null
    };
  }

  /** כמה דמי ניהול יעלו עד הפרישה: הפרש בין תחזית בלי דמי ניהול לתחזית איתם. */
  function feesUntilRetirement(accounts, settings, todayIso) {
    var years = Math.max(1, (Number(settings.retireAge) || 67) - (Number(settings.age) || 35));
    var common = { accounts: accounts, years: years, startISO: todayIso, inflation: 0, settings: settings };
    var withFees = project(common).final.nominal;
    var noFees = project(Object.assign({}, common, { noFees: true })).final.nominal;
    return { years: years, cost: Math.max(0, noFees - withFees) };
  }

  /* ===================== מנויים ותובנות ===================== */

  function normalizeDesc(s) {
    return String(s || '').toLowerCase().replace(/[0-9#*\-_.\/]+/g, ' ').replace(/\s+/g, ' ').trim();
  }

  /** זיהוי מנויים: סדרות בקטגוריית מנויים + תנועות שחוזרות בסכום דומה ב-3+ חודשים מתוך 6. */
  function detectSubscriptions(state, todayIso) {
    var cats = {};
    (state.categories || []).forEach(function (c) { cats[c.id] = c; });
    var out = [], seen = {};
    (state.series || []).forEach(function (s) {
      if (s.kind !== 'expense' || (s.endDate && s.endDate < todayIso)) return;
      var c = cats[s.categoryId];
      if (!c || !c.subscription) return;
      var monthly = Math.round(s.amount * monthlyFactor(s.freq));
      var name = s.note || s.sub || c.name;
      out.push({ name: name, monthly: monthly, annual: monthly * 12, source: 'series', id: s.id });
      seen[normalizeDesc(name)] = true;
    });
    var sd = state.settings ? state.settings.monthStartDay : 1;
    var curKey = finMonthKey(todayIso, sd);
    var minDate = finMonthRange(shiftMonthKey(curKey, -6), sd).start;
    var groups = {};
    (state.transactions || []).forEach(function (t) {
      if (t.kind !== 'expense' || t.seriesId || t.date < minDate) return;
      var k = normalizeDesc(t.note);
      if (k.length < 2) return;
      (groups[k] = groups[k] || []).push(t);
    });
    Object.keys(groups).forEach(function (k) {
      if (seen[k]) return;
      var g = groups[k];
      var months = {};
      g.forEach(function (t) { months[finMonthKey(t.date, sd)] = true; });
      var nMonths = Object.keys(months).length;
      if (nMonths < 3 || g.length > nMonths * 1.5) return;
      var amts = g.map(function (t) { return t.amount; }).sort(function (a, b) { return a - b; });
      var med = amts[Math.floor(amts.length / 2)];
      var similar = amts.every(function (a) { return Math.abs(a - med) <= med * 0.15; });
      if (!similar) return;
      out.push({ name: g[0].note, monthly: med, annual: med * 12, source: 'detected' });
    });
    return out.sort(function (a, b) { return b.annual - a.annual; });
  }

  /**
   * תובנות החודש: 3–5 משפטים שנוצרים מהנתונים. כל תובנה מוצגת רק כשיש מספיק נתונים.
   * מחזיר [{type, tone: 'good'|'warn'|'info', text, categoryId?}]
   */
  function generateInsights(state, todayIso) {
    var out = [];
    var sd = state.settings.monthStartDay;
    var key = finMonthKey(todayIso, sd);
    var cur = summarizeMonth(state.transactions, key, sd);
    var avg = averageMonths(state.transactions, key, 6, sd);
    var cats = {};
    state.categories.forEach(function (c) { cats[c.id] = c; });
    var F = function (a) { return formatILS(a); };

    // 1. קטגוריה מעל הממוצע (דורש 3 חודשי היסטוריה)
    if (avg.months >= 3) {
      var best = null;
      Object.keys(cur.byCategory).forEach(function (cid) {
        var a = avg.byCategory[cid] || 0, c = cur.byCategory[cid];
        if (a <= 0 || !cats[cid] || cats[cid].group === 'fixed') return;
        var diff = c - a;
        var pct = (diff / a) * 100;
        if (pct >= 20 && diff >= 20000 && (!best || diff > best.diff)) best = { cid: cid, pct: pct, diff: diff, c: c, a: a };
      });
      if (best) out.push({ type: 'overAvg', tone: 'warn', categoryId: best.cid, priority: 1,
        text: 'הוצאת ' + Math.round(best.pct) + '% יותר על ' + cats[best.cid].name + ' מהממוצע שלך (' + F(best.c) + ' מול ממוצע של ' + F(best.a) + ').' });
    }
    // 2. חריגות תקציב
    var over = budgetStatus(state.categories, state.transactions, key, sd).filter(function (b) { return b.status === 'over'; });
    if (over.length) out.push({ type: 'budget', tone: 'warn', priority: 2,
      text: over.length === 1 ? 'חרגת מהתקציב ב' + over[0].name + ' ב-' + F(over[0].spent - over[0].budget) + '.'
        : 'חרגת מהתקציב ב-' + over.length + ' קטגוריות: ' + over.map(function (o) { return o.name; }).join(', ') + '.' });
    // 3. מנויים
    var subs = detectSubscriptions(state, todayIso);
    if (subs.length) {
      var annual = subs.reduce(function (s, x) { return s + x.annual; }, 0);
      out.push({ type: 'subs', tone: 'info', priority: 4,
        text: 'המנויים שלך (' + subs.length + ') עולים ' + F(annual) + ' בשנה. שווה לעבור עליהם ולבטל את מה שלא בשימוש.' });
    }
    // 4. קיצוץ 10% מההוצאות הרצוניות
    var base = monthlyBaseline(state, todayIso);
    if (base.discretionary >= 30000) {
      var monthlyCut = Math.round(base.discretionary * 0.1);
      var fv = futureValueMonthly(monthlyCut, 10, 5);
      out.push({ type: 'cut10', tone: 'info', priority: 3,
        text: 'אם תקצץ 10% מההוצאות הרצוניות תחסוך ' + F(monthlyCut * 12) + ' בשנה, שהם כ-' + F(fv) + ' בעוד 10 שנים (בתשואה של 5%).' });
    }
    // 5. שיעור חיסכון לעומת הממוצע
    if (avg.months >= 2 && avg.income > 0) {
      var prev = summarizeMonth(state.transactions, shiftMonthKey(key, -1), sd);
      var avgRate = ((avg.income - avg.expense) / avg.income) * 100;
      if (prev.income > 0) {
        var d = prev.rate - avgRate;
        if (Math.abs(d) >= 3) out.push({ type: 'rate', tone: d > 0 ? 'good' : 'warn', priority: 5,
          text: 'בחודש שעבר חסכת ' + Math.round(prev.rate) + '% מההכנסה — ' + (d > 0 ? 'יותר' : 'פחות') + ' מהממוצע שלך (' + Math.round(avgRate) + '%).' });
      }
    }
    // 6. כרית ביטחון
    var liq = liquidAssets(state.accounts, state.settings, todayIso);
    var em = emergencyMonths(liq, base.essential);
    if (em !== null && (state.accounts || []).length) {
      if (em < 3) out.push({ type: 'emergency', tone: 'warn', priority: 2, text: 'כרית הביטחון שלך מכסה ' + em.toFixed(1) + ' חודשי הוצאות חיוניות. מומלץ לשאוף ל-3 עד 6 חודשים.' });
      else if (em >= 6) out.push({ type: 'emergency', tone: 'good', priority: 6, text: 'יש לך כרית ביטחון של ' + em.toFixed(1) + ' חודשים. כסף נזיל מעבר ל-6 חודשים יכול לעבוד בשבילך בהשקעה.' });
    }
    // 7. דמי ניהול גבוהים
    var high = (state.accounts || []).filter(function (a) { return (Number(a.feeAcc) || 0) > 0.8 && (a.balance || 0) > 1000000; })[0];
    if (high) out.push({ type: 'fees', tone: 'warn', priority: 3,
      text: 'דמי הניהול ב"' + high.name + '" (' + high.feeAcc + '% מהצבירה) גבוהים. משא ומתן יכול לחסוך ' + F(annualFees(high)) + ' בשנה.' });
    return out.sort(function (a, b) { return a.priority - b.priority; }).slice(0, 5);
  }

  /** סיכום סגירת חודש. */
  function monthCloseSummary(state, key) {
    var sd = state.settings.monthStartDay;
    var cur = summarizeMonth(state.transactions, key, sd);
    var prev = summarizeMonth(state.transactions, shiftMonthKey(key, -1), sd);
    var avg = averageMonths(state.transactions, key, 6, sd);
    var cats = {};
    state.categories.forEach(function (c) { cats[c.id] = c; });
    // 3 קטגוריות שחרגו: מול תקציב, ואם אין תקציב — מול הממוצע
    var overs = [];
    Object.keys(cur.byCategory).forEach(function (cid) {
      var c = cats[cid]; if (!c) return;
      var spent = cur.byCategory[cid];
      if (c.budget > 0 && spent > c.budget) overs.push({ categoryId: cid, name: c.name, icon: c.icon, spent: spent, ref: c.budget, refType: 'budget', diff: spent - c.budget });
      else if (!(c.budget > 0) && avg.byCategory[cid] > 0 && spent > avg.byCategory[cid] * 1.15 && c.group !== 'fixed')
        overs.push({ categoryId: cid, name: c.name, icon: c.icon, spent: spent, ref: avg.byCategory[cid], refType: 'avg', diff: spent - avg.byCategory[cid] });
    });
    overs.sort(function (a, b) { return b.diff - a.diff; });
    var avgRate = avg.income > 0 ? ((avg.income - avg.expense) / avg.income) * 100 : null;
    // הצעה לפעולה אחת
    var action;
    if (overs.length) action = 'הגדר לעצמך יעד להוריד את ההוצאה על ' + overs[0].name + ' ב-' + formatILS(Math.round(overs[0].diff / 2)) + ' בחודש הבא.';
    else if (cur.rate < 20 && cur.income > 0) action = 'נסה להגדיל את שיעור החיסכון ל-20%: עוד ' + formatILS(Math.max(0, Math.round(cur.income * 0.2 - cur.net))) + ' בחודש.';
    else if (cur.net > 0) action = 'כל הכבוד! שקול להעביר ' + formatILS(Math.round(cur.net * 0.5)) + ' מהעודף להשקעה ארוכת טווח או ליעד.';
    else action = 'עבור על ההוצאות הרצוניות ובחר אחת לוותר עליה בחודש הבא.';
    return { key: key, current: cur, previous: prev, average: avg, avgRate: avgRate, overs: overs.slice(0, 3), action: action };
  }

  /* ===================== CSV ===================== */

  /** פענוח CSV: תומך במרכאות, BOM, ומזהה מפריד (פסיק, נקודה-פסיק, טאב). */
  function parseCSV(text) {
    if (!text) return [];
    text = String(text).replace(/^﻿/, '');
    var firstLine = text.split(/\r?\n/)[0] || '';
    var counts = { ',': 0, ';': 0, '\t': 0 };
    var inQ = false;
    for (var i = 0; i < firstLine.length; i++) {
      var ch = firstLine[i];
      if (ch === '"') inQ = !inQ;
      else if (!inQ && counts[ch] !== undefined) counts[ch]++;
    }
    var delim = ',';
    if (counts[';'] > counts[delim]) delim = ';';
    if (counts['\t'] > counts[delim]) delim = '\t';
    var rows = [], row = [], field = '', q = false;
    for (var j = 0; j < text.length; j++) {
      var c = text[j];
      if (q) {
        if (c === '"') { if (text[j + 1] === '"') { field += '"'; j++; } else q = false; }
        else field += c;
      } else if (c === '"') q = true;
      else if (c === delim) { row.push(field); field = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[j + 1] === '\n') j++;
        row.push(field); field = '';
        if (row.some(function (f) { return f.trim() !== ''; })) rows.push(row);
        row = [];
      } else field += c;
    }
    row.push(field);
    if (row.some(function (f) { return f.trim() !== ''; })) rows.push(row);
    return rows.map(function (r) { return r.map(function (f) { return f.trim(); }); });
  }

  /** מזהה תאריך בפורמטים נפוצים: DD/MM/YYYY, DD.MM.YY, YYYY-MM-DD. */
  function parseDateFlexible(s) {
    s = String(s || '').trim();
    var m = s.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})/);
    if (m) { var iso = makeISO(+m[1], +m[2], +m[3]); return isValidISO(iso) ? iso : null; }
    m = s.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2,4})/);
    if (m) {
      var y = +m[3]; if (y < 100) y += 2000;
      var iso2 = makeISO(y, +m[2], +m[1]);
      return isValidISO(iso2) ? iso2 : null;
    }
    return null;
  }

  /** חתימה לזיהוי כפילויות: תאריך + סכום + תיאור מנורמל. */
  function txSignature(t) { return t.date + '|' + Math.abs(t.amount) + '|' + normalizeDesc(t.note).slice(0, 20); }

  /** מסמן כפילויות מול תנועות קיימות ובתוך הייבוא עצמו. */
  function markDuplicates(incoming, existing) {
    var sigs = {};
    var loose = {};
    (existing || []).forEach(function (t) { sigs[txSignature(t)] = true; loose[t.date + '|' + t.amount] = true; });
    var inBatch = {};
    return incoming.map(function (t) {
      var s = txSignature(t);
      var dup = !!sigs[s] || !!inBatch[s];
      var possible = !dup && !!loose[t.date + '|' + t.amount];
      inBatch[s] = true;
      return Object.assign({}, t, { duplicate: dup, possibleDuplicate: possible });
    });
  }

  /** ממיר שורות CSV לתנועות לפי מיפוי עמודות. */
  function csvToTransactions(rows, mapping, opts) {
    opts = opts || {};
    var start = mapping.hasHeader ? 1 : 0;
    var out = [], errors = [];
    for (var i = start; i < rows.length; i++) {
      var r = rows[i];
      var date = parseDateFlexible(r[mapping.date]);
      var amt;
      if (mapping.debit !== undefined && mapping.debit !== null && mapping.debit !== '' && mapping.credit !== undefined && mapping.credit !== null && mapping.credit !== '') {
        var deb = toAgorot(r[mapping.debit] || '0'), cred = toAgorot(r[mapping.credit] || '0');
        if (isNaN(deb)) deb = 0; if (isNaN(cred)) cred = 0;
        amt = cred - deb;
      } else {
        amt = toAgorot(r[mapping.amount]);
        if (!isNaN(amt) && opts.expensesPositive) amt = -amt; // בחברות אשראי חיובי = חיוב
      }
      if (!date || isNaN(amt) || amt === 0) { errors.push(i + 1); continue; }
      out.push({
        date: date, amount: Math.abs(amt), kind: amt < 0 ? 'expense' : 'income',
        note: mapping.desc !== undefined && mapping.desc !== null && mapping.desc !== '' ? (r[mapping.desc] || '') : ''
      });
    }
    return { transactions: out, errors: errors };
  }

  function toCSV(rows) {
    return '﻿' + rows.map(function (r) {
      return r.map(function (v) {
        var s = v === null || v === undefined ? '' : String(v);
        return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      }).join(',');
    }).join('\r\n');
  }

  /* ===================== סכמה, מיגרציה, ולידציה ===================== */

  var DEFAULT_CATEGORIES = [
    // הכנסות
    ['inc_salary', 'income', 'משכורת', null, '💼', '#16a34a'],
    ['inc_bonus', 'income', 'בונוס', null, '🎁', '#22c55e'],
    ['inc_freelance', 'income', 'פרילנס', null, '🧑‍💻', '#0d9488'],
    ['inc_gift', 'income', 'מתנה', null, '🎀', '#84cc16'],
    ['inc_taxrefund', 'income', 'החזר מס', null, '🧾', '#10b981'],
    ['inc_other', 'income', 'הכנסה אחרת', null, '💰', '#65a30d'],
    // קבועות
    ['exp_housing', 'expense', 'דיור (שכירות/משכנתא)', 'fixed', '🏠', '#6366f1', true],
    ['exp_arnona', 'expense', 'ארנונה', 'fixed', '🏛️', '#8b5cf6', true],
    ['exp_utilities', 'expense', 'חשמל, מים וגז', 'fixed', '💡', '#a855f7', true],
    ['exp_insurance', 'expense', 'ביטוחים', 'fixed', '🛡️', '#7c3aed', true],
    ['exp_comm', 'expense', 'תקשורת', 'fixed', '📱', '#4f46e5', true],
    ['exp_subs', 'expense', 'מנויים', 'fixed', '📺', '#ec4899', false, true],
    ['exp_classes', 'expense', 'חוגים', 'fixed', '🎨', '#d946ef', false],
    ['exp_education', 'expense', 'גן וחינוך', 'fixed', '🎒', '#c026d3', true],
    ['exp_loans', 'expense', 'הלוואות', 'fixed', '💳', '#64748b', true],
    // שוטפות
    ['exp_grocery', 'expense', 'סופר', 'variable', '🛒', '#f59e0b', true],
    ['exp_fuel', 'expense', 'דלק', 'variable', '⛽', '#f97316', true],
    ['exp_dining', 'expense', 'מסעדות ובתי קפה', 'variable', '🍽️', '#ef4444', false],
    ['exp_transport', 'expense', 'תחבורה', 'variable', '🚌', '#0ea5e9', true],
    ['exp_health', 'expense', 'בריאות', 'variable', '💊', '#14b8a6', true],
    ['exp_clothing', 'expense', 'ביגוד והנעלה', 'variable', '👕', '#e11d48', false],
    ['exp_leisure', 'expense', 'פנאי ובילויים', 'variable', '🎬', '#f43f5e', false],
    ['exp_home', 'expense', 'בית ותחזוקה', 'variable', '🧹', '#a16207', true],
    // מזדמנות
    ['exp_vacation', 'expense', 'חופשה', 'occasional', '✈️', '#06b6d4', false],
    ['exp_carrepair', 'expense', 'תיקון רכב', 'occasional', '🔧', '#78716c', true],
    ['exp_gifts', 'expense', 'מתנות', 'occasional', '🎁', '#db2777', false],
    ['exp_appliances', 'expense', 'מכשירי חשמל', 'occasional', '🔌', '#475569', false],
    ['exp_other', 'expense', 'אחר', 'occasional', '📦', '#94a3b8', false]
  ];

  function defaultCategories() {
    return DEFAULT_CATEGORIES.map(function (c) {
      return { id: c[0], kind: c[1], name: c[2], group: c[3], icon: c[4], color: c[5], essential: !!c[6], subscription: !!c[7], budget: 0 };
    });
  }

  function defaultSettings() {
    return { monthStartDay: 1, inflation: 2.5, age: 35, retireAge: 67, theme: 'auto', lockMinutes: 10, swr: 4, flowReturn: 4 };
  }

  function createEmptyState(todayIso) {
    return {
      schemaVersion: SCHEMA_VERSION,
      meta: { createdAt: todayIso || null, lastBackupAt: null, demo: false, lastCloseSeen: null, onboarded: false, lastCategory: {} },
      settings: defaultSettings(),
      categories: defaultCategories(),
      series: [], transactions: [], accounts: [], liabilities: [], goals: [],
      snapshots: [], lifeEvents: [], scenarios: defaultScenarios(2.5)
    };
  }

  /** מיגרציות: MIGRATIONS[n] ממיר מגרסה n לגרסה n+1. */
  var MIGRATIONS = {
    0: function (s) {
      // גרסה 0 (ללא schemaVersion): משלימים שדות חסרים
      var base = createEmptyState(null);
      var out = Object.assign({}, base, s);
      out.settings = Object.assign({}, base.settings, s.settings || {});
      out.meta = Object.assign({}, base.meta, s.meta || {});
      ['series', 'transactions', 'accounts', 'liabilities', 'goals', 'snapshots', 'lifeEvents'].forEach(function (k) { if (!Array.isArray(out[k])) out[k] = []; });
      if (!Array.isArray(out.categories) || !out.categories.length) out.categories = defaultCategories();
      if (!out.scenarios) out.scenarios = defaultScenarios(out.settings.inflation);
      out.schemaVersion = 1;
      return out;
    }
  };

  function migrate(state) {
    if (!state || typeof state !== 'object') throw new Error('מבנה נתונים לא תקין');
    var s = state;
    var v = typeof s.schemaVersion === 'number' ? s.schemaVersion : 0;
    if (v > SCHEMA_VERSION) throw new Error('הקובץ נוצר בגרסה חדשה יותר של האפליקציה (' + v + '). עדכן את האפליקציה.');
    while (v < SCHEMA_VERSION) {
      if (!MIGRATIONS[v]) throw new Error('אין מיגרציה מגרסה ' + v);
      s = MIGRATIONS[v](s);
      v = s.schemaVersion;
    }
    return s;
  }

  /** בדיקת מבנה של state מפוענח (לפני שדורסים משהו). מחזיר רשימת שגיאות. */
  function validateState(s) {
    var errs = [];
    if (!s || typeof s !== 'object') return ['הנתונים אינם אובייקט'];
    ['transactions', 'series', 'accounts', 'categories'].forEach(function (k) {
      if (s[k] !== undefined && !Array.isArray(s[k])) errs.push('השדה ' + k + ' אינו רשימה');
    });
    (s.transactions || []).slice(0, 5000).forEach(function (t, i) {
      if (errs.length > 10) return;
      if (!t || typeof t.id !== 'string') errs.push('תנועה ' + (i + 1) + ': חסר מזהה');
      else if (!Number.isInteger(t.amount)) errs.push('תנועה ' + (i + 1) + ': סכום לא תקין');
      else if (!isValidISO(t.date)) errs.push('תנועה ' + (i + 1) + ': תאריך לא תקין');
    });
    return errs;
  }

  /** בדיקת מעטפת קובץ גיבוי מוצפן. */
  function validateBackupEnvelope(obj) {
    if (!obj || typeof obj !== 'object') return { ok: false, error: 'הקובץ אינו JSON תקין' };
    if (obj.format !== BACKUP_FORMAT) return { ok: false, error: 'זה לא קובץ גיבוי של מצפן כספי' };
    if (typeof obj.schemaVersion !== 'number') return { ok: false, error: 'חסרה גרסת סכמה בקובץ' };
    if (obj.schemaVersion > SCHEMA_VERSION) return { ok: false, error: 'הגיבוי נוצר בגרסה חדשה יותר של האפליקציה' };
    if (!obj.kdf || typeof obj.kdf.salt !== 'string' || !(obj.kdf.iterations >= 100000)) return { ok: false, error: 'פרטי ההצפנה בקובץ חסרים או פגומים' };
    if (typeof obj.iv !== 'string' || typeof obj.data !== 'string') return { ok: false, error: 'תוכן מוצפן חסר' };
    return { ok: true };
  }

  /* ---------- ולידציית טפסים (הודעות בעברית) ---------- */

  function validateAmount(a, errs, field, opts) {
    opts = opts || {};
    if (a === null || a === undefined || (typeof a === 'number' && isNaN(a))) errs[field] = 'יש להזין סכום תקין';
    else if (a < 0) errs[field] = 'הסכום לא יכול להיות שלילי';
    else if (a === 0 && !opts.allowZero) errs[field] = 'הסכום חייב להיות גדול מאפס';
    else if (a > 100000000000) errs[field] = 'הסכום גדול מדי';
  }

  function validatePct(v, errs, field, min, max) {
    if (v === '' || v === null || v === undefined || isNaN(Number(v))) { errs[field] = 'יש להזין אחוז'; return; }
    v = Number(v);
    if (v < min || v > max) errs[field] = 'ערך בין ' + min + '% ל-' + max + '%';
  }

  function validateTx(t) {
    var e = {};
    validateAmount(t.amount, e, 'amount');
    if (!isValidISO(t.date)) e.date = 'יש לבחור תאריך תקין';
    if (!t.categoryId) e.categoryId = 'יש לבחור קטגוריה';
    if (t.freq && t.freq !== 'once') {
      if (!FREQ_STEP[t.freq]) e.freq = 'תדירות לא תקינה';
      if (t.endDate && !isValidISO(t.endDate)) e.endDate = 'תאריך סיום לא תקין';
      else if (t.endDate && t.endDate < t.date) e.endDate = 'תאריך הסיום לפני תאריך ההתחלה';
    }
    if (t.note && t.note.length > 200) e.note = 'הערה ארוכה מדי (עד 200 תווים)';
    return e;
  }

  function validateAccount(a) {
    var e = {};
    if (!a.name || !a.name.trim()) e.name = 'יש להזין שם';
    if (!ACCOUNT_TYPES[a.type]) e.type = 'יש לבחור סוג';
    validateAmount(a.balance, e, 'balance', { allowZero: true });
    validateAmount(a.monthly, e, 'monthly', { allowZero: true });
    validatePct(a.expReturn, e, 'expReturn', -50, 50);
    validatePct(a.feeAcc, e, 'feeAcc', 0, 5);
    validatePct(a.feeDep, e, 'feeDep', 0, 10);
    if (a.liquidDate && !isValidISO(a.liquidDate)) e.liquidDate = 'תאריך לא תקין';
    return e;
  }

  function validateLiability(l) {
    var e = {};
    if (!l.name || !l.name.trim()) e.name = 'יש להזין שם';
    validateAmount(l.balance, e, 'balance', { allowZero: true });
    validateAmount(l.payment, e, 'payment', { allowZero: true });
    validatePct(l.rate, e, 'rate', 0, 40);
    if (l.endDate && !isValidISO(l.endDate)) e.endDate = 'תאריך לא תקין';
    return e;
  }

  function validateGoal(g, todayIso) {
    var e = {};
    if (!g.name || !g.name.trim()) e.name = 'יש להזין שם';
    validateAmount(g.target, e, 'target');
    if (!g.accountId) validateAmount(g.saved, e, 'saved', { allowZero: true });
    if (g.monthly !== undefined) validateAmount(g.monthly, e, 'monthly', { allowZero: true });
    if (g.date && !isValidISO(g.date)) e.date = 'תאריך לא תקין';
    else if (g.date && todayIso && g.date < todayIso) e.date = 'תאריך היעד כבר עבר';
    return e;
  }

  function validateEvent(ev) {
    var e = {};
    if (!ev.name || !ev.name.trim()) e.name = 'יש להזין שם';
    validateAmount(ev.amount, e, 'amount');
    if (!isValidISO(ev.date)) e.date = 'יש לבחור תאריך תקין';
    return e;
  }

  /** מד חוזק סיסמה: 0 (חלשה מאוד) עד 4 (חזקה מאוד). */
  function passwordStrength(pw) {
    pw = pw || '';
    var score = 0;
    if (pw.length >= 8) score++;
    if (pw.length >= 12) score++;
    var classes = 0;
    if (/[a-z]/.test(pw)) classes++;
    if (/[A-Z]/.test(pw)) classes++;
    if (/\d/.test(pw)) classes++;
    if (/[^A-Za-z0-9]/.test(pw)) classes++;
    if (classes >= 2) score++;
    if (classes >= 3 && pw.length >= 10) score++;
    if (/^(.)\1+$/.test(pw) || /^(1234|password|qwerty|abcd|1111)/i.test(pw)) score = Math.min(score, 1);
    if (pw.length < 8) score = Math.min(score, 1);
    score = Math.min(4, score);
    return { score: score, label: ['חלשה מאוד', 'חלשה', 'בינונית', 'חזקה', 'חזקה מאוד'][score] };
  }

  /* ===================== נתוני דמו ===================== */

  /** נתוני דמו ריאליסטיים של משק בית ישראלי, 12 חודשי היסטוריה. דטרמיניסטי. */
  function generateDemo(todayIso) {
    var rng = mulberry32(7);
    var rint = function (a, b) { return Math.round(a + rng() * (b - a)); };
    var ag = function (sh) { return Math.round(sh * 100); };
    var state = createEmptyState(todayIso);
    state.meta.demo = true; state.meta.onboarded = true;
    state.settings.age = 36; state.settings.retireAge = 67;
    var start = addMonths(todayIso.slice(0, 7) + '-01', -12);
    var S = function (id, kind, amount, freq, day, cat, extra) {
      var startDate = addMonths(start, 0, day);
      return Object.assign({ id: 'demo_' + id, kind: kind, amount: ag(amount), freq: freq, startDate: startDate, endDate: null,
        categoryId: cat, sub: '', payment: 'הוראת קבע', essential: kind === 'expense', note: '', group: kind === 'expense' ? 'fixed' : null,
        incomeType: kind === 'income' ? 'fixed' : null, skips: [], demo: true }, extra || {});
    };
    state.series = [
      S('sal1', 'income', 16450, 'monthly', 10, 'inc_salary', { note: 'משכורת — נועה', payment: 'העברה בנקאית' }),
      S('sal2', 'income', 11200, 'monthly', 1, 'inc_salary', { note: 'משכורת — איתי', payment: 'העברה בנקאית' }),
      S('rent', 'expense', 6200, 'monthly', 1, 'exp_housing', { note: 'שכירות' }),
      S('arnona', 'expense', 790, 'bimonthly', 15, 'exp_arnona', { note: 'ארנונה' }),
      S('elec', 'expense', 640, 'bimonthly', 20, 'exp_utilities', { note: 'חשמל' }),
      S('ins', 'expense', 245, 'monthly', 5, 'exp_insurance', { note: 'ביטוח בריאות משלים', payment: 'אשראי' }),
      S('carins', 'expense', 3650, 'yearly', 3, 'exp_insurance', { note: 'ביטוח רכב', payment: 'אשראי' }),
      S('cell', 'expense', 229, 'monthly', 8, 'exp_comm', { note: 'סלולר ואינטרנט', payment: 'אשראי' }),
      S('netflix', 'expense', 54.9, 'monthly', 12, 'exp_subs', { note: 'נטפליקס', payment: 'אשראי', essential: false }),
      S('spotify', 'expense', 34.9, 'monthly', 12, 'exp_subs', { note: 'ספוטיפיי משפחתי', payment: 'אשראי', essential: false }),
      S('gym', 'expense', 249, 'monthly', 2, 'exp_subs', { note: 'חדר כושר', payment: 'אשראי', essential: false }),
      S('class', 'expense', 380, 'monthly', 4, 'exp_classes', { note: 'חוג כדורגל', payment: 'אשראי', essential: false }),
      S('gan', 'expense', 2950, 'monthly', 1, 'exp_education', { note: 'גן' }),
      S('loan', 'expense', 1450, 'monthly', 10, 'exp_loans', { note: 'הלוואת רכב' })
    ];
    var tx = [];
    var n = 0;
    var T = function (date, kind, amount, cat, note, extra) {
      if (date > todayIso) return;
      tx.push(Object.assign({ id: 'demo_t' + (n++), kind: kind, amount: ag(amount), date: date, categoryId: cat, sub: '', payment: 'אשראי',
        essential: false, note: note || '', group: null, incomeType: kind === 'income' ? 'variable' : null, demo: true }, extra || {}));
    };
    var cats = {};
    state.categories.forEach(function (c) { cats[c.id] = c; });
    var E = function (date, amount, cat, note, payment) {
      T(date, 'expense', amount, cat, note, { essential: cats[cat].essential, group: cats[cat].group, payment: payment || 'אשראי' });
    };
    var shops = ['שופרסל', 'רמי לוי', 'ויקטורי', 'יוחננוף'];
    var rest = ['קפה גרג', 'ארומה', 'פיצה', 'סושי', 'מסעדה איטלקית', 'המבורגר', 'ארוחת שישי בחוץ'];
    for (var mi = 0; mi <= 12; mi++) {
      var mStart = addMonths(start, mi);
      var y = parseISO(mStart).y, mo = parseISO(mStart).m, dim = daysInMonth(y, mo);
      var D = function (d) { return makeISO(y, mo, Math.min(d, dim)); };
      // סופר — 4-5 קניות
      var k = rint(4, 5);
      for (var i = 0; i < k; i++) E(D(2 + i * 6 + rint(0, 3)), rint(420, 880), 'exp_grocery', shops[rint(0, 3)]);
      // דלק
      for (i = 0; i < rint(2, 3); i++) E(D(5 + i * 9 + rint(0, 4)), rint(240, 340), 'exp_fuel', 'פז');
      // מסעדות — עונתיות: יותר בחודש הנוכחי כדי להציג תובנה
      var nR = mi === 12 ? 6 : rint(3, 5);
      for (i = 0; i < nR; i++) E(D(3 + i * 4 + rint(0, 3)), rint(85, mi === 12 ? 420 : 340), 'exp_dining', rest[rint(0, rest.length - 1)]);
      // תחבורה
      E(D(rint(1, 28)), rint(60, 160), 'exp_transport', 'רב-קו');
      // בריאות / ביגוד / פנאי / בית
      if (rng() < 0.55) E(D(rint(1, 28)), rint(60, 380), 'exp_health', 'סופר-פארם');
      if (rng() < 0.5) E(D(rint(1, 28)), rint(150, 650), 'exp_clothing', 'קסטרו');
      for (i = 0; i < rint(1, 3); i++) E(D(rint(1, 28)), rint(80, 320), 'exp_leisure', ['סינמה סיטי', 'הופעה', 'פארק', 'ספרים'][rint(0, 3)]);
      if (rng() < 0.6) E(D(rint(1, 28)), rint(90, 420), 'exp_home', 'ACE');
      // מזדמנות
      if (mo === 8) E(D(14), 8400, 'exp_vacation', 'חופשה ביוון');
      if (mo === 4) E(D(9), 1850, 'exp_gifts', 'מתנות לפסח');
      if (mo === 9) E(D(20), 1250, 'exp_gifts', 'מתנות לראש השנה');
      if (mi === 5) E(D(17), 2140, 'exp_carrepair', 'מוסך — טיפול 60 אלף');
      if (mi === 9) E(D(11), 3290, 'exp_appliances', 'מכונת כביסה');
      // הכנסות לא קבועות
      if (mo === 3) T(D(10), 'income', 8000, 'inc_bonus', 'בונוס שנתי');
      if (mo === 5) T(D(22), 'income', 2380, 'inc_taxrefund', 'החזר מס');
      if (mi % 3 === 1) T(D(25), 'income', rint(1200, 2200), 'inc_freelance', 'פרויקט עיצוב');
    }
    state.transactions = materializeRecurring(state.series, tx, todayIso).transactions;
    // תקציבים
    var budgets = { exp_grocery: 3200, exp_fuel: 800, exp_dining: 1100, exp_transport: 300, exp_health: 350, exp_clothing: 500, exp_leisure: 600, exp_home: 400 };
    state.categories.forEach(function (c) { if (budgets[c.id]) { c.budget = ag(budgets[c.id]); c.demoBudget = true; } });
    // נכסים
    var A = function (id, name, type, balance, monthly, ret, feeAcc, feeDep, risk, tax, liquidDate) {
      return { id: 'demo_' + id, name: name, type: type, balance: ag(balance), monthly: ag(monthly), expReturn: ret, feeAcc: feeAcc, feeDep: feeDep,
        risk: risk, sd: RISK_SD[risk], tax: tax, liquidDate: liquidDate || '', history: [], demo: true };
    };
    state.accounts = [
      A('chk', 'עו"ש בנק הפועלים', 'checking', 14800, 0, 0, 0, 0, 'low', 'exempt'),
      A('mmf', 'קרן כספית', 'mmf', 38000, 1000, 4.2, 0.25, 0, 'low', 'cgt'),
      A('hish', 'קרן השתלמות — מסלול מנייתי', 'hishtalmut', 146000, 1900, 6.5, 0.6, 0, 'medium', 'exempt', addMonths(todayIso, 20)),
      A('gemel', 'קופת גמל להשקעה', 'gemel', 41000, 500, 6, 0.65, 0, 'medium', 'cgt'),
      A('pension', 'קרן פנסיה מקיפה', 'pension', 318000, 3450, 5.5, 0.22, 1.49, 'medium', 'pension'),
      A('etf', 'תיק קרנות סל — S&P 500', 'stocks', 72000, 1500, 7.5, 0.1, 0, 'high', 'cgt'),
      A('crypto', 'ביטקוין', 'crypto', 6500, 0, 8, 0, 0, 'high', 'cgt')
    ];
    // היסטוריית שווי: אחורה בזמן לפי הפקדות ותשואה
    state.accounts.forEach(function (a) {
      var bal = a.balance, rm = monthlyRate(a.expReturn);
      var hist = [];
      for (var i = 0; i <= 12; i++) {
        var d = addMonths(todayIso.slice(0, 7) + '-01', -i);
        hist.unshift({ date: d, balance: Math.round(bal) });
        var noise = a.risk === 'high' ? (rng() - 0.45) * 0.06 : a.risk === 'medium' ? (rng() - 0.45) * 0.02 : 0;
        bal = Math.max(0, (bal - a.monthly) / (1 + rm + noise));
      }
      hist[hist.length - 1] = { date: todayIso, balance: a.balance };
      a.history = hist;
    });
    state.liabilities = [{ id: 'demo_carloan', name: 'הלוואת רכב', balance: ag(38500), rate: 5.9, payment: ag(1450), endDate: addMonths(todayIso, 28), demo: true }];
    // צילומי שווי נקי היסטוריים
    state.snapshots = [];
    for (var s = 12; s >= 1; s--) {
      var md = addMonths(todayIso.slice(0, 7) + '-01', -s);
      var assets = 0;
      state.accounts.forEach(function (a) { var h = a.history[12 - s]; assets += h ? h.balance : 0; });
      var liab = ag(38500) + s * ag(1260);
      state.snapshots.push({ month: md.slice(0, 7), date: md, assets: assets, liabilities: liab, net: assets - liab, demo: true });
    }
    state.snapshots = ensureSnapshot(state.snapshots, state.accounts, state.liabilities, todayIso);
    state.goals = [
      { id: 'demo_g1', name: 'קרן חירום', target: ag(50000), date: addMonths(todayIso, 14), accountId: 'demo_mmf', saved: 0, monthly: 0, priority: 1, celebrated: false, demo: true },
      { id: 'demo_g2', name: 'הון עצמי לדירה', target: ag(450000), date: addMonths(todayIso, 72), accountId: 'demo_etf', saved: 0, monthly: ag(3500), priority: 2, celebrated: false, demo: true },
      { id: 'demo_g3', name: 'חופשה ביפן', target: ag(24000), date: addMonths(todayIso, 10), accountId: null, saved: ag(9600), monthly: ag(1500), priority: 3, celebrated: false, demo: true }
    ];
    state.lifeEvents = [
      { id: 'demo_e1', name: 'העלאה במשכורת', type: 'income', amount: ag(1500), date: addMonths(todayIso, 5), demo: true },
      { id: 'demo_e2', name: 'החלפת רכב', type: 'oneoff', amount: ag(95000), date: addMonths(todayIso, 40), demo: true },
      { id: 'demo_e3', name: 'ילד שני', type: 'expense', amount: ag(2500), date: addMonths(todayIso, 18), demo: true }
    ];
    return state;
  }

  /** מסיר את כל פריטי הדמו ומשאיר נתונים שהמשתמש הוסיף. */
  function removeDemo(state) {
    var keep = function (x) { return !x.demo && !(typeof x.id === 'string' && x.id.indexOf('demo_') === 0); };
    var out = Object.assign({}, state);
    ['series', 'transactions', 'accounts', 'liabilities', 'goals', 'lifeEvents', 'snapshots'].forEach(function (k) {
      out[k] = (state[k] || []).filter(function (x) { return k === 'snapshots' ? !x.demo : keep(x); });
    });
    out.transactions = out.transactions.filter(function (t) { return !(t.seriesId && t.seriesId.indexOf('demo_') === 0); });
    out.categories = (state.categories || []).map(function (c) { return c.demoBudget ? Object.assign({}, c, { budget: 0, demoBudget: false }) : c; });
    out.meta = Object.assign({}, state.meta, { demo: false });
    return out;
  }

  /* ===================== כלים ===================== */

  var _idc = 0;
  function uid(prefix) {
    _idc = (_idc + 1) % 1e6;
    return (prefix || 'id') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8) + _idc.toString(36);
  }

  return {
    SCHEMA_VERSION: SCHEMA_VERSION, BACKUP_FORMAT: BACKUP_FORMAT,
    FREQ_STEP: FREQ_STEP, FREQ_LABEL: FREQ_LABEL, RISK_SD: RISK_SD, ACCOUNT_TYPES: ACCOUNT_TYPES, HE_MONTHS: HE_MONTHS,
    // כסף
    toAgorot: toAgorot, toShekels: toShekels, formatILS: formatILS, formatPct: formatPct,
    // תאריכים
    pad: pad, isLeap: isLeap, daysInMonth: daysInMonth, isValidISO: isValidISO, parseISO: parseISO, makeISO: makeISO,
    todayISO: todayISO, addMonths: addMonths, addDays: addDays, daysBetween: daysBetween, monthsBetween: monthsBetween,
    finMonthKey: finMonthKey, finMonthRange: finMonthRange, shiftMonthKey: shiftMonthKey, lastMonthKeys: lastMonthKeys,
    monthLabel: monthLabel, formatDateHe: formatDateHe,
    // חוזרות
    monthlyFactor: monthlyFactor, occurrenceDates: occurrenceDates, occurrenceId: occurrenceId,
    materializeRecurring: materializeRecurring, deleteOccurrence: deleteOccurrence, splitSeries: splitSeries,
    // סיכומים
    txInMonth: txInMonth, summarizeMonth: summarizeMonth, monthlyHistory: monthlyHistory, averageMonths: averageMonths,
    seriesMonthlyTotals: seriesMonthlyTotals, monthlyBaseline: monthlyBaseline, budgetStatus: budgetStatus, rule503020: rule503020,
    // נכסים
    isLiquidAt: isLiquidAt, netWorth: netWorth, liquidAssets: liquidAssets, emergencyMonths: emergencyMonths,
    ensureSnapshot: ensureSnapshot, annualFees: annualFees, feesUntilRetirement: feesUntilRetirement,
    // מס ותחזית
    capitalGainsTax: capitalGainsTax, monthlyRate: monthlyRate, project: project, defaultScenarios: defaultScenarios,
    scenarioToOptions: scenarioToOptions, mulberry32: mulberry32, normalFrom: normalFrom, percentile: percentile,
    createMonteCarlo: createMonteCarlo, monteCarlo: monteCarlo,
    fireTarget: fireTarget, fireAge: fireAge, monthsToGoal: monthsToGoal, requiredMonthly: requiredMonthly,
    futureValueMonthly: futureValueMonthly, analyzeGoal: analyzeGoal,
    // תובנות
    detectSubscriptions: detectSubscriptions, generateInsights: generateInsights, monthCloseSummary: monthCloseSummary,
    // CSV
    parseCSV: parseCSV, parseDateFlexible: parseDateFlexible, csvToTransactions: csvToTransactions, markDuplicates: markDuplicates, toCSV: toCSV,
    // סכמה
    defaultCategories: defaultCategories, defaultSettings: defaultSettings, createEmptyState: createEmptyState,
    migrate: migrate, validateState: validateState, validateBackupEnvelope: validateBackupEnvelope,
    validateTx: validateTx, validateAccount: validateAccount, validateLiability: validateLiability, validateGoal: validateGoal,
    validateEvent: validateEvent, passwordStrength: passwordStrength,
    generateDemo: generateDemo, removeDemo: removeDemo, uid: uid
  };
});
