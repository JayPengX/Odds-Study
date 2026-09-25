// MLB team names as Taiwan Sports Lottery writes them. Astros/Athletics weren't
// in any captured lottery page, so those two are the usual Taiwanese names.
export const MLB_TEAM_ZH = {
  'Arizona Diamondbacks': '亞歷桑那響尾蛇',
  Athletics: '運動家',
  'Atlanta Braves': '亞特蘭大勇士',
  'Baltimore Orioles': '巴爾的摩金鶯',
  'Boston Red Sox': '波士頓紅襪',
  'Chicago Cubs': '芝加哥小熊',
  'Chicago White Sox': '芝加哥白襪',
  'Cincinnati Reds': '辛辛那堤紅人',
  'Cleveland Guardians': '克里夫蘭守護者',
  'Colorado Rockies': '科羅拉多落磯',
  'Detroit Tigers': '底特律老虎',
  'Houston Astros': '休士頓太空人',
  'Kansas City Royals': '堪薩斯皇家',
  'Los Angeles Angels': '洛杉磯天使',
  'Los Angeles Dodgers': '洛杉磯道奇',
  'Miami Marlins': '邁阿密馬林魚',
  'Milwaukee Brewers': '密爾瓦基釀酒人',
  'Minnesota Twins': '明尼蘇達雙城',
  'New York Mets': '紐約大都會',
  'New York Yankees': '紐約洋基',
  'Philadelphia Phillies': '費城費城人',
  'Pittsburgh Pirates': '匹茲堡海盜',
  'San Diego Padres': '聖地牙哥教士',
  'San Francisco Giants': '舊金山巨人',
  'Seattle Mariners': '西雅圖水手',
  'St. Louis Cardinals': '聖路易紅雀',
  'Tampa Bay Rays': '坦帕灣光芒',
  'Texas Rangers': '德州遊騎兵',
  'Toronto Blue Jays': '多倫多藍鳥',
  'Washington Nationals': '華盛頓國民'
};

// Premier League clubs, keyed by normalizeTeamName(), as the lottery wrote
// them on 2026-09-25. Includes recently promoted/relegated clubs, since the
// league changes every season.
const EPL_TEAM_ZH_BY_KEY = {
  arsenal: '兵工廠',
  'aston villa': '阿斯頓維拉',
  bournemouth: '伯恩茅斯',
  brentford: '布倫特福德',
  brighton: '布萊頓',
  'brighton hove albion': '布萊頓',
  burnley: '伯恩利',
  chelsea: '切爾西',
  'coventry city': '科芬特里城',
  'crystal palace': '水晶宮',
  everton: '艾佛頓',
  fulham: '富勒姆',
  'hull city': '赫爾城',
  'ipswich town': '伊普斯維奇',
  'leeds united': '利茲聯',
  'leicester city': '萊斯特城',
  liverpool: '利物浦',
  'manchester city': '曼城',
  'manchester united': '曼聯',
  'newcastle united': '紐卡索聯',
  'nottingham forest': '諾丁漢森林',
  southampton: '南安普頓',
  sunderland: '桑德蘭',
  tottenham: '托特納姆熱刺',
  'tottenham hotspur': '托特納姆熱刺',
  'west ham united': '西漢姆聯',
  'wolverhampton wanderers': '狼隊'
};

