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
  if (['npb', 'kbo', 'cpbl'].includes(sport)) return ASIA_TEAM_ZH[normalizeTeamName(name)] ?? name;
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

// Every league the page lists: ESPN path, kind of sport (which markets it
// gets) and ESPN's league logo id for soccer. Order is the sport filter's.
export const LEAGUES = {
  mlb: { family: 'baseball', path: 'baseball/mlb' },
  nfl: { family: 'football', path: 'football/nfl' },
  ncaaf: { family: 'football', path: 'football/college-football' },
  nba: { family: 'basketball', path: 'basketball/nba' },
  wnba: { family: 'basketball', path: 'basketball/wnba' },
  nhl: { family: 'hockey', path: 'hockey/nhl' },
  epl: { family: 'soccer', path: 'soccer/eng.1', logo: 23 },
  laliga: { family: 'soccer', path: 'soccer/esp.1', logo: 15 },
  seriea: { family: 'soccer', path: 'soccer/ita.1', logo: 12 },
  bundesliga: { family: 'soccer', path: 'soccer/ger.1', logo: 10 },
  ligue1: { family: 'soccer', path: 'soccer/fra.1', logo: 9 },
  ucl: { family: 'soccer', path: 'soccer/uefa.champions', logo: 2 },
  uel: { family: 'soccer', path: 'soccer/uefa.europa', logo: 2310 },
  eredivisie: { family: 'soccer', path: 'soccer/ned.1', logo: 11 },
  primeira: { family: 'soccer', path: 'soccer/por.1', logo: 14 },
  championship: { family: 'soccer', path: 'soccer/eng.2', logo: 24 },
  mls: { family: 'soccer', path: 'soccer/usa.1', logo: 19 },
  ligamx: { family: 'soccer', path: 'soccer/mex.1', logo: 22 },
  jleague: { family: 'soccer', path: 'soccer/jpn.1', logo: 2199 },
  // From Kambi's public odds (one bookmaker's line). Asian baseball and
  // basketball use their kind of sport's markets; the rest are played in
  // sets (`sets`: best of how many, and what a set is made of). Only tennis
  // has an automatic result (ESPN); the others settle from the live score
  // once the match is decided, or by hand.
  npb: { family: 'baseball', kambi: 'baseball/japan/npb', icon: '⚾', badge: 'lk85rg1575038781' },
  kbo: { family: 'baseball', kambi: 'baseball/south_korea/kbo_league', icon: '⚾', badge: 'qfr1hx1589707979' },
  cpbl: { family: 'baseball', kambi: 'baseball/taiwan/chinese_professional_baseball', icon: '⚾', badge: 'c3vetj1655924198' },
  euroleague: { family: 'basketball', kambi: 'basketball/euroleague', icon: '🏀', badge: '7xjtuy1554397263' },
  bleague: { family: 'basketball', kambi: 'basketball/japan/b1__league', icon: '🏀', badge: 'vcx6gw1745501883' },
  tennis: { family: 'sets', kambi: 'tennis/atp', icon: '🎾', neutral: true, sets: { bestOf: 3, unit: 'games', target: 6 }, results: 'tennis/atp' },
  wta: { family: 'sets', kambi: 'tennis/wta', icon: '🎾', badge: 'bddhun1768230678', neutral: true, sets: { bestOf: 3, unit: 'games', target: 6 }, results: 'tennis/wta' },
  badminton: { family: 'sets', kambi: 'badminton', icon: '🏸', badge: 'd5xvqq1750423289', neutral: true, sets: { bestOf: 3, unit: 'points', target: 21, cap: 30 } },
  tabletennis: { family: 'sets', kambi: 'table_tennis', icon: '🏓', badge: 'fvesg01750422363', neutral: true, sets: { bestOf: 5, unit: 'points', target: 11 }, cap: 16 },
  volleyball: { family: 'sets', kambi: 'volleyball', icon: '🏐', sets: { bestOf: 5, unit: 'points', target: 25, last: 15 }, cap: 16 },
  snooker: { family: 'sets', kambi: 'snooker', icon: '🎱', badge: '0gmkgj1555600537', neutral: true, sets: { bestOf: null, unit: 'frames' } }
};

