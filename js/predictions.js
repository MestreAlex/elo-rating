import { loadData, getClubById } from './data.js';
import { HOME_ADV, expectedHome } from './elo.js';

async function loadHA() {
  try {
    return await fetch('data/ratings_home_away.json').then(r => r.json());
  } catch (e) {
    return null;
  }
// ...

let clubs = [];
let matches = [];
let ratings = [];
let leagues = [];
let ha = null;
let homeSelect, awaySelect, modeSel;

async function init() {
  ({ clubs, matches, ratings, leagues } = await loadData());
  ha = await loadHA();
  homeSelect = document.getElementById('home-select');
  awaySelect = document.getElementById('away-select');
  modeSel = document.getElementById('rating-mode');

  function getQueryParam(name) {
    const url = new URL(window.location.href);
    return url.searchParams.get(name);
  }
  const homeParam = getQueryParam('home');
  const awayParam = getQueryParam('away');

  function findClosestClubId(param) {
    if (!param) return '';
    const n = param.trim().toLowerCase();
    let club = clubs.find(c => c.name.toLowerCase() === n);
    if (club) return club.id;
    club = clubs.find(c => c.name.toLowerCase().includes(n));
    if (club) return club.id;
    club = clubs.find(c => n.split(' ').every(word => c.name.toLowerCase().includes(word)));
    if (club) return club.id;
    return '';
  }

  function fillSelect(select, selectedId) {
    select.innerHTML = '';
    const def = document.createElement('option');
    def.value = '';
    def.textContent = '— Escolha um clube —';
    def.disabled = true;
    def.selected = !selectedId;
    select.appendChild(def);
    clubs.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = c.name;
      if (selectedId && String(c.id) === String(selectedId)) opt.selected = true;
      select.appendChild(opt);
    });
  }

  fillSelect(homeSelect, findClosestClubId(homeParam));
  fillSelect(awaySelect, findClosestClubId(awayParam));

  // ...restante do código (updateAll, etc)...
  // (deixe o restante do código como está, pois agora as variáveis são globais)
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startPredictions);
} else {
  startPredictions();
}

  function findClubById(id) {
    return clubs.find(c => String(c.id) === String(id));
  }

  function findClubByName(name) {
    if (!name) return null;
    const n = name.trim().toLowerCase();
    // exact match
    let club = clubs.find(c => c.name.toLowerCase() === n);
    if (club) return club;
    // case-insensitive contains
    club = clubs.find(c => c.name.toLowerCase().includes(n));
    if (club) return club;
    // startsWith
    club = clubs.find(c => c.name.toLowerCase().startsWith(n));
    return club || null;
  }

  function updateAll() {
    const homeId = homeSelect.value;
    const awayId = awaySelect.value;
    const homeClub = findClubById(homeId);
    const awayClub = findClubById(awayId);

    // Renderizar histórico de confrontos sempre
    function renderH2HTables(mode) {
      const LIMIT = 10;
      const FIVE_YEARS_AGO = new Date();
      FIVE_YEARS_AGO.setFullYear(FIVE_YEARS_AGO.getFullYear() - 5);
      function parseDate(d) {
        if (!d) return null;
        const dt = new Date(d);
        if (!isNaN(dt)) return dt;
        const m = d.match(/(\d{4})-(\d{2})-(\d{2})/);
        if (m) return new Date(m[1], m[2]-1, m[3]);
        const m2 = d.match(/(\d{2})\/(\d{2})\/(\d{4})/);
        if (m2) return new Date(m2[3], m2[2]-1, m2[1]);
        return null;
      }
      // Jogos da mandante em casa
      let homeGames = homeId ? matches.filter(m => m.home === homeId) : [];
      // Jogos da visitante fora
      let awayGames = awayId ? matches.filter(m => m.away === awayId) : [];
      // Confrontos diretos
      let directGames = (homeId && awayId) ? matches.filter(m => (m.home === homeId && m.away === awayId) || (m.home === awayId && m.away === homeId)) : [];
      homeGames = homeGames.filter(m => { const dt = parseDate(m.date); return dt && dt >= FIVE_YEARS_AGO; });
      awayGames = awayGames.filter(m => { const dt = parseDate(m.date); return dt && dt >= FIVE_YEARS_AGO; });
      directGames = directGames.filter(m => { const dt = parseDate(m.date); return dt && dt >= FIVE_YEARS_AGO; });
      homeGames.sort((a,b) => parseDate(b.date) - parseDate(a.date));
      awayGames.sort((a,b) => parseDate(b.date) - parseDate(a.date));
      directGames.sort((a,b) => parseDate(b.date) - parseDate(a.date));
      homeGames = homeGames.slice(0, LIMIT);
      awayGames = awayGames.slice(0, LIMIT);
      directGames = directGames.slice(0, LIMIT);
      let directHomeGames = directGames.filter(m => m.home === homeId && m.away === awayId);
      let directAwayGames = directGames.filter(m => m.home === awayId && m.away === homeId);
      if (mode === 'homeaway') {
        directGames = [...directHomeGames, ...directAwayGames];
      }
      function buildTable(games, highlightHome, highlightAway) {
        if (!games.length) return '<tr><td colspan="5">Nenhum jogo encontrado</td></tr>';
        return games.map(m => {
          const home = getClubById(clubs, m.home)?.name || '-';
          const away = getClubById(clubs, m.away)?.name || '-';
          const date = m.date || '-';
          const score = `${m.homeGoals}–${m.awayGoals}`;
          return `<tr><td>${date}</td><td${highlightHome && m.home === homeId ? ' style="font-weight:bold;"' : ''}>${home}</td><td>${score}</td><td${highlightAway && m.away === awayId ? ' style="font-weight:bold;"' : ''}>${away}</td></tr>`;
        }).join('');
      }
      document.getElementById('h2h-home-table').innerHTML = `<thead><tr><th>Data</th><th>Mandante</th><th>Placar</th><th>Visitante</th></tr></thead><tbody>${buildTable(homeGames, true, false)}</tbody>`;
      document.getElementById('h2h-away-table').innerHTML = `<thead><tr><th>Data</th><th>Mandante</th><th>Placar</th><th>Visitante</th></tr></thead><tbody>${buildTable(awayGames, false, true)}</tbody>`;
      document.getElementById('h2h-direct-table').innerHTML = `<thead><tr><th>Data</th><th>Mandante</th><th>Placar</th><th>Visitante</th></tr></thead><tbody>${buildTable(directGames, true, true)}</tbody>`;
    }
    // Sempre renderizar histórico
    const h2hModeSel = document.getElementById('h2h-mode');
    if (h2hModeSel) {
      renderH2HTables(h2hModeSel.value);
      h2hModeSel.addEventListener('change', e => {
        renderH2HTables(e.target.value);
      });
    }

    // Se não houver clubes válidos, não renderiza resultado
    if (!homeClub || !awayClub || homeId === awayId) {
      document.getElementById('elo-adjusted').textContent = '';
      document.getElementById('probabilities').textContent = '';
      document.getElementById('odds').textContent = '';
      document.getElementById('likely-score').textContent = '';
      document.getElementById('sample-size').textContent = '';
      return;
    }

    // ...restante do cálculo de resultado...

  // Atualizar ao clicar no botão
  document.getElementById('predict-btn').addEventListener('click', updateAll);
  homeSelect.addEventListener('change', updateAll);
  awaySelect.addEventListener('change', updateAll);
  modeSel.addEventListener('change', updateAll);

  // Atualizar ao carregar a página se já houver clubes
  updateAll();

  // load upcoming fixtures from external CSV
  async function loadExternalFixtures() {
    const endpoints = [
      'http://localhost:5000/fixtures',
      'https://www.football-data.co.uk/fixtures.csv',
      'data/fixtures.csv'
    ];
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
        const fixtures = [];
        for (let i = 1; i < lines.length; i++) {
          const cols = lines[i].split(',');
          const home = cols[hIdx]?.trim();
          const away = cols[aIdx]?.trim();
          const date = cols[dIdx]?.trim();
          if (home && away) fixtures.push({ home, away, date });
        }
        if (fixtures.length) return fixtures;
      } catch (e) {
        // try next endpoint
        continue;
      }
    }
    return [];
  }

  const fixturesListEl = document.getElementById('fixtures-list');
  if (fixturesListEl) {
    loadExternalFixtures().then(fixtures => {
      fixturesListEl.innerHTML = '';
      // filter fixtures to leagues present in system
      const leagueNames = new Set((leagues || []).map(l => (l.name || '').toLowerCase()));
      const filtered = fixtures.filter(f => {
        const homeClub = findClubByName(f.home);
        const awayClub = findClubByName(f.away);
        if (!homeClub || !awayClub) return false;
        const homeLeague = (homeClub.league || '').toLowerCase();
        const awayLeague = (awayClub.league || '').toLowerCase();
        // include only if both clubs' leagues are known in leagues.json
        return leagueNames.has(homeLeague) && leagueNames.has(awayLeague);
      });
      const toShow = filtered.length ? filtered : fixtures; // fallback to full list if filter removes all

      // Build a table showing Date | Home | Home ELO | Home% | Home Odd | Draw% | Draw Odd | Away% | Away Odd | Away ELO | Away
      const mode = modeSel.value;
      const table = document.createElement('table');
      table.style.width = '100%';
      table.style.borderCollapse = 'collapse';
      table.style.tableLayout = 'fixed';
      table.className = 'fixtures-table';

      const thead = document.createElement('thead');
      const headRow = document.createElement('tr');
      ['Data','Mandante','ELO','%','Odd','Empate %','Odd','%','Odd','ELO','Visitante'].forEach(h => {
        const th = document.createElement('th');
        th.textContent = h;
        th.style.textAlign = 'center';
        th.style.padding = '6px';
        headRow.appendChild(th);
      });
      thead.appendChild(headRow);
      table.appendChild(thead);

      const tbody = document.createElement('tbody');
      toShow.slice(0, 50).forEach(f => {
        const homeClub = findClubByName(f.home);
        const awayClub = findClubByName(f.away);
        const homeName = homeClub ? homeClub.name : f.home;
        const awayName = awayClub ? awayClub.name : f.away;

        // determine ratings used for probabilities
        let homeRating, awayRating, displayHomeElo, displayAwayElo;
        if (mode === 'home-away' && ha) {
          const homeObj = ha.find(h => h.clubId === (homeClub?.id)) || { homeElo: 1800 };
          const awayObj = ha.find(h => h.clubId === (awayClub?.id)) || { awayElo: 1800 };
          homeRating = homeObj.homeElo ?? 1800;
          awayRating = awayObj.awayElo ?? 1800;
          displayHomeElo = homeRating;
          displayAwayElo = awayRating;
        } else if (mode === 'neutral') {
          homeRating = ratings.find(r => r.clubId === (homeClub?.id))?.elo ?? 1800;
          awayRating = ratings.find(r => r.clubId === (awayClub?.id))?.elo ?? 1800;
          displayHomeElo = homeRating;
          displayAwayElo = awayRating;
        } else {
          homeRating = ratings.find(r => r.clubId === (homeClub?.id))?.elo ?? 1800;
          awayRating = ratings.find(r => r.clubId === (awayClub?.id))?.elo ?? 1800;
          displayHomeElo = homeRating + HOME_ADV;
          displayAwayElo = awayRating;
        }

        // expected probability for home (0..1)
        let expH = expectedHome(homeRating, awayRating);
        // convert to three-way with fixed draw probability (20%) and scale others
        const drawProb = 0.20;
        const homeProb = expH * (1 - drawProb);
        const awayProb = (1 - expH) * (1 - drawProb);

        const safe = x => (x && x > 0) ? (1 / x) : null;
        const oddHome = safe(homeProb);
        const oddDraw = safe(drawProb);
        const oddAway = safe(awayProb);

        const tr = document.createElement('tr');
        [f.date || '',
         homeName,
         Number(displayHomeElo).toFixed(0),
         (homeProb*100).toFixed(1)+'%',
         (oddHome?oddHome.toFixed(2):'—'),
         (drawProb*100).toFixed(1)+'%',
         (oddDraw?oddDraw.toFixed(2):'—'),
         (awayProb*100).toFixed(1)+'%',
         (oddAway?oddAway.toFixed(2):'—'),
         Number(displayAwayElo).toFixed(0),
         awayName
        ].forEach(text => {
          const td = document.createElement('td');
          td.textContent = text;
          td.style.textAlign = 'center';
          td.style.padding = '6px';
          td.style.borderBottom = '1px solid #eee';
          // make names clickable to fill selects
          if (text === homeName) td.style.cursor = 'pointer';
          if (text === awayName) td.style.cursor = 'pointer';
          td.addEventListener('click', () => {
            // preencher selects ao clicar nos nomes
            if (text === homeName) {
              const club = clubs.find(c => c.name === homeName);
              if (club) homeSelect.value = club.id;
              homeSelect.dispatchEvent(new Event('change'));
            }
            if (text === awayName) {
              const club = clubs.find(c => c.name === awayName);
              if (club) awaySelect.value = club.id;
              awaySelect.dispatchEvent(new Event('change'));
            }
          });
          tr.appendChild(td);
        });

        tbody.appendChild(tr);
      });

      table.appendChild(tbody);
      fixturesListEl.appendChild(table);
     });
   }
})();
