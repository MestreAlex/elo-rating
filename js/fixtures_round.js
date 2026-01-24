import { loadData } from './data.js';
import { HOME_ADV, expectedHome } from './elo.js';

let CURRENT_MARKET_RANGE = 0.05; // Range de porcentagem para odds de mercado (padrão 5% = 0.05)
let CURRENT_ELO_RANGE = 50; // Range de ELO para filtrar partidas similares (padrão 50)

const normalizeName = (s) => (s || '').trim().toLowerCase();

async function loadHA() {
  try { return await fetch('data/ratings_home_away.json').then(r => r.json()); }
  catch (e) { return null; }
}

async function loadMatchesHistory() {
  try { return await fetch('data/matches_full.json').then(r => r.json()); }
  catch (e) { return []; }
}

// Mapeia código de liga do source para nome da liga
function getLeagueFromSource(source) {
  if (!source) return null;
  const upper = String(source).trim().toUpperCase();
  const csvMatch = upper.match(/^([A-Z0-9]+)\.CSV$/);
  if (csvMatch) return csvMatch[1];
  const prefixMatch = upper.match(/^([A-Z0-9]+)[_\-]/);
  if (prefixMatch) return prefixMatch[1];
  return upper || null;
}

// Busca clube pelo nome (case-insensitive)
function findClubByName(clubs, name) {
  if (!clubs || !name) return null;
  const target = normalizeName(name);
  return clubs.find(c => normalizeName(c.name) === target) || null;
}

// Extrai país da liga (última parte entre parênteses ou nome completo)
function extractCountryFromLeague(leagueName) {
  if (!leagueName) return null;
  // Se tem parênteses, extrai o que está dentro
  const match = leagueName.match(/\(([^)]+)\)$/);
  if (match) return match[1];
  // Senão, retorna o nome completo (remove sufixo de números)
  return leagueName.replace(/\s*\d+\s*$/, '').trim();
}
// Métricas gerais de custo/valor de gol por liga (limitadas ao range de ELO atual)
function calculateGeneralGoalMetrics(matchesHistory, leagueCode, homeEloTarget, awayEloTarget) {
  if (!matchesHistory || !leagueCode) return null;
  const leagueMatches = matchesHistory.filter(m => {
    const code = getLeagueFromSource(m.source);
    if (!code || code !== leagueCode) return false;
    if (homeEloTarget === undefined || awayEloTarget === undefined) return true;
    return Math.abs(m.homeEloPre - homeEloTarget) <= CURRENT_ELO_RANGE &&
           Math.abs(m.awayEloPre - awayEloTarget) <= CURRENT_ELO_RANGE;
  });
  if (leagueMatches.length === 0) return null;

  let totalHomeCost = 0, totalHomeCostCount = 0;
  let totalHomeValue = 0, totalHomeValueCount = 0;
  let totalAwayCost = 0, totalAwayCostCount = 0;
  let totalAwayValue = 0, totalAwayValueCount = 0;

  leagueMatches.forEach(m => {
    if (m.homeGoalCost !== undefined && m.homeGoalCost !== null) {
      totalHomeCost += Number(m.homeGoalCost);
      totalHomeCostCount++;
    }
    if (m.homeGoalValue !== undefined && m.homeGoalValue !== null) {
      totalHomeValue += Number(m.homeGoalValue);
      totalHomeValueCount++;
    }
    if (m.awayGoalCost !== undefined && m.awayGoalCost !== null) {
      totalAwayCost += Number(m.awayGoalCost);
      totalAwayCostCount++;
    }
    if (m.awayGoalValue !== undefined && m.awayGoalValue !== null) {
      totalAwayValue += Number(m.awayGoalValue);
      totalAwayValueCount++;
    }
  });

  return {
    avgHomeCost: totalHomeCostCount > 0 ? totalHomeCost / totalHomeCostCount : null,
    avgHomeValue: totalHomeValueCount > 0 ? totalHomeValue / totalHomeValueCount : null,
    avgAwayCost: totalAwayCostCount > 0 ? totalAwayCost / totalAwayCostCount : null,
    avgAwayValue: totalAwayValueCount > 0 ? totalAwayValue / totalAwayValueCount : null
  };
}

// Métricas específicas do time (home/away) com fallback de range
function calculateTeamGoalMetrics(teamId, isHome, matchesHistory, homeEloTarget, awayEloTarget) {
  if (!teamId || !matchesHistory) return null;
  const filterByRange = (range) => matchesHistory.filter(m => {
    const isTeamMatch = isHome ? m.home === teamId : m.away === teamId;
    if (!isTeamMatch) return false;
    return Math.abs(m.homeEloPre - homeEloTarget) <= range &&
           Math.abs(m.awayEloPre - awayEloTarget) <= range;
  });

  let filtered = filterByRange(CURRENT_ELO_RANGE);
  if (!filtered.length) filtered = filterByRange(50);
  if (!filtered.length) filtered = filterByRange(100);
  if (!filtered.length) return null;

  const sums = filtered.reduce((acc, m) => {
    const cost = isHome ? m.homeGoalCost : m.awayGoalCost;
    const value = isHome ? m.homeGoalValue : m.awayGoalValue;
    if (cost !== undefined && cost !== null) {
      acc.costTotal += Number(cost);
      acc.costCount++;
    }
    if (value !== undefined && value !== null) {
      acc.valueTotal += Number(value);
      acc.valueCount++;
    }
    return acc;
  }, { costTotal: 0, costCount: 0, valueTotal: 0, valueCount: 0 });

  return {
    avgGoalCost: sums.costCount > 0 ? sums.costTotal / sums.costCount : null,
    avgGoalValue: sums.valueCount > 0 ? sums.valueTotal / sums.valueCount : null
  };
}

// Tendência simples de ELO (média das últimas variações)
function getEloTrend(clubId, isHome, matchesHistory) {
  if (!clubId || !matchesHistory || !matchesHistory.length) return null;
  const recent = matchesHistory
    .filter(m => isHome ? m.home === clubId : m.away === clubId)
    .slice(-5);
  if (!recent.length) return null;

  const deltas = recent
    .map(m => {
      const pre = isHome ? m.homeEloPre : m.awayEloPre;
      const post = isHome ? (m.homeEloPost ?? m.homeEloPre) : (m.awayEloPost ?? m.awayEloPre);
      if (pre === undefined || post === undefined) return null;
      return Number(post) - Number(pre);
    })
    .filter(v => v !== null && Number.isFinite(v));
  if (!deltas.length) return null;
  return deltas.reduce((a, b) => a + b, 0) / deltas.length;
}

function getEloIndicator(currentElo, trend) {
  if (trend === null || trend === undefined || Number.isNaN(trend)) return null;
  const threshold = 5;
  if (trend > threshold) return { symbol: '▲', color: '#2e7d32', title: 'ELO em alta' };
  if (trend < -threshold) return { symbol: '▼', color: '#c62828', title: 'ELO em queda' };
  return { symbol: '●', color: '#f9a825', title: 'ELO estável' };
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
    'jupiler league': 'B1',
    'eredivisie': 'N1',
    'primeira liga': 'P1',
    'scottish premiership': 'SC0',
    'super league': 'G1',
    'futbol ligi 1': 'T1',
    'liga mx': 'MEX',
    'liga i': 'ROU',
    'torneo de la liga profesional': 'ARG',
    'super league (switzerland)': 'SWZ',
    'bundesliga (austria)': 'AUT',
    'série a (brazil)': 'BRA',
    'serie a (brazil)': 'BRA',
    'super league (china)': 'CHN',
    'superligaen': 'DNK',
    'veikkausliiga': 'FIN',
    'j-league': 'JPN',
    'eliteserien': 'NOR',
    'ekstraklasa': 'POL',
    'premier league (russia)': 'RUS',
    'allsvenskan': 'SWE',
    'mls': 'USA'
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
  
  // Benchmarks corrigidos: MAIS matches = MAIS confiança
  // 0 matches = 5% (sem base histórica)
  // 1-3 matches = 15-25% (base ínfima)
  // 5-10 matches = 25-45% (base limitada)
  // 10-50 matches = 45-65% (base razoável)
  // 50-100 matches = 65-75% (base sólida)
  // 100-300 matches = 75-83% (base muito sólida)
  // 300+ matches = 83% (teto, sempre há incerteza)
  
  let confidence;
  if (sampleSize === 0) {
    confidence = 5;
  } else if (sampleSize < 3) {
    confidence = 15 + (sampleSize / 3) * 10; // 15% a 25%
  } else if (sampleSize < 10) {
    confidence = 25 + ((sampleSize - 3) / 7) * 20; // 25% a 45%
  } else if (sampleSize < 50) {
    confidence = 45 + ((sampleSize - 10) / 40) * 20; // 45% a 65%
  } else if (sampleSize < 100) {
    confidence = 65 + ((sampleSize - 50) / 50) * 10; // 65% a 75%
  } else if (sampleSize < 300) {
    confidence = 75 + ((sampleSize - 100) / 200) * 8; // 75% a 83%
  } else {
    confidence = 83; // teto de confiança
  }
  
  return Math.max(5, Math.min(85, confidence));
}

