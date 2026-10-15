/* Turnuva tablosu arayüzü. Tablo mantığı logic.js içinde (window.TL). */
(function () {
  'use strict';

  const L = window.TL;
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));

  /* Sayfanın iskeleti <template> içinde durur; çevrimiçi sürüm kendini kaydederken
   * sayfayı bu değişmemiş kaynaktan yeniden yazar. */
  const PAGE_TITLE = (document.querySelector('title') || {}).textContent || 'Turnuva Tablosu';
  const shellTpl = document.getElementById('shell-tpl');
  if (shellTpl) shellTpl.after(shellTpl.content.cloneNode(true));

  /* Çevrimiçi (paylaşılan link) sürümde turnuva verisi sayfanın içine gömülüdür ve
   * Kaydet sayfanın yeni bir sürümünü yayınlar. Yerel sürümde veri Python'dan gelir. */
  const ONLINE = !!document.getElementById('tdata');
  const NARROW = window.matchMedia && window.matchMedia('(max-width: 760px)').matches;

  /* Tablo ölçüleri (px) */
  const G = { PAD_X: 40, PAD_Y: 14, MW: 210, MH: 58, ROW: 29, UNIT: 73, GAP: 34, HEAD: 40, CHAMP_W: 230 };
  const colX = (r) => G.PAD_X + r * (G.MW + G.GAP);
  const centerY = (r, m) => G.PAD_Y + (m + 0.5) * G.UNIT * Math.pow(2, r);

  const app = {
    state: null,
    br: null,
    pmap: new Map(),
    slotIndex: new Map(),
    savedCanon: null,
    everSaved: false,
    warning: null,
    undo: [],
    redo: [],
    panel: 'people',
    tab: 'E',
    query: '',
    zoom: 1,
    selected: null,
    hoverPid: null,
    saving: false,
    els: new Map(),
    drag: null,
    pointerDown: false,
    panelPending: false,
    bannerPending: false,
    bannerHtml: null,
    rev: 0,
    autoPick: null,
    canEdit: !ONLINE,
    stash: null,
  };

  const els = {
    board: $('#board'), canvas: $('#canvas'), panel: $('#panel'), banner: $('#banner'),
    title: $('#title'), saveBtn: $('#saveBtn'), saveStatus: $('#saveStatus'),
    undoBtn: $('#undoBtn'), redoBtn: $('#redoBtn'), toast: $('#toast'), modal: $('#modal'),
    zoomVal: $('#zoomVal'), dlMenu: $('#dlMenu'), roChip: $('#roChip'), jsonFile: $('#jsonFile'),
  };

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const canon = (s) => JSON.stringify({ title: s.title, participants: s.participants, slots: s.slots,
    results: s.results, deleted: s.deleted || [], women: s.women || null });

  /* İki tablo var: erkekler (durumun üst düzeyi) ve kadınlar (state.women). Soldaki
   * Erkekler/Kadınlar sekmesi (app.tab) hangi tablonun gösterilip düzenlendiğini belirler. */
  const WOMEN_SIZE = 16;
  const WOMEN_TITLE = 'Masa Tenisi Turnuvası — Kadınlar';
  const GENDER_LABEL = { E: 'Erkekler', K: 'Kadınlar' };
  const own = (s, g) => ((g || app.tab) === 'K' ? s.women : s);
  const cur = () => L.viewOf(app.state, app.tab);
  const curTitle = () => own(app.state).title || 'Turnuva';
  const isDirty = () => app.savedCanon === null || canon(app.state) !== app.savedCanon;
  const nameOf = (pid) => (app.pmap.get(pid) || {}).name || '?';
  const winnerCount = () => Object.values(cur().results).filter((r) => r.winner).length;

  function store(key, value) {
    try {
      if (value === undefined) return localStorage.getItem('turnuva.' + key);
      localStorage.setItem('turnuva.' + key, value);
    } catch (e) { /* tarayıcı depolaması kapalı olabilir */ }
    return null;
  }

  /* ------------------------------------------------------------------ */
  /* Durum değişiklikleri                                                */
  /* ------------------------------------------------------------------ */

  function recompute() {
    const v = cur();
    app.br = L.computeBracket(v);
    app.pmap = L.participantMap(app.state);
    app.slotIndex = new Map();
    v.slots.forEach((pid, i) => { if (pid) app.slotIndex.set(pid, i); });
  }

  /* fn durumu değiştirir; değişiklik olduysa geri alma geçmişine eklenir. */
  function mutate(fn, opts) {
    opts = opts || {};
    if (!app.canEdit) { toast('Bu tabloyu sadece görüntüleyebilirsin.'); return undefined; }
    const before = JSON.stringify(app.state);
    const out = fn(app.state);
    const after = JSON.stringify(app.state);
    if (before !== after) {
      // Geçmiş girdisi, değişikliğin hangi tabloda (sekmede) yapıldığını da tutar
      app.undo.push({ s: before, tab: app.tab });
      if (app.undo.length > 300) app.undo.shift();
      app.redo = [];
      refresh(opts);
    }
    return out;
  }

  function refresh(opts) {
    opts = opts || {};
    recompute();
    patchBoard();
    if (opts.panel !== false) renderPanel();
    renderBanner();
    updateStatus();
  }

  /* Geri al / yinele. Sıradaki değişiklik diğer tabloda yapılmışsa önce o tabloya geçer ve
   * bir şey değiştirmez; böylece örneğin Kadınlar sekmesindeyken erkekler tablosu habersizce
   * geri alınmaz. Geri almak için bir kez daha basmak gerekir. */
  function stepHistory(from, to, done) {
    if (!from.length) return;
    const e = from[from.length - 1];
    if (e.tab !== app.tab) {
      setTab(e.tab);
      toast(`Sıradaki değişiklik ${GENDER_LABEL[e.tab]} tablosunda; o tabloya geçildi. ` +
        `${done === 'Geri alındı' ? 'Geri almak' : 'Yinelemek'} için tekrar bas.`);
      return;
    }
    from.pop();
    to.push({ s: JSON.stringify(app.state), tab: e.tab });
    app.state = JSON.parse(e.s);
    els.title.value = curTitle();
    refresh();
    toast(`${done} (${GENDER_LABEL[e.tab]} tablosu)`);
  }

  function undo() { stepHistory(app.undo, app.redo, 'Geri alındı'); }
  function redo() { stepHistory(app.redo, app.undo, 'Yinelendi'); }

  /* Bir değişiklik sonraki turlardaki sonuçları sildiyse mesaja eklenecek uyarı. */
  function lostNote(lost) {
    return lost > 0 ? ` Bu yüzden ${lost} maç sonucu silindi (Geri al ile dönebilirsin).` : '';
  }

  function notify(msg, lost) {
    if (!msg && lost > 0) msg = `Bu değişiklik yüzünden ${lost} maç sonucu silindi (Geri al ile dönebilirsin).`;
    else if (msg) msg += lostNote(lost);
    if (msg) toast(msg, lost > 0 ? 'warn' : undefined);
  }

  function chooseWinner(mid, pid) {
    const res = cur().results;
    const prev = res[mid] && res[mid].winner;
    const expected = prev === pid ? -1 : prev ? 0 : 1;
    const w0 = winnerCount();
    mutate((s) => L.toggleWinner(L.viewOf(s, app.tab), mid, pid));
    notify('', w0 + expected - winnerCount());
  }

  function swap(i, j) {
    if (i === j) return;
    const w0 = winnerCount();
    const a = cur().slots[i];
    const b = cur().slots[j];
    mutate((s) => L.swapSlots(L.viewOf(s, app.tab), i, j));
    const label = (p, k) => (p ? nameOf(p) : 'BAY') + ` (#${k + 1})`;
    notify(a || b ? `Yer değişti: ${label(a, j)} ↔ ${label(b, i)}.` : '', w0 - winnerCount());
    flashSlots([i, j]);
  }

  function place(pid, i) {
    const w0 = winnerCount();
    const out = cur().slots[i];
    mutate((s) => L.placeInSlot(L.viewOf(s, app.tab), pid, i));
    flashSlots([i]);
    const msg = out && L.slotOf(cur(), out) < 0
      ? `${nameOf(pid)} #${i + 1}. yere kondu, ${nameOf(out)} tablo dışına alındı.`
      : `${nameOf(pid)} #${i + 1}. yere kondu.`;
    notify(msg, w0 - winnerCount());
  }

  function unplace(pid) {
    const w0 = winnerCount();
    mutate((s) => L.removeFromBracket(L.viewOf(s, app.tab), pid));
    notify(`${nameOf(pid)} tablodan çıkarıldı, yeri BAY oldu.`, w0 - winnerCount());
  }

  function flashSlots(slots) {
    for (const i of slots) {
      const ref = app.els.get(L.matchId(0, i >> 1));
      if (!ref) continue;
      const row = ref.rows[i & 1].row;
      row.classList.remove('flash');
      void row.offsetWidth;
      row.classList.add('flash');
    }
  }

  /* ------------------------------------------------------------------ */
  /* Tablo çizimi                                                        */
  /* ------------------------------------------------------------------ */

  function layout(R) {
    const fy = centerY(R - 1, 0);
    return {
      width: colX(R) + G.CHAMP_W + 90,
      height: G.PAD_Y * 2 + (cur().slots.length / 2) * G.UNIT,
      finalY: fy,
      thirdX: colX(R - 1),
      thirdY: fy + G.MH / 2 + 120,
      champX: colX(R),
      champY: fy - 58,
    };
  }

  function matchHTML(mid, x, y, r, extra) {
    const drag = r === 0 ? ' draggable="true"' : '';
    const row = (i) => `<div class="row" data-side="${i}"${drag}><span class="seed"></span>` +
      `<span class="nm"></span><input class="sc" data-side="${i}" inputmode="numeric" maxlength="6" ` +
      `autocomplete="off" aria-label="Skor"></div>`;
    return `<div class="match r${r}${extra || ''}" data-mid="${mid}" style="left:${x}px;top:${y}px">` +
      row(0) + row(1) + '</div>';
  }

  function buildBoard() {
    const size = cur().slots.length;
    const R = L.roundCount(size);
    const lay = layout(R);
    let head = '';
    let boxes = '';
    let d = '';
    for (let r = 0; r < R; r++) {
      const n = size >> r;
      head += `<div style="left:${colX(r)}px;width:${G.MW}px">${esc(L.roundName(r, R))}` +
        `<small>${n} kişi</small></div>`;
      for (let m = 0; m < n / 2; m++) {
        boxes += matchHTML(L.matchId(r, m), colX(r), centerY(r, m) - G.MH / 2, r);
        if (r < R - 1 && m % 2 === 0) {
          const x0 = colX(r) + G.MW;
          const xm = x0 + G.GAP / 2;
          const y1 = centerY(r, m);
          const y2 = centerY(r, m + 1);
          d += `M${x0} ${y1}H${xm}V${y2}H${x0}M${xm} ${centerY(r + 1, m / 2)}H${colX(r + 1)}`;
        }
      }
    }
    head += `<div style="left:${lay.champX}px;width:${G.CHAMP_W}px">Şampiyon</div>`;
    d += `M${colX(R - 1) + G.MW} ${lay.finalY}H${lay.champX}`;
    if (R >= 2) {
      boxes += `<div class="label-3rd" style="left:${lay.thirdX}px;top:${lay.thirdY - 24}px">3.lük Maçı</div>`;
      boxes += matchHTML(L.THIRD, lay.thirdX, lay.thirdY, R - 1, ' third');
    }
    boxes += `<div class="champ" id="champ" style="left:${lay.champX}px;top:${lay.champY}px">` +
      '<svg viewBox="0 0 24 24" class="fill"><path d="M7 3h10v2h3v3a4 4 0 0 1-4 4h-.3A5 5 0 0 1 13 14.900V18h3v3H8v-3h3v-3.100A5 5 0 0 1 8.300 12H8a4 4 0 0 1-4-4V5h3zm0 4H6v1a2 2 0 0 0 1 1.700zm10 0v2.700A2 2 0 0 0 18 8V7z"/></svg>' +
      '<div class="t">Şampiyon</div><div class="n tbd" id="champName">—</div></div>';

    els.board.innerHTML =
      `<div class="rhead" style="width:${lay.width}px">${head}</div>` +
      `<div class="area" style="width:${lay.width}px;height:${Math.max(lay.height, lay.thirdY + 120)}px">` +
      `<svg class="lines" width="${lay.width}" height="${lay.height}"><path d="${d}"/></svg>${boxes}</div>`;

    app.els.clear();
    for (const el of $$('.match', els.board)) {
      app.els.set(el.dataset.mid, {
        el,
        rows: $$('.row', el).map((row) => ({ row, seed: $('.seed', row), nm: $('.nm', row), sc: $('.sc', row) })),
      });
    }
  }

  function patchBoard() {
    const st = cur();
    const br = app.br;
    const q = L.trKey(app.query);
    const all = br.rounds.flat();
    if (br.third) all.push(br.third);
    for (const mt of all) {
      const ref = app.els.get(mt.id);
      if (!ref) continue;
      ref.el.classList.toggle('playable', mt.playable && app.canEdit);
      ref.el.title = mt.isThird ? '3.lük maçı' : `${L.roundName(mt.r, br.R)} · ${mt.m + 1}. maç`;
      const scores = (st.results[mt.id] && st.results[mt.id].scores) || {};
      const firstRound = mt.r === 0 && !mt.isThird;
      mt.sides.forEach((s, i) => {
        const c = ref.rows[i];
        let cls = 'row';
        let name = '';
        let seed = '';
        let pid = '';
        if (s.type === 'player') {
          pid = s.id;
          name = nameOf(pid);
          seed = String(app.slotIndex.get(pid) + 1);
        } else if (s.type === 'bye') {
          cls += ' bye';
          name = 'BAY';
        } else {
          cls += ' pending';
        }
        if (firstRound) seed = String(mt.m * 2 + i + 1);
        if (mt.result) cls += mt.winner.id === pid ? ' win' : ' lose';
        if (pid && q && L.trKey(name).includes(q)) cls += ' hit';
        if (pid && pid === app.hoverPid) cls += ' hover-path';
        if (firstRound && app.selected === mt.m * 2 + i) cls += ' selected';
        if (c.row.className !== cls) c.row.className = cls;
        c.row.dataset.pid = pid;
        if (c.seed.textContent !== seed) c.seed.textContent = seed;
        if (c.nm.textContent !== name) c.nm.textContent = name;
        c.nm.title = name === 'BAY' ? 'BAY: rakibi doğrudan bir sonraki tura çıkar' : name;
        c.sc.dataset.pid = pid;
        c.sc.disabled = !mt.playable || !app.canEdit;
        if (document.activeElement !== c.sc) c.sc.value = pid && scores[pid] != null ? scores[pid] : '';
      });
    }
    const champ = br.podium.first;
    const cn = $('#champName');
    if (cn) {
      cn.textContent = champ ? nameOf(champ) : 'Final bekleniyor';
      cn.classList.toggle('tbd', !champ);
    }
  }

  /* ------------------------------------------------------------------ */
  /* Sol panel                                                           */
  /* ------------------------------------------------------------------ */

  function statusMap() {
    const map = new Map();
    const br = app.br;
    for (const list of br.rounds) {
      for (const mt of list) {
        for (const s of mt.sides) {
          if (s.type !== 'player') continue;
          const e = map.get(s.id) || { round: mt.r, out: null };
          e.round = mt.r;
          if (mt.loser.id === s.id && mt.result) e.out = mt.r;
          map.set(s.id, e);
        }
      }
    }
    // Yarı finali kaybedenler 3.lük maçı oynanana kadar hâlâ turnuvada
    if (br.third && !br.third.result) {
      for (const s of br.third.sides) {
        const e = s.type === 'player' && map.get(s.id);
        if (e) { e.out = null; e.third = true; }
      }
    }
    return map;
  }

  function statusText(pid, sm) {
    const p = app.br.podium;
    if (p.first === pid) return 'Şampiyon';
    if (p.second === pid) return 'İkinci';
    if (p.third === pid) return 'Üçüncü';
    if (p.fourth === pid) return 'Dördüncü';
    const e = sm.get(pid);
    if (!e) return '';
    if (e.third) return '3.lük maçını oynayacak';
    if (e.out != null) return `Elendiği tur: ${L.roundName(e.out, app.br.R)}`;
    return `Şu anki tur: ${L.roundName(e.round, app.br.R)}`;
  }

  function personRow(p, sm, opts) {
    const slot = app.slotIndex.has(p.id) ? app.slotIndex.get(p.id) : -1;
    const e = sm.get(p.id);
    const champ = app.br.podium.first === p.id;
    const out = e && e.out != null && !champ && app.br.podium.third !== p.id;
    const cls = ['prow'];
    if (out) cls.push('out');
    if (champ) cls.push('champ');
    const numTxt = slot >= 0 ? String(slot + 1) : '—';
    const numCls = slot >= 0 ? 'num' : 'num none';
    const status = statusText(p.id, sm);
    const tip = slot >= 0 ? `Tablodaki yeri: ${slot + 1}${status ? ' · ' + status : ''}` : 'Tablo dışında';
    const ed = app.canEdit;
    return `<li class="${cls.join(' ')}" data-pid="${p.id}"${ed && p.gender === app.tab ? ' draggable="true"' : ''} title="${esc(tip)}">` +
      `<span class="handle"></span>` +
      `<span class="${numCls}" data-act="goto">${numTxt}</span>` +
      `<input class="pname" data-key="name:${p.id}" value="${esc(p.name)}" spellcheck="false"${ed ? '' : ' readonly'}>` +
      `<button class="g${p.gender === 'K' ? ' k' : ''}" data-act="gender"${ed ? '' : ' disabled'} title="${p.gender === 'E' ? 'Erkek' : 'Kadın'}${ed ? ' — değiştirmek için tıkla' : ''}">${p.gender}</button>` +
      (ed && p.check ? '<button class="chk" data-act="confirm" title="Cinsiyet isimden kesin anlaşılamadı. Doğruysa tıkla, yanlışsa E/K düğmesine bas.">?</button>' : '') +
      (!ed || (opts && opts.noDelete) ? '' : '<button class="del" data-act="del" title="Listeden sil">×</button>') +
      '</li>';
  }

  function renderPeople() {
    const st = app.state;
    const q = L.trKey(app.query);
    const match = (p) => !q || L.trKey(p.name).includes(q);
    const males = st.participants.filter((p) => p.gender === 'E');
    const females = st.participants.filter((p) => p.gender === 'K');
    const sm = statusMap();
    const v = cur();
    const unplaced = L.unplaced(v);
    const byes = v.slots.length - v.slots.filter(Boolean).length;
    let list = '';
    {
      const placed = (app.tab === 'K' ? females : males).filter((p) => app.slotIndex.has(p.id))
        .sort((a, b) => app.slotIndex.get(a.id) - app.slotIndex.get(b.id));
      if (app.canEdit || unplaced.length) {
        list += `<div class="dropzone${unplaced.length ? ' warn' : ''}" id="outZone">` +
          `<div class="zt">Tablo dışında: <b>${unplaced.length}</b>` +
          (app.canEdit && unplaced.length && byes ? ' <span class="spacer"></span><button class="btn" data-act="fill">BAY yerlerine yerleştir</button>' : '') +
          '</div>' +
          (unplaced.length ? '<ul class="plist">' + unplaced.filter(match).map((p) => personRow(p, sm)).join('') + '</ul>' : '') +
          (app.canEdit ? '<div class="muted">Bir oyuncuyu tablodan çıkarmak için buraya sürükle. Tablo dışındaki birini tablodaki bir yere sürükleyerek yerleştirebilirsin.</div>' : '') +
          '</div>';
      }
      list += '<ul class="plist">' + placed.filter(match).map((p) => personRow(p, sm)).join('') + '</ul>';
    }
    const checks = st.participants.filter((p) => p.check && p.gender === app.tab).length;
    return '<h2>Katılımcılar</h2>' +
      `<div class="seg"><button data-tab="E" class="${app.tab === 'E' ? 'active' : ''}">Erkekler (${males.length})</button>` +
      `<button data-tab="K" class="${app.tab === 'K' ? 'active' : ''}">Kadınlar (${females.length})</button></div>` +
      `<input class="search" id="search" data-key="search" placeholder="İsim ara…" value="${esc(app.query)}" autocomplete="off">` +
      (app.canEdit && checks ? `<p class="muted"><b style="color:var(--orange)">?</b> işaretli ${checks} kişinin cinsiyeti isimden kesin anlaşılamadı, kontrol et.</p>` : '') +
      list +
      (app.canEdit ? '<div class="addrow"><input id="addName" data-key="add" placeholder="Yeni kişi ekle (Ad Soyad)" maxlength="120">' +
      `<button class="btn primary" data-act="add">Ekle</button></div>` : '');
  }

  function renderTools() {
    const s = L.stats(cur(), app.br);
    const stat = (v, t) => `<div class="stat"><b>${v}</b><span>${t}</span></div>`;
    const who = app.tab === 'K' ? 'kadınları' : 'erkekleri';
    return `<h2>Kura ve Araçlar · ${GENDER_LABEL[app.tab]}</h2>` +
      '<div class="statgrid">' +
      stat(s.males, 'Erkek') + stat(s.females, 'Kadın') +
      stat(`${s.placed}/${cur().slots.length}`, 'Tablodaki oyuncu') + stat(s.byes, 'BAY') +
      stat(s.unplaced, 'Tablo dışında') + stat(`${s.done}/${s.total}`, 'Oynanan maç') +
      '</div>' +
      '<h3>Kura</h3>' +
      `<button class="btn block" data-act="redraw">Yeni kura çek<small>Bütün ${who} bu tabloya baştan rastgele dağıtır ve bu tablonun tüm maç sonuçlarını siler. Diğer tablo değişmez. Kaydedene kadar dosyaya yazılmaz.</small></button>` +
      `<button class="btn block" data-act="fill"${s.unplaced && s.byes ? '' : ' disabled'}>Tablo dışındakileri BAY yerlerine yerleştir<small>${s.unplaced} kişi bekliyor, ${s.byes} BAY yeri var.</small></button>` +
      '<h3>Liste</h3>' +
      (ONLINE ? '' : '<button class="btn block" data-act="import">CSV’den yeni kişileri al<small>temiz_liste.csv dosyasına sonradan eklenen isimleri ekler; mevcut kişilere ve tabloya dokunmaz.</small></button>') +
      '<button class="btn block" data-act="importJson">Kayıt dosyasından yükle (JSON)<small>Tüm kaydı (Erkekler <b>ve</b> Kadınlar tabloları, katılımcı listesi) seçtiğin dosyadakiyle değiştirir; sadece bu sekmeyi değil.</small></button>' +
      '<h3>Sonuçlar</h3>' +
      `<button class="btn block danger" data-act="clear">Bu tablonun maç sonuçlarını temizle<small>${GENDER_LABEL[app.tab]} tablosunun kurası (yerleşimi) aynı kalır, sadece kazananlar ve skorlar silinir.</small></button>` +
      (ONLINE
        ? '<p class="muted" style="margin-top:18px">Kaydet’e bastığında bu sayfanın yeni bir sürümü yayınlanır; linki açan herkes güncel tabloyu görür. Önceki sürümler saklanır.</p>'
        : '<p class="muted" style="margin-top:18px">Kayıt dosyası: <code>turnuva/kayit.json</code><br>Her kayıtta eski hali Masaüstündeki <code>turnuva_yedekler</code> klasörüne yedeklenir.</p>');
  }

  function renderPodium() {
    const p = app.br.podium;
    const li = (n, cls, pid, label) => `<li><span class="medal ${cls}">${n}</span><div><div class="muted">${label}</div>` +
      `<div class="who${pid ? '' : ' tbd'}">${pid ? esc(nameOf(pid)) : 'Belli değil'}</div></div></li>`;
    const s = L.stats(cur(), app.br);
    return `<h2>Dereceler · ${GENDER_LABEL[app.tab]}</h2><ul class="podium">` +
      li(1, 'm1', p.first, 'Şampiyon') + li(2, 'm2', p.second, 'İkinci (finalist)') +
      li(3, 'm3', p.third, 'Üçüncü') + li(4, 'm4', p.fourth, 'Dördüncü') + '</ul>' +
      `<p class="muted">Oynanan maç: ${s.done}/${s.total}</p>`;
  }

  function renderHelp() {
    if (!app.canEdit) {
      return '<h2>Nasıl kullanılır?</h2><div class="help"><ol>' +
        '<li>Bu tablo <b>sadece görüntüleme</b> içindir; sonuçları turnuva yöneticisi girer. Yeni bir sonuç kaydedildiğinde sayfa kendiliğinden güncellenir.</li>' +
        '<li><b>Oyuncu bulmak:</b> soldaki Katılımcılar listesinde ismini ara; numarasına tıklayınca tabloda o oyuncunun son maçına gider.</li>' +
        '<li>Bir ismin üstüne gelince o oyuncunun tablodaki yolu mavi çizgiyle işaretlenir.</li>' +
        '<li><b>Yakınlaştırma:</b> sağ alttaki düğmeler ya da <kbd>Ctrl</kbd>/<kbd>⌘</kbd> + fare tekerleği; %100 yazısına tıklayınca tablo genişliğe sığar.</li>' +
        '<li>Sağ üstteki mavi düğmeden tur eşleşmelerini metin olarak kopyalayabilir ya da tabloyu resim olarak indirebilirsin.</li>' +
        '</ol></div>';
    }
    const saveHelp = ONLINE
      ? '<li><b>Kaydet:</b> değişiklikler <b>Kaydet</b>’e basınca bu sayfanın yeni sürümü olarak yayınlanır (<kbd>⌘S</kbd> / <kbd>Ctrl+S</kbd>). Linki açan herkes güncel tabloyu görür; açık sayfalar kendiliğinden yenilenir.</li>'
      : '<li><b>Kaydet:</b> değişiklikler <b>Kaydet</b>’e basınca dosyaya yazılır (<kbd>⌘S</kbd> / <kbd>Ctrl+S</kbd>). İlk kayıttan sonra uygulama her açılışta bu tabloyu yükler, bir daha rastgele kura çekmez.</li>';
    return '<h2>Nasıl kullanılır?</h2><div class="help"><ol>' +
      '<li><b>Kazanan seçmek:</b> maçtaki oyuncunun ismine tıkla; bir sonraki tura geçer. Aynı isme tekrar tıklarsan sonuç silinir.</li>' +
      '<li><b>Skor:</b> ismin sağındaki kutuya yaz (ör. 3 ve 1). İki skor girilince kazanan otomatik seçilir. <kbd>Tab</kbd> ile sonraki kutuya geçebilirsin.</li>' +
      '<li><b>Yer değiştirmek:</b> 1. turdaki bir oyuncuyu başka bir oyuncunun (ya da BAY’ın) üstüne sürükle. Ya da soldaki numara kutusuna tıkla, sonra yer değiştireceği oyuncuya tıkla.</li>' +
      '<li><b>Erkekler / Kadınlar:</b> soldaki Katılımcılar panelinin üstündeki sekmeyle iki tablo arasında geçersin; sekme değişince o tablo açılır. Kaydet ikisini birlikte kaydeder.</li>' +
      '<li><b>BAY:</b> kişi sayısı tablo boyutundan az olduğunda boş kalan yerler BAY’dır; BAY ile eşleşen oyuncu doğrudan bir sonraki tura çıkar.</li>' +
      '<li><b>Katılımcılar:</b> isimleri soldaki listeden düzeltebilir, E/K ile cinsiyeti değiştirebilir, yeni kişi ekleyebilirsin.</li>' +
      saveHelp +
      '<li><b>Geri al:</b> <kbd>⌘Z</kbd> / <kbd>Ctrl+Z</kbd>, yinele: <kbd>⇧⌘Z</kbd>.</li>' +
      '<li><b>Yakınlaştırma:</b> sağ alttaki düğmeler ya da <kbd>Ctrl</kbd>/<kbd>⌘</kbd> + fare tekerleği.</li>' +
      '<li><b>Paylaşmak:</b> sağ üstteki mavi düğmeden tabloyu PNG olarak indirebilir ya da tur eşleşmelerini WhatsApp’a yapıştırılacak metin olarak kopyalayabilirsin.</li>' +
      '</ol></div>';
  }

  function renderPanel() {
    if (app.pointerDown) { app.panelPending = true; return; }
    app.panelPending = false;
    for (const b of $$('.rail button')) b.classList.toggle('active', b.dataset.panel === (app.panel || 'bracket'));
    if (app.panel === 'tools' && !app.canEdit) app.panel = 'people';
    if (!app.panel) { els.panel.hidden = true; return; }
    els.panel.hidden = false;
    const active = document.activeElement;
    const key = active && els.panel.contains(active) ? active.dataset.key : null;
    const sel = key && active.selectionStart != null ? [active.selectionStart, active.selectionEnd] : null;
    const html = app.panel === 'people' ? renderPeople() : app.panel === 'tools' ? renderTools()
      : app.panel === 'podium' ? renderPodium() : renderHelp();
    const scroll = els.panel.scrollTop;
    els.panel.innerHTML = html;
    els.panel.scrollTop = scroll;
    if (key) {
      const el = $(`[data-key="${CSS.escape(key)}"]`, els.panel);
      if (el) {
        el.focus();
        if (sel) try { el.setSelectionRange(sel[0], sel[1]); } catch (e) { /* bazı input türleri desteklemez */ }
      }
    }
  }

  function renderBanner() {
    if (app.pointerDown) { app.bannerPending = true; return; }
    app.bannerPending = false;
    const parts = [];
    let warn = false;
    if (!app.canEdit) {
      // görüntüleyenlere uyarı gösterme
    } else if (app.stash) {
      warn = true;
      parts.push('<span class="grow"><b>Son değişikliklerin kaydedilemedi:</b> sen kaydederken başka biri bu tabloyu güncelledi ve sayfa onun haliyle yenilendi. ' +
        'Kendi halini geri yükleyip tekrar kaydedebilirsin (o zaman diğer kişinin değişiklikleri gider).</span>');
      parts.push('<button class="btn" data-act="stashDrop">Vazgeç</button>');
      parts.push('<button class="btn primary" data-act="stashRestore">Benim halimi geri yükle</button>');
    } else if (app.warning) {
      warn = true;
      parts.push(`<span class="grow">${esc(app.warning)}</span>`);
    } else if (!app.everSaved) {
      const checks = app.state.participants.filter((p) => p.check);
      parts.push('<span class="grow"><b>Bu kura rastgele çekildi ve henüz kaydedilmedi.</b> İstediğin değişiklikleri yapıp <b>Kaydet</b>’e bas; ' +
        (ONLINE ? 'kaydettiğinde bu linki açan herkes senin tablonu görür.'
          : 'kaydettikten sonra uygulama her açılışta bu tabloyu yükler, bir daha rastgele kura çekmez.') +
        (checks.length ? `<br>Cinsiyeti kesin anlaşılamayanlar: ${checks.map((p) => `${esc(p.name)} (${p.gender})`).join(', ')} — Katılımcılar listesinden kontrol et.` : '') +
        '</span>');
      parts.push('<button class="btn" data-act="redraw">Yeni kura çek</button>');
      parts.push('<button class="btn primary" data-act="save">Kaydet</button>');
    }
    els.banner.hidden = !parts.length;
    els.banner.className = 'banner' + (warn ? ' warn' : '');
    const html = parts.join('');
    if (html !== app.bannerHtml) {
      app.bannerHtml = html;
      els.banner.innerHTML = html;
    }
  }

  function updateStatus() {
    const dirty = isDirty();
    els.saveBtn.classList.toggle('dirty', dirty);
    els.undoBtn.disabled = !app.undo.length;
    els.redoBtn.disabled = !app.redo.length;
    const s = els.saveStatus;
    s.className = 'save-status' + (dirty && app.canEdit ? ' dirty' : '');
    if (els.roChip) els.roChip.hidden = app.canEdit;
    if (!app.canEdit) s.textContent = app.state.savedAt ? `Son güncelleme · ${formatTime(app.state.savedAt)}` : '';
    else if (app.saving) s.textContent = 'Kaydediliyor…';
    else if (!app.everSaved) s.textContent = '● Henüz kaydedilmedi';
    else if (dirty) s.textContent = '● Kaydedilmemiş değişiklikler';
    else s.textContent = app.state.savedAt ? `Kaydedildi · ${formatTime(app.state.savedAt)}` : 'Kaydedildi';
    document.title = (dirty && app.canEdit ? '• ' : '') + curTitle();
  }

  function formatTime(iso) {
    const d = new Date(iso);
    if (isNaN(d)) return '';
    const today = new Date().toDateString() === d.toDateString();
    const hm = d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
    return today ? hm : d.toLocaleDateString('tr-TR') + ' ' + hm;
  }

  /* ------------------------------------------------------------------ */
  /* Sunucu                                                              */
  /* ------------------------------------------------------------------ */

  async function api(path, body) {
    let res;
    try {
      res = await fetch(path, body === undefined ? { cache: 'no-store' } : {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
    } catch (e) {
      throw new Error('Uygulama (Python) kapalı görünüyor. Turnuva.command ile tekrar aç.');
    }
    let data = {};
    try { data = await res.json(); } catch (e) { /* boş yanıt */ }
    if (!res.ok) {
      const err = new Error(data.error || `Sunucu hatası (${res.status})`);
      err.conflict = !!data.conflict;
      throw err;
    }
    return data;
  }

  /* Yazılıp henüz onaylanmamış (odakta duran) bir kutu varsa önce onu işler. */
  function commitFocused() {
    const a = document.activeElement;
    if (a && a.matches && a.matches('input.sc, input.pname, #title')) a.blur();
  }

  async function save(force) {
    if (app.saving || !app.canEdit) return;
    commitFocused();
    if (ONLINE) return saveOnline();
    app.saving = true;
    updateStatus();
    const sent = JSON.parse(JSON.stringify(app.state));
    let conflict = false;
    try {
      const data = await api('/api/state', { state: sent, baseRev: app.rev, force: force === true });
      sent.savedAt = data.savedAt;
      app.state.savedAt = data.savedAt;
      app.state.rev = data.rev;
      app.rev = data.rev;
      app.savedCanon = canon(sent);
      app.everSaved = true;
      app.warning = null;
      toast('Kaydedildi ✓', 'ok');
    } catch (e) {
      if (e.conflict) conflict = true;
      else toast('Kaydedilemedi: ' + e.message, 'error');
    } finally {
      app.saving = false;
      updateStatus();
      renderBanner();
    }
    if (conflict) {
      const ok = await confirmDialog('Daha yeni bir kayıt var',
        'Bu tablo başka bir pencerede (ya da uygulamanın başka bir kopyasında) bu sayfa açıldıktan sonra kaydedilmiş. ' +
        '<b>Üzerine yaz</b> dersen o kayıt bu penceredeki halle değiştirilir (eski hali Masaüstündeki <code>turnuva_yedekler</code> klasöründe kalır). ' +
        'Vazgeçip sayfayı yenilersen diğer kayıt yüklenir, buradaki kaydedilmemiş değişiklikler kaybolur.',
        'Üzerine yaz', true);
      if (ok) save(true);
    }
  }

  async function redraw() {
    const g = app.tab;
    const ok = await confirmDialog(`${GENDER_LABEL[g]} için yeni kura çekilsin mi?`,
      `Bütün ${g === 'K' ? 'kadınlar' : 'erkekler'} bu tabloya baştan <b>rastgele</b> dağıtılır ve bu tablonun <b>tüm maç sonuçları silinir</b>. ` +
      `${g === 'K' ? 'Erkekler' : 'Kadınlar'} tablosu değişmez. Kaydet’e basmadıkça kayıtlı dosya değişmez; istersen Geri al ile dönebilirsin.`, 'Kura çek', true);
    if (!ok || g !== app.tab) return;
    try {
      const size = cur().slots.length;
      const ids = app.state.participants.filter((p) => p.gender === g).map((p) => p.id);
      const data = ONLINE ? L.drawSlots(ids, size, secureRandom) : await api('/api/draw', { ids, size });
      if (g !== app.tab) return;
      mutate((s) => { own(s, g).slots = data.slots; own(s, g).results = {}; });
      toast(`Yeni kura çekildi${data.reserves.length ? `; ${data.reserves.length} kişi tabloya sığmadı (tablo dışında)` : ''}. Kaydetmeyi unutma.`);
    } catch (e) {
      toast('Kura çekilemedi: ' + e.message, 'error');
    }
  }

  async function importCsv() {
    try {
      const data = await api('/api/csv');
      // Aynı kişi: aynı telefon, aynı CSV kaydı (isim sonradan düzeltilmiş olabilir) ya da aynı isim.
      // Silinen kişiler de tekrar eklenmez.
      const digits = (t) => String(t || '').replace(/\D/g, '').slice(-10);
      const known = app.state.participants.concat(app.state.deleted || []);
      const names = new Set(known.map((p) => L.trKey(p.name)));
      const srcs = new Set(known.map((p) => p.src).filter(Boolean));
      const phones = new Set(known.map((p) => digits(p.phone)).filter((d) => d.length >= 7));
      const fresh = data.participants.filter((p) => !names.has(L.trKey(p.name)) &&
        !(p.src && srcs.has(p.src)) && !(digits(p.phone).length >= 7 && phones.has(digits(p.phone))));
      if (!fresh.length) { toast('CSV’de yeni kişi yok.'); return; }
      mutate((s) => {
        for (const p of fresh) {
          const np = L.addParticipant(s, p.name, p.gender, p.phone);
          np.check = !!p.check;
          if (p.src) np.src = p.src;
        }
      });
      const m = fresh.filter((p) => p.gender === 'E').length;
      toast(`${fresh.length} yeni kişi eklendi (${m} erkek, ${fresh.length - m} kadın; ilgili sekmede “Tablo dışında” listesinde).`);
    } catch (e) {
      toast('CSV okunamadı: ' + e.message, 'error');
    }
  }

  /* ------------------------------------------------------------------ */
  /* Dışa aktarma                                                        */
  /* ------------------------------------------------------------------ */

  function fileBase() {
    const t = L.trKey(curTitle())
      .replace(/ç/g, 'c').replace(/ğ/g, 'g').replace(/ı/g, 'i').replace(/ö/g, 'o').replace(/ş/g, 's').replace(/ü/g, 'u')
      .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${t || 'turnuva'}_${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  async function download(blob, name) {
    if (ONLINE) {
      // Paylaşılan sayfada indirme yalnızca platformun indirme izniyle yapılabilir
      const dl = window.claude && window.claude.use ? await window.claude.use('downloads') : null;
      if (!dl) { toast('Bu görünümde dosya indirilemiyor.', 'error'); return false; }
      try {
        await dl.save({ filename: name, data: blob });
        return true;
      } catch (e) {
        if (e && e.code !== 'declined') toast('İndirilemedi: ' + ((e && e.message) || 'bilinmeyen hata'), 'error');
        return false;
      }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    return true;
  }

  function exportJSON() {
    download(new Blob([JSON.stringify(app.state, null, 1)], { type: 'application/json' }), fileBase() + '.json');
  }

  function fitText(ctx, text, max) {
    if (ctx.measureText(text).width <= max) return text;
    let t = text;
    while (t.length > 1 && ctx.measureText(t + '…').width > max) t = t.slice(0, -1);
    return t + '…';
  }

  function exportPNG() {
    const st = Object.assign(cur(), { title: curTitle() });
    const br = app.br;
    const R = br.R;
    const lay = layout(R);
    const W = lay.width;
    const H = Math.max(lay.height, lay.thirdY + 120) + G.HEAD;
    const scale = Math.max(1, Math.min(2, Math.floor(Math.sqrt(16e6 / (W * H)) * 10) / 10));
    const cv = document.createElement('canvas');
    cv.width = Math.floor(W * scale);
    cv.height = Math.floor(H * scale);
    const ctx = cv.getContext('2d');
    ctx.scale(scale, scale);
    const font = getComputedStyle(document.body).fontFamily;
    ctx.fillStyle = '#1e1f22';
    ctx.fillRect(0, 0, W, H);
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#9a9ca1';
    ctx.font = `500 11.5px ${font}`;
    ctx.textAlign = 'center';
    for (let r = 0; r < R; r++) ctx.fillText(`${L.roundName(r, R)}  ·  ${st.slots.length >> r} kişi`.toLocaleUpperCase('tr'), colX(r) + G.MW / 2, 20);
    ctx.fillText('ŞAMPİYON', lay.champX + G.CHAMP_W / 2, 20);
    ctx.translate(0, G.HEAD);

    ctx.strokeStyle = '#d6d6d6';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    for (let r = 0; r < R - 1; r++) {
      for (let m = 0; m < (st.slots.length >> (r + 1)); m += 2) {
        const x0 = colX(r) + G.MW;
        const xm = x0 + G.GAP / 2;
        const y1 = centerY(r, m);
        const y2 = centerY(r, m + 1);
        const yc = centerY(r + 1, m / 2);
        ctx.moveTo(x0, y1); ctx.lineTo(xm, y1); ctx.lineTo(xm, y2); ctx.lineTo(x0, y2);
        ctx.moveTo(xm, yc); ctx.lineTo(colX(r + 1), yc);
      }
    }
    ctx.moveTo(colX(R - 1) + G.MW, lay.finalY); ctx.lineTo(lay.champX, lay.finalY);
    ctx.stroke();

    const drawMatch = (mt, x, y) => {
      const scores = (st.results[mt.id] && st.results[mt.id].scores) || {};
      mt.sides.forEach((s, i) => {
        const ry = y + i * G.ROW;
        const pid = s.type === 'player' ? s.id : null;
        const win = mt.result && mt.winner.id === pid;
        const lose = mt.result && !win;
        ctx.fillStyle = win ? '#455a4d' : '#3c3d41';
        ctx.fillRect(x, ry, G.MW, G.ROW);
        ctx.fillStyle = win ? '#3fb27f' : '#2b2c30';
        ctx.fillRect(x, ry, 28, G.ROW);
        let seed = pid ? String(app.slotIndex.get(pid) + 1) : '';
        if (mt.r === 0 && !mt.isThird) seed = String(mt.m * 2 + i + 1);
        ctx.textAlign = 'center';
        ctx.fillStyle = '#fff';
        ctx.font = `700 10.5px ${font}`;
        ctx.fillText(seed, x + 14, ry + G.ROW / 2 + 0.5);
        ctx.textAlign = 'left';
        const sc = pid && scores[pid] != null ? String(scores[pid]) : '';
        if (s.type === 'player') {
          ctx.font = `${win ? 600 : 400} 13.3px ${font}`;
          ctx.fillStyle = lose ? '#9ea0a5' : '#fff';
          ctx.fillText(fitText(ctx, nameOf(pid), G.MW - 28 - 16 - (sc ? 28 : 0)), x + 38, ry + G.ROW / 2 + 0.5);
        } else if (s.type === 'bye') {
          ctx.font = `italic 13px ${font}`;
          ctx.fillStyle = '#7e8086';
          ctx.fillText('BAY', x + 38, ry + G.ROW / 2 + 0.5);
        }
        if (sc) {
          ctx.textAlign = 'center';
          ctx.font = `600 13px ${font}`;
          ctx.fillStyle = '#fff';
          ctx.fillText(sc, x + G.MW - 14, ry + G.ROW / 2 + 0.5);
        }
      });
      ctx.fillStyle = '#2a2b2f';
      ctx.fillRect(x, y + G.ROW - 0.5, G.MW, 1);
    };
    for (const list of br.rounds) for (const mt of list) drawMatch(mt, colX(mt.r), centerY(mt.r, mt.m) - G.MH / 2);
    if (br.third) {
      ctx.fillStyle = '#9a9ca1';
      ctx.font = `500 11.5px ${font}`;
      ctx.textAlign = 'left';
      ctx.fillText('3.LÜK MAÇI', lay.thirdX, lay.thirdY - 14);
      drawMatch(br.third, lay.thirdX, lay.thirdY);
    }
    const cx = lay.champX;
    const cy = lay.champY;
    const grad = ctx.createLinearGradient(cx, cy, cx + G.CHAMP_W, cy + 116);
    grad.addColorStop(0, '#4b3f1a');
    grad.addColorStop(1, '#3a3a3e');
    ctx.fillStyle = grad;
    ctx.fillRect(cx, cy, G.CHAMP_W, 116);
    ctx.strokeStyle = '#7a6526';
    ctx.lineWidth = 1;
    ctx.strokeRect(cx + 0.5, cy + 0.5, G.CHAMP_W - 1, 115);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#f5c542';
    ctx.font = `28px ${font}`;
    ctx.fillText('🏆', cx + G.CHAMP_W / 2, cy + 30);
    ctx.font = `500 11.5px ${font}`;
    ctx.fillText('ŞAMPİYON', cx + G.CHAMP_W / 2, cy + 62);
    const champ = br.podium.first;
    ctx.font = champ ? `600 17px ${font}` : `italic 14px ${font}`;
    ctx.fillStyle = champ ? '#fff' : '#8d8f94';
    ctx.fillText(fitText(ctx, champ ? nameOf(champ) : 'Final bekleniyor', G.CHAMP_W - 20), cx + G.CHAMP_W / 2, cy + 88);
    ctx.textAlign = 'left';
    ctx.fillStyle = '#6d7075';
    ctx.font = `12px ${font}`;
    ctx.fillText(st.title || '', G.PAD_X, H - G.HEAD - 12);

    cv.toBlob(async (blob) => {
      if (!blob) { toast('Resim oluşturulamadı.', 'error'); return; }
      if (await download(blob, fileBase() + '.png')) toast('Tablo resmi indirildi.', 'ok');
    }, 'image/png');
  }

  function matchesText(sel, showResults) {
    const st = Object.assign(cur(), { title: curTitle() });
    const br = app.br;
    const lines = [`🏓 ${st.title || 'Turnuva'}`];
    if (sel === 'podium') {
      const p = br.podium;
      const n = (pid) => (pid ? nameOf(pid) : 'belli değil');
      lines.push('*Dereceler*', '', `🥇 1. ${n(p.first)}`, `🥈 2. ${n(p.second)}`, `🥉 3. ${n(p.third)}`, `4. ${n(p.fourth)}`);
      return lines.join('\n');
    }
    const isThird = sel === L.THIRD;
    const list = isThird ? (br.third ? [br.third] : []) : br.rounds[Number(sel)];
    lines.push(`*${isThird ? '3.lük Maçı' : L.roundName(Number(sel), br.R) + ' Eşleşmeleri'}*`, '');
    const byes = [];
    const label = (mt, i) => {
      const s = mt.sides[i];
      if (s.type === 'bye') return 'BAY';
      if (s.type !== 'player') {
        if (isThird) return '(yarı final kaybedeni)';
        return `(${L.roundName(mt.r - 1, br.R)} ${mt.m * 2 + i + 1}. maç kazananı)`;
      }
      const nm = nameOf(s.id);
      return showResults && mt.result && mt.winner.id === s.id ? `*${nm}*` : nm;
    };
    for (const mt of list) {
      if (mt.auto) {
        if (mt.winner.type === 'player') byes.push(nameOf(mt.winner.id));
        continue;
      }
      const sc = (st.results[mt.id] && st.results[mt.id].scores) || {};
      const a = mt.sides[0].id;
      const b = mt.sides[1].id;
      const score = showResults && a && b && sc[a] != null && sc[b] != null ? ` ${sc[a]}-${sc[b]} ` : ' - ';
      const num = isThird ? '' : `${mt.m + 1}) `;
      lines.push(`${num}${label(mt, 0)}${score}${label(mt, 1)}${showResults && mt.result ? ' ✅' : ''}`);
    }
    if (byes.length) lines.push('', `BAY ile tur atlayanlar: ${byes.join(', ')}`);
    return lines.join('\n');
  }

  function openTextExport() {
    const br = app.br;
    let current = 0;
    for (let r = 0; r < br.R; r++) {
      if (br.rounds[r].some((m) => m.playable && !m.result)) { current = r; break; }
      current = r;
    }
    const opts = br.rounds.map((_, r) => `<option value="${r}"${r === current ? ' selected' : ''}>${esc(L.roundName(r, br.R))}</option>`).join('') +
      (br.third ? `<option value="${L.THIRD}">3.lük Maçı</option>` : '') + '<option value="podium">Dereceler</option>';
    els.modal.innerHTML = '<div class="dialog"><h3>Eşleşme listesi</h3>' +
      '<p>Seçtiğin turun eşleşmelerini WhatsApp’a yapıştırabileceğin metin olarak kopyala. Kazananlar *kalın* yazılır.</p>' +
      `<div class="opts"><select id="txRound">${opts}</select>` +
      '<label><input type="checkbox" id="txRes" checked> Sonuçları göster</label></div>' +
      '<textarea id="txOut" readonly></textarea>' +
      '<div class="actions"><button class="btn" data-close>Kapat</button><button class="btn primary" id="txCopy">Kopyala</button></div></div>';
    els.modal.hidden = false;
    const update = () => { $('#txOut').value = matchesText($('#txRound').value, $('#txRes').checked); };
    $('#txRound').onchange = update;
    $('#txRes').onchange = update;
    $('#txCopy').onclick = async () => {
      const ta = $('#txOut');
      try {
        await navigator.clipboard.writeText(ta.value);
      } catch (e) {
        ta.select();
        document.execCommand('copy');
      }
      toast('Panoya kopyalandı.', 'ok');
    };
    update();
  }

  /* ------------------------------------------------------------------ */
  /* Küçük yardımcılar: bildirim, onay penceresi, yakınlaştırma         */
  /* ------------------------------------------------------------------ */

  let toastTimer = null;
  function toast(msg, kind) {
    els.toast.textContent = msg;
    els.toast.className = 'toast show' + (kind ? ' ' + kind : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { els.toast.className = 'toast'; }, kind === 'error' ? 6000 : 3200);
  }

  let modalClose = null;
  function confirmDialog(title, html, okLabel, danger) {
    return new Promise((resolve) => {
      els.modal.innerHTML = `<div class="dialog"><h3>${esc(title)}</h3><p>${html}</p><div class="actions">` +
        `<button class="btn" data-close>Vazgeç</button><button class="btn ${danger ? 'danger' : 'primary'}" id="dlgOk">${esc(okLabel || 'Tamam')}</button></div></div>`;
      els.modal.hidden = false;
      const done = (v) => {
        els.modal.hidden = true;
        els.modal.innerHTML = '';
        modalClose = null;
        resolve(v);
      };
      $('#dlgOk').onclick = () => done(true);
      modalClose = () => done(false);
      $('#dlgOk').focus();
    });
  }

  function closeModal() {
    if (els.modal.hidden) return;
    if (modalClose) modalClose();
    else { els.modal.hidden = true; els.modal.innerHTML = ''; }
  }

  function setZoom(z, anchor) {
    z = Math.min(1.6, Math.max(0.2, Math.round(z * 100) / 100));
    const cv = els.canvas;
    const old = app.zoom;
    const top = els.board.offsetTop;
    const ax = anchor ? anchor.x : cv.clientWidth / 2;
    const ay = anchor ? anchor.y : cv.clientHeight / 2;
    const bx = (cv.scrollLeft + ax) / old;
    const by = (cv.scrollTop + ay - top) / old;
    app.zoom = z;
    els.board.style.zoom = z;
    els.zoomVal.textContent = '%' + Math.round(z * 100);
    cv.scrollLeft = bx * z - ax;
    cv.scrollTop = by * z + top - ay;
    store('zoom', String(z));
  }

  function scrollToRow(row) {
    const cv = els.canvas;
    const rr = row.getBoundingClientRect();
    const cr = cv.getBoundingClientRect();
    cv.scrollTo({
      left: cv.scrollLeft + rr.left - cr.left - cv.clientWidth / 2 + rr.width / 2,
      top: cv.scrollTop + rr.top - cr.top - cv.clientHeight / 2 + rr.height / 2,
      behavior: 'smooth',
    });
    row.classList.remove('flash');
    void row.offsetWidth;
    row.classList.add('flash');
  }

  function gotoPlayer(pid) {
    const st = L.playerStatus(app.br, pid);
    if (!st.last) { toast('Bu kişi tabloda değil.'); return; }
    const ref = app.els.get(st.last.id);
    const i = st.last.sides.findIndex((s) => s.id === pid);
    if (ref && i >= 0) scrollToRow(ref.rows[i].row);
  }

  /* ------------------------------------------------------------------ */
  /* Olaylar                                                             */
  /* ------------------------------------------------------------------ */

  function rowInfo(row) {
    const matchEl = row.closest('.match');
    const mid = matchEl.dataset.mid;
    const side = Number(row.dataset.side);
    const isR0 = /^R0-/.test(mid);
    const slot = isR0 ? Number(mid.slice(3)) * 2 + side : null;
    return { mid, side, slot, pid: row.dataset.pid || null };
  }

  function bindBoard() {
    const board = els.board;

    board.addEventListener('click', (e) => {
      if (e.target.closest('.sc') || !app.canEdit) return;
      const row = e.target.closest('.row');
      if (!row) { if (app.selected != null) { app.selected = null; patchBoard(); } return; }
      const info = rowInfo(row);
      if (info.slot != null && (app.selected != null || e.target.closest('.seed'))) {
        if (app.selected == null) {
          app.selected = info.slot;
          patchBoard();
          toast('Yer değiştireceği oyuncuya (ya da BAY’a) tıkla. Vazgeçmek için Esc.');
        } else if (app.selected === info.slot) {
          app.selected = null;
          patchBoard();
        } else {
          const from = app.selected;
          app.selected = null;
          swap(from, info.slot);
          patchBoard();
        }
        return;
      }
      if (app.selected != null) { app.selected = null; patchBoard(); }
      const mt = app.br.byId.get(info.mid);
      // Skor kutusundan çıkarken kazanan zaten seçildiyse aynı tıklama onu geri almasın
      const ap = app.autoPick;
      app.autoPick = null;
      if (ap && ap.mid === info.mid && ap.pid === info.pid) return;
      if (mt && mt.playable && info.pid) chooseWinner(info.mid, info.pid);
    });

    board.addEventListener('change', (e) => {
      const sc = e.target.closest('.sc');
      if (!sc) return;
      const mid = sc.closest('.match').dataset.mid;
      const pid = sc.dataset.pid;
      if (!pid) return;
      const w0 = winnerCount();
      const prev = cur().results[mid] && cur().results[mid].winner;
      mutate((s) => L.setScore(L.viewOf(s, app.tab), mid, pid, sc.value));
      const now = cur().results[mid] && cur().results[mid].winner;
      if (now && now !== prev) app.autoPick = { mid, pid: now, t: performance.now() };
      notify('', w0 + (now ? 1 : 0) - (prev ? 1 : 0) - winnerCount());
    });

    board.addEventListener('keydown', (e) => {
      const sc = e.target.closest('.sc');
      if (!sc || (e.key !== 'Enter' && e.key !== 'Tab')) return;
      e.preventDefault();
      const inputs = $$('.sc:not(:disabled)', board);
      const idx = inputs.indexOf(sc);
      sc.dispatchEvent(new Event('change', { bubbles: true }));
      const next = inputs[idx + (e.shiftKey ? -1 : 1)];
      if (next && !next.disabled) { next.focus(); next.select(); } else sc.blur();
    });

    board.addEventListener('mouseover', (e) => {
      const row = e.target.closest('.row');
      const pid = row ? row.dataset.pid || null : null;
      if (pid === app.hoverPid) return;
      for (const r of $$('.row.hover-path', board)) r.classList.remove('hover-path');
      app.hoverPid = pid;
      if (pid) for (const r of $$(`.row[data-pid="${pid}"]`, board)) r.classList.add('hover-path');
    });
    board.addEventListener('mouseleave', () => {
      app.hoverPid = null;
      for (const r of $$('.row.hover-path', board)) r.classList.remove('hover-path');
    });

    /* Sürükle-bırak: 1. tur satırları ve soldaki liste */
    board.addEventListener('dragstart', (e) => {
      const row = e.target.closest && e.target.closest('.row');
      if (!row || e.target.closest('.sc') || !app.canEdit) { e.preventDefault(); return; }
      const info = rowInfo(row);
      if (info.slot == null) { e.preventDefault(); return; }
      app.drag = { kind: 'slot', slot: info.slot, pid: info.pid };
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', info.pid ? nameOf(info.pid) : 'BAY');
    });
    board.addEventListener('dragover', (e) => {
      if (!app.drag) return;
      const row = e.target.closest('.match.r0 .row');
      if (!row) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (!row.classList.contains('drop-over')) {
        for (const r of $$('.row.drop-over', board)) r.classList.remove('drop-over');
        row.classList.add('drop-over');
      }
    });
    board.addEventListener('drop', (e) => {
      const row = e.target.closest('.match.r0 .row');
      const drag = app.drag;
      endDrag();
      if (!row || !drag) return;
      e.preventDefault();
      const info = rowInfo(row);
      if (drag.kind === 'slot') swap(drag.slot, info.slot);
      else if (drag.kind === 'pid') place(drag.pid, info.slot);
    });
    document.addEventListener('dragend', endDrag);

    /* Sürüklerken kenara yaklaşınca kaydır */
    els.canvas.addEventListener('dragover', (e) => {
      if (!app.drag) return;
      const r = els.canvas.getBoundingClientRect();
      const edge = 70;
      let dy = 0;
      if (e.clientY < r.top + edge) dy = -Math.ceil((r.top + edge - e.clientY) / 3);
      else if (e.clientY > r.bottom - edge) dy = Math.ceil((e.clientY - (r.bottom - edge)) / 3);
      if (dy) els.canvas.scrollTop += dy;
    });
  }

  function endDrag() {
    app.drag = null;
    for (const r of $$('.drop-over')) r.classList.remove('drop-over');
    for (const r of $$('.dragging')) r.classList.remove('dragging');
    const z = $('#outZone');
    if (z) z.classList.remove('over');
  }

  function bindPanel() {
    const panel = els.panel;

    panel.addEventListener('click', async (e) => {
      const tab = e.target.closest('[data-tab]');
      if (tab) { setTab(tab.dataset.tab); return; }
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const row = btn.closest('.prow');
      const pid = row ? row.dataset.pid : null;
      const act = btn.dataset.act;
      if (act === 'goto' && pid) gotoPlayer(pid);
      else if (act === 'gender' && pid) toggleGender(pid);
      else if (act === 'confirm' && pid) {
        mutate((s) => { const p = s.participants.find((x) => x.id === pid); if (p) p.check = false; });
      } else if (act === 'del' && pid) {
        const ok = await confirmDialog('Kişi silinsin mi?', `<b>${esc(nameOf(pid))}</b> listeden silinecek` +
          (app.slotIndex.has(pid) ? ' ve tablodaki yeri BAY olacak' : '') + '.', 'Sil', true);
        if (ok) {
          const name = nameOf(pid);
          const w0 = winnerCount();
          mutate((s) => L.deleteParticipant(s, pid));
          notify(`${name} silindi.`, w0 - winnerCount());
        }
      } else if (act === 'add') addPerson();
      else handleAction(act);
    });

    panel.addEventListener('change', (e) => {
      const inp = e.target.closest('input.pname');
      if (!inp) return;
      const pid = inp.closest('.prow').dataset.pid;
      const val = inp.value.replace(/\s+/g, ' ').trim();
      if (!val) { inp.value = nameOf(pid); return; }
      mutate((s) => L.rename(s, pid, val), { panel: false });
    });

    panel.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      if (e.target.id === 'addName') { e.preventDefault(); addPerson(); }
      else if (e.target.matches('input.pname')) e.target.blur();
      else if (e.target.id === 'search') {
        const hit = app.state.participants.find((p) => p.gender === app.tab && app.slotIndex.has(p.id) && L.trKey(p.name).includes(L.trKey(app.query)));
        if (hit) gotoPlayer(hit.id);
      }
    });

    panel.addEventListener('input', (e) => {
      if (e.target.id !== 'search') return;
      app.query = e.target.value;
      renderPanel();
      patchBoard();
    });

    panel.addEventListener('dragstart', (e) => {
      const row = e.target.closest && e.target.closest('.prow[draggable]');
      if (!row || e.target.matches('input') || !app.canEdit) return;
      app.drag = { kind: 'pid', pid: row.dataset.pid };
      row.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', nameOf(row.dataset.pid));
    });
    panel.addEventListener('dragover', (e) => {
      const zone = e.target.closest('#outZone');
      if (!zone || !app.drag) return;
      const pid = app.drag.pid;
      if (!pid || !app.slotIndex.has(pid)) return;
      e.preventDefault();
      zone.classList.add('over');
    });
    panel.addEventListener('dragleave', (e) => {
      const zone = e.target.closest('#outZone');
      if (zone && !zone.contains(e.relatedTarget)) zone.classList.remove('over');
    });
    panel.addEventListener('drop', (e) => {
      const zone = e.target.closest('#outZone');
      const drag = app.drag;
      endDrag();
      if (!zone || !drag || !drag.pid) return;
      e.preventDefault();
      if (app.slotIndex.has(drag.pid)) unplace(drag.pid);
    });
  }

  function toggleGender(pid) {
    const p = app.pmap.get(pid);
    if (!p) return;
    const next = p.gender === 'E' ? 'K' : 'E';
    const placed = app.slotIndex.has(pid);
    const w0 = winnerCount();
    mutate((s) => L.setGender(s, pid, next));
    const from = GENDER_LABEL[p.gender === 'E' ? 'K' : 'E'];
    const to = next === 'K' ? 'kadınlara' : 'erkeklere';
    notify(`${p.name} ${to} taşındı${placed ? `; ${from.toLocaleLowerCase('tr')} tablosundaki yeri BAY oldu` : ''}. ` +
      `${GENDER_LABEL[next]} sekmesinde “Tablo dışında” listesinde; yerleştirmek için bir BAY’ın üstüne sürükle.`,
    w0 - winnerCount());
  }

  function addPerson() {
    const inp = $('#addName');
    const name = inp ? inp.value.trim() : '';
    if (!name) { if (inp) inp.focus(); return; }
    if (app.state.participants.some((p) => L.trKey(p.name) === L.trKey(name))) {
      toast('Bu isim zaten listede.', 'error');
      return;
    }
    const gender = app.tab === 'K' ? 'K' : 'E';
    mutate((s) => L.addParticipant(s, name, gender));
    const again = $('#addName');
    if (again) { again.value = ''; again.focus(); }
    toast(`${name} eklendi (Tablo dışında). Bir BAY yerine sürükleyerek yerleştirebilirsin.`);
  }

  async function handleAction(act) {
    if (act === 'save') save();
    else if (act === 'redraw') redraw();
    else if (act === 'import') importCsv();
    else if (act === 'importJson') els.jsonFile.click();
    else if (act === 'stashRestore') restoreStash();
    else if (act === 'stashDrop') { stashSet(null); app.stash = null; renderBanner(); }
    else if (act === 'fill') {
      const w0 = winnerCount();
      const n = mutate((s) => L.fillByes(L.viewOf(s, app.tab)));
      notify(n ? `${n} kişi BAY yerlerine yerleştirildi.` : 'Yerleştirilecek kimse ya da boş yer yok.', w0 - winnerCount());
    } else if (act === 'clear') {
      const g = app.tab;
      const ok = await confirmDialog(`${GENDER_LABEL[g]} tablosunun sonuçları silinsin mi?`,
        'Bu tablonun kazananları ve skorları silinir; kura (yerleşim) ve diğer tablo aynı kalır.', 'Sonuçları sil', true);
      if (ok && g === app.tab) mutate((s) => { own(s, g).results = {}; });
    } else if (act === 'png') exportPNG();
    else if (act === 'text') openTextExport();
    else if (act === 'json') exportJSON();
  }

  function bindGlobal() {
    els.saveBtn.addEventListener('click', save);
    els.undoBtn.addEventListener('click', undo);
    els.redoBtn.addEventListener('click', redo);
    els.banner.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (b) handleAction(b.dataset.act);
    });
    els.title.addEventListener('change', () => {
      const v = els.title.value.replace(/\s+/g, ' ').trim();
      if (!v) { els.title.value = curTitle(); return; }
      mutate((s) => { own(s).title = v; }, { panel: false });
    });
    els.title.addEventListener('keydown', (e) => { if (e.key === 'Enter') els.title.blur(); });
    els.jsonFile.addEventListener('change', () => {
      const f = els.jsonFile.files && els.jsonFile.files[0];
      els.jsonFile.value = '';
      if (f) importJsonFile(f);
    });

    $('#dlBtn').addEventListener('click', (e) => {
      e.stopPropagation();
      els.dlMenu.hidden = !els.dlMenu.hidden;
    });
    els.dlMenu.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      els.dlMenu.hidden = true;
      handleAction(b.dataset.act);
    });
    document.addEventListener('click', (e) => {
      if (!els.dlMenu.hidden && !e.target.closest('.dl-wrap')) els.dlMenu.hidden = true;
    });

    els.modal.addEventListener('click', (e) => {
      if (e.target === els.modal || e.target.closest('[data-close]')) closeModal();
    });

    for (const b of $$('.rail button')) {
      b.addEventListener('click', () => {
        const p = b.dataset.panel;
        app.panel = p === 'bracket' || app.panel === p ? null : p;
        store('panel', app.panel || 'none');
        renderPanel();
      });
    }

    $('#zoomIn').addEventListener('click', () => setZoom(app.zoom + 0.1));
    $('#zoomOut').addEventListener('click', () => setZoom(app.zoom - 0.1));
    $('#zoomVal').addEventListener('click', () => {
      // %100 iken tabloyu genişliğe sığdır, değilse %100'e dön
      const fit = (els.canvas.clientWidth - 24) / (els.board.scrollWidth / app.zoom);
      setZoom(app.zoom === 1 ? Math.min(1, fit) : 1);
    });
    $('#fullBtn').addEventListener('click', () => {
      const done = (p) => { if (p && p.catch) p.catch(() => toast('Tam ekran bu görünümde kullanılamıyor.')); };
      if (document.fullscreenElement) done(document.exitFullscreen());
      else if (document.documentElement.requestFullscreen) done(document.documentElement.requestFullscreen());
      else toast('Tam ekran bu görünümde kullanılamıyor.');
    });
    els.canvas.addEventListener('wheel', (e) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const r = els.canvas.getBoundingClientRect();
      setZoom(app.zoom * Math.exp(-e.deltaY * 0.004), { x: e.clientX - r.left, y: e.clientY - r.top });
    }, { passive: false });

    document.addEventListener('pointerdown', (e) => {
      if (e.button === 0 && !e.ctrlKey) app.pointerDown = true;
      // Skor yazıp aynı hareketle ismine tıklama durumu bu tıklamadan sonra biter
      if (app.autoPick && performance.now() - app.autoPick.t > 50) app.autoPick = null;
    }, true);
    const release = () => {
      setTimeout(() => {
        app.pointerDown = false;
        if (app.panelPending) renderPanel();
        if (app.bannerPending) renderBanner();
      }, 0);
    };
    document.addEventListener('pointerup', release, true);
    document.addEventListener('pointercancel', release, true);
    document.addEventListener('dragend', release, true);
    document.addEventListener('contextmenu', release, true);
    window.addEventListener('blur', release);

    document.addEventListener('keydown', (e) => {
      const mod = e.metaKey || e.ctrlKey;
      const typing = e.target.matches && e.target.matches('input, textarea, select');
      if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); if (app.canEdit) save(); return; }
      if (e.key === 'Escape') {
        closeModal();
        els.dlMenu.hidden = true;
        if (app.selected != null) { app.selected = null; patchBoard(); }
        return;
      }
      if (typing || !els.modal.hidden) return;
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
      else if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
    });

    window.addEventListener('beforeunload', (e) => {
      if (app.state && app.canEdit && isDirty()) { e.preventDefault(); e.returnValue = ''; }
    });
  }

  /* ------------------------------------------------------------------ */
  /* Çevrimiçi (paylaşılan link) sürüm                                   */
  /* ------------------------------------------------------------------ */

  /* Platformun eklediği sayfa iskeletindeki küçük sıfırlama stili. Sayfa kendini
   * yayınlarken iskeleti aynen yeniden kurar. */
  const SKELETON_RESET = ':root{color-scheme:light;box-sizing:border-box;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}html{scroll-padding-top:env(safe-area-inset-top,0px)}body{margin:0;padding:0;font:14px -apple-system,BlinkMacSystemFont,sans-serif;background:#fff;color:#000}img{max-width:100%}[hidden]:not([hidden=until-found i]){display:none!important}';
  const STASH_KEY = 'turnuva.stash';

  function secureRandom() {
    try {
      return crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296;
    } catch (e) {
      return Math.random();
    }
  }

  function stashGet() {
    try { return JSON.parse(sessionStorage.getItem(STASH_KEY) || 'null'); } catch (e) { return null; }
  }

  function stashSet(v) {
    try {
      if (v) sessionStorage.setItem(STASH_KEY, JSON.stringify(v));
      else sessionStorage.removeItem(STASH_KEY);
    } catch (e) { /* oturum depolaması kapalı olabilir */ }
  }

  function loadEmbedded() {
    const state = JSON.parse(document.getElementById('tdata').textContent);
    return { state, saved: !!state.savedAt, warning: null };
  }

  /* Bu kişi sayfayı düzenleyebilir mi (sahibi ya da düzenleme izni verilen biri)? */
  async function detectEdit() {
    if (!window.claude || !window.claude.use) return false;
    try {
      const [user, art] = await Promise.all([window.claude.use('user'), window.claude.use('artifact')]);
      if (!user || !art) return false;
      return !!(await user.canEdit());
    } catch (e) {
      return false;
    }
  }

  function setCanEdit(v) {
    app.canEdit = v;
    document.body.classList.toggle('ro', !v);
    els.title.readOnly = !v;
    if (!v) app.selected = null;
    recompute();
    patchBoard();
    renderPanel();
    renderBanner();
    updateStatus();
  }

  /* Sayfanın tamamını, verisi `state` olacak şekilde yeniden üretir. */
  function buildDocument(state) {
    const S = 'script';
    let reset = SKELETON_RESET;
    if (!reset) {
      const st = Array.from(document.head.querySelectorAll('style')).find((x) => x.textContent.includes('[hidden]'));
      reset = st ? st.textContent : '';
    }
    const data = JSON.stringify(state).replace(/</g, '\\u003c')
      .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
    return '<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><style>' +
      reset + '</style></head><body>' + [
        '<title>' + esc(PAGE_TITLE) + '</title>',
        document.getElementById('app-css').outerHTML,
        document.getElementById('shell-tpl').outerHTML,
        '<' + S + ' type="application/json" id="tdata">' + data + '</' + S + '>',
        document.getElementById('logic-src').outerHTML,
        document.getElementById('app-src').outerHTML,
      ].join('\n') + '\n</body></html>';
  }

  async function saveOnline() {
    const art = window.claude && window.claude.use ? await window.claude.use('artifact') : null;
    if (!art) {
      setCanEdit(false);
      toast('Bu görünümde kaydedilemiyor; tablo sadece görüntülenebilir.', 'error');
      return;
    }
    app.saving = true;
    updateStatus();
    const next = JSON.parse(JSON.stringify(app.state));
    next.savedAt = new Date().toISOString();
    next.rev = (app.rev || 0) + 1;
    const prevCanon = app.savedCanon;
    // Yayın başarılı olunca sayfa yenilenir: "çıkılsın mı?" sorusu çıkmasın, değişiklikler
    // de çakışma olursa geri yüklenebilsin diye bu sekmede saklansın.
    stashSet({ state: next });
    app.savedCanon = canon(app.state);
    try {
      await art.publish(buildDocument(next));
      toast('Kaydedildi ✓ Linki açan herkes bu hali görür.', 'ok');
    } catch (e) {
      const code = (e && e.code) || 'upstream_error';
      if (code === 'conflict') {
        toast('Bu arada başka biri kaydetti; sayfa onun haliyle yenileniyor.', 'warn');
        return;
      }
      stashSet(null);
      app.savedCanon = prevCanon;
      if (['not_writer', 'not_granted', 'not_declared', 'consent_required', 'capability_disabled', 'capability_removed'].includes(code)) {
        setCanEdit(false);
        toast('Bu tabloyu düzenleme yetkin yok; sadece görüntüleyebilirsin.', 'error');
      } else if (code === 'rate_limited') {
        toast('Çok sık kaydedildi. Birkaç saniye bekleyip tekrar Kaydet’e bas.', 'error');
      } else if (code === 'too_large') {
        toast('Tablo verisi kaydedilemeyecek kadar büyük.', 'error');
      } else {
        toast('Kaydedilemedi, tekrar dene. (' + code + ')', 'error');
      }
    } finally {
      app.saving = false;
      updateStatus();
    }
  }

  function restoreStash() {
    const st = app.stash;
    app.stash = null;
    stashSet(null);
    if (!st) { renderBanner(); return; }
    mutate((s) => {
      s.title = st.title;
      s.participants = st.participants;
      s.slots = st.slots;
      s.results = st.results || {};
      s.deleted = st.deleted || [];
      if (st.women) s.women = st.women;
      for (const g of L.genders(s)) L.normalize(L.viewOf(s, g));
    });
    els.title.value = curTitle();
    toast('Değişikliklerin geri yüklendi. Kalıcı olması için Kaydet’e bas.');
  }

  /* Kayıt dosyası (kayit.json ya da indirilen yedek) ile tabloyu değiştirir. */
  function checkImported(st) {
    if (!st || typeof st !== 'object') return 'dosyada turnuva verisi yok';
    if (!Array.isArray(st.participants) || !Array.isArray(st.slots)) return 'katılımcı listesi ya da tablo eksik';
    if (st.slots.length !== app.state.slots.length) return `tablo ${st.slots.length} kişilik, bu sayfa ${app.state.slots.length} kişilik`;
    const ids = new Set();
    for (const p of st.participants) {
      if (!p || typeof p.id !== 'string' || typeof p.name !== 'string' || !p.name.trim() || ids.has(p.id)) return 'katılımcı kaydı bozuk';
      if (p.gender !== 'E' && p.gender !== 'K') return 'cinsiyet bilgisi bozuk';
      ids.add(p.id);
    }
    const seen = new Set();
    for (const x of st.slots) {
      if (x == null) continue;
      if (typeof x !== 'string' || !ids.has(x) || seen.has(x)) return 'tablodaki yerleşim bozuk';
      seen.add(x);
    }
    if (st.results != null && typeof st.results !== 'object') return 'sonuçlar bozuk';
    if (st.women != null) {
      const w = st.women;
      if (typeof w !== 'object' || !Array.isArray(w.slots) || w.slots.length !== WOMEN_SIZE) return 'kadınlar tablosu bozuk';
      const wseen = new Set();
      for (const x of w.slots) {
        if (x == null) continue;
        if (typeof x !== 'string' || !ids.has(x) || wseen.has(x) || seen.has(x)) return 'kadınlar tablosundaki yerleşim bozuk';
        wseen.add(x);
      }
      if (w.results != null && typeof w.results !== 'object') return 'kadınlar tablosunun sonuçları bozuk';
    }
    return null;
  }

  function importJsonFile(file) {
    const reader = new FileReader();
    reader.onerror = () => toast('Dosya okunamadı.', 'error');
    reader.onload = async () => {
      let st;
      try {
        const data = JSON.parse(String(reader.result));
        st = data && data.state ? data.state : data;
      } catch (e) {
        toast('Dosya okunamadı: geçerli bir JSON dosyası değil.', 'error');
        return;
      }
      const err = checkImported(st);
      if (err) { toast('Bu dosya kullanılamıyor: ' + err + '.', 'error'); return; }
      const wins = (r) => Object.values(r || {}).filter((x) => x && x.winner).length;
      const nRes = wins(st.results) + wins(st.women && st.women.results);
      const ok = await confirmDialog('Kayıt dosyası yüklensin mi?',
        `<b>${esc(st.title || 'Turnuva')}</b> (${st.participants.length} kişi, ${nRes} maç sonucu) yüklenecek: ` +
        '<b>Erkekler ve Kadınlar tablolarının ikisi de</b> ve katılımcı listesi dosyadakiyle değişir. ' +
        'Kaydet’e basana kadar hiçbir şey kalıcı olmaz; Geri al ile dönebilirsin.', 'Yükle', true);
      if (!ok) return;
      const clean = (p) => {
        const q = { id: p.id, name: String(p.name).replace(/\s+/g, ' ').trim().slice(0, 120), gender: p.gender, check: !!p.check };
        if (!ONLINE) { if (p.phone) q.phone = String(p.phone); if (p.src) q.src = String(p.src); }
        return q;
      };
      mutate((s) => {
        s.title = String(st.title || s.title).slice(0, 80);
        s.participants = st.participants.map(clean);
        s.slots = st.slots.map((x) => x || null);
        s.results = JSON.parse(JSON.stringify(st.results || {}));
        s.deleted = (Array.isArray(st.deleted) ? st.deleted : []).map((d) => (ONLINE
          ? { name: String((d && d.name) || '') }
          : { name: String((d && d.name) || ''), src: String((d && d.src) || ''), phone: String((d && d.phone) || '') }));
        if (st.women) {
          s.women = {
            title: String(st.women.title || WOMEN_TITLE).slice(0, 80),
            slots: st.women.slots.map((x) => x || null),
            results: JSON.parse(JSON.stringify(st.women.results || {})),
          };
        } else {
          // Dosyada kadınlar tablosu yoksa mevcut kadınlar tablosundan artık olmayan kişileri çıkar
          const ids = new Set(s.participants.filter((p) => p.gender === 'K').map((p) => p.id));
          s.women.slots = s.women.slots.map((x) => (x && ids.has(x) ? x : null));
        }
        for (const g of L.genders(s)) L.normalize(L.viewOf(s, g));
      });
      els.title.value = curTitle();
      toast('Kayıt dosyası yüklendi. Kalıcı olması için Kaydet’e bas.');
    };
    reader.readAsText(file);
  }

  /* Erkekler/Kadınlar sekmesi: paneldeki listeyi ve tabloyu birlikte değiştirir. */
  function setTab(g) {
    if ((g !== 'E' && g !== 'K') || (g === 'K' && !app.state.women)) return;
    if (g === app.tab) { renderPanel(); return; }
    commitFocused();
    app.tab = g;
    app.selected = null;
    app.hoverPid = null;
    store('tab', g);
    recompute();
    buildBoard();
    patchBoard();
    renderPanel();
    renderBanner();
    updateStatus();
    els.title.value = curTitle();
    els.canvas.scrollTo(0, 0);
  }

  /* Eski kayıtlarda kadınlar tablosu yoksa kadınları 16'lık tabloya rastgele yerleştirir. */
  function ensureWomen(state) {
    if (state.women && Array.isArray(state.women.slots)) {
      if (!state.women.results) state.women.results = {};
      if (!state.women.title) state.women.title = WOMEN_TITLE;
      return false;
    }
    const ids = state.participants.filter((p) => p.gender === 'K').map((p) => p.id);
    state.women = { title: WOMEN_TITLE, slots: L.drawSlots(ids, WOMEN_SIZE, secureRandom).slots, results: {} };
    return true;
  }

  /* ------------------------------------------------------------------ */
  /* Başlangıç                                                           */
  /* ------------------------------------------------------------------ */

  async function init() {
    bindGlobal();
    bindBoard();
    bindPanel();
    const savedPanel = store('panel');
    if (savedPanel) app.panel = savedPanel === 'none' ? null : savedPanel;
    else if (NARROW) app.panel = null;
    let data;
    try {
      data = ONLINE ? loadEmbedded() : await api('/api/state');
    } catch (e) {
      els.board.innerHTML = ONLINE
        ? '<p style="padding:40px;color:#ffb4ae">Tablo verisi okunamadı.</p>'
        : '<p style="padding:40px;color:#ffb4ae">Uygulama verisi alınamadı. Python uygulamasının (turnuva.py) açık olduğundan emin ol.</p>';
      return;
    }
    app.state = data.state;
    app.state.results = app.state.results || {};
    app.state.title = app.state.title || 'Turnuva';
    const hadWomen = !!(app.state.women && Array.isArray(app.state.women.slots));
    if (hadWomen) ensureWomen(app.state);
    for (const g of L.genders(app.state)) L.normalize(L.viewOf(app.state, g));
    app.everSaved = !!data.saved;
    app.warning = data.warning || null;
    app.rev = Number.isInteger(app.state.rev) ? app.state.rev : 0;
    app.savedCanon = data.saved ? canon(app.state) : null;
    // Kadınlar tablosu kayıtta yoksa şimdi oluşur; kaydedilene kadar "kaydedilmemiş" görünür
    if (!hadWomen) ensureWomen(app.state);
    const savedTab = store('tab');
    app.tab = savedTab === 'K' ? 'K' : 'E';
    els.title.value = curTitle();
    recompute();
    buildBoard();
    const z = parseFloat(store('zoom')) || (NARROW ? 0.8 : 1);
    if (z !== 1) setZoom(z);
    if (ONLINE) {
      setCanEdit(false);
      detectEdit().then((ok) => {
        if (!ok) return;
        const st = stashGet();
        if (st && st.state) {
          if (st.state.savedAt === app.state.savedAt && st.state.rev === app.state.rev) stashSet(null);
          else app.stash = st.state;
        }
        setCanEdit(true);
      });
    } else {
      refresh();
    }
  }

  init();
})();
