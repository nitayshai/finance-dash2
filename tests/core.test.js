// בדיקות ל-core.js. הרצה: node --test tests/
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../core.js');

const series = (o) => Object.assign({ id: 's1', kind: 'expense', amount: 10000, freq: 'monthly', startDate: '2024-01-15', endDate: null, categoryId: 'exp_housing', skips: [] }, o);

/* ---------- כסף ---------- */
test('toAgorot: מספרים ומחרוזות, כולל עיגול נכון של 1.005', () => {
  assert.equal(C.toAgorot(12.34), 1234);
  assert.equal(C.toAgorot('1,234.56'), 123456);
  assert.equal(C.toAgorot('₪ 2,500'), 250000);
  assert.equal(C.toAgorot('1.005'), 101);
  assert.equal(C.toAgorot(0.1 + 0.2), 30);
  assert.equal(C.toAgorot('(150.00)'), -15000);
  assert.equal(C.toAgorot('-99.9'), -9990);
  assert.equal(C.toAgorot('120-'), -12000);
});

test('toAgorot: קלט לא תקין מחזיר NaN', () => {
  assert.ok(Number.isNaN(C.toAgorot('')));
  assert.ok(Number.isNaN(C.toAgorot('abc')));
  assert.ok(Number.isNaN(C.toAgorot(null)));
  assert.ok(Number.isNaN(C.toAgorot('1.2.3')));
});

test('formatILS: מפרידי אלפים, סימן שלילי וחיובי', () => {
  const s = C.formatILS(123456700);
  assert.match(s, /1,234,567/);
  assert.match(s, /₪/);
  assert.ok(C.formatILS(-50000).startsWith('-'));
  assert.ok(C.formatILS(50000, { sign: true }).startsWith('+'));
  assert.equal(C.formatILS(0).startsWith('-'), false);
});

/* ---------- תאריכים ---------- */
test('שנה מעוברת וימים בחודש', () => {
  assert.equal(C.isLeap(2024), true);
  assert.equal(C.isLeap(1900), false);
  assert.equal(C.isLeap(2000), true);
  assert.equal(C.daysInMonth(2024, 2), 29);
  assert.equal(C.daysInMonth(2025, 2), 28);
  assert.equal(C.isValidISO('2025-02-29'), false);
  assert.equal(C.isValidISO('2024-02-29'), true);
});

test('addMonths: 31 בחודש עובר ליום האחרון של חודש קצר', () => {
  assert.equal(C.addMonths('2025-01-31', 1), '2025-02-28');
  assert.equal(C.addMonths('2024-01-31', 1), '2024-02-29');
  assert.equal(C.addMonths('2025-01-31', 3), '2025-04-30');
  assert.equal(C.addMonths('2025-11-15', 2), '2026-01-15');
  assert.equal(C.addMonths('2025-03-10', -3), '2024-12-10');
});

test('addDays לא מושפע משעון קיץ', () => {
  // מעבר שעון קיץ בישראל: סוף מרץ / סוף אוקטובר
  assert.equal(C.addDays('2025-03-27', 1), '2025-03-28');
  assert.equal(C.addDays('2025-03-28', 1), '2025-03-29');
  assert.equal(C.addDays('2025-10-25', 2), '2025-10-27');
  assert.equal(C.addDays('2024-02-28', 1), '2024-02-29');
  assert.equal(C.addDays('2025-01-01', -1), '2024-12-31');
});

test('todayISO משתמש בתאריך מקומי ולא UTC', () => {
  const d = new Date(2025, 0, 1, 0, 30); // חצות וחצי מקומי
  assert.equal(C.todayISO(d), '2025-01-01');
  const late = new Date(2025, 11, 31, 23, 59);
  assert.equal(C.todayISO(late), '2025-12-31');
});

/* ---------- חודש כלכלי ---------- */
test('חודש כלכלי עם יום התחלה 10', () => {
  assert.equal(C.finMonthKey('2025-03-09', 10), '2025-02');
  assert.equal(C.finMonthKey('2025-03-10', 10), '2025-03');
  assert.equal(C.finMonthKey('2025-01-05', 10), '2024-12');
  assert.deepEqual(C.finMonthRange('2025-02', 10), { start: '2025-02-10', end: '2025-03-09' });
  assert.deepEqual(C.finMonthRange('2024-12', 10), { start: '2024-12-10', end: '2025-01-09' });
});

