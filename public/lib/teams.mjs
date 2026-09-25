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