// NBA teams in the usual Taiwanese names. The lottery doesn't offer the NBA
// title yet, so these aren't checked against it.
export const NBA_TEAM_ZH = {
  'Atlanta Hawks': '亞特蘭大老鷹',
  'Boston Celtics': '波士頓塞爾提克',
  'Brooklyn Nets': '布魯克林籃網',
  'Charlotte Hornets': '夏洛特黃蜂',
  'Chicago Bulls': '芝加哥公牛',
  'Cleveland Cavaliers': '克里夫蘭騎士',
  'Dallas Mavericks': '達拉斯獨行俠',
  'Denver Nuggets': '丹佛金塊',
  'Detroit Pistons': '底特律活塞',
  'Golden State Warriors': '金州勇士',
  'Houston Rockets': '休士頓火箭',
  'Indiana Pacers': '印第安納溜馬',
  'Los Angeles Clippers': '洛杉磯快艇',
  'LA Clippers': '洛杉磯快艇',
  'Los Angeles Lakers': '洛杉磯湖人',
  'Memphis Grizzlies': '曼菲斯灰熊',
  'Miami Heat': '邁阿密熱火',
  'Milwaukee Bucks': '密爾瓦基公鹿',
  'Minnesota Timberwolves': '明尼蘇達灰狼',
  'New Orleans Pelicans': '紐奧良鵜鶘',
  'New York Knicks': '紐約尼克',
  'Oklahoma City Thunder': '奧克拉荷馬雷霆',
  'Orlando Magic': '奧蘭多魔術',
  'Philadelphia 76ers': '費城 76 人',
  'Phoenix Suns': '鳳凰城太陽',
  'Portland Trail Blazers': '波特蘭拓荒者',
  'Sacramento Kings': '沙加緬度國王',
  'San Antonio Spurs': '聖安東尼奧馬刺',
  'Toronto Raptors': '多倫多暴龍',
  'Utah Jazz': '猶他爵士',
  'Washington Wizards': '華盛頓巫師'
};