test('חודש כלכלי רגיל (יום 1) כולל 29 בפברואר בשנה מעוברת', () => {
  assert.deepEqual(C.finMonthRange('2024-02', 1), { start: '2024-02-01', end: '2024-02-29' });
  assert.deepEqual(C.finMonthRange('2025-02', 1), { start: '2025-02-01', end: '2025-02-28' });
});

test('lastMonthKeys חוצה שנה', () => {
  assert.deepEqual(C.lastMonthKeys('2025-02', 4), ['2024-11', '2024-12', '2025-01', '2025-02']);
});

/* ---------- תנועות חוזרות ---------- */
test('סדרה חודשית ב-31: מופעים ביום האחרון של חודשים קצרים ושנה מעוברת', () => {
  const d = C.occurrenceDates(series({ startDate: '2024-01-31' }), '2024-05-31');
  assert.deepEqual(d, ['2024-01-31', '2024-02-29', '2024-03-31', '2024-04-30', '2024-05-31']);
});

test('תדירות רבעונית שחוצה שנה', () => {
  const d = C.occurrenceDates(series({ freq: 'quarterly', startDate: '2024-11-30' }), '2025-12-31');
  assert.deepEqual(d, ['2024-11-30', '2025-02-28', '2025-05-30', '2025-08-30', '2025-11-30']);
});

test('תדירות שנתית מ-29 בפברואר', () => {
  const d = C.occurrenceDates(series({ freq: 'yearly', startDate: '2024-02-29' }), '2028-12-31');
  assert.deepEqual(d, ['2024-02-29', '2025-02-28', '2026-02-28', '2027-02-28', '2028-02-29']);
});

test('דו-חודשית ותאריך סיום', () => {
  const d = C.occurrenceDates(series({ freq: 'bimonthly', startDate: '2025-01-10', endDate: '2025-06-30' }), '2025-12-31');
  assert.deepEqual(d, ['2025-01-10', '2025-03-10', '2025-05-10']);
});

test('השלמת חודשים חסרים בלי כפילויות (אידמפוטנטי)', () => {
  const s = [series({ startDate: '2025-01-05' })];
  const r1 = C.materializeRecurring(s, [], '2025-06-20');
  assert.equal(r1.added, 6);
  const r2 = C.materializeRecurring(s, r1.transactions, '2025-06-20');
  assert.equal(r2.added, 0);
  assert.equal(r2.transactions.length, 6);
  // אחרי כמה חודשים בלי כניסה
  const r3 = C.materializeRecurring(s, r2.transactions, '2025-09-05');
  assert.equal(r3.added, 3);
  const ids = new Set(r3.transactions.map((t) => t.id));
  assert.equal(ids.size, r3.transactions.length);
});

test('מזהה דטרמיניסטי לפי סדרה ותאריך', () => {
  const s = [series({ startDate: '2025-01-05' })];
  const a = C.materializeRecurring(s, [], '2025-03-01').transactions.map((t) => t.id);
  const b = C.materializeRecurring(s, [], '2025-03-01').transactions.map((t) => t.id);
  assert.deepEqual(a, b);
  assert.equal(a[0], 's1' && C.occurrenceId('s1', '2025-01-05'));
});

test('מחיקת מופע בודד לא חוזרת בהשלמה הבאה', () => {
  const s = [series({ startDate: '2025-01-05' })];
  const r = C.materializeRecurring(s, [], '2025-04-10');
  const victim = r.transactions[1];
  const del = C.deleteOccurrence(s, r.transactions, victim.id);
  assert.equal(del.transactions.length, 3);
  const again = C.materializeRecurring(del.series, del.transactions, '2025-04-10');
  assert.equal(again.added, 0);
  assert.ok(!again.transactions.some((t) => t.id === victim.id));
});

test('עריכת מופע בודד (שינוי תאריך וסכום) לא יוצרת כפילות', () => {
  const s = [series({ startDate: '2025-01-05' })];
  const r = C.materializeRecurring(s, [], '2025-03-10');
  const edited = r.transactions.map((t, i) => (i === 1 ? Object.assign({}, t, { date: '2025-02-09', amount: 12345, edited: true }) : t));
  const again = C.materializeRecurring(s, edited, '2025-03-10');
  assert.equal(again.added, 0);
  assert.equal(again.transactions.find((t) => t.occDate === '2025-02-05').amount, 12345);
});

