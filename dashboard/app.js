// Token Radar dashboard. No framework, no network: the data comes from
// ../data.js (BOARD_DATA), written by main.ts from the frozen snapshot, and
// the page renders it from there. Routes live in the URL hash so every view
// opens directly: #board, #protocol/<slug>, #board?watchlist=1&chain=Base.

var DATA = typeof BOARD_DATA !== 'undefined' ? BOARD_DATA : null;
var ROWS = DATA ? DATA.rows : [];
var view = document.getElementById('view');
var lastBoardHash = '#board';

var state = { q: '', cat: '', chain: '', wl: false, tok: 'all', sort: 'rank', dir: 1 };
var DEFAULTS = { q: '', cat: '', chain: '', wl: false, tok: 'all', sort: 'rank', dir: 1 };

// ---------------------------------------------------------------- formatting

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function trimNum(x, digits) {
  var s = x.toFixed(digits);
  return s.indexOf('.') >= 0 ? s.replace(/\.?0+$/, '') : s;
}
function money(n) {
  if (n >= 1e9) return '$' + trimNum(n / 1e9, 2) + 'B';
  if (n >= 1e6) return '$' + trimNum(n / 1e6, 1) + 'M';
  if (n >= 1e3) return '$' + trimNum(n / 1e3, 1) + 'K';
  return '$' + n;
}
function moneyFull(n) { return '$' + n.toLocaleString('en-US'); }
function pct(x) {
  if (x === null || x === undefined) return 'n/a';
  return (x >= 0 ? '+' : '') + x.toFixed(2) + '%';
}
function pctClass(x) { return x === null || x === undefined ? 'muted' : x >= 0 ? 'up' : 'down'; }

// ---------------------------------------------------------------- state and hash

function parseHash() {
  var h = window.location.hash.slice(1) || 'board';
  var parts = h.split('?');
  var path = parts[0] || 'board';
  var params = new URLSearchParams(parts[1] || '');
  state.q = params.get('q') || '';
  state.cat = params.get('cat') || '';
  state.chain = params.get('chain') || '';
  state.wl = params.get('watchlist') === '1';
  state.tok = params.get('tok') || 'all';
  state.sort = params.get('sort') || 'rank';
  state.dir = params.get('dir') === '-1' ? -1 : 1;
  if (path.indexOf('protocol/') === 0) return { view: 'protocol', slug: decodeURIComponent(path.slice(9)) };
  return { view: 'board', slug: null };
}

function boardHash() {
  var p = new URLSearchParams();
  if (state.q) p.set('q', state.q);
  if (state.cat) p.set('cat', state.cat);
  if (state.chain) p.set('chain', state.chain);
  if (state.wl) p.set('watchlist', '1');
  if (state.tok !== 'all') p.set('tok', state.tok);
  if (state.sort !== 'rank') p.set('sort', state.sort);
  if (state.dir === -1) p.set('dir', '-1');
  var q = p.toString();
  return '#board' + (q ? '?' + q : '');
}

function syncHash() {
  var h = boardHash();
  lastBoardHash = h;
  history.replaceState(null, '', h);
}

// ---------------------------------------------------------------- filtering and sorting

function filteredRows() {
  var q = state.q.trim().toLowerCase();
  return ROWS.filter(function (r) {
    if (q && r.name.toLowerCase().indexOf(q) < 0 && r.slug.toLowerCase().indexOf(q) < 0) return false;
    if (state.cat && r.category !== state.cat) return false;
    if (state.chain && r.chains.indexOf(state.chain) < 0) return false;
    if (state.wl && !r.watchlist) return false;
    if (state.tok === 'pre' && r.token_status !== 'No token recorded') return false;
    if (state.tok === 'trades' && r.token_status !== 'Token trades') return false;
    return true;
  });
}

function sortedRows(rows) {
  var key = state.sort;
  var dir = state.dir;
  var val = function (r) {
    if (key === 'tvl') return r.tvl_usd;
    if (key === 'value') return r.implied_value_usd;
    if (key === 'change') return r.change_7d === null ? -Infinity : r.change_7d;
    if (key === 'name') return r.name.toLowerCase();
    return r.rank;
  };
  return rows.slice().sort(function (a, b) {
    var va = val(a), vb = val(b);
    var c = typeof va === 'string' ? (va < vb ? -1 : va > vb ? 1 : 0) : va - vb;
    if (c === 0) c = a.rank - b.rank;
    return c * dir;
  });
}

