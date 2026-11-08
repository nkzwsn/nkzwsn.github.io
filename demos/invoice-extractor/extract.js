/* Invoice Extractor, browser demo. Same parser and checks as the Python version's local engine. */
(function () {
  'use strict';

  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

  var SAMPLES = ['acme-cloud-oct.pdf', 'INV-2026-0142_cahaya-printing.pdf', 'pixelworks-invoice-1093.pdf',
    'sumber-rejeki-faktur.pdf'];
  var results = document.getElementById('results');
  var invoices = [];

  // ---------------------------------------------------------------- PDF -> text lines
  async function pdfLines(buffer) {
    var pdf = await pdfjsLib.getDocument({ data: buffer }).promise, out = [];
    for (var p = 1; p <= pdf.numPages; p++) {
      var content = await (await pdf.getPage(p)).getTextContent(), rows = [];
      content.items.forEach(function (it) {
        if (!it.str || !it.str.trim()) return;
        var y = it.transform[5], x = it.transform[4];
        var row = rows.find(function (r) { return Math.abs(r.y - y) < 3; });
        if (!row) { row = { y: y, parts: [] }; rows.push(row); }
        row.parts.push({ x: x, s: it.str.trim() });
      });
      rows.sort(function (a, b) { return b.y - a.y; }).forEach(function (r) {
        out.push(r.parts.sort(function (a, b) { return a.x - b.x; }).map(function (q) { return q.s; }).join(' '));
      });
    }
    return out;
  }

  // ---------------------------------------------------------------- parser (port of extract_local)
  var LABELS = {
    invoice_number: '(?:invoice\\s*(?:no|number|#)|no\\.?\\s*faktur|nomor\\s*faktur|no\\.?\\s*invoice)',
    invoice_date: '(?:invoice\\s*date|date|tanggal(?:\\s*faktur)?)',
    due_date: '(?:due\\s*date|payment\\s*due|jatuh\\s*tempo)',
    customer: '(?:bill\\s*to|billed\\s*to|customer|kepada|pelanggan)'
  };
  var MONEY = '(?:Rp\\.?\\s?|\\$|USD\\s?|IDR\\s?)?-?[\\d.,]+';
  var MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

  function detectCurrency(t) {
    if (/\bRp\.?\s?\d|\bIDR\b/.test(t)) return 'IDR';
    if (/\$\s?\d|\bUSD\b/.test(t)) return 'USD';
    return null;
  }
  function parseNumber(raw, cur) {
    var s = raw.replace(/[^\d.,-]/g, '');
    s = cur === 'IDR' ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
    return parseFloat(s);
  }
  function pad(n) { return String(n).padStart(2, '0'); }
  function ymd(y, m, d) {
    if (m < 1 || m > 12 || d < 1 || d > 31) return null;
    return y + '-' + pad(m) + '-' + pad(d);
  }
  function parseDate(raw, cur) {
    raw = raw.trim();
    var m;
    if ((m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/))) return ymd(+m[1], +m[2], +m[3]);
    if ((m = raw.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/))) {
      // Indonesian invoices are day-first, US ones month-first.
      return cur === 'USD' ? ymd(+m[3], +m[1], +m[2]) || ymd(+m[3], +m[2], +m[1]) : ymd(+m[3], +m[2], +m[1]);
    }
    if ((m = raw.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/))) {
      var mi = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()); if (mi >= 0) return ymd(+m[3], mi + 1, +m[1]);
    }
    if ((m = raw.match(/^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})$/))) {
      var mj = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()); if (mj >= 0) return ymd(+m[3], mj + 1, +m[2]);
    }
    return null;
  }

  function extract(name, lines) {
    var inv = { file: name, items: [], issues: [], vendor: null, invoice_number: null, invoice_date: null,
      due_date: null, customer: null, currency: null, subtotal: null, tax: null, total: null };
    var text = lines.join('\n');
    if (!text.trim()) { inv.issues.push('no text layer (scanned PDF?): the full version reads these with Claude'); return inv; }
    inv.currency = detectCurrency(text);
    inv.vendor = lines[0] || null;
    Object.keys(LABELS).forEach(function (key) {
      var m = text.match(new RegExp('^' + LABELS[key] + '\\s*[:#]?\\s*(.+)$', 'im'));
      if (m) inv[key] = /date$/.test(key) ? parseDate(m[1], inv.currency) : m[1].trim();
    });
    [['subtotal', 'sub\\s*-?total'], ['tax', '(?:tax|ppn|vat|gst)[^\\n\\d$]*?(?:\\d+\\s*%)?'],
     ['total', '(?:grand\\s*)?total(?:\\s*due)?']].forEach(function (pair) {
      var m = text.match(new RegExp('^' + pair[1] + '\\s*:?\\s*(' + MONEY + ')\\s*$', 'im'));
      if (m) inv[pair[0]] = parseNumber(m[1], inv.currency);
    });
    var itemRe = new RegExp('^(.+?)\\s+(\\d+(?:[.,]\\d+)?)\\s+(' + MONEY + ')\\s+(' + MONEY + ')$');
    lines.forEach(function (line) {
      var m = line.match(itemRe);
      if (m && !/^(sub\s*total|total|tax|ppn|gst|vat)/i.test(m[1])) {
        inv.items.push({ description: m[1], quantity: parseFloat(m[2].replace(',', '.')),
          unit_price: parseNumber(m[3], inv.currency), amount: parseNumber(m[4], inv.currency) });
      }
    });
    return inv;
  }

  // ---------------------------------------------------------------- checks (port of validate)
  function close(a, b, cur) { return Math.abs(a - b) <= (cur === 'IDR' ? 1 : 0.02); }
  function fmt2(n) { return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function amt(n, cur) { return cur === 'IDR' ? 'Rp ' + Math.round(n).toLocaleString('id-ID') : (cur === 'USD' ? '$' : '') + fmt2(n); }
  function validate(inv) {
    ['vendor', 'invoice_number', 'invoice_date', 'total'].forEach(function (k) {
      if (inv[k] == null || inv[k] === '') inv.issues.push('missing ' + k.replace('_', ' '));
    });
    if (!inv.items.length) inv.issues.push('no line items found');
    inv.items.forEach(function (it) {
      if (!close(it.quantity * it.unit_price, it.amount, inv.currency)) inv.issues.push("line '" + it.description + "': qty x price != amount");
    });
    var sum = inv.items.reduce(function (s, it) { return s + it.amount; }, 0);
    if (inv.items.length && inv.subtotal != null && !close(sum, inv.subtotal, inv.currency))
      inv.issues.push('line items add up to ' + amt(sum, inv.currency) + ', subtotal says ' + amt(inv.subtotal, inv.currency));
    if (inv.subtotal != null && inv.total != null) {
      var expected = inv.subtotal + (inv.tax || 0);
      if (!close(expected, inv.total, inv.currency))
        inv.issues.push('subtotal + tax = ' + amt(expected, inv.currency) + ', but total says ' + amt(inv.total, inv.currency));
    }
    return inv;
  }

  // ---------------------------------------------------------------- UI
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function money(v, cur) {
    if (v == null || isNaN(v)) return '<span class="muted">?</span>';
    if (cur === 'IDR') return 'Rp ' + Math.round(v).toLocaleString('id-ID');
    return (cur === 'USD' ? '$' : '') + fmt2(v);
  }

  function render() {
    var flagged = invoices.filter(function (i) { return i.issues.length; }).length;
    var rows = invoices.map(function (inv, n) {
      var ok = !inv.issues.length;
      return '<tr class="inv" data-n="' + n + '"><td><b>' + esc(inv.vendor || '?') + '</b><br><span class="muted">' +
        esc(inv.file) + '</span>' + (ok ? '' : '<div class="issues">' + inv.issues.map(esc).join('<br>') + '</div>') +
        '</td><td class="nw">' + esc(inv.invoice_number || '?') + '</td><td class="nw">' + esc(inv.invoice_date || '?') + '</td><td class="num">' +
        money(inv.subtotal, inv.currency) + '</td><td class="num">' + money(inv.tax, inv.currency) + '</td><td class="num"><b>' +
        money(inv.total, inv.currency) + '</b></td><td><span class="pill ' + (ok ? 'ok">OK' : 'bad">Needs review') +
        '</span></td></tr><tr class="items" hidden><td colspan="7"><table>' + inv.items.map(function (it) {
          return '<tr><td>' + esc(it.description) + '</td><td class="num">' + it.quantity + ' x ' + money(it.unit_price, inv.currency) +
            '</td><td class="num">' + money(it.amount, inv.currency) + '</td></tr>';
        }).join('') + '</table></td></tr>';
    }).join('');
    results.innerHTML = '<div class="summary"><div><b>' + invoices.length + ' invoice' + (invoices.length === 1 ? '' : 's') +
      ' read, ' + flagged + ' need' + (flagged === 1 ? 's' : '') + ' review</b><div class="muted">Click a row to see its line items.</div></div>' +
      '<button class="btn primary" id="download" type="button">Download Excel</button></div>' +
      '<div class="card scroll"><table><thead><tr><th>Vendor</th><th>Invoice no</th><th>Date</th><th class="num">Subtotal</th>' +
      '<th class="num">Tax</th><th class="num">Total</th><th>Status</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
    results.hidden = false;
    results.style.animation = 'none'; void results.offsetWidth; results.style.animation = '';
    results.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  results.addEventListener('click', function (e) {
    if (e.target.id === 'download') return download();
    var row = e.target.closest('tr.inv');
    if (row) row.nextElementSibling.hidden = !row.nextElementSibling.hidden;
  });

  function download() {
    if (!window.XLSX) return;
    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(invoices.map(function (i) {
      return { File: i.file, Vendor: i.vendor, 'Invoice no': i.invoice_number, Date: i.invoice_date, Due: i.due_date,
        Customer: i.customer, Currency: i.currency, Subtotal: i.subtotal, Tax: i.tax, Total: i.total,
        Status: i.issues.length ? 'Needs review' : 'OK', Issues: i.issues.join('; ') };
    })), 'Invoices');
    var items = [];
    invoices.forEach(function (i) {
      i.items.forEach(function (it) {
        items.push({ File: i.file, Vendor: i.vendor, 'Invoice no': i.invoice_number, Date: i.invoice_date,
          Description: it.description, Qty: it.quantity, 'Unit price': it.unit_price, Amount: it.amount, Currency: i.currency });
      });
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(items), 'Line items');
    var sum = {};
    invoices.forEach(function (i) {
      var k = (i.vendor || '?') + '|' + (i.currency || '?');
      sum[k] = sum[k] || { Vendor: i.vendor || '?', Currency: i.currency || '?', Invoices: 0, Total: 0 };
      sum[k].Invoices++; sum[k].Total += i.total || 0;
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(Object.keys(sum).sort().map(function (k) { return sum[k]; })), 'Summary');
    XLSX.writeFile(wb, 'invoices.xlsx');
  }

  var busy = false;
  async function run(named) { // named: [{name, buffer: Promise<ArrayBuffer>}]
    if (busy) return;
    busy = true;
    var btn = document.getElementById('samples'), label = btn.textContent;
    btn.disabled = true; btn.textContent = 'Reading...';
    invoices = [];
    for (var k = 0; k < named.length; k++) {
      try {
        invoices.push(validate(extract(named[k].name, await pdfLines(await named[k].buffer))));
      } catch (err) {
        invoices.push({ file: named[k].name, items: [], issues: ['could not read this PDF'], currency: null });
      }
    }
    btn.disabled = false; btn.textContent = label; busy = false;
    render();
  }

  document.getElementById('samples').addEventListener('click', function () {
    run(SAMPLES.map(function (f) {
      return { name: f, buffer: fetch('samples/' + f).then(function (r) { return r.arrayBuffer(); }) };
    }));
  });
  function fromFiles(list) {
    var pdfs = Array.prototype.filter.call(list, function (f) { return /\.pdf$/i.test(f.name) || f.type === 'application/pdf'; });
    if (pdfs.length) run(pdfs.slice(0, 20).map(function (f) { return { name: f.name, buffer: f.arrayBuffer() }; }));
  }
  document.getElementById('file').addEventListener('change', function (e) { fromFiles(e.target.files); e.target.value = ''; });
  var drop = document.getElementById('drop');
  ['dragenter', 'dragover'].forEach(function (t) {
    drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.add('over'); });
  });
  ['dragleave', 'drop'].forEach(function (t) {
    drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.remove('over'); });
  });
  drop.addEventListener('drop', function (e) { fromFiles(e.dataTransfer.files); });

  document.getElementById('sample-links').innerHTML = SAMPLES.map(function (f) {
    return '<a href="samples/' + f + '" target="_blank" rel="noopener">' + f.replace('.pdf', '') + '</a>';
  }).join(', ');
})();