test('עריכת סדרה מתאריך מסוים והלאה', () => {
  const s = [series({ startDate: '2025-01-05' })];
  const r = C.materializeRecurring(s, [], '2025-06-10');
  const sp = C.splitSeries(s, r.transactions, 's1', '2025-04-01', { amount: 20000 });
  const m = C.materializeRecurring(sp.series, sp.transactions, '2025-06-10');
  const amounts = m.transactions.sort((a, b) => (a.date < b.date ? -1 : 1)).map((t) => [t.date, t.amount]);
  assert.deepEqual(amounts, [['2025-01-05', 10000], ['2025-02-05', 10000], ['2025-03-05', 10000], ['2025-04-05', 20000], ['2025-05-05', 20000], ['2025-06-05', 20000]]);
  assert.equal(sp.series.find((x) => x.id === 's1').endDate, '2025-03-31');
});

/* ---------- סיכומים ---------- */
test('חודש בלי תנועות ונתונים ריקים', () => {
  const s = C.summarizeMonth([], '2025-03', 1);
  assert.equal(s.income, 0); assert.equal(s.expense, 0); assert.equal(s.rate, 0); assert.equal(s.count, 0);
  const avg = C.averageMonths([], '2025-03', 6, 1);
  assert.equal(avg.months, 0);
  assert.equal(C.rule503020(s), null);
  const st = C.createEmptyState('2025-03-01');
  assert.deepEqual(C.generateInsights(st, '2025-03-15'), []);
});

test('סיכום חודש לפי יום תחילת חודש כלכלי', () => {
  const tx = [
    { id: 'a', kind: 'income', amount: 1000000, date: '2025-03-10', categoryId: 'inc_salary' },
    { id: 'b', kind: 'expense', amount: 200000, date: '2025-03-09', categoryId: 'exp_grocery', essential: true },
    { id: 'c', kind: 'expense', amount: 300000, date: '2025-04-09', categoryId: 'exp_dining', essential: false }
  ];
  const s = C.summarizeMonth(tx, '2025-03', 10);
  assert.equal(s.income, 1000000);
  assert.equal(s.expense, 300000); // ה-9 במרץ שייך לפברואר הכלכלי
  assert.equal(Math.round(s.rate), 70);
  assert.equal(s.discretionary, 300000);
});

test('סטטוס תקציב: ירוק, צהוב מעל 80%, אדום מעל 100%', () => {
  const cats = [
    { id: 'a', kind: 'expense', name: 'א', budget: 10000 },
    { id: 'b', kind: 'expense', name: 'ב', budget: 10000 },
    { id: 'c', kind: 'expense', name: 'ג', budget: 10000 }
  ];
  const tx = [
    { id: '1', kind: 'expense', amount: 5000, date: '2025-05-02', categoryId: 'a' },
    { id: '2', kind: 'expense', amount: 8500, date: '2025-05-02', categoryId: 'b' },
    { id: '3', kind: 'expense', amount: 10001, date: '2025-05-02', categoryId: 'c' }
  ];
  const st = C.budgetStatus(cats, tx, '2025-05', 1).map((x) => x.status);
  assert.deepEqual(st, ['ok', 'warn', 'over']);
});

test('50/30/20', () => {
  const r = C.rule503020({ income: 1000000, expense: 750000, essential: 500000, discretionary: 250000 });
  assert.equal(r.needs, 50); assert.equal(r.wants, 25); assert.equal(r.savings, 25);
});

/* ---------- מס ---------- */
test('מס רווח הון 25% על הרווח הריאלי בלבד', () => {
  assert.equal(C.capitalGainsTax(150000, 100000, 1), 12500);
  // אינפלציה של 10%: הבסיס המוצמד 110,000 → רווח ריאלי 40,000
  assert.equal(C.capitalGainsTax(150000, 100000, 1.1), 10000);
  // הפסד ריאלי — אין מס
  assert.equal(C.capitalGainsTax(105000, 100000, 1.1), 0);
});

/* ---------- תחזית ---------- */
test('תשואה 0 ובלי דמי ניהול: הצבירה = יתרה + הפקדות', () => {
  const r = C.project({ accounts: [{ id: 'x', balance: 1000000, monthly: 100000, expReturn: 0, feeAcc: 0, feeDep: 0, tax: 'exempt' }], years: 2, startISO: '2025-01-01', inflation: 0 });
  assert.equal(r.final.nominal, 1000000 + 24 * 100000);
  assert.equal(r.points.length, 25);
});