function anyFilter() {
  return state.q !== '' || state.cat !== '' || state.chain !== '' || state.wl || state.tok !== 'all';
}

// ---------------------------------------------------------------- coverage

function renderCoverage() {
  var wl = ROWS.filter(function (r) { return r.watchlist; }).length;
  var pre = ROWS.filter(function (r) { return !r.watchlist && r.token_status === 'No token recorded'; }).length;
  var tok = ROWS.filter(function (r) { return r.token_status === 'Token trades'; }).length;
  var total = DATA ? DATA.watchlist_count : wl;
  document.getElementById('coverage').innerHTML =
    '<div class="stat hot"><b>' + wl + ' of ' + total + '</b><span>watchlist protocols</span></div>' +
    '<div class="stat"><b>' + pre + '</b><span>candidates</span></div>' +
    '<div class="stat"><b>' + tok + '</b><span>comparables</span></div>' +
    '<div class="stat"><b>' + ROWS.length + '</b><span>rows &middot; ' + esc(DATA ? DATA.as_of : '') + '</span></div>';
}

// ---------------------------------------------------------------- board view

function optionLists() {
  var cats = {}, chains = {};
  ROWS.forEach(function (r) {
    if (r.category) cats[r.category] = 1;
    r.chains.forEach(function (c) { chains[c] = 1; });
  });
  return { cats: Object.keys(cats).sort(), chains: Object.keys(chains).sort() };
}

function sortButton(label, key) {
  var active = state.sort === key;
  var arrow = active ? (state.dir === 1 ? ' ▲' : ' ▼') : '';
  return '<button type="button" data-sort="' + key + '"' + (active ? ' class="sorted"' : '') + '>' + label + arrow + '</button>';
}

function tokenBadge(r) {
  var badge = r.token_status === 'Token trades'
    ? '<span class="badge trades">Token trades</span>'
    : '<span class="badge pre">No token recorded</span>';
  return badge + (r.watchlist ? ' <span class="badge watch">Watchlist</span>' : '');
}

function chainChips(chains) {
  if (chains.length === 0) return '<span class="muted">—</span>';
  var shown = chains.slice(0, 2).map(function (c) { return '<span class="chip">' + esc(c) + '</span>'; }).join('');
  return shown + (chains.length > 2 ? '<span class="chip">+' + (chains.length - 2) + '</span>' : '');
}

function renderTable() {
  var rows = sortedRows(filteredRows());
  var count = document.getElementById('count');
  count.innerHTML = 'Showing <b>' + rows.length + '</b> of ' + ROWS.length + ' protocols' +
    (anyFilter() ? ' matching the filters' : '') + '. Rank 1 is the highest implied value.';
  var pick = document.getElementById('toppick');
  if (anyFilter() && rows.length > 0) {
    var top = rows[0];
    var trial = top.farm_steps[1] || top.farm_steps[0];
    var exit = top.farm_steps[top.farm_steps.length - 1];
    pick.innerHTML = '<h2>Top of this view: <a href="#protocol/' + encodeURIComponent(top.slug) + '">' + esc(top.name) + '</a>' +
      ' &middot; implied ' + money(top.implied_value_usd) + ' &middot; ' + esc(top.token_status) + '</h2>' +
      '<p><span class="lbl">Trial plan</span><br>' + esc(trial) + '</p>' +
      '<p><span class="lbl">Exit</span><br>' + esc(exit) + '</p>';
    pick.style.display = '';
  } else {
    pick.innerHTML = '';
    pick.style.display = 'none';
  }
  var wrap = document.getElementById('tablewrap');
  if (rows.length === 0) {
    wrap.innerHTML = '<div class="card empty">No protocol matches these filters. Clear the search or widen the filters.</div>';
    return;
  }
  var html = '<div class="card"><table class="board"><thead><tr>' +
    '<th>' + sortButton('Rank', 'rank') + '</th>' +
    '<th>' + sortButton('Protocol', 'name') + '</th>' +
    '<th>Category</th><th>Chains</th>' +
    '<th class="num">' + sortButton('TVL', 'tvl') + '</th>' +
    '<th class="num">' + sortButton('7d', 'change') + '</th>' +
    '<th class="num">' + sortButton('Implied value', 'value') + '</th>' +
    '<th>Token</th></tr></thead><tbody>';
  rows.forEach(function (r) {
    html += '<tr><td>' + r.rank + '</td>' +
      '<td class="namecell"><a href="#protocol/' + encodeURIComponent(r.slug) + '">' + esc(r.name) + '</a>' +
      '<span class="slug">' + esc(r.slug) + '</span></td>' +
      '<td>' + (r.category ? esc(r.category) : '<span class="muted">—</span>') + '</td>' +
      '<td>' + chainChips(r.chains) + '</td>' +
      '<td class="num">' + money(r.tvl_usd) + '</td>' +
      '<td class="num ' + pctClass(r.change_7d) + '">' + pct(r.change_7d) + '</td>' +
      '<td class="num"><b>' + money(r.implied_value_usd) + '</b></td>' +
      '<td>' + tokenBadge(r) + '</td></tr>';
  });
  wrap.innerHTML = html + '</tbody></table></div>';
}