// Leagues from Kambi.
export const KAMBI_LEAGUES = Object.keys(LEAGUES).filter(key => LEAGUES[key].kambi);
export const isSets = sport => LEAGUES[sport]?.family === 'sets';
// Played at a neutral venue by players, not home and away clubs.
export const isNeutral = sport => Boolean(LEAGUES[sport]?.neutral);

// Asian baseball clubs as Taiwan writes them, keyed by normalizeTeamName().
const ASIA_TEAM_ZH = {
  // CPBL
  'tsg hawks': '台鋼雄鷹', 'uni lions': '統一7-ELEVEn獅', 'fubon guardians': '富邦悍將', 'chinatrust brothers': '中信兄弟', 'ctbc brothers': '中信兄弟', 'rakuten monkeys': '樂天桃猿', 'wei chuan dragons': '味全龍',
  // NPB
  'yomiuri giants': '讀賣巨人', 'hanshin tigers': '阪神虎', 'chunichi dragons': '中日龍', 'yokohama dena baystars': '橫濱DeNA海灣之星', 'hiroshima toyo carp': '廣島東洋鯉魚', 'tokyo yakult swallows': '東京養樂多燕子', 'fukuoka softbank hawks': '福岡軟銀鷹', 'hokkaido nippon ham fighters': '北海道日本火腿鬥士', 'chiba lotte marines': '千葉羅德海洋', 'tohoku rakuten golden eagles': '東北樂天金鷲', 'orix buffaloes': '歐力士猛牛', 'saitama seibu lions': '埼玉西武獅',
  // KBO
  'kia tigers': '起亞虎', 'samsung lions': '三星獅', 'lg twins': 'LG雙子', 'doosan bears': '斗山熊', 'kt wiz': 'KT巫師', 'ssg landers': 'SSG登陸者', 'lotte giants': '樂天巨人', 'hanwha eagles': '韓華鷹', 'nc dinos': 'NC恐龍', 'kiwoom heroes': '培證英雄',
  // Kambi's spellings
  'yokohama bay stars': '橫濱DeNA海灣之星', 'nippon ham fighters': '北海道日本火腿鬥士', 'rakuten golden eagles': '東北樂天金鷲', 'seibu lions': '埼玉西武獅', 'kt wiz suwon': 'KT巫師', 'yomiuri': '讀賣巨人', 'hiroshima carp': '廣島東洋鯉魚'
};

export function familyOf(sport) {
  return sport === 'f1' ? 'racing' : LEAGUES[sport]?.family ?? null;
}

export const isSoccer = sport => familyOf(sport) === 'soccer';

// Logos ESPN's scoreboards give for teams of leagues without a table here.
const seenLogos = new Map();
export function rememberLogo(sport, name, url) {
  if (url) seenLogos.set(`${sport}|${normalizeTeamName(name)}`, url);
}