test('ריבית דריבית חודשית: 6% שנתי על 100,000 לשנה = 106,000', () => {
  const r = C.project({ accounts: [{ id: 'x', balance: 10000000, monthly: 0, expReturn: 6, feeAcc: 0, feeDep: 0 }], years: 1, startISO: '2025-01-01', inflation: 0 });
  assert.ok(Math.abs(r.final.nominal - 10600000) <= 1);
});

test('אינפלציה גבוהה מהתשואה: הערך הריאלי יורד', () => {
  const r = C.project({ accounts: [{ id: 'x', balance: 10000000, monthly: 0, expReturn: 2, feeAcc: 0, feeDep: 0 }], years: 10, startISO: '2025-01-01', inflation: 5 });
  assert.ok(r.final.nominal > 10000000);
  assert.ok(r.final.real < 10000000);
  const expectedReal = 10000000 * Math.pow(1.02, 10) / Math.pow(1.05, 10);
  assert.ok(Math.abs(r.final.real - expectedReal) < 5);
});

test('דמי ניהול מקטינים את הצבירה, וחישוב "עלות עד הפרישה" חיובי', () => {
  const acc = { id: 'x', balance: 10000000, monthly: 200000, expReturn: 5, feeAcc: 1, feeDep: 2 };
  const a = C.project({ accounts: [acc], years: 20, startISO: '2025-01-01' });
  const b = C.project({ accounts: [acc], years: 20, startISO: '2025-01-01', noFees: true });
  assert.ok(a.final.nominal < b.final.nominal);
  assert.ok(a.totalFees > 0);
  const f = C.feesUntilRetirement([acc], { age: 40, retireAge: 67 }, '2025-01-01');
  assert.equal(f.years, 27);
  assert.ok(f.cost > 0);
  assert.equal(C.annualFees(acc), 100000 + 48000);
});

test('הצמדת הפקדות לאינפלציה מגדילה את ההפקדות', () => {
  const acc = { id: 'x', balance: 0, monthly: 100000, expReturn: 0 };
  const a = C.project({ accounts: [acc], years: 10, startISO: '2025-01-01', inflation: 3 });
  const b = C.project({ accounts: [acc], years: 10, startISO: '2025-01-01', inflation: 3, indexDeposits: true });
  assert.equal(a.final.nominal, 12000000);
  assert.ok(b.final.nominal > a.final.nominal);
});

test('נזיל מול נעול: קרן השתלמות לפני תאריך נזילות ופנסיה עד פרישה', () => {
  const settings = { age: 60, retireAge: 67 };
  const accs = [
    { id: 'h', type: 'hishtalmut', balance: 100000, monthly: 0, expReturn: 0, tax: 'exempt', liquidDate: '2026-01-01' },
    { id: 'p', type: 'pension', balance: 200000, monthly: 0, expReturn: 0, tax: 'pension' }
  ];
  const r = C.project({ accounts: accs, years: 8, startISO: '2025-01-01', inflation: 0, settings });
  assert.equal(r.points[0].liquid, 0);
  assert.equal(r.points[0].locked, 300000);
  assert.equal(r.points[13].liquid, 100000); // אחרי תאריך הנזילות
  assert.equal(r.points[96].locked, 0); // אחרי גיל 67
});

test('תחזית עם מס: afterTax קטן מהנומינלי כשיש רווח בנכס חייב במס', () => {
  const r = C.project({ accounts: [{ id: 'x', balance: 10000000, monthly: 0, expReturn: 8, tax: 'cgt' }], years: 10, startISO: '2025-01-01', inflation: 2 });
  assert.ok(r.final.afterTax < r.final.nominal);
  const realGain = r.final.nominal - 10000000 * r.final.infl;
  assert.ok(Math.abs((r.final.nominal - r.final.afterTax) - realGain * 0.25) < 50);
});