function renderBoard() {
  lastBoardHash = window.location.hash || '#board';
  var lists = optionLists();
  var catOpts = '<option value="">All categories</option>' + lists.cats.map(function (c) {
    return '<option value="' + esc(c) + '"' + (state.cat === c ? ' selected' : '') + '>' + esc(c) + '</option>';
  }).join('');
  var chainOpts = '<option value="">All chains</option>' + lists.chains.map(function (c) {
    return '<option value="' + esc(c) + '"' + (state.chain === c ? ' selected' : '') + '>' + esc(c) + '</option>';
  }).join('');
  view.innerHTML =
    '<div class="controls">' +
    '<label>Search<input type="search" id="q" placeholder="Name or slug" value="' + esc(state.q) + '" autocomplete="off"></label>' +
    '<label>Category<select id="cat">' + catOpts + '</select></label>' +
    '<label>Chain<select id="chain">' + chainOpts + '</select></label>' +
    '<label>Token<select id="tok">' +
    '<option value="all"' + (state.tok === 'all' ? ' selected' : '') + '>All protocols</option>' +
    '<option value="pre"' + (state.tok === 'pre' ? ' selected' : '') + '>No token recorded</option>' +
    '<option value="trades"' + (state.tok === 'trades' ? ' selected' : '') + '>Token trades</option>' +
    '</select></label>' +
    '<label class="check"><input type="checkbox" id="wl"' + (state.wl ? ' checked' : '') + '> Watchlist only</label>' +
    '</div>' +
    '<p class="count" id="count"></p>' +
    '<div class="toppick" id="toppick" style="display:none"></div>' +
    '<div id="tablewrap"></div>';
  document.getElementById('q').addEventListener('input', function (e) { state.q = e.target.value; syncHash(); renderTable(); });
  document.getElementById('cat').addEventListener('change', function (e) { state.cat = e.target.value; syncHash(); renderTable(); });
  document.getElementById('chain').addEventListener('change', function (e) { state.chain = e.target.value; syncHash(); renderTable(); });
  document.getElementById('tok').addEventListener('change', function (e) { state.tok = e.target.value; syncHash(); renderTable(); });
  document.getElementById('wl').addEventListener('change', function (e) { state.wl = e.target.checked; syncHash(); renderTable(); });
  renderTable();
}

// ---------------------------------------------------------------- detail view

