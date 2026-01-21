export const K = 35;
export const HOME_ADV = 100;

export function expectedHome(homeElo, awayElo) {
  const homeAdj = homeElo + HOME_ADV;
  return 1 / (1 + Math.pow(10, -((homeAdj - awayElo) / 400)));
}

export function marginMultiplier(diff) {
  if (diff <= 1) return 1;
  if (diff === 2) return 1.5;
  return (11 + diff) / 8;
}

export function updateElo(homePre, awayPre, homeGoals, awayGoals) {
  const expHome = expectedHome(homePre, awayPre);
  const expAway = 1 - expHome;

  const sHome = homeGoals > awayGoals ? 1 : (homeGoals === awayGoals ? 0.5 : 0);
  const sAway = 1 - sHome;

  const diff = Math.abs(homeGoals - awayGoals);
  const M = marginMultiplier(diff);

  const homeDelta = K * M * (sHome - expHome);
  const awayDelta = K * M * (sAway - expAway);

  return {
    homeNew: homePre + homeDelta,
    awayNew: awayPre + awayDelta,
    homeDelta,
    awayDelta
  };
}
