/* Order Desk, browser demo. Same screens as the Python/Flask app, data in localStorage. */
(function () {
  'use strict';

  var SHOP = 'Toko Kopi Senja';
  var KEY = 'orderdesk-demo-v1';
  var STATUSES = ['new', 'paid', 'shipped', 'done'];
  var PRODUCTS = [
    ['Kopi Susu Gula Aren 1 L', 85000], ['Cold Brew 500 ml', 55000], ['Biji Kopi Gayo 250 g', 95000],
    ['Biji Kopi Toraja 250 g', 105000], ['Drip Bag (isi 10)', 60000], ['Matcha Latte 1 L', 90000],
    ['Tumbler Senja', 120000]
  ].map(function (p, i) { return { id: i + 1, name: p[0], price: p[1] }; });
  var NAMES = ['Rina Wulandari', 'Budi Santoso', 'Dewi Lestari', 'Agus Pratama', 'Sari Indah', 'Fajar Nugroho',
    'Maya Putri', 'Andi Wijaya', 'Nadia Rahma', 'Yoga Saputra', 'Laras Ayu', 'Dimas Prakoso',
    'Intan Permata', 'Reza Kurniawan', 'Tika Amalia', 'Hendra Gunawan'];
  var AREAS = ['Jl. Kaliurang Km 7, Sleman', 'Jl. Gejayan No. 21, Depok', 'Perum Griya Asri B-4, Bantul',
    'Jl. Parangtritis Km 3, Sewon', 'Jl. Magelang Km 5, Mlati', 'Jl. Solo Km 9, Kalasan'];

  var app = document.getElementById('app');
  var db;

  // ---------------------------------------------------------------- helpers
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function rp(v) { return 'Rp ' + Math.round(v || 0).toLocaleString('id-ID'); }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
  function iso(d) { // local date-time, like Python's isoformat(timespec="seconds")
    var p = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' +
      p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  }
  function day(isoStr) { return isoStr.slice(0, 10); }
  function today(offset) { var d = new Date(); d.setDate(d.getDate() - (offset || 0)); return iso(d).slice(0, 10); }
  function when(isoStr) {
    var t = isoStr.slice(11, 16);
    if (day(isoStr) === today()) return 'today ' + t;
    if (day(isoStr) === today(1)) return 'yesterday ' + t;
    var d = new Date(isoStr);
    return d.getDate() + ' ' + d.toLocaleString('en', { month: 'short' }) + ' ' + t;
  }
  function total(o) { return o.items.reduce(function (s, i) { return s + i.qty * i.price; }, 0); }
  function nItems(o) { return o.items.reduce(function (s, i) { return s + i.qty; }, 0); }
  function normalizePhone(raw) {
    var d = String(raw).replace(/\D/g, '');
    if (d.charAt(0) === '0') d = '62' + d.slice(1); else if (d.charAt(0) === '8') d = '62' + d;
    return d.length >= 10 && d.length <= 15 ? d : null;
  }
  var toastTimer;
  function toast(msg) {
    var el = document.getElementById('toast');
    el.textContent = msg; el.classList.remove('hide');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.add('hide'); }, 2600);
  }

  // ---------------------------------------------------------------- storage
  function rng(seed) { // mulberry32: same demo data for everyone
    return function () {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function seed() {
    var r = rng(7), int = function (a, b) { return a + Math.floor(r() * (b - a + 1)); };
    var pick = function (arr) { return arr[Math.floor(r() * arr.length)]; };
    var orders = [], id = 1, now = new Date();
    for (var back = 13; back >= 0; back--) {
      var base = new Date(); base.setDate(base.getDate() - back);
      var n = int(2, 6) + (base.getDay() === 0 || base.getDay() === 6 ? 2 : 0);
      for (var k = 0; k < n; k++) {
        var c = new Date(base); c.setHours(int(8, 20), int(0, 59), 0, 0);
        if (c > now) c = new Date(now.getTime() - int(5, 90) * 60000);
        var status = back >= 3 ? (r() < 1 / 13 ? 'cancelled' : 'done')
          : back >= 1 ? pick(['paid', 'shipped', 'done']) : pick(['new', 'new', 'paid']);
        var phone = '628'; for (var j = 0; j < 9; j++) phone += int(0, 9);
        var prods = PRODUCTS.slice().sort(function () { return r() - 0.5; }).slice(0, int(1, 3));
        orders.push({
          id: id++, customer: pick(NAMES), phone: phone, address: pick(AREAS),
          note: pick(['', '', 'Kirim sore ya', 'Less sugar']), status: status,
          created: iso(c), updated: iso(c),
          items: prods.map(function (p) { return { product: p.name, qty: int(1, 3), price: p.price }; })
        });
      }
    }
    return { orders: orders, nextId: id };
  }
  function load() {
    try { var s = JSON.parse(localStorage.getItem(KEY)); if (s && s.orders) return s; } catch (e) {}
    return seed();
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) {} }
  function find(id) { return db.orders.filter(function (o) { return o.id === id; })[0]; }

  // ---------------------------------------------------------------- WhatsApp
  function waLink(o) {
    var lines = o.items.map(function (i) { return '- ' + i.qty + 'x ' + i.product; }).join('\n');
    var name = o.customer.split(' ')[0], t = rp(total(o));
    var msg = {
      new: 'Halo kak ' + name + ', terima kasih sudah order di ' + SHOP + '!\n\nPesanan #' + o.id + ':\n' + lines +
        '\nTotal: ' + t + '\n\nPembayaran bisa transfer ke BCA 123-456-7890 a.n. ' + SHOP +
        '. Kirim bukti transfer di sini ya kak.',
      paid: 'Halo kak ' + name + ', pembayaran pesanan #' + o.id + ' (' + t + ') sudah kami terima. ' +
        'Pesanan sedang kami siapkan, terima kasih!',
      shipped: 'Halo kak ' + name + ', pesanan #' + o.id + ' sudah dikirim hari ini. Ditunggu ya kak, kabari kalau sudah sampai.',
      done: 'Halo kak ' + name + ', semoga suka dengan pesanannya! Kalau berkenan, boleh minta review singkatnya kak? ' +
        'Terima kasih sudah belanja di ' + SHOP + '.'
    }[o.status] || ('Halo kak ' + name + ', terkait pesanan #' + o.id + ':');
    return 'https://wa.me/' + o.phone + '?text=' + encodeURIComponent(msg);
  }

  // ---------------------------------------------------------------- views
  function pill(s) { return '<span class="pill ' + s + '">' + cap(s) + '</span>'; }

  function dashboard() {
    var t0 = today(), wk = today(6), paidish = ['paid', 'shipped', 'done'];
    var live = db.orders.filter(function (o) { return o.status !== 'cancelled'; });
    var sum = function (list) { return list.reduce(function (s, o) { return s + total(o); }, 0); };
    var stats = {
      today: live.filter(function (o) { return day(o.created) === t0; }).length,
      week: sum(db.orders.filter(function (o) { return paidish.indexOf(o.status) >= 0 && day(o.created) >= wk; })),
      unpaid: sum(db.orders.filter(function (o) { return o.status === 'new'; })),
      ship: db.orders.filter(function (o) { return o.status === 'paid'; }).length
    };
    var days = [];
    for (var i = 6; i >= 0; i--) {
      var d = today(i);
      days.push({
        label: new Date(d + 'T12:00:00').toLocaleString('en', { weekday: 'short' }),
        value: sum(db.orders.filter(function (o) { return paidish.indexOf(o.status) >= 0 && day(o.created) === d; }))
      });
    }
    var peak = Math.max.apply(null, days.map(function (x) { return x.value; })) || 1;
    var top = {};
    live.filter(function (o) { return day(o.created) >= wk; }).forEach(function (o) {
      o.items.forEach(function (i) {
        top[i.product] = top[i.product] || { qty: 0, rev: 0 };
        top[i.product].qty += i.qty; top[i.product].rev += i.qty * i.price;
      });
    });
    var topList = Object.keys(top).map(function (k) { return { name: k, qty: top[k].qty, rev: top[k].rev }; })
      .sort(function (a, b) { return b.rev - a.rev; }).slice(0, 5);
    var byNew = db.orders.slice().sort(function (a, b) { return a.created < b.created ? 1 : -1; });

    var h = '<section class="kpis">' +
      '<div class="kpi"><span>Orders today</span><b>' + stats.today + '</b></div>' +
      '<div class="kpi"><span>Paid revenue, last 7 days</span><b>' + rp(stats.week) + '</b></div>' +
      '<div class="kpi warn"><span>Waiting for payment</span><b>' + rp(stats.unpaid) + '</b></div>' +
      '<div class="kpi"><span>Paid, to ship</span><b>' + stats.ship + '</b></div></section>';
    h += '<section class="grid2"><div class="card"><h2>Paid revenue per day</h2><div class="bars">' +
      days.map(function (c) {
        return '<div class="bar" title="' + c.label + ': ' + rp(c.value) + '"><div class="fill" style="height:' +
          Math.max(Math.round(c.value / peak * 100), 2) + '%"></div><span>' + c.label + '</span></div>';
      }).join('') + '</div></div>';
    h += '<div class="card"><h2>Best sellers this week</h2><table class="plain">' +
      (topList.map(function (t) {
        return '<tr><td>' + esc(t.name) + '</td><td class="num">' + t.qty + ' sold</td><td class="num">' + rp(t.rev) + '</td></tr>';
      }).join('') || '<tr><td class="muted">No orders yet.</td></tr>') + '</table></div></section>';
    h += '<section class="board">' + ['new', 'paid', 'shipped'].map(function (s) {
      var all = byNew.filter(function (o) { return o.status === s; }), rows = all.slice(0, 6);
      return '<div class="col"><h2>' + pill(s) + ' <small>' + all.length + '</small></h2>' +
        (rows.map(ticket).join('') || '<p class="muted empty">Nothing here.</p>') +
        (all.length > rows.length ? '<a class="more" href="#/orders?status=' + s + '">See all ' + all.length + '</a>' : '') +
        '</div>';
    }).join('') + '</section>';
    return h;
  }

  function ticket(o) {
    return '<a class="ticket" href="#/order/' + o.id + '"><div><b>#' + o.id + ' ' + esc(o.customer) + '</b>' +
      '<span class="muted">' + when(o.created) + '</span></div><div><span class="muted">' + nItems(o) +
      ' items</span><b>' + rp(total(o)) + '</b></div></a>';
  }

  function orders(params) {
    var status = params.get('status') || '', q = (params.get('q') || '').trim().toLowerCase();
    var rows = db.orders.filter(function (o) {
      if (status && o.status !== status) return false;
      if (!q) return true;
      return o.customer.toLowerCase().indexOf(q) >= 0 || o.phone.indexOf(q) >= 0 || String(o.id) === q;
    }).sort(function (a, b) { return a.created < b.created ? 1 : -1; });
    return '<form class="filters" id="filters"><input name="q" value="' + esc(params.get('q') || '') +
      '" placeholder="Search name, phone or order #"><select name="status">' +
      '<option value="">All statuses</option>' + STATUSES.concat(['cancelled']).map(function (s) {
        return '<option value="' + s + '"' + (s === status ? ' selected' : '') + '>' + cap(s) + '</option>';
      }).join('') + '</select><button class="btn">Search</button></form>' +
      '<div class="card flush"><table class="list"><thead><tr><th>#</th><th>Customer</th><th>When</th>' +
      '<th class="num">Items</th><th class="num">Total</th><th>Status</th></tr></thead><tbody>' +
      (rows.map(function (o) {
        return '<tr data-href="#/order/' + o.id + '"><td>' + o.id + '</td><td><b>' + esc(o.customer) +
          '</b><br><span class="muted">+' + esc(o.phone) + '</span></td><td>' + when(o.created) + '</td><td class="num">' +
          nItems(o) + '</td><td class="num">' + rp(total(o)) + '</td><td>' + pill(o.status) + '</td></tr>';
      }).join('') || '<tr><td colspan="6" class="muted empty">No orders match.</td></tr>') + '</tbody></table></div>';
  }

  function newOrder() {
    var opts = PRODUCTS.map(function (p) {
      return '<option value="' + p.id + '" data-price="' + p.price + '">' + esc(p.name) + ' (' + rp(p.price) + ')</option>';
    }).join('');
    return '<h1>New order</h1><form class="card form" id="order-form" novalidate>' +
      '<div class="row"><label>Customer name<input name="customer" required></label>' +
      '<label>WhatsApp number<input name="phone" placeholder="0812 3456 7890" required></label></div>' +
      '<label>Address<input name="address"></label><h2>Products</h2><div id="lines">' +
      '<div class="line"><select name="product"><option value="">Choose a product</option>' + opts + '</select>' +
      '<input name="qty" type="number" min="1" value="1"><button type="button" class="btn ghost remove" aria-label="Remove line">x</button></div>' +
      '</div><button type="button" class="btn ghost" id="add-line">+ Add product</button>' +
      '<label>Note<input name="note" placeholder="Less sugar, deliver after 4 pm, ..."></label>' +
      '<div class="submit"><span>Total <b id="total">Rp 0</b></span><button class="btn primary">Save order</button></div></form>';
  }

  function orderPage(id) {
    var o = find(id);
    if (!o) return '<h1>Order not found</h1><p><a href="#/orders">Back to orders</a></p>';
    var idx = STATUSES.indexOf(o.status), next = idx >= 0 && idx < 3 ? STATUSES[idx + 1] : null;
    var waText = { new: 'Send confirmation + payment info', paid: 'Tell customer payment received',
      shipped: "Tell customer it's on the way", done: 'Ask for a review' }[o.status] || 'Message customer';
    return '<div class="head"><h1>Order #' + o.id + ' ' + pill(o.status) + '</h1><span class="muted">Created ' +
      when(o.created) + ', updated ' + when(o.updated) + '</span></div>' +
      (o.status !== 'cancelled' ? '<ol class="steps">' + STATUSES.map(function (s, i) {
        return '<li class="' + (i <= idx ? 'done' : '') + '">' + cap(s) + '</li>';
      }).join('') + '</ol>' : '') +
      '<section class="grid2"><div class="card"><h2>Items</h2><table class="plain">' +
      o.items.map(function (i) {
        return '<tr><td>' + i.qty + ' x ' + esc(i.product) + '</td><td class="num">' + rp(i.qty * i.price) + '</td></tr>';
      }).join('') + '<tr class="total"><td>Total</td><td class="num">' + rp(total(o)) + '</td></tr></table></div>' +
      '<div class="card"><h2>Customer</h2><p><b>' + esc(o.customer) + '</b><br>+' + esc(o.phone) + '</p>' +
      (o.address ? '<p class="muted">' + esc(o.address) + '</p>' : '') +
      (o.note ? '<p class="note">' + esc(o.note) + '</p>' : '') +
      '<div class="actions"><a class="btn wa" href="' + esc(waLink(o)) + '" target="_blank" rel="noopener">' + waText +
      ' on WhatsApp</a>' +
      (next ? '<button class="btn primary" data-status="' + next + '">Mark as ' + next + '</button>' : '') +
      (o.status === 'new' || o.status === 'paid' ? '<button class="btn ghost" data-status="cancelled">Cancel order</button>' : '') +
      '</div></div></section>';
  }

  // ---------------------------------------------------------------- router
  function route() {
    var hash = location.hash.slice(1) || '/';
    var parts = hash.split('?'), path = parts[0], params = new URLSearchParams(parts[1] || '');
    var m, view = 'dashboard';
    if (path === '/orders') { view = 'orders'; app.innerHTML = orders(params); document.title = 'Orders · Order Desk demo'; }
    else if (path === '/new') { view = 'new'; app.innerHTML = newOrder(); document.title = 'New order · Order Desk demo'; }
    else if ((m = path.match(/^\/order\/(\d+)$/))) {
      view = 'order'; app.innerHTML = orderPage(+m[1]); document.title = 'Order #' + m[1] + ' · Order Desk demo';
    } else { app.innerHTML = dashboard(); document.title = 'Order Desk demo'; }
    document.querySelectorAll('[data-nav]').forEach(function (a) { a.classList.toggle('on', a.dataset.nav === view); });
    // replay the fade-in
    app.style.animation = 'none'; void app.offsetWidth; app.style.animation = '';
    window.scrollTo(0, 0);
  }

  // ---------------------------------------------------------------- events
  app.addEventListener('click', function (e) {
    var row = e.target.closest('tr[data-href]');
    if (row) { location.hash = row.dataset.href; return; }
    var st = e.target.closest('[data-status]');
    if (st) {
      var id = +location.hash.match(/\d+$/)[0], o = find(id), s = st.dataset.status;
      if (s === 'cancelled' && !confirm('Cancel order #' + id + '?')) return;
      o.status = s; o.updated = iso(new Date()); save(); route();
      toast('Order #' + id + ' is now ' + cap(s) + '.');
      return;
    }
    if (e.target.id === 'add-line') {
      var lines = document.getElementById('lines'), c = lines.firstElementChild.cloneNode(true);
      c.querySelector('select').value = ''; c.querySelector('input').value = 1; lines.appendChild(c);
      return;
    }
    if (e.target.classList.contains('remove')) {
      var ls = document.getElementById('lines');
      if (ls.children.length > 1) { e.target.closest('.line').remove(); recalc(); }
    }
  });
  function recalc() {
    var t = 0;
    document.querySelectorAll('#lines .line').forEach(function (l) {
      var opt = l.querySelector('select').selectedOptions[0];
      t += (+opt.dataset.price || 0) * (+l.querySelector('input').value || 0);
    });
    document.getElementById('total').textContent = rp(t);
  }
  app.addEventListener('input', function (e) { if (e.target.closest('#lines')) recalc(); });
  app.addEventListener('change', function (e) {
    if (e.target.closest('#lines')) recalc();
    if (e.target.name === 'status' && e.target.closest('#filters')) e.target.form.requestSubmit();
  });
  app.addEventListener('submit', function (e) {
    e.preventDefault();
    var f = e.target;
    if (f.id === 'filters') {
      var p = new URLSearchParams();
      if (f.q.value.trim()) p.set('q', f.q.value.trim());
      if (f.status.value) p.set('status', f.status.value);
      location.hash = '/orders' + (p.toString() ? '?' + p : '');
      return;
    }
    if (f.id === 'order-form') {
      var phone = normalizePhone(f.phone.value), items = [], errors = [];
      f.querySelectorAll('.line').forEach(function (l) {
        var pid = +l.querySelector('select').value, qty = parseInt(l.querySelector('input').value, 10);
        var p = PRODUCTS.filter(function (x) { return x.id === pid; })[0];
        if (p && qty > 0) items.push({ product: p.name, qty: Math.min(qty, 999), price: p.price });
      });
      if (!f.customer.value.trim()) errors.push('Customer name is required.');
      if (!phone) errors.push('WhatsApp number looks wrong (use 08xx or +62...).');
      if (!items.length) errors.push('Add at least one product.');
      if (errors.length) { toast(errors[0]); return; }
      var now = iso(new Date()), o = {
        id: db.nextId++, customer: f.customer.value.trim().slice(0, 80), phone: phone,
        address: f.address.value.trim().slice(0, 200), note: f.note.value.trim().slice(0, 200),
        status: 'new', created: now, updated: now, items: items
      };
      db.orders.push(o); save();
      location.hash = '/order/' + o.id;
      toast('Order #' + o.id + ' saved. Send the confirmation on WhatsApp.');
    }
  });

  document.getElementById('reset').addEventListener('click', function () {
    if (!confirm('Reset the demo to the original example orders?')) return;
    try { localStorage.removeItem(KEY); } catch (e) {}
    db = seed(); save(); location.hash = '/'; route(); toast('Demo data reset.');
  });

  document.getElementById('export').addEventListener('click', function (e) {
    e.preventDefault();
    if (!window.XLSX) { toast('Excel export is still loading, try again in a second.'); return; }
    var sorted = db.orders.slice().sort(function (a, b) { return a.created < b.created ? 1 : -1; });
    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sorted.map(function (o) {
      return { Order: o.id, Date: o.created.replace('T', ' '), Customer: o.customer, WhatsApp: o.phone,
        Status: cap(o.status), Items: nItems(o), 'Total (Rp)': total(o), Address: o.address, Note: o.note };
    })), 'Orders');
    var items = [];
    sorted.forEach(function (o) {
      o.items.forEach(function (i) {
        items.push({ Order: o.id, Product: i.product, Qty: i.qty, 'Price (Rp)': i.price, 'Subtotal (Rp)': i.qty * i.price });
      });
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(items), 'Items');
    XLSX.writeFile(wb, 'orders-' + today() + '.xlsx');
  });

  db = load();
  save();
  window.addEventListener('hashchange', route);
  route();
})();
