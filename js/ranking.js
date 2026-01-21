import { loadData } from './data.js';

(async function init() {
  const { clubs, leagues, ratings } = await loadData();

  const leagueSelect = document.getElementById('league-filter');
  leagues.forEach(l => {
    const opt = document.createElement('option');
    opt.value = l.name;
    opt.textContent = l.name;
    leagueSelect.appendChild(opt);
  });

  const continentSelect = document.getElementById('continent-filter');

  function renderTable() {
    const tbody = document.querySelector('#ranking-table tbody');
    tbody.innerHTML = '';
    const leagueVal = leagueSelect.value;
    const continentVal = continentSelect.value;

    const rows = ratings
      .map(r => {
        const club = clubs.find(c => c.id === r.clubId) || { name: 'Unknown', league: '' };
        return { club, elo: r.elo, delta: 0 };
      })
      .filter(row => (leagueVal ? row.club.league === leagueVal : true))
      .filter(row => (continentVal ? row.club.continent === continentVal : true))
      .sort((a, b) => b.elo - a.elo);

    rows.forEach((row, idx) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><div class="rank-badge">${idx + 1}</div></td>
        <td><div class="club-name">${row.club.name}</div><div style="font-size:.85rem;color:var(--muted)">${row.club.league || ''}</div></td>
        <td>${row.club.league || ''}</td>
        <td style="font-weight:700">${Math.round(row.elo)}</td>
        <td>${row.delta > 0 ? '▲' : (row.delta < 0 ? '▼' : '•')} ${row.delta}</td>
      `;
      tbody.appendChild(tr);
    });
  }

  leagueSelect.addEventListener('change', renderTable);
  continentSelect.addEventListener('change', renderTable);

  renderTable();
})();