function renderDetail(slug) {
  var r = null;
  for (var i = 0; i < ROWS.length; i++) if (ROWS[i].slug === slug) { r = ROWS[i]; break; }
  if (!r) {
    view.innerHTML = '<p class="back"><a href="' + esc(lastBoardHash) + '">&larr; Back to the board</a></p>' +
      '<div class="card empty">No protocol with the slug ' + esc(slug) + ' is on this board.</div>';
    return;
  }
  var multipleSrc = r.peers > 0
    ? 'median mcap / TVL of ' + r.peers + ' priced peer' + (r.peers === 1 ? '' : 's') + ' in ' + (r.category || 'this category') + ', shrunk toward the global median'
    : 'global median mcap / TVL: no priced peers in this category';
  var growthSrc = r.change_7d === null ? 'not reported, factor kept neutral' : pct(r.change_7d) + ' over 7 days' + (Math.abs(r.change_7d) > 40 ? ', clamped to ' + (r.change_7d > 0 ? '+' : '-') + '40%' : '');
  var ageSrc = r.age_days === null
    ? 'listing date not reported, factor kept neutral'
    : 'listed ' + esc(r.listed_at || '') + ', ' + r.age_days + ' days to the snapshot date';
  var chainSrc = r.chains.length === 0 ? 'no chains recorded, factor kept neutral' : r.chains.length + ' chain' + (r.chains.length === 1 ? '' : 's') + ': ' + esc(r.chains.join(', ')) + (r.chains.length > 5 ? ' (capped at 4 extra chains)' : '');
  var gaps = r.data_gaps.length > 0
    ? '<div class="gaps"><b>Data gaps:</b> ' + r.data_gaps.map(esc).join('; ') + '. Each missing input keeps its factor neutral at 1.00x.</div>'
    : '';
  var tokenNote = r.token_status === 'Token trades'
    ? '<p class="note">Token ' + (r.symbol ? esc(r.symbol) : 'recorded') + ' already trades' +
      (r.mcap_usd !== null ? '; market cap ' + moneyFull(r.mcap_usd) + '.' : '; no market cap recorded.') +
      ' This row is a comparable: it calibrates the model, and its farm plan farms yield, not a launch.</p>'
    : '<p class="note">DefiLlama records no token for this protocol. The implied value is what a token would be worth if the protocol\'s record held, not a prediction that one is issued.</p>';
  var steps = r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('');
  view.innerHTML =
    '<p class="back"><a href="' + esc(lastBoardHash) + '">&larr; Back to the board</a></p>' +
    '<div class="detail-head"><h2>#' + r.rank + ' &nbsp;' + esc(r.name) + '</h2>' +
    '<p class="meta">' + (r.category ? esc(r.category) + ' &middot; ' : '') + esc(r.chains.join(', ') || 'no chains recorded') +
    ' &middot; ' + tokenBadge(r) + '</p></div>' +
    '<div class="detail-grid">' +
    '<section class="panel"><h3>Valuation &middot; implied ' + moneyFull(r.implied_value_usd) + '</h3>' +
    '<table class="factors">' +
    '<tr><td>TVL<span class="src">the protocol\'s own size</span></td><td>' + moneyFull(r.tvl_usd) + '</td></tr>' +
    '<tr><td>Category multiple<span class="src">' + esc(multipleSrc) + '</span></td><td>&times; ' + r.multiple.toFixed(4) + '</td></tr>' +
    '<tr><td>Growth factor<span class="src">' + esc(growthSrc) + '</span></td><td>&times; ' + r.growth_factor.toFixed(4) + '</td></tr>' +
    '<tr><td>Age factor<span class="src">' + esc(ageSrc) + '</span></td><td>&times; ' + r.age_factor.toFixed(4) + '</td></tr>' +
    '<tr><td>Chain factor<span class="src">' + esc(chainSrc) + '</span></td><td>&times; ' + r.chain_factor.toFixed(4) + '</td></tr>' +
    '<tr class="total"><td>Implied value</td><td>' + moneyFull(r.implied_value_usd) + '</td></tr>' +
    '</table>' +
    '<p class="formula">' + moneyFull(r.tvl_usd) + ' &times; ' + r.multiple.toFixed(4) + ' &times; ' + r.growth_factor.toFixed(4) +
    ' &times; ' + r.age_factor.toFixed(4) + ' &times; ' + r.chain_factor.toFixed(4) + ' = ' + moneyFull(r.implied_value_usd) +
    ' (factors shown to 4 decimals; the board uses full precision)</p>' +
    gaps + tokenNote + '</section>' +
    '<section class="panel"><h3>Farm plan &middot; ' + r.farm_steps.length + ' steps</h3>' +
    '<ol class="plan">' + steps + '</ol>' +
    '<p class="note">Costs are planning ranges. Verify the live market before any funding, trial small, and exit on the schedule above.</p></section>' +
    '</div>';
}

// ---------------------------------------------------------------- boot

function render() {
  var route = parseHash();
  if (route.view === 'protocol') renderDetail(route.slug);
  else renderBoard();
}

view.addEventListener('click', function (e) {
  var btn = e.target.closest ? e.target.closest('button[data-sort]') : null;
  if (!btn) return;
  var key = btn.getAttribute('data-sort');
  if (state.sort === key) state.dir = -state.dir;
  else { state.sort = key; state.dir = key === 'name' ? 1 : -1; }
  if (key === 'rank') state.dir = 1;
  syncHash();
  renderTable();
});

window.addEventListener('hashchange', render);

if (!DATA) {
  view.innerHTML = '<div class="card empty">No board data loaded: data.js is missing or failed to load.</div>';
} else {
  renderCoverage();
  render();
}
