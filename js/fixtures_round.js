import { loadData } from './data.js';
import { HOME_ADV, expectedHome } from './elo.js';

async function loadHA() {
  try { return await fetch('data/ratings_home_away.json').then(r => r.json()); }
  catch (e) { return null; }
}

async function loadMatchesHistory() {
  try { return await fetch('data/matches_full.json').then(r => r.json()); }
  catch (e) { return []; }
}

(function normalizeName(s){ return (s||'').trim().toLowerCase(); })();

// Mapeia código de liga do source para nome da liga
function getLeagueFromSource(source) {
  if (!source) return null;
  // Exemplos: F1_2021.csv -> F1 (Premier League), E0_2021.csv -> E0 (Championship), etc
  const match = source.match(/^([A-Z0-9]+)_/);
  return match ? match[1] : null;
}

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

// Calcula a média de ELO dos últimos 5 jogos de um time
function getEloTrend(clubId, isHome, matchesHistory) {
  if (!clubId || !matchesHistory || matchesHistory.length === 0) return null;
  
  // Filtrar os últimos 5 jogos do time (em casa se isHome=true, fora se isHome=false)
  const relevantMatches = matchesHistory
    .filter(m => {
      if (isHome && m.home === clubId) return true;
      if (!isHome && m.away === clubId) return true;
      return false;
    })
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 5);
  
  if (relevantMatches.length === 0) return null;
  
  // Calcular média de ELO pré-jogo
  const avgElo = relevantMatches.reduce((sum, m) => {
    return sum + (isHome ? m.homeEloPre : m.awayEloPre);
  }, 0) / relevantMatches.length;
  
  return {
    avgElo,
    sampleSize: relevantMatches.length
  };
}

// Retorna o indicador visual e cor baseado na comparação de ELO
function getEloIndicator(currentElo, trend) {
  if (!trend) return null;
  
  const diff = currentElo - trend.avgElo;
  
  if (diff >= 20) {
    return { symbol: '▲', color: '#4caf50', title: `+${diff.toFixed(0)} vs média` }; // verde pra cima
  } else if (diff <= -20) {
    return { symbol: '▼', color: '#f44336', title: `${diff.toFixed(0)} vs média` }; // vermelho pra baixo
  } else {
    return { symbol: '●', color: '#ffc107', title: `${diff >= 0 ? '+' : ''}${diff.toFixed(0)} vs média` }; // amarelo
  }
}

// Mapeia nome da liga para código de source
function mapLeagueNameToCode(leagueName) {
  if (!leagueName) return null;
  const name = leagueName.toLowerCase();
  
  const mapping = {
    'premier league': 'E0',
    'championship': 'E1',
    'league one': 'E2',
    'league two': 'E3',
    'la liga': 'SP1',
    'la liga 2': 'SP2',
    'ligue 1': 'F1',
    'ligue 2': 'F2',
    'serie a': 'I1',
    'serie b': 'I2',
    'bundesliga': 'D1',
    'bundesliga 2': 'D2',
    'primeira división argentina': 'AR1',
    'brasileirão série a': 'BR1'
  };
  
  return mapping[name] || null;
}

// Analisa a distribuição de matches no histórico por liga
function analyzeHistoryDistribution(matchesHistory) {
  const distribution = {};
  
  // Contar matches por liga
  matchesHistory.forEach(m => {
    const league = getLeagueFromSource(m.source);
    if (!league) return;
    
    if (!distribution[league]) {
      distribution[league] = {
        total: 0,
        ranges: {} // ranges[ELO_pair] = count
      };
    }
    
    distribution[league].total++;
    
    // Criar identificador de range baseado em pares de ELO
    // Arredondar para range de 100 em 100
    const homeRange = Math.floor(m.homeEloPre / 100) * 100;
    const awayRange = Math.floor(m.awayEloPre / 100) * 100;
    const rangeKey = `${homeRange}-${awayRange}`;
    
    if (!distribution[league].ranges[rangeKey]) {
      distribution[league].ranges[rangeKey] = 0;
    }
    distribution[league].ranges[rangeKey]++;
  });
  
  // Log de distribuição desativado - descomentar para debug detalhado
  // console.log('📊 ========== DISTRIBUIÇÃO DE MATCHES POR LIGA ==========');
  // Object.keys(distribution).sort().forEach(league => { ... });
  
  return distribution;
}

