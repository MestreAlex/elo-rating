export async function loadData() {
  const clubs = await fetch('data/clubs.json').then(r => r.json());

  const [leagues, matches, ratings] = await Promise.all([
    fetch('data/leagues.json').then(r => r.json()),
    fetch('data/matches_full.json').then(r => r.json()),
    fetch('data/ratings.json').then(r => r.json())
  ]);

  return { clubs, leagues, matches, ratings };
}

export function getClubById(clubs, id) {
  return clubs.find(c => c.id === id);
}
