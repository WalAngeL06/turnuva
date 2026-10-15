/* Turnuva tablosu mantığı: arayüzden bağımsız, saf fonksiyonlar.
 * Tarayıcıda window.TL olarak, Node'da require() ile kullanılır.
 *
 * Durum (state):
 *   participants: [{id, name, phone, gender: 'E'|'K', check}]
 *   slots:        erkekler tablosunun 1. turdaki yerleri (uzunluk 2'nin kuvveti), oyuncu id'si veya null (= BAY)
 *   results:      erkekler tablosunun sonuçları (aşağıdaki biçimde)
 *   women:        { title, slots, results } — kadınlar tablosu (16 kişilik), aynı biçimde
 *
 * Tablo fonksiyonları bir "görünüm" üzerinde çalışır: { participants, slots, results, gender }.
 * viewOf(state, 'E' | 'K') bu görünümü verir; slots/results durumun kendi dizi/nesneleridir,
 * yani görünümde yapılan değişiklik doğrudan duruma yansır.
 *   results:      { 'R<tur>-<maç>' | '3RD': { players: [id, id], winner: id, auto: bool,
 *                                            scores: { id: '3' } } }
 *                 players: sonucun hangi eşleşmeye ait olduğu (eşleşme değişirse sonuç geçersiz olur)
 *                 auto:    kazanan skorlardan otomatik çıkarıldı (skor silinince kazanan da silinir)
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TL = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const THIRD = '3RD';
  const PENDING = Object.freeze({ type: 'pending' });
  const BYE = Object.freeze({ type: 'bye' });
  const player = (id) => ({ type: 'player', id });

  const matchId = (r, m) => `R${r}-${m}`;
  const roundCount = (size) => Math.round(Math.log2(size));

  function roundName(r, R) {
    const fromEnd = R - 1 - r;
    if (fromEnd === 0) return 'Final';
    if (fromEnd === 1) return 'Yarı Final';
    if (fromEnd === 2) return 'Çeyrek Final';
    if (fromEnd === 3) return 'Son 16';
    if (fromEnd === 4) return 'Son 32';
    return `${r + 1}. Tur`;
  }

  function clone(state) {
    return JSON.parse(JSON.stringify(state));
  }

  function participantMap(state) {
    const map = new Map();
    for (const p of state.participants) map.set(p.id, p);
    return map;
  }

  function slotSide(id) {
    return id ? player(id) : BYE;
  }

  /* Sonuç bu iki oyuncunun maçına mı ait? (Eski kayıtlarda players yoksa kabul edilir.) */
  function samePair(res, a, b) {
    const p = res && res.players;
    if (!Array.isArray(p)) return true;
    return p.length === 2 && ((p[0] === a && p[1] === b) || (p[0] === b && p[1] === a));
  }

  const isNum = (v) => v != null && String(v).trim() !== '' && !isNaN(Number(v));

  /* Bir maçın iki tarafına ve kayıtlı sonucuna bakarak kazananı belirler. */
  function resolveMatch(id, a, b, res) {
    const match = { id, sides: [a, b], winner: PENDING, loser: PENDING,
      playable: false, auto: false, result: null };
    if (a.type === 'player' && b.type === 'player') {
      match.playable = true;
      if (res && samePair(res, a.id, b.id) && (res.winner === a.id || res.winner === b.id)) {
        match.result = res;
        match.winner = res.winner === a.id ? a : b;
        match.loser = res.winner === a.id ? b : a;
      }
    } else if (a.type === 'bye' && b.type === 'bye') {
      match.winner = BYE; match.loser = BYE; match.auto = true;
    } else if (a.type === 'player' && b.type === 'bye') {
      match.winner = a; match.loser = BYE; match.auto = true;
    } else if (a.type === 'bye' && b.type === 'player') {
      match.winner = b; match.loser = BYE; match.auto = true;
    }
    return match;
  }

  /* Tüm tabloyu hesaplar: her turun maçları, kazananlar, 3.lük maçı ve derece. */
  function computeBracket(state) {
    const size = state.slots.length;
    const R = roundCount(size);
    const results = state.results || {};
    const rounds = [];
    for (let r = 0; r < R; r++) {
      const n = size >> (r + 1);
      const list = [];
      for (let m = 0; m < n; m++) {
        let a, b;
        if (r === 0) {
          a = slotSide(state.slots[2 * m]);
          b = slotSide(state.slots[2 * m + 1]);
        } else {
          a = rounds[r - 1][2 * m].winner;
          b = rounds[r - 1][2 * m + 1].winner;
        }
        const id = matchId(r, m);
        const match = resolveMatch(id, a, b, results[id]);
        match.r = r; match.m = m;
        list.push(match);
      }
      rounds.push(list);
    }
    let third = null;
    if (R >= 2) {
      const semis = rounds[R - 2];
      third = resolveMatch(THIRD, semis[0].loser, semis[1].loser, results[THIRD]);
      third.r = R - 1; third.m = 1; third.isThird = true;
    }
    const final = rounds[R - 1][0];
    const pid = (s) => (s && s.type === 'player' ? s.id : null);
    const podium = {
      first: pid(final.winner),
      second: pid(final.loser),
      third: third ? pid(third.winner) : null,
      fourth: third ? pid(third.loser) : null,
    };
    const byId = new Map();
    for (const list of rounds) for (const mt of list) byId.set(mt.id, mt);
    if (third) byId.set(THIRD, third);
    return { size, R, rounds, third, final, podium, byId };
  }

  /* Geçersiz hale gelen sonuçları (artık o maçta olmayan oyuncu vb.) temizler.
   * Silinen sonuç sayısını döndürür. */
  function normalize(state) {
    if (!state.results) state.results = {};
    const br = computeBracket(state);
    let removed = 0;
    for (const key of Object.keys(state.results)) {
      const mt = br.byId.get(key);
      const res = state.results[key];
      if (!mt || !mt.playable || !samePair(res, mt.sides[0].id, mt.sides[1].id)) {
        delete state.results[key]; removed++; continue;
      }
      const ids = [mt.sides[0].id, mt.sides[1].id];
      if (res.scores) {
        for (const k of Object.keys(res.scores)) {
          if (!ids.includes(k) || res.scores[k] === '' || res.scores[k] == null) delete res.scores[k];
        }
        if (!Object.keys(res.scores).length) delete res.scores;
      }
      if (res.winner && !ids.includes(res.winner)) {
        delete state.results[key]; removed++; continue;
      }
      if (!res.winner && !res.scores) { delete state.results[key]; continue; }
    }
    return removed;
  }

  /* Kazananı seçer; aynı oyuncuya tekrar basılırsa sonucu siler. */
  function toggleWinner(state, mid, pid) {
    const br = computeBracket(state);
    const mt = br.byId.get(mid);
    if (!mt || !mt.playable) return false;
    if (mt.sides[0].id !== pid && mt.sides[1].id !== pid) return false;
    const [a, b] = [mt.sides[0].id, mt.sides[1].id];
    const res = state.results[mid];
    if (res && res.winner === pid) {
      delete state.results[mid];
    } else {
      const next = { players: [a, b], winner: pid };
      // Skorlar yeni kazananla çelişmiyorsa korunur (ör. 3-1 iken kaybedene tıklanırsa silinir)
      const sc = res && res.scores;
      const other = pid === a ? b : a;
      if (sc && !(isNum(sc[pid]) && isNum(sc[other]) && Number(sc[pid]) < Number(sc[other]))) {
        next.scores = Object.assign({}, sc);
      }
      state.results[mid] = next;
    }
    normalize(state);
    return true;
  }

  function clearResult(state, mid) {
    if (!state.results[mid]) return false;
    delete state.results[mid];
    normalize(state);
    return true;
  }

  /* Skor girer. İki skor da sayıysa ve farklıysa kazananı otomatik belirler. */
  function setScore(state, mid, pid, value) {
    const br = computeBracket(state);
    const mt = br.byId.get(mid);
    if (!mt || !mt.playable) return false;
    const ids = [mt.sides[0].id, mt.sides[1].id];
    if (!ids.includes(pid)) return false;
    const v = String(value == null ? '' : value).trim().slice(0, 6);
    const prev = state.results[mid];
    const res = Object.assign({}, prev && samePair(prev, ids[0], ids[1]) ? prev : {});
    res.players = ids.slice();
    res.scores = Object.assign({}, res.scores || {});
    if (v === '') delete res.scores[pid];
    else res.scores[pid] = v;
    const [a, b] = ids;
    if (isNum(res.scores[a]) && isNum(res.scores[b]) && Number(res.scores[a]) !== Number(res.scores[b])) {
      res.winner = Number(res.scores[a]) > Number(res.scores[b]) ? a : b;
      res.auto = true;
    } else if (res.auto) {
      // Kazananı skorlar belirlemişti; skorlar artık bir kazanan göstermiyor
      delete res.winner;
      delete res.auto;
    }
    if (!Object.keys(res.scores).length) delete res.scores;
    if (!res.winner && !res.scores) delete state.results[mid];
    else state.results[mid] = res;
    normalize(state);
    return true;
  }

  /* Bir cinsiyetin tablosu için görünüm (erkekler: üst düzey slots/results, kadınlar: women). */
  function viewOf(state, gender) {
    if (gender === 'K') {
      const w = state.women;
      if (!w.results) w.results = {};
      return { participants: state.participants, slots: w.slots, results: w.results, gender: 'K' };
    }
    if (!state.results) state.results = {};
    return { participants: state.participants, slots: state.slots, results: state.results, gender: 'E' };
  }

  /* Durumdaki tabloların cinsiyetleri (kadınlar tablosu henüz yoksa sadece erkekler). */
  function genders(state) {
    return state.women ? ['E', 'K'] : ['E'];
  }

  function slotOf(state, pid) {
    return state.slots.indexOf(pid);
  }

  function swapSlots(state, i, j) {
    if (i === j || i < 0 || j < 0 || i >= state.slots.length || j >= state.slots.length) return 0;
    const t = state.slots[i];
    state.slots[i] = state.slots[j];
    state.slots[j] = t;
    return normalize(state);
  }

  /* Oyuncuyu i. yere koyar. Oyuncu zaten tablodaysa yer değiştirir,
   * değilse o yerdeki oyuncu tablo dışına çıkar. */
  function placeInSlot(state, pid, i) {
    const cur = slotOf(state, pid);
    if (cur === i) return 0;
    if (cur >= 0) return swapSlots(state, cur, i);
    state.slots[i] = pid;
    return normalize(state);
  }

  function removeFromBracket(state, pid) {
    const i = slotOf(state, pid);
    if (i < 0) return 0;
    state.slots[i] = null;
    return normalize(state);
  }

  /* Tablonun cinsiyetinden olup tabloda yeri olmayan kişiler. */
  function unplaced(view) {
    const g = view.gender || 'E';
    const placed = new Set(view.slots.filter(Boolean));
    return view.participants.filter((p) => p.gender === g && !placed.has(p.id));
  }
  const unplacedMales = unplaced;

  /* Tablo dışındaki kişileri boş (BAY) yerlere rastgele yerleştirir. Önce
   * BAY-BAY maçlarının birer tarafı doldurulur (böylece BAY-BAY maçı kalmaz),
   * sonra rakibi oyuncu olan BAY yerleri, en son BAY-BAY maçlarının diğer tarafı. */
  function fillByes(state, rng) {
    rng = rng || Math.random;
    const waiting = unplaced(state).map((p) => p.id);
    const shuffle = (arr) => {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr;
    };
    shuffle(waiting);
    const doublePairs = [];
    const partnerFilled = [];
    for (let m = 0; m < state.slots.length / 2; m++) {
      const a = state.slots[2 * m];
      const b = state.slots[2 * m + 1];
      if (!a && !b) doublePairs.push(m);
      else if (!a) partnerFilled.push(2 * m);
      else if (!b) partnerFilled.push(2 * m + 1);
    }
    shuffle(doublePairs);
    shuffle(partnerFilled);
    const firsts = [];
    const seconds = [];
    for (const m of doublePairs) {
      const side = rng() < 0.5 ? 0 : 1;
      firsts.push(2 * m + side);
      seconds.push(2 * m + 1 - side);
    }
    let placed = 0;
    for (const i of firsts.concat(partnerFilled, seconds)) {
      if (!waiting.length) break;
      if (state.slots[i]) continue;
      state.slots[i] = waiting.pop();
      placed++;
    }
    normalize(state);
    return placed;
  }

  /* turnuva.py'deki kura_cek'in aynısı (çevrimiçi sürümde Python sunucusu yok):
   * oyuncuları karıştırır, BAY'ları her maçta en fazla bir tane olacak şekilde
   * tabloya eşit yayar. { slots, reserves } döndürür. */
  function drawSlots(ids, size, rng) {
    rng = rng || Math.random;
    const randrange = (lo, hi) => lo + Math.floor(rng() * (hi - lo));
    const list = Array.from(new Set(ids));
    for (let i = list.length - 1; i > 0; i--) {
      const j = randrange(0, i + 1);
      [list[i], list[j]] = [list[j], list[i]];
    }
    const placed = list.slice(0, size);
    const reserves = list.slice(size);
    const matches = size / 2;
    const count = new Array(matches).fill(0);
    let left = size - placed.length;
    while (left > 0) {
      const free = [];
      for (let m = 0; m < matches; m++) if (count[m] < 2) free.push(m);
      const n = Math.min(left, matches, free.length);
      if (!n) break;
      for (let i = 0; i < n; i++) {
        const lo = Math.floor((i * free.length) / n);
        const hi = Math.floor(((i + 1) * free.length) / n);
        count[free[randrange(lo, hi)]]++;
      }
      left -= n;
    }
    const slots = new Array(size).fill(null);
    let k = 0;
    for (let m = 0; m < matches; m++) {
      if (count[m] === 0) { slots[2 * m] = placed[k++]; slots[2 * m + 1] = placed[k++]; }
      else if (count[m] === 1) slots[2 * m + randrange(0, 2)] = placed[k++];
    }
    return { slots, reserves };
  }

  /* Cinsiyeti değiştirir (tam durum üzerinde); kişi diğer cinsiyetin tablosundan çıkar
   * ve kendi cinsiyetinin "Tablo dışında" listesine düşer. */
  function setGender(state, pid, gender) {
    const p = state.participants.find((x) => x.id === pid);
    if (!p) return 0;
    p.gender = gender;
    p.check = false;
    let removed = 0;
    for (const g of genders(state)) if (g !== gender) removed += removeFromBracket(viewOf(state, g), pid);
    return removed;
  }

  function rename(state, pid, name) {
    const p = state.participants.find((x) => x.id === pid);
    const clean = String(name || '').replace(/\s+/g, ' ').trim().slice(0, 120);
    if (!p || !clean) return false;
    p.name = clean;
    return true;
  }

  function trKey(s) {
    return String(s || '').replace(/İ/g, 'i').replace(/I/g, 'ı').toLocaleLowerCase('tr')
      .replace(/\s+/g, ' ').trim();
  }

  function newId(state) {
    const used = new Set(state.participants.map((p) => p.id));
    let n = state.participants.length + 1;
    while (used.has('p' + String(n).padStart(3, '0'))) n++;
    return 'p' + String(n).padStart(3, '0');
  }

  function addParticipant(state, name, gender, phone) {
    const clean = String(name || '').replace(/\s+/g, ' ').trim().slice(0, 120);
    if (!clean) return null;
    const p = { id: newId(state), name: clean, phone: phone || '', gender: gender || 'E', check: false };
    state.participants.push(p);
    return p;
  }

  /* Kişiyi siler (tam durum üzerinde, iki tablodan da); CSV'den tekrar içe aktarılmasın
   * diye adını/telefonunu hatırlar. */
  function deleteParticipant(state, pid) {
    const p = state.participants.find((x) => x.id === pid);
    let removed = 0;
    for (const g of genders(state)) removed += removeFromBracket(viewOf(state, g), pid);
    state.participants = state.participants.filter((x) => x.id !== pid);
    if (p) {
      if (!Array.isArray(state.deleted)) state.deleted = [];
      state.deleted.push({ name: p.name, src: p.src || '', phone: p.phone || '' });
    }
    return removed;
  }

  /* Bir oyuncunun turnuvadaki durumu: son maçı, elendiği tur, derecesi. */
  function playerStatus(br, pid) {
    let last = null;
    let eliminatedIn = null;
    for (const list of br.rounds) {
      for (const mt of list) {
        if (mt.sides.some((s) => s.id === pid)) {
          last = mt;
          if (mt.loser.id === pid) eliminatedIn = mt.r;
        }
      }
    }
    if (br.third && br.third.sides.some((s) => s.id === pid)) last = br.third;
    let place = null;
    if (br.podium.first === pid) place = 1;
    else if (br.podium.second === pid) place = 2;
    else if (br.podium.third === pid) place = 3;
    else if (br.podium.fourth === pid) place = 4;
    return { last, eliminatedIn, place };
  }

  /* Toplam maç sayısı: her gerçek maç bir oyuncuyu eler (BAY kimseyi elemez),
   * yani tablodaki oyuncu sayısı - 1; dört çeyrek bloğun her birinde en az bir
   * oyuncu varsa 3.lük maçı da oynanır. */
  function stats(state, br) {
    const males = state.participants.filter((p) => p.gender === 'E').length;
    const females = state.participants.length - males;
    const placed = state.slots.filter(Boolean).length;
    const size = state.slots.length;
    let total = Math.max(placed - 1, 0);
    if (br.third && size >= 4) {
      const q = size / 4;
      let all4 = true;
      for (let k = 0; k < 4; k++) if (!state.slots.slice(k * q, (k + 1) * q).some(Boolean)) all4 = false;
      if (all4) total += 1;
    }
    let done = 0;
    const all = br.rounds.flat().concat(br.third ? [br.third] : []);
    for (const mt of all) if (mt.playable && mt.result) done++;
    return { males, females, placed, byes: state.slots.length - placed,
      unplaced: unplaced(state).length, total, done };
  }

  return {
    THIRD, PENDING, BYE, matchId, roundCount, roundName, clone, participantMap,
    computeBracket, normalize, toggleWinner, clearResult, setScore, swapSlots,
    placeInSlot, removeFromBracket, unplacedMales, fillByes, setGender, rename,
    addParticipant, deleteParticipant, playerStatus, stats, slotOf, trKey, drawSlots,
    viewOf, genders, unplaced,
  };
});