// Combinar duas métricas de confiança: sample size (70%) e desvio padrão (30%)
// Sample size domina: mais dados = mais confiança; desvio padrão apenas ajusta finamente
function combineConfidences(sampleSize, league, distribution, stdDevConfidence) {
  const sampleConfidence = calculateConfidence(sampleSize, league, distribution);
  const combined = (sampleConfidence * 0.7) + (stdDevConfidence * 0.3);
  return Math.max(5, Math.min(83, combined));
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
function calculateOddsFromTeamHistory(homeClubId, awayClubId, homeEloTarget, awayEloTarget, leagueCode, matchesHistory) {
  let ELO_RANGE = CURRENT_ELO_RANGE;
  let rangeExpanded = false;
  console.log(`🔍 Team Specific: Home=${homeClubId} Away=${awayClubId} | ELO Target: H=${homeEloTarget} A=${awayEloTarget} | Range: ±${ELO_RANGE}`);
  
  // Procurar partidas onde o time mandante jogou em casa com ELO similar
  // CONTRA qualquer visitante com ELO similar
  let homeTeamMatches = matchesHistory.filter(m => {
    if (m.home !== homeClubId) return false;  // Mandante deve ser homeClubId
    const mLeagueCode = getLeagueFromSource(m.source);
    if (!mLeagueCode || !leagueCode || mLeagueCode !== leagueCode) return false; // Mesma liga
    return Math.abs(m.homeEloPre - homeEloTarget) <= ELO_RANGE &&  // Mandante no range
           Math.abs(m.awayEloPre - awayEloTarget) <= ELO_RANGE;    // Visitante no range
  });
  
  // Procurar partidas onde o time visitante jogou fora com ELO similar
  // CONTRA qualquer mandante com ELO similar
  let awayTeamMatches = matchesHistory.filter(m => {
    if (m.away !== awayClubId) return false;  // Visitante deve ser awayClubId
    const mLeagueCode = getLeagueFromSource(m.source);
    if (!mLeagueCode || !leagueCode || mLeagueCode !== leagueCode) return false; // Mesma liga
    return Math.abs(m.awayEloPre - awayEloTarget) <= ELO_RANGE &&  // Visitante no range
           Math.abs(m.homeEloPre - homeEloTarget) <= ELO_RANGE;    // Mandante no range
  });
  
  // Se não encontrou matches, expandir o range para ±50
  if (homeTeamMatches.length === 0 && awayTeamMatches.length === 0) {
    ELO_RANGE = 50;
    rangeExpanded = '±50';
    
    homeTeamMatches = matchesHistory.filter(m => {
      if (m.home !== homeClubId) return false;
      const mLeagueCode = getLeagueFromSource(m.source);
      if (!mLeagueCode || !leagueCode || mLeagueCode !== leagueCode) return false;
      return Math.abs(m.homeEloPre - homeEloTarget) <= ELO_RANGE &&
             Math.abs(m.awayEloPre - awayEloTarget) <= ELO_RANGE;
    });
    
    awayTeamMatches = matchesHistory.filter(m => {
      if (m.away !== awayClubId) return false;
      const mLeagueCode = getLeagueFromSource(m.source);
      if (!mLeagueCode || !leagueCode || mLeagueCode !== leagueCode) return false;
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
      const mLeagueCode = getLeagueFromSource(m.source);
      if (!mLeagueCode || !leagueCode || mLeagueCode !== leagueCode) return false;
      return Math.abs(m.homeEloPre - homeEloTarget) <= ELO_RANGE &&
             Math.abs(m.awayEloPre - awayEloTarget) <= ELO_RANGE;
    });
    
    awayTeamMatches = matchesHistory.filter(m => {
      if (m.away !== awayClubId) return false;
      const mLeagueCode = getLeagueFromSource(m.source);
      if (!mLeagueCode || !leagueCode || mLeagueCode !== leagueCode) return false;
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

// Calcula odds baseado nas odds do mercado (B365H, B365A) com range configurável
function calculateOddsFromMarketOdds(homeClubId, awayClubId, oddH, oddA, homeLeague, matchesHistory, clubs) {
  // Validar odds de entrada
  const b365H = oddH ? parseFloat(oddH) : null;
  const b365A = oddA ? parseFloat(oddA) : null;
  
  if (!b365H || !b365A || isNaN(b365H) || isNaN(b365A)) {
    return null;
  }
  
  const leagueCode = mapLeagueNameToCode(homeLeague);
  
  // Calcular probabilidades a partir das odds B365
  const probH = 1 / b365H;
  const probA = 1 / b365A;
  
  // Usar o range de porcentagem configurado globalmente (2%, 3% ou 5%)
  const rangePercent = CURRENT_MARKET_RANGE;
  const probHMin = Math.max(0.01, probH - rangePercent);
  const probHMax = Math.min(0.99, probH + rangePercent);
  const probAMin = Math.max(0.01, probA - rangePercent);
  const probAMax = Math.min(0.99, probA + rangePercent);
  
  // Converter probabilidades de volta para odds
  const oddHMin = 1 / probHMax;  // probabilidade maior = odd menor
  const oddHMax = 1 / probHMin;
  const oddAMin = 1 / probAMax;
  const oddAMax = 1 / probAMin;
  
  console.log(`🎯 Market Odds: H=${b365H.toFixed(2)} (${(probH*100).toFixed(1)}%), A=${b365A.toFixed(2)} (${(probA*100).toFixed(1)}%) | Range: ±${(rangePercent*100).toFixed(0)}% | H[${oddHMin.toFixed(2)}-${oddHMax.toFixed(2)}], A[${oddAMin.toFixed(2)}-${oddAMax.toFixed(2)}]`);
  
  // ANÁLISE GERAL: Buscar todas as partidas onde as odds estão nos ranges
  // Para isso, precisamos estimar as odds de cada partida histórica usando os ELOs pré-match
  const calculateOddsFromElo = (homeElo, awayElo) => {
    // Função auxiliar para estimar odds a partir de ELO
    const expH = expectedHome(homeElo, awayElo);
    const baseDraw = 0.30;
    const drawSlope = 0.00075;
    const diffElo = Math.abs(homeElo - awayElo);
    let drawProbCalc = baseDraw - drawSlope * diffElo;
    if (drawProbCalc < 0.10) drawProbCalc = 0.10;
    if (drawProbCalc > 0.35) drawProbCalc = 0.35;
    const homeProb = expH * (1 - drawProbCalc);
    const awayProb = (1 - expH) * (1 - drawProbCalc);
    const drawProb = drawProbCalc;
    const oddH = homeProb > 0 ? 1 / homeProb : null;
    const oddA = awayProb > 0 ? 1 / awayProb : null;
    return { oddH, oddA };
  };
  
  // Filtrar partidas da liga onde as odds estimadas estão no range
  let generalMatches = matchesHistory.filter(m => {
    const mLeagueCode = getLeagueFromSource(m.source);
    if (mLeagueCode !== leagueCode) return false;
    
    // Estimar odds dessa partida usando ELOs pré-match
    const estimatedOdds = calculateOddsFromElo(m.homeEloPre, m.awayEloPre);
    if (!estimatedOdds.oddH || !estimatedOdds.oddA) return false;
    
    // Verificar se as odds estimadas estão dentro do range
    const oddHInRange = estimatedOdds.oddH >= oddHMin && estimatedOdds.oddH <= oddHMax;
    const oddAInRange = estimatedOdds.oddA >= oddAMin && estimatedOdds.oddA <= oddAMax;
    
    return oddHInRange && oddAInRange;
  });
  
  console.log(`📊 Filtro com range ${(rangePercent*100).toFixed(0)}%: H[${oddHMin.toFixed(2)}-${oddHMax.toFixed(2)}], A[${oddAMin.toFixed(2)}-${oddAMax.toFixed(2)}] => ${generalMatches.length} partidas`);
  
  // Se não encontrou partidas com o range atual, expandir o range
  let expandedRange = '';
  if (generalMatches.length === 0) {
    // Expandir para 2x o range
    const expandedRangePercent = rangePercent * 2;
    const probHMinExp = Math.max(0.01, probH - expandedRangePercent);
    const probHMaxExp = Math.min(0.99, probH + expandedRangePercent);
    const probAMinExp = Math.max(0.01, probA - expandedRangePercent);
    const probAMaxExp = Math.min(0.99, probA + expandedRangePercent);
    
    const oddHMinExp = 1 / probHMaxExp;
    const oddHMaxExp = 1 / probHMinExp;
    const oddAMinExp = 1 / probAMaxExp;
    const oddAMaxExp = 1 / probAMinExp;
    
    console.log(`  ⚠️ Nenhuma partida com range ${(rangePercent*100).toFixed(0)}%, expandindo para ±${(expandedRangePercent*100).toFixed(0)}%`);
    
    generalMatches = matchesHistory.filter(m => {
      const mLeagueCode = getLeagueFromSource(m.source);
      if (mLeagueCode !== leagueCode) return false;
      
      const estimatedOdds = calculateOddsFromElo(m.homeEloPre, m.awayEloPre);
      if (!estimatedOdds.oddH || !estimatedOdds.oddA) return false;
      
      const oddHInRange = estimatedOdds.oddH >= oddHMinExp && estimatedOdds.oddH <= oddHMaxExp;
      const oddAInRange = estimatedOdds.oddA >= oddAMinExp && estimatedOdds.oddA <= oddAMaxExp;
      
      return oddHInRange && oddAInRange;
    });
    
    expandedRange = `⚠️ ±${(expandedRangePercent*100).toFixed(0)}%`;
  }
  
  if (generalMatches.length === 0) {
    console.log(`  ⚠️⚠️ Nenhuma partida encontrada no histórico para a liga ${leagueCode} mesmo com range expandido`);
    return null;
  }
  
  console.log(`  ✓ Análise Geral: ${generalMatches.length} partidas encontradas ${expandedRange}`);
  
  // Calcular odds da análise geral
  const generalResult = calculateOddsWithPoisson(generalMatches, generalMatches);
  
  if (!generalResult) {
    return null;
  }
  
  generalResult.sampleSize = generalMatches.length;
  generalResult.matchList = generalMatches;
  generalResult.source = 'market-odds';
  
  console.log(`⚽ Análise Geral (Odds ${b365H.toFixed(2)}/${b365A.toFixed(2)}): ${generalMatches.length} matches (V=${(generalResult.homeProb*100).toFixed(0)}%, D=${(generalResult.drawProb*100).toFixed(0)}%, A=${(generalResult.awayProb*100).toFixed(0)}%)`);
  
  return generalResult;
}

// Calcula odds específico do time A PARTIR da análise geral baseada em odds de mercado
function calculateTeamOddsFromMarketOdds(homeClubId, awayClubId, similarMatches) {
  if (!Array.isArray(similarMatches) || similarMatches.length === 0) return null;
  
  // Contar partidas onde homeClubId é mandante ou awayClubId é visitante
  const homeTeamMatches = similarMatches.filter(m => m.home === homeClubId);
  const awayTeamMatches = similarMatches.filter(m => m.away === awayClubId);
  
  // Combinar as duas listas
  const combinedMatches = [...homeTeamMatches, ...awayTeamMatches];
  
  if (combinedMatches.length === 0) return null;
  
  const result = calculateOddsWithPoisson(homeTeamMatches, awayTeamMatches);
  
  if (!result) return null;
  
  result.sampleSize = combinedMatches.length;
  result.rangeExpanded = false;
  
  console.log(`⚽ Análise Específica (Time): ${combinedMatches.length} matches (V=${(result.homeProb*100).toFixed(0)}%, D=${(result.drawProb*100).toFixed(0)}%, A=${(result.awayProb*100).toFixed(0)}%)`);
  
  return result;
}

// Calcula odds baseado no histórico da liga (mandante vs visitante com ELOs similares)
function calculateOddsFromHistory(homeClubId, awayClubId, homeEloTarget, awayEloTarget, homeLeague, matchesHistory, clubs) {
  let ELO_RANGE = CURRENT_ELO_RANGE;
  let rangeExpanded = false;
  
  
  // Mapear nome da liga para código (ex: "Série A (Brazil)" -> "BRA")
  const leagueCode = mapLeagueNameToCode(homeLeague);
  console.log(`🔍 Liga ${homeLeague} -> ${leagueCode} | ELO Target: H=${homeEloTarget.toFixed(0)} A=${awayEloTarget.toFixed(0)} | Total histórico: ${matchesHistory.length} partidas`);
  
  // Filtrar MATCHES onde o prefixo do campo source bate com o código da liga
  let similarMatches = matchesHistory.filter(m => {
    const mLeagueCode = getLeagueFromSource(m.source);
    if (!mLeagueCode || !leagueCode || mLeagueCode !== leagueCode) return false;
    // Mandante no range
    const homeEloMatch = Math.abs(m.homeEloPre - homeEloTarget) <= ELO_RANGE;
    // Visitante no range
    const awayEloMatch = Math.abs(m.awayEloPre - awayEloTarget) <= ELO_RANGE;
    return homeEloMatch && awayEloMatch;
  });
  console.log(`  ✓ Range ±25: ${similarMatches.length} matches encontradas`);
  
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
    console.log(`  ⚠️ Range ±50: ${similarMatches.length} matches encontradas`);
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
    console.log(`  ⚠️⚠️ Range ±100: ${similarMatches.length} matches encontradas`);
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
    // Corrigir sample size para refletir número de partidas distintas da liga
    result.sampleSize = similarMatches.length;
    // Disponibilizar lista de partidas filtradas para uso na análise específica
    result.matchList = similarMatches;
    const rangeUsed = rangeExpanded || '±25';
    console.log(`⚽ Liga${rangeIndicator}: ${similarMatches.length} matches (V=${(result.homeProb*100).toFixed(0)}%, D=${(result.drawProb*100).toFixed(0)}%, A=${(result.awayProb*100).toFixed(0)}%)`);
    result.rangeExpanded = rangeExpanded;  // Adicionar indicador
  }
  
  return result;
}

// Calcula odds e contagens específicas do time A PARTIR da lista da análise geral
function calculateTeamOddsWithinSimilarMatches(homeClubId, awayClubId, similarMatches) {
  if (!Array.isArray(similarMatches) || similarMatches.length === 0) return null;
  const homeTeamMatches = similarMatches.filter(m => m.home === homeClubId);
  const awayTeamMatches = similarMatches.filter(m => m.away === awayClubId);
  if (homeTeamMatches.length === 0 && awayTeamMatches.length === 0) return null;

  const result = calculateOddsWithPoisson(homeTeamMatches, awayTeamMatches);
  if (result) {
    result.sampleSize = (homeTeamMatches.length + awayTeamMatches.length);
    result.rangeExpanded = false; // já derivado da lista geral
  }
  return result;
}


async function loadExternalFixtures() {
  // Try loading from cached JSON file first (updated by proxy 2x per week)
  try {
    const timestamp = new Date().getTime();
    const res = await fetch(`data/fixtures.json?t=${timestamp}`);
    if (res.ok) {
      const data = await res.json();
      console.log(`✓ Loaded ${data.count || data.fixtures.length} fixtures from cache (updated: ${data.updated})`);
      if (data.fixtures && data.fixtures.length > 0) {
        return data.fixtures;
      }
    }
  } catch (e) {
    console.warn('Could not load cached fixtures.json:', e.message);
  }
  
  // Fallback: try proxy (running on localhost:5000)
  try {
    console.log('Trying to load fixtures from local proxy...');
    const res = await fetch('http://localhost:5000/fixtures');
    if (!res.ok) {
      console.warn(`Proxy returned status ${res.status}`);
      return [];
    }
    const text = await res.text();
    const lines = text.split('\n').filter(Boolean);
    if (lines.length < 2) {
      console.warn('Not enough lines in proxy response');
      return [];
    }
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
    if (fixtures.length > 0) {
      console.log(`✓ Loaded ${fixtures.length} fixtures from proxy`);
      return fixtures;
    }
  } catch (e) {
    console.warn('Could not load from proxy:', e.message);
  }
  
  // If all else fails, return empty array
  console.warn('No fixtures available from any source');
  return [];
}

async function init(){
  try {
    console.log('Loading fixtures page...');
    const { clubs, matches, ratings, leagues } = await loadData();
    console.log(`Loaded: ${clubs.length} clubs, ${ratings.length} ratings, ${leagues.length} leagues`);
    
    const ha = await loadHA();
    const matchesHistory = await loadMatchesHistory();
    console.log(`Loaded: ${matchesHistory.length} historical matches`);
    
    // Analisar distribuição de matches no histórico
    const distribution = analyzeHistoryDistribution(matchesHistory);
    
    const root = document.getElementById('fixtures-root');
    if (!root) {
      console.error('Root element #fixtures-root not found!');
      return;
    }
    root.innerHTML = '';

    const fixtures = await loadExternalFixtures();
    console.log(`Loaded ${fixtures.length} external fixtures`);
    
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
    console.log(`Filtered to ${toShow.length} fixtures (after filtering by known clubs/leagues)`);

  // Criar seção de filtros
  const filtersContainer = document.createElement('div');
  filtersContainer.style.cssText = 'margin-bottom: 1.5rem; padding: 1rem; background: white; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);';
  
  const filtersTitle = document.createElement('h3');
  filtersTitle.textContent = '🔍 Filtros';
  filtersTitle.style.cssText = 'margin: 0 0 1rem 0; font-size: 1.1rem;';
  filtersContainer.appendChild(filtersTitle);
  
  const filterRow = document.createElement('div');
  filterRow.style.cssText = 'display: flex; gap: 2rem; align-items: flex-start; flex-wrap: wrap;';
  
  // Filtro de confiabilidade geral (análise geral - linha de cima)
  const confidenceFilterGroup = document.createElement('div');
  confidenceFilterGroup.style.cssText = 'display: flex; flex-direction: column; gap: 0.75rem; flex: 1; min-width: 280px;';
  
  const confidenceLabelContainer = document.createElement('div');
  confidenceLabelContainer.style.cssText = 'display: flex; justify-content: space-between; align-items: center;';
  
  const confidenceLabel = document.createElement('label');
  confidenceLabel.textContent = 'Conf. Geral (liga):';
  confidenceLabel.style.cssText = 'font-weight: 600; font-size: 0.9rem; color: #555;';
  
  const confidenceValueSpan = document.createElement('span');
  confidenceValueSpan.id = 'confidence-value';
  confidenceValueSpan.textContent = '0%';
  confidenceValueSpan.style.cssText = 'font-weight: 700; color: #0b6e4f; font-size: 0.95rem;';
  
  confidenceLabelContainer.appendChild(confidenceLabel);
  confidenceLabelContainer.appendChild(confidenceValueSpan);
  confidenceFilterGroup.appendChild(confidenceLabelContainer);
  
  // Container para slider com marcações
  const confidenceInputContainer = document.createElement('div');
  confidenceInputContainer.style.cssText = 'display: flex; flex-direction: column; gap: 0.5rem;';
  
  const confidenceSlider = document.createElement('input');
  confidenceSlider.type = 'range';
  confidenceSlider.id = 'confidence-filter';
  confidenceSlider.min = '0';
  confidenceSlider.max = '100';
  confidenceSlider.value = '0';
  confidenceSlider.style.cssText = 'width: 100%; height: 6px; border-radius: 3px; background: linear-gradient(to right, #e0e0e0 0%, #0b6e4f 0%); outline: none; cursor: pointer; -webkit-appearance: none; appearance: none;';
  
  // Container para marcações
  const ticksContainer = document.createElement('div');
  ticksContainer.style.cssText = 'position: relative; width: 100%; height: 16px; margin-top: 0.25rem;';
  
  // Criar marcações no slider (0, 25, 50, 75, 100)
  for (let i = 0; i <= 100; i += 25) {
    const tick = document.createElement('div');
    const position = (i / 100) * 100;
    tick.style.cssText = `position: absolute; left: calc(${position}% - 0.5px); width: 1px; height: ${i % 50 === 0 ? '12px' : '6px'}; background: #999; top: 0;`;
    
    if (i % 50 === 0) {
      const label = document.createElement('div');
      label.textContent = `${i}%`;
      label.style.cssText = `position: absolute; left: calc(${position}% - 12px); width: 24px; text-align: center; font-size: 0.75rem; color: #666; top: 14px;`;
      ticksContainer.appendChild(label);
    }
    ticksContainer.appendChild(tick);
  }
  
  // Estilo do thumb do slider
  const sliderStyle = document.createElement('style');
  sliderStyle.textContent = `
    input[type="range"] {
      -webkit-appearance: none;
      appearance: none;
    }
    input[type="range"]::-webkit-slider-thumb {
      -webkit-appearance: none;
      appearance: none;
      width: 18px;
      height: 18px;
      border-radius: 50%;
      background: #0b6e4f;
      cursor: pointer;
      box-shadow: 0 2px 4px rgba(0,0,0,0.2);
      transition: box-shadow 0.2s;
    }
    input[type="range"]::-webkit-slider-thumb:hover {
      box-shadow: 0 2px 8px rgba(11, 110, 79, 0.4);
    }
    input[type="range"]::-moz-range-thumb {
      width: 18px;
      height: 18px;
      border-radius: 50%;
      background: #0b6e4f;
      cursor: pointer;
      border: none;
      box-shadow: 0 2px 4px rgba(0,0,0,0.2);
      transition: box-shadow 0.2s;
    }
    input[type="range"]::-moz-range-thumb:hover {
      box-shadow: 0 2px 8px rgba(11, 110, 79, 0.4);
    }
    input[type="range"]::-moz-range-track {
      background: transparent;
      border: none;
    }
    input[type="range"]::-moz-range-progress {
      background: #0b6e4f;
      height: 6px;
      border-radius: 3px;
    }
    input[type="number"] {
      font-variant-numeric: tabular-nums;
    }
    input[type="number"]::-webkit-outer-spin-button,
    input[type="number"]::-webkit-inner-spin-button {
      -webkit-appearance: none;
      margin: 0;
    }
    input[type="number"] {
      -moz-appearance: textfield;
    }
  `;
  document.head.appendChild(sliderStyle);
  
  confidenceInputContainer.appendChild(confidenceSlider);
  confidenceInputContainer.appendChild(ticksContainer);
  confidenceFilterGroup.appendChild(confidenceInputContainer);
  filterRow.appendChild(confidenceFilterGroup);
  
  // Filtro de confiabilidade das equipes (linha de baixo)
  const teamConfidenceFilterGroup = document.createElement('div');
  teamConfidenceFilterGroup.style.cssText = 'display: flex; flex-direction: column; gap: 0.75rem; flex: 1; min-width: 280px;';
  
  const teamConfidenceLabelContainer = document.createElement('div');
  teamConfidenceLabelContainer.style.cssText = 'display: flex; justify-content: space-between; align-items: center;';
  
  const teamConfidenceLabel = document.createElement('label');
  teamConfidenceLabel.textContent = 'Conf. Equipes:';
  teamConfidenceLabel.style.cssText = 'font-weight: 600; font-size: 0.9rem; color: #555;';
  
  const teamConfidenceValueSpan = document.createElement('span');
  teamConfidenceValueSpan.id = 'team-confidence-value';
  teamConfidenceValueSpan.textContent = '0%';
  teamConfidenceValueSpan.style.cssText = 'font-weight: 700; color: #0b6e4f; font-size: 0.95rem;';
  
  teamConfidenceLabelContainer.appendChild(teamConfidenceLabel);
  teamConfidenceLabelContainer.appendChild(teamConfidenceValueSpan);
  teamConfidenceFilterGroup.appendChild(teamConfidenceLabelContainer);
  
  // Container para slider com marcações
  const teamConfidenceInputContainer = document.createElement('div');
  teamConfidenceInputContainer.style.cssText = 'display: flex; flex-direction: column; gap: 0.5rem;';
  
  const teamConfidenceSlider = document.createElement('input');
  teamConfidenceSlider.type = 'range';
  teamConfidenceSlider.id = 'team-confidence-filter';
  teamConfidenceSlider.min = '0';
  teamConfidenceSlider.max = '100';
  teamConfidenceSlider.value = '0';
  teamConfidenceSlider.style.cssText = 'width: 100%; height: 6px; border-radius: 3px; background: linear-gradient(to right, #e0e0e0 0%, #0b6e4f 0%); outline: none; cursor: pointer; -webkit-appearance: none; appearance: none;';
  
  // Container para marcações
  const teamTicksContainer = document.createElement('div');
  teamTicksContainer.style.cssText = 'position: relative; width: 100%; height: 16px; margin-top: 0.25rem;';
  
  // Criar marcações no slider (0, 25, 50, 75, 100)
  for (let i = 0; i <= 100; i += 25) {
    const tick = document.createElement('div');
    const position = (i / 100) * 100;
    tick.style.cssText = `position: absolute; left: calc(${position}% - 0.5px); width: 1px; height: ${i % 50 === 0 ? '12px' : '6px'}; background: #999; top: 0;`;
    
    if (i % 50 === 0) {
      const label = document.createElement('div');
      label.textContent = `${i}%`;
      label.style.cssText = `position: absolute; left: calc(${position}% - 12px); width: 24px; text-align: center; font-size: 0.75rem; color: #666; top: 14px;`;
      teamTicksContainer.appendChild(label);
    }
    teamTicksContainer.appendChild(tick);
  }
  
  teamConfidenceInputContainer.appendChild(teamConfidenceSlider);
  teamConfidenceInputContainer.appendChild(teamTicksContainer);
  teamConfidenceFilterGroup.appendChild(teamConfidenceInputContainer);
  filterRow.appendChild(teamConfidenceFilterGroup);
  
  // Contador de jogos
  const counterDiv = document.createElement('div');
  counterDiv.id = 'fixtures-counter';
  counterDiv.style.cssText = 'margin-left: auto; font-weight: 600; color: #0b6e4f; font-size: 1rem; align-self: center; white-space: nowrap;';
  filterRow.appendChild(counterDiv);
  
  filtersContainer.appendChild(filterRow);
  
  // Segunda linha de filtros - Elo Rating Home e Away
  const eloFilterRow = document.createElement('div');
  eloFilterRow.style.cssText = 'display: flex; gap: 2rem; align-items: center; margin-top: 1.5rem; flex-wrap: wrap;';
  
  // Filtro de Elo Rating Home
  const homeEloFilterGroup = document.createElement('div');
  homeEloFilterGroup.style.cssText = 'display: flex; align-items: center; gap: 1rem;';
  
  const homeEloLabel = document.createElement('label');
  homeEloLabel.textContent = 'ELO Home:';
  homeEloLabel.style.cssText = 'font-weight: 600; font-size: 0.9rem; color: #555;';
  
  const homeEloSelect = document.createElement('select');
  homeEloSelect.id = 'home-elo-filter';
  homeEloSelect.style.cssText = 'padding: 0.5rem 0.75rem; border: 1px solid #999; border-radius: 4px; font-size: 0.9rem; font-weight: 600; cursor: pointer; background: white;';
  
  const homeEloOptions = [
    { value: 'all', label: 'Todos' },
    { value: 'up', label: '▲ Acima da média' },
    { value: 'stable', label: '● Na média' },
    { value: 'down', label: '▼ Abaixo da média' }
  ];
  
  homeEloOptions.forEach(opt => {
    const option = document.createElement('option');
    option.value = opt.value;
    option.textContent = opt.label;
    homeEloSelect.appendChild(option);
  });
  
  homeEloFilterGroup.appendChild(homeEloLabel);
  homeEloFilterGroup.appendChild(homeEloSelect);
  eloFilterRow.appendChild(homeEloFilterGroup);
  
  // Filtro de Elo Rating Away
  const awayEloFilterGroup = document.createElement('div');
  awayEloFilterGroup.style.cssText = 'display: flex; align-items: center; gap: 1rem;';
  
  const awayEloLabel = document.createElement('label');
  awayEloLabel.textContent = 'ELO Away:';
  awayEloLabel.style.cssText = 'font-weight: 600; font-size: 0.9rem; color: #555;';
  
  const awayEloSelect = document.createElement('select');
  awayEloSelect.id = 'away-elo-filter';
  awayEloSelect.style.cssText = 'padding: 0.5rem 0.75rem; border: 1px solid #999; border-radius: 4px; font-size: 0.9rem; font-weight: 600; cursor: pointer; background: white;';
  
  const awayEloOptions = [
    { value: 'all', label: 'Todos' },
    { value: 'up', label: '▲ Acima da média' },
    { value: 'stable', label: '● Na média' },
    { value: 'down', label: '▼ Abaixo da média' }
  ];
  
  awayEloOptions.forEach(opt => {
    const option = document.createElement('option');
    option.value = opt.value;
    option.textContent = opt.label;
    awayEloSelect.appendChild(option);
  });
  
  awayEloFilterGroup.appendChild(awayEloLabel);
  awayEloFilterGroup.appendChild(awayEloSelect);
  eloFilterRow.appendChild(awayEloFilterGroup);
  
  filtersContainer.appendChild(eloFilterRow);
  root.appendChild(filtersContainer);
  
  // Função para atualizar o visual do slider com progresso
  function updateSliderBackground(slider, valueSpan) {
    const value = (slider.value - slider.min) / (slider.max - slider.min) * 100;
    slider.style.background = `linear-gradient(to right, #0b6e4f 0%, #0b6e4f ${value}%, #e0e0e0 ${value}%, #e0e0e0 100%)`;
    valueSpan.textContent = `${slider.value}%`;
  }
  
  // Atualizar valores iniciais
  updateSliderBackground(confidenceSlider, confidenceValueSpan);
  updateSliderBackground(teamConfidenceSlider, teamConfidenceValueSpan);

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

  // Função para renderizar a tabela com filtros aplicados
  function renderTable(minConfidence = 0, minTeamConfidence = 0, homeEloFilter = 'all', awayEloFilter = 'all', filterCasa = '', filterFora = '', filterContinent = '', filterCountry = '', filterLeague = '', filterDate = '') {
    // Remover tabela existente se houver
    const existingTable = root.querySelector('.fixtures-table');
    if (existingTable) {
      existingTable.remove();
    }

  const table = document.createElement('table');
  table.className = 'fixtures-table';
  table.style.width = '100%';
  table.style.minWidth = '1100px';

  const thead = document.createElement('thead');
  const hr = document.createElement('tr');
  // Nova ordem: Data; ELO; Mandante; Visitante; ELO; (3 %); (3 Odd); Conf.; (4 Métricas); Setas; N Jogos; Entrada
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
    'Conf.',
    'CGH',
    'VGH',
    'CGA',
    'VGA',
    'CASA',
    'FORA',
    'N Jogos',
    'Entrada'
  ].forEach((h, idx) => {
    const th = document.createElement('th');
    th.textContent = h;
    
    // Adicionar tooltips para as métricas de gol
    if (h === 'CGH') th.title = 'Custo do Gol do Mandante (geral / específico)';
    if (h === 'CGA') th.title = 'Custo do Gol do Visitante (geral / específico)';
    if (h === 'VGH') th.title = 'Valor do Gol do Mandante (geral / específico)';
    if (h === 'VGA') th.title = 'Valor do Gol do Visitante (geral / específico)';
    if (h === 'CASA') th.title = 'Indicadores: CGH vs CGA e VGH vs VGA (mandante)';
    if (h === 'FORA') th.title = 'Indicadores: CGH vs CGA e VGH vs VGA (visitante)';
    if (h === 'N Jogos') th.title = 'Quantidade de jogos analisados (liga / time)';
    
    // Ajusta largura das colunas Mandante e Visitante
    if (idx === 2 || idx === 3) {
      th.style.minWidth = '110px';
      th.style.width = '130px';
    } else if (idx >= 12 && idx < 16) {
      // Colunas de métricas (CGH, CGA, VGH, VGA)
      th.style.minWidth = '45px';
      th.style.width = '50px';
      th.style.maxWidth = '55px';
    } else if (idx === 16 || idx === 17) {
      // Colunas de setas (CASA, FORA)
      th.style.minWidth = '50px';
      th.style.width = '55px';
      th.style.maxWidth = '60px';
    } else if (idx === 18) {
      // Coluna N Jogos
      th.style.minWidth = '50px';
      th.style.width = '60px';
      th.style.maxWidth = '70px';
    } else if (idx === 19) {
      // Coluna Entrada
      th.style.minWidth = '50px';
      th.style.width = '60px';
      th.style.maxWidth = '70px';
    } else if (idx === 0) {
      // Coluna Data
      th.style.minWidth = '65px';
      th.style.width = '70px';
      th.style.maxWidth = '75px';
    } else if (idx === 1 || idx === 4) {
      // Colunas ELO
      th.style.minWidth = '55px';
      th.style.width = '62px';
      th.style.maxWidth = '70px';
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

  const preparedRows = [];
  let minCost = Infinity, maxCost = -Infinity;
  let minValue = Infinity, maxValue = -Infinity;

  const getBackgroundColor = (probValue, oddValue) => {
    if (!probValue || !oddValue) return 'transparent';
    if (oddValue > probValue * 1.10) return '#c8e6c9';
    if (oddValue > probValue) return '#fff9c4';
    return '#ffcdd2';
  };

  toShow.slice(0,200).forEach(f => {
    const hClub = findClubByName(clubs, f.home);
    const aClub = findClubByName(clubs, f.away);
    const homeName = hClub ? hClub.name : f.home;
    const awayName = aClub ? aClub.name : f.away;
    const parsed = parseCsvDate(f.date);
    let displayDate = '';
    let rawDate = ''; // Guardar data em formato ISO para filtro
    if (parsed) {
      const d = parsed;
      const day = String(d.getDate()).padStart(2, '0');
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const year = String(d.getFullYear());
      displayDate = `${day}/${month}/${year.slice(-2)}`;
      rawDate = `${year}-${month}-${day}`; // Formato ISO para comparação
    } else {
      displayDate = f.date || '';
      rawDate = '';
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
    let marketOddsResult = null;
    
    // TENTAR ANÁLISE POR ODDS DE MERCADO PRIMEIRO
    if (hClub && aClub && homeLeague && matchesHistory.length > 0 && f.oddH && f.oddA) {
      marketOddsResult = calculateOddsFromMarketOdds(
        hClub.id,
        aClub.id,
        f.oddH,
        f.oddA,
        homeLeague.toLowerCase(),
        matchesHistory,
        clubs
      );
    }
    
    // SE NÃO HOUVER ANÁLISE DE ODDS, USAR ANÁLISE POR ELO
    if (hClub && aClub && homeLeague && matchesHistory.length > 0 && !marketOddsResult) {
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
    
    // Usar resultado de market odds se disponível, caso contrário usar ELO
    const primaryResult = marketOddsResult || historyResult;
    
    // Se houver resultado, usar os valores calculados; caso contrário, usar cálculo matemático
    let sampleSize = 0;
    if (primaryResult) {
      homeProb = primaryResult.homeProb;
      drawProb = primaryResult.drawProb;
      awayProb = primaryResult.awayProb;
      sampleSize = primaryResult.sampleSize || 0;
      historyResult = primaryResult; // Guardar para uso posterior
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
    let confidenceLevel = calculateConfidence(sampleSize, leagueCode, primaryResult);
    
    // Se o resultado veio de Poisson (league-wide), usar confiança combinada
    let stdDevConfidenceLeague = null;
    if (primaryResult && primaryResult.stdDevConfidence !== undefined) {
      stdDevConfidenceLeague = primaryResult.stdDevConfidence;
      confidenceLevel = combineConfidences(sampleSize, leagueCode, primaryResult, stdDevConfidenceLeague);
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
      // Usar função apropriada baseada no tipo de análise
      if (marketOddsResult) {
        teamHistoryResult = calculateTeamOddsFromMarketOdds(
          hClub?.id,
          aClub?.id,
          marketOddsResult?.matchList || []
        );
      } else {
        teamHistoryResult = calculateTeamOddsWithinSimilarMatches(
          hClub?.id,
          aClub?.id,
          historyResult?.matchList || []
        );
      }
      if (teamHistoryResult) {
        teamSampleSize = teamHistoryResult.sampleSize || 0;
        teamRangeExpanded = teamHistoryResult.rangeExpanded || false;
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

    // Aplicar filtro de confiabilidade geral (linha de cima)
    if (confidenceLevel < minConfidence) {
      return; // Pular este jogo se não atender ao filtro de confiança geral
    }
    
    // Aplicar filtro de confiabilidade das equipes (linha de baixo)
    // Se não há teamConfidenceLevel, considerar como 0 para fins de filtragem
    const teamConfValue = teamConfidenceLevel !== null ? teamConfidenceLevel : 0;
    if (teamConfValue < minTeamConfidence) {
      return; // Pular este jogo se não atender ao filtro de confiança das equipes
    }

    // Links para serem usados no segundo passe
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
    let homeIndicator = null;
    let awayIndicator = null;
    
    try {
      const homeTrend = getEloTrend(hClub?.id, true, matchesHistory);
      const awayTrend = getEloTrend(aClub?.id, false, matchesHistory);
      
      homeIndicator = getEloIndicator(homeRating, homeTrend);
      awayIndicator = getEloIndicator(awayRating, awayTrend);
      
      // Aplicar filtro de ELO Home
      if (homeEloFilter !== 'all') {
        if (!homeIndicator) return; // Se não tem indicador, pular
        
        if (homeEloFilter === 'up' && homeIndicator.symbol !== '▲') return;
        if (homeEloFilter === 'stable' && homeIndicator.symbol !== '●') return;
        if (homeEloFilter === 'down' && homeIndicator.symbol !== '▼') return;
      }
      
      // Aplicar filtro de ELO Away
      if (awayEloFilter !== 'all') {
        if (!awayIndicator) return; // Se não tem indicador, pular
        
        if (awayEloFilter === 'up' && awayIndicator.symbol !== '▲') return;
        if (awayEloFilter === 'stable' && awayIndicator.symbol !== '●') return;
        if (awayEloFilter === 'down' && awayIndicator.symbol !== '▼') return;
      }
      
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

    // Calcular métricas de gol (GH/GA) a partir das médias Poisson
    const ghGeneral = historyResult ? historyResult.homeGoalsMean : null;
    const gaGeneral = historyResult ? historyResult.awayGoalsMean : null;
    const ghTeam = teamHistoryResult ? teamHistoryResult.homeGoalsMean : null;
    const gaTeam = teamHistoryResult ? teamHistoryResult.awayGoalsMean : null;

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
    
    // Formatar confiança com dois valores (liga + time) - apenas porcentagens
    const formatConfidenceWithTeamHistory = (leagueValue, teamValue) => {
      const teamDisplay = teamValue !== null ? teamValue : '—';
      return `<div style="font-size:11px;line-height:1.4;"><span style="padding:2px 4px;border-radius:2px;display:block;">${leagueValue}</span><span style="opacity:0.7;font-size:10px;padding:2px 4px;border-radius:2px;display:block;margin-top:2px;">${teamDisplay}</span></div>`;
    };

    const confidenceDisplay = formatConfidenceWithTeamHistory(
      confidenceText,
      confidenceTextTeam
    );

    const vghGeneral = (ghGeneral != null && oddAValue) ? ghGeneral / oddAValue : null;
    const vghTeam = (ghTeam != null && oddAValue) ? ghTeam / oddAValue : null;
    const vgaGeneral = (gaGeneral != null && oddHValue) ? gaGeneral / oddHValue : null;
    const vgaTeam = (gaTeam != null && oddHValue) ? gaTeam / oddHValue : null;

    const cghGeneral = (ghGeneral != null && oddHValue) ? 1 / (ghGeneral * oddHValue) : null;
    const cghTeam = (ghTeam != null && oddHValue) ? 1 / (ghTeam * oddHValue) : null;
    const cgaGeneral = (gaGeneral != null && oddAValue) ? 1 / (gaGeneral * oddAValue) : null;
    const cgaTeam = (gaTeam != null && oddAValue) ? 1 / (gaTeam * oddAValue) : null;

    [cghGeneral, cghTeam, cgaGeneral, cgaTeam].forEach(v => {
      if (v !== null && v !== undefined) {
        minCost = Math.min(minCost, v);
        maxCost = Math.max(maxCost, v);
      }
    });
    [vghGeneral, vghTeam, vgaGeneral, vgaTeam].forEach(v => {
      if (v !== null && v !== undefined) {
        minValue = Math.min(minValue, v);
        maxValue = Math.max(maxValue, v);
      }
    });

    const getIndicatorSymbols = (cgh, cga, vgh, vga) => {
      if (cgh === null || cga === null || vgh === null || vga === null) {
        return { casa: '', fora: '' };
      }
      const cghLessCga = cgh < cga;
      const vghGreaterVga = vgh > vga;
      let casa = '', fora = '';
      if (cghLessCga && vghGreaterVga) {
        casa = '▲▲';
        fora = '- -';
      } else if (cghLessCga && !vghGreaterVga) {
        casa = '▲-';
        fora = '-▼';
      } else if (!cghLessCga && vghGreaterVga) {
        casa = '-▲';
        fora = '▼-';
      } else {
        casa = '--';
        fora = '▼▼';
      }
      return { casa, fora };
    };
    
    const generalIndicators = getIndicatorSymbols(cghGeneral, cgaGeneral, vghGeneral, vgaGeneral);
    const teamIndicators = getIndicatorSymbols(cghTeam, cgaTeam, vghTeam, vgaTeam);

    preparedRows.push({
      displayDate,
      homeName,
      awayName,
      homeEloDisplay,
      awayEloDisplay,
      homeLink,
      awayLink,
      homeOddsDisplay,
      drawOddsDisplay,
      awayOddsDisplay,
      oddHValue,
      oddDValue,
      oddAValue,
      confidenceDisplay,
      confidenceLevel,
      cghGeneral,
      cghTeam,
      cgaGeneral,
      cgaTeam,
      vghGeneral,
      vghTeam,
      vgaGeneral,
      vgaTeam,
      sampleSize,
      teamSampleSize,
      casaGeneral: generalIndicators.casa,
      casaTeam: teamIndicators.casa,
      foraGeneral: generalIndicators.fora,
      foraTeam: teamIndicators.fora,
      continent: hClub ? hClub.continent : null,
      country: hClub ? extractCountryFromLeague(hClub.league) : null,
      league: homeLeague,
      rawDate: rawDate
    });
  });

  // Calcular min/max separados para VGH (geral e específico)
  let minVghGeneral = Infinity, maxVghGeneral = -Infinity;
  let minVghTeam = Infinity, maxVghTeam = -Infinity;
  let minVgaGeneral = Infinity, maxVgaGeneral = -Infinity;
  let minVgaTeam = Infinity, maxVgaTeam = -Infinity;
  let minCghGeneral = Infinity, maxCghGeneral = -Infinity;
  let minCghTeam = Infinity, maxCghTeam = -Infinity;
  let minCgaGeneral = Infinity, maxCgaGeneral = -Infinity;
  let minCgaTeam = Infinity, maxCgaTeam = -Infinity;
  
  preparedRows.forEach(row => {
    if (row.vghGeneral !== null && row.vghGeneral !== undefined) {
      minVghGeneral = Math.min(minVghGeneral, row.vghGeneral);
      maxVghGeneral = Math.max(maxVghGeneral, row.vghGeneral);
    }
    if (row.vghTeam !== null && row.vghTeam !== undefined) {
      minVghTeam = Math.min(minVghTeam, row.vghTeam);
      maxVghTeam = Math.max(maxVghTeam, row.vghTeam);
    }
    if (row.vgaGeneral !== null && row.vgaGeneral !== undefined) {
      minVgaGeneral = Math.min(minVgaGeneral, row.vgaGeneral);
      maxVgaGeneral = Math.max(maxVgaGeneral, row.vgaGeneral);
    }
    if (row.vgaTeam !== null && row.vgaTeam !== undefined) {
      minVgaTeam = Math.min(minVgaTeam, row.vgaTeam);
      maxVgaTeam = Math.max(maxVgaTeam, row.vgaTeam);
    }
    if (row.cghGeneral !== null && row.cghGeneral !== undefined) {
      minCghGeneral = Math.min(minCghGeneral, row.cghGeneral);
      maxCghGeneral = Math.max(maxCghGeneral, row.cghGeneral);
    }
    if (row.cghTeam !== null && row.cghTeam !== undefined) {
      minCghTeam = Math.min(minCghTeam, row.cghTeam);
      maxCghTeam = Math.max(maxCghTeam, row.cghTeam);
    }
    if (row.cgaGeneral !== null && row.cgaGeneral !== undefined) {
      minCgaGeneral = Math.min(minCgaGeneral, row.cgaGeneral);
      maxCgaGeneral = Math.max(maxCgaGeneral, row.cgaGeneral);
    }
    if (row.cgaTeam !== null && row.cgaTeam !== undefined) {
      minCgaTeam = Math.min(minCgaTeam, row.cgaTeam);
      maxCgaTeam = Math.max(maxCgaTeam, row.cgaTeam);
    }
  });

  // Cache simplificado das partidas para uso em entradas.html (Custo/Valor do Gol)
  try {
    const cache = preparedRows.map(r => ({
      date: r.displayDate,
      home: r.homeName,
      away: r.awayName,
      cgh: r.cghGeneral,
      cga: r.cgaGeneral,
      vgh: r.vghGeneral,
      vga: r.vgaGeneral,
    }));
    localStorage.setItem('fixtures_cache', JSON.stringify(cache));
  } catch (e) {
    console.warn('Não foi possível salvar fixtures_cache:', e);
  }
  
  // Evitar divisões por zero
  if (!isFinite(minVghGeneral)) { minVghGeneral = 0; maxVghGeneral = 1; }
  if (maxVghGeneral - minVghGeneral < 1e-6) { maxVghGeneral = minVghGeneral + 1; }
  if (!isFinite(minVghTeam)) { minVghTeam = 0; maxVghTeam = 1; }
  if (maxVghTeam - minVghTeam < 1e-6) { maxVghTeam = minVghTeam + 1; }
  if (!isFinite(minVgaGeneral)) { minVgaGeneral = 0; maxVgaGeneral = 1; }
  if (maxVgaGeneral - minVgaGeneral < 1e-6) { maxVgaGeneral = minVgaGeneral + 1; }
  if (!isFinite(minVgaTeam)) { minVgaTeam = 0; maxVgaTeam = 1; }
  if (maxVgaTeam - minVgaTeam < 1e-6) { maxVgaTeam = minVgaTeam + 1; }
  if (!isFinite(minCghGeneral)) { minCghGeneral = 0; maxCghGeneral = 1; }
  if (maxCghGeneral - minCghGeneral < 1e-6) { maxCghGeneral = minCghGeneral + 1; }
  if (!isFinite(minCghTeam)) { minCghTeam = 0; maxCghTeam = 1; }
  if (maxCghTeam - minCghTeam < 1e-6) { maxCghTeam = minCghTeam + 1; }
  if (!isFinite(minCgaGeneral)) { minCgaGeneral = 0; maxCgaGeneral = 1; }
  if (maxCgaGeneral - minCgaGeneral < 1e-6) { maxCgaGeneral = minCgaGeneral + 1; }
  if (!isFinite(minCgaTeam)) { minCgaTeam = 0; maxCgaTeam = 1; }
  if (maxCgaTeam - minCgaTeam < 1e-6) { maxCgaTeam = minCgaTeam + 1; }

  // Coletar valores únicos para os selects de filtro
  const uniqueContinents = [...new Set(preparedRows.map(r => r.continent).filter(Boolean))].sort();
  const uniqueCountries = [...new Set(preparedRows.map(r => r.country).filter(Boolean))].sort();
  const uniqueLeagues = [...new Set(preparedRows.map(r => r.league).filter(Boolean))].sort();
  
  // Popular selects com opções únicas
  const continentSelect = document.getElementById('filter-continent');
  const countrySelect = document.getElementById('filter-country');
  const leagueSelect = document.getElementById('filter-league');
  
  // Guardar valores selecionados antes de atualizar as opções
  const selectedContinent = continentSelect ? continentSelect.value : '';
  const selectedCountry = countrySelect ? countrySelect.value : '';
  const selectedLeague = leagueSelect ? leagueSelect.value : '';
  
  if (continentSelect) {
    continentSelect.innerHTML = '<option value="">Todos</option>';
    uniqueContinents.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c;
      opt.textContent = c;
      continentSelect.appendChild(opt);
    });
    // Restaurar seleção anterior
    if (selectedContinent) continentSelect.value = selectedContinent;
  }
  
  if (countrySelect) {
    countrySelect.innerHTML = '<option value="">Todos</option>';
    uniqueCountries.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c;
      opt.textContent = c;
      countrySelect.appendChild(opt);
    });
    // Restaurar seleção anterior
    if (selectedCountry) countrySelect.value = selectedCountry;
  }
  
  if (leagueSelect) {
    leagueSelect.innerHTML = '<option value="">Todos</option>';
    uniqueLeagues.forEach(l => {
      const opt = document.createElement('option');
      opt.value = l;
      opt.textContent = l;
      leagueSelect.appendChild(opt);
    });
    // Restaurar seleção anterior
    if (selectedLeague) leagueSelect.value = selectedLeague;
  }

  const interpolate = (a, b, t) => a + (b - a) * t;
  
  const getVghColor = (value, isTeam) => {
    if (value === undefined || value === null || Number.isNaN(Number(value))) return 'transparent';
    const v = Number(value);
    const minVal = isTeam ? minVghTeam : minVghGeneral;
    const maxVal = isTeam ? maxVghTeam : maxVghGeneral;
    
    // Normalizar valor de 0 a 1
    const t = (v - minVal) / (maxVal - minVal);
    const clampT = Math.max(0, Math.min(1, t));
    
    // Vermelho (baixo) -> Verde (alto)
    // Vermelho: rgb(255, 100, 100) -> Verde: rgb(100, 200, 100)
    const red = Math.round(interpolate(255, 100, clampT));
    const green = Math.round(interpolate(100, 200, clampT));
    const blue = Math.round(interpolate(100, 100, clampT));
    
    return `rgb(${red},${green},${blue})`;
  };

  const getVgaColor = (value, isTeam) => {
    if (value === undefined || value === null || Number.isNaN(Number(value))) return 'transparent';
    const v = Number(value);
    const minVal = isTeam ? minVgaTeam : minVgaGeneral;
    const maxVal = isTeam ? maxVgaTeam : maxVgaGeneral;
    
    // Normalizar valor de 0 a 1
    const t = (v - minVal) / (maxVal - minVal);
    const clampT = Math.max(0, Math.min(1, t));
    
    // Vermelho (baixo) -> Verde (alto)
    // Vermelho: rgb(255, 100, 100) -> Verde: rgb(100, 200, 100)
    const red = Math.round(interpolate(255, 100, clampT));
    const green = Math.round(interpolate(100, 200, clampT));
    const blue = Math.round(interpolate(100, 100, clampT));
    
    return `rgb(${red},${green},${blue})`;
  };

  const getCgaColor = (value, isTeam) => {
    if (value === undefined || value === null || Number.isNaN(Number(value))) return 'transparent';
    const v = Number(value);
    const minVal = isTeam ? minCgaTeam : minCgaGeneral;
    const maxVal = isTeam ? maxCgaTeam : maxCgaGeneral;
    
    // Normalizar valor de 0 a 1
    const t = (v - minVal) / (maxVal - minVal);
    const clampT = Math.max(0, Math.min(1, t));
    
    // INVERTIDO: Verde (baixo/bom) -> Vermelho (alto/ruim)
    // Verde: rgb(100, 200, 100) -> Vermelho: rgb(255, 100, 100)
    const red = Math.round(interpolate(100, 255, clampT));
    const green = Math.round(interpolate(200, 100, clampT));
    const blue = Math.round(interpolate(100, 100, clampT));
    
    return `rgb(${red},${green},${blue})`;
  };

  const getCghColor = (value, isTeam) => {
    if (value === undefined || value === null || Number.isNaN(Number(value))) return 'transparent';
    const v = Number(value);
    const minVal = isTeam ? minCghTeam : minCghGeneral;
    const maxVal = isTeam ? maxCghTeam : maxCghGeneral;
    
    // Normalizar valor de 0 a 1
    const t = (v - minVal) / (maxVal - minVal);
    const clampT = Math.max(0, Math.min(1, t));
    
    // INVERTIDO: Verde (baixo/bom) -> Vermelho (alto/ruim)
    // Verde: rgb(100, 200, 100) -> Vermelho: rgb(255, 100, 100)
    const red = Math.round(interpolate(100, 255, clampT));
    const green = Math.round(interpolate(200, 100, clampT));
    const blue = Math.round(interpolate(100, 100, clampT));
    
    return `rgb(${red},${green},${blue})`;
  };

  const formatGoalMetric = (generalValue, teamValue) => {
    const generalDisplay = generalValue !== undefined && generalValue !== null ? generalValue.toFixed(3) : '—';
    const teamDisplay = teamValue !== undefined && teamValue !== null ? teamValue.toFixed(3) : '—';
    return `<div style="font-size:11px;line-height:1.4;">
      <span style="padding:2px 4px;border-radius:2px;display:block;">${generalDisplay}</span>
      <span style="opacity:0.7;font-size:10px;padding:2px 4px;border-radius:2px;display:block;margin-top:2px;">${teamDisplay}</span>
    </div>`;
  };

  const formatVghMetric = (generalValue, teamValue) => {
    const generalDisplay = generalValue !== undefined && generalValue !== null ? generalValue.toFixed(2) : '—';
    const teamDisplay = teamValue !== undefined && teamValue !== null ? teamValue.toFixed(2) : '—';
    const generalColor = getVghColor(generalValue, false);
    const teamColor = getVghColor(teamValue, true);
    return `<div style="font-size:11px;line-height:1.4;">
      <span style="padding:2px 4px;border-radius:2px;display:block;background:${generalColor};color:#fff;text-shadow:0 1px 2px rgba(0,0,0,0.3);">${generalDisplay}</span>
      <span style="opacity:0.7;font-size:10px;padding:2px 4px;border-radius:2px;display:block;margin-top:2px;background:${teamColor};color:#fff;text-shadow:0 1px 2px rgba(0,0,0,0.3);">${teamDisplay}</span>
    </div>`;
  };

  const formatVgaMetric = (generalValue, teamValue) => {
    const generalDisplay = generalValue !== undefined && generalValue !== null ? generalValue.toFixed(2) : '—';
    const teamDisplay = teamValue !== undefined && teamValue !== null ? teamValue.toFixed(2) : '—';
    const generalColor = getVgaColor(generalValue, false);
    const teamColor = getVgaColor(teamValue, true);
    return `<div style="font-size:11px;line-height:1.4;">
      <span style="padding:2px 4px;border-radius:2px;display:block;background:${generalColor};color:#fff;text-shadow:0 1px 2px rgba(0,0,0,0.3);">${generalDisplay}</span>
      <span style="opacity:0.7;font-size:10px;padding:2px 4px;border-radius:2px;display:block;margin-top:2px;background:${teamColor};color:#fff;text-shadow:0 1px 2px rgba(0,0,0,0.3);">${teamDisplay}</span>
    </div>`;
  };

  const formatCgaMetric = (generalValue, teamValue) => {
    const generalDisplay = generalValue !== undefined && generalValue !== null ? generalValue.toFixed(2) : '—';
    const teamDisplay = teamValue !== undefined && teamValue !== null ? teamValue.toFixed(2) : '—';
    const generalColor = getCgaColor(generalValue, false);
    const teamColor = getCgaColor(teamValue, true);
    return `<div style="font-size:11px;line-height:1.4;">
      <span style="padding:2px 4px;border-radius:2px;display:block;background:${generalColor};color:#fff;text-shadow:0 1px 2px rgba(0,0,0,0.3);">${generalDisplay}</span>
      <span style="opacity:0.7;font-size:10px;padding:2px 4px;border-radius:2px;display:block;margin-top:2px;background:${teamColor};color:#fff;text-shadow:0 1px 2px rgba(0,0,0,0.3);">${teamDisplay}</span>
    </div>`;
  };

  const formatCghMetric = (generalValue, teamValue) => {
    const generalDisplay = generalValue !== undefined && generalValue !== null ? generalValue.toFixed(2) : '—';
    const teamDisplay = teamValue !== undefined && teamValue !== null ? teamValue.toFixed(2) : '—';
    const generalColor = getCghColor(generalValue, false);
    const teamColor = getCghColor(teamValue, true);
    return `<div style="font-size:11px;line-height:1.4;">
      <span style="padding:2px 4px;border-radius:2px;display:block;background:${generalColor};color:#fff;text-shadow:0 1px 2px rgba(0,0,0,0.3);">${generalDisplay}</span>
      <span style="opacity:0.7;font-size:10px;padding:2px 4px;border-radius:2px;display:block;margin-top:2px;background:${teamColor};color:#fff;text-shadow:0 1px 2px rgba(0,0,0,0.3);">${teamDisplay}</span>
    </div>`;
  };

  const formatIndicators = (cghGeneral, cgaGeneral, vghGeneral, vgaGeneral, cghTeam, cgaTeam, vghTeam, vgaTeam) => {
    const getIndicatorPair = (cgh, cga, vgh, vga) => {
      if (cgh === null || cga === null || vgh === null || vga === null) {
        return { casa: '—', fora: '—' };
      }
      
      const cghLessCga = cgh < cga;
      const vghGreaterVga = vgh > vga;
      
      let casa = '';
      let fora = '';
      
      // CASA (mandante)
      if (cghLessCga && vghGreaterVga) {
        casa = '<span style="color: #2e7d32; font-weight: bold;">▲▲</span>';
      } else if (cghLessCga && !vghGreaterVga) {
        casa = '<span style="color: #2e7d32; font-weight: bold;">▲</span> -';
      } else if (!cghLessCga && vghGreaterVga) {
        casa = '- <span style="color: #2e7d32; font-weight: bold;">▲</span>';
      } else {
        casa = '- -';
      }
      
      // FORA (visitante)
      if (cghLessCga && vghGreaterVga) {
        fora = '- -';
      } else if (cghLessCga && !vghGreaterVga) {
        fora = '- <span style="color: #c62828; font-weight: bold;">▼</span>';
      } else if (!cghLessCga && vghGreaterVga) {
        fora = '<span style="color: #c62828; font-weight: bold;">▼</span> -';
      } else {
        fora = '<span style="color: #c62828; font-weight: bold;">▼▼</span>';
      }
      
      return { casa, fora };
    };
    
    const generalIndicators = getIndicatorPair(cghGeneral, cgaGeneral, vghGeneral, vgaGeneral);
    const teamIndicators = getIndicatorPair(cghTeam, cgaTeam, vghTeam, vgaTeam);
    
    return {
      casa: `<div style="font-size:11px;line-height:1.4;"><span style="padding:2px 4px;border-radius:2px;display:block;">${generalIndicators.casa}</span><span style="opacity:0.7;font-size:10px;padding:2px 4px;border-radius:2px;display:block;margin-top:2px;">${teamIndicators.casa}</span></div>`,
      fora: `<div style="font-size:11px;line-height:1.4;"><span style="padding:2px 4px;border-radius:2px;display:block;">${generalIndicators.fora}</span><span style="opacity:0.7;font-size:10px;padding:2px 4px;border-radius:2px;display:block;margin-top:2px;">${teamIndicators.fora}</span></div>`
    };
  };

  let displayedCount = 0; // Reinicializar contador para contar apenas as linhas filtradas
  
  preparedRows.forEach(row => {
    // Aplicar filtros de CASA e FORA
    if (filterCasa && row.casaGeneral !== filterCasa && row.casaTeam !== filterCasa) {
      return; // Pular este jogo se não atender ao filtro de CASA
    }
    if (filterFora && row.foraGeneral !== filterFora && row.foraTeam !== filterFora) {
      return; // Pular este jogo se não atender ao filtro de FORA
    }
    if (filterContinent && row.continent !== filterContinent) {
      return; // Pular este jogo se não atender ao filtro de continente
    }
    if (filterCountry && row.country !== filterCountry) {
      return; // Pular este jogo se não atender ao filtro de país
    }
    if (filterLeague && row.league !== filterLeague) {
      return; // Pular este jogo se não atender ao filtro de liga
    }
    if (filterDate && row.rawDate && row.rawDate !== filterDate) {
      return; // Pular este jogo se não atender ao filtro de data
    }
    
    displayedCount++; // Incrementar apenas para linhas que passam pelos filtros

    const tr = document.createElement('tr');

    const cghDisplay = formatCghMetric(row.cghGeneral, row.cghTeam);
    const cgaDisplay = formatCgaMetric(row.cgaGeneral, row.cgaTeam);
    const vghDisplay = formatVghMetric(row.vghGeneral, row.vghTeam);
    const vgaDisplay = formatVgaMetric(row.vgaGeneral, row.vgaTeam);
    
    const indicators = formatIndicators(row.cghGeneral, row.cgaGeneral, row.vghGeneral, row.vgaGeneral, row.cghTeam, row.cgaTeam, row.vghTeam, row.vgaTeam);

    // Formatar coluna N Jogos com dois valores (liga / time)
    const formatSampleSize = (leagueSize, teamSize) => {
      const leagueDisplay = leagueSize > 0 ? leagueSize : '—';
      const teamDisplay = teamSize > 0 ? teamSize : '—';
      return `<div style="font-size:11px;line-height:1.4;"><span style="padding:2px 4px;border-radius:2px;display:block;">${leagueDisplay}</span><span style="opacity:0.7;font-size:10px;padding:2px 4px;border-radius:2px;display:block;margin-top:2px;">${teamDisplay}</span></div>`;
    };
    const nJogosDisplay = formatSampleSize(row.sampleSize, row.teamSampleSize);

    // Botão de entrada
    const btnEntrada = document.createElement('button');
    btnEntrada.textContent = '➕';
    btnEntrada.style.cssText = 'padding: 5px 10px; background: #0b6e4f; color: white; border: none; border-radius: 3px; cursor: pointer; font-size: 14px; font-weight: bold;';
    btnEntrada.title = 'Registrar entrada para esta partida';
    btnEntrada.addEventListener('click', () => {
      // Salvar dados da entrada no localStorage
      const entradas = JSON.parse(localStorage.getItem('entradas') || '[]');
      const novaEntrada = {
        data: row.displayDate,
        eloH: row.homeEloDisplay ? row.homeEloDisplay.replace(/<[^>]*>/g, '').trim() : '—',
        mandante: row.homeName || '—',
        visitante: row.awayName || '—',
        eloA: row.awayEloDisplay ? row.awayEloDisplay.replace(/<[^>]*>/g, '').trim() : '—',
        oddH: row.oddHValue ? row.oddHValue.toFixed(2) : '—',
        oddD: row.oddDValue ? row.oddDValue.toFixed(2) : '—',
        oddA: row.oddAValue ? row.oddAValue.toFixed(2) : '—',
        cgh: row.cghGeneral !== null && row.cghGeneral !== undefined ? row.cghGeneral : undefined,
        cga: row.cgaGeneral !== null && row.cgaGeneral !== undefined ? row.cgaGeneral : undefined,
        vgh: row.vghGeneral !== null && row.vghGeneral !== undefined ? row.vghGeneral : undefined,
        vga: row.vgaGeneral !== null && row.vgaGeneral !== undefined ? row.vgaGeneral : undefined,
        casa: row.casaGeneral || '—',
        fora: row.foraGeneral || '—',
        gh: '',
        ga: '',
        back: 'Home',
        plInv: '',
        pl: ''
      };
      entradas.unshift(novaEntrada);
      localStorage.setItem('entradas', JSON.stringify(entradas));
      alert('✅ Entrada registrada com sucesso!');
    });

    const rowData = [
      row.displayDate,
      row.homeEloDisplay,
      row.homeLink,
      row.awayLink,
      row.awayEloDisplay,
      row.homeOddsDisplay,
      row.drawOddsDisplay,
      row.awayOddsDisplay,
      row.oddHValue ? row.oddHValue.toFixed(2) : '—',
      row.oddDValue ? row.oddDValue.toFixed(2) : '—',
      row.oddAValue ? row.oddAValue.toFixed(2) : '—',
      row.confidenceDisplay,
      cghDisplay,
      vghDisplay,
      cgaDisplay,
      vgaDisplay,
      indicators.casa,
      indicators.fora,
      nJogosDisplay,
      btnEntrada
    ];

    rowData.forEach((text, idx) => {
      const td = document.createElement('td');
      if (idx === 2) td.appendChild(row.homeLink.cloneNode(true));
      else if (idx === 3) td.appendChild(row.awayLink.cloneNode(true));
      else if (idx === 19) {
        // Coluna Entrada (botão)
        td.appendChild(text);
      } else {
        if (typeof text === 'string' && (text.includes('<span') || text.includes('<div'))) {
          td.innerHTML = text;
        } else {
          td.textContent = text;
        }
      }

      if (idx === 11) {
        if (row.confidenceLevel >= 80) td.style.backgroundColor = '#c8e6c9';
        else if (row.confidenceLevel >= 50) td.style.backgroundColor = '#fff9c4';
        else if (row.confidenceLevel > 0) td.style.backgroundColor = '#ffcdd2';
      }

      if (idx === 2 || idx === 3) {
        td.style.minWidth = '110px';
        td.style.width = '130px';
        td.style.whiteSpace = 'nowrap';
      } else if (idx >= 12 && idx < 16) {
        td.style.minWidth = '21px';
        td.style.width = '25px';
        td.style.maxWidth = '29px';
        td.style.textAlign = 'center';
      } else if (idx === 16 || idx === 17) {
        // Colunas CASA e FORA
        td.style.minWidth = '35px';
        td.style.width = '40px';
        td.style.maxWidth = '45px';
        td.style.textAlign = 'center';
      } else if (idx === 18) {
        // Coluna N Jogos
        td.style.minWidth = '35px';
        td.style.width = '45px';
        td.style.maxWidth = '50px';
        td.style.textAlign = 'center';
      } else if (idx === 19) {
        // Coluna Entrada
        td.style.minWidth = '35px';
        td.style.width = '45px';
        td.style.maxWidth = '50px';
        td.style.textAlign = 'center';
      } else if (idx === 0) {
        td.style.minWidth = '65px';
        td.style.width = '70px';
        td.style.maxWidth = '75px';
        td.style.textAlign = 'center';
      } else if (idx === 1 || idx === 4) {
        td.style.minWidth = '55px';
        td.style.width = '62px';
        td.style.maxWidth = '70px';
        td.style.textAlign = 'center';
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
  
  // Atualizar contador
  const counterDiv = document.getElementById('fixtures-counter');
  if (counterDiv) {
    counterDiv.textContent = `${displayedCount} jogo(s) exibido(s)`;
  }
  
  console.log(`✓ Fixtures table rendered: ${displayedCount} matches displayed`);
  } // fim da função renderTable
  
  // Renderizar tabela inicial
  renderTable(0, 0, 'all', 'all');
  
  // Adicionar listeners aos sliders
  function updateAllSliders() {
    const minConfidence = parseInt(confidenceSlider.value);
    const minTeamConfidence = parseInt(teamConfidenceSlider.value);
    const homeEloFilter = homeEloSelect.value;
    const awayEloFilter = awayEloSelect.value;
    
    // Atualizar backgrounds dos sliders
    const confidencePercent = (minConfidence - confidenceSlider.min) / (confidenceSlider.max - confidenceSlider.min) * 100;
    confidenceSlider.style.background = `linear-gradient(to right, #0b6e4f 0%, #0b6e4f ${confidencePercent}%, #e0e0e0 ${confidencePercent}%, #e0e0e0 100%)`;
    
    const teamConfidencePercent = (minTeamConfidence - teamConfidenceSlider.min) / (teamConfidenceSlider.max - teamConfidenceSlider.min) * 100;
    teamConfidenceSlider.style.background = `linear-gradient(to right, #0b6e4f 0%, #0b6e4f ${teamConfidencePercent}%, #e0e0e0 ${teamConfidencePercent}%, #e0e0e0 100%)`;
    
    // Atualizar textos dos valores
    confidenceValueSpan.textContent = `${minConfidence}%`;
    teamConfidenceValueSpan.textContent = `${minTeamConfidence}%`;
    
    const filterCasa = document.getElementById('filter-casa')?.value || '';
    const filterFora = document.getElementById('filter-fora')?.value || '';
    const filterContinent = document.getElementById('filter-continent')?.value || '';
    const filterCountry = document.getElementById('filter-country')?.value || '';
    const filterLeague = document.getElementById('filter-league')?.value || '';
    const filterDate = document.getElementById('filter-date')?.value || '';
    
    renderTable(minConfidence, minTeamConfidence, homeEloFilter, awayEloFilter, filterCasa, filterFora, filterContinent, filterCountry, filterLeague, filterDate);
  }
  
  if (confidenceSlider) confidenceSlider.addEventListener('input', updateAllSliders);
  if (teamConfidenceSlider) teamConfidenceSlider.addEventListener('input', updateAllSliders);
  if (homeEloSelect) homeEloSelect.addEventListener('change', updateAllSliders);
  if (awayEloSelect) awayEloSelect.addEventListener('change', updateAllSliders);
  
  // Adicionar listeners aos filtros de CASA e FORA
  const filterCasaSelect = document.getElementById('filter-casa');
  const filterForaSelect = document.getElementById('filter-fora');
  if (filterCasaSelect) filterCasaSelect.addEventListener('change', updateAllSliders);
  if (filterForaSelect) filterForaSelect.addEventListener('change', updateAllSliders);
  
  // Adicionar listeners aos filtros de CONTINENTE, PAÍS e LIGA
  const filterContinentSelect = document.getElementById('filter-continent');
  const filterCountrySelect = document.getElementById('filter-country');
  const filterLeagueSelect = document.getElementById('filter-league');
  if (filterContinentSelect) filterContinentSelect.addEventListener('change', updateAllSliders);
  if (filterCountrySelect) filterCountrySelect.addEventListener('change', updateAllSliders);
  if (filterLeagueSelect) filterLeagueSelect.addEventListener('change', updateAllSliders);

  // Adicionar listener ao filtro de DATA
  const filterDateInput = document.getElementById('filter-date');
  if (filterDateInput) filterDateInput.addEventListener('change', updateAllSliders);

  // Adicionar listeners aos botões de range
  const rangeBtns = document.querySelectorAll('.range-btn');
  rangeBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const newRange = parseFloat(btn.dataset.range);
      CURRENT_MARKET_RANGE = newRange;
      console.log(`🔄 Range de odds alterado para ${(newRange*100).toFixed(0)}%`);
      
      // Atualizar classe active dos botões
      rangeBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      
      // Re-renderizar tabela
      const minConfidence = parseInt(confidenceSlider.value);
      const minTeamConfidence = parseInt(teamConfidenceSlider.value);
      const homeEloFilter = homeEloSelect.value;
      const awayEloFilter = awayEloSelect.value;
      const filterCasa = document.getElementById('filter-casa')?.value || '';
      const filterFora = document.getElementById('filter-fora')?.value || '';
      const filterContinent = document.getElementById('filter-continent')?.value || '';
      const filterCountry = document.getElementById('filter-country')?.value || '';
      const filterLeague = document.getElementById('filter-league')?.value || '';
      const filterDate = document.getElementById('filter-date')?.value || '';
      renderTable(minConfidence, minTeamConfidence, homeEloFilter, awayEloFilter, filterCasa, filterFora, filterContinent, filterCountry, filterLeague, filterDate);
    });
  });

  } catch(error) {
    console.error('Error rendering fixtures:', error);
    const root = document.getElementById('fixtures-root');
    if (root) {
      root.innerHTML = `<p style="color: red;">Erro ao carregar fixtures: ${error.message}</p>`;
    }
  }
}

// Ensure DOM is ready before initializing
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
