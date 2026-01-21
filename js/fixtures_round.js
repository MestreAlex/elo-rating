import { loadData } from './data.js';
import { HOME_ADV, expectedHome } from './elo.js';

async function loadHA() {
  try { return await fetch('data/ratings_home_away.json').then(r => r.json()); }
  catch (e) { return null; }
}

(function normalizeName(s){ return (s||'').trim().toLowerCase(); })();

function findClubByName(clubs, name) {
  if (!name) return null;
  const n = name.trim().toLowerCase();
  let club = clubs.find(c => c.name.toLowerCase() === n);
  if (club) return club;
  club = clubs.find(c => c.name.toLowerCase().includes(n));
  if (club) return club;
  club = clubs.find(c => c.name.toLowerCase().startsWith(n));
  return club || null;
}

async function loadExternalFixtures() {
  const endpoints = ['http://localhost:5000/fixtures','https://www.football-data.co.uk/fixtures.csv','data/fixtures.csv'];
  for (const url of endpoints) {
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const text = await res.text();
      const lines = text.split('\n').filter(Boolean);
      if (lines.length < 2) continue;
      const headers = lines[0].split(',').map(h => h.trim());
      const hIdx = headers.indexOf('HomeTeam');
      const aIdx = headers.indexOf('AwayTeam');
      const dIdx = headers.indexOf('Date');
      const oddHIdx = headers.indexOf('B365H');
      const oddDIdx = headers.indexOf('B365D');
      const oddAIdx = headers.indexOf('B365A');
      const fixtures = [];
      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(',');
        const home = cols[hIdx]?.trim();
        const away = cols[aIdx]?.trim();
        const date = cols[dIdx]?.trim();
        const oddH = oddHIdx >= 0 ? cols[oddHIdx]?.trim() : null;
        const oddD = oddDIdx >= 0 ? cols[oddDIdx]?.trim() : null;
        const oddA = oddAIdx >= 0 ? cols[oddAIdx]?.trim() : null;
        if (home && away) fixtures.push({ home, away, date, oddH, oddD, oddA });
      }
      if (fixtures.length) return fixtures;
    } catch (e) { continue; }
  }
  return [];
}