// Strips club-suffix boilerplate so ESPN's "Liverpool" matches Polymarket's
// "Liverpool FC" and "AFC Bournemouth" matches "Bournemouth".
export function normalizeTeamName(name) {
  return (name || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' ')
    .replace(/\b(fc|afc|cf|sc|and)\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function teamZh(sport, name) {
  if (sport === 'epl') return EPL_TEAM_ZH_BY_KEY[normalizeTeamName(name)] ?? name;
  if (sport === 'nba') return NBA_TEAM_ZH[name] ?? name;
  return MLB_TEAM_ZH[name] ?? name;
}

// ---- Logos ------------------------------------------------------------------

// ESPN's logo files: MLB and NBA by abbreviation, soccer clubs by ESPN id.
const MLB_ABBR = {
  'Arizona Diamondbacks': 'ari', Athletics: 'ath', 'Oakland Athletics': 'ath', 'Atlanta Braves': 'atl', 'Baltimore Orioles': 'bal',
  'Boston Red Sox': 'bos', 'Chicago Cubs': 'chc', 'Chicago White Sox': 'chw', 'Cincinnati Reds': 'cin', 'Cleveland Guardians': 'cle',
  'Colorado Rockies': 'col', 'Detroit Tigers': 'det', 'Houston Astros': 'hou', 'Kansas City Royals': 'kc', 'Los Angeles Angels': 'laa',
  'Los Angeles Dodgers': 'lad', 'Miami Marlins': 'mia', 'Milwaukee Brewers': 'mil', 'Minnesota Twins': 'min', 'New York Mets': 'nym',
  'New York Yankees': 'nyy', 'Philadelphia Phillies': 'phi', 'Pittsburgh Pirates': 'pit', 'San Diego Padres': 'sd', 'San Francisco Giants': 'sf',
  'Seattle Mariners': 'sea', 'St. Louis Cardinals': 'stl', 'Tampa Bay Rays': 'tb', 'Texas Rangers': 'tex', 'Toronto Blue Jays': 'tor',
  'Washington Nationals': 'wsh'
};
const NBA_ABBR = {
  'Atlanta Hawks': 'atl', 'Boston Celtics': 'bos', 'Brooklyn Nets': 'bkn', 'Charlotte Hornets': 'cha', 'Chicago Bulls': 'chi',
  'Cleveland Cavaliers': 'cle', 'Dallas Mavericks': 'dal', 'Denver Nuggets': 'den', 'Detroit Pistons': 'det', 'Golden State Warriors': 'gs',
  'Houston Rockets': 'hou', 'Indiana Pacers': 'ind', 'Los Angeles Clippers': 'lac', 'LA Clippers': 'lac', 'Los Angeles Lakers': 'lal',
  'Memphis Grizzlies': 'mem', 'Miami Heat': 'mia', 'Milwaukee Bucks': 'mil', 'Minnesota Timberwolves': 'min', 'New Orleans Pelicans': 'no',
  'New York Knicks': 'ny', 'Oklahoma City Thunder': 'okc', 'Orlando Magic': 'orl', 'Philadelphia 76ers': 'phi', 'Phoenix Suns': 'phx',
  'Portland Trail Blazers': 'por', 'Sacramento Kings': 'sac', 'San Antonio Spurs': 'sa', 'Toronto Raptors': 'tor', 'Utah Jazz': 'utah',
  'Washington Wizards': 'wsh'
};
const EPL_ESPN_ID = {
  arsenal: 359, 'aston villa': 362, bournemouth: 349, brentford: 337, brighton: 331, 'brighton hove albion': 331, burnley: 379,
  chelsea: 363, 'coventry city': 388, 'crystal palace': 384, everton: 368, fulham: 370, 'hull city': 306, 'ipswich town': 373,
  'leeds united': 357, 'leicester city': 375, liverpool: 364, 'manchester city': 382, 'manchester united': 360,
  'newcastle united': 361, 'nottingham forest': 393, southampton: 376, sunderland: 366, tottenham: 367, 'tottenham hotspur': 367,
  'west ham united': 371, 'wolverhampton wanderers': 380, wolves: 380
};

// Logo URL for a team (English name as the sources write it), or null. ESPN
// has a version of every logo for dark backgrounds (`dark`).
export function teamLogo(sport, name, dark = false) {
  const base = 'https://a.espncdn.com/i/teamlogos';
  const size = dark ? '500-dark' : '500';
  if (sport === 'mlb') return MLB_ABBR[name] ? `${base}/mlb/${size}/${MLB_ABBR[name]}.png` : null;
  if (sport === 'nba') return NBA_ABBR[name] ? `${base}/nba/${size}/${NBA_ABBR[name]}.png` : null;
  if (sport === 'epl') {
    const id = EPL_ESPN_ID[normalizeTeamName(name)];
    return id ? `${base}/soccer/${size}/${id}.png` : null;
  }
  return null;
}

// The league's own logo.
export function leagueLogo(sport, dark = false) {
  const size = dark ? '500-dark' : '500';
  // The lion alone: ESPN's own resizer crops the top of its logo, clear of
  // the "Premier League" wordmark (the same crop Match-Find uses).
  if (sport === 'epl') return 'https://a.espncdn.com/combiner/i?img=/i/leaguelogos/soccer/500/23.png&w=128&h=80&scale=crop&location=origin';
  if (['mlb', 'nba', 'f1'].includes(sport)) return `https://a.espncdn.com/i/teamlogos/leagues/${size}/${sport}.png`;
  return null;
}

// 2026 F1 grid: each driver's team and its colour, for the driver badges.
const F1_TEAMS = {
  mclaren: { name: 'McLaren', color: '#ff8000', drivers: ['Norris', 'Piastri'] },
  ferrari: { name: 'Ferrari', color: '#e8002d', drivers: ['Leclerc', 'Hamilton'] },
  redbull: { name: 'Red Bull', color: '#3671c6', drivers: ['Verstappen', 'Hadjar'] },
  mercedes: { name: 'Mercedes', color: '#00d2be', drivers: ['Russell', 'Antonelli'] },
  aston: { name: 'Aston Martin', color: '#229971', drivers: ['Alonso', 'Stroll'] },
  alpine: { name: 'Alpine', color: '#ff87bc', drivers: ['Gasly', 'Colapinto'] },
  williams: { name: 'Williams', color: '#64c4ff', drivers: ['Albon', 'Sainz'] },
  rb: { name: 'Racing Bulls', color: '#6692ff', drivers: ['Lawson', 'Lindblad'] },
  haas: { name: 'Haas', color: '#9ea3a8', drivers: ['Ocon', 'Bearman'] },
  audi: { name: 'Audi', color: '#bb0a30', drivers: ['Hulkenberg', 'Bortoleto'] },
  cadillac: { name: 'Cadillac', color: '#c9a227', drivers: ['Perez', 'Bottas'] }
};

// { team, color } for a driver's full name ("Carlos Sainz Jr."), or a neutral badge.
export function f1Driver(name) {
  const plain = (name || '').normalize('NFKD').replace(/[̀-ͯ]/g, '');
  for (const team of Object.values(F1_TEAMS)) {
    if (team.drivers.some(d => new RegExp(`\\b${d}\\b`, 'i').test(plain))) return { team: team.name, color: team.color };
  }
  return { team: '', color: '#8a8f98' };
}