// Calcula confiança baseada no tamanho REAL da amostra encontrada
function calculateConfidence(sampleSize, league, distribution) {
  if (sampleSize === 0) return 5;
  
  // Benchmarks simples baseados no número absoluto de matches encontrados:
  // 1-5 matches = 10% (muito poucos dados)
  // 10 matches = 20%
  // 20 matches = 30%
  // 50 matches = 50%
  // 100 matches = 65%
  // 200+ matches = 80%
  // 400+ matches = 85% (máximo, sempre há incerteza)
  
  let confidence;
  if (sampleSize < 5) {
    confidence = 10 + (sampleSize / 5) * 5; // 10% a 15%
  } else if (sampleSize < 10) {
    confidence = 15 + ((sampleSize - 5) / 5) * 5; // 15% a 20%
  } else if (sampleSize < 20) {
    confidence = 20 + ((sampleSize - 10) / 10) * 10; // 20% a 30%
  } else if (sampleSize < 50) {
    confidence = 30 + ((sampleSize - 20) / 30) * 20; // 30% a 50%
  } else if (sampleSize < 100) {
    confidence = 50 + ((sampleSize - 50) / 50) * 15; // 50% a 65%
  } else if (sampleSize < 200) {
    confidence = 65 + ((sampleSize - 100) / 100) * 15; // 65% a 80%
  } else if (sampleSize < 400) {
    confidence = 80 + ((sampleSize - 200) / 200) * 5; // 80% a 85%
  } else {
    confidence = 85; // Cap em 85%
  }
  
  return Math.max(5, Math.min(85, confidence));
}

// Combinar duas métricas de confiança: sample size (60%) e desvio padrão (40%)
function combineConfidences(sampleSize, league, distribution, stdDevConfidence) {
  const sampleConfidence = calculateConfidence(sampleSize, league, distribution);
  // 60% peso para sample size, 40% para desvio padrão
  const combined = (sampleConfidence * 0.6) + (stdDevConfidence * 0.4);
  return Math.max(5, Math.min(85, combined));
}

// Função auxiliar: Calcular probabilidade de k gols usando Poisson
function poissonProbability(k, lambda) {
  if (lambda === 0) return k === 0 ? 1 : 0;
  return (Math.pow(lambda, k) * Math.exp(-lambda)) / factorial(k);
}

// Função auxiliar: Calcular fatorial
function factorial(n) {
  if (n === 0 || n === 1) return 1;
  let result = 1;
  for (let i = 2; i <= n; i++) result *= i;
  return result;
}

// Função auxiliar: Calcular odds usando Poisson
function calculateOddsWithPoisson(homeMatches, awayMatches) {
  if (homeMatches.length === 0 || awayMatches.length === 0) {
    return null;
  }
  
  // Calcular média e desvio padrão de gols do mandante
  const homeGoalsArray = homeMatches.map(m => m.homeGoals);
  const homeGoalsMean = homeGoalsArray.reduce((a, b) => a + b, 0) / homeGoalsArray.length;
  const homeGoalsVariance = homeGoalsArray.reduce((sum, val) => sum + Math.pow(val - homeGoalsMean, 2), 0) / homeGoalsArray.length;
  const homeGoalsStdDev = Math.sqrt(homeGoalsVariance);
  
  // Calcular média e desvio padrão de gols do visitante
  const awayGoalsArray = awayMatches.map(m => m.awayGoals);
  const awayGoalsMean = awayGoalsArray.reduce((a, b) => a + b, 0) / awayGoalsArray.length;
  const awayGoalsVariance = awayGoalsArray.reduce((sum, val) => sum + Math.pow(val - awayGoalsMean, 2), 0) / awayGoalsArray.length;
  const awayGoalsStdDev = Math.sqrt(awayGoalsVariance);
  
  console.log(`  📊 Poisson: Home=${homeGoalsMean.toFixed(2)}±${homeGoalsStdDev.toFixed(2)} gols, Away=${awayGoalsMean.toFixed(2)}±${awayGoalsStdDev.toFixed(2)} gols`);
  
  // Calcular probabilidades usando Poisson (0 a 5 gols)
  let homeProb = 0, drawProb = 0, awayProb = 0;
  
  for (let homeGoals = 0; homeGoals <= 5; homeGoals++) {
    const homeGoalProb = poissonProbability(homeGoals, homeGoalsMean);
    
    for (let awayGoals = 0; awayGoals <= 5; awayGoals++) {
      const awayGoalProb = poissonProbability(awayGoals, awayGoalsMean);
      const jointProb = homeGoalProb * awayGoalProb;
      
      if (homeGoals > awayGoals) {
        homeProb += jointProb;
      } else if (homeGoals === awayGoals) {
        drawProb += jointProb;
      } else {
        awayProb += jointProb;
      }
    }
  }
  
  // Normalizar para garantir soma = 1
  const totalProb = homeProb + drawProb + awayProb;
  homeProb /= totalProb;
  drawProb /= totalProb;
  awayProb /= totalProb;
  
  // Calcular confiança baseada no desvio padrão (menor desvio = mais confiança)
  const avgStdDev = (homeGoalsStdDev + awayGoalsStdDev) / 2;
  const confidenceFromStdDev = Math.max(5, Math.min(85, 85 - (avgStdDev * 10)));
  
  return {
    homeProb,
    drawProb,
    awayProb,
    homeOdd: homeProb > 0 ? 1 / homeProb : null,
    drawOdd: drawProb > 0 ? 1 / drawProb : null,
    awayOdd: awayProb > 0 ? 1 / awayProb : null,
    sampleSize: homeMatches.length + awayMatches.length,
    stdDevConfidence: confidenceFromStdDev,
    homeGoalsMean,
    awayGoalsMean,
    homeGoalsStdDev,
    awayGoalsStdDev
  };
}