test('אירועי חיים: הוצאה חד-פעמית מורידה את הצבירה בחודש שלה', () => {
  const acc = { id: 'x', balance: 10000000, monthly: 0, expReturn: 0 };
  const r = C.project({ accounts: [acc], years: 2, startISO: '2025-01-01', inflation: 0, lifeEvents: [{ date: '2025-07-15', type: 'oneoff', amount: 3000000 }] });
  assert.equal(r.points[5].nominal, 10000000);
  assert.equal(r.points[6].nominal, 7000000);
  const r2 = C.project({ accounts: [acc], years: 1, startISO: '2025-01-01', inflation: 0, flowReturn: 0, lifeEvents: [{ date: '2025-01-01', type: 'income', amount: 100000 }] });
  assert.equal(r2.final.nominal, 10000000 + 12 * 100000);
});

test('תרחישים: שינוי הוצאות/הכנסות מתורגם לתזרים חודשי', () => {
  const sc = C.defaultScenarios(2.5);
  assert.equal(sc.pess.inflation, 4);
  const o = C.scenarioToOptions({ returnAdj: 0, inflation: 2, incomeChange: 10, expenseChange: -10, extraMonthly: 50000 }, { income: 2000000, expense: 1500000 }, { years: 5 });
  assert.equal(o.flowMonthly, 200000 + 150000);
  assert.equal(o.extraMonthly, 50000);
});

/* ---------- מונטה קרלו ---------- */
test('מונטה קרלו דטרמיניסטי: אותם קלטים → אותה תוצאה', () => {
  const opts = { accounts: [{ id: 'x', balance: 10000000, monthly: 100000, expReturn: 6, risk: 'high' }], years: 5, startISO: '2025-01-01', inflation: 2.5, runs: 200 };
  const a = C.monteCarlo(opts);
  const b = C.monteCarlo(opts);
  assert.deepEqual(a.p50, b.p50);
  assert.deepEqual(a.p10, b.p10);
  assert.equal(a.runs, 200);
  assert.ok(a.p10[60] < a.p50[60] && a.p50[60] < a.p90[60]);
});

test('מונטה קרלו בשלבים נותן תוצאה זהה להרצה רציפה', () => {
  const opts = { accounts: [{ id: 'x', balance: 5000000, monthly: 50000, expReturn: 5, risk: 'medium' }], years: 3, startISO: '2025-01-01', inflation: 2, runs: 120 };
  const mc = C.createMonteCarlo(opts);
  let steps = 0;
  while (!mc.step(17)) steps++;
  assert.ok(steps > 3);
  assert.deepEqual(mc.result().p90, C.monteCarlo(opts).p90);
});

test('מונטה קרלו: חציון קרוב לתחזית הדטרמיניסטית', () => {
  const acc = { id: 'x', balance: 10000000, monthly: 0, expReturn: 6, risk: 'low' };
  const mc = C.monteCarlo({ accounts: [acc], years: 10, startISO: '2025-01-01', runs: 1000 });
  const det = C.project({ accounts: [acc], years: 10, startISO: '2025-01-01' }).final.nominal;
  // בהתפלגות לוג-נורמלית החציון מעט נמוך מהתוחלת
  assert.ok(Math.abs(mc.p50[120] - det) / det < 0.05);
});

test('mulberry32 ו-percentile', () => {
  const r1 = C.mulberry32(1), r2 = C.mulberry32(1);
  for (let i = 0; i < 5; i++) assert.equal(r1(), r2());
  assert.equal(C.percentile([1, 2, 3, 4, 5], 0.5), 3);
  assert.equal(C.percentile([10, 20], 0.5), 15);
  assert.equal(C.percentile([], 0.5), 0);
});

/* ---------- FIRE ויעדים ---------- */
test('FIRE: יעד לפי כלל 4% וגיל הגעה', () => {
  assert.equal(C.fireTarget(12000000, 4), 300000000);
  assert.equal(C.fireTarget(12000000, 3), 400000000);
  const pts = [{ t: 0, real: 100 }, { t: 24, real: 500 }, { t: 36, real: 1000, date: '2028-01-01' }];
  assert.equal(C.fireAge(pts, 900, 30).age, 33);
  assert.equal(C.fireAge(pts, 5000, 30), null);
});

