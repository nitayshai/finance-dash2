/*
 * app.js — מצפן כספי: ממשק, אחסון מוצפן, ניווט ומסכים.
 * החישובים עצמם נמצאים ב-core.js (window.FinanceCore).
 * בלי ES modules כדי שהאתר יעבוד גם בפתיחה ישירה של הקובץ (file://).
 */
(function () {
  'use strict';

  var C = window.FinanceCore;
  var APP_VERSION = '1.0.0';
  var PREFIX = 'matzpen-fin-v1';          // קידומת ייחודית: כמה אתרים ב-github.io חולקים origin
  var KDF_ITER = 600000;                  // PBKDF2-SHA256 (מעל המינימום הנדרש 310,000)
  var MIN_PW = 8;
  var reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* =====================================================================
   * עזרי DOM
   * ===================================================================== */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function esc(s) {
    return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function icon(id, cls) { return '<svg class="' + (cls || '') + '" aria-hidden="true"><use href="#' + id + '"/></svg>'; }
  function today() { return C.todayISO(); }
  function F(ag, o) { return C.formatILS(ag, o); }
  /** סכום מעוצב שמטושטש במצב פרטיות. */
  function money(ag, o) { return '<span class="amt">' + esc(F(ag, o)) + '</span>'; }
  /** סכום עם סימן וחץ, לא רק צבע. */
  function signedMoney(ag, kind) {
    var isInc = kind === 'income' || (kind === undefined && ag >= 0);
    var a = Math.abs(ag);
    return '<span class="amt ' + (isInc ? 'pos' : 'neg') + '">' + (isInc ? '▲ +' : '▼ −') + esc(F(a, { decimals: a % 100 ? 2 : 0 }).replace('-', '')) + '</span>';
  }
  function agToInput(ag) {
    if (ag === null || ag === undefined || ag === '' || isNaN(ag)) return '';
    var v = ag / 100;
    return (Math.round(v * 100) % 100 === 0) ? String(Math.round(v)) : v.toFixed(2);
  }
  function clone(o) {
    if (typeof structuredClone === 'function') return structuredClone(o);
    return JSON.parse(JSON.stringify(o));
  }
  function debounce(fn, ms) {
    var t;
    return function () { var a = arguments, self = this; clearTimeout(t); t = setTimeout(function () { fn.apply(self, a); }, ms); };
  }
  function friendly(e) {
    if (!e) return 'שגיאה לא ידועה';
    if (typeof e === 'string') return e;
    if (e.name === 'QuotaExceededError') return 'אין מספיק מקום אחסון בדפדפן';
    return e.message || String(e);
  }
  var fieldSeq = 0;

  /* =====================================================================
   * מילון מונחים (tooltips)
   * ===================================================================== */
  var TIPS = {
    real: 'ריאלי: הסכום מוצג בכוח הקנייה של היום, אחרי ניכוי האינפלציה הצפויה. נומינלי: הסכום כפי שיופיע בפועל בחשבון.',
    feeAcc: 'דמי ניהול מהצבירה: אחוז שנתי שגובים מכל הכסף שנצבר. גם 0.5% נשמע מעט, אבל לאורך עשרות שנים זה מצטבר לסכומים גדולים.',
    feeDep: 'דמי ניהול מהפקדה: אחוז שנגבה מכל הפקדה חודשית, לפני שהכסף מושקע.',
    percentile: 'אחוזון: באחוזון 10 רק 10% מהתרחישים יצאו נמוכים יותר. אחוזון 50 הוא החציון, ובאחוזון 90 רק 10% מהתרחישים יצאו גבוהים יותר.',
    fire: 'FIRE (עצמאות כלכלית): הנקודה שבה הנכסים שלך יכולים לממן את ההוצאות השנתיות לאורך זמן, לפי כלל משיכה בטוחה (למשל 4% בשנה).',
    swr: 'שיעור משיכה בטוח: איזה אחוז מהתיק אפשר למשוך כל שנה בלי שהכסף ייגמר. 4% הוא כלל אצבע מקובל; 3% עד 3.5% שמרני יותר.',
    emergency: 'כרית ביטחון: כמה חודשים תוכל לממן את ההוצאות החיוניות מכסף נזיל (בלי פנסיה וכספים נעולים). מומלץ 3 עד 6 חודשים.',
    liquid: 'נזיל: כסף שאפשר למשוך בלי קנס. נעול: קרן השתלמות לפני מועד הנזילות, פנסיה עד גיל הפרישה, נדל"ן.',
    cgt: 'מס רווח הון: 25% על הרווח הריאלי (מעל האינפלציה) בעת מימוש. קרן השתלמות פטורה ממס אחרי מועד הנזילות.',
    montecarlo: 'מונטה קרלו: 1,000 הדמיות עם תשואות אקראיות לפי רמת הסיכון של כל נכס. במקום מספר אחד מקבלים טווח של תוצאות אפשריות.',
    returnAdj: 'התאמת תשואה: כמה נקודות אחוז להוסיף או להוריד מהתשואה הצפויה של כל נכס בתרחיש.',
    indexDeposits: 'הצמדה לאינפלציה: ההפקדה החודשית גדלה כל שנה לפי האינפלציה, כך שערכה הריאלי נשמר.',
    rule: 'שיטת 50/30/20: עד 50% מההכנסה להוצאות חיוניות, עד 30% לרצוניות, ולפחות 20% לחיסכון.',
    essential: 'חיונית: הוצאה שקשה לוותר עליה (דיור, מזון, ביטוח). רצונית: הוצאה שאפשר לצמצם (מסעדות, בילויים, מנויים).',
    flow: 'תזרים נוסף: הפקדה נוספת, שינוי בהכנסות או בהוצאות ואירועי חיים נכנסים ל"דלי" נזיל נפרד בתשואה של ' + '4% (ניתן לשינוי בהגדרות).'
  };
  function tip(key, text) {
    var t = text || TIPS[key] || '';
    return '<button type="button" class="tip" data-tip="' + esc(t) + '" aria-label="הסבר: ' + esc(t) + '">?</button>';
  }

  /* =====================================================================
   * אחסון: IndexedDB, ואם לא זמין — localStorage (ואם גם לא — זיכרון בלבד)
   * ===================================================================== */
  var Store = (function () {
    var DB_NAME = PREFIX + '-db', OS = 'kv';
    var db = null, mode = 'memory', mem = {};
    function openIDB() {
      return new Promise(function (resolve, reject) {
        var done = false;
        var timer = setTimeout(function () { if (!done) { done = true; reject(new Error('IndexedDB timeout')); } }, 3000);
        try {
          var req = indexedDB.open(DB_NAME, 1);
          req.onupgradeneeded = function () { req.result.createObjectStore(OS); };
          req.onsuccess = function () { if (done) return; done = true; clearTimeout(timer); resolve(req.result); };
          req.onerror = function () { if (done) return; done = true; clearTimeout(timer); reject(req.error); };
          req.onblocked = function () { if (done) return; done = true; clearTimeout(timer); reject(new Error('blocked')); };
        } catch (e) { done = true; clearTimeout(timer); reject(e); }
      });
    }
    function lsOk() {
      try { localStorage.setItem(PREFIX + '-t', '1'); localStorage.removeItem(PREFIX + '-t'); return true; } catch (e) { return false; }
    }
    function init() {
      if (!window.indexedDB) { mode = lsOk() ? 'ls' : 'memory'; return Promise.resolve(mode); }
      return openIDB().then(function (d) { db = d; mode = 'idb'; return mode; }).catch(function () { mode = lsOk() ? 'ls' : 'memory'; return mode; });
    }
    function idb(type, fn) {
      return new Promise(function (resolve, reject) {
        try {
          var tx = db.transaction(OS, type);
          var store = tx.objectStore(OS);
          var req = fn(store);
          tx.oncomplete = function () { resolve(req ? req.result : undefined); };
          tx.onerror = function () { reject(tx.error); };
          tx.onabort = function () { reject(tx.error || new Error('abort')); };
        } catch (e) { reject(e); }
      });
    }
    function get(key) {
      try {
        if (mode === 'idb') return idb('readonly', function (s) { return s.get(key); });
        if (mode === 'ls') { var v = localStorage.getItem(PREFIX + ':' + key); return Promise.resolve(v ? JSON.parse(v) : undefined); }
        return Promise.resolve(mem[key]);
      } catch (e) { return Promise.reject(e); }
    }
    function set(key, val) {
      try {
        if (mode === 'idb') return idb('readwrite', function (s) { return s.put(val, key); });
        if (mode === 'ls') { localStorage.setItem(PREFIX + ':' + key, JSON.stringify(val)); return Promise.resolve(); }
        mem[key] = val; return Promise.resolve();
      } catch (e) { return Promise.reject(e); }
    }
    function del(key) {
      try {
        if (mode === 'idb') return idb('readwrite', function (s) { return s.delete(key); });
        if (mode === 'ls') { localStorage.removeItem(PREFIX + ':' + key); return Promise.resolve(); }
        delete mem[key]; return Promise.resolve();
      } catch (e) { return Promise.reject(e); }
    }
    function clearAll() {
      var p = Promise.resolve();
      try {
        if (mode === 'idb') p = idb('readwrite', function (s) { return s.clear(); });
        mem = {};
        var keys = [];
        for (var i = 0; i < localStorage.length; i++) { var k = localStorage.key(i); if (k && k.indexOf(PREFIX) === 0) keys.push(k); }
        keys.forEach(function (k) { localStorage.removeItem(k); });
      } catch (e) { /* ממשיכים */ }
      return p;
    }
    return { init: init, get: get, set: set, del: del, clearAll: clearAll, mode: function () { return mode; } };
  })();

  /** הגדרות קטנות ולא רגישות (ערכת צבעים, מונה ניסיונות) — לא מוצפנות. */
  var Pref = {
    get: function (k, d) { try { var v = localStorage.getItem(PREFIX + '-' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem(PREFIX + '-' + k, JSON.stringify(v)); } catch (e) { /* לא קריטי */ } }
  };

  /* =====================================================================
   * הצפנה: PBKDF2-SHA256 → AES-GCM 256, דרך Web Crypto בלבד
   * ===================================================================== */
  var Crypto = {
    available: function () { return !!(window.crypto && crypto.subtle && crypto.getRandomValues); },
    b64: function (buf) {
      var bytes = new Uint8Array(buf), bin = '';
      for (var i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      return btoa(bin);
    },
    unb64: function (s) {
      var bin = atob(s), out = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    },
    random: function (n) { var a = new Uint8Array(n); crypto.getRandomValues(a); return a; },
    deriveKey: function (password, salt, iterations) {
      var enc = new TextEncoder();
      return crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']).then(function (base) {
        return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: salt, iterations: iterations, hash: 'SHA-256' }, base,
          { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
      });
    },
    encrypt: function (key, obj) {
      var iv = Crypto.random(12); // IV חדש בכל שמירה
      var data = new TextEncoder().encode(JSON.stringify(obj));
      return crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, data).then(function (ct) {
        return { iv: Crypto.b64(iv), data: Crypto.b64(ct) };
      });
    },
    decrypt: function (key, ivB64, dataB64) {
      return crypto.subtle.decrypt({ name: 'AES-GCM', iv: Crypto.unb64(ivB64) }, key, Crypto.unb64(dataB64)).then(function (pt) {
        return JSON.parse(new TextDecoder().decode(pt));
      });
    }
  };

  /* =====================================================================
   * מצב האפליקציה (בזיכרון בלבד בזמן שהיא פתוחה)
   * ===================================================================== */
  var S = null;           // הנתונים המפוענחים
  var KEY = null;         // CryptoKey — לא נשמר בשום מקום
  var SALT = null;        // salt של הכספת (b64)
  var ITER = KDF_ITER;
  var charts = {};
  var route = 'dashboard';
  var lastMaint = null;
  var persistGranted = null;
  var ui = {
    tx: { q: '', period: 'all', kind: 'all', cat: 'all', min: '', max: '', from: '', to: '', sort: 'date', dir: -1, limit: 100, tab: 'list' },
    budgetMonth: null, showAllCats: false,
    fc: { years: 20, mode: 'real', indexDeposits: true, afterTax: false, active: 'base', cmpA: 'pess', cmpB: 'opt' },
    closeMonth: null
  };

  /* ---------- שמירה ---------- */
  var saveTimer = null, saveChain = Promise.resolve(), dirty = false;
  function setSaveInd(state) {
    var el = $('#save-ind'); if (!el) return;
    el.classList.toggle('ok', state === 'ok');
    el.textContent = state === 'saving' ? 'שומר…' : state === 'ok' ? 'נשמר ✓' : state === 'err' ? 'שגיאת שמירה' : '';
    if (state === 'ok') { clearTimeout(setSaveInd.t); setSaveInd.t = setTimeout(function () { if (el.textContent === 'נשמר ✓') el.textContent = ''; }, 2500); }
  }
  function scheduleSave() {
    dirty = true;
    setSaveInd('saving');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flushSave, 250);
  }
  function vaultRecord(enc) {
    return { v: 1, app: 'matzpen', kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: ITER, salt: SALT }, iv: enc.iv, data: enc.data, savedAt: Date.now() };
  }
  function flushSave() {
    clearTimeout(saveTimer);
    if (!KEY || !S || !dirty) return saveChain;
    dirty = false;
    var key = KEY, data = S;
    saveChain = saveChain.then(function () {
      return Crypto.encrypt(key, data).then(function (enc) { return Store.set('vault', vaultRecord(enc)); });
    }).then(function () { setSaveInd('ok'); }).catch(function (e) {
      dirty = true; setSaveInd('err');
      toast('השמירה נכשלה: ' + friendly(e), 'error');
    });
    return saveChain;
  }
  window.addEventListener('pagehide', function () { if (dirty) flushSave(); });

  /** שינוי נתונים: מריץ fn על S, שומר, מצייר מחדש. opts.undo = טקסט ל-toast ביטול. */
  function commit(fn, opts) {
    opts = opts || {};
    var before = opts.undo ? clone(S) : null;
    try { fn(S); } catch (e) { toast('הפעולה נכשלה: ' + friendly(e), 'error'); if (before) S = before; return; }
    scheduleSave();
    if (opts.render !== false) render();
    if (before) {
      toast(opts.undo, 'info', { duration: 6000, action: { label: 'בטל', fn: function () { S = before; scheduleSave(); render(); toast('הפעולה בוטלה'); } } });
    } else if (opts.toast) toast(opts.toast);
  }

  /* =====================================================================
   * Toasts
   * ===================================================================== */
  function toast(msg, type, o) {
    o = o || {};
    var root = $('#toasts'); if (!root) return;
    var el = document.createElement('div');
    el.className = 'toast' + (type === 'error' ? ' error' : '');
    el.setAttribute('role', type === 'error' ? 'alert' : 'status');
    el.innerHTML = '<span class="t-msg">' + esc(msg) + '</span>' + (o.action ? '<button class="btn small" type="button">' + esc(o.action.label) + '</button>' : '');
    var timer;
    var close = function () { clearTimeout(timer); if (el.parentNode) el.parentNode.removeChild(el); };
    if (o.action) $('button', el).addEventListener('click', function () { close(); o.action.fn(); });
    root.appendChild(el);
    while (root.children.length > 3) root.removeChild(root.firstChild);
    timer = setTimeout(close, o.duration || (type === 'error' ? 6000 : 3200));
    return close;
  }

  /* =====================================================================
   * מודאל / Bottom sheet
   * ===================================================================== */
  var modalStack = [];
  function openModal(o) {
    var root = $('#modal-root');
    var prevFocus = document.activeElement;
    var ov = document.createElement('div');
    ov.className = 'overlay';
    var tid = 'dlg_t_' + (++fieldSeq);
    ov.innerHTML = '<div class="dialog' + (o.wide ? ' wide' : '') + '" role="dialog" aria-modal="true" aria-labelledby="' + tid + '">' +
      '<div class="sheet-handle" aria-hidden="true"></div>' +
      '<div class="dialog-h"><h2 id="' + tid + '">' + esc(o.title) + '</h2><button type="button" class="icon-btn small" data-close aria-label="סגור">' + icon('i-x') + '</button></div>' +
      '<div class="dialog-b">' + (o.body || '') + '</div>' +
      (o.footer ? '<div class="dialog-f">' + o.footer + '</div>' : '') + '</div>';
    root.appendChild(ov);
    var dlg = $('.dialog', ov);
    var api = {
      el: dlg, overlay: ov,
      close: function (result) {
        if (!ov.parentNode) return;
        ov.parentNode.removeChild(ov);
        modalStack = modalStack.filter(function (m) { return m !== api; });
        document.removeEventListener('keydown', onKey, true);
        if (o.onClose) o.onClose(result);
        if (prevFocus && prevFocus.focus && document.contains(prevFocus)) prevFocus.focus();
      }
    };
    function onKey(e) {
      if (modalStack[modalStack.length - 1] !== api) return;
      if (e.key === 'Escape') { e.preventDefault(); api.close(); }
      else if (e.key === 'Tab') { // מלכודת פוקוס
        var f = $$('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])', dlg).filter(function (x) { return !x.disabled && x.offsetParent !== null; });
        if (!f.length) return;
        var first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    }
    document.addEventListener('keydown', onKey, true);
    ov.addEventListener('mousedown', function (e) { if (e.target === ov) api.close(); });
    $$('[data-close]', ov).forEach(function (b) { b.addEventListener('click', function () { api.close(); }); });
    modalStack.push(api);
    if (o.onMount) o.onMount(dlg, api);
    setTimeout(function () {
      var af = $('[autofocus]', dlg) || $('input:not([type=hidden]), select, textarea', dlg) || $('[data-close]', dlg);
      if (af) { try { af.focus({ preventScroll: true }); } catch (e) { af.focus(); } }
    }, 30);
    return api;
  }
  function closeAllModals() { modalStack.slice().forEach(function (m) { m.close(); }); $('#modal-root').innerHTML = ''; modalStack = []; }

  function confirmDialog(o) {
    return new Promise(function (resolve) {
      var resolved = false;
      var m = openModal({
        title: o.title, body: '<p>' + (o.html || esc(o.text || '')) + '</p>',
        footer: '<button type="button" class="btn ' + (o.danger ? 'danger' : '') + '" data-ok>' + esc(o.ok || 'אישור') + '</button><button type="button" class="btn secondary" data-close>' + esc(o.cancel || 'ביטול') + '</button>',
        onClose: function () { if (!resolved) resolve(false); },
        onMount: function (dlg) { $('[data-ok]', dlg).addEventListener('click', function () { resolved = true; resolve(true); m.close(); }); }
      });
    });
  }

  function choiceDialog(o) { // o.choices: [{id, label, danger}]
    return new Promise(function (resolve) {
      var resolved = false;
      var m = openModal({
        title: o.title, body: '<p>' + esc(o.text || '') + '</p>',
        footer: o.choices.map(function (c) { return '<button type="button" class="btn ' + (c.danger ? 'danger' : c.secondary ? 'secondary' : '') + '" data-choice="' + c.id + '">' + esc(c.label) + '</button>'; }).join('') + '<button type="button" class="btn ghost" data-close>ביטול</button>',
        onClose: function () { if (!resolved) resolve(null); },
        onMount: function (dlg) {
          $$('[data-choice]', dlg).forEach(function (b) { b.addEventListener('click', function () { resolved = true; resolve(b.getAttribute('data-choice')); m.close(); }); });
        }
      });
    });
  }

  function passwordPrompt(o) {
    return new Promise(function (resolve) {
      var resolved = false;
      var m = openModal({
        title: o.title,
        body: '<p class="muted small" style="margin-bottom:12px">' + esc(o.text || '') + '</p><form data-pwform novalidate>' +
          '<div class="field"><label for="pp_in">סיסמה</label><input class="input" type="password" id="pp_in" autocomplete="current-password" autofocus><div class="err" role="alert"></div></div></form>',
        footer: '<button type="button" class="btn" data-ok>המשך</button><button type="button" class="btn secondary" data-close>ביטול</button>',
        onClose: function () { if (!resolved) resolve(null); },
        onMount: function (dlg) {
          var go = function (e) { if (e) e.preventDefault(); var v = $('#pp_in', dlg).value; if (!v) { $('.err', dlg).textContent = 'יש להזין סיסמה'; return; } resolved = true; resolve(v); m.close(); };
          $('[data-ok]', dlg).addEventListener('click', go);
          $('form', dlg).addEventListener('submit', go);
        }
      });
    });
  }

  /* =====================================================================
   * בונה טפסים + ולידציה
   * ===================================================================== */
  function fld(o) {
    var id = 'f_' + o.name + '_' + (++fieldSeq);
    var v = o.value;
    var attrs = o.attrs || '';
    var input;
    switch (o.type) {
      case 'amount':
        input = '<input class="input ltr' + (o.big ? ' amount-input' : '') + '" id="' + id + '" name="' + o.name + '" inputmode="decimal" autocomplete="off" placeholder="' + esc(o.placeholder || '0') + '" value="' + esc(agToInput(v)) + '" ' + attrs + '>';
        break;
      case 'number':
        input = '<input class="input ltr" id="' + id + '" name="' + o.name + '" inputmode="decimal" autocomplete="off" placeholder="' + esc(o.placeholder || '') + '" value="' + esc(v === undefined || v === null ? '' : v) + '" ' + attrs + '>';
        break;
      case 'date':
        input = '<input class="input" type="date" id="' + id + '" name="' + o.name + '" value="' + esc(v || '') + '" ' + attrs + '>';
        break;
      case 'select':
        var groups = {}, order = [], plain = '';
        o.options.forEach(function (op) {
          var h = '<option value="' + esc(op.value) + '"' + (String(op.value) === String(v) ? ' selected' : '') + '>' + esc(op.label) + '</option>';
          if (op.group) { if (!groups[op.group]) { groups[op.group] = ''; order.push(op.group); } groups[op.group] += h; } else plain += h;
        });
        input = '<select class="input" id="' + id + '" name="' + o.name + '" ' + attrs + '>' + plain + order.map(function (g) { return '<optgroup label="' + esc(g) + '">' + groups[g] + '</optgroup>'; }).join('') + '</select>';
        break;
      case 'switch':
        return '<div class="field ' + (o.full ? 'full' : '') + '" data-field="' + o.name + '"><label class="switch"><input type="checkbox" name="' + o.name + '" id="' + id + '"' + (v ? ' checked' : '') + ' ' + attrs + '><span>' + esc(o.label) + '</span>' + (o.tip ? tip(o.tip) : '') + '</label>' + (o.hint ? '<div class="hint">' + o.hint + '</div>' : '') + '</div>';
      case 'seg':
        input = '<input type="hidden" name="' + o.name + '" value="' + esc(v) + '"><div class="seg full" role="group" aria-label="' + esc(o.label) + '">' +
          o.options.map(function (op) { return '<button type="button" data-seg="' + o.name + '" data-val="' + esc(op.value) + '" aria-pressed="' + (String(op.value) === String(v)) + '">' + esc(op.label) + '</button>'; }).join('') + '</div>';
        return '<div class="field ' + (o.full ? 'full' : '') + '" data-field="' + o.name + '">' + (o.hideLabel ? '' : '<div class="lbl">' + esc(o.label) + (o.tip ? tip(o.tip) : '') + '</div>') + input + '<div class="err" role="alert"></div></div>';
      case 'textarea':
        input = '<textarea class="input" id="' + id + '" name="' + o.name + '" maxlength="' + (o.max || 200) + '" ' + attrs + '>' + esc(v || '') + '</textarea>';
        break;
      case 'color':
        input = '<input type="color" id="' + id + '" name="' + o.name + '" value="' + esc(v || '#64748b') + '" ' + attrs + '>';
        break;
      case 'password':
        input = '<input class="input" type="password" id="' + id + '" name="' + o.name + '" autocomplete="' + (o.autocomplete || 'new-password') + '" ' + attrs + '>';
        break;
      default:
        input = '<input class="input" type="text" id="' + id + '" name="' + o.name + '" value="' + esc(v || '') + '" placeholder="' + esc(o.placeholder || '') + '" maxlength="' + (o.max || 80) + '" ' + attrs + '>';
    }
    return '<div class="field ' + (o.full ? 'full' : '') + '" data-field="' + o.name + '"' + (o.hidden ? ' hidden' : '') + '>' +
      '<div class="lbl"><label for="' + id + '">' + esc(o.label) + '</label>' + (o.tip ? tip(o.tip) : '') + '</div>' + input +
      (o.hint ? '<div class="hint">' + o.hint + '</div>' : '') + '<div class="err" id="' + id + '_err" role="alert"></div></div>';
  }
  function readForm(root) {
    var o = {};
    $$('[name]', root).forEach(function (el) {
      if (el.type === 'checkbox') o[el.name] = el.checked;
      else o[el.name] = el.value.trim();
    });
    return o;
  }
  function showErrors(root, errs) {
    $$('.err', root).forEach(function (e) { e.textContent = ''; });
    $$('[aria-invalid]', root).forEach(function (e) { e.removeAttribute('aria-invalid'); });
    var first = null;
    Object.keys(errs).forEach(function (k) {
      var f = $('[data-field="' + k + '"]', root);
      if (!f) return;
      var e = $('.err', f); if (e) e.textContent = errs[k];
      var inp = $('[name="' + k + '"]', f);
      if (inp && inp.type !== 'hidden') { inp.setAttribute('aria-invalid', 'true'); if (!first) first = inp; }
    });
    if (first) first.focus();
    return Object.keys(errs).length === 0;
  }
  function pctVal(s) { if (s === '' || s === undefined || s === null) return NaN; return Number(String(s).replace('%', '').replace(',', '.')); }
  function amtVal(s) { if (s === '' || s === undefined) return NaN; return C.toAgorot(s); }
  function amtValOpt(s) { if (s === '' || s === undefined) return 0; return C.toAgorot(s); }

  // מקטעים (segmented controls) — דלגציה גלובלית
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-seg]');
    if (!b) return;
    var name = b.getAttribute('data-seg');
    var wrap = b.parentNode;
    $$('[data-seg]', wrap).forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
    var hidden = wrap.parentNode.querySelector('input[type=hidden][name="' + name + '"]');
    if (hidden) { hidden.value = b.getAttribute('data-val'); hidden.dispatchEvent(new Event('change', { bubbles: true })); }
  });

  /* ---------- Tooltips למונחים ---------- */
  var tipEl = null;
  function showTip(btn) {
    hideTip();
    tipEl = document.createElement('div');
    tipEl.className = 'tip-pop'; tipEl.setAttribute('role', 'tooltip');
    tipEl.textContent = btn.getAttribute('data-tip');
    document.body.appendChild(tipEl);
    var r = btn.getBoundingClientRect(), w = tipEl.offsetWidth, h = tipEl.offsetHeight;
    var left = Math.min(window.innerWidth - w - 8, Math.max(8, r.left + r.width / 2 - w / 2));
    var top = r.top - h - 8; if (top < 8) top = r.bottom + 8;
    tipEl.style.left = left + 'px'; tipEl.style.top = top + 'px';
  }
  function hideTip() { if (tipEl && tipEl.parentNode) tipEl.parentNode.removeChild(tipEl); tipEl = null; }
  document.addEventListener('mouseover', function (e) { var t = e.target.closest && e.target.closest('.tip'); if (t) showTip(t); });
  document.addEventListener('mouseout', function (e) { if (e.target.closest && e.target.closest('.tip')) hideTip(); });
  document.addEventListener('focusin', function (e) { if (e.target.classList && e.target.classList.contains('tip')) showTip(e.target); });
  document.addEventListener('focusout', function (e) { if (e.target.classList && e.target.classList.contains('tip')) hideTip(); });
  document.addEventListener('click', function (e) {
    var t = e.target.closest && e.target.closest('.tip');
    if (t) { e.preventDefault(); e.stopPropagation(); if (tipEl) hideTip(); else showTip(t); } else hideTip();
  }, true);
  window.addEventListener('scroll', hideTip, { passive: true });

  /* =====================================================================
   * ערכת צבעים ופרטיות
   * ===================================================================== */
  var mql = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  function themePref() { return (S && S.settings.theme) || Pref.get('theme', 'auto'); }
  function applyTheme() {
    var pref = themePref();
    var dark = pref === 'dark' || (pref === 'auto' && mql && mql.matches);
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', dark ? '#0b1220' : '#0f766e');
    $$('[data-act="theme"] use').forEach(function (u) { u.setAttribute('href', dark ? '#i-sun' : '#i-moon'); });
    Pref.set('theme', pref);
  }
  if (mql && mql.addEventListener) mql.addEventListener('change', function () { if (themePref() === 'auto') { applyTheme(); if (S) render(); } });
  function toggleTheme() {
    var dark = document.documentElement.getAttribute('data-theme') === 'dark';
    if (S) { S.settings.theme = dark ? 'light' : 'dark'; scheduleSave(); }
    Pref.set('theme', dark ? 'light' : 'dark');
    applyTheme();
    if (S) render();
  }
  function isPrivacy() { return document.body.classList.contains('privacy'); }
  function applyPrivacy(on) {
    document.body.classList.toggle('privacy', !!on);
    $$('[data-act="privacy"]').forEach(function (b) {
      b.setAttribute('aria-pressed', String(!!on));
      var u = $('use', b); if (u) u.setAttribute('href', on ? '#i-eye-off' : '#i-eye');
      if (b.classList.contains('icon-btn')) b.setAttribute('aria-label', on ? 'מצב פרטיות פעיל: הצג סכומים' : 'מצב פרטיות: הסתר סכומים');
    });
  }
  function togglePrivacy() {
    var on = !isPrivacy();
    applyPrivacy(on);
    if (S) { S.settings.privacy = on; scheduleSave(); render(); }
  }

  /* =====================================================================
   * גרפים (Chart.js) — RTL, עברית, ערכת צבעים
   * ===================================================================== */
  function cssVar(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }
  function palette() {
    return {
      text: cssVar('--text-2'), muted: cssVar('--muted'), grid: cssVar('--chart-grid'), surface: cssVar('--surface'),
      pos: cssVar('--pos'), neg: cssVar('--neg'), warn: cssVar('--warn'), primary: cssVar('--primary'), accent: cssVar('--accent'), border: cssVar('--border')
    };
  }
  function alpha(hex, a) {
    if (!hex || hex[0] !== '#') return hex;
    var h = hex.length === 4 ? hex.replace(/#(.)(.)(.)/, '#$1$1$2$2$3$3') : hex;
    var n = parseInt(h.slice(1), 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }
  function tickMoney(v) { return isPrivacy() ? '•••' : F(Math.round(v * 100), { compact: true }); }
  function chartBase(extra) {
    var p = palette();
    var base = {
      responsive: true, maintainAspectRatio: false, locale: 'he-IL',
      animation: reducedMotion ? false : { duration: 700, easing: 'easeOutQuart' },
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { rtl: true, textDirection: 'rtl', position: 'bottom', labels: { color: p.text, usePointStyle: true, pointStyle: 'circle', boxWidth: 8, boxHeight: 8, padding: 14, font: { size: 12 } } },
        tooltip: {
          rtl: true, textDirection: 'rtl', backgroundColor: cssVar('--text'), titleColor: cssVar('--bg'), bodyColor: cssVar('--bg'),
          padding: 10, cornerRadius: 10, boxPadding: 4, usePointStyle: true,
          callbacks: {
            label: function (ctx) {
              var v = ctx.parsed.y !== undefined ? ctx.parsed.y : ctx.parsed;
              if (ctx.dataset.isPct) return ' ' + ctx.dataset.label + ': ' + (isPrivacy() ? '•••' : Math.round(v) + '%');
              return ' ' + (ctx.dataset.label || ctx.label) + ': ' + (isPrivacy() ? '•••' : F(Math.round(v * 100)));
            }
          }
        }
      }
    };
    return deepMerge(base, extra || {});
  }
  function deepMerge(a, b) {
    Object.keys(b).forEach(function (k) {
      if (b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) && a[k] && typeof a[k] === 'object' && !Array.isArray(a[k])) deepMerge(a[k], b[k]);
      else a[k] = b[k];
    });
    return a;
  }
  function axisX(extra) { var p = palette(); return deepMerge({ grid: { display: false }, border: { color: p.border }, ticks: { color: p.text, maxRotation: 0, autoSkipPadding: 12, font: { size: 11 } } }, extra || {}); }
  function axisY(extra) { var p = palette(); return deepMerge({ position: 'right', grid: { color: p.grid }, border: { display: false }, ticks: { color: p.text, callback: tickMoney, font: { size: 11 }, maxTicksLimit: 6 } }, extra || {}); }
  function makeChart(id, canvas, cfg) {
    if (!canvas) return null;
    if (charts[id]) { try { charts[id].destroy(); } catch (e) { /* */ } }
    if (typeof window.Chart === 'undefined') { canvas.parentNode.innerHTML = '<p class="muted center">ספריית הגרפים לא נטענה.</p>'; return null; }
    try { charts[id] = new window.Chart(canvas, cfg); return charts[id]; }
    catch (e) { canvas.parentNode.innerHTML = '<p class="muted center">לא ניתן להציג את הגרף.</p>'; return null; }
  }
  function destroyCharts() { Object.keys(charts).forEach(function (k) { try { charts[k].destroy(); } catch (e) { /* */ } }); charts = {}; }
  if (window.Chart) {
    window.Chart.defaults.font.family = getComputedStyle(document.documentElement).getPropertyValue('--font') || 'system-ui';
  }

  /* ---------- מונים מונפשים ---------- */
  function animateCounters(root) {
    $$('[data-count]', root).forEach(function (el) {
      var target = Number(el.getAttribute('data-count'));
      var kind = el.getAttribute('data-fmt') || 'ils';
      var fmt = function (v) {
        if (kind === 'pct') return Math.round(v) + '%';
        if (kind === 'months') return v.toFixed(1);
        return F(Math.round(v));
      };
      if (reducedMotion || !isFinite(target)) { el.textContent = isFinite(target) ? fmt(target) : '—'; return; }
      var start = performance.now(), dur = 900;
      var step = function (now) {
        var t = Math.min(1, (now - start) / dur);
        var e = 1 - Math.pow(1 - t, 3);
        el.textContent = fmt(target * e);
        if (t < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  }

  /* =====================================================================
   * נעילה, פתיחה, הגדרה ראשונית
   * ===================================================================== */
  function attempts() { return Pref.get('attempts', { fails: 0, until: 0 }); }
  function setAttempts(a) { Pref.set('attempts', a); }

  function lockShell(inner) {
    return '<div class="lock-wrap"><div class="lock-card">' +
      '<div class="brand"><svg class="brand-logo" viewBox="0 0 64 64" aria-hidden="true"><use href="#logo"/></svg><div><div class="brand-name">מצפן כספי</div><div class="brand-sub">ניהול כספים פרטי ומוצפן</div></div></div>' +
      inner + '</div></div>';
  }

  function strengthHTML() {
    return '<div class="strength" aria-hidden="true"><span></span></div><div class="hint" data-strength-label>מינימום ' + MIN_PW + ' תווים</div>';
  }
  function bindStrength(root, input) {
    var bar = $('.strength > span', root), lbl = $('[data-strength-label]', root);
    var colors = ['#dc2626', '#ea580c', '#ca8a04', '#16a34a', '#15803d'];
    input.addEventListener('input', function () {
      var s = C.passwordStrength(input.value);
      bar.style.width = input.value ? ((s.score + 1) * 20) + '%' : '0';
      bar.style.background = colors[s.score];
      lbl.textContent = input.value ? 'חוזק: ' + s.label + (input.value.length < MIN_PW ? ' · חסרים ' + (MIN_PW - input.value.length) + ' תווים' : '') : 'מינימום ' + MIN_PW + ' תווים';
    });
  }

  function showLockRoot(html) {
    $('#app').hidden = true;
    var lr = $('#lock-root');
    lr.hidden = false;
    lr.innerHTML = html;
    return lr;
  }

  function renderNoCrypto() {
    showLockRoot(lockShell('<h1>נדרש חיבור מאובטח</h1><p class="muted">הדפדפן לא מאפשר הצפנה בכתובת הזו. פתח את האתר בכתובת https, ב-localhost, או ישירות מהקובץ במחשב.</p>'));
  }

  function renderSetup() {
    var lr = showLockRoot(lockShell(
      '<div class="wizard-steps" aria-hidden="true"><span class="on"></span><span></span><span></span><span></span><span></span></div>' +
      '<h1>ברוך הבא 👋</h1><p class="muted">כל הנתונים נשמרים רק בדפדפן הזה, מוצפנים בסיסמה שתבחר עכשיו. אף אחד, כולל אנחנו, לא יכול לראות אותם.</p>' +
      '<form id="setup-form" class="stack mt" novalidate>' +
      '<div class="field" data-field="pw"><label for="pw1">בחר סיסמה</label><input class="input" type="password" id="pw1" name="pw" autocomplete="new-password" autofocus aria-describedby="pw-hint">' + strengthHTML() + '<div class="err" role="alert"></div></div>' +
      '<div class="field" data-field="pw2"><label for="pw2">הקלד שוב את הסיסמה</label><input class="input" type="password" id="pw2" name="pw2" autocomplete="new-password"><div class="err" role="alert"></div></div>' +
      '<div class="banner warn small" id="pw-hint"><span class="b-icon" aria-hidden="true">⚠️</span><span class="b-text">אין אפשרות לשחזר סיסמה שנשכחה. בלי הסיסמה אי אפשר לפענח את הנתונים. שמור אותה במנהל סיסמאות.</span></div>' +
      '<button class="btn block" type="submit" id="setup-btn">צור כספת מוצפנת</button></form>'));
    var form = $('#setup-form', lr);
    bindStrength(lr, $('#pw1', lr));
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var v = readForm(form), errs = {};
      if (v.pw.length < MIN_PW) errs.pw = 'הסיסמה חייבת להכיל לפחות ' + MIN_PW + ' תווים';
      else if (v.pw !== v.pw2) errs.pw2 = 'הסיסמאות לא תואמות';
      if (!showErrors(form, errs)) return;
      var btn = $('#setup-btn', lr); btn.disabled = true; btn.textContent = 'מצפין…';
      var salt = Crypto.random(16);
      Crypto.deriveKey(v.pw, salt, KDF_ITER).then(function (key) {
        KEY = key; SALT = Crypto.b64(salt); ITER = KDF_ITER;
        S = C.createEmptyState(today());
        S.settings.theme = Pref.get('theme', 'auto');
        S.meta.onboardStep = 2;
        dirty = true;
        return flushSave();
      }).then(function () { renderWizard(2); }).catch(function (err) {
        btn.disabled = false; btn.textContent = 'צור כספת מוצפנת';
        toast('יצירת הכספת נכשלה: ' + friendly(err), 'error');
      });
    });
  }

  var unlockCountdown = null;
  function renderUnlock(msg) {
    var lr = showLockRoot(lockShell(
      '<h1>ברוך שובך</h1><p class="muted">הזן את הסיסמה כדי לפתוח את הנתונים המוצפנים.</p>' +
      (msg ? '<div class="banner mt small" role="status"><span class="b-text">' + esc(msg) + '</span></div>' : '') +
      '<form id="unlock-form" class="stack mt" novalidate>' +
      '<div class="field" data-field="pw"><label for="upw">סיסמה</label><input class="input" type="password" id="upw" name="pw" autocomplete="current-password" autofocus><div class="err" id="unlock-err" role="alert"></div></div>' +
      '<button class="btn block" type="submit" id="unlock-btn">פתח</button>' +
      '<button class="btn ghost block small" type="button" id="forgot-btn">שכחתי סיסמה</button></form>'));
    var form = $('#unlock-form', lr), btn = $('#unlock-btn', lr), errEl = $('#unlock-err', lr);
    setTimeout(function () { var i = $('#upw', lr); if (i) i.focus(); }, 50);
    var tick = function () {
      clearInterval(unlockCountdown);
      var a = attempts();
      var left = Math.ceil((a.until - Date.now()) / 1000);
      if (left > 0) {
        btn.disabled = true;
        errEl.textContent = 'סיסמה שגויה. יותר מדי ניסיונות — נסה שוב בעוד ' + left + ' שניות.';
        unlockCountdown = setInterval(function () {
          var l = Math.ceil((attempts().until - Date.now()) / 1000);
          if (l <= 0) { clearInterval(unlockCountdown); btn.disabled = false; errEl.textContent = ''; }
          else errEl.textContent = 'סיסמה שגויה. יותר מדי ניסיונות — נסה שוב בעוד ' + l + ' שניות.';
        }, 1000);
      }
    };
    tick();
    $('#forgot-btn', lr).addEventListener('click', function () {
      openModal({
        title: 'שכחתי סיסמה',
        body: '<p>הנתונים מוצפנים בסיסמה שלך, והיא לא נשמרת בשום מקום — לכן <b>אי אפשר לשחזר אותה</b>.</p><ul class="small" style="padding-inline-start:18px;line-height:1.8"><li>נסה סיסמאות שאתה משתמש בהן בדרך כלל, או בדוק במנהל הסיסמאות.</li><li>אם יש לך קובץ גיבוי ואתה זוכר את הסיסמה שלו — אפס ושחזר ממנו.</li><li>אחרת, אפשר לאפס הכל ולהתחיל מחדש. כל הנתונים יימחקו.</li></ul>',
        footer: '<button class="btn danger" type="button" data-reset>אפס ומחק הכל</button><button class="btn secondary" type="button" data-close>חזרה</button>',
        onMount: function (dlg, m) { $('[data-reset]', dlg).addEventListener('click', function () { m.close(); resetFlow(); }); }
      });
    });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var pw = $('#upw', lr).value;
      if (!pw) { errEl.textContent = 'יש להזין סיסמה'; return; }
      if (attempts().until > Date.now()) { tick(); return; }
      btn.disabled = true; btn.textContent = 'פותח…'; errEl.textContent = '';
      var vault;
      Store.get('vault').then(function (v) {
        if (!v || !v.kdf) throw new Error('NOVAULT');
        vault = v;
        return Crypto.deriveKey(pw, Crypto.unb64(v.kdf.salt), v.kdf.iterations);
      }).then(function (key) {
        return Crypto.decrypt(key, vault.iv, vault.data).then(function (obj) { return { key: key, obj: obj }; }, function () { throw new Error('WRONG'); });
      }).then(function (r) {
        setAttempts({ fails: 0, until: 0 });
        KEY = r.key; SALT = vault.kdf.salt; ITER = vault.kdf.iterations;
        try { S = C.migrate(r.obj); } catch (err) { KEY = null; throw err; }
        if (r.obj.schemaVersion !== S.schemaVersion) dirty = true;
        onUnlocked();
      }).catch(function (err) {
        btn.disabled = false; btn.textContent = 'פתח';
        if (err && err.message === 'WRONG') {
          var a = attempts(); a.fails += 1;
          if (a.fails >= 5) a.until = Date.now() + Math.min(300, 5 * Math.pow(2, a.fails - 5)) * 1000;
          setAttempts(a);
          errEl.textContent = 'סיסמה שגויה';
          $('#upw', lr).select();
          tick();
        } else if (err && err.message === 'NOVAULT') { renderSetup(); }
        else errEl.textContent = 'לא ניתן לפתוח את הנתונים: ' + friendly(err);
      });
    });
  }

  /** נעילה: שומר שינויים ממתינים, ואז מוחק את המפתח והנתונים מהזיכרון. */
  function lock(msg) {
    if (!KEY) return;
    var finish = function () {
      KEY = null; S = null; SALT = null;
      destroyCharts(); closeAllModals(); hideTip();
      $('#view').innerHTML = ''; $('#banners').innerHTML = ''; $('#print-report').innerHTML = '';
      $('#toasts').innerHTML = '';
      renderUnlock(msg || 'האפליקציה ננעלה.');
    };
    flushSave().then(finish, finish);
  }

  /* ---------- זיהוי חוסר פעילות ---------- */
  var lastActivity = Date.now();
  ['pointerdown', 'keydown', 'wheel', 'touchstart', 'input'].forEach(function (ev) {
    document.addEventListener(ev, function () { lastActivity = Date.now(); }, { passive: true, capture: true });
  });
  function checkIdle() {
    if (!KEY || !S) return;
    var mins = Number(S.settings.lockMinutes) || 10;
    if (Date.now() - lastActivity > mins * 60000) lock('ננעל אוטומטית אחרי ' + mins + ' דקות ללא פעילות.');
  }
  setInterval(checkIdle, 10000);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) checkIdle(); else if (dirty) flushSave(); });

  /* =====================================================================
   * אשף הגדרה ראשונית (צעדים 2–5)
   * ===================================================================== */
  function wizardSteps(n) {
    var s = '';
    for (var i = 1; i <= 5; i++) s += '<span class="' + (i <= n ? 'on' : '') + '"></span>';
    return '<div class="wizard-steps" aria-label="שלב ' + n + ' מתוך 5">' + s + '</div>';
  }
  function lastOccurrence(day) {
    // המופע האחרון של יום בחודש שכבר עבר (כדי שהחודש הנוכחי יכלול אותו)
    var t = today(), p = C.parseISO(t);
    var d = Math.min(day, C.daysInMonth(p.y, p.m));
    var thisMonth = C.makeISO(p.y, p.m, d);
    return thisMonth <= t ? thisMonth : C.addMonths(C.makeISO(p.y, p.m, 1), -1, day);
  }
  function mkSeries(kind, amount, freq, startDate, cat, note, extra) {
    var c = S.categories.filter(function (x) { return x.id === cat; })[0] || {};
    return Object.assign({
      id: C.uid('s'), kind: kind, amount: amount, freq: freq, startDate: startDate, endDate: null, categoryId: cat, sub: '',
      payment: 'הוראת קבע', essential: kind === 'expense' ? !!c.essential : false, note: note || '', group: c.group || null,
      incomeType: kind === 'income' ? 'fixed' : null, skips: []
    }, extra || {});
  }
  function finishOnboarding() {
    S.meta.onboarded = true; delete S.meta.onboardStep;
    var r = C.materializeRecurring(S.series, S.transactions, today());
    S.transactions = r.transactions;
    scheduleSave();
    onUnlocked();
  }
  function loadDemoFromWizard() {
    var created = S.meta.createdAt;
    var theme = S.settings.theme;
    S = C.generateDemo(today());
    S.meta.createdAt = created; S.settings.theme = theme;
    S.meta.lastBackupAt = today();
    scheduleSave();
    onUnlocked();
    toast('נטענו נתוני דמו. אפשר למחוק אותם בכל רגע.');
  }
  function renderWizard(step) {
    S.meta.onboardStep = step; scheduleSave();
    var body = '', title = '', sub = '';
    if (step === 2) {
      title = 'ההכנסה העיקרית'; sub = 'כמה נכנס לחשבון כל חודש (נטו)? אפשר לשנות הכל אחר כך.';
      body = '<div class="form-grid">' + fld({ name: 'salary', label: 'משכורת נטו חודשית', type: 'amount', big: true, full: true, attrs: 'autofocus' }) +
        fld({ name: 'day', label: 'באיזה יום בחודש היא נכנסת?', type: 'number', value: 10 }) +
        fld({ name: 'salary2', label: 'הכנסה נוספת קבועה (בן/בת זוג)', type: 'amount' }) +
        fld({ name: 'finStart', label: 'התחל את החודש הכלכלי ביום המשכורת', type: 'switch', value: true, full: true, hint: 'כך "החודש" שלך מתחיל כשהכסף נכנס, ולא ב-1 לחודש.' }) + '</div>';
    } else if (step === 3) {
      title = 'הוצאות קבועות עיקריות'; sub = 'מלא רק מה שרלוונטי. הסכומים חודשיים, חוץ מארנונה (דו-חודשית).';
      body = '<div class="form-grid">' + [
        ['rent', 'שכירות / משכנתא'], ['arnona', 'ארנונה (לתשלום דו-חודשי)'], ['insurance', 'ביטוחים'], ['comm', 'סלולר ואינטרנט'],
        ['subs', 'מנויים (סטרימינג, כושר…)'], ['edu', 'גן / חינוך'], ['loans', 'החזרי הלוואות'], ['utilities', 'חשמל, מים וגז (חודשי)']
      ].map(function (r) { return fld({ name: r[0], label: r[1], type: 'amount' }); }).join('') + '</div>';
    } else if (step === 4) {
      title = 'חסכונות והשקעות'; sub = 'יתרות נוכחיות והפקדות חודשיות. משמש לשווי הנקי ולתחזיות.';
      body = '<div class="form-grid">' +
        fld({ name: 'age', label: 'גיל נוכחי', type: 'number', value: S.settings.age }) +
        fld({ name: 'checking', label: 'יתרת עו"ש', type: 'amount' }) +
        fld({ name: 'hish', label: 'קרן השתלמות — יתרה', type: 'amount' }) + fld({ name: 'hishM', label: 'קרן השתלמות — הפקדה חודשית', type: 'amount' }) +
        fld({ name: 'pension', label: 'פנסיה — יתרה', type: 'amount' }) + fld({ name: 'pensionM', label: 'פנסיה — הפקדה חודשית', type: 'amount' }) +
        fld({ name: 'invest', label: 'תיק השקעות — יתרה', type: 'amount' }) + fld({ name: 'investM', label: 'תיק השקעות — הפקדה חודשית', type: 'amount' }) + '</div>';
    } else if (step === 5) {
      title = 'יעד ראשון'; sub = 'יעד ברור הוא המניע הכי טוב לחיסכון. קרן חירום היא התחלה מצוינת.';
      body = '<div class="form-grid">' + fld({ name: 'gname', label: 'שם היעד', value: 'קרן חירום', full: true }) +
        fld({ name: 'gtarget', label: 'סכום יעד', type: 'amount' }) + fld({ name: 'gdate', label: 'עד מתי? (אופציונלי)', type: 'date', value: C.addMonths(today(), 12) }) + '</div>';
    }
    var lr = showLockRoot(lockShell(wizardSteps(step) + '<h1>' + esc(title) + '</h1><p class="muted">' + esc(sub) + '</p>' +
      '<form id="wiz-form" class="mt" novalidate>' + body +
      '<div class="row wrap mt"><button class="btn grow" type="submit">' + (step === 5 ? 'סיום — לדשבורד' : 'המשך') + '</button><button class="btn secondary" type="button" data-skip>דלג</button></div>' +
      '<button class="btn ghost block small mt-s" type="button" data-demo>דלג על הכל וטען נתוני דמו</button></form>'));
    var form = $('#wiz-form', lr);
    var next = function () { if (step >= 5) finishOnboarding(); else renderWizard(step + 1); };
    $('[data-skip]', lr).addEventListener('click', next);
    $('[data-demo]', lr).addEventListener('click', loadDemoFromWizard);
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var v = readForm(form), errs = {};
      var chkAmt = function (k, optional) {
        if (!v[k] && optional) return 0;
        var a = amtVal(v[k]);
        if (isNaN(a)) errs[k] = 'יש להזין סכום תקין';
        else if (a < 0) errs[k] = 'הסכום לא יכול להיות שלילי';
        return a;
      };
      if (step === 2) {
        var sal = chkAmt('salary', true), sal2 = chkAmt('salary2', true), day = parseInt(v.day, 10);
        if (!(day >= 1 && day <= 31)) errs.day = 'יום בין 1 ל-31';
        if (!showErrors(form, errs)) return;
        if (sal > 0) S.series.push(mkSeries('income', sal, 'monthly', lastOccurrence(day), 'inc_salary', 'משכורת', { payment: 'העברה בנקאית' }));
        if (sal2 > 0) S.series.push(mkSeries('income', sal2, 'monthly', lastOccurrence(day), 'inc_salary', 'הכנסה נוספת', { payment: 'העברה בנקאית' }));
        if (v.finStart && day <= 28) S.settings.monthStartDay = day;
      } else if (step === 3) {
        var map = { rent: ['exp_housing', 'שכירות / משכנתא', 'monthly', 1], arnona: ['exp_arnona', 'ארנונה', 'bimonthly', 1], insurance: ['exp_insurance', 'ביטוחים', 'monthly', 1],
          comm: ['exp_comm', 'סלולר ואינטרנט', 'monthly', 1], subs: ['exp_subs', 'מנויים', 'monthly', 1], edu: ['exp_education', 'גן / חינוך', 'monthly', 1],
          loans: ['exp_loans', 'החזר הלוואה', 'monthly', 10], utilities: ['exp_utilities', 'חשמל, מים וגז', 'monthly', 1] };
        var adds = [];
        Object.keys(map).forEach(function (k) { var a = chkAmt(k, true); if (a > 0) adds.push(mkSeries('expense', a, map[k][2], lastOccurrence(map[k][3]), map[k][0], map[k][1])); });
        if (!showErrors(form, errs)) return;
        S.series = S.series.concat(adds);
      } else if (step === 4) {
        var age = parseInt(v.age, 10);
        if (!(age >= 16 && age <= 100)) errs.age = 'גיל בין 16 ל-100';
        var vals = {};
        ['checking', 'hish', 'hishM', 'pension', 'pensionM', 'invest', 'investM'].forEach(function (k) { vals[k] = chkAmt(k, true); });
        if (!showErrors(form, errs)) return;
        S.settings.age = age;
        var A = function (name, type, bal, monthly, ret, feeAcc, feeDep, risk, tax, liquidDate) {
          if (!(bal > 0) && !(monthly > 0)) return;
          S.accounts.push({ id: C.uid('a'), name: name, type: type, balance: bal || 0, monthly: monthly || 0, expReturn: ret, feeAcc: feeAcc, feeDep: feeDep, risk: risk, sd: C.RISK_SD[risk], tax: tax, liquidDate: liquidDate || '', history: [{ date: today(), balance: bal || 0 }] });
        };
        A('עו"ש', 'checking', vals.checking, 0, 0, 0, 0, 'low', 'exempt');
        A('קרן השתלמות', 'hishtalmut', vals.hish, vals.hishM, 6, 0.6, 0, 'medium', 'exempt', C.addMonths(today(), 72));
        A('קרן פנסיה', 'pension', vals.pension, vals.pensionM, 5.5, 0.22, 1.5, 'medium', 'pension');
        A('תיק השקעות', 'stocks', vals.invest, vals.investM, 7, 0.1, 0, 'high', 'cgt');
      } else if (step === 5) {
        var target = chkAmt('gtarget', true);
        if (v.gdate && !C.isValidISO(v.gdate)) errs.gdate = 'תאריך לא תקין';
        if (target > 0 && !v.gname) errs.gname = 'יש להזין שם';
        if (!showErrors(form, errs)) return;
        if (target > 0) S.goals.push({ id: C.uid('g'), name: v.gname, target: target, date: v.gdate || '', accountId: null, saved: 0, monthly: 0, priority: 1, celebrated: false });
      }
      scheduleSave();
      next();
    });
  }

  /* =====================================================================
   * מעטפת: ניווט, באנרים, תחזוקה יומית
   * ===================================================================== */
  var SCREENS = [
    { id: 'dashboard', label: 'סקירה', icon: 'i-home' },
    { id: 'transactions', label: 'תנועות', icon: 'i-list' },
    { id: 'budget', label: 'תקציב', icon: 'i-pie' },
    { id: 'assets', label: 'חסכונות והשקעות', short: 'נכסים', icon: 'i-wallet' },
    { id: 'forecast', label: 'תחזית ותרחישים', short: 'תחזית', icon: 'i-trend' },
    { id: 'goals', label: 'יעדים', icon: 'i-target' },
    { id: 'close', label: 'סגירת חודש', icon: 'i-calendar' },
    { id: 'settings', label: 'הגדרות', icon: 'i-gear' }
  ];
  var SCREEN_BY_ID = {};
  SCREENS.forEach(function (s) { SCREEN_BY_ID[s.id] = s; });
  var BOTTOM = ['dashboard', 'transactions', 'forecast', 'goals'];

  function buildNav() {
    $('#side-nav').innerHTML = SCREENS.map(function (s) {
      return '<button class="nav-btn" type="button" data-nav="' + s.id + '">' + icon(s.icon) + '<span>' + esc(s.label) + '</span></button>';
    }).join('');
    $('#bottom-nav').innerHTML = BOTTOM.map(function (id) {
      var s = SCREEN_BY_ID[id];
      return '<button type="button" data-nav="' + id + '">' + icon(s.icon) + '<span>' + esc(s.short || s.label) + '</span></button>';
    }).join('') + '<button type="button" data-act="more" aria-label="עוד מסכים">' + icon('i-more') + '<span>עוד</span></button>';
  }
  function go(id) {
    if (!SCREEN_BY_ID[id]) id = 'dashboard';
    if (location.hash !== '#/' + id) location.hash = '#/' + id;
    else { route = id; render(true); }
  }
  window.addEventListener('hashchange', function () {
    if (!S || !KEY) return;
    var h = location.hash.replace(/^#\/?/, '');
    if (!SCREEN_BY_ID[h]) return;
    route = h; closeAllModals(); render(true);
    window.scrollTo(0, 0);
  });

  function openMoreSheet() {
    var items = SCREENS.filter(function (s) { return BOTTOM.indexOf(s.id) < 0; });
    var m = openModal({
      title: 'עוד',
      body: '<div class="stack" style="gap:4px">' + items.map(function (s) {
        return '<button class="nav-btn" type="button" data-more-nav="' + s.id + '">' + icon(s.icon) + '<span>' + esc(s.label) + '</span></button>';
      }).join('') + '<hr style="border:0;border-top:1px solid var(--border);margin:8px 0">' +
        '<button class="nav-btn" type="button" data-more-act="privacy">' + icon(isPrivacy() ? 'i-eye-off' : 'i-eye') + '<span>' + (isPrivacy() ? 'בטל מצב פרטיות' : 'מצב פרטיות') + '</span></button>' +
        '<button class="nav-btn" type="button" data-more-act="lock">' + icon('i-lock') + '<span>נעל עכשיו</span></button></div>',
      onMount: function (dlg) {
        $$('[data-more-nav]', dlg).forEach(function (b) { b.addEventListener('click', function () { m.close(); go(b.getAttribute('data-more-nav')); }); });
        $$('[data-more-act]', dlg).forEach(function (b) { b.addEventListener('click', function () { m.close(); ACTIONS[b.getAttribute('data-more-act')](); }); });
      }
    });
  }

  function isIOS() {
    var ua = navigator.userAgent || '';
    return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }
  function isStandalone() {
    return window.navigator.standalone === true || (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
  }
  function hasData() { return S.transactions.length > 0 || S.accounts.length > 0; }

  function banner(cls, ico, html, actions) {
    return '<div class="banner ' + cls + '"><span class="b-icon" aria-hidden="true">' + ico + '</span><span class="b-text">' + html + '</span>' + (actions || '') + '</div>';
  }
  function renderBanners() {
    var out = [];
    var t = today();
    if (S.meta.demo) out.push(banner('demo', '🧪', '<b>מצב דמו</b> — מוצגים נתונים לדוגמה של משק בית ישראלי. נתונים שתוסיף בעצמך יישמרו גם אחרי המחיקה.', '<button class="btn small" type="button" data-act="remove-demo">מחק נתוני דמו</button>'));
    if (isIOS() && !isStandalone() && !(S.meta.iosDismissed && C.daysBetween(S.meta.iosDismissed, t) < 14)) {
      out.push(banner('warn', '📱', '<b>חשוב באייפון:</b> Safari מוחק נתונים של אתר שלא נפתח 7 ימים. כדי לשמור עליהם, הוסף את האפליקציה למסך הבית: לחץ על כפתור השיתוף ואז על "הוסף למסך הבית". ובכל מקרה, גבה מדי פעם.', '<button class="btn small secondary" type="button" data-act="dismiss-ios">הבנתי</button>'));
    }
    if (hasData() && !S.meta.demo) {
      var last = S.meta.lastBackupAt || S.meta.createdAt;
      var snooze = S.meta.backupSnooze && S.meta.backupSnooze > t;
      if (last && C.daysBetween(last, t) > 14 && !snooze) {
        out.push(banner('warn', '💾', S.meta.lastBackupAt ? 'עברו ' + C.daysBetween(last, t) + ' ימים מהגיבוי האחרון. גיבוי מוצפן לוקח שנייה ומגן מפני אובדן נתונים.' : 'עוד לא גיבית את הנתונים. גיבוי מוצפן מגן מפני אובדן נתונים ומאפשר מעבר בין מכשירים.',
          '<button class="btn small" type="button" data-act="backup-now">גבה עכשיו</button><button class="btn small ghost" type="button" data-act="snooze-backup">הזכר לי מחר</button>'));
      }
    }
    if (route === 'dashboard') {
      var prevKey = closePromptKey();
      if (prevKey) out.push(banner('', '📅', 'החודש הכלכלי של <b>' + esc(C.monthLabel(prevKey)) + '</b> הסתיים. בוא נסכם אותו בדקה.', '<button class="btn small" type="button" data-act="open-close" data-key="' + prevKey + '">לסיכום החודש</button>'));
    }
    $('#banners').innerHTML = out.join('');
  }
  function closePromptKey() {
    var sd = S.settings.monthStartDay;
    var cur = C.finMonthKey(today(), sd), prev = C.shiftMonthKey(cur, -1);
    if (S.meta.lastCloseSeen && S.meta.lastCloseSeen >= prev) return null;
    var r = C.finMonthRange(prev, sd);
    var has = S.transactions.some(function (t) { return t.date >= r.start && t.date <= r.end; });
    if (!has) return null;
    if (S.meta.createdAt && S.meta.createdAt > r.end && !S.meta.demo) return null; // לא הייתה כאן בחודש הזה
    return prev;
  }

  function maintenance() {
    var t = today();
    if (lastMaint === t) return;
    lastMaint = t;
    var changed = false;
    try {
      var r = C.materializeRecurring(S.series, S.transactions, t);
      if (r.added) { S.transactions = r.transactions; changed = true; }
      changed = updateSnapshot() || changed;
    } catch (e) { toast('שגיאה בעדכון תנועות חוזרות: ' + friendly(e), 'error'); }
    if (changed) scheduleSave();
  }
  function updateSnapshot() {
    var before = JSON.stringify(S.snapshots);
    S.snapshots = C.ensureSnapshot(S.snapshots, S.accounts, S.liabilities, today());
    return before !== JSON.stringify(S.snapshots);
  }

  function onUnlocked() {
    if (!S.meta.onboarded) { applyTheme(); renderWizard(S.meta.onboardStep || 2); return; }
    applyTheme();
    applyPrivacy(!!S.settings.privacy);
    var lr = $('#lock-root'); lr.innerHTML = ''; lr.hidden = true;
    $('#app').hidden = false;
    lastActivity = Date.now();
    lastMaint = null;
    maintenance();
    if (dirty) scheduleSave();
    buildNav();
    var h = location.hash.replace(/^#\/?/, '');
    route = SCREEN_BY_ID[h] ? h : 'dashboard';
    render(true);
    requestPersist();
  }
  function requestPersist() {
    try {
      if (navigator.storage && navigator.storage.persist) {
        navigator.storage.persist().then(function (g) { persistGranted = g; }).catch(function () { persistGranted = false; });
      }
    } catch (e) { /* לא נתמך */ }
  }

  /** ציור המסך הנוכחי. */
  function render(animate) {
    if (!S) return;
    maintenance();
    hideTip();
    destroyCharts();
    var scr = SCREEN_BY_ID[route];
    $$('[data-nav]').forEach(function (b) { if (b.getAttribute('data-nav') === route) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
    $('#page-title').textContent = scr.label;
    document.title = scr.label + ' · מצפן כספי';
    $('#fab').hidden = !(route === 'dashboard' || route === 'transactions' || route === 'budget');
    renderBanners();
    var view = $('#view');
    var res;
    try { res = RENDER[route](); }
    catch (e) {
      console.error(e);
      res = { html: '<div class="card empty"><div class="e-ico">⚠️</div><h2>משהו השתבש בהצגת המסך</h2><p>' + esc(friendly(e)) + '</p><button class="btn" type="button" data-nav="dashboard">חזרה לסקירה</button></div>' };
    }
    view.innerHTML = '<div class="m-head" style="display:none"></div>' + res.html;
    if (animate && !reducedMotion) { view.classList.remove('view-enter'); void view.offsetWidth; view.classList.add('view-enter'); }
    if (res.mount) { try { res.mount(view); } catch (e) { console.error(e); toast('שגיאה בהצגת חלק מהמסך: ' + friendly(e), 'error'); } }
    animateCounters(view);
  }

  /* ---------- עזרי קטגוריות ---------- */
  function catMap() { var m = {}; S.categories.forEach(function (c) { m[c.id] = c; }); return m; }
  function catById(id) { return S.categories.filter(function (c) { return c.id === id; })[0] || { id: id, name: 'ללא קטגוריה', icon: '❔', color: '#94a3b8', kind: 'expense', group: 'occasional' }; }
  var GROUP_LABEL = { fixed: 'קבועות', variable: 'שוטפות', occasional: 'מזדמנות' };
  function catOptions(kind) {
    return S.categories.filter(function (c) { return c.kind === kind; }).map(function (c) {
      return { value: c.id, label: c.icon + ' ' + c.name, group: kind === 'expense' ? (GROUP_LABEL[c.group] || 'אחר') : null };
    });
  }
  function catChip(c) { return '<span class="chip"><span class="dot" style="background:' + esc(c.color) + '"></span>' + esc(c.icon) + ' ' + esc(c.name) + '</span>'; }
  var PAYMENTS = ['אשראי', 'מזומן', 'העברה בנקאית', 'הוראת קבע', 'ביט / פייבוקס', "צ'ק", 'אחר'];
  function txDesc(t, cm) { return t.note || t.sub || (cm[t.categoryId] || catById(t.categoryId)).name; }

  function emptyState(ico, title, text, actions) {
    return '<div class="empty"><div class="e-ico" aria-hidden="true">' + ico + '</div><h2>' + esc(title) + '</h2><p>' + text + '</p>' + (actions ? '<div class="row wrap" style="justify-content:center">' + actions + '</div>' : '') + '</div>';
  }

  /* =====================================================================
   * מסך: סקירה
   * ===================================================================== */
  function trendText(cur, prev, goodUp) {
    if (!prev) return '';
    var d = cur - prev;
    if (Math.abs(d) < 100) return '<span>ללא שינוי מהחודש הקודם</span>';
    var good = (d > 0) === goodUp;
    return '<span class="trend ' + (good ? 'up' : 'down') + '">' + (d > 0 ? '▲' : '▼') + ' <span class="amt">' + esc(F(Math.abs(d))) + '</span></span><span>לעומת החודש הקודם</span>';
  }
  function kpi(label, valueHtml, sub, ico, tipKey) {
    return '<div class="card kpi"><div class="kpi-icon" aria-hidden="true">' + ico + '</div><div class="kpi-label">' + esc(label) + (tipKey ? tip(tipKey) : '') + '</div>' +
      '<div class="kpi-value">' + valueHtml + '</div><div class="kpi-sub">' + (sub || '') + '</div></div>';
  }
  function counter(ag, fmt) { return '<span class="amt" data-count="' + ag + '" data-fmt="' + (fmt || 'ils') + '">' + esc(fmt === 'pct' ? Math.round(ag) + '%' : fmt === 'months' ? Number(ag).toFixed(1) : F(ag)) + '</span>'; }

  function renderDashboard() {
    var t = today(), sd = S.settings.monthStartDay;
    var key = C.finMonthKey(t, sd), range = C.finMonthRange(key, sd);
    var sum = C.summarizeMonth(S.transactions, key, sd);
    var prev = C.summarizeMonth(S.transactions, C.shiftMonthKey(key, -1), sd);
    var nw = C.netWorth(S.accounts, S.liabilities);
    var base = C.monthlyBaseline(S, t);
    var liq = C.liquidAssets(S.accounts, S.settings, t);
    var em = C.emergencyMonths(liq, base.essential);
    var prevSnap = S.snapshots.filter(function (s) { return s.month < t.slice(0, 7); }).slice(-1)[0];

    if (!hasData() && !S.series.length) {
      return { html: '<div class="card">' + emptyState('🧭', 'בוא נתחיל', 'הוסף את התנועה הראשונה, או טען נתוני דמו כדי לראות איך הדשבורד נראה עם נתונים אמיתיים.',
        '<button class="btn" type="button" data-act="add-tx">' + icon('i-plus') + 'הוסף תנועה</button><button class="btn secondary" type="button" data-act="load-demo">טען נתוני דמו</button><button class="btn secondary" type="button" data-nav="assets">הוסף חיסכון</button>') + '</div>' };
    }

    var savingsCls = sum.net >= 0 ? 'pos' : 'neg';
    var html = '<p class="muted small" style="margin-bottom:12px">החודש הכלכלי: ' + esc(C.formatDateHe(range.start)) + ' – ' + esc(C.formatDateHe(range.end)) + '</p>' +
      '<section class="kpis" aria-label="מדדים עיקריים">' +
      kpi('חיסכון החודש', '<span class="' + savingsCls + '">' + (sum.net >= 0 ? '▲ ' : '▼ ') + counter(sum.net) + '</span>',
        sum.income > 0 ? '<span class="badge ' + (sum.rate >= 20 ? 'ok' : sum.rate >= 10 ? 'warn' : 'bad') + '">' + Math.round(sum.rate) + '% מההכנסה</span><span>יעד מומלץ: 20%</span>' : '<span>עוד אין הכנסות החודש</span>', '🐷') +
      kpi('הכנסות החודש', counter(sum.income), trendText(sum.income, prev.income, true), '💰') +
      kpi('הוצאות החודש', counter(sum.expense), trendText(sum.expense, prev.expense, false), '🧾') +
      kpi('שווי נקי', counter(nw.net), prevSnap ? trendText(nw.net, prevSnap.net, true) : '<span>נכסים פחות התחייבויות</span>', '📈') +
      kpi('כרית ביטחון', em === null ? '<span class="muted">—</span>' : '<span data-count="' + em + '" data-fmt="months">' + em.toFixed(1) + '</span> <span style="font-size:1rem;font-weight:600">חודשים</span>',
        em === null ? '<span>הוסף הוצאות ונכסים</span>' : '<span class="badge ' + (em >= 6 ? 'ok' : em >= 3 ? 'warn' : 'bad') + '">' + (em >= 6 ? 'מצוין' : em >= 3 ? 'סביר' : 'נמוך') + '</span><span>מומלץ: 3 עד 6</span>', '🛟', 'emergency') +
      '</section>';

    html += '<section class="cols-2 section">' +
      '<div class="card"><div class="card-h"><h2>הכנסות מול הוצאות</h2><span class="muted small">12 חודשים אחרונים</span></div><div class="chart-box"><canvas id="ch-cashflow" aria-label="גרף עמודות של הכנסות והוצאות ב-12 החודשים האחרונים עם קו שיעור חיסכון" role="img"></canvas></div></div>' +
      '<div class="card"><div class="card-h"><h2>לאן הולך הכסף</h2><span class="muted small">' + esc(C.monthLabel(key)) + '</span></div>' +
      (sum.expense > 0 ? '<div class="chart-box"><canvas id="ch-donut" role="img" aria-label="התפלגות הוצאות החודש לפי קטגוריה. לחיצה על פלח מציגה את התנועות"></canvas></div><p class="hint center mt-s">לחץ על פלח כדי לראות את התנועות</p>'
        : emptyState('🍩', 'אין הוצאות החודש', 'כשתוסיף הוצאות, תראה כאן לאן הולך הכסף.', '')) + '</div></section>';

    var budgets = C.budgetStatus(S.categories, S.transactions, key, sd);
    var insights = C.generateInsights(S, t);
    html += '<section class="cols-2 section">' +
      '<div class="card"><div class="card-h"><h2>💡 תובנות החודש</h2></div>' +
      (insights.length ? insights.map(function (i) {
        var ico = i.tone === 'good' ? '✅' : i.tone === 'warn' ? '⚠️' : '💡';
        return '<div class="insight ' + i.tone + '"><span class="i-ico" aria-hidden="true">' + ico + '</span><p>' + esc(i.text) + '</p></div>';
      }).join('') : emptyState('🔎', 'עוד מעט יהיו כאן תובנות', 'אחרי חודש-חודשיים של נתונים יופיעו כאן תובנות אישיות שיעזרו לך לחסוך.', '')) + '</div>' +
      '<div class="card"><div class="card-h"><h2>תקציב החודש</h2><button class="btn small secondary" type="button" data-nav="budget">ניהול תקציב</button></div>' +
      (budgets.length ? budgets.sort(function (a, b) { return b.pct - a.pct; }).map(budgetRow).join('')
        : emptyState('🎯', 'עוד לא הגדרת תקציב', 'תקציב לקטגוריות כמו סופר ומסעדות הוא הכלי הכי פשוט לשלוט בהוצאות השוטפות.', '<button class="btn small" type="button" data-nav="budget">הגדר תקציב</button>')) + '</div></section>';

    return {
      html: html,
      mount: function () {
        var p = palette();
        var hist = C.monthlyHistory(S.transactions, key, 12, sd);
        makeChart('cashflow', $('#ch-cashflow'), {
          type: 'bar',
          data: {
            labels: hist.map(function (h) { return C.monthLabel(h.key, true); }),
            datasets: [
              { label: 'הכנסות', data: hist.map(function (h) { return h.income / 100; }), backgroundColor: alpha(p.pos, 0.85), borderRadius: 6, maxBarThickness: 22, order: 2 },
              { label: 'הוצאות', data: hist.map(function (h) { return h.expense / 100; }), backgroundColor: alpha(p.neg, 0.8), borderRadius: 6, maxBarThickness: 22, order: 2 },
              { label: 'שיעור חיסכון', type: 'line', isPct: true, data: hist.map(function (h) { return h.income > 0 ? Math.round(h.rate) : null; }), yAxisID: 'y1', borderColor: p.accent, backgroundColor: p.accent, tension: 0.35, pointRadius: 3, borderWidth: 2.5, order: 1 }
            ]
          },
          options: chartBase({ scales: { x: axisX(), y: axisY({ beginAtZero: true }), y1: { position: 'left', grid: { display: false }, border: { display: false }, ticks: { color: p.text, callback: function (v) { return v + '%'; }, maxTicksLimit: 5, font: { size: 11 } } } } })
        });
        if (sum.expense > 0) {
          var cm = catMap();
          var entries = Object.keys(sum.byCategory).map(function (id) { return { id: id, v: sum.byCategory[id], c: cm[id] || catById(id) }; }).sort(function (a, b) { return b.v - a.v; });
          makeChart('donut', $('#ch-donut'), {
            type: 'doughnut',
            data: { labels: entries.map(function (e) { return e.c.name; }), datasets: [{ data: entries.map(function (e) { return e.v / 100; }), backgroundColor: entries.map(function (e) { return e.c.color; }), borderColor: p.surface, borderWidth: 2, hoverOffset: 8 }] },
            options: chartBase({
              cutout: '64%', interaction: { mode: 'nearest', intersect: true },
              plugins: { legend: { position: 'bottom', labels: { boxWidth: 8 } }, tooltip: { callbacks: { label: function (ctx) { var tot = sum.expense / 100; return ' ' + ctx.label + ': ' + (isPrivacy() ? '•••' : F(Math.round(ctx.parsed * 100))) + ' (' + Math.round(ctx.parsed / tot * 100) + '%)'; } } } },
              onClick: function (evt, els) {
                if (!els.length) return;
                var e = entries[els[0].index];
                ui.tx = Object.assign(ui.tx, { q: '', period: 'm:' + key, kind: 'expense', cat: e.id, min: '', max: '', tab: 'list' });
                go('transactions');
              },
              onHover: function (evt, els) { evt.native.target.style.cursor = els.length ? 'pointer' : 'default'; }
            })
          });
        }
        animateBars();
      }
    };
  }
  function budgetRow(b) {
    var cls = b.status === 'over' ? 'over' : b.status === 'warn' ? 'warn' : '';
    var left = b.budget - b.spent;
    return '<div class="budget-row"><div class="row" style="gap:8px;min-width:0"><span aria-hidden="true">' + esc(b.icon) + '</span><b class="grow" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(b.name) + '</b></div>' +
      '<div class="small nowrap">' + money(b.spent) + ' <span class="muted">/ ' + money(b.budget) + '</span></div>' +
      '<div class="bar ' + cls + '" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + Math.round(b.pct) + '" aria-label="' + esc(b.name) + ': ' + Math.round(b.pct) + '% מהתקציב"><span data-w="' + Math.min(100, b.pct) + '"></span></div>' +
      '<div class="tiny ' + (left < 0 ? 'neg' : 'muted') + '" style="grid-column:1/-1">' + (left < 0 ? '▼ חריגה של ' + money(-left) : 'נותרו ' + money(left) + ' (' + Math.round(b.pct) + '% נוצל)') + '</div></div>';
  }
  function animateBars() {
    requestAnimationFrame(function () { $$('.bar > span[data-w]').forEach(function (s) { s.style.width = s.getAttribute('data-w') + '%'; }); });
  }

  /* =====================================================================
   * מסך: תנועות
   * ===================================================================== */
  function periodOptions() {
    var sd = S.settings.monthStartDay, cur = C.finMonthKey(today(), sd);
    var o = [{ value: 'all', label: 'כל התקופות' }];
    C.lastMonthKeys(cur, 13).reverse().forEach(function (k) { o.push({ value: 'm:' + k, label: C.monthLabel(k) }); });
    o.push({ value: '3m', label: '3 חודשים אחרונים' }, { value: 'year', label: 'השנה הנוכחית' }, { value: 'custom', label: 'טווח תאריכים…' });
    return o;
  }
  function periodRange(p) {
    var sd = S.settings.monthStartDay, cur = C.finMonthKey(today(), sd);
    if (!p || p === 'all') return null;
    if (p.indexOf('m:') === 0) return C.finMonthRange(p.slice(2), sd);
    if (p === '3m') return { start: C.finMonthRange(C.shiftMonthKey(cur, -2), sd).start, end: '9999-12-31' };
    if (p === 'year') return { start: today().slice(0, 4) + '-01-01', end: today().slice(0, 4) + '-12-31' };
    if (p === 'custom') return { start: ui.tx.from || '0000-01-01', end: ui.tx.to || '9999-12-31' };
    return null;
  }
  function filteredTx() {
    var f = ui.tx, cm = catMap();
    var r = periodRange(f.period);
    var q = f.q.toLowerCase();
    var min = f.min ? C.toAgorot(f.min) : null, max = f.max ? C.toAgorot(f.max) : null;
    var list = S.transactions.filter(function (t) {
      if (r && (t.date < r.start || t.date > r.end)) return false;
      if (f.kind !== 'all' && t.kind !== f.kind) return false;
      if (f.cat !== 'all' && t.categoryId !== f.cat) return false;
      if (min !== null && !isNaN(min) && t.amount < min) return false;
      if (max !== null && !isNaN(max) && t.amount > max) return false;
      if (q) {
        var c = cm[t.categoryId];
        var hay = [t.note, t.sub, t.payment, c ? c.name : '', agToInput(t.amount)].join(' ').toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    });
    var dir = f.dir;
    list.sort(function (a, b) {
      var x, y;
      if (f.sort === 'amount') { x = a.kind === 'income' ? a.amount : -a.amount; y = b.kind === 'income' ? b.amount : -b.amount; }
      else if (f.sort === 'category') { x = (cm[a.categoryId] || {}).name || ''; y = (cm[b.categoryId] || {}).name || ''; }
      else if (f.sort === 'desc') { x = txDesc(a, cm); y = txDesc(b, cm); }
      else { x = a.date; y = b.date; }
      if (x < y) return -dir; if (x > y) return dir;
      return a.id < b.id ? dir : -dir;
    });
    return list;
  }

  function renderTransactions() {
    var f = ui.tx;
    var tabs = '<div class="seg" role="tablist" aria-label="תצוגה"><button type="button" role="tab" data-txtab="list" aria-pressed="' + (f.tab === 'list') + '" aria-selected="' + (f.tab === 'list') + '">כל התנועות</button><button type="button" role="tab" data-txtab="series" aria-pressed="' + (f.tab === 'series') + '" aria-selected="' + (f.tab === 'series') + '">תנועות חוזרות (' + S.series.length + ')</button></div>';
    var head = '<div class="row wrap between" style="margin-bottom:14px">' + tabs + '<div class="row wrap">' +
      '<button class="btn small secondary" type="button" data-act="import-csv">' + icon('i-upload') + 'ייבוא CSV</button>' +
      '<button class="btn small secondary" type="button" data-act="export-csv">' + icon('i-download') + 'ייצוא CSV</button>' +
      '<button class="btn small" type="button" data-act="add-tx">' + icon('i-plus') + 'תנועה חדשה</button></div></div>';
    if (f.tab === 'series') return { html: head + renderSeriesList(), mount: bindTxTabs };
    var catOpts = [{ value: 'all', label: 'כל הקטגוריות' }].concat(catOptions('expense'), catOptions('income').map(function (o) { o.group = 'הכנסות'; return o; }));
    var html = head + '<div class="card"><div class="toolbar" role="search">' +
      '<input class="input search" type="search" id="tx-q" placeholder="חיפוש לפי תיאור, קטגוריה או סכום…" aria-label="חיפוש תנועות" value="' + esc(f.q) + '">' +
      selectHTML('tx-period', 'תקופה', periodOptions(), f.period) +
      selectHTML('tx-kind', 'סוג', [{ value: 'all', label: 'הכל' }, { value: 'expense', label: 'הוצאות' }, { value: 'income', label: 'הכנסות' }], f.kind) +
      selectHTML('tx-cat', 'קטגוריה', catOpts, f.cat) +
      '<input class="input ltr" style="width:110px" id="tx-min" inputmode="decimal" placeholder="מסכום" aria-label="סכום מינימלי" value="' + esc(f.min) + '">' +
      '<input class="input ltr" style="width:110px" id="tx-max" inputmode="decimal" placeholder="עד סכום" aria-label="סכום מקסימלי" value="' + esc(f.max) + '">' +
      (hasFilters() ? '<button class="btn small ghost" type="button" id="tx-clear">נקה סינון</button>' : '') + '</div>' +
      (f.period === 'custom' ? '<div class="toolbar"><label class="small">מתאריך <input class="input" type="date" id="tx-from" value="' + esc(f.from) + '"></label><label class="small">עד תאריך <input class="input" type="date" id="tx-to" value="' + esc(f.to) + '"></label></div>' : '') +
      '<div id="tx-results"></div></div>';
    return {
      html: html,
      mount: function (root) {
        bindTxTabs(root);
        renderTxResults();
        var q = $('#tx-q');
        q.addEventListener('input', debounce(function () { ui.tx.q = q.value.trim(); ui.tx.limit = 100; renderTxResults(); }, 150));
        var bindSel = function (id, key, full) {
          var el = $('#' + id); if (!el) return;
          el.addEventListener('change', function () { ui.tx[key] = el.value; ui.tx.limit = 100; if (full) render(); else renderTxResults(); });
        };
        bindSel('tx-period', 'period', true); bindSel('tx-kind', 'kind'); bindSel('tx-cat', 'cat'); bindSel('tx-from', 'from'); bindSel('tx-to', 'to');
        ['tx-min', 'tx-max'].forEach(function (id) { var el = $('#' + id); el.addEventListener('input', debounce(function () { ui.tx[id === 'tx-min' ? 'min' : 'max'] = el.value.trim(); renderTxResults(); }, 250)); });
        var clr = $('#tx-clear'); if (clr) clr.addEventListener('click', function () { Object.assign(ui.tx, { q: '', period: 'all', kind: 'all', cat: 'all', min: '', max: '', from: '', to: '' }); render(); });
      }
    };
  }
  function hasFilters() { var f = ui.tx; return f.q || f.period !== 'all' || f.kind !== 'all' || f.cat !== 'all' || f.min || f.max; }
  function selectHTML(id, label, options, value) {
    var groups = {}, order = [], plain = '';
    options.forEach(function (op) {
      var h = '<option value="' + esc(op.value) + '"' + (String(op.value) === String(value) ? ' selected' : '') + '>' + esc(op.label) + '</option>';
      if (op.group) { if (!groups[op.group]) { groups[op.group] = ''; order.push(op.group); } groups[op.group] += h; } else plain += h;
    });
    return '<select class="input" id="' + id + '" aria-label="' + esc(label) + '">' + plain + order.map(function (g) { return '<optgroup label="' + esc(g) + '">' + groups[g] + '</optgroup>'; }).join('') + '</select>';
  }
  function bindTxTabs(root) {
    $$('[data-txtab]', root).forEach(function (b) { b.addEventListener('click', function () { ui.tx.tab = b.getAttribute('data-txtab'); render(); }); });
  }
  function sortTh(key, label) {
    var f = ui.tx, on = f.sort === key;
    return '<th scope="col" aria-sort="' + (on ? (f.dir > 0 ? 'ascending' : 'descending') : 'none') + '"><button type="button" data-sort="' + key + '">' + esc(label) + (on ? (f.dir > 0 ? ' ▲' : ' ▼') : '') + '</button></th>';
  }
  function renderTxResults() {
    var box = $('#tx-results'); if (!box) return;
    var list = filteredTx(), cm = catMap();
    if (!S.transactions.length) {
      box.innerHTML = emptyState('🧾', 'עוד אין תנועות', 'הוסף הכנסה או הוצאה, הגדר תנועה חוזרת (כמו משכורת או שכירות), או ייבא קובץ CSV מהבנק או מחברת האשראי.',
        '<button class="btn" type="button" data-act="add-tx">' + icon('i-plus') + 'הוסף תנועה</button><button class="btn secondary" type="button" data-act="import-csv">ייבוא CSV</button>');
      return;
    }
    if (!list.length) { box.innerHTML = emptyState('🔍', 'לא נמצאו תנועות', 'נסה לשנות את החיפוש או את הסינון.', '<button class="btn secondary" type="button" id="tx-clear2">נקה סינון</button>'); var c2 = $('#tx-clear2'); if (c2) c2.addEventListener('click', function () { Object.assign(ui.tx, { q: '', period: 'all', kind: 'all', cat: 'all', min: '', max: '' }); render(); }); return; }
    var inc = 0, exp = 0;
    list.forEach(function (t) { if (t.kind === 'income') inc += t.amount; else exp += t.amount; });
    var shown = list.slice(0, ui.tx.limit);
    box.innerHTML = '<p class="small muted" style="margin-bottom:8px">' + list.length + ' תנועות · הכנסות ' + money(inc) + ' · הוצאות ' + money(exp) + ' · נטו ' + signedMoney(inc - exp) + '</p>' +
      '<div class="table-wrap"><table class="tbl tx-tbl"><caption class="sr-only">רשימת תנועות</caption><thead><tr>' + sortTh('date', 'תאריך') + sortTh('desc', 'תיאור') + sortTh('category', 'קטגוריה') + '<th scope="col" class="hide-m">אמצעי תשלום</th>' + sortTh('amount', 'סכום') + '<th scope="col"><span class="sr-only">פעולות</span></th></tr></thead><tbody>' +
      shown.map(function (t) {
        var c = cm[t.categoryId] || catById(t.categoryId);
        var d = txDesc(t, cm);
        return '<tr><td class="c-date nowrap">' + esc(C.formatDateHe(t.date)) + '</td>' +
          '<td class="c-desc"><div class="tx-desc">' + esc(d) + (t.seriesId ? ' <span title="תנועה חוזרת" aria-label="תנועה חוזרת">' + icon('i-repeat', 'inline-ico') + '</span>' : '') + '</div>' +
          '<div class="tx-meta">' + (t.kind === 'expense' ? (t.essential ? 'חיונית' : 'רצונית') : (t.incomeType === 'fixed' ? 'הכנסה קבועה' : 'הכנסה לא קבועה')) + (t.sub ? ' · ' + esc(t.sub) : '') + '</div></td>' +
          '<td class="c-cat">' + catChip(c) + '</td><td class="c-pay hide-m small">' + esc(t.payment || '') + '</td>' +
          '<td class="amt-cell">' + signedMoney(t.amount, t.kind) + '</td>' +
          '<td class="actions"><button class="icon-btn small" type="button" data-act="edit-tx" data-id="' + esc(t.id) + '" aria-label="ערוך: ' + esc(d) + '">' + icon('i-edit') + '</button><button class="icon-btn small" type="button" data-act="del-tx" data-id="' + esc(t.id) + '" aria-label="מחק: ' + esc(d) + '">' + icon('i-trash') + '</button></td></tr>';
      }).join('') + '</tbody></table></div>' +
      (list.length > shown.length ? '<div class="center mt"><button class="btn secondary" type="button" id="tx-more">הצג עוד (' + (list.length - shown.length) + ')</button></div>' : '');
    $$('[data-sort]', box).forEach(function (b) {
      b.addEventListener('click', function () {
        var k = b.getAttribute('data-sort');
        if (ui.tx.sort === k) ui.tx.dir = -ui.tx.dir; else { ui.tx.sort = k; ui.tx.dir = k === 'date' || k === 'amount' ? -1 : 1; }
        renderTxResults();
        var nb = $('[data-sort="' + k + '"]'); if (nb) nb.focus();
      });
    });
    var more = $('#tx-more'); if (more) more.addEventListener('click', function () { ui.tx.limit += 200; renderTxResults(); });
  }

  function nextOccurrence(s) {
    var t = today();
    var occ = C.occurrenceDates(s, C.addMonths(t, 13));
    for (var i = 0; i < occ.length; i++) if (occ[i] > t) return occ[i];
    return null;
  }
  function renderSeriesList() {
    if (!S.series.length) return '<div class="card">' + emptyState('🔁', 'אין תנועות חוזרות', 'משכורת, שכירות, ביטוחים ומנויים נרשמים אוטומטית בכל חודש. בחר תדירות כשאתה מוסיף תנועה.', '<button class="btn" type="button" data-act="add-tx">' + icon('i-plus') + 'הוסף תנועה חוזרת</button>') + '</div>';
    var cm = catMap(), t = today();
    var mInc = 0, mExp = 0;
    var rows = S.series.slice().sort(function (a, b) { return (a.kind === b.kind ? b.amount - a.amount : a.kind === 'income' ? -1 : 1); }).map(function (s) {
      var c = cm[s.categoryId] || catById(s.categoryId);
      var active = !s.endDate || s.endDate >= t;
      var m = Math.round(s.amount * C.monthlyFactor(s.freq));
      if (active) { if (s.kind === 'income') mInc += m; else mExp += m; }
      var nx = active ? nextOccurrence(s) : null;
      return '<div class="list-item"><span class="cat-ico" style="background:' + alpha(c.color, 0.15) + '" aria-hidden="true">' + esc(c.icon) + '</span>' +
        '<div class="grow"><div class="tx-desc">' + esc(s.note || c.name) + ' ' + (active ? '' : '<span class="badge neutral">הסתיימה</span>') + '</div>' +
        '<div class="tx-meta">' + esc(C.FREQ_LABEL[s.freq]) + ' · מ-' + esc(C.formatDateHe(s.startDate)) + (s.endDate ? ' עד ' + esc(C.formatDateHe(s.endDate)) : '') + (nx ? ' · הבא: ' + esc(C.formatDateHe(nx)) : '') + '</div></div>' +
        '<div class="center">' + signedMoney(s.amount, s.kind) + '</div>' +
        '<div class="row" style="gap:2px"><button class="icon-btn small" type="button" data-act="edit-series" data-id="' + esc(s.id) + '" aria-label="ערוך סדרה: ' + esc(s.note || c.name) + '">' + icon('i-edit') + '</button><button class="icon-btn small" type="button" data-act="del-series" data-id="' + esc(s.id) + '" aria-label="מחק סדרה: ' + esc(s.note || c.name) + '">' + icon('i-trash') + '</button></div></div>';
    }).join('');
    return '<div class="card"><div class="card-h"><h2>תנועות חוזרות</h2><span class="small muted">בחודש: הכנסות ' + money(mInc) + ' · הוצאות ' + money(mExp) + '</span></div>' +
      '<p class="hint" style="margin-bottom:8px">תנועות חוזרות נרשמות אוטומטית במועדן, גם אם לא נכנסת לאפליקציה כמה חודשים. תאריך 31 עובר ליום האחרון בחודשים קצרים.</p>' + rows + '</div>';
  }

  /* ---------- טופס תנועה ---------- */
  function defaultCat(kind) { return kind === 'income' ? 'inc_salary' : 'exp_grocery'; }
  function openTxForm(o) {
    o = o || {};
    var tx = o.tx, ser = o.series;
    var src = tx || ser || {};
    var isNew = !tx && !ser;
    var kind = src.kind || (o.kind) || 'expense';
    var lastCat = S.meta.lastCategory && S.meta.lastCategory[kind];
    var catId = src.categoryId || o.categoryId || lastCat || defaultCat(kind);
    var cat = catById(catId);
    var seriesOfTx = tx && tx.seriesId ? S.series.filter(function (s) { return s.id === tx.seriesId; })[0] : null;
    var title = isNew ? 'תנועה חדשה' : ser ? 'עריכת תנועה חוזרת' : 'עריכת תנועה';
    var essential = src.essential !== undefined ? src.essential : cat.essential;
    var body = '<form novalidate data-txform><div class="form-grid">' +
      fld({ name: 'kind', label: 'סוג', type: 'seg', full: true, hideLabel: true, value: kind, options: [{ value: 'expense', label: 'הוצאה' }, { value: 'income', label: 'הכנסה' }] }) +
      fld({ name: 'amount', label: 'סכום (₪)', type: 'amount', big: true, full: true, value: src.amount, attrs: 'autofocus required' }) +
      '<div class="full" data-catwrap>' + fld({ name: 'categoryId', label: 'קטגוריה', type: 'select', options: catOptions(kind), value: catId }) + '</div>' +
      fld({ name: 'date', label: ser ? 'השינוי חל מתאריך' : 'תאריך', type: 'date', value: tx ? tx.date : today(), hint: ser ? 'מופעים שכבר נרשמו לפני התאריך הזה לא ישתנו.' : '' }) +
      (isNew || ser ? fld({ name: 'freq', label: 'תדירות', type: 'select', value: ser ? ser.freq : 'once', options: [{ value: 'once', label: 'חד-פעמית' }, { value: 'monthly', label: 'חודשית' }, { value: 'bimonthly', label: 'דו-חודשית' }, { value: 'quarterly', label: 'רבעונית' }, { value: 'yearly', label: 'שנתית' }].filter(function (x) { return !ser || x.value !== 'once'; }) }) : '') +
      (isNew || ser ? fld({ name: 'endDate', label: 'תאריך סיום (אופציונלי)', type: 'date', value: ser ? ser.endDate : '', hidden: !ser }) : '') +
      fld({ name: 'essential', label: 'הוצאה חיונית', type: 'switch', value: essential, tip: 'essential', full: false }) +
      fld({ name: 'payment', label: 'אמצעי תשלום', type: 'select', value: src.payment || (kind === 'income' ? 'העברה בנקאית' : 'אשראי'), options: PAYMENTS.map(function (p) { return { value: p, label: p }; }) }) +
      fld({ name: 'sub', label: 'תת-קטגוריה (אופציונלי)', value: src.sub, placeholder: 'למשל: ירקות, חניה' }) +
      fld({ name: 'note', label: 'תיאור / הערה', value: src.note, placeholder: 'למשל: שופרסל, משכורת' }) +
      (seriesOfTx ? fld({ name: 'scope', label: 'השינוי חל על', type: 'seg', full: true, value: 'one', options: [{ value: 'one', label: 'רק המופע הזה' }, { value: 'following', label: 'המופע הזה וכל הבאים' }] }) : '') +
      '</div></form>';
    var m = openModal({
      title: title, body: body,
      footer: '<button class="btn" type="button" data-save>שמור</button><button class="btn secondary" type="button" data-close>ביטול</button>' +
        (tx ? '<span class="spacer"></span><button class="btn ghost" type="button" data-del>' + icon('i-trash') + 'מחק</button>' : ''),
      onMount: function (dlg) {
        var form = $('form', dlg);
        var essF = $('[data-field="essential"]', dlg);
        var syncKind = function () {
          var k = $('[name=kind]', dlg).value;
          essF.hidden = k !== 'expense';
          var wrap = $('[data-catwrap]', dlg);
          var cur = $('[name=categoryId]', dlg).value;
          var opts = catOptions(k);
          var keep = opts.some(function (x) { return x.value === cur; }) ? cur : ((S.meta.lastCategory || {})[k] || defaultCat(k));
          wrap.innerHTML = fld({ name: 'categoryId', label: 'קטגוריה', type: 'select', options: opts, value: keep });
          bindCat();
        };
        var bindCat = function () {
          $('[name=categoryId]', dlg).addEventListener('change', function () { var c = catById(this.value); $('[name=essential]', dlg).checked = !!c.essential; });
        };
        bindCat();
        essF.hidden = kind !== 'expense';
        $('[name=kind]', dlg).addEventListener('change', function () { syncKind(); var p = $('[name=payment]', dlg); if (isNew) p.value = this.value === 'income' ? 'העברה בנקאית' : 'אשראי'; });
        var fq = $('[name=freq]', dlg);
        if (fq) fq.addEventListener('change', function () { $('[data-field="endDate"]', dlg).hidden = fq.value === 'once'; });
        var save = function (e) {
          if (e) e.preventDefault();
          var v = readForm(form);
          var data = {
            kind: v.kind, amount: amtVal(v.amount), date: v.date, categoryId: v.categoryId, freq: v.freq || 'once', endDate: v.endDate || null,
            note: v.note, sub: v.sub, payment: v.payment, essential: v.kind === 'expense' ? !!v.essential : false
          };
          if (data.freq === 'once') data.endDate = null;
          var errs = C.validateTx(data);
          if (!showErrors(dlg, errs)) return;
          var c = catById(data.categoryId);
          data.group = data.kind === 'expense' ? (c.group || 'occasional') : null;
          data.incomeType = data.kind === 'income' ? ((data.freq !== 'once' || (tx && tx.seriesId) || ser) ? 'fixed' : (c.id === 'inc_salary' ? 'fixed' : 'variable')) : null;
          m.close();
          saveTx(data, { tx: tx, series: ser, scope: v.scope });
        };
        $('[data-save]', dlg).addEventListener('click', save);
        form.addEventListener('submit', save);
        dlg.addEventListener('keydown', function (e) { if (e.key === 'Enter' && e.target.tagName === 'INPUT' && e.target.type !== 'checkbox') save(e); });
        var del = $('[data-del]', dlg);
        if (del) del.addEventListener('click', function () { m.close(); deleteTx(tx.id); });
      }
    });
  }
  function saveTx(d, ctx) {
    var t0 = today();
    commit(function (S) {
      S.meta.lastCategory = S.meta.lastCategory || {};
      S.meta.lastCategory[d.kind] = d.categoryId;
      var fields = { kind: d.kind, amount: d.amount, categoryId: d.categoryId, note: d.note, sub: d.sub, payment: d.payment, essential: d.essential, group: d.group, incomeType: d.incomeType };
      if (ctx.series) {
        // עריכת סדרה מתאריך והלאה
        var ch = Object.assign({}, fields, { freq: d.freq, endDate: d.endDate });
        if (d.freq !== ctx.series.freq) ch.startDate = d.date;
        var r = C.splitSeries(S.series, S.transactions, ctx.series.id, d.date, ch);
        S.series = r.series; S.transactions = C.materializeRecurring(S.series, r.transactions, t0).transactions;
      } else if (ctx.tx) {
        if (ctx.scope === 'following' && ctx.tx.seriesId) {
          var from = ctx.tx.occDate || ctx.tx.date;
          var r2 = C.splitSeries(S.series, S.transactions, ctx.tx.seriesId, from, fields);
          S.series = r2.series;
          S.transactions = C.materializeRecurring(S.series, r2.transactions, t0).transactions;
          // אם גם התאריך של המופע הנוכחי שונה — מעדכנים אותו
          if (d.date !== from) S.transactions.forEach(function (t) { if (t.seriesId === r2.newId && t.occDate === from) { t.date = d.date; t.edited = true; } });
        } else {
          S.transactions = S.transactions.map(function (t) {
            if (t.id !== ctx.tx.id) return t;
            return Object.assign({}, t, fields, { date: d.date, edited: t.seriesId ? true : t.edited });
          });
        }
      } else if (d.freq && d.freq !== 'once') {
        var s = Object.assign({ id: C.uid('s'), freq: d.freq, startDate: d.date, endDate: d.endDate, skips: [] }, fields);
        S.series.push(s);
        S.transactions = C.materializeRecurring(S.series, S.transactions, t0).transactions;
      } else {
        S.transactions.push(Object.assign({ id: C.uid('t'), date: d.date }, fields));
      }
    }, { toast: ctx.tx || ctx.series ? 'התנועה עודכנה' : (d.freq && d.freq !== 'once' ? 'נוצרה תנועה חוזרת (' + C.FREQ_LABEL[d.freq] + ')' : 'התנועה נוספה') });
  }
  function deleteTx(id) {
    var tx = S.transactions.filter(function (t) { return t.id === id; })[0];
    if (!tx) return;
    var ser = tx.seriesId ? S.series.filter(function (s) { return s.id === tx.seriesId; })[0] : null;
    if (!ser) {
      commit(function (S) { S.transactions = S.transactions.filter(function (t) { return t.id !== id; }); }, { undo: 'התנועה נמחקה' });
      return;
    }
    choiceDialog({ title: 'מחיקת תנועה חוזרת', text: 'התנועה הזו שייכת לסדרה חוזרת. מה למחוק?', choices: [{ id: 'one', label: 'רק את המופע הזה' }, { id: 'following', label: 'את זה וכל הבאים', danger: true }] }).then(function (ch) {
      if (ch === 'one') commit(function (S) { var r = C.deleteOccurrence(S.series, S.transactions, id); S.series = r.series; S.transactions = r.transactions; }, { undo: 'המופע נמחק' });
      else if (ch === 'following') commit(function (S) {
        var from = tx.occDate || tx.date;
        S.transactions = S.transactions.filter(function (t) { return !(t.seriesId === ser.id && (t.occDate || t.date) >= from); });
        var end = C.addDays(from, -1);
        S.series = S.series.map(function (s) { return s.id === ser.id ? Object.assign({}, s, { endDate: end }) : s; }).filter(function (s) { return !(s.id === ser.id && s.endDate < s.startDate); });
      }, { undo: 'הסדרה הסתיימה' });
    });
  }
  function deleteSeries(id) {
    var ser = S.series.filter(function (s) { return s.id === id; })[0];
    if (!ser) return;
    choiceDialog({ title: 'מחיקת תנועה חוזרת', text: 'האם להשאיר את התנועות שכבר נרשמו מהסדרה הזו?', choices: [{ id: 'keep', label: 'מחק סדרה, השאר היסטוריה' }, { id: 'all', label: 'מחק הכל', danger: true }] }).then(function (ch) {
      if (!ch) return;
      commit(function (S) {
        S.series = S.series.filter(function (s) { return s.id !== id; });
        if (ch === 'all') S.transactions = S.transactions.filter(function (t) { return t.seriesId !== id; });
        else S.transactions = S.transactions.map(function (t) { return t.seriesId === id ? Object.assign({}, t, { seriesId: null, occDate: null, recurringOrigin: id }) : t; });
      }, { undo: 'התנועה החוזרת נמחקה' });
    });
  }

  /* ---------- ייבוא CSV מהבנק / חברת האשראי ---------- */
  function readFileText(file) {
    return file.arrayBuffer().then(function (buf) {
      var txt = new TextDecoder('utf-8').decode(buf);
      // קבצים ישנים מבנקים בישראל מקודדים לעיתים ב-windows-1255
      if (txt.indexOf('�') >= 0) { try { txt = new TextDecoder('windows-1255').decode(buf); } catch (e) { /* נשאר UTF-8 */ } }
      return txt;
    });
  }
  function pickFile(accept) {
    return new Promise(function (resolve) {
      var inp = document.createElement('input');
      inp.type = 'file'; inp.accept = accept; inp.style.display = 'none';
      inp.addEventListener('change', function () { resolve(inp.files && inp.files[0]); if (inp.parentNode) inp.parentNode.removeChild(inp); });
      document.body.appendChild(inp);
      inp.click();
    });
  }
  function guessCol(header, re) { for (var i = 0; i < header.length; i++) if (re.test(header[i])) return String(i); return ''; }
  function importCSV() {
    pickFile('.csv,text/csv,text/plain').then(function (file) {
      if (!file) return;
      if (file.size > 5 * 1024 * 1024) { toast('הקובץ גדול מדי (מעל 5MB)', 'error'); return; }
      return readFileText(file).then(function (text) {
        var rows;
        try { rows = C.parseCSV(text); } catch (e) { toast('לא ניתן לקרוא את הקובץ: ' + friendly(e), 'error'); return; }
        if (!rows.length || rows[0].length < 2) { toast('הקובץ ריק או לא בפורמט CSV', 'error'); return; }
        openCsvMapper(rows, file.name);
      });
    }).catch(function (e) { toast('הייבוא נכשל: ' + friendly(e), 'error'); });
  }
  function openCsvMapper(rows, fname) {
    var header = rows[0];
    var colOpts = [{ value: '', label: '—' }].concat(header.map(function (h, i) { return { value: String(i), label: (h || 'עמודה ' + (i + 1)).slice(0, 40) }; }));
    var g = {
      date: guessCol(header, /תאריך|date/i), desc: guessCol(header, /תיאור|בית ?עסק|שם|פרטים|description|merchant|payee/i),
      amount: guessCol(header, /סכום|amount|חיוב/i), debit: guessCol(header, /חובה|debit/i), credit: guessCol(header, /זכות|credit/i)
    };
    var useDC = !!(g.debit && g.credit);
    // למידה מההיסטוריה: תיאור → קטגוריה
    var learn = {};
    S.transactions.forEach(function (t) { var k = (t.note || '').trim().toLowerCase(); if (k) learn[k] = t.categoryId; });
    var body = '<p class="small muted">' + esc(fname) + ' · ' + rows.length + ' שורות. בחר אילו עמודות מכילות את המידע.</p><form novalidate data-csv><div class="form-grid mt">' +
      fld({ name: 'date', label: 'עמודת תאריך', type: 'select', options: colOpts, value: g.date }) +
      fld({ name: 'desc', label: 'עמודת תיאור', type: 'select', options: colOpts, value: g.desc }) +
      fld({ name: 'mode', label: 'סכומים', type: 'seg', full: true, value: useDC ? 'dc' : 'single', options: [{ value: 'single', label: 'עמודת סכום אחת' }, { value: 'dc', label: 'עמודות חובה וזכות' }] }) +
      fld({ name: 'amount', label: 'עמודת סכום', type: 'select', options: colOpts, value: g.amount, hidden: useDC }) +
      fld({ name: 'debit', label: 'עמודת חובה (הוצאה)', type: 'select', options: colOpts, value: g.debit, hidden: !useDC }) +
      fld({ name: 'credit', label: 'עמודת זכות (הכנסה)', type: 'select', options: colOpts, value: g.credit, hidden: !useDC }) +
      fld({ name: 'positive', label: 'סכום חיובי = הוצאה (כמו בפירוט חברת אשראי)', type: 'switch', value: /אשראי|כאל|ישראכרט|מקס|לאומי קארד|visa|card/i.test(fname + header.join(' ')), full: true }) +
      fld({ name: 'hasHeader', label: 'השורה הראשונה היא כותרת', type: 'switch', value: true }) +
      fld({ name: 'expCat', label: 'קטגוריה להוצאות שלא זוהו', type: 'select', options: catOptions('expense'), value: 'exp_other' }) +
      fld({ name: 'incCat', label: 'קטגוריה להכנסות', type: 'select', options: catOptions('income'), value: 'inc_other' }) +
      fld({ name: 'includePossible', label: 'ייבא גם "כפילויות אפשריות" (אותו תאריך וסכום)', type: 'switch', value: false, full: true }) +
      '</div></form><h3 class="mt">תצוגה מקדימה</h3><div id="csv-preview" class="mt-s"></div>';
    var mapped = [];
    var m = openModal({
      title: 'ייבוא תנועות מ-CSV', wide: true, body: body,
      footer: '<button class="btn" type="button" data-go>ייבא</button><button class="btn secondary" type="button" data-close>ביטול</button>',
      onMount: function (dlg) {
        var form = $('form', dlg);
        var refresh = function () {
          var v = readForm(form);
          $('[data-field="amount"]', dlg).hidden = v.mode === 'dc';
          $('[data-field="debit"]', dlg).hidden = v.mode !== 'dc';
          $('[data-field="credit"]', dlg).hidden = v.mode !== 'dc';
          $('[data-field="positive"]', dlg).hidden = v.mode === 'dc';
          var mp = { hasHeader: v.hasHeader, date: v.date === '' ? null : +v.date, desc: v.desc === '' ? null : +v.desc };
          if (v.mode === 'dc') { mp.debit = v.debit === '' ? null : +v.debit; mp.credit = v.credit === '' ? null : +v.credit; }
          else mp.amount = v.amount === '' ? null : +v.amount;
          var res = C.csvToTransactions(rows, mp, { expensesPositive: v.mode !== 'dc' && v.positive });
          mapped = C.markDuplicates(res.transactions, S.transactions).map(function (t) {
            var k = (t.note || '').trim().toLowerCase();
            var guess = learn[k];
            var c = guess && catById(guess).kind === t.kind ? guess : (t.kind === 'income' ? v.incCat : v.expCat);
            return Object.assign(t, { categoryId: c });
          });
          var cm = catMap();
          var nNew = mapped.filter(function (t) { return !t.duplicate && !t.possibleDuplicate; }).length;
          var nDup = mapped.filter(function (t) { return t.duplicate; }).length;
          var nPos = mapped.filter(function (t) { return t.possibleDuplicate; }).length;
          $('#csv-preview', dlg).innerHTML = '<p class="small"><span class="badge ok">' + nNew + ' חדשות</span> <span class="badge bad">' + nDup + ' כפולות (ידולגו)</span> <span class="badge warn">' + nPos + ' כפילויות אפשריות</span>' + (res.errors.length ? ' <span class="badge neutral">' + res.errors.length + ' שורות לא תקינות</span>' : '') + '</p>' +
            '<div class="table-wrap mt-s"><table class="tbl"><thead><tr><th>תאריך</th><th>תיאור</th><th>קטגוריה</th><th>סכום</th><th>סטטוס</th></tr></thead><tbody>' +
            mapped.slice(0, 8).map(function (t) {
              return '<tr><td>' + esc(C.formatDateHe(t.date)) + '</td><td>' + esc(t.note) + '</td><td>' + esc((cm[t.categoryId] || {}).name || '') + '</td><td>' + signedMoney(t.amount, t.kind) + '</td><td>' +
                (t.duplicate ? '<span class="badge bad">כפולה</span>' : t.possibleDuplicate ? '<span class="badge warn">אולי כפולה</span>' : '<span class="badge ok">חדשה</span>') + '</td></tr>';
            }).join('') + '</tbody></table></div>' + (mapped.length > 8 ? '<p class="hint mt-s">ועוד ' + (mapped.length - 8) + ' שורות…</p>' : '') +
            (!mapped.length ? '<p class="err mt-s">לא זוהו תנועות. בדוק את בחירת העמודות.</p>' : '');
        };
        form.addEventListener('change', refresh);
        refresh();
        $('[data-go]', dlg).addEventListener('click', function () {
          var v = readForm(form);
          var toAdd = mapped.filter(function (t) { return !t.duplicate && (v.includePossible || !t.possibleDuplicate); });
          if (!toAdd.length) { toast('אין תנועות חדשות לייבוא', 'error'); return; }
          m.close();
          commit(function (S) {
            toAdd.forEach(function (t) {
              var c = catById(t.categoryId);
              S.transactions.push({ id: C.uid('t'), kind: t.kind, amount: t.amount, date: t.date, categoryId: t.categoryId, sub: '', payment: t.kind === 'income' ? 'העברה בנקאית' : 'אשראי',
                essential: t.kind === 'expense' ? !!c.essential : false, note: t.note, group: t.kind === 'expense' ? c.group : null, incomeType: t.kind === 'income' ? 'variable' : null, imported: true });
            });
          }, { undo: 'יובאו ' + toAdd.length + ' תנועות' });
        });
      }
    });
  }
  function exportCSV() {
    confirmDialog({ title: 'ייצוא CSV לא מוצפן', html: 'קובץ CSV <b>אינו מוצפן</b>. כל מי שיקבל אותו יוכל לראות את התנועות שלך. שמור אותו במקום בטוח ומחק כשסיימת.<br><br>לגיבוי והעברה בין מכשירים, השתמש ב"גיבוי מוצפן" בהגדרות.', ok: 'הבנתי, ייצא' }).then(function (ok) {
      if (!ok) return;
      try {
        var cm = catMap();
        var rows = [['תאריך', 'סוג', 'קטגוריה', 'תת-קטגוריה', 'סכום', 'אמצעי תשלום', 'חיונית', 'תיאור', 'חוזרת']];
        S.transactions.slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; }).forEach(function (t) {
          rows.push([t.date, t.kind === 'income' ? 'הכנסה' : 'הוצאה', (cm[t.categoryId] || {}).name || '', t.sub || '', (t.kind === 'income' ? '' : '-') + agToInput(t.amount), t.payment || '', t.kind === 'expense' ? (t.essential ? 'כן' : 'לא') : '', t.note || '', t.seriesId ? 'כן' : '']);
        });
        downloadBlob(new Blob([C.toCSV(rows)], { type: 'text/csv;charset=utf-8' }), 'matzpen-transactions-' + today() + '.csv');
        toast('הקובץ ירד');
      } catch (e) { toast('הייצוא נכשל: ' + friendly(e), 'error'); }
    });
  }
  function downloadBlob(blob, name) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = name; a.style.display = 'none';
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(url); if (a.parentNode) a.parentNode.removeChild(a); }, 1000);
  }

  /* =====================================================================
   * מסך: תקציב
   * ===================================================================== */
  function renderBudget() {
    var sd = S.settings.monthStartDay, cur = C.finMonthKey(today(), sd);
    var key = ui.budgetMonth || cur;
    var sum = C.summarizeMonth(S.transactions, key, sd);
    var cats = S.categories.filter(function (c) { return c.kind === 'expense'; });
    var totB = 0, totS = 0;
    cats.forEach(function (c) { if (c.budget > 0) { totB += c.budget; totS += sum.byCategory[c.id] || 0; } });
    var monthOpts = C.lastMonthKeys(cur, 12).reverse().map(function (k) { return { value: k, label: C.monthLabel(k) + (k === cur ? ' (נוכחי)' : '') }; });
    var groupsHtml = ['variable', 'fixed', 'occasional'].map(function (g) {
      var list = cats.filter(function (c) { return c.group === g && (ui.showAllCats || c.budget > 0 || sum.byCategory[c.id] > 0); });
      if (!list.length) return '';
      return '<h3 class="mt" style="margin-bottom:4px">' + esc(GROUP_LABEL[g]) + '</h3>' + list.map(function (c) {
        var spent = sum.byCategory[c.id] || 0;
        var pct = c.budget > 0 ? spent / c.budget * 100 : 0;
        var cls = c.budget > 0 ? (pct > 100 ? 'over' : pct > 80 ? 'warn' : '') : '';
        return '<div class="budget-row" style="grid-template-columns:minmax(0,1fr) 120px auto">' +
          '<div class="row" style="gap:8px;min-width:0"><span class="cat-ico" style="width:32px;height:32px;background:' + alpha(c.color, .15) + '" aria-hidden="true">' + esc(c.icon) + '</span><b style="overflow:hidden;text-overflow:ellipsis">' + esc(c.name) + '</b></div>' +
          '<input class="input ltr" style="min-height:40px;padding:6px 10px" id="bud-' + esc(c.id) + '" data-budget="' + esc(c.id) + '" inputmode="decimal" placeholder="ללא" value="' + esc(c.budget > 0 ? agToInput(c.budget) : '') + '" aria-label="תקציב חודשי ל' + esc(c.name) + '">' +
          '<div class="small nowrap" style="min-width:90px;text-align:end">' + money(spent) + '</div>' +
          (c.budget > 0 ? '<div class="bar ' + cls + '" role="progressbar" aria-valuenow="' + Math.round(pct) + '" aria-valuemin="0" aria-valuemax="100" aria-label="' + esc(c.name) + '"><span data-w="' + Math.min(100, pct) + '"></span></div><div class="tiny ' + (pct > 100 ? 'neg' : 'muted') + '" style="grid-column:1/-1">' + (pct > 100 ? '▼ חריגה של ' + money(spent - c.budget) : Math.round(pct) + '% נוצל · נותרו ' + money(c.budget - spent)) + '</div>' : '') +
          '</div>';
      }).join('');
    }).join('');
    var rule = C.rule503020(sum);
    var subs = C.detectSubscriptions(S, today());
    var subsTotal = subs.reduce(function (s, x) { return s + x.annual; }, 0);
    var ruleBar = function (label, val, target, invert, help) {
      var ok = invert ? val >= target : val <= target;
      return '<div style="margin-bottom:14px"><div class="row between small"><b>' + esc(label) + '</b><span><span class="' + (ok ? 'pos' : 'neg') + '"><b>' + (ok ? '✓ ' : '✗ ') + Math.round(val) + '%</b></span> <span class="muted">/ יעד ' + (invert ? 'לפחות ' : 'עד ') + target + '%</span></span></div>' +
        '<div class="bar ' + (ok ? '' : 'over') + ' mt-s" style="height:12px"><span data-w="' + Math.max(0, Math.min(100, val)) + '"></span><i class="marker" style="inset-inline-start:' + target + '%"></i></div><div class="hint mt-s">' + help + '</div></div>';
    };
    var html = '<div class="row wrap between" style="margin-bottom:14px"><label class="row small"><span>חודש:</span>' + selectHTML('bud-month', 'בחר חודש', monthOpts, key) + '</label>' +
      '<label class="switch small"><input type="checkbox" id="bud-all"' + (ui.showAllCats ? ' checked' : '') + '><span>הצג את כל הקטגוריות</span></label></div>' +
      '<div class="kpis">' + kpi('סך התקציב', money(totB), 'לקטגוריות עם תקציב', '🎯') + kpi('נוצל', money(totS), totB ? Math.round(totS / totB * 100) + '% מהתקציב' : '', '🧾') +
      kpi('נותר', '<span class="' + (totB - totS < 0 ? 'neg' : 'pos') + '">' + money(totB - totS) + '</span>', '', '💚') + '</div>' +
      '<div class="cols-2 section"><div class="card"><div class="card-h"><h2>תכנון מול ביצוע</h2></div><p class="hint">הזן תקציב חודשי לכל קטגוריה (ריק = ללא תקציב). ירוק: בתקציב, צהוב: מעל 80%, אדום: חריגה.</p>' +
      (groupsHtml || emptyState('🎯', 'אין קטגוריות להצגה', 'סמן "הצג את כל הקטגוריות" כדי להגדיר תקציב.', '')) + '</div>' +
      '<div class="stack"><div class="card"><div class="card-h"><h2>שיטת 50/30/20 ' + tip('rule') + '</h2><span class="muted small">' + esc(C.monthLabel(key)) + '</span></div>' +
      (rule ? ruleBar('חיוני', rule.needs, 50, false, 'דיור, מזון, ביטוחים, תחבורה — ' + money(sum.essential)) + ruleBar('רצוני', rule.wants, 30, false, 'מסעדות, בילויים, קניות, מנויים — ' + money(sum.discretionary)) + ruleBar('חיסכון', rule.savings, 20, true, 'מה שנשאר מההכנסה — ' + money(sum.net))
        : emptyState('⚖️', 'אין הכנסות בחודש הזה', 'כדי להשוות לשיטת 50/30/20 צריך הכנסה בחודש הנבחר.', '')) + '</div>' +
      '<div class="card"><div class="card-h"><h2>🔁 מנויים חוזרים</h2>' + (subs.length ? '<span class="badge warn">' + money(subsTotal) + ' בשנה</span>' : '') + '</div>' +
      (subs.length ? subs.map(function (s) {
        return '<div class="list-item"><div class="grow"><b>' + esc(s.name) + '</b><div class="tx-meta">' + (s.source === 'detected' ? 'זוהה אוטומטית מהתנועות' : 'תנועה חוזרת') + '</div></div><div style="text-align:end"><div>' + money(s.monthly) + ' <span class="muted tiny">לחודש</span></div><div class="tiny muted">' + money(s.annual) + ' בשנה</div></div></div>';
      }).join('') + '<p class="hint mt-s">כל מנוי שתבטל חוסך את הסכום השנתי שלו — כל שנה.</p>'
        : emptyState('📺', 'לא זוהו מנויים', 'מנויים (נטפליקס, כושר, אפליקציות) מזוהים מתנועות חוזרות בקטגוריית "מנויים" ומחיובים שחוזרים כל חודש.', '')) + '</div></div></div>';
    return {
      html: html,
      mount: function (root) {
        $('#bud-month').addEventListener('change', function () { ui.budgetMonth = this.value; render(); });
        $('#bud-all').addEventListener('change', function () { ui.showAllCats = this.checked; render(); });
        $$('[data-budget]', root).forEach(function (inp) {
          inp.addEventListener('change', function () {
            var id = inp.getAttribute('data-budget');
            var v = inp.value.trim();
            var a = v === '' ? 0 : C.toAgorot(v);
            if (isNaN(a) || a < 0) { inp.setAttribute('aria-invalid', 'true'); toast('תקציב חייב להיות סכום חיובי', 'error'); return; }
            commit(function (S) { S.categories.forEach(function (c) { if (c.id === id) { c.budget = a; c.demoBudget = false; } }); }, { render: false });
            setTimeout(function () { var fid = document.activeElement && document.activeElement.id; render(); if (fid) { var el = document.getElementById(fid); if (el) el.focus(); } }, 0);
          });
        });
        animateBars();
      }
    };
  }

  /* =====================================================================
   * מסך: חסכונות והשקעות
   * ===================================================================== */
  var RISK_LABEL = { low: 'נמוכה', medium: 'בינונית', high: 'גבוהה' };
  var TAX_LABEL = { exempt: 'פטור ממס', cgt: 'מס רווח הון 25%', pension: 'פנסיוני (נעול עד פרישה)' };
  var TYPE_ICON = { checking: '🏦', deposit: '🔒', mmf: '💧', hishtalmut: '🎓', gemel: '🧺', pension: '👵', stocks: '📊', crypto: '🪙', realestate: '🏠', other: '💼' };
  var TYPE_DEFAULTS = {
    checking: { expReturn: 0, feeAcc: 0, feeDep: 0, risk: 'low', tax: 'exempt' },
    deposit: { expReturn: 4, feeAcc: 0, feeDep: 0, risk: 'low', tax: 'cgt' },
    mmf: { expReturn: 4.2, feeAcc: 0.25, feeDep: 0, risk: 'low', tax: 'cgt' },
    hishtalmut: { expReturn: 6, feeAcc: 0.6, feeDep: 0, risk: 'medium', tax: 'exempt', liquidYears: 6 },
    gemel: { expReturn: 6, feeAcc: 0.6, feeDep: 0, risk: 'medium', tax: 'cgt' },
    pension: { expReturn: 5.5, feeAcc: 0.22, feeDep: 1.5, risk: 'medium', tax: 'pension' },
    stocks: { expReturn: 7, feeAcc: 0.1, feeDep: 0, risk: 'high', tax: 'cgt' },
    crypto: { expReturn: 8, feeAcc: 0, feeDep: 0, risk: 'high', tax: 'cgt' },
    realestate: { expReturn: 4, feeAcc: 0, feeDep: 0, risk: 'medium', tax: 'cgt' },
    other: { expReturn: 3, feeAcc: 0, feeDep: 0, risk: 'medium', tax: 'cgt' }
  };
  function liqBadge(a) {
    var t = today();
    if (a.tax === 'pension' || a.type === 'pension') return '<span class="badge info">🔒 עד גיל ' + esc(S.settings.retireAge) + '</span>';
    if (a.type === 'realestate') return '<span class="badge neutral">לא נזיל</span>';
    if (a.liquidDate && a.liquidDate > t) return '<span class="badge warn">🔒 נזיל מ-' + esc(C.formatDateHe(a.liquidDate)) + '</span>';
    return '<span class="badge ok">נזיל</span>';
  }
  function renderAssets() {
    var t = today();
    var nw = C.netWorth(S.accounts, S.liabilities);
    var fees = S.accounts.reduce(function (s, a) { return s + C.annualFees(a); }, 0);
    var feesRet = S.accounts.length ? C.feesUntilRetirement(S.accounts, S.settings, t) : { cost: 0, years: 0 };
    var html = '<div class="kpis">' + kpi('סך נכסים', counter(nw.assets), S.accounts.length + ' נכסים', '💼') + kpi('התחייבויות', counter(nw.liabilities), S.liabilities.length + ' הלוואות', '💳') +
      kpi('שווי נקי', counter(nw.net), 'נכסים פחות התחייבויות', '📈') +
      kpi('דמי ניהול בשנה', '<span class="neg">' + counter(fees) + '</span>', feesRet.cost ? 'עד הפרישה: <b class="amt neg">' + esc(F(feesRet.cost)) + '</b>' : '', '💸', 'feeAcc') + '</div>';
    html += '<div class="card section"><div class="card-h"><h2>הנכסים שלי</h2><button class="btn small" type="button" data-act="add-account">' + icon('i-plus') + 'הוסף נכס</button></div>' +
      (S.accounts.length ? '<div class="asset-grid">' + S.accounts.map(function (a) {
        var lastH = (a.history || []).slice(-1)[0];
        return '<article class="card asset-card" style="box-shadow:none;background:var(--surface-2)"><div class="row between"><div class="row" style="gap:10px;min-width:0"><span class="cat-ico" style="background:var(--surface)" aria-hidden="true">' + (TYPE_ICON[a.type] || '💼') + '</span><div style="min-width:0"><h3 style="overflow:hidden;text-overflow:ellipsis">' + esc(a.name) + '</h3><div class="tiny muted">' + esc(C.ACCOUNT_TYPES[a.type] || '') + '</div></div></div>' +
          '<div class="row" style="gap:2px"><button class="icon-btn small" type="button" data-act="edit-account" data-id="' + esc(a.id) + '" aria-label="ערוך ' + esc(a.name) + '">' + icon('i-edit') + '</button><button class="icon-btn small" type="button" data-act="del-account" data-id="' + esc(a.id) + '" aria-label="מחק ' + esc(a.name) + '">' + icon('i-trash') + '</button></div></div>' +
          '<div class="asset-bal">' + money(a.balance) + '</div>' +
          '<div class="row wrap" style="gap:6px">' + liqBadge(a) + '<span class="badge ' + (a.risk === 'high' ? 'bad' : a.risk === 'medium' ? 'warn' : 'ok') + '">סיכון ' + esc(RISK_LABEL[a.risk] || '') + '</span><span class="badge neutral">' + esc(TAX_LABEL[a.tax] || '') + '</span></div>' +
          '<dl class="kv"><dt>הפקדה חודשית</dt><dd>' + money(a.monthly) + '</dd><dt>תשואה צפויה</dt><dd class="num">' + esc(a.expReturn) + '%</dd><dt>דמי ניהול (צבירה / הפקדה)</dt><dd class="num">' + esc(a.feeAcc || 0) + '% / ' + esc(a.feeDep || 0) + '%</dd><dt>דמי ניהול בשנה</dt><dd>' + money(C.annualFees(a)) + '</dd></dl>' +
          '<div class="row between"><span class="tiny muted">' + (lastH ? 'עודכן ' + esc(C.formatDateHe(lastH.date)) : '') + '</span><button class="btn small secondary" type="button" data-act="update-balance" data-id="' + esc(a.id) + '">עדכן יתרה</button></div></article>';
      }).join('') + '</div>' : emptyState('🌱', 'עוד לא הוספת חסכונות', 'הוסף עו"ש, קרן השתלמות, פנסיה, תיק השקעות ועוד, כדי לראות שווי נקי, פיזור ותחזית צבירה.', '<button class="btn" type="button" data-act="add-account">' + icon('i-plus') + 'הוסף נכס</button>')) + '</div>';
    if (S.accounts.length) {
      html += '<div class="cols-3 section">' +
        '<div class="card"><div class="card-h"><h2>לפי סוג</h2></div><div class="chart-box short"><canvas id="ch-type" role="img" aria-label="פיזור הנכסים לפי סוג"></canvas></div></div>' +
        '<div class="card"><div class="card-h"><h2>לפי רמת סיכון</h2></div><div class="chart-box short"><canvas id="ch-risk" role="img" aria-label="פיזור הנכסים לפי רמת סיכון"></canvas></div></div>' +
        '<div class="card"><div class="card-h"><h2>לפי נזילות ' + tip('liquid') + '</h2></div><div class="chart-box short"><canvas id="ch-liq" role="img" aria-label="פיזור הנכסים לפי נזילות"></canvas></div></div></div>';
    }
    html += '<div class="cols-2 section"><div class="card"><div class="card-h"><h2>היסטוריית שווי נקי</h2><span class="muted small">צילום אוטומטי פעם בחודש</span></div>' +
      (S.snapshots.length >= 2 ? '<div class="chart-box"><canvas id="ch-nw" role="img" aria-label="גרף שווי נקי לאורך זמן"></canvas></div>' : emptyState('📆', 'הגרף ייבנה לבד', 'בכל חודש נשמר צילום של השווי הנקי. אחרי חודשיים תראה כאן את המגמה.', '')) + '</div>' +
      '<div class="card"><div class="card-h"><h2>הלוואות והתחייבויות</h2><button class="btn small secondary" type="button" data-act="add-liability">' + icon('i-plus') + 'הוסף</button></div>' +
      (S.liabilities.length ? S.liabilities.map(function (l) {
        return '<div class="list-item"><span class="cat-ico" style="background:var(--neg-soft)" aria-hidden="true">💳</span><div class="grow"><b>' + esc(l.name) + '</b><div class="tx-meta">ריבית ' + esc(l.rate) + '% · החזר ' + esc(F(l.payment)) + ' לחודש' + (l.endDate ? ' · עד ' + esc(C.formatDateHe(l.endDate)) : '') + '</div></div><b class="neg">' + money(l.balance) + '</b>' +
          '<button class="icon-btn small" type="button" data-act="edit-liability" data-id="' + esc(l.id) + '" aria-label="ערוך ' + esc(l.name) + '">' + icon('i-edit') + '</button><button class="icon-btn small" type="button" data-act="del-liability" data-id="' + esc(l.id) + '" aria-label="מחק ' + esc(l.name) + '">' + icon('i-trash') + '</button></div>';
      }).join('') : emptyState('✅', 'אין התחייבויות', 'משכנתא והלוואות נכנסות לחישוב השווי הנקי.', '')) + '</div></div>';
    if (S.accounts.length) {
      html += '<div class="card section"><div class="card-h"><h2>פירוט דמי ניהול ' + tip('feeAcc') + '</h2></div><div class="table-wrap"><table class="tbl"><thead><tr><th>נכס</th><th>מהצבירה</th><th>מההפקדה</th><th>עלות שנתית</th></tr></thead><tbody>' +
        S.accounts.map(function (a) { return '<tr><td>' + esc(a.name) + '</td><td class="num">' + esc(a.feeAcc || 0) + '%</td><td class="num">' + esc(a.feeDep || 0) + '%</td><td>' + money(C.annualFees(a)) + '</td></tr>'; }).join('') +
        '<tr><td><b>סה"כ</b></td><td></td><td></td><td><b>' + money(fees) + '</b></td></tr></tbody></table></div>' +
        (feesRet.cost ? '<p class="mt small">בקצב הנוכחי, דמי הניהול יעלו לך כ-<b class="amt neg">' + esc(F(feesRet.cost)) + '</b> עד גיל ' + esc(S.settings.retireAge) + ' (' + feesRet.years + ' שנים) — כולל התשואה שהכסף הזה היה מרוויח. הורדה של 0.1% בדמי הניהול יכולה להיות שווה עשרות אלפי שקלים.</p>' : '') + '</div>';
    }
    return {
      html: html,
      mount: function () {
        if (!S.accounts.length) return;
        var p = palette();
        var doughnut = function (id, labels, values, colors) {
          makeChart(id, $('#ch-' + id), { type: 'doughnut', data: { labels: labels, datasets: [{ data: values, backgroundColor: colors, borderColor: p.surface, borderWidth: 2 }] },
            options: chartBase({ cutout: '62%', interaction: { mode: 'nearest', intersect: true }, plugins: { legend: { position: 'bottom', labels: { boxWidth: 8, padding: 10 } } } }) });
        };
        var byType = {};
        S.accounts.forEach(function (a) { byType[a.type] = (byType[a.type] || 0) + a.balance; });
        var typeColors = { checking: '#64748b', deposit: '#0ea5e9', mmf: '#06b6d4', hishtalmut: '#8b5cf6', gemel: '#a855f7', pension: '#6366f1', stocks: '#16a34a', crypto: '#f59e0b', realestate: '#a16207', other: '#94a3b8' };
        var tk = Object.keys(byType).filter(function (k) { return byType[k] > 0; });
        doughnut('type', tk.map(function (k) { return C.ACCOUNT_TYPES[k]; }), tk.map(function (k) { return byType[k] / 100; }), tk.map(function (k) { return typeColors[k]; }));
        var byRisk = { low: 0, medium: 0, high: 0 };
        S.accounts.forEach(function (a) { byRisk[a.risk || 'medium'] += a.balance; });
        doughnut('risk', ['סיכון נמוך', 'סיכון בינוני', 'סיכון גבוה'], [byRisk.low / 100, byRisk.medium / 100, byRisk.high / 100], ['#22c55e', '#f59e0b', '#ef4444']);
        var liq = C.liquidAssets(S.accounts, S.settings, today());
        doughnut('liq', ['נזיל', 'נעול'], [liq / 100, (C.netWorth(S.accounts, []).assets - liq) / 100], [p.primary, p.accent]);
        if (S.snapshots.length >= 2) {
          makeChart('nw', $('#ch-nw'), {
            type: 'line',
            data: { labels: S.snapshots.map(function (s) { return C.monthLabel(s.month, true); }), datasets: [
              { label: 'שווי נקי', data: S.snapshots.map(function (s) { return s.net / 100; }), borderColor: p.primary, backgroundColor: alpha(p.primary, 0.12), fill: true, tension: 0.35, pointRadius: 3, borderWidth: 2.5 },
              { label: 'נכסים', data: S.snapshots.map(function (s) { return s.assets / 100; }), borderColor: alpha(p.pos, 0.7), borderDash: [5, 4], pointRadius: 0, borderWidth: 1.5, fill: false },
              { label: 'התחייבויות', data: S.snapshots.map(function (s) { return s.liabilities / 100; }), borderColor: alpha(p.neg, 0.7), borderDash: [5, 4], pointRadius: 0, borderWidth: 1.5, fill: false }
            ] },
            options: chartBase({ scales: { x: axisX(), y: axisY() } })
          });
        }
      }
    };
  }
  function openAccountForm(a) {
    var isNew = !a;
    a = a || { type: 'stocks', risk: 'high', tax: 'cgt', expReturn: 7, feeAcc: 0.1, feeDep: 0, balance: '', monthly: 0, liquidDate: '' };
    var body = '<form novalidate><div class="form-grid">' +
      fld({ name: 'name', label: 'שם', value: a.name, full: true, placeholder: 'למשל: קרן השתלמות — מסלול מנייתי', attrs: 'autofocus' }) +
      fld({ name: 'type', label: 'סוג', type: 'select', value: a.type, options: Object.keys(C.ACCOUNT_TYPES).map(function (k) { return { value: k, label: TYPE_ICON[k] + ' ' + C.ACCOUNT_TYPES[k] }; }) }) +
      fld({ name: 'risk', label: 'רמת סיכון', type: 'select', value: a.risk, options: [{ value: 'low', label: 'נמוכה (סטיית תקן 3%)' }, { value: 'medium', label: 'בינונית (סטיית תקן 10%)' }, { value: 'high', label: 'גבוהה (סטיית תקן 18%)' }] }) +
      fld({ name: 'balance', label: 'יתרה נוכחית (₪)', type: 'amount', value: a.balance }) +
      fld({ name: 'monthly', label: 'הפקדה חודשית (₪)', type: 'amount', value: a.monthly }) +
      fld({ name: 'expReturn', label: 'תשואה שנתית צפויה (%)', type: 'number', value: a.expReturn, hint: 'ברירת מחדל סבירה לפי סוג הנכס. אפשר לשנות.' }) +
      fld({ name: 'tax', label: 'מיסוי', type: 'select', value: a.tax, tip: 'cgt', options: [{ value: 'exempt', label: 'פטור' }, { value: 'cgt', label: 'מס רווח הון 25% על הרווח הריאלי' }, { value: 'pension', label: 'פנסיוני — לא נזיל עד פרישה' }] }) +
      fld({ name: 'feeAcc', label: 'דמי ניהול מהצבירה (%)', type: 'number', value: a.feeAcc, tip: 'feeAcc' }) +
      fld({ name: 'feeDep', label: 'דמי ניהול מההפקדה (%)', type: 'number', value: a.feeDep, tip: 'feeDep' }) +
      fld({ name: 'liquidDate', label: 'תאריך נזילות (אופציונלי)', type: 'date', value: a.liquidDate, hint: 'למשל קרן השתלמות: 6 שנים מהפתיחה.' }) +
      fld({ name: 'sd', label: 'סטיית תקן שנתית (%) — אופציונלי', type: 'number', value: a.sd && a.sd !== C.RISK_SD[a.risk] ? a.sd : '', placeholder: 'לפי רמת הסיכון', hint: 'למונטה קרלו. ריק = ברירת מחדל לפי רמת הסיכון.' }) +
      '</div></form>';
    var m = openModal({
      title: isNew ? 'נכס חדש' : 'עריכת נכס', body: body,
      footer: '<button class="btn" type="button" data-save>שמור</button><button class="btn secondary" type="button" data-close>ביטול</button>',
      onMount: function (dlg) {
        if (isNew) $('[name=type]', dlg).addEventListener('change', function () {
          var d = TYPE_DEFAULTS[this.value]; if (!d) return;
          $('[name=expReturn]', dlg).value = d.expReturn; $('[name=feeAcc]', dlg).value = d.feeAcc; $('[name=feeDep]', dlg).value = d.feeDep;
          $('[name=risk]', dlg).value = d.risk; $('[name=tax]', dlg).value = d.tax;
          $('[name=liquidDate]', dlg).value = d.liquidYears ? C.addMonths(today(), d.liquidYears * 12) : '';
          var n = $('[name=name]', dlg); if (!n.value) n.value = C.ACCOUNT_TYPES[this.value];
        });
        $('[data-save]', dlg).addEventListener('click', function () {
          var v = readForm(dlg);
          var d = { name: v.name, type: v.type, balance: v.balance === '' ? 0 : amtVal(v.balance), monthly: amtValOpt(v.monthly), expReturn: pctVal(v.expReturn), feeAcc: v.feeAcc === '' ? 0 : pctVal(v.feeAcc), feeDep: v.feeDep === '' ? 0 : pctVal(v.feeDep), risk: v.risk, tax: v.tax, liquidDate: v.liquidDate };
          var errs = C.validateAccount(d);
          var sd = v.sd === '' ? null : pctVal(v.sd);
          if (sd !== null && (isNaN(sd) || sd < 0 || sd > 100)) errs.sd = 'ערך בין 0 ל-100';
          if (!showErrors(dlg, errs)) return;
          d.sd = sd !== null ? sd : C.RISK_SD[d.risk];
          m.close();
          commit(function (S) {
            if (isNew) S.accounts.push(Object.assign({ id: C.uid('a'), history: [{ date: today(), balance: d.balance }] }, d));
            else S.accounts = S.accounts.map(function (x) {
              if (x.id !== a.id) return x;
              var h = (x.history || []).slice();
              if (x.balance !== d.balance) h.push({ date: today(), balance: d.balance });
              return Object.assign({}, x, d, { history: h });
            });
            updateSnapshot();
          }, { toast: isNew ? 'הנכס נוסף' : 'הנכס עודכן' });
        });
      }
    });
  }
  function openBalanceForm(a) {
    var hist = (a.history || []).slice(-6).reverse();
    var m = openModal({
      title: 'עדכון יתרה — ' + a.name,
      body: '<form novalidate><div class="form-grid">' + fld({ name: 'balance', label: 'יתרה חדשה (₪)', type: 'amount', big: true, value: a.balance, attrs: 'autofocus' }) + fld({ name: 'date', label: 'נכון לתאריך', type: 'date', value: today() }) + '</div></form>' +
        (hist.length ? '<h3 class="mt">היסטוריית שווי</h3>' + hist.map(function (h) { return '<div class="list-item small"><span class="grow">' + esc(C.formatDateHe(h.date)) + '</span>' + money(h.balance) + '</div>'; }).join('') : ''),
      footer: '<button class="btn" type="button" data-save>עדכן</button><button class="btn secondary" type="button" data-close>ביטול</button>',
      onMount: function (dlg) {
        $('[data-save]', dlg).addEventListener('click', function () {
          var v = readForm(dlg), errs = {};
          var b = amtVal(v.balance);
          if (isNaN(b)) errs.balance = 'יש להזין סכום תקין'; else if (b < 0) errs.balance = 'הסכום לא יכול להיות שלילי';
          if (!C.isValidISO(v.date)) errs.date = 'תאריך לא תקין'; else if (v.date > today()) errs.date = 'אי אפשר לעדכן יתרה לתאריך עתידי';
          if (!showErrors(dlg, errs)) return;
          m.close();
          commit(function (S) {
            S.accounts = S.accounts.map(function (x) {
              if (x.id !== a.id) return x;
              var h = (x.history || []).filter(function (e) { return e.date !== v.date; }).concat([{ date: v.date, balance: b }]).sort(function (p, q) { return p.date < q.date ? -1 : 1; });
              var latest = h[h.length - 1];
              return Object.assign({}, x, { history: h, balance: latest.balance });
            });
            updateSnapshot();
          }, { toast: 'היתרה עודכנה' });
        });
      }
    });
  }
  function openLiabilityForm(l) {
    var isNew = !l; l = l || {};
    var m = openModal({
      title: isNew ? 'התחייבות חדשה' : 'עריכת התחייבות',
      body: '<form novalidate><div class="form-grid">' + fld({ name: 'name', label: 'שם', value: l.name, full: true, placeholder: 'משכנתא, הלוואת רכב…', attrs: 'autofocus' }) +
        fld({ name: 'balance', label: 'יתרה לסילוק (₪)', type: 'amount', value: l.balance }) + fld({ name: 'rate', label: 'ריבית שנתית (%)', type: 'number', value: l.rate }) +
        fld({ name: 'payment', label: 'החזר חודשי (₪)', type: 'amount', value: l.payment }) + fld({ name: 'endDate', label: 'תאריך סיום', type: 'date', value: l.endDate }) + '</div></form>',
      footer: '<button class="btn" type="button" data-save>שמור</button><button class="btn secondary" type="button" data-close>ביטול</button>',
      onMount: function (dlg) {
        $('[data-save]', dlg).addEventListener('click', function () {
          var v = readForm(dlg);
          var d = { name: v.name, balance: amtVal(v.balance), rate: v.rate === '' ? 0 : pctVal(v.rate), payment: amtValOpt(v.payment), endDate: v.endDate };
          if (!showErrors(dlg, C.validateLiability(d))) return;
          m.close();
          commit(function (S) {
            if (isNew) S.liabilities.push(Object.assign({ id: C.uid('l') }, d));
            else S.liabilities = S.liabilities.map(function (x) { return x.id === l.id ? Object.assign({}, x, d) : x; });
            updateSnapshot();
          }, { toast: 'נשמר' });
        });
      }
    });
  }

  /* =====================================================================
   * מסך: תחזית ותרחישים
   * ===================================================================== */
  var SCN_KEYS = ['pess', 'base', 'opt'];
  function scnColor(k) { var p = palette(); return k === 'pess' ? p.neg : k === 'opt' ? p.pos : p.primary; }
  function fcBaseline() { return C.monthlyBaseline(S, today()); }
  function fcCommon(years) {
    return { accounts: S.accounts, years: years, startISO: today(), settings: S.settings, indexDeposits: ui.fc.indexDeposits, lifeEvents: S.lifeEvents, flowReturn: Number(S.settings.flowReturn) || 4 };
  }
  function fcOptions(k, years) { return C.scenarioToOptions(S.scenarios[k], fcBaseline(), fcCommon(years)); }
  function fcFire(k) {
    var b = fcBaseline(), scn = S.scenarios[k];
    var annual = Math.round(b.expense * 12 * (1 + (Number(scn.expenseChange) || 0) / 100));
    var target = C.fireTarget(annual, S.settings.swr);
    var age = Number(S.settings.age) || 35;
    var yrs = Math.max(1, Math.min(70, 100 - age));
    var res = C.project(fcOptions(k, yrs));
    return { annual: annual, target: target, hit: annual > 0 ? C.fireAge(res.points, target, age) : null, now: res.points[0].real };
  }
  function pv(p, field) { // ערך לפי מצב ריאלי/נומינלי
    var real = ui.fc.mode === 'real';
    if (field === 'total') return real ? p.real : p.nominal;
    if (field === 'liquid') return real ? p.liquidReal : p.liquid;
    if (field === 'locked') return real ? p.lockedReal : p.locked;
    if (field === 'afterTax') return real ? p.afterTaxReal : p.afterTax;
    return 0;
  }
  function ensureScenarios() {
    if (!S.scenarios || !S.scenarios.base) S.scenarios = C.defaultScenarios(S.settings.inflation);
  }
  function renderForecast() {
    ensureScenarios();
    if (!S.accounts.length && !S.series.length) {
      return { html: '<div class="card">' + emptyState('🔮', 'תחזית צריכה נתונים', 'הוסף לפחות נכס אחד (חיסכון, פנסיה, השקעה) כדי לראות כמה תצבור בעתיד בתרחישים שונים.', '<button class="btn" type="button" data-act="add-account">' + icon('i-plus') + 'הוסף נכס</button><button class="btn secondary" type="button" data-act="load-demo">טען נתוני דמו</button>') + '</div><p class="disclaimer">התחזיות הן הערכה בלבד ואינן ייעוץ השקעות.</p>' };
    }
    var f = ui.fc;
    var scn = S.scenarios[f.active];
    var slider = function (name, label, min, max, step, val, fmt, tipKey) {
      return '<div class="slider-field"><label for="sl-' + name + '">' + esc(label) + (tipKey ? tip(tipKey) : '') + '</label><output id="out-' + name + '" for="sl-' + name + '">' + fmt(val) + '</output>' +
        '<input type="range" id="sl-' + name + '" data-scn="' + name + '" min="' + min + '" max="' + max + '" step="' + step + '" value="' + val + '" aria-valuetext="' + esc(fmt(val)) + '"></div>';
    };
    var pctFmt = function (v) { return (v > 0 ? '+' : '') + Number(v) + '%'; };
    var html = '<div class="cols-2">' +
      '<div class="card"><div class="card-h"><h2>תחזית צבירה</h2><div class="seg" role="group" aria-label="ערכים"><button type="button" data-fcmode="real" aria-pressed="' + (f.mode === 'real') + '">ריאלי</button><button type="button" data-fcmode="nominal" aria-pressed="' + (f.mode === 'nominal') + '">נומינלי</button></div></div>' +
      '<p class="hint" style="margin-top:-6px;margin-bottom:8px">' + (f.mode === 'real' ? 'בכוח הקנייה של היום' : 'בשקלים של אותה שנה') + ' ' + tip('real') + ' · שטח מלא: נזיל ונעול בתרחיש הנבחר · קווים מקווקווים: התרחישים האחרים · ▲ אירועי חיים</p>' +
      '<div class="chart-box tall"><canvas id="ch-fc" role="img" aria-label="גרף תחזית צבירה לפי תרחישים"></canvas></div>' +
      '<div class="result-kpis mt" id="fc-kpis"></div></div>' +
      '<div class="card"><div class="card-h"><h2>הגדרות התחזית</h2></div><div class="stack">' +
      '<div class="slider-field"><label for="sl-years">טווח התחזית</label><output id="out-years">' + f.years + ' שנים</output><input type="range" id="sl-years" min="1" max="40" step="1" value="' + f.years + '"></div>' +
      '<label class="switch"><input type="checkbox" id="fc-index"' + (f.indexDeposits ? ' checked' : '') + '><span>הצמד הפקדות לאינפלציה</span>' + tip('indexDeposits') + '</label>' +
      '<label class="switch"><input type="checkbox" id="fc-tax"' + (f.afterTax ? ' checked' : '') + '><span>הצג קו אחרי מס רווח הון</span>' + tip('cgt') + '</label>' +
      '<div><div class="lbl small" style="font-weight:600;color:var(--text-2);margin-bottom:6px">תרחיש לעריכה</div><div class="seg full scn-tabs" role="tablist">' +
      SCN_KEYS.map(function (k) { return '<button type="button" role="tab" data-scnsel="' + k + '" aria-pressed="' + (f.active === k) + '" aria-selected="' + (f.active === k) + '"><span class="scn-dot" style="background:' + scnColor(k) + '"></span> ' + esc(S.scenarios[k].name) + '</button>'; }).join('') + '</div></div>' +
      slider('returnAdj', 'התאמת תשואה', -5, 5, 0.5, scn.returnAdj, function (v) { return (v > 0 ? '+' : '') + v + ' נק\' אחוז'; }, 'returnAdj') +
      slider('inflation', 'אינפלציה שנתית', 0, 10, 0.1, scn.inflation, function (v) { return Number(v).toFixed(1) + '%'; }) +
      slider('incomeChange', 'שינוי בהכנסה', -50, 50, 1, scn.incomeChange, pctFmt, 'flow') +
      slider('expenseChange', 'שינוי בהוצאות', -50, 50, 1, scn.expenseChange, pctFmt, 'flow') +
      slider('extraMonthly', 'הפקדה חודשית נוספת', 0, 20000, 100, Math.round((scn.extraMonthly || 0) / 100), function (v) { return F(v * 100); }, 'flow') +
      '<button class="btn small secondary" type="button" id="fc-reset">אפס תרחיש לברירת המחדל</button></div></div></div>' +
      '<div class="cols-2e section">' +
      '<div class="card"><div class="card-h"><h2>🎲 סימולציית מונטה קרלו ' + tip('montecarlo') + '</h2><span class="small muted" id="mc-status"></span></div><div class="progress-line" aria-hidden="true"><span id="mc-prog"></span></div>' +
      '<div id="mc-sentence" class="mc-sentence mt-s" aria-live="polite">מחשב…</div><div class="chart-box"><canvas id="ch-mc" role="img" aria-label="מניפת אחוזונים 10, 50 ו-90 של סימולציית מונטה קרלו"></canvas></div>' +
      '<p class="hint mt-s">1,000 הדמיות עם תשואות חודשיות לוג-נורמליות לפי רמת הסיכון של כל נכס. אחוזונים 10/50/90 ' + tip('percentile') + '</p></div>' +
      '<div class="card" id="fc-fire"></div></div>' +
      '<div class="cols-2e section"><div class="card"><div class="card-h"><h2>⚖️ מה אם — השוואת תרחישים</h2></div><div class="row wrap" style="margin-bottom:10px">' +
      selectHTML('cmp-a', 'תרחיש א', SCN_KEYS.map(function (k) { return { value: k, label: S.scenarios[k].name }; }), f.cmpA) + '<span class="muted">מול</span>' +
      selectHTML('cmp-b', 'תרחיש ב', SCN_KEYS.map(function (k) { return { value: k, label: S.scenarios[k].name }; }), f.cmpB) + '</div><div id="fc-compare"></div></div>' +
      '<div class="card"><div class="card-h"><h2>📍 אירועי חיים</h2><button class="btn small secondary" type="button" data-act="add-event">' + icon('i-plus') + 'הוסף</button></div>' +
      (S.lifeEvents.length ? S.lifeEvents.slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; }).map(function (e) {
        var lbl = e.type === 'oneoff' ? 'הוצאה חד-פעמית' : e.type === 'income' ? 'תוספת הכנסה חודשית' : 'תוספת הוצאה חודשית';
        return '<div class="list-item"><span class="cat-ico" style="background:var(--surface-2)" aria-hidden="true">' + (e.type === 'income' ? '📈' : e.type === 'oneoff' ? '🛒' : '👶') + '</span><div class="grow"><b>' + esc(e.name) + '</b><div class="tx-meta">' + esc(lbl) + ' · ' + esc(C.formatDateHe(e.date)) + '</div></div>' +
          (e.type === 'income' ? signedMoney(e.amount, 'income') : signedMoney(e.amount, 'expense')) +
          '<button class="icon-btn small" type="button" data-act="edit-event" data-id="' + esc(e.id) + '" aria-label="ערוך ' + esc(e.name) + '">' + icon('i-edit') + '</button><button class="icon-btn small" type="button" data-act="del-event" data-id="' + esc(e.id) + '" aria-label="מחק ' + esc(e.name) + '">' + icon('i-trash') + '</button></div>';
      }).join('') + '<p class="hint mt-s">סכומים במחירי היום — מוצמדים לאינפלציה בתחזית.</p>'
        : emptyState('🗓️', 'אין אירועים מתוכננים', 'רכב חדש, חתונה, ילד, העלאה במשכורת — הוסף אותם כדי לראות איך הם משפיעים על העתיד.', '')) + '</div></div>' +
      '<p class="disclaimer">⚠️ התחזיות הן הערכה בלבד ואינן ייעוץ השקעות. תשואות עבר אינן מבטיחות תשואות עתידיות.</p>';
    return { html: html, mount: mountForecast };
  }
  var fcState = { results: null, mcToken: 0 };
  function fcCompute() {
    var r = {};
    SCN_KEYS.forEach(function (k) { r[k] = C.project(fcOptions(k, ui.fc.years)); });
    fcState.results = r;
    return r;
  }
  function mountForecast(root) {
    var f = ui.fc;
    var saveDeb = debounce(scheduleSave, 400);
    var update = debounce(function () { fcRedraw(false); }, 120);
    var mcDeb = debounce(runMonteCarlo, 500);
    $$('[data-scn]', root).forEach(function (inp) {
      inp.addEventListener('input', function () {
        var k = inp.getAttribute('data-scn');
        var v = Number(inp.value);
        S.scenarios[f.active][k] = k === 'extraMonthly' ? Math.round(v * 100) : v;
        var out = $('#out-' + k);
        var txt = k === 'returnAdj' ? (v > 0 ? '+' : '') + v + " נק' אחוז" : k === 'inflation' ? v.toFixed(1) + '%' : k === 'extraMonthly' ? F(v * 100) : (v > 0 ? '+' : '') + v + '%';
        out.textContent = txt; inp.setAttribute('aria-valuetext', txt);
        update(); mcDeb(); saveDeb();
      });
    });
    $('#sl-years').addEventListener('input', function () { f.years = Number(this.value); $('#out-years').textContent = f.years + ' שנים'; update(); mcDeb(); });
    $('#fc-index').addEventListener('change', function () { f.indexDeposits = this.checked; fcRedraw(false); runMonteCarlo(); });
    $('#fc-tax').addEventListener('change', function () { f.afterTax = this.checked; fcRedraw(false); });
    $$('[data-fcmode]', root).forEach(function (b) { b.addEventListener('click', function () { f.mode = b.getAttribute('data-fcmode'); render(); }); });
    $$('[data-scnsel]', root).forEach(function (b) { b.addEventListener('click', function () { f.active = b.getAttribute('data-scnsel'); render(); }); });
    $('#cmp-a').addEventListener('change', function () { f.cmpA = this.value; fcCompare(); });
    $('#cmp-b').addEventListener('change', function () { f.cmpB = this.value; fcCompare(); });
    $('#fc-reset').addEventListener('click', function () {
      var d = C.defaultScenarios(S.settings.inflation)[f.active];
      S.scenarios[f.active] = d; scheduleSave(); render(); toast('התרחיש אופס');
    });
    fcRedraw(true);
    runMonteCarlo();
  }
  function fcRedraw(animate) {
    var res = fcCompute();
    var f = ui.fc, p = palette();
    var main = res[f.active];
    var pts = main.points;
    var years = f.years;
    var stepY = years <= 10 ? 1 : years <= 20 ? 2 : 5;
    var baseYear = Number(today().slice(0, 4));
    var labels = pts.map(function (x) { return x.date; });
    var xTicks = function (val, idx) { return idx % (12 * stepY) === 0 ? String(baseYear + idx / 12) : ''; };
    // אירועי חיים כסמנים
    var evData = pts.map(function () { return null; }), evNames = {};
    S.lifeEvents.forEach(function (e) {
      for (var i = 0; i < pts.length; i++) {
        if (pts[i].date.slice(0, 7) === e.date.slice(0, 7)) { evData[i] = pv(pts[i], 'total') / 100; evNames[i] = (evNames[i] ? evNames[i] + ', ' : '') + e.name; break; }
      }
    });
    var ds = [
      { label: 'נזיל — ' + S.scenarios[f.active].name, data: pts.map(function (x) { return pv(x, 'liquid') / 100; }), borderColor: scnColor(f.active), backgroundColor: alpha(scnColor(f.active), 0.28), fill: 'origin', stack: 'main', pointRadius: 0, borderWidth: 2, tension: 0.2 },
      { label: 'נעול — ' + S.scenarios[f.active].name, data: pts.map(function (x) { return pv(x, 'locked') / 100; }), borderColor: alpha(p.accent, 0.9), backgroundColor: alpha(p.accent, 0.22), fill: '-1', stack: 'main', pointRadius: 0, borderWidth: 1.5, tension: 0.2 }
    ];
    SCN_KEYS.forEach(function (k) {
      if (k === f.active) return;
      ds.push({ label: 'סה"כ — ' + S.scenarios[k].name, data: res[k].points.map(function (x) { return pv(x, 'total') / 100; }), borderColor: scnColor(k), borderDash: [6, 5], fill: false, stack: 'o_' + k, pointRadius: 0, borderWidth: 2, tension: 0.2 });
    });
    if (f.afterTax) ds.push({ label: 'אחרי מס — ' + S.scenarios[f.active].name, data: pts.map(function (x) { return pv(x, 'afterTax') / 100; }), borderColor: p.warn, borderDash: [2, 3], fill: false, stack: 'tax', pointRadius: 0, borderWidth: 2 });
    if (Object.keys(evNames).length) ds.push({ label: 'אירועי חיים', data: evData, showLine: false, stack: 'ev', pointStyle: 'triangle', pointRadius: 8, pointHoverRadius: 10, backgroundColor: p.warn, borderColor: p.surface, borderWidth: 1.5, evNames: evNames });
    makeChart('fc', $('#ch-fc'), {
      type: 'line', data: { labels: labels, datasets: ds },
      options: chartBase({
        animation: animate && !reducedMotion ? { duration: 900 } : false,
        scales: { x: axisX({ ticks: { autoSkip: false, callback: xTicks } }), y: axisY({ stacked: true, beginAtZero: true }) },
        plugins: {
          legend: { labels: { filter: function (it) { return true; } } },
          tooltip: {
            callbacks: {
              title: function (items) { var i = items[0].dataIndex; return C.formatDateHe(pts[i].date) + ' · גיל ' + Math.floor((Number(S.settings.age) || 0) + i / 12); },
              label: function (ctx) {
                if (ctx.dataset.evNames) return ' 📍 ' + (ctx.dataset.evNames[ctx.dataIndex] || '');
                return ' ' + ctx.dataset.label + ': ' + (isPrivacy() ? '•••' : F(Math.round(ctx.parsed.y * 100)));
              },
              footer: function (items) {
                var i = items[0].dataIndex;
                return 'סה"כ בתרחיש הנבחר: ' + (isPrivacy() ? '•••' : F(pv(pts[i], 'total')));
              }
            }
          }
        }
      })
    });
    // KPIs
    var fin = main.final, start = pts[0];
    var gain = fin.nominal - start.nominal - main.totalDeposits;
    var rk = function (l, v, t, cls) { return '<div class="rk"><div class="rk-l">' + esc(l) + (t ? tip(t) : '') + '</div><div class="rk-v ' + (cls || '') + '">' + v + '</div></div>'; };
    $('#fc-kpis').innerHTML =
      rk('שווי בעוד ' + years + ' שנים', money(pv(fin, 'total')), 'real') +
      rk('מתוכו נזיל', money(pv(fin, 'liquid')), 'liquid') +
      rk('נעול', money(pv(fin, 'locked'))) +
      rk('אחרי מס רווח הון', money(pv(fin, 'afterTax')), 'cgt') +
      rk('סך הפקדות (נומינלי)', money(main.totalDeposits)) +
      rk('רווח מתשואה (נומינלי)', '<span class="' + (gain >= 0 ? 'pos' : 'neg') + '">' + (gain >= 0 ? '▲ ' : '▼ ') + money(Math.abs(gain)) + '</span>') +
      rk('דמי ניהול מצטברים', '<span class="neg">' + money(main.totalFees) + '</span>', 'feeAcc');
    fcFireCard();
    fcCompare();
  }
  function fcFireCard() {
    var box = $('#fc-fire'); if (!box) return;
    var k = ui.fc.active;
    var fr = fcFire(k);
    var age = Number(S.settings.age) || 35;
    var pct = fr.target > 0 ? Math.min(100, fr.now / fr.target * 100) : 0;
    box.innerHTML = '<div class="card-h"><h2>🔥 עצמאות כלכלית (FIRE) ' + tip('fire') + '</h2><span class="small muted">תרחיש ' + esc(S.scenarios[k].name) + '</span></div>' +
      (fr.annual > 0 ? '<div class="mc-sentence">' + (fr.hit ? 'בקצב הנוכחי תגיע לעצמאות כלכלית בגיל <b>' + Math.ceil(fr.hit.age) + '</b> (בעוד כ-' + Math.ceil(fr.hit.months / 12) + ' שנים).' : 'בקצב הנוכחי לא תגיע לעצמאות כלכלית עד גיל 100. הגדלת החיסכון או הקטנת ההוצאות יקרבו אותך.') + '</div>' +
        '<dl class="kv"><dt>הוצאה שנתית (במחירי היום)</dt><dd>' + money(fr.annual) + '</dd><dt>יעד FIRE</dt><dd>' + money(fr.target) + '</dd><dt>שווי נכסים היום</dt><dd>' + money(fr.now) + '</dd><dt>גיל נוכחי</dt><dd class="num">' + age + '</dd></dl>' +
        '<div class="bar mt" role="progressbar" aria-valuenow="' + Math.round(pct) + '" aria-valuemin="0" aria-valuemax="100" aria-label="התקדמות ליעד FIRE"><span style="width:' + pct + '%"></span></div><p class="hint mt-s">' + Math.round(pct) + '% מהדרך</p>' +
        '<div class="row mt"><label for="fire-swr" class="small" style="font-weight:600">שיעור משיכה בטוח ' + '</label>' + tip('swr') + '<input class="input ltr" id="fire-swr" style="width:90px" inputmode="decimal" value="' + esc(S.settings.swr) + '"><span class="small">%</span></div>'
        : emptyState('🔥', 'צריך נתוני הוצאות', 'כדי לחשב עצמאות כלכלית צריך לדעת כמה אתה מוציא בחודש.', ''));
    var swr = $('#fire-swr');
    if (swr) swr.addEventListener('change', function () {
      var v = pctVal(swr.value);
      if (!(v >= 1 && v <= 10)) { swr.setAttribute('aria-invalid', 'true'); toast('שיעור משיכה בין 1% ל-10%', 'error'); return; }
      S.settings.swr = v; scheduleSave(); fcFireCard(); fcCompare();
    });
  }
  function fcCompare() {
    var box = $('#fc-compare'); if (!box || !fcState.results) return;
    var a = ui.fc.cmpA, b = ui.fc.cmpB, ra = fcState.results[a].final, rb = fcState.results[b].final;
    var fa = fcFire(a), fb = fcFire(b);
    var sa = S.scenarios[a], sb = S.scenarios[b];
    var row = function (l, va, vb, diff) { return '<tr><td>' + esc(l) + '</td><td>' + va + '</td><td>' + vb + '</td><td>' + (diff || '') + '</td></tr>'; };
    var mdiff = function (x, y) { var d = y - x; return '<span class="' + (d >= 0 ? 'pos' : 'neg') + '">' + (d >= 0 ? '▲ +' : '▼ −') + '<span class="amt">' + esc(F(Math.abs(d))) + '</span></span>'; };
    var ageTxt = function (fr) { return fr.hit ? String(Math.ceil(fr.hit.age)) : 'לא בטווח'; };
    box.innerHTML = '<div class="table-wrap"><table class="tbl compare-tbl"><thead><tr><th>בעוד ' + ui.fc.years + ' שנים</th><th><span class="scn-dot" style="background:' + scnColor(a) + '"></span> ' + esc(sa.name) + '</th><th><span class="scn-dot" style="background:' + scnColor(b) + '"></span> ' + esc(sb.name) + '</th><th>הפרש</th></tr></thead><tbody>' +
      row('התאמת תשואה', (sa.returnAdj > 0 ? '+' : '') + sa.returnAdj + '%', (sb.returnAdj > 0 ? '+' : '') + sb.returnAdj + '%') +
      row('אינפלציה', Number(sa.inflation).toFixed(1) + '%', Number(sb.inflation).toFixed(1) + '%') +
      row('שווי נומינלי', money(ra.nominal), money(rb.nominal), mdiff(ra.nominal, rb.nominal)) +
      row('שווי ריאלי', money(ra.real), money(rb.real), mdiff(ra.real, rb.real)) +
      row('נזיל (ריאלי)', money(ra.liquidReal), money(rb.liquidReal), mdiff(ra.liquidReal, rb.liquidReal)) +
      row('אחרי מס (ריאלי)', money(ra.afterTaxReal), money(rb.afterTaxReal), mdiff(ra.afterTaxReal, rb.afterTaxReal)) +
      row('גיל FIRE', ageTxt(fa), ageTxt(fb)) + '</tbody></table></div>';
  }
  function runMonteCarlo() {
    var token = ++fcState.mcToken;
    var f = ui.fc;
    var opts = fcOptions(f.active, f.years);
    opts.runs = 1000;
    var mc;
    try { mc = C.createMonteCarlo(opts); } catch (e) { $('#mc-sentence').textContent = 'הסימולציה נכשלה: ' + friendly(e); return; }
    var prog = $('#mc-prog'), status = $('#mc-status');
    if (status) status.textContent = 'מחשב…';
    var step = function () {
      if (token !== fcState.mcToken || !$('#ch-mc')) return; // בוטל או שהמסך הוחלף
      var done;
      try { done = mc.step(40); } catch (e) { $('#mc-sentence').textContent = 'הסימולציה נכשלה: ' + friendly(e); return; }
      if (prog) prog.style.width = Math.round(mc.progress() * 100) + '%';
      if (!done) { setTimeout(step, 0); return; }
      var r = mc.result();
      if (status) status.textContent = '1,000 ריצות';
      drawMC(r);
    };
    setTimeout(step, 30);
  }
  function drawMC(r) {
    var f = ui.fc, p = palette(), real = f.mode === 'real';
    var p10 = real ? r.p10Real : r.p10, p50 = real ? r.p50Real : r.p50, p90 = real ? r.p90Real : r.p90;
    var n = p10.length - 1;
    var baseYear = Number(today().slice(0, 4));
    var stepY = f.years <= 10 ? 1 : f.years <= 20 ? 2 : 5;
    $('#mc-sentence').innerHTML = 'ב-90% מהמקרים תצבור לפחות <b>' + money(p10[n]) + '</b> בעוד ' + f.years + ' שנים (' + (real ? 'בכוח הקנייה של היום' : 'נומינלי') + ').<br><span class="small">חציון: ' + money(p50[n]) + ' · ב-10% הטובים: מעל ' + money(p90[n]) + '</span>';
    var labels = p10.map(function (_, i) { return i; });
    var c = scnColor(f.active);
    makeChart('mc', $('#ch-mc'), {
      type: 'line',
      data: { labels: labels, datasets: [
        { label: 'אחוזון 10', data: p10.map(function (v) { return v / 100; }), borderColor: alpha(c, 0.6), borderWidth: 1.5, pointRadius: 0, fill: false, tension: 0.2 },
        { label: 'אחוזון 90', data: p90.map(function (v) { return v / 100; }), borderColor: alpha(c, 0.6), borderWidth: 1.5, pointRadius: 0, backgroundColor: alpha(c, 0.18), fill: '-1', tension: 0.2 },
        { label: 'חציון (50)', data: p50.map(function (v) { return v / 100; }), borderColor: c, borderWidth: 3, pointRadius: 0, fill: false, tension: 0.2 }
      ] },
      options: chartBase({
        animation: false,
        scales: { x: axisX({ ticks: { autoSkip: false, callback: function (v, i) { return i % (12 * stepY) === 0 ? String(baseYear + i / 12) : ''; } } }), y: axisY({ beginAtZero: true }) },
        plugins: { tooltip: { callbacks: { title: function (items) { var i = items[0].dataIndex; return 'בעוד ' + (i / 12).toFixed(1) + ' שנים'; } } } }
      })
    });
  }
  function openEventForm(e) {
    var isNew = !e; e = e || { type: 'oneoff', date: C.addMonths(today(), 24) };
    var m = openModal({
      title: isNew ? 'אירוע חיים חדש' : 'עריכת אירוע',
      body: '<form novalidate><div class="form-grid">' + fld({ name: 'name', label: 'שם', value: e.name, full: true, placeholder: 'רכב חדש, חתונה, ילד, העלאה…', attrs: 'autofocus' }) +
        fld({ name: 'type', label: 'סוג', type: 'seg', full: true, value: e.type, options: [{ value: 'oneoff', label: 'הוצאה חד-פעמית' }, { value: 'income', label: 'תוספת הכנסה חודשית' }, { value: 'expense', label: 'תוספת הוצאה חודשית' }] }) +
        fld({ name: 'amount', label: 'סכום במחירי היום (₪)', type: 'amount', value: e.amount }) + fld({ name: 'date', label: 'מתי', type: 'date', value: e.date }) + '</div></form>',
      footer: '<button class="btn" type="button" data-save>שמור</button><button class="btn secondary" type="button" data-close>ביטול</button>',
      onMount: function (dlg) {
        $('[data-save]', dlg).addEventListener('click', function () {
          var v = readForm(dlg);
          var d = { name: v.name, type: v.type, amount: amtVal(v.amount), date: v.date };
          if (!showErrors(dlg, C.validateEvent(d))) return;
          m.close();
          commit(function (S) {
            if (isNew) S.lifeEvents.push(Object.assign({ id: C.uid('e') }, d));
            else S.lifeEvents = S.lifeEvents.map(function (x) { return x.id === e.id ? Object.assign({}, x, d) : x; });
          }, { toast: 'האירוע נשמר' });
        });
      }
    });
  }

  /* =====================================================================
   * מסך: יעדים
   * ===================================================================== */
  function renderGoals() {
    var t = today();
    var head = '<div class="row between" style="margin-bottom:14px"><p class="muted small">יעד ברור עם תאריך הוא המניע הכי חזק לחיסכון.</p><button class="btn small" type="button" data-act="add-goal">' + icon('i-plus') + 'יעד חדש</button></div>';
    if (!S.goals.length) return { html: head + '<div class="card">' + emptyState('🎯', 'עוד אין יעדים', 'קרן חירום, דירה, רכב, חופשה — הגדר יעד, שייך אותו לחיסכון, ותראה מתי תגיע אליו וכמה צריך להפקיד.', '<button class="btn" type="button" data-act="add-goal">' + icon('i-plus') + 'הוסף יעד</button>') + '</div>' };
    var R = 40, CIRC = 2 * Math.PI * R;
    var toCelebrate = [];
    var cards = S.goals.slice().sort(function (a, b) { return (a.priority || 2) - (b.priority || 2); }).map(function (g) {
      var a = C.analyzeGoal(g, S.accounts, t);
      var acc = g.accountId ? S.accounts.filter(function (x) { return x.id === g.accountId; })[0] : null;
      if (a.reached && !g.celebrated) toCelebrate.push(g.id);
      var status = a.reached ? '<span class="badge ok">🎉 הושג!</span>' : g.date ? (a.onTrack ? '<span class="badge ok">✓ בדרך הנכונה</span>' : '<span class="badge bad">✗ בפיגור</span>') : '';
      var prio = { 1: ['גבוהה', 'bad'], 2: ['בינונית', 'warn'], 3: ['נמוכה', 'neutral'] }[g.priority || 2];
      return '<article class="card goal-card' + (a.reached ? ' reached' : '') + '"><div class="goal-top">' +
        '<div class="ring"><svg viewBox="0 0 100 100" aria-hidden="true"><circle class="ring-bg" cx="50" cy="50" r="' + R + '" fill="none" stroke-width="10"/><circle class="ring-fg" cx="50" cy="50" r="' + R + '" fill="none" stroke-width="10" stroke-dasharray="' + CIRC.toFixed(2) + '" stroke-dashoffset="' + CIRC.toFixed(2) + '" data-ring="' + (CIRC * (1 - a.pct / 100)).toFixed(2) + '"/></svg>' +
        '<div class="ring-txt"><span data-count="' + a.pct + '" data-fmt="pct">' + Math.round(a.pct) + '%</span></div></div>' +
        '<div class="grow"><div class="row between" style="align-items:flex-start"><h3>' + esc(g.name) + '</h3><div class="row" style="gap:0"><button class="icon-btn small" type="button" data-act="edit-goal" data-id="' + esc(g.id) + '" aria-label="ערוך ' + esc(g.name) + '">' + icon('i-edit') + '</button><button class="icon-btn small" type="button" data-act="del-goal" data-id="' + esc(g.id) + '" aria-label="מחק ' + esc(g.name) + '">' + icon('i-trash') + '</button></div></div>' +
        '<div class="asset-bal" style="font-size:1.25rem">' + money(a.current) + ' <span class="muted small" style="font-weight:500">מתוך ' + money(g.target) + '</span></div>' +
        '<div class="row wrap mt-s" style="gap:6px">' + status + '<span class="badge ' + prio[1] + '">עדיפות ' + prio[0] + '</span></div></div></div>' +
        '<dl class="kv mt">' +
        (acc ? '<dt>משויך ל</dt><dd>' + esc(acc.name) + '</dd>' : '') +
        '<dt>הפקדה חודשית</dt><dd>' + money(a.monthly) + '</dd>' +
        (g.date ? '<dt>תאריך יעד</dt><dd>' + esc(C.formatDateHe(g.date)) + '</dd>' : '') +
        (!a.reached ? '<dt>הגעה צפויה</dt><dd>' + (a.eta ? esc(C.monthLabel(a.eta.slice(0, 7))) : '<span class="neg">לא בקצב הנוכחי</span>') + '</dd>' : '') +
        (!a.reached && a.required !== null ? '<dt>נדרש בחודש כדי לעמוד ביעד</dt><dd><b>' + money(a.required) + '</b></dd>' : '') + '</dl>' +
        (!acc && !a.reached ? '<button class="btn small secondary mt" type="button" data-act="goal-deposit" data-id="' + esc(g.id) + '">' + icon('i-plus') + 'הוסף הפקדה</button>' : '') +
        '</article>';
    }).join('');
    return {
      html: head + '<div class="asset-grid">' + cards + '</div>',
      mount: function (root) {
        requestAnimationFrame(function () { requestAnimationFrame(function () { $$('[data-ring]', root).forEach(function (c) { c.style.strokeDashoffset = c.getAttribute('data-ring'); }); }); });
        if (toCelebrate.length) {
          setTimeout(celebrate, 500);
          S.goals.forEach(function (g) { if (toCelebrate.indexOf(g.id) >= 0) g.celebrated = true; });
          scheduleSave();
          toast('🎉 כל הכבוד! הגעת ליעד');
        }
      }
    };
  }
  function celebrate() {
    if (reducedMotion) return;
    var wrap = document.createElement('div');
    wrap.className = 'confetti'; wrap.setAttribute('aria-hidden', 'true');
    var colors = ['#14b8a6', '#f59e0b', '#6366f1', '#ec4899', '#22c55e', '#0ea5e9'];
    for (var i = 0; i < 70; i++) {
      var s = document.createElement('i');
      s.style.left = (Math.random() * 100) + '%';
      s.style.background = colors[i % colors.length];
      s.style.animationDelay = (Math.random() * 0.7) + 's';
      s.style.animationDuration = (2 + Math.random() * 1.6) + 's';
      s.style.transform = 'rotate(' + Math.round(Math.random() * 360) + 'deg)';
      wrap.appendChild(s);
    }
    document.body.appendChild(wrap);
    setTimeout(function () { if (wrap.parentNode) wrap.parentNode.removeChild(wrap); }, 4500);
  }
  function openGoalForm(g) {
    var isNew = !g;
    g = g || { priority: 2, accountId: '', date: C.addMonths(today(), 12) };
    var accOpts = [{ value: '', label: 'ללא — אעדכן ידנית' }].concat(S.accounts.map(function (a) { return { value: a.id, label: a.name }; }));
    var m = openModal({
      title: isNew ? 'יעד חדש' : 'עריכת יעד',
      body: '<form novalidate><div class="form-grid">' + fld({ name: 'name', label: 'שם היעד', value: g.name, full: true, placeholder: 'קרן חירום, דירה, רכב, חופשה…', attrs: 'autofocus' }) +
        fld({ name: 'target', label: 'סכום יעד (₪)', type: 'amount', value: g.target }) + fld({ name: 'date', label: 'תאריך יעד', type: 'date', value: g.date }) +
        fld({ name: 'accountId', label: 'שיוך לחיסכון', type: 'select', value: g.accountId || '', options: accOpts, full: true, hint: 'אם תשייך, ההתקדמות תחושב לפי יתרת החיסכון.' }) +
        fld({ name: 'saved', label: 'נחסך עד כה (₪)', type: 'amount', value: g.saved || 0, hidden: !!g.accountId }) +
        fld({ name: 'monthly', label: 'הפקדה חודשית מתוכננת (₪)', type: 'amount', value: g.monthly || '', hint: 'ריק = לפי ההפקדה החודשית של החיסכון המשויך.' }) +
        fld({ name: 'priority', label: 'עדיפות', type: 'seg', full: true, value: String(g.priority || 2), options: [{ value: '1', label: 'גבוהה' }, { value: '2', label: 'בינונית' }, { value: '3', label: 'נמוכה' }] }) + '</div></form>',
      footer: '<button class="btn" type="button" data-save>שמור</button><button class="btn secondary" type="button" data-close>ביטול</button>',
      onMount: function (dlg) {
        $('[name=accountId]', dlg).addEventListener('change', function () { $('[data-field="saved"]', dlg).hidden = !!this.value; });
        $('[data-save]', dlg).addEventListener('click', function () {
          var v = readForm(dlg);
          var d = { name: v.name, target: amtVal(v.target), date: v.date, accountId: v.accountId || null, saved: v.accountId ? 0 : amtValOpt(v.saved), monthly: amtValOpt(v.monthly), priority: Number(v.priority) || 2 };
          var errs = C.validateGoal(d, isNew ? today() : null);
          if (!showErrors(dlg, errs)) return;
          m.close();
          commit(function (S) {
            if (isNew) S.goals.push(Object.assign({ id: C.uid('g'), celebrated: false }, d));
            else S.goals = S.goals.map(function (x) { return x.id === g.id ? Object.assign({}, x, d, { celebrated: x.celebrated && d.target <= x.target }) : x; });
          }, { toast: 'היעד נשמר' });
        });
      }
    });
  }
  function goalDeposit(g) {
    var m = openModal({
      title: 'הפקדה ל' + g.name,
      body: '<form novalidate>' + fld({ name: 'amount', label: 'סכום (₪)', type: 'amount', big: true, attrs: 'autofocus' }) + '<p class="hint mt-s">אפשר גם להזין סכום שלילי? לא — למשיכה ערוך את היעד.</p></form>',
      footer: '<button class="btn" type="button" data-save>הוסף</button><button class="btn secondary" type="button" data-close>ביטול</button>',
      onMount: function (dlg) {
        var go2 = function (e) {
          if (e) e.preventDefault();
          var a = amtVal(readForm(dlg).amount), errs = {};
          if (isNaN(a)) errs.amount = 'יש להזין סכום תקין'; else if (a <= 0) errs.amount = 'הסכום חייב להיות גדול מאפס';
          if (!showErrors(dlg, errs)) return;
          m.close();
          commit(function (S) { S.goals.forEach(function (x) { if (x.id === g.id) x.saved = (x.saved || 0) + a; }); }, { toast: 'ההפקדה נוספה' });
        };
        $('[data-save]', dlg).addEventListener('click', go2);
        $('form', dlg).addEventListener('submit', go2);
      }
    });
  }

  /* =====================================================================
   * מסך: סגירת חודש
   * ===================================================================== */
  function renderClose() {
    var sd = S.settings.monthStartDay, cur = C.finMonthKey(today(), sd), prev = C.shiftMonthKey(cur, -1);
    var key = ui.closeMonth || prev;
    var sm = C.monthCloseSummary(S, key);
    var c = sm.current, p = sm.previous, avg = sm.average;
    var opts = C.lastMonthKeys(cur, 13).reverse().map(function (k) { return { value: k, label: C.monthLabel(k) + (k === cur ? ' (בתהליך)' : '') }; });
    var diff = function (a, b, goodUp) {
      if (b === null || b === undefined) return '';
      var d = a - b; if (Math.abs(d) < 100) return '<span class="muted">ללא שינוי</span>';
      var good = (d > 0) === goodUp;
      return '<span class="' + (good ? 'pos' : 'neg') + '">' + (d > 0 ? '▲ ' : '▼ ') + money(Math.abs(d)) + '</span>';
    };
    var range = C.finMonthRange(key, sd);
    if (!c.count) {
      return { html: '<div class="row wrap" style="margin-bottom:14px"><label class="row small">חודש: ' + selectHTML('close-month', 'בחר חודש', opts, key) + '</label></div><div class="card">' + emptyState('📅', 'אין תנועות בחודש הזה', 'בחר חודש אחר, או הוסף תנועות כדי לקבל סיכום חודשי.', '') + '</div>', mount: bindCloseMonth };
    }
    var goals = S.goals.map(function (g) { return { g: g, a: C.analyzeGoal(g, S.accounts, today()) }; });
    var html = '<div class="row wrap between" style="margin-bottom:14px"><label class="row small">חודש: ' + selectHTML('close-month', 'בחר חודש', opts, key) + '</label>' +
      '<button class="btn small secondary" type="button" data-act="print-report" data-key="' + key + '">' + icon('i-print') + 'דוח להדפסה / PDF</button></div>' +
      '<div class="card"><h2>סיכום ' + esc(C.monthLabel(key)) + '</h2><p class="muted small">' + esc(C.formatDateHe(range.start)) + ' – ' + esc(C.formatDateHe(range.end)) + '</p>' +
      '<div class="close-hero mt">' +
      '<div class="rk" style="background:var(--surface-2);border-radius:12px;padding:14px"><div class="rk-l">נחסך החודש</div><div class="rk-v ' + (c.net >= 0 ? 'pos' : 'neg') + '" style="font-size:1.6rem">' + (c.net >= 0 ? '▲ ' : '▼ ') + money(Math.abs(c.net)) + '</div><div class="small">' + Math.round(c.rate) + '% מההכנסה</div></div>' +
      '<div class="rk" style="background:var(--surface-2);border-radius:12px;padding:14px"><div class="rk-l">לעומת החודש הקודם</div><div class="rk-v">' + (p.count ? diff(c.net, p.net, true) : '<span class="muted">—</span>') + '</div><div class="small muted">חודש קודם: ' + money(p.net) + '</div></div>' +
      '<div class="rk" style="background:var(--surface-2);border-radius:12px;padding:14px"><div class="rk-l">לעומת הממוצע</div><div class="rk-v">' + (avg.months ? diff(c.net, avg.income - avg.expense, true) : '<span class="muted">—</span>') + '</div><div class="small muted">' + (sm.avgRate !== null ? 'ממוצע: ' + Math.round(sm.avgRate) + '% חיסכון' : 'אין עדיין ממוצע') + '</div></div>' +
      '<div class="rk" style="background:var(--surface-2);border-radius:12px;padding:14px"><div class="rk-l">הכנסות / הוצאות</div><div class="small mt-s">' + signedMoney(c.income, 'income') + '</div><div class="small">' + signedMoney(c.expense, 'expense') + '</div></div></div></div>' +
      '<div class="cols-2e section"><div class="card"><div class="card-h"><h2>⚠️ קטגוריות שחרגו</h2></div>' +
      (sm.overs.length ? sm.overs.map(function (o) {
        return '<div class="list-item"><span class="cat-ico" style="background:var(--neg-soft)" aria-hidden="true">' + esc(o.icon) + '</span><div class="grow"><b>' + esc(o.name) + '</b><div class="tx-meta">' + money(o.spent) + ' מול ' + (o.refType === 'budget' ? 'תקציב של ' : 'ממוצע של ') + money(o.ref) + '</div></div><span class="neg">▼ ' + money(o.diff) + '</span></div>';
      }).join('') : emptyState('🏆', 'לא היו חריגות', 'כל הקטגוריות היו בתקציב או קרוב לממוצע. כל הכבוד!', '')) + '</div>' +
      '<div class="card"><div class="card-h"><h2>🎯 התקדמות ביעדים</h2></div>' +
      (goals.length ? goals.map(function (x) { return '<div class="budget-row"><b>' + esc(x.g.name) + '</b><span class="small">' + Math.round(x.a.pct) + '%</span><div class="bar"><span data-w="' + x.a.pct + '"></span></div></div>'; }).join('') : emptyState('🎯', 'אין יעדים', 'הגדר יעד כדי לעקוב אחרי ההתקדמות.', '<button class="btn small" type="button" data-nav="goals">הוסף יעד</button>')) + '</div></div>' +
      '<div class="card section" style="background:var(--primary-soft);border-color:transparent"><h2>💡 פעולה אחת לחודש הבא</h2><p class="mt-s" style="font-size:1.05rem">' + esc(sm.action) + '</p></div>';
    return {
      html: html,
      mount: function (root) {
        bindCloseMonth(root);
        animateBars();
        if (key <= prev && (!S.meta.lastCloseSeen || S.meta.lastCloseSeen < key)) { S.meta.lastCloseSeen = key; scheduleSave(); }
      }
    };
  }
  function bindCloseMonth() { var s = $('#close-month'); if (s) s.addEventListener('change', function () { ui.closeMonth = this.value; render(); }); }
  function printReport(key) {
    var sm = C.monthCloseSummary(S, key), c = sm.current, cm = catMap();
    var range = C.finMonthRange(key, S.settings.monthStartDay);
    var cats = Object.keys(c.byCategory).map(function (id) { return { c: cm[id] || catById(id), v: c.byCategory[id] }; }).sort(function (a, b) { return b.v - a.v; });
    var nw = C.netWorth(S.accounts, S.liabilities);
    var Fp = function (a) { return '<span class="amt">' + esc(F(a)) + '</span>'; };
    $('#print-report').innerHTML = '<div class="rep" dir="rtl"><h1>דוח חודשי — ' + esc(C.monthLabel(key)) + '</h1><p>' + esc(C.formatDateHe(range.start)) + ' – ' + esc(C.formatDateHe(range.end)) + ' · הופק ב-' + esc(C.formatDateHe(today())) + '</p>' +
      '<h2>סיכום</h2><div class="grid4"><div class="box">הכנסות<b>' + Fp(c.income) + '</b></div><div class="box">הוצאות<b>' + Fp(c.expense) + '</b></div><div class="box">נחסך<b>' + Fp(c.net) + '</b></div><div class="box">שיעור חיסכון<b>' + Math.round(c.rate) + '%</b></div></div>' +
      '<p style="margin-top:8pt">חודש קודם: נחסך ' + Fp(sm.previous.net) + (sm.avgRate !== null ? ' · ממוצע שיעור חיסכון: ' + Math.round(sm.avgRate) + '%' : '') + ' · שווי נקי נוכחי: ' + Fp(nw.net) + '</p>' +
      '<h2>הוצאות לפי קטגוריה</h2><table><thead><tr><th>קטגוריה</th><th>סכום</th><th>תקציב</th><th>% מההוצאות</th></tr></thead><tbody>' +
      cats.map(function (x) { return '<tr><td>' + esc(x.c.icon + ' ' + x.c.name) + '</td><td>' + Fp(x.v) + '</td><td>' + (x.c.budget ? Fp(x.c.budget) : '—') + '</td><td>' + (c.expense ? Math.round(x.v / c.expense * 100) : 0) + '%</td></tr>'; }).join('') + '</tbody></table>' +
      (sm.overs.length ? '<h2>חריגות</h2><ul>' + sm.overs.map(function (o) { return '<li>' + esc(o.name) + ': ' + Fp(o.spent) + ' (חריגה של ' + Fp(o.diff) + ')</li>'; }).join('') + '</ul>' : '') +
      (S.goals.length ? '<h2>יעדים</h2><table><tbody>' + S.goals.map(function (g) { var a = C.analyzeGoal(g, S.accounts, today()); return '<tr><td>' + esc(g.name) + '</td><td>' + Fp(a.current) + ' / ' + Fp(g.target) + '</td><td>' + Math.round(a.pct) + '%</td></tr>'; }).join('') + '</tbody></table>' : '') +
      '<h2>פעולה לחודש הבא</h2><p>' + esc(sm.action) + '</p><p style="margin-top:20pt;font-size:9pt;color:#555">מצפן כספי · הנתונים מוצפנים ונשמרים רק בדפדפן שלך · התחזיות הן הערכה בלבד ואינן ייעוץ השקעות.</p></div>';
    setTimeout(function () { try { window.print(); } catch (e) { toast('ההדפסה נכשלה', 'error'); } }, 50);
  }

  /* =====================================================================
   * מסך: הגדרות
   * ===================================================================== */
  var fsHandle = null;
  var fsSupported = typeof window.showSaveFilePicker === 'function';
  function renderSettings() {
    var st = S.settings;
    var lastB = S.meta.lastBackupAt;
    var html = '<div class="cols-2e">' +
      '<div class="card"><div class="card-h"><h2>הגדרות כלליות</h2></div><form id="set-form" novalidate><div class="form-grid">' +
      fld({ name: 'monthStartDay', label: 'יום תחילת חודש כלכלי', type: 'number', value: st.monthStartDay, hint: 'בין 1 ל-28. למשל 10 אם המשכורת נכנסת ב-10.' }) +
      fld({ name: 'inflation', label: 'אינפלציה צפויה (%)', type: 'number', value: st.inflation }) +
      fld({ name: 'age', label: 'גיל נוכחי', type: 'number', value: st.age }) +
      fld({ name: 'retireAge', label: 'גיל פרישה', type: 'number', value: st.retireAge }) +
      fld({ name: 'swr', label: 'שיעור משיכה בטוח (%)', type: 'number', value: st.swr, tip: 'swr' }) +
      fld({ name: 'flowReturn', label: 'תשואה לכסף נוסף בתחזית (%)', type: 'number', value: st.flowReturn, tip: 'flow' }) +
      fld({ name: 'lockMinutes', label: 'נעילה אוטומטית אחרי (דקות)', type: 'number', value: st.lockMinutes }) +
      fld({ name: 'theme', label: 'ערכת צבעים', type: 'seg', value: st.theme || 'auto', options: [{ value: 'auto', label: 'אוטומטי' }, { value: 'light', label: 'בהיר' }, { value: 'dark', label: 'כהה' }] }) +
      '</div><button class="btn mt" type="submit">שמור הגדרות</button></form></div>' +
      '<div class="stack">' +
      '<div class="card"><div class="card-h"><h2>💾 גיבוי ושחזור</h2></div><p class="small muted">גיבוי אחרון: <b>' + (lastB ? esc(C.formatDateHe(lastB)) : 'אף פעם') + '</b>. קובץ הגיבוי מוצפן באותה סיסמה — כך גם מעבירים נתונים בין מכשירים.</p>' +
      '<div class="row wrap mt"><button class="btn" type="button" data-act="export-backup">' + icon('i-download') + 'גיבוי מוצפן</button><button class="btn secondary" type="button" data-act="import-backup">' + icon('i-upload') + 'שחזור מגיבוי</button></div>' +
      (fsSupported ? '<div class="row wrap mt-s"><button class="btn small secondary" type="button" data-act="pick-backup-file">בחר קובץ גיבוי קבוע</button><button class="btn small secondary" type="button" data-act="update-backup-file" id="upd-backup">עדכן קובץ גיבוי בלחיצה</button></div><p class="hint mt-s">בחר פעם אחת קובץ (למשל בתיקיית OneDrive/Dropbox) והאפליקציה תעדכן אותו בלחיצה.</p>' : '') +
      '<div class="row wrap mt-s" id="undo-import-wrap" hidden><button class="btn small ghost" type="button" data-act="undo-import">↩ בטל את הייבוא האחרון</button></div>' +
      '<hr style="border:0;border-top:1px solid var(--border);margin:14px 0"><button class="btn small ghost" type="button" data-act="export-csv">' + icon('i-download') + 'ייצוא תנועות ל-CSV (לא מוצפן)</button></div>' +
      '<div class="card"><div class="card-h"><h2>🔐 אבטחה</h2></div><p class="small muted">הנתונים מוצפנים ב-AES-GCM עם מפתח שנגזר מהסיסמה (PBKDF2-SHA256, ' + ITER.toLocaleString('he-IL') + ' איטרציות). הסיסמה והמפתח לא נשמרים בשום מקום.</p>' +
      '<div class="row wrap mt"><button class="btn secondary" type="button" data-act="change-password">החלף סיסמה</button><button class="btn secondary" type="button" data-act="lock">' + icon('i-lock') + 'נעל עכשיו</button></div></div>' +
      '<div class="card"><div class="card-h"><h2>🧪 נתוני דמו</h2></div><p class="small muted">משק בית ישראלי לדוגמה עם 12 חודשי היסטוריה. נתוני הדמו מסומנים ונמחקים בלחיצה, בלי לגעת בנתונים שלך.</p><div class="row wrap mt">' +
      (S.meta.demo ? '<button class="btn secondary" type="button" data-act="remove-demo">מחק נתוני דמו</button>' : '<button class="btn secondary" type="button" data-act="load-demo">טען נתוני דמו</button>') + '</div></div>' +
      '</div></div>';
    html += '<div class="card section"><div class="card-h"><h2>קטגוריות</h2><button class="btn small" type="button" data-act="add-category">' + icon('i-plus') + 'קטגוריה חדשה</button></div><div class="table-wrap"><table class="tbl"><thead><tr><th>צבע</th><th>אייקון</th><th>שם</th><th>סוג</th><th>חיונית</th><th><span class="sr-only">מחק</span></th></tr></thead><tbody>' +
      S.categories.map(function (c) {
        return '<tr data-cat="' + esc(c.id) + '"><td><input type="color" data-catf="color" value="' + esc(c.color) + '" aria-label="צבע ל' + esc(c.name) + '"></td>' +
          '<td><input class="input" style="width:64px;text-align:center;min-height:40px" data-catf="icon" maxlength="4" value="' + esc(c.icon) + '" aria-label="אייקון ל' + esc(c.name) + '"></td>' +
          '<td><input class="input" style="min-width:150px;min-height:40px" data-catf="name" maxlength="40" value="' + esc(c.name) + '" aria-label="שם קטגוריה"></td>' +
          '<td>' + (c.kind === 'income' ? '<span class="badge ok">הכנסה</span>' : '<select class="input" style="min-height:40px" data-catf="group" aria-label="סוג הוצאה ל' + esc(c.name) + '">' + ['fixed', 'variable', 'occasional'].map(function (g) { return '<option value="' + g + '"' + (c.group === g ? ' selected' : '') + '>' + GROUP_LABEL[g] + '</option>'; }).join('') + '</select>') + '</td>' +
          '<td>' + (c.kind === 'expense' ? '<label class="switch"><input type="checkbox" data-catf="essential"' + (c.essential ? ' checked' : '') + ' aria-label="חיונית: ' + esc(c.name) + '"></label>' : '') + '</td>' +
          '<td>' + (c.id === 'exp_other' || c.id === 'inc_other' ? '' : '<button class="icon-btn small" type="button" data-act="del-category" data-id="' + esc(c.id) + '" aria-label="מחק קטגוריה ' + esc(c.name) + '">' + icon('i-trash') + '</button>') + '</td></tr>';
      }).join('') + '</tbody></table></div></div>';
    html += '<div class="cols-2e section"><div class="card"><div class="card-h"><h2>אודות</h2></div><dl class="kv">' +
      '<dt>גרסה</dt><dd class="num">' + APP_VERSION + '</dd><dt>גרסת סכמה</dt><dd class="num">' + S.schemaVersion + '</dd>' +
      '<dt>אחסון</dt><dd>' + ({ idb: 'IndexedDB', ls: 'localStorage', memory: 'זיכרון בלבד (לא נשמר!)' })[Store.mode()] + '</dd>' +
      '<dt>אחסון קבוע</dt><dd>' + (persistGranted === true ? '✓ אושר' : persistGranted === false ? 'לא אושר ע"י הדפדפן' : 'לא ידוע') + '</dd>' +
      '<dt>תנועות</dt><dd class="num">' + S.transactions.length + '</dd><dt>מותקן כאפליקציה</dt><dd>' + (isStandalone() ? 'כן' : 'לא') + '</dd></dl>' +
      '<p class="hint mt">בלי שרת, בלי אנליטיקס ובלי קריאות רשת. הכל נשאר במכשיר שלך.</p></div>' +
      '<div class="card" style="border-color:color-mix(in srgb, var(--neg) 40%, transparent)"><div class="card-h"><h2 class="neg">אזור מסוכן</h2></div><p class="small">איפוס מוחק את כל הנתונים מהדפדפן הזה לצמיתות. אם יש לך גיבוי, תוכל לשחזר ממנו (בסיסמה של הגיבוי).</p><button class="btn danger mt" type="button" data-act="reset">' + icon('i-trash') + 'איפוס מלא</button></div></div>';
    return {
      html: html,
      mount: function (root) {
        var form = $('#set-form');
        form.addEventListener('submit', function (e) {
          e.preventDefault();
          var v = readForm(form), errs = {};
          var n = function (k, min, max, int) { var x = pctVal(v[k]); if (isNaN(x) || x < min || x > max || (int && Math.round(x) !== x)) { errs[k] = 'ערך ' + (int ? 'שלם ' : '') + 'בין ' + min + ' ל-' + max; } return x; };
          var d = { monthStartDay: n('monthStartDay', 1, 28, true), inflation: n('inflation', 0, 30), age: n('age', 16, 100, true), retireAge: n('retireAge', 40, 90, true), swr: n('swr', 1, 10), flowReturn: n('flowReturn', -10, 20), lockMinutes: n('lockMinutes', 1, 240, true), theme: v.theme };
          if (!errs.age && !errs.retireAge && d.retireAge <= d.age) errs.retireAge = 'גיל הפרישה חייב להיות גדול מהגיל הנוכחי';
          if (!showErrors(form, errs)) return;
          commit(function (S) {
            if (S.scenarios && S.scenarios.base && Number(S.scenarios.base.inflation) === Number(S.settings.inflation)) S.scenarios.base.inflation = d.inflation;
            Object.assign(S.settings, d);
          }, { toast: 'ההגדרות נשמרו' });
          applyTheme();
          render();
        });
        $$('[data-catf]', root).forEach(function (inp) {
          inp.addEventListener('change', function () {
            var id = inp.closest('[data-cat]').getAttribute('data-cat');
            var f = inp.getAttribute('data-catf');
            var val = inp.type === 'checkbox' ? inp.checked : inp.value.trim();
            if (f === 'name' && !val) { toast('שם קטגוריה לא יכול להיות ריק', 'error'); inp.setAttribute('aria-invalid', 'true'); return; }
            commit(function (S) { S.categories.forEach(function (c) { if (c.id === id) c[f] = val; }); }, { render: false });
          });
        });
        if (Store.mode() === 'idb' || Store.mode() === 'ls' || Store.mode() === 'memory') {
          Store.get('preimport').then(function (p) { var w = $('#undo-import-wrap'); if (p && w) w.hidden = false; }).catch(function () { });
        }
      }
    };
  }
  function openCategoryForm() {
    var m = openModal({
      title: 'קטגוריה חדשה',
      body: '<form novalidate><div class="form-grid">' + fld({ name: 'name', label: 'שם', full: true, attrs: 'autofocus' }) +
        fld({ name: 'kind', label: 'סוג', type: 'seg', full: true, value: 'expense', options: [{ value: 'expense', label: 'הוצאה' }, { value: 'income', label: 'הכנסה' }] }) +
        fld({ name: 'group', label: 'סוג הוצאה', type: 'select', value: 'variable', options: [{ value: 'fixed', label: 'קבועה' }, { value: 'variable', label: 'שוטפת' }, { value: 'occasional', label: 'מזדמנת' }] }) +
        fld({ name: 'icon', label: 'אייקון (אימוג׳י)', value: '🏷️', max: 4 }) + fld({ name: 'color', label: 'צבע', type: 'color', value: '#0ea5e9' }) +
        fld({ name: 'essential', label: 'חיונית', type: 'switch', value: false, tip: 'essential' }) + '</div></form>',
      footer: '<button class="btn" type="button" data-save>הוסף</button><button class="btn secondary" type="button" data-close>ביטול</button>',
      onMount: function (dlg) {
        $('[name=kind]', dlg).addEventListener('change', function () { var ex = this.value === 'expense'; $('[data-field="group"]', dlg).hidden = !ex; $('[data-field="essential"]', dlg).hidden = !ex; });
        $('[data-save]', dlg).addEventListener('click', function () {
          var v = readForm(dlg), errs = {};
          if (!v.name) errs.name = 'יש להזין שם';
          else if (S.categories.some(function (c) { return c.name === v.name && c.kind === v.kind; })) errs.name = 'כבר קיימת קטגוריה בשם הזה';
          if (!showErrors(dlg, errs)) return;
          m.close();
          commit(function (S) { S.categories.push({ id: C.uid('cat'), kind: v.kind, name: v.name, group: v.kind === 'expense' ? v.group : null, icon: v.icon || '🏷️', color: v.color, essential: v.kind === 'expense' && v.essential, subscription: false, budget: 0 }); }, { toast: 'הקטגוריה נוספה' });
        });
      }
    });
  }
  function deleteCategory(id) {
    var c = catById(id);
    var used = S.transactions.filter(function (t) { return t.categoryId === id; }).length + S.series.filter(function (s) { return s.categoryId === id; }).length;
    var fallback = c.kind === 'income' ? 'inc_other' : 'exp_other';
    confirmDialog({ title: 'מחיקת קטגוריה', text: used ? 'יש ' + used + ' תנועות בקטגוריה "' + c.name + '". הן יועברו לקטגוריה "' + catById(fallback).name + '".' : 'למחוק את הקטגוריה "' + c.name + '"?', ok: 'מחק', danger: true }).then(function (ok) {
      if (!ok) return;
      commit(function (S) {
        S.categories = S.categories.filter(function (x) { return x.id !== id; });
        S.transactions.forEach(function (t) { if (t.categoryId === id) t.categoryId = fallback; });
        S.series.forEach(function (s) { if (s.categoryId === id) s.categoryId = fallback; });
      }, { undo: 'הקטגוריה נמחקה' });
    });
  }

  /* ---------- גיבוי מוצפן ---------- */
  function buildBackup() {
    return flushSave().then(function () { return Crypto.encrypt(KEY, S); }).then(function (enc) {
      return { format: C.BACKUP_FORMAT, app: 'matzpen', appVersion: APP_VERSION, schemaVersion: S.schemaVersion, createdAt: new Date().toISOString(),
        kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: ITER, salt: SALT }, iv: enc.iv, data: enc.data };
    });
  }
  function markBackedUp() { S.meta.lastBackupAt = today(); S.meta.backupSnooze = null; scheduleSave(); render(); }
  function downloadBackup() {
    buildBackup().then(function (file) {
      downloadBlob(new Blob([JSON.stringify(file)], { type: 'application/json' }), 'matzpen-backup-' + today() + '.json');
      markBackedUp();
      toast('קובץ גיבוי מוצפן ירד ✓');
    }).catch(function (e) { toast('הגיבוי נכשל: ' + friendly(e), 'error'); });
  }
  function verifyPerm(h) {
    var o = { mode: 'readwrite' };
    return h.queryPermission(o).then(function (p) { return p === 'granted' ? true : h.requestPermission(o).then(function (p2) { return p2 === 'granted'; }); });
  }
  function writeBackupTo(h) {
    return verifyPerm(h).then(function (ok) {
      if (!ok) throw new Error('אין הרשאה לכתוב לקובץ');
      return buildBackup();
    }).then(function (file) {
      return h.createWritable().then(function (w) { return w.write(JSON.stringify(file)).then(function () { return w.close(); }); });
    }).then(function () { markBackedUp(); toast('קובץ הגיבוי "' + h.name + '" עודכן ✓'); });
  }
  function pickBackupFile() {
    window.showSaveFilePicker({ suggestedName: 'matzpen-backup.json', types: [{ description: 'גיבוי מצפן כספי', accept: { 'application/json': ['.json'] } }] }).then(function (h) {
      fsHandle = h;
      if (Store.mode() === 'idb') Store.set('backupHandle', h).catch(function () { });
      return writeBackupTo(h);
    }).catch(function (e) { if (e && e.name !== 'AbortError') toast('לא ניתן לשמור לקובץ: ' + friendly(e), 'error'); });
  }
  function updateBackupFile() {
    (fsHandle ? Promise.resolve(fsHandle) : (Store.mode() === 'idb' ? Store.get('backupHandle') : Promise.resolve(null))).then(function (h) {
      if (!h) return pickBackupFile();
      fsHandle = h;
      return writeBackupTo(h);
    }).catch(function (e) { if (e && e.name !== 'AbortError') toast('עדכון הגיבוי נכשל: ' + friendly(e), 'error'); });
  }
  function backupNow() {
    if (!fsSupported) return downloadBackup();
    (fsHandle ? Promise.resolve(fsHandle) : (Store.mode() === 'idb' ? Store.get('backupHandle') : Promise.resolve(null))).then(function (h) {
      if (h) { fsHandle = h; return writeBackupTo(h); }
      downloadBackup();
    }).catch(function () { downloadBackup(); });
  }
  function decryptBackupWithPrompt(obj) {
    return passwordPrompt({ title: 'סיסמת הגיבוי', text: 'הגיבוי הוצפן בסיסמה אחרת (למשל ממכשיר אחר, או לפני החלפת סיסמה). הזן את הסיסמה שהייתה בשימוש כשהגיבוי נוצר.' }).then(function (pw) {
      if (pw === null) return null;
      return Crypto.deriveKey(pw, Crypto.unb64(obj.kdf.salt), obj.kdf.iterations).then(function (k) { return Crypto.decrypt(k, obj.iv, obj.data); })
        .catch(function () { toast('סיסמה שגויה לקובץ הגיבוי', 'error'); return decryptBackupWithPrompt(obj); });
    });
  }
  function importBackup() {
    pickFile('.json,application/json').then(function (file) {
      if (!file) return;
      if (file.size > 50 * 1024 * 1024) { toast('הקובץ גדול מדי', 'error'); return; }
      return file.text().then(function (txt) {
        var obj;
        try { obj = JSON.parse(txt); } catch (e) { toast('הקובץ אינו JSON תקין', 'error'); return; }
        var chk = C.validateBackupEnvelope(obj);
        if (!chk.ok) { toast(chk.error, 'error'); return; }
        var attempt = (obj.kdf.salt === SALT && obj.kdf.iterations === ITER) ? Crypto.decrypt(KEY, obj.iv, obj.data) : Promise.reject(new Error('other'));
        return attempt.catch(function () { return decryptBackupWithPrompt(obj); }).then(function (data) {
          if (!data) return;
          var migrated;
          try { migrated = C.migrate(data); } catch (e) { toast('לא ניתן לקרוא את הגיבוי: ' + friendly(e), 'error'); return; }
          var errs = C.validateState(migrated);
          if (errs.length) { toast('קובץ הגיבוי פגום: ' + errs[0], 'error'); return; }
          return confirmDialog({
            title: 'שחזור מגיבוי',
            html: 'הנתונים הנוכחיים (' + S.transactions.length + ' תנועות, ' + S.accounts.length + ' נכסים) <b>יוחלפו</b> בנתונים מהגיבוי (' + migrated.transactions.length + ' תנועות, ' + migrated.accounts.length + ' נכסים' + (obj.createdAt ? ', מ-' + esc(C.formatDateHe(C.todayISO(new Date(obj.createdAt)))) : '') + ').<br><br>לפני הייבוא יישמר עותק של המצב הנוכחי, ותוכל לבטל את הייבוא. הסיסמה במכשיר הזה לא משתנה.',
            ok: 'שחזר מהגיבוי'
          }).then(function (ok) {
            if (!ok) return;
            return flushSave().then(function () { return Crypto.encrypt(KEY, S); }).then(function (enc) {
              return Store.set('preimport', { iv: enc.iv, data: enc.data, salt: SALT, savedAt: Date.now() });
            }).then(function () {
              S = migrated; lastMaint = null; dirty = true;
              applyTheme(); applyPrivacy(!!S.settings.privacy);
              flushSave();
              render(true);
              toast('הנתונים שוחזרו מהגיבוי', 'info', { duration: 15000, action: { label: 'בטל ייבוא', fn: undoImport } });
            });
          });
        });
      });
    }).catch(function (e) { toast('השחזור נכשל: ' + friendly(e), 'error'); });
  }
  function undoImport() {
    Store.get('preimport').then(function (p) {
      if (!p) { toast('אין ייבוא לביטול', 'error'); return; }
      if (p.salt !== SALT) { toast('לא ניתן לבטל — הסיסמה הוחלפה מאז', 'error'); return; }
      return Crypto.decrypt(KEY, p.iv, p.data).then(function (obj) {
        S = C.migrate(obj); lastMaint = null; dirty = true;
        return flushSave().then(function () { return Store.del('preimport'); }).then(function () { applyTheme(); render(true); toast('הייבוא בוטל — הנתונים הקודמים שוחזרו'); });
      });
    }).catch(function (e) { toast('ביטול הייבוא נכשל: ' + friendly(e), 'error'); });
  }

  /* ---------- החלפת סיסמה ---------- */
  function changePassword() {
    var m = openModal({
      title: 'החלפת סיסמה',
      body: '<form novalidate><div class="stack">' + fld({ name: 'cur', label: 'סיסמה נוכחית', type: 'password', autocomplete: 'current-password', attrs: 'autofocus' }) +
        '<div class="field" data-field="pw"><label for="np1">סיסמה חדשה</label><input class="input" type="password" id="np1" name="pw" autocomplete="new-password">' + strengthHTML() + '<div class="err" role="alert"></div></div>' +
        fld({ name: 'pw2', label: 'הקלד שוב את הסיסמה החדשה', type: 'password' }) +
        '<p class="hint">כל הנתונים יוצפנו מחדש בסיסמה החדשה. גיבויים ישנים ימשיכו להיפתח בסיסמה הישנה.</p></div></form>',
      footer: '<button class="btn" type="button" data-save>החלף סיסמה</button><button class="btn secondary" type="button" data-close>ביטול</button>',
      onMount: function (dlg) {
        bindStrength(dlg, $('#np1', dlg));
        var btn = $('[data-save]', dlg);
        btn.addEventListener('click', function () {
          var v = readForm(dlg), errs = {};
          if (!v.cur) errs.cur = 'יש להזין את הסיסמה הנוכחית';
          if (v.pw.length < MIN_PW) errs.pw = 'לפחות ' + MIN_PW + ' תווים';
          else if (v.pw !== v.pw2) errs.pw2 = 'הסיסמאות לא תואמות';
          else if (v.pw === v.cur) errs.pw = 'הסיסמה החדשה זהה לנוכחית';
          if (!showErrors(dlg, errs)) return;
          btn.disabled = true; btn.textContent = 'מצפין מחדש…';
          var vault;
          flushSave().then(function () { return Store.get('vault'); }).then(function (vlt) {
            vault = vlt;
            return Crypto.deriveKey(v.cur, Crypto.unb64(vault.kdf.salt), vault.kdf.iterations);
          }).then(function (k) {
            return Crypto.decrypt(k, vault.iv, vault.data).catch(function () { throw new Error('WRONG'); });
          }).then(function () {
            var salt = Crypto.random(16);
            return Crypto.deriveKey(v.pw, salt, KDF_ITER).then(function (nk) {
              KEY = nk; SALT = Crypto.b64(salt); ITER = KDF_ITER; dirty = true;
              return flushSave();
            });
          }).then(function () {
            Store.del('preimport').catch(function () { });
            m.close();
            toast('הסיסמה הוחלפה והנתונים הוצפנו מחדש ✓');
            render();
          }).catch(function (e) {
            btn.disabled = false; btn.textContent = 'החלף סיסמה';
            if (e && e.message === 'WRONG') showErrors(dlg, { cur: 'סיסמה שגויה' });
            else toast('החלפת הסיסמה נכשלה: ' + friendly(e), 'error');
          });
        });
      }
    });
  }

  /* ---------- איפוס מלא (אישור כפול) ---------- */
  function resetFlow() {
    var m = openModal({
      title: 'איפוס מלא',
      body: '<p>כל הנתונים במכשיר הזה יימחקו <b>לצמיתות</b>: תנועות, חסכונות, יעדים והגדרות.</p>' +
        '<div class="banner warn mt small"><span class="b-icon" aria-hidden="true">⚠️</span><span class="b-text">אם שכחת את הסיסמה — אין דרך לשחזר את הנתונים המוצפנים. אחרי האיפוס תוכל לשחזר רק מקובץ גיבוי, ורק אם אתה זוכר את הסיסמה שלו.</span></div>' +
        '<form novalidate class="mt">' + fld({ name: 'confirm', label: 'כדי לאשר, הקלד את המילה "מחק"', attrs: 'autofocus autocomplete="off"' }) + '</form>',
      footer: '<button class="btn danger" type="button" data-go>מחק הכל</button><button class="btn secondary" type="button" data-close>ביטול</button>',
      onMount: function (dlg) {
        var goReset = function (e) {
          if (e) e.preventDefault();
          if (readForm(dlg).confirm !== 'מחק') { showErrors(dlg, { confirm: 'יש להקליד בדיוק: מחק' }); return; }
          m.close();
          confirmDialog({ title: 'בטוח לגמרי?', text: 'זו הפעולה האחרונה. אין דרך חזרה.', ok: 'כן, מחק לצמיתות', danger: true }).then(function (ok) {
            if (!ok) return;
            clearTimeout(saveTimer); dirty = false;
            KEY = null; S = null; SALT = null;
            destroyCharts(); closeAllModals();
            Store.clearAll().then(function () {
              try { history.replaceState(null, '', location.pathname + location.search); } catch (e2) { /* */ }
              $('#view').innerHTML = ''; $('#banners').innerHTML = '';
              renderSetup();
              toast('כל הנתונים נמחקו');
            });
          });
        };
        $('[data-go]', dlg).addEventListener('click', goReset);
        $('form', dlg).addEventListener('submit', goReset);
      }
    });
  }

  /* ---------- דמו ---------- */
  function loadDemo() {
    var proceed = function () {
      var d = C.generateDemo(today());
      commit(function (S) {
        if (!hasData() && !S.series.length) {
          var keep = { createdAt: S.meta.createdAt, theme: S.settings.theme, lockMinutes: S.settings.lockMinutes, privacy: S.settings.privacy };
          Object.keys(d).forEach(function (k) { S[k] = d[k]; });
          S.meta.createdAt = keep.createdAt; S.settings.theme = keep.theme; S.settings.lockMinutes = keep.lockMinutes; S.settings.privacy = keep.privacy;
        } else {
          ['series', 'transactions', 'accounts', 'liabilities', 'goals', 'lifeEvents'].forEach(function (k) { S[k] = S[k].concat(d[k]); });
          var have = {}; S.snapshots.forEach(function (x) { have[x.month] = true; });
          S.snapshots = S.snapshots.concat(d.snapshots.filter(function (x) { return !have[x.month]; })).sort(function (a, b) { return a.month < b.month ? -1 : 1; });
          S.categories.forEach(function (c) { var dc = d.categories.filter(function (x) { return x.id === c.id; })[0]; if (dc && dc.budget && !c.budget) { c.budget = dc.budget; c.demoBudget = true; } });
        }
        S.meta.demo = true; S.meta.onboarded = true;
      }, { toast: 'נתוני הדמו נטענו' });
    };
    if (hasData()) confirmDialog({ title: 'טעינת נתוני דמו', text: 'נתוני הדמו יתווספו לנתונים הקיימים שלך ויסומנו, כך שתוכל למחוק אותם בלחיצה בלי לגעת בנתונים שלך.', ok: 'טען' }).then(function (ok) { if (ok) proceed(); });
    else proceed();
  }
  function removeDemo() {
    confirmDialog({ title: 'מחיקת נתוני הדמו', text: 'כל נתוני הדמו יימחקו. נתונים שהוספת בעצמך יישארו.', ok: 'מחק נתוני דמו', danger: true }).then(function (ok) {
      if (!ok) return;
      commit(function (S0) {
        var clean = C.removeDemo(S0);
        Object.keys(clean).forEach(function (k) { S0[k] = clean[k]; });
        S0.snapshots = C.ensureSnapshot(S0.snapshots, S0.accounts, S0.liabilities, today());
      }, { undo: 'נתוני הדמו נמחקו' });
    });
  }

  /* =====================================================================
   * פעולות (דלגציה גלובלית)
   * ===================================================================== */
  function byId(list, id) { return (list || []).filter(function (x) { return x.id === id; })[0]; }
  function confirmDelete(what, name, fn) {
    confirmDialog({ title: 'מחיקת ' + what, text: 'למחוק את "' + name + '"?', ok: 'מחק', danger: true }).then(function (ok) { if (ok) fn(); });
  }
  var RENDER = { dashboard: renderDashboard, transactions: renderTransactions, budget: renderBudget, assets: renderAssets, forecast: renderForecast, goals: renderGoals, close: renderClose, settings: renderSettings };
  var ACTIONS = {
    privacy: togglePrivacy, theme: toggleTheme, more: openMoreSheet,
    lock: function () { lock('האפליקציה ננעלה.'); },
    'add-tx': function () { openTxForm(); },
    'edit-tx': function (d) { var t = byId(S.transactions, d.id); if (t) openTxForm({ tx: t }); },
    'del-tx': function (d) { deleteTx(d.id); },
    'edit-series': function (d) { var s = byId(S.series, d.id); if (s) openTxForm({ series: s }); },
    'del-series': function (d) { deleteSeries(d.id); },
    'import-csv': importCSV, 'export-csv': exportCSV,
    'add-account': function () { openAccountForm(); },
    'edit-account': function (d) { var a = byId(S.accounts, d.id); if (a) openAccountForm(a); },
    'update-balance': function (d) { var a = byId(S.accounts, d.id); if (a) openBalanceForm(a); },
    'del-account': function (d) {
      var a = byId(S.accounts, d.id); if (!a) return;
      confirmDelete('נכס', a.name, function () {
        commit(function (S) { S.accounts = S.accounts.filter(function (x) { return x.id !== a.id; }); S.goals.forEach(function (g) { if (g.accountId === a.id) { g.accountId = null; g.saved = a.balance; } }); updateSnapshot(); }, { undo: 'הנכס נמחק' });
      });
    },
    'add-liability': function () { openLiabilityForm(); },
    'edit-liability': function (d) { var l = byId(S.liabilities, d.id); if (l) openLiabilityForm(l); },
    'del-liability': function (d) { var l = byId(S.liabilities, d.id); if (l) confirmDelete('התחייבות', l.name, function () { commit(function (S) { S.liabilities = S.liabilities.filter(function (x) { return x.id !== l.id; }); updateSnapshot(); }, { undo: 'נמחק' }); }); },
    'add-event': function () { openEventForm(); },
    'edit-event': function (d) { var e = byId(S.lifeEvents, d.id); if (e) openEventForm(e); },
    'del-event': function (d) { var e = byId(S.lifeEvents, d.id); if (e) commit(function (S) { S.lifeEvents = S.lifeEvents.filter(function (x) { return x.id !== e.id; }); }, { undo: 'האירוע נמחק' }); },
    'add-goal': function () { openGoalForm(); },
    'edit-goal': function (d) { var g = byId(S.goals, d.id); if (g) openGoalForm(g); },
    'del-goal': function (d) { var g = byId(S.goals, d.id); if (g) confirmDelete('יעד', g.name, function () { commit(function (S) { S.goals = S.goals.filter(function (x) { return x.id !== g.id; }); }, { undo: 'היעד נמחק' }); }); },
    'goal-deposit': function (d) { var g = byId(S.goals, d.id); if (g) goalDeposit(g); },
    'open-close': function (d) { ui.closeMonth = d.key; go('close'); },
    'print-report': function (d) { printReport(d.key); },
    'remove-demo': removeDemo, 'load-demo': loadDemo,
    'dismiss-ios': function () { S.meta.iosDismissed = today(); scheduleSave(); renderBanners(); },
    'backup-now': backupNow,
    'snooze-backup': function () { S.meta.backupSnooze = C.addDays(today(), 1); scheduleSave(); renderBanners(); },
    'export-backup': downloadBackup, 'import-backup': importBackup, 'pick-backup-file': pickBackupFile, 'update-backup-file': updateBackupFile, 'undo-import': undoImport,
    'change-password': changePassword, reset: resetFlow,
    'add-category': openCategoryForm, 'del-category': function (d) { deleteCategory(d.id); }
  };
  document.addEventListener('click', function (e) {
    if (!S || !KEY) return;
    var n = e.target.closest('[data-nav]');
    if (n) { e.preventDefault(); go(n.getAttribute('data-nav')); return; }
    var a = e.target.closest('[data-act]');
    if (a) {
      var fn = ACTIONS[a.getAttribute('data-act')];
      if (fn) { e.preventDefault(); try { fn(a.dataset, a, e); } catch (err) { console.error(err); toast('הפעולה נכשלה: ' + friendly(err), 'error'); } }
    }
  });
  $('#fab').addEventListener('click', function () { if (S) openTxForm(); });
  // קיצור מקלדת: N להוספת תנועה (כשלא מקלידים בשדה)
  document.addEventListener('keydown', function (e) {
    if (!S || modalStack.length || e.ctrlKey || e.metaKey || e.altKey) return;
    var tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable) return;
    if (e.key === 'n' || e.key === 'מ') { e.preventDefault(); openTxForm(); }
  });

  /* =====================================================================
   * שגיאות גלובליות ואתחול
   * ===================================================================== */
  var lastErrAt = 0;
  function globalError(msg) {
    if (Date.now() - lastErrAt < 3000) return;
    lastErrAt = Date.now();
    toast('אירעה שגיאה לא צפויה. הנתונים שלך בטוחים. (' + String(msg || '').slice(0, 120) + ')', 'error');
  }
  window.onerror = function (msg, src, line, col, err) { globalError(err && err.message ? err.message : msg); };
  window.addEventListener('unhandledrejection', function (e) { var r = e.reason; if (r && r.name === 'AbortError') return; globalError(r && r.message ? r.message : r); });

  function registerSW() {
    try {
      if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
        navigator.serviceWorker.register('sw.js').catch(function () { /* לא קריטי */ });
      }
    } catch (e) { /* file:// — מדלגים בשקט */ }
  }

  function init() {
    applyTheme();
    if (!Crypto.available()) { renderNoCrypto(); return; }
    Store.init().then(function () { return Store.get('vault'); }).then(function (v) {
      if (v && v.kdf && v.iv && v.data) renderUnlock(); else renderSetup();
      if (Store.mode() === 'memory') toast('הדפדפן חוסם אחסון מקומי — הנתונים לא יישמרו אחרי סגירת הדף.', 'error', { duration: 10000 });
    }).catch(function (e) {
      showLockRoot(lockShell('<h1>שגיאה בטעינה</h1><p class="muted">' + esc(friendly(e)) + '</p>'));
    });
    registerSW();
  }

  // חשיפה מינימלית לבדיקות אוטומטיות (בלי גישה לנתונים או למפתח)
  window.MatzpenApp = { version: APP_VERSION, storageMode: function () { return Store.mode(); }, isUnlocked: function () { return !!KEY; } };

  init();
})();