(async function init(){
  const { clubs, matches, ratings, leagues } = await loadData();
  const ha = await loadHA();
  const root = document.getElementById('fixtures-root');
  root.innerHTML = '';

  const fixtures = await loadExternalFixtures();
  // filter to clubs present and leagues present
  const leagueNames = new Set((leagues||[]).map(l=> (l.name||'').toLowerCase()));
  const filtered = fixtures.filter(f => {
    const h = findClubByName(clubs, f.home);
    const a = findClubByName(clubs, f.away);
    if (!h || !a) return false;
    const hl = (h.league||'').toLowerCase();
    const al = (a.league||'').toLowerCase();
    return leagueNames.has(hl) && leagueNames.has(al);
  });
  const toShow = filtered.length ? filtered : fixtures;

  // helper: parse CSV date strings (tries ISO, dd/mm/yyyy, mm/dd/yyyy)
  function parseCsvDate(s) {
    if (!s) return null;
    // try native parse first
    let d = new Date(s);
    if (!isNaN(d)) return d;
    // try dd/mm/yyyy or dd/mm/yy or d/m/yy
    const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
    if (m) {
      let day = parseInt(m[1],10), month = parseInt(m[2],10)-1, year = parseInt(m[3],10);
      if (year < 100) year += (year > 50 ? 1900 : 2000);
      d = new Date(year, month, day);
      if (!isNaN(d)) return d;
    }
    // try mm/dd/yyyy
    const m2 = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
    if (m2) {
      // interpret as mm/dd if previous failed (already same format as m but try swapped)
      let month = parseInt(m2[1],10)-1, day = parseInt(m2[2],10), year = parseInt(m2[3],10);
      if (year < 100) year += (year > 50 ? 1900 : 2000);
      d = new Date(year, month, day);
      if (!isNaN(d)) return d;
    }
    return null;
  }

  // sort fixtures by date ascending (unknown dates go last)
  toShow.sort((a,b) => {
    const da = parseCsvDate(a.date); const db = parseCsvDate(b.date);
    if (da && db) return da - db;
    if (da && !db) return -1;
    if (!da && db) return 1;
    return 0;
  });

  const table = document.createElement('table');
  table.className = 'fixtures-table';

  const thead = document.createElement('thead');
  const hr = document.createElement('tr');
  // Nova ordem: Data; ELO; Mandante; Visitante; ELO; (3 %); (3 Odd)
  [
    'Data',
    'ELO',
    'Mandante',
    'Visitante',
    'ELO',
    'H%',
    'D%',
    'A%',
    'Odd_H',
    'Odd_D',
    'Odd_A'
  ].forEach((h, idx) => {
    const th = document.createElement('th');
    th.textContent = h;
    // Ajusta largura das colunas Mandante e Visitante
    if (idx === 2 || idx === 3) {
      th.style.minWidth = '132px'; // 146 - 10%
      th.style.width = '146px';    // 162 - 10%
    } else {
      th.style.minWidth = '40px';
      th.style.width = '55px';
      th.style.maxWidth = '70px';
    }
    hr.appendChild(th);
  });
  thead.appendChild(hr);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  const mode = 'home-away';
  toShow.slice(0,200).forEach(f => {
    const hClub = findClubByName(clubs, f.home);
    const aClub = findClubByName(clubs, f.away);
    const homeName = hClub ? hClub.name : f.home;
    const awayName = aClub ? aClub.name : f.away;
    const parsed = parseCsvDate(f.date);
    let displayDate = '';
    if (parsed) {
      const d = parsed;
      const day = String(d.getDate()).padStart(2, '0');
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const year = String(d.getFullYear()).slice(-2);
      displayDate = `${day}/${month}/${year}`;
    } else {
      displayDate = f.date || '';
    }

    let homeRating, awayRating, displayHomeElo, displayAwayElo;
    if (mode === 'home-away' && ha) {
      const homeId = hClub && hClub.id;
      const awayId = aClub && aClub.id;
      const homeObj = ha.find(h => h.clubId === homeId) || { homeElo: 1800 };
      const awayObj = ha.find(h => h.clubId === awayId) || { awayElo: 1800 };
      homeRating = homeObj.homeElo ?? 1800;
      awayRating = awayObj.awayElo ?? 1800;
      displayHomeElo = homeRating;
      displayAwayElo = awayRating;
    } else {
      const homeId = hClub && hClub.id;
      const awayId = aClub && aClub.id;
      const homeR = ratings.find(r => r.clubId === homeId);
      const awayR = ratings.find(r => r.clubId === awayId);
      homeRating = (homeR && homeR.elo) || 1800;
      awayRating = (awayR && awayR.elo) || 1800;
      displayHomeElo = homeRating + HOME_ADV;
      displayAwayElo = awayRating;
    }

    let expH = expectedHome(homeRating, awayRating);
    // Probabilidade de empate dinâmica baseada na diferença de ELO
    const baseDraw = 0.30; // valor base para empate
    const drawSlope = 0.00075; // quanto maior a diferença de ELO, menor a chance de empate
    let diffElo = Math.abs(homeRating - awayRating);
    let drawProb = baseDraw - drawSlope * diffElo;
    if (drawProb < 0.10) drawProb = 0.10; // mínimo 10%
    if (drawProb > 0.35) drawProb = 0.35; // máximo 35%
    const homeProb = expH * (1 - drawProb);
    const awayProb = (1 - expH) * (1 - drawProb);
    const safe = x => (x && x > 0) ? (1 / x) : null;

    const tr = document.createElement('tr');
    // Cria links nos nomes dos clubes para predictions.html
    const homeLink = document.createElement('a');
    homeLink.href = `predictions.html?home=${encodeURIComponent(homeName)}&away=${encodeURIComponent(awayName)}`;
    homeLink.textContent = homeName;
    homeLink.style.cursor = 'pointer';
    const awayLink = document.createElement('a');
    awayLink.href = `predictions.html?home=${encodeURIComponent(homeName)}&away=${encodeURIComponent(awayName)}`;
    awayLink.textContent = awayName;
    awayLink.style.cursor = 'pointer';

    // Nova ordem dos dados:
    // Data, ELO (mandante), Mandante, Visitante, ELO (visitante), Mandante %, Empate %, Visitante %, Mandante Odd, Empate Odd, Visitante Odd
    const rowData = [
      displayDate, // Data
      Number(displayHomeElo).toFixed(0), // ELO mandante
      homeLink, // Mandante
      awayLink, // Visitante
      Number(displayAwayElo).toFixed(0), // ELO visitante
      (homeProb*100).toFixed(1)+'%', // H%
      (drawProb*100).toFixed(1)+'%', // D%
      (awayProb*100).toFixed(1)+'%', // A%
      (f.oddH && !isNaN(parseFloat(f.oddH))) ? parseFloat(f.oddH).toFixed(2) : '—', // Odd_H (B365H)
      (f.oddD && !isNaN(parseFloat(f.oddD))) ? parseFloat(f.oddD).toFixed(2) : '—', // Odd_D (B365D)
      (f.oddA && !isNaN(parseFloat(f.oddA))) ? parseFloat(f.oddA).toFixed(2) : '—'  // Odd_A (B365A)
    ];
    rowData.forEach((text, idx) => {
      const td = document.createElement('td');
      if (idx === 2) td.appendChild(homeLink);
      else if (idx === 3) td.appendChild(awayLink);
      else td.textContent = text;
      // Ajusta largura das colunas Mandante e Visitante
      if (idx === 2 || idx === 3) {
        td.style.minWidth = '132px'; // 146 - 10%
        td.style.width = '146px';    // 162 - 10%
        td.style.whiteSpace = 'nowrap';
      } else {
        td.style.minWidth = '40px';
        td.style.width = '55px';
        td.style.maxWidth = '70px';
        td.style.textAlign = 'center';
      }
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  root.appendChild(table);
})();
