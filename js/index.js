import { loadData } from './data.js';

async function renderTop10() {
  const { clubs, ratings } = await loadData();
  const top = [...ratings].sort((a, b) => b.elo - a.elo).slice(0, 10);
  const list = document.getElementById('top10-list');
  list.innerHTML = '';
  top.forEach((r, idx) => {
    const club = clubs.find(c => c.id === r.clubId) || { name: 'Unknown' };
    const li = document.createElement('li');
    li.className = 'card';
    li.style.display = 'flex';
    li.style.justifyContent = 'space-between';
    li.style.alignItems = 'center';
    li.style.padding = '.6rem';

    const left = document.createElement('div');
    left.style.display = 'flex';
    left.style.alignItems = 'center';
    left.style.gap = '.75rem';

    const badge = document.createElement('div');
    badge.className = 'rank-badge';
    badge.textContent = idx + 1;

    const name = document.createElement('div');
    name.innerHTML = `<div class="club-name">${club.name}</div><div style="font-size:.85rem;color:var(--muted)">${club.league || ''}</div>`;

    left.appendChild(badge);
    left.appendChild(name);

    const right = document.createElement('div');
    right.innerHTML = `<div style="font-weight:700">${r.elo}</div>`;

    li.appendChild(left);
    li.appendChild(right);
    list.appendChild(li);
  });
}

renderTop10();
