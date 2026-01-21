// js/loadPremierLeague.js
export async function loadPremierLeagueMatches(clubs = []) {
  // Códigos das ligas e temporadas presentes em data/
  const leagueCodes = ['E0','E1','SP1','SP2','I1','I2','F1','F2','D1','D2'];
  const seasons = ['2425','2526'];

  const urls = [];
  for (const code of leagueCodes) {
    for (const s of seasons) {
      urls.push(`data/${code}_${s}.csv`);
    }
  }

  const nameToId = {};
  (clubs || []).forEach(c => { if (c && c.name) nameToId[c.name] = c.id; });

  const normalize = n => n ? n.replace(/\./g, '').replace(/\'/g, '').normalize('NFD').replace(/\p{Diacritic}/gu, '').trim().toLowerCase() : '';

  const findIdByName = (name) => {
    if (!name) return null;
    // direct exact match
    if (nameToId[name]) return nameToId[name];
    // case-insensitive exact
    const low = name.toLowerCase();
    const exactKey = Object.keys(nameToId).find(k => k && k.toLowerCase() === low);
    if (exactKey) return nameToId[exactKey];
    // normalized match (remove punctuation/diacritics)
    const nrm = normalize(name);
    const normKey = Object.keys(nameToId).find(k => normalize(k) === nrm);
    if (normKey) return nameToId[normKey];
    return null;
  };

  const allMatches = [];

  for (const url of urls) {
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const text = await res.text();

      const lines = text.trim().split('\n');
      if (lines.length < 2) continue;
      const headers = lines[0].split(',').map(h => h.trim());

      const dateIdx = headers.indexOf('Date');
      const homeIdx = headers.indexOf('HomeTeam');
      const awayIdx = headers.indexOf('AwayTeam');
      const fthgIdx = headers.indexOf('FTHG');
      const ftagIdx = headers.indexOf('FTAG');

      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(',');
        if (cols.length <= Math.max(dateIdx, homeIdx, awayIdx, fthgIdx, ftagIdx)) continue;

        const homeName = cols[homeIdx]?.trim();
        const awayName = cols[awayIdx]?.trim();

        const hid = findIdByName(homeName);
        const aid = findIdByName(awayName);

        const homeGoals = parseInt(cols[fthgIdx], 10);
        const awayGoals = parseInt(cols[ftagIdx], 10);

        // se não encontrou id, ignorar registro (evita misturar strings e ids)
        if (!hid || !aid) {
          // console.warn(`Club not found for match: ${homeName} vs ${awayName} in ${url}`);
          continue;
        }

        allMatches.push({
          date: cols[dateIdx],
          home: hid,
          away: aid,
          homeGoals: isNaN(homeGoals) ? 0 : homeGoals,
          awayGoals: isNaN(awayGoals) ? 0 : awayGoals
        });
      }
    } catch (e) {
      // falha ao buscar/parsear um csv; apenas continuar com os outros
      // console.error('Failed to load', url, e);
      continue;
    }
  }

  return allMatches;
}
