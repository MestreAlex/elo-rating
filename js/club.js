import { loadData, getClubById } from './data.js';

async function init() {
  try {
    const { clubs, matches, ratings } = await loadData();

    const input = document.getElementById('club-input');
    const datalist = document.getElementById('clubs-list');

    if (!input || !datalist) {
      console.error('club input or datalist not found');
      return;
    }

    datalist.innerHTML = '';
    clubs.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.name;
      datalist.appendChild(opt);
    });

    // populate visible fallback select so users see the list clearly
    const fallback = document.getElementById('club-select-fallback');
    if (fallback) {
      fallback.innerHTML = '';
      const def = document.createElement('option');
      def.value = '';
      def.textContent = '— Escolha um clube —';
      def.selected = true;
      def.disabled = true;
      fallback.appendChild(def);
      clubs.forEach(c => {
        const o = document.createElement('option');
        o.value = String(c.id);
        o.textContent = `${c.name} (${c.league || '—'})`;
        fallback.appendChild(o);
      });
      fallback.addEventListener('change', (e) => {
        const id = parseInt(e.target.value, 10);
        if (!isNaN(id)) renderClub(id);
      });
    }

    let chart = null;

    function findClubByName(name) {
      if (!name) return null;
      const n = name.trim().toLowerCase();
      let club = clubs.find(c => c.name.toLowerCase() === n);
      if (club) return club;
      club = clubs.find(c => c.name.toLowerCase().includes(n));
      if (club) return club;
      club = clubs.find(c => c.name.toLowerCase().startsWith(n));
      return club || null;
    }

    function renderClubByName(name) {
      const club = findClubByName(name);
      if (!club) {
        alert('Clube não encontrado. Digite ou selecione o nome completo.');
        return;
      }
      renderClub(club.id);
    }

    function renderClub(clubId) {
      const club = getClubById(clubs, clubId);
      if (!club) return;

      const recent = matches
        .filter(m => m.home === clubId || m.away === clubId)
        .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0))
        .slice(0, 8);

      const list = document.getElementById('recent-matches');
      list.innerHTML = '';
      if (recent.length === 0) {
        const li = document.createElement('li');
        li.textContent = 'Sem partidas recentes.';
        list.appendChild(li);
      } else {
        recent.forEach(m => {
          const home = getClubById(clubs, m.home)?.name || 'Unknown';
          const away = getClubById(clubs, m.away)?.name || 'Unknown';
          const li = document.createElement('li');
          li.textContent = `${m.date || m.date_raw || ''}: ${home} ${m.homeGoals ?? 0}–${m.awayGoals ?? 0} ${away}`;
          list.appendChild(li);
        });
      }

      // ELO jogo a jogo
      const clubMatches = matches
        .filter(m => m.home === clubId || m.away === clubId)
        .map(m => ({
          ...m,
          _dateObj: m.date ? new Date(m.date) : (m.date_raw ? new Date(m.date_raw) : null)
        }))
        .filter(m => m._dateObj)
        .sort((a, b) => a._dateObj - b._dateObj);

      const labels = clubMatches.map(m => {
        const d = m._dateObj;
        return d ? `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` : '';
      });
      const series = clubMatches.map(m => {
        if (m.home === clubId && typeof m.homeEloPost !== 'undefined') return m.homeEloPost;
        if (m.away === clubId && typeof m.awayEloPost !== 'undefined') return m.awayEloPost;
        return null;
      });

      const canvas = document.getElementById('elo-chart');
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (chart) chart.destroy();
      chart = new Chart(ctx, {
        type: 'line',
        data: {
          labels,
          datasets: [{
            label: `ELO — ${club.name}`,
            data: series,
            borderColor: 'var(--accent)',
            backgroundColor: 'rgba(11,110,79,0.08)',
            tension: 0.2
          }]
        },
        options: {
          responsive: true,
          scales: { y: { beginAtZero: false } },
          plugins: {
            tooltip: {
              callbacks: {
                title: (items) => {
                  const idx = items[0].dataIndex;
                  const m = clubMatches[idx];
                  if (!m) return '';
                  const home = getClubById(clubs, m.home)?.name || '-';
                  const away = getClubById(clubs, m.away)?.name || '-';
                  return `${home} ${m.homeGoals}–${m.awayGoals} ${away}`;
                }
              }
            }
          }
        }
      });

      // upcoming
      const upcomingList = document.getElementById('upcoming-matches');
      upcomingList.innerHTML = '';
      const upcoming = matches
        .filter(m => (m.home === clubId || m.away === clubId) && !(new Date(m.date || 0) < new Date()))
        .slice(0, 3);
      if (upcoming.length === 0) {
        const li = document.createElement('li');
        li.textContent = 'Sem jogos futuros no histórico.';
        upcomingList.appendChild(li);
      } else {
        upcoming.forEach(m => {
          const home = getClubById(clubs, m.home)?.name || 'Unknown';
          const away = getClubById(clubs, m.away)?.name || 'Unknown';
          const li = document.createElement('li');
          li.textContent = `Previsto: ${home} vs ${away}`;
          upcomingList.appendChild(li);
        });
      }

      // set input to canonical name
      input.value = club.name;
    }

    input.addEventListener('change', (e) => renderClubByName(e.target.value));
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); renderClubByName(e.target.value); } });

    // optional: auto-select first club to help UX
    if (clubs && clubs.length > 0) {
      // don't force user, but prefill input suggestions
      // input.value = clubs[0].name;
    }
  } catch (err) {
    console.error('Erro ao inicializar club page:', err);
    const msg = document.createElement('div');
    msg.textContent = 'Erro ao carregar dados. Veja o console para detalhes.';
    msg.style.color = 'var(--muted)';
    document.getElementById('recent-matches').appendChild(msg);
  }
}

init();