// Calcula odds baseado no histórico específico de cada time (mandante em casa + visitante fora)
function calculateOddsFromTeamHistory(homeClubId, awayClubId, homeEloTarget, awayEloTarget, matchesHistory) {
  let ELO_RANGE = 25;
  let rangeExpanded = false;
  
  // Procurar partidas onde o time mandante jogou em casa com ELO similar
  // CONTRA qualquer visitante com ELO similar
  let homeTeamMatches = matchesHistory.filter(m => {
    if (m.home !== homeClubId) return false;  // Mandante deve ser homeClubId
    return Math.abs(m.homeEloPre - homeEloTarget) <= ELO_RANGE &&  // Mandante no range
           Math.abs(m.awayEloPre - awayEloTarget) <= ELO_RANGE;    // Visitante no range
  });
  
  // Procurar partidas onde o time visitante jogou fora com ELO similar
  // CONTRA qualquer mandante com ELO similar
  let awayTeamMatches = matchesHistory.filter(m => {
    if (m.away !== awayClubId) return false;  // Visitante deve ser awayClubId
    return Math.abs(m.awayEloPre - awayEloTarget) <= ELO_RANGE &&  // Visitante no range
           Math.abs(m.homeEloPre - homeEloTarget) <= ELO_RANGE;    // Mandante no range
  });
  
  // Se não encontrou matches, expandir o range para ±50
  if (homeTeamMatches.length === 0 && awayTeamMatches.length === 0) {
    ELO_RANGE = 50;
    rangeExpanded = '±50';
    
    homeTeamMatches = matchesHistory.filter(m => {
      if (m.home !== homeClubId) return false;
      return Math.abs(m.homeEloPre - homeEloTarget) <= ELO_RANGE &&
             Math.abs(m.awayEloPre - awayEloTarget) <= ELO_RANGE;
    });
    
    awayTeamMatches = matchesHistory.filter(m => {
      if (m.away !== awayClubId) return false;
      return Math.abs(m.awayEloPre - awayEloTarget) <= ELO_RANGE &&
             Math.abs(m.homeEloPre - homeEloTarget) <= ELO_RANGE;
    });
  }
  
  // Se ainda não encontrou matches, expandir para ±100
  if (homeTeamMatches.length === 0 && awayTeamMatches.length === 0) {
    ELO_RANGE = 100;
    rangeExpanded = '±100';
    
    homeTeamMatches = matchesHistory.filter(m => {
      if (m.home !== homeClubId) return false;
      return Math.abs(m.homeEloPre - homeEloTarget) <= ELO_RANGE &&
             Math.abs(m.awayEloPre - awayEloTarget) <= ELO_RANGE;
    });
    
    awayTeamMatches = matchesHistory.filter(m => {
      if (m.away !== awayClubId) return false;
      return Math.abs(m.awayEloPre - awayEloTarget) <= ELO_RANGE &&
             Math.abs(m.homeEloPre - homeEloTarget) <= ELO_RANGE;
    });
  }
  
  // Combinar partidas
  const combinedMatches = [...homeTeamMatches, ...awayTeamMatches];
  
  const rangeIndicator = rangeExpanded ? ` ⚠️ (${rangeExpanded})` : '';
  
  if (combinedMatches.length === 0) {
    return null;
  }
  
  // Usar Poisson para calcular odds
  const result = calculateOddsWithPoisson(homeTeamMatches, awayTeamMatches);
  
  if (result) {
    result.rangeExpanded = rangeExpanded;  // Adicionar indicador
    const rangeUsed = rangeExpanded || '±25';
    console.log(`⚽ Team${rangeIndicator}: ${combinedMatches.length} matches (V=${(result.homeProb*100).toFixed(0)}%, D=${(result.drawProb*100).toFixed(0)}%, A=${(result.awayProb*100).toFixed(0)}%)`);
  }
  
  return result;
}