test('יעדים: חודשים ליעד והפקדה נדרשת', () => {
  assert.equal(C.monthsToGoal(0, 1200000, 100000, 0), 12);
  assert.equal(C.monthsToGoal(2000000, 1000000, 0, 0), 0);
  assert.equal(C.monthsToGoal(0, 1000000, 0, 0), null);
  assert.equal(C.requiredMonthly(0, 1200000, 12, 0), 100000);
  const withRet = C.requiredMonthly(0, 1200000, 12, 5);
  assert.ok(withRet < 100000 && withRet > 95000);
  const g = C.analyzeGoal({ target: 1200000, saved: 600000, monthly: 100000, date: '2025-12-01' }, [], '2025-01-01');
  assert.equal(g.pct, 50);
  assert.equal(g.monthsToGoal, 6);
  assert.equal(g.onTrack, true);
});

/* ---------- נכסים ---------- */
test('שווי נקי, כרית ביטחון וצילום חודשי יחיד', () => {
  const accs = [{ id: 'a', type: 'checking', balance: 3000000 }, { id: 'b', type: 'pension', tax: 'pension', balance: 50000000 }];
  const liabs = [{ id: 'l', balance: 1000000 }];
  assert.deepEqual(C.netWorth(accs, liabs), { assets: 53000000, liabilities: 1000000, net: 52000000 });
  const liq = C.liquidAssets(accs, { age: 35, retireAge: 67 }, '2025-01-01');
  assert.equal(liq, 3000000);
  assert.equal(C.emergencyMonths(liq, 1000000), 3);
  assert.equal(C.emergencyMonths(liq, 0), null);
  let snaps = C.ensureSnapshot([], accs, liabs, '2025-01-05');
  snaps = C.ensureSnapshot(snaps, accs, [], '2025-01-20');
  assert.equal(snaps.length, 1);
  assert.equal(snaps[0].net, 53000000);
  snaps = C.ensureSnapshot(snaps, accs, [], '2025-02-01');
  assert.equal(snaps.length, 2);
});

/* ---------- CSV ---------- */
test('CSV: מרכאות, BOM, נקודה-פסיק ותאריכים בפורמט ישראלי', () => {
  const rows = C.parseCSV('﻿תאריך;תיאור;סכום\n05/03/2025;"שופרסל; סניף 3";-245.90\n06.03.25;משכורת;12,000.00\n');
  assert.equal(rows.length, 3);
  assert.equal(rows[1][1], 'שופרסל; סניף 3');
  const r = C.csvToTransactions(rows, { hasHeader: true, date: 0, desc: 1, amount: 2 });
  assert.equal(r.transactions.length, 2);
  assert.deepEqual(r.transactions[0], { date: '2025-03-05', amount: 24590, kind: 'expense', note: 'שופרסל; סניף 3' });
  assert.equal(r.transactions[1].date, '2025-03-06');
  assert.equal(r.transactions[1].kind, 'income');
});

test('CSV: עמודות חובה/זכות, שורות פגומות וזיהוי כפילויות', () => {
  const rows = C.parseCSV('date,desc,debit,credit\n2025-03-01,סופר,100,\n2025-03-02,החזר,,50\nbad,x,1,\n2025-03-01,סופר,100,');
  const r = C.csvToTransactions(rows, { hasHeader: true, date: 0, desc: 1, debit: 2, credit: 3 });
  assert.equal(r.transactions.length, 3);
  assert.deepEqual(r.errors, [4]);
  const existing = [{ date: '2025-03-02', amount: 5000, note: 'החזר', kind: 'income' }];
  const m = C.markDuplicates(r.transactions, existing);
  assert.equal(m[0].duplicate, false);
  assert.equal(m[1].duplicate, true);
  assert.equal(m[2].duplicate, true); // כפילות בתוך הקובץ עצמו
});

test('toCSV מצטט שדות עם פסיקים ומרכאות', () => {
  const s = C.toCSV([['a', 'b,c', 'd"e']]);
  assert.equal(s, '﻿a,"b,c","d""e"');
});

/* ---------- סכמה וולידציה ---------- */
test('מיגרציה מגרסה 0 ושגיאה על גרסה עתידית', () => {
  const m = C.migrate({ transactions: [{ id: 'x', amount: 100, date: '2025-01-01' }] });
  assert.equal(m.schemaVersion, C.SCHEMA_VERSION);
  assert.ok(Array.isArray(m.accounts));
  assert.equal(m.settings.inflation, 2.5);
  assert.equal(m.transactions.length, 1);
  assert.throws(() => C.migrate({ schemaVersion: 999 }));
  assert.throws(() => C.migrate(null));
});

