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

// Premier League clubs, keyed by normalizeTeamName(). Includes recently
// promoted/relegated clubs, since the league changes every season.
const EPL_TEAM_ZH_BY_KEY = {
  arsenal: '阿森納',
  'aston villa': '阿斯頓維拉',
  bournemouth: '伯恩茅斯',
  brentford: '布倫特福',
  'brighton hove albion': '布萊頓',
  burnley: '伯恩利',
  chelsea: '切爾西',
  'coventry city': '考文垂城',
  'crystal palace': '水晶宮',
  everton: '埃弗頓',
  fulham: '富勒姆',
  'hull city': '赫爾城',
  'ipswich town': '伊普斯維奇',
  'leeds united': '里茲聯',
  'leicester city': '萊斯特城',
  liverpool: '利物浦',
  'manchester city': '曼城',
  'manchester united': '曼聯',
  'newcastle united': '紐卡索聯',
  'nottingham forest': '諾丁漢森林',
  southampton: '南安普頓',
  sunderland: '桑德蘭',
  'tottenham hotspur': '托特納姆熱刺',
  'west ham united': '西漢姆聯',
  'wolverhampton wanderers': '狼隊'
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
  return MLB_TEAM_ZH[name] ?? name;
}