// Calcula odds baseado no histórico da liga (mandante vs visitante com ELOs similares)
function calculateOddsFromHistory(homeClubId, awayClubId, homeEloTarget, awayEloTarget, homeLeague, matchesHistory, clubs) {
  let ELO_RANGE = 25;
  let rangeExpanded = false;
  
  // Mapear nome da liga para código
  const leagueCode = mapLeagueNameToCode(homeLeague);
  
  // Filtrar MATCHES ESPECÍFICOS onde ambos estão no range NA MESMA PARTIDA
  let similarMatches = matchesHistory.filter(m => {
    const mLeague = getLeagueFromSource(m.source);
    if (mLeague !== leagueCode) return false;
    
    // Mandante no range
    const homeEloMatch = Math.abs(m.homeEloPre - homeEloTarget) <= ELO_RANGE;
    // Visitante no range
    const awayEloMatch = Math.abs(m.awayEloPre - awayEloTarget) <= ELO_RANGE;
    
    return homeEloMatch && awayEloMatch;
  });
  
  // Se não encontrou matches, expandir o range para ±50
  if (similarMatches.length === 0) {
    ELO_RANGE = 50;
    rangeExpanded = '±50';
    
    similarMatches = matchesHistory.filter(m => {
      const mLeague = getLeagueFromSource(m.source);
      if (mLeague !== leagueCode) return false;
      
      const homeEloMatch = Math.abs(m.homeEloPre - homeEloTarget) <= ELO_RANGE;
      const awayEloMatch = Math.abs(m.awayEloPre - awayEloTarget) <= ELO_RANGE;
      
      return homeEloMatch && awayEloMatch;
    });
  }
  
  // Se ainda não encontrou matches, expandir para ±100
  if (similarMatches.length === 0) {
    ELO_RANGE = 100;
    rangeExpanded = '±100';
    
    similarMatches = matchesHistory.filter(m => {
      const mLeague = getLeagueFromSource(m.source);
      if (mLeague !== leagueCode) return false;
      
      const homeEloMatch = Math.abs(m.homeEloPre - homeEloTarget) <= ELO_RANGE;
      const awayEloMatch = Math.abs(m.awayEloPre - awayEloTarget) <= ELO_RANGE;
      
      return homeEloMatch && awayEloMatch;
    });
  }
  
  const rangeIndicator = rangeExpanded ? ` ⚠️ (${rangeExpanded})` : '';
  
  if (similarMatches.length === 0) {
    return null;
  }
  
  // Usar Poisson para calcular odds
  // Para league-wide: usar todos os matches como referência para ambas as equipes
  // A função calculateOddsWithPoisson usa homeGoals de homeMatches e awayGoals de awayMatches
  const result = calculateOddsWithPoisson(similarMatches, similarMatches);
  
  if (result) {
    const rangeUsed = rangeExpanded || '±25';
    console.log(`⚽ Liga${rangeIndicator}: ${similarMatches.length} matches (V=${(result.homeProb*100).toFixed(0)}%, D=${(result.drawProb*100).toFixed(0)}%, A=${(result.awayProb*100).toFixed(0)}%)`);
    result.rangeExpanded = rangeExpanded;  // Adicionar indicador
  }
  
  return result;
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
  const matchesHistory = await loadMatchesHistory();
  
  // Analisar distribuição de matches no histórico
  const distribution = analyzeHistoryDistribution(matchesHistory);
  
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
  // Nova ordem: Data; ELO; Mandante; Visitante; ELO; (3 %); (3 Odd); Conf.
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
    'Odd_A',
    'Conf.'
  ].forEach((h, idx) => {
    const th = document.createElement('th');
    th.textContent = h;
    // Ajusta largura das colunas Mandante e Visitante
    if (idx === 2 || idx === 3) {
      th.style.minWidth = '85px'; // 106 * 0.8
      th.style.width = '94px';    // 117 * 0.8
    } else {
      th.style.minWidth = '28px';
      th.style.width = '35px';
      th.style.maxWidth = '45px';
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

    // Obter liga do clube mandante
    const homeLeague = hClub ? hClub.league : null;
    
    // Calcular probabilidades baseadas no histórico
    let homeProb, drawProb, awayProb;
    let historyResult = null;
    
    if (hClub && aClub && homeLeague && matchesHistory.length > 0) {
      historyResult = calculateOddsFromHistory(
        hClub.id,
        aClub.id,
        homeRating,
        awayRating,
        homeLeague.toLowerCase(),
        matchesHistory,
        clubs
      );
    }
    
    // Se houver histórico, usar os valores calculados; caso contrário, usar cálculo matemático
    let sampleSize = 0;
    if (historyResult) {
      homeProb = historyResult.homeProb;
      drawProb = historyResult.drawProb;
      awayProb = historyResult.awayProb;
      sampleSize = historyResult.sampleSize || 0;
    } else {
      // Fallback: cálculo matemático original
      let expH = expectedHome(homeRating, awayRating);
      const baseDraw = 0.30;
      const drawSlope = 0.00075;
      let diffElo = Math.abs(homeRating - awayRating);
      let drawProbCalc = baseDraw - drawSlope * diffElo;
      if (drawProbCalc < 0.10) drawProbCalc = 0.10;
      if (drawProbCalc > 0.35) drawProbCalc = 0.35;
      homeProb = expH * (1 - drawProbCalc);
      awayProb = (1 - expH) * (1 - drawProbCalc);
      drawProb = drawProbCalc;
      sampleSize = 0;
    }

    // Calcular nível de confiança usando a distribuição real
    const leagueCode = mapLeagueNameToCode(homeLeague);
    let confidenceLevel = calculateConfidence(sampleSize, leagueCode, historyResult);
    
    // Se o resultado veio de Poisson (league-wide), usar confiança combinada
    let stdDevConfidenceLeague = null;
    if (historyResult && historyResult.stdDevConfidence !== undefined) {
      stdDevConfidenceLeague = historyResult.stdDevConfidence;
      confidenceLevel = combineConfidences(sampleSize, leagueCode, historyResult, stdDevConfidenceLeague);
    }
    
    const confidenceText = `${confidenceLevel.toFixed(0)}%`;

    // Calcular odds baseado no histórico específico do time
    let teamHistoryResult = null;
    let teamSampleSize = 0;
    let teamConfidenceLevel = null;
    let confidenceTextTeam = null;
    let leagueRangeExpanded = historyResult ? historyResult.rangeExpanded : false;
    let teamRangeExpanded = false;
    try {
      teamHistoryResult = calculateOddsFromTeamHistory(
        hClub?.id,
        aClub?.id,
        homeRating,
        awayRating,
        matchesHistory
      );
      if (teamHistoryResult) {
        teamSampleSize = teamHistoryResult.sampleSize || 0;
        teamRangeExpanded = teamHistoryResult.rangeExpanded || false;
        // Usar confiança combinada para o método team-specific também
        const stdDevConfidenceTeam = teamHistoryResult.stdDevConfidence || null;
        if (stdDevConfidenceTeam !== null) {
          teamConfidenceLevel = combineConfidences(teamSampleSize, leagueCode, teamHistoryResult, stdDevConfidenceTeam);
        } else {
          teamConfidenceLevel = calculateConfidence(teamSampleSize, leagueCode, teamHistoryResult);
        }
        confidenceTextTeam = `${teamConfidenceLevel.toFixed(0)}%`;
      }
    } catch (e) {
      console.warn('Erro ao calcular odds do histórico do time:', e);
    }

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
    // Data, ELO (mandante), Mandante, Visitante, ELO (visitante), Mandante Odd (1/prob), Empate Odd (1/prob), Visitante Odd (1/prob), Mandante Odd, Empate Odd, Visitante Odd, Confiança
    const homeOddValue = homeProb > 0 ? 1 / homeProb : null;
    const drawOddValue = drawProb > 0 ? 1 / drawProb : null;
    const awayOddValue = awayProb > 0 ? 1 / awayProb : null;

    // Odds baseado no histórico do time
    const teamHomeOddValue = teamHistoryResult && teamHistoryResult.homeProb > 0 ? 1 / teamHistoryResult.homeProb : null;
    const teamDrawOddValue = teamHistoryResult && teamHistoryResult.drawProb > 0 ? 1 / teamHistoryResult.drawProb : null;
    const teamAwayOddValue = teamHistoryResult && teamHistoryResult.awayProb > 0 ? 1 / teamHistoryResult.awayProb : null;
    
    const oddHValue = (f.oddH && !isNaN(parseFloat(f.oddH))) ? parseFloat(f.oddH) : null;
    const oddDValue = (f.oddD && !isNaN(parseFloat(f.oddD))) ? parseFloat(f.oddD) : null;
    const oddAValue = (f.oddA && !isNaN(parseFloat(f.oddA))) ? parseFloat(f.oddA) : null;
    
    // Calcular trend de ELO para mandante e visitante
    let homeEloDisplay = Number(displayHomeElo).toFixed(0);
    let awayEloDisplay = Number(displayAwayElo).toFixed(0);
    
    try {
      const homeTrend = getEloTrend(hClub?.id, true, matchesHistory);
      const awayTrend = getEloTrend(aClub?.id, false, matchesHistory);
      
      const homeIndicator = getEloIndicator(homeRating, homeTrend);
      const awayIndicator = getEloIndicator(awayRating, awayTrend);
      
      // Formatar ELO com indicador
      if (homeIndicator) {
        homeEloDisplay = `${homeEloDisplay} <span style="color:${homeIndicator.color};font-size:12px;margin-left:4px;" title="${homeIndicator.title}">${homeIndicator.symbol}</span>`;
      }
      
      if (awayIndicator) {
        awayEloDisplay = `${awayEloDisplay} <span style="color:${awayIndicator.color};font-size:12px;margin-left:4px;" title="${awayIndicator.title}">${awayIndicator.symbol}</span>`;
      }
    } catch (e) {
      console.warn('Erro ao calcular trend de ELO:', e);
    }

    // Formatar odds com dois valores (liga + time), cada um com sua própria cor
    const formatOddsWithTeamHistory = (leagueValue, leagueColor, leagueRangeExpanded, teamValue, teamColor, teamRangeExpanded) => {
      // Sempre mostra duas linhas, mesmo que teamValue seja null
      const teamDisplay = teamValue !== null ? teamValue : '—';
      
      // Adicionar indicador de range expandido se necessário
      const leagueIndicator = leagueRangeExpanded ? ' ⚠️' : '';
      const teamIndicator = teamRangeExpanded ? ' ⚠️' : '';
      
      return `<div style="font-size:11px;line-height:1.4;"><span style="background-color:${leagueColor};padding:2px 4px;border-radius:2px;display:block;">${leagueValue}${leagueIndicator}</span><span style="opacity:0.7;font-size:10px;background-color:${teamColor};padding:2px 4px;border-radius:2px;display:block;margin-top:2px;">${teamDisplay}${teamIndicator}</span></div>`;
    };

    // Calcular cores para cada odd (liga vs aposta, time vs aposta)
    const homeLeagueColor = getBackgroundColor(homeOddValue, oddHValue);
    const homeTeamColor = teamHomeOddValue ? getBackgroundColor(teamHomeOddValue, oddHValue) : homeLeagueColor;
    
    const drawLeagueColor = getBackgroundColor(drawOddValue, oddDValue);
    const drawTeamColor = teamDrawOddValue ? getBackgroundColor(teamDrawOddValue, oddDValue) : drawLeagueColor;
    
    const awayLeagueColor = getBackgroundColor(awayOddValue, oddAValue);
    const awayTeamColor = teamAwayOddValue ? getBackgroundColor(teamAwayOddValue, oddAValue) : awayLeagueColor;

    const homeOddsDisplay = formatOddsWithTeamHistory(
      homeOddValue ? homeOddValue.toFixed(2) : '—',
      homeLeagueColor,
      leagueRangeExpanded,
      teamHomeOddValue ? teamHomeOddValue.toFixed(2) : null,
      homeTeamColor,
      teamRangeExpanded
    );

    const drawOddsDisplay = formatOddsWithTeamHistory(
      drawOddValue ? drawOddValue.toFixed(2) : '—',
      drawLeagueColor,
      leagueRangeExpanded,
      teamDrawOddValue ? teamDrawOddValue.toFixed(2) : null,
      drawTeamColor,
      teamRangeExpanded
    );

    const awayOddsDisplay = formatOddsWithTeamHistory(
      awayOddValue ? awayOddValue.toFixed(2) : '—',
      awayLeagueColor,
      leagueRangeExpanded,
      teamAwayOddValue ? teamAwayOddValue.toFixed(2) : null,
      awayTeamColor,
      teamRangeExpanded
    );
    
    // Formatar confiança com dois valores (liga + time)
    const formatConfidenceWithTeamHistory = (leagueValue, teamValue) => {
      const teamDisplay = teamValue !== null ? teamValue : '—';
      return `<div style="font-size:11px;line-height:1.4;"><span style="padding:2px 4px;border-radius:2px;display:block;">${leagueValue}</span><span style="opacity:0.7;font-size:10px;padding:2px 4px;border-radius:2px;display:block;margin-top:2px;">${teamDisplay}</span></div>`;
    };

    const confidenceDisplay = formatConfidenceWithTeamHistory(
      confidenceText,
      confidenceTextTeam
    );

    const rowData = [
      displayDate, // Data
      homeEloDisplay, // ELO mandante com indicador
      homeLink, // Mandante
      awayLink, // Visitante
      awayEloDisplay, // ELO visitante com indicador
      homeOddsDisplay, // H% (1/prob) - com odds do time
      drawOddsDisplay, // D% (1/prob) - com odds do time
      awayOddsDisplay, // A% (1/prob) - com odds do time
      oddHValue ? oddHValue.toFixed(2) : '—', // Odd_H (B365H)
      oddDValue ? oddDValue.toFixed(2) : '—', // Odd_D (B365D)
      oddAValue ? oddAValue.toFixed(2) : '—', // Odd_A (B365A)
      confidenceDisplay // Confiança (liga + time)
    ];
    
    // Função para determinar cor de fundo
    function getBackgroundColor(probValue, oddValue) {
      if (!probValue || !oddValue) return 'transparent';
      if (oddValue > probValue * 1.10) return '#c8e6c9'; // verde claro
      if (oddValue > probValue) return '#fff9c4'; // amarelo claro
      return '#ffcdd2'; // vermelho claro
    }
    
    rowData.forEach((text, idx) => {
      const td = document.createElement('td');
      if (idx === 2) td.appendChild(homeLink);
      else if (idx === 3) td.appendChild(awayLink);
      else {
        // Se o texto contém HTML (indicador de trend ou odds com dois valores), usar innerHTML
        if (typeof text === 'string' && (text.includes('<span') || text.includes('<div'))) {
          td.innerHTML = text;
        } else {
          td.textContent = text;
        }
      }
      
      // Aplicar cores nas comparações: H% vs Odd_H, D% vs Odd_D, A% vs Odd_A
      // Nota: As cores agora estão inline no HTML de cada valor, não na célula inteira
      if (idx === 11) { // Confiança
        // Colorir baseado no nível de confiança
        if (confidenceLevel >= 80) {
          td.style.backgroundColor = '#c8e6c9'; // verde - alta confiança
        } else if (confidenceLevel >= 50) {
          td.style.backgroundColor = '#fff9c4'; // amarelo - média confiança
        } else if (confidenceLevel > 0) {
          td.style.backgroundColor = '#ffcdd2'; // vermelho - baixa confiança
        }
      }
      
      // Ajusta largura das colunas Mandante e Visitante
      if (idx === 2 || idx === 3) {
        td.style.minWidth = '85px'; // 106 * 0.8
        td.style.width = '94px';    // 117 * 0.8
        td.style.whiteSpace = 'nowrap';
      } else {
        td.style.minWidth = '28px';
        td.style.width = '35px';
        td.style.maxWidth = '45px';
        td.style.textAlign = 'center';
      }
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  root.appendChild(table);
})();
