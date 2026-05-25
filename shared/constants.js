// ════════════════════════════════════════
//  shared/constants.js
//  前後端共用常數，直接從台灣麻將.html 抽出
//  Node.js: require('./shared/constants')
//  瀏覽器: <script type="module"> import
// ════════════════════════════════════════

// ── 牌名定義 ────────────────────────────
const WAN   = ['一萬','二萬','三萬','四萬','五萬','六萬','七萬','八萬','九萬'];
const TONG  = ['一筒','二筒','三筒','四筒','五筒','六筒','七筒','八筒','九筒'];
const SUO   = ['一索','二索','三索','四索','五索','六索','七索','八索','九索'];
const HONOR = ['東','南','西','北','中','發','白'];
// 花牌：台灣16張制補花用（春夏秋冬 + 梅蘭菊竹）
const FLOWER = ['春','夏','秋','冬','梅','蘭','菊','竹'];

const NUMBERED   = [...WAN, ...TONG, ...SUO];
const ALL_NAMES  = [...NUMBERED, ...HONOR];        // 不含花，136張用
const SORT_ORDER = [...ALL_NAMES, ...FLOWER];

// 21種順子
const SEQS = [];
for (let i = 0; i < 7; i++) {
  SEQS.push([WAN[i],  WAN[i+1],  WAN[i+2]]);
  SEQS.push([TONG[i], TONG[i+1], TONG[i+2]]);
  SEQS.push([SUO[i],  SUO[i+1],  SUO[i+2]]);
}

// ── 房間類型 ─────────────────────────────
const ROOM_TYPES = {
  SHORT:   'short',    // 短打廳 1/4圈
  PUBLIC:  'public',   // 大眾廳 1圈
  DIAMOND: 'diamond',  // 鑽石廳 2圈
};

// 桌金配置 { betAmount: baseBet, taiUnit }
const BET_CONFIGS = {
  // 短打廳（1/4 圈 = 1 局）
  '10_3':     { baseBet: 10,   taiUnit: 3,   roomType: 'short',   totalRounds: 1 },
  '100_30':   { baseBet: 100,  taiUnit: 30,  roomType: 'short',   totalRounds: 1 },
  '1000_300': { baseBet: 1000, taiUnit: 300, roomType: 'short',   totalRounds: 1 },
  // 大眾廳（1 圈 = 4 局）
  '100_30p':  { baseBet: 100,  taiUnit: 30,  roomType: 'public',  totalRounds: 4 },
  // 鑽石廳（1 圈 = 4 局）
  '1000_300d':{ baseBet: 1000, taiUnit: 300, roomType: 'diamond', totalRounds: 4 },
};

// ── 遊戲參數 ─────────────────────────────
const SEATS = ['east', 'south', 'west', 'north'];  // 東南西北
const SEAT_WINDS = { east:'東', south:'南', west:'西', north:'北' };
const MAX_PLAYERS = 4;
const INIT_HAND   = 13;   // 閒家起手張數
const DEALER_HAND = 16;   // 莊家起手張數（台灣16張制）
const BANKRUPT_THRESHOLD = 3410;
const INIT_COINS  = 1000; // 新帳號贈送

// ── VIP 等級規則 ──────────────────────────
const VIP_LEVELS = [
  { level: 0,  minVP: 0,      dailyHongbao: 1  },
  { level: 1,  minVP: 1,      dailyHongbao: 3  },
  { level: 2,  minVP: 300,    dailyHongbao: 5  },
  { level: 3,  minVP: 1000,   dailyHongbao: 8  },
  { level: 4,  minVP: 2000,   dailyHongbao: 10 },
  { level: 5,  minVP: 3000,   dailyHongbao: 12 },
  { level: 6,  minVP: 5000,   dailyHongbao: 14 },
  { level: 7,  minVP: 10000,  dailyHongbao: 16 },
  { level: 8,  minVP: 30000,  dailyHongbao: 18 },
  { level: 9,  minVP: 50000,  dailyHongbao: 20 },
  { level: 10, minVP: 100000, dailyHongbao: 22 },
];

// ── Socket.io 事件名稱 ────────────────────
const EVENTS = {
  // Client → Server
  JOIN_ROOM:       'join_room',
  READY:           'ready',
  PLAY_TILE:       'play_tile',
  DECLARE_ACTION:  'declare_action',   // peng/gang/hu/pass/chow
  DECLARE_TING:    'declare_ting',
  REQUEST_AI:      'request_ai',       // 玩家要求AI代打

  // Server → Client
  ROOM_STATE:      'room_state',
  GAME_START:      'game_start',
  TILE_DRAWN:      'tile_drawn',       // 摸牌結果（只給當事人）
  TILE_PLAYED:     'tile_played',      // 有人出牌
  ACTION_REQUIRED: 'action_required',  // 輪到你動作（含timeout）
  ACTION_RESULT:   'action_result',    // 碰/槓/吃結果廣播
  GAME_END:        'game_end',
  LEVEL_UP:        'level_up',
  ERROR:           'game_error',
};

// ── 動作類型 ──────────────────────────────
const ACTIONS = {
  DRAW:  'draw',
  PLAY:  'play',
  PONG:  'pong',
  KONG:  'kong',
  CHOW:  'chow',
  HU:    'hu',
  PASS:  'pass',
  TING:  'ting',
};

// ── 遊戲內快捷語 ─────────────────────────
const QUICK_CHAT = [
  { id: 'gg',      text: 'GG！',         emoji: '🤝' },
  { id: 'nice',    text: '好牌！',        emoji: '👍' },
  { id: 'sorry',   text: '對不起！',      emoji: '🙏' },
  { id: 'lol',     text: '哈哈哈！',      emoji: '😂' },
  { id: 'rush',    text: '快點！',        emoji: '⏰' },
  { id: 'wait',    text: '等一下！',      emoji: '✋' },
  { id: 'lucky',   text: '運氣真好！',    emoji: '🍀' },
  { id: 'win',     text: '我要贏了！',    emoji: '🏆' },
];

// ── Node.js / ESM 雙模式匯出 ─────────────
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    WAN, TONG, SUO, HONOR, FLOWER,
    NUMBERED, ALL_NAMES, SORT_ORDER, SEQS,
    ROOM_TYPES, BET_CONFIGS,
    SEATS, SEAT_WINDS, MAX_PLAYERS,
    INIT_HAND, DEALER_HAND,
    BANKRUPT_THRESHOLD, INIT_COINS,
    VIP_LEVELS, EVENTS, ACTIONS, QUICK_CHAT,
  };
}