// Club badges from TheSportsDB (free, hot-linkable) for the leagues ESPN
// doesn't cover, by club name; a feed's own spelling finds its club by the
// words the names share (Kambi's "Yokohama Bay Stars", "KT Wiz Suwon").
const SPORTSDB = 'https://r2.thesportsdb.com/images/media';
const TEAM_BADGES = {
  cpbl: { 'CTBC Brothers': 'nbtugc1655923087', 'Fubon Guardians': 'aj83wn1655923095', 'Rakuten Monkeys': 'kk0rch1655923103', 'TSG Hawks': 'n67jn51712658044', 'Uni-President Lions': 'kehxfy1655923111', 'Wei Chuan Dragons': 'ljv5o51655923122' },
  npb: { 'Chiba Lotte Marines': 'na10tn1576008207', 'Chunichi Dragons': 'jli5jv1576009060', 'Fukuoka SoftBank Hawks': 'ampozy1576009547', 'Hanshin Tigers': 'h2jhos1576009994', 'Hiroshima Toyo Carp': 'bv50e51576010505', 'Hokkaido Nippon-Ham Fighters': 'qxgzq01576011016', 'Orix Buffaloes': '53lv6f1576011517', 'Saitama Seibu Lions': 'onmvow1576012163', 'Tohoku Rakuten Golden Eagles': 'qx24pm1576012656', 'Tokyo Yakult Swallows': 'ryyku01576013231', 'Yokohama DeNA BayStars': 'fuhqf21576013789', 'Yomiuri Giants': '0qyqs41576014298' },
  kbo: { 'Doosan Bears': '2qo9zp1740573854', 'Hanwha Eagles': '7aztmc1740573842', 'KT Wiz': 'qk8erg1589709962', 'Kia Tigers': '2z389i1648069353', 'Kiwoom Heroes': 'qcj18p1589709259', 'LG Twins': 'ajpsiq1648069368', 'Lotte Giants': 'p7q92w1742225576', 'NC Dinos': '6gwcg81589708218', 'SSG Landers': 'kii9pd1742225451', 'Samsung Lions': '5u6k511589709673' },
  bleague: { 'Akita Northern Happinets': '87wsa61621334052', 'Altiri Chiba': '3mfjwn1759500326', 'Alvark Tokyo': 'kj4q7w1621334166', 'Chiba Jets Funabashi': '8usqds1737546623', 'Fighting Eagles Nagoya': 'b0rwjq1659455177', 'Gunma Crane Thunders': '9e5cxi1642097069', 'Hiroshima D': 'ex7l321622396493', 'Ibaraki Robots': 'nscmq91642097142', 'Kawasaki Brave Thunders': '9ahvnv1621334572', 'Kobe Storks': 'u13mbp1787663428', 'Koshigaya Alphas': 'lr8jgm1737548387', 'Kyoto Hannaryz': '229szh1621546129', 'Levanga Hokkaido': 'pw4n7h1622396675', 'Nagasaki Velca': 'dlywny1713956438', 'Nagoya Diamond Dolphins': 't8bcpf1622396582', 'Osaka Evessa': 'au25qr1621545182', 'Ryukyu Golden Kings': 'y9cedk1621346537', 'Saga Ballooners': 'nplg6o1713956383', 'SeaHorses Mikawa': '9eng811621456481', 'Sendai 89ers': 'x0nmfz1659455283', 'Shimane Susanoo Magic': 'db6kqq1621545848', 'Shinshu Brave Warriors': 'i9a85l1622396401', 'Tokyo SunRockers': 'jq3nm11586269789', 'Toyama Grouses': 'o34c4j1621346928', 'Utsunomiya Brex': 'id293x1621346227', 'Yokohama B-Corsairs': 'y6p5601723024480' },
  euroleague: { 'AS Monaco Basket': 'fl2ti01649168915', 'Anadolu Efes SK': 'uldz0d1782050729', 'BC Žalgiris': 'dn7ouv1703960565', 'Baskonia': 'p4x3o61767366090', 'Bayern München Basketball': 'z2r3eh1678017187', 'Dubai Basketball': 'fgtnti1758215967', 'FC Barcelona Basquet': '0tz26j1729097443', 'Hapoel Tel Aviv BC': 'yrrsml1767366305', 'KK Crvena zvezda': '5tlez31767366440', 'KK Partizan': 'us0e1z1767366567', 'Maccabi Tel Aviv BC': 'z0mk1l1789281457', 'Olimpia Milano': 'aurbi61790186853', 'Olympiacos BC': '4s5lug1676581220', 'Panathinaikos BC': '7cdjwz1767366987', 'Paris Basketball': '9q0d6x1726681476', 'Real Madrid Baloncesto': 'g4ev2c1522175902', 'Valencia Basket': '9qyc231536398868' }
};
// Words too common to tell clubs apart.
const COMMON_WORDS = new Set(['basket', 'basketball', 'baloncesto', 'club', 'tokyo', 'osaka', 'nagoya', 'city', 'the']);
const badgeIndex = new Map();
function teamBadge(sport, name) {
  const table = TEAM_BADGES[sport];
  if (!table || !name) return null;
  if (!badgeIndex.has(sport)) badgeIndex.set(sport, Object.entries(table).map(([club, id]) => ({ norm: normalizeTeamName(club), words: new Set(normalizeTeamName(club).split(' ')), id })));
  const clubs = badgeIndex.get(sport);
  const norm = normalizeTeamName(name);
  let best = clubs.find(c => c.norm === norm || c.norm.includes(norm) || norm.includes(c.norm));
  if (!best) {
    let most = 0;
    for (const c of clubs) {
      const shared = norm.split(' ').filter(w => w.length >= 4 && !COMMON_WORDS.has(w) && c.words.has(w)).length;
      if (shared > most) [best, most] = [c, shared];
    }
  }
  return best ? `${SPORTSDB}/team/badge/${best.id}.png/small` : null;
}

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
  const seen = seenLogos.get(`${sport}|${normalizeTeamName(name)}`);
  if (!seen) return dark ? null : teamBadge(sport, name);
  return dark ? seen.replace('/500/', '/500-dark/') : seen;
}