test('בדיקת מבנה גיבוי ומצב', () => {
  assert.equal(C.validateBackupEnvelope({}).ok, false);
  assert.equal(C.validateBackupEnvelope({ format: 'matzpen-backup', schemaVersion: 1, kdf: { salt: 'x', iterations: 310000 }, iv: 'a', data: 'b' }).ok, true);
  assert.equal(C.validateBackupEnvelope({ format: 'matzpen-backup', schemaVersion: 1, kdf: { salt: 'x', iterations: 1000 }, iv: 'a', data: 'b' }).ok, false);
  assert.deepEqual(C.validateState(C.createEmptyState('2025-01-01')), []);
  assert.ok(C.validateState({ transactions: [{ id: 'a', amount: 1.5, date: '2025-01-01' }] }).length > 0);
});

test('ולידציית טפסים: סכום שלילי/ריק, תאריך סיום לפני התחלה, אחוזים לא הגיוניים', () => {
  assert.ok(C.validateTx({ amount: -5, date: '2025-01-01', categoryId: 'x' }).amount);
  assert.ok(C.validateTx({ amount: NaN, date: '2025-01-01', categoryId: 'x' }).amount);
  assert.ok(C.validateTx({ amount: 100, date: '2025-02-30', categoryId: 'x' }).date);
  assert.ok(C.validateTx({ amount: 100, date: '2025-05-01', categoryId: 'x', freq: 'monthly', endDate: '2025-04-01' }).endDate);
  assert.deepEqual(C.validateTx({ amount: 100, date: '2025-05-01', categoryId: 'x', freq: 'monthly' }), {});
  const e = C.validateAccount({ name: 'a', type: 'stocks', balance: 0, monthly: 0, expReturn: 120, feeAcc: 9, feeDep: 0 });
  assert.ok(e.expReturn && e.feeAcc && !e.balance);
  assert.ok(C.validateGoal({ name: 'x', target: 100, saved: 0, date: '2020-01-01' }, '2025-01-01').date);
});

test('מד חוזק סיסמה', () => {
  assert.ok(C.passwordStrength('abc').score <= 1);
  assert.ok(C.passwordStrength('12345678').score <= 1);
  assert.ok(C.passwordStrength('Tr0ub4dor&3xyz').score >= 3);
});

/* ---------- דמו ותובנות ---------- */
test('נתוני דמו: 12 חודשי היסטוריה, דטרמיניסטי, ונמחקים בלחיצה', () => {
  const a = C.generateDemo('2025-06-15');
  const b = C.generateDemo('2025-06-15');
  assert.equal(a.transactions.length, b.transactions.length);
  assert.ok(a.transactions.every((t) => t.date <= '2025-06-15'));
  const months = new Set(a.transactions.map((t) => t.date.slice(0, 7)));
  assert.ok(months.size >= 12);
  assert.deepEqual(C.validateState(a), []);
  // השלמה חוזרת לא יוצרת כפילויות
  assert.equal(C.materializeRecurring(a.series, a.transactions, '2025-06-15').added, 0);
  const user = Object.assign({}, a, { transactions: a.transactions.concat([{ id: 'mine', kind: 'expense', amount: 100, date: '2025-06-01', categoryId: 'exp_other' }]) });
  const clean = C.removeDemo(user);
  assert.equal(clean.transactions.length, 1);
  assert.equal(clean.accounts.length, 0);
  assert.equal(clean.meta.demo, false);
  assert.ok(clean.categories.every((c) => !c.budget));
});

test('תובנות: נוצרות מנתוני הדמו ומוגבלות ל-5', () => {
  const s = C.generateDemo('2025-06-15');
  const ins = C.generateInsights(s, '2025-06-15');
  assert.ok(ins.length >= 3 && ins.length <= 5);
  ins.forEach((i) => assert.equal(typeof i.text, 'string'));
  assert.ok(ins.some((i) => i.type === 'subs'));
  const subs = C.detectSubscriptions(s, '2025-06-15');
  assert.ok(subs.length >= 3);
});

test('סיכום סגירת חודש', () => {
  const s = C.generateDemo('2025-06-15');
  const sum = C.monthCloseSummary(s, '2025-05');
  assert.ok(sum.current.income > 0);
  assert.ok(sum.overs.length <= 3);
  assert.equal(typeof sum.action, 'string');
});