// The league's own logo.
export function leagueLogo(sport, dark = false) {
  const size = dark ? '500-dark' : '500';
  // The lion alone: ESPN's own resizer crops the top of its logo, clear of
  // the "Premier League" wordmark (the same crop Match-Find uses).
  if (sport === 'epl') return 'https://a.espncdn.com/combiner/i?img=/i/leaguelogos/soccer/500/23.png&w=128&h=80&scale=crop&location=origin';
  if (['mlb', 'nba', 'f1', 'nfl', 'nhl', 'wnba'].includes(sport)) return `https://a.espncdn.com/i/teamlogos/leagues/${size}/${sport}.png`;
  if (sport === 'ncaaf') return 'https://a.espncdn.com/i/espn/misc_logos/500/ncaa_football.png';
  // TheSportsDB's badge (ATP's is white on white: its emoji instead).
  if (LEAGUES[sport]?.badge) return `${SPORTSDB}/league/badge/${LEAGUES[sport].badge}.png/small`;
  const id = LEAGUES[sport]?.logo;
  return id ? `https://a.espncdn.com/i/leaguelogos/soccer/500/${id}.png` : null;
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

// Driver names as the lottery writes them ("G.羅素"). The ones on the
// 2026 Azerbaijan GP board are the lottery's own; the rest follow the usual
// Taiwanese transliteration.
const F1_ZH = {
  Russell: 'G.羅素',
  Antonelli: 'AK.安東內利',
  Leclerc: 'C.勒克萊爾',
  Piastri: 'O.皮亞斯特里',
  Verstappen: 'M.維斯塔潘',
  Hamilton: 'L.漢米爾頓',
  Norris: 'L.諾里斯',
  Hadjar: 'I.哈賈爾',
  Gasly: 'P.蓋斯利',
  Sainz: 'C.塞恩斯',
  Colapinto: 'F.科拉平托',
  Stroll: 'L.斯托羅爾',
  Perez: 'S.培瑞茲',
  Alonso: 'F.阿隆索',
  Albon: 'A.艾爾朋',
  Lawson: 'L.勞森',
  Lindblad: 'A.林德布拉德',
  Ocon: 'E.歐康',
  Bearman: 'O.貝爾曼',
  Hulkenberg: 'N.霍肯伯格',
  Bortoleto: 'G.博托萊托',
  Bottas: 'V.博塔斯',
  Tsunoda: 'Y.角田裕毅'
};

// { team, color, zh } for a driver's full name ("Carlos Sainz Jr."), or a neutral badge.
export function f1Driver(name) {
  const plain = (name || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  const zh = Object.entries(F1_ZH).find(([d]) => new RegExp(`\\b${d}\\b`, 'i').test(plain))?.[1] ?? name;
  for (const team of Object.values(F1_TEAMS)) {
    if (team.drivers.some(d => new RegExp(`\\b${d}\\b`, 'i').test(plain))) return { team: team.name, color: team.color, zh };
  }
  return { team: '', color: '#8a8f98', zh };
}

// Every club of a league we have a logo for, one name each (aliases dropped):
// English names as the feeds write them. For games that show a team.
const titleCase = key => key.replace(/\b[a-z]/g, c => c.toUpperCase());
// Clubs of other leagues, from ESPN's team lists (rememberTeams).
const fetchedTeams = new Map();
export function rememberTeams(sport, teams) {
  for (const { name, logo } of teams) rememberLogo(sport, name, logo);
  fetchedTeams.set(sport, teams.map(t => t.name));
}
export const hasTeams = sport => leagueTeams(sport).length > 0;
export function leagueTeams(sport) {
  let names = [];
  if (sport === 'mlb') names = Object.keys(MLB_ABBR);
  else if (sport === 'nba') names = Object.keys(NBA_ABBR);
  else if (sport === 'epl') names = Object.keys(EPL_ESPN_ID).map(titleCase);
  else if (TEAM_BADGES[sport]) names = Object.keys(TEAM_BADGES[sport]);
  else names = fetchedTeams.get(sport) ?? [];
  const seen = new Set();
  return names.filter(name => {
    const logo = teamLogo(sport, name);
    if (!logo || seen.has(logo)) return false;
    seen.add(logo);
    return true;
  });
}
