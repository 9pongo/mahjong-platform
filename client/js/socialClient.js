// ════════════════════════════════════════
//  client/js/socialClient.js
//  社交頁：任務 / 好友 / 公會 / 聊天
// ════════════════════════════════════════
import { authManager } from './auth.js';
import { getSocket }   from './socket.js';

const API = '/api';
let _user        = null;
let _socket      = null;
let _currentChannel = 'world';
let _myGuildId   = null;   // 我的公會 ID（公會聊天用）

function headers() {
  const token = authManager.getToken();
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
}

// ══════════════════════════════════════
//  初始化
// ══════════════════════════════════════
export const socialClient = {
  async init(user) {
    _user = user;
    _socket = getSocket(authManager.getToken());

    // 註冊聊天事件
    _socket.on('chat:history', ({ channel, messages }) => {
      if (channel === _currentChannel) _renderHistory(messages);
    });
    _socket.on('chat:message', (msg) => {
      if (msg.channel === _currentChannel) _appendMsg(msg);
    });
    _socket.on('chat:error', ({ message }) => toast(message));

    // 好友邀請事件
    _socket.on('friend:invite', (data) => _showInviteModal(data));
    _socket.on('friend:invite_sent', ({ roomId, betKey, roomType }) => {
      location.href = `game.html?roomId=${roomId}&betKey=${betKey}&roomType=${roomType}`;
    });
    _socket.on('friend:invite_error', ({ message }) => toast(`邀請失敗：${message}`));

    // 加入世界頻道
    _socket.emit('chat:join', { channel: 'world' });

    // 預設載入任務 tab
    await this.loadQuests();
  },

  // ── Tab 切換 ───────────────────────────
  switchTab(tab) {
    document.querySelectorAll('.tab-btn').forEach((b, i) => {
      const tabs = ['quest', 'friend', 'guild', 'chat'];
      b.classList.toggle('active', tabs[i] === tab);
    });
    document.querySelectorAll('.panel').forEach(p => {
      p.classList.remove('active');
    });
    const panel = document.getElementById(tab === 'chat' ? 'chat-panel' : `panel-${tab}`);
    if (panel) panel.classList.add('active');

    if (tab === 'friend') this.loadFriends();
    if (tab === 'guild')  this.loadGuild();
  },

  // ══════════════════════════════════════
  //  任務
  // ══════════════════════════════════════
  async loadQuests() {
    const res  = await fetch(`${API}/quest`, { headers: headers() });
    if (!res.ok) return;
    const { quests } = await res.json();

    const daily  = quests.filter(q => q.type === 'daily');
    const weekly = quests.filter(q => q.type === 'weekly');

    document.getElementById('daily-quests').innerHTML  = daily.map(questCardHTML).join('');
    document.getElementById('weekly-quests').innerHTML = weekly.map(questCardHTML).join('');
  },

  async claimQuest(questId) {
    const res  = await fetch(`${API}/quest/claim`, {
      method: 'POST', headers: headers(),
      body: JSON.stringify({ questId }),
    });
    const data = await res.json();
    if (!res.ok) { toast(data.error); return; }
    toast(`🎉 ${data.name} 獎勵：+${data.coins} 金幣`, 3000);
    this.loadQuests();
  },

  // ══════════════════════════════════════
  //  好友
  // ══════════════════════════════════════
  async loadFriends() {
    const res  = await fetch(`${API}/friend`, { headers: headers() });
    if (!res.ok) return;
    const { friends, pending } = await res.json();

    // 待處理
    const pendSec  = document.getElementById('pending-section');
    const pendList = document.getElementById('pending-list');
    if (pending.length) {
      pendSec.style.display = 'block';
      pendList.innerHTML = pending.map(p => `
        <div class="user-card">
          <div class="user-avatar">👤</div>
          <div class="user-info">
            <div class="name">${_esc(p.username || p.uid?.slice(0,8))}</div>
            <div class="sub">${p.direction === 'in' ? '待你接受' : '已送出申請'}</div>
          </div>
          ${p.direction === 'in' ? `
            <button class="btn-accept" onclick="acceptFriend('${p.uid}')">接受</button>
            <button class="btn-reject" onclick="rejectFriend('${p.uid}')" style="margin-left:4px">拒絕</button>
          ` : ''}
        </div>
      `).join('');
    } else {
      pendSec.style.display = 'none';
    }

    // 好友列表
    const listEl = document.getElementById('friend-list');
    if (!friends.length) {
      listEl.innerHTML = '<div style="color:#aaa;font-size:13px;text-align:center;padding:20px">還沒有好友，快去新增吧！</div>';
      return;
    }
    listEl.innerHTML = friends.map(f => `
      <div class="user-card">
        <div class="user-avatar">👤</div>
        <div class="user-info">
          <div class="name">${_esc(f.username)}</div>
          <div class="sub">LV ${f.game_level || 1} · VIP ${f.vip_level || 0}</div>
        </div>
        <button class="btn-invite-war" onclick="inviteFriend('${f.uid}','${_esc(f.username)}')">⚔️ 邀請</button>
        <button class="btn-remove" onclick="removeFriend('${f.uid}')">移除</button>
      </div>
    `).join('');
  },

  async addFriend() {
    const targetUid = document.getElementById('add-uid-input').value.trim();
    if (!targetUid) { toast('請輸入玩家 UID'); return; }
    const res  = await fetch(`${API}/friend/add`, {
      method: 'POST', headers: headers(),
      body: JSON.stringify({ targetUid }),
    });
    const data = await res.json();
    if (!res.ok) { toast(data.error); return; }
    toast(data.accepted ? `✅ 已與 ${data.username} 成為好友！` : `已向 ${data.username} 送出申請`, 3000);
    document.getElementById('add-uid-input').value = '';
    this.loadFriends();
  },

  async acceptFriend(fromUid) {
    await fetch(`${API}/friend/accept`, {
      method: 'POST', headers: headers(), body: JSON.stringify({ fromUid }),
    });
    toast('✅ 好友申請已接受');
    this.loadFriends();
  },

  async rejectFriend(fromUid) {
    await fetch(`${API}/friend/reject`, {
      method: 'POST', headers: headers(), body: JSON.stringify({ fromUid }),
    });
    this.loadFriends();
  },

  // 邀請好友對戰
  inviteFriend(targetUid, targetUsername) {
    _showBetPicker(targetUid, targetUsername);
  },

  async removeFriend(targetUid) {
    if (!confirm('確定移除好友？')) return;
    await fetch(`${API}/friend/${targetUid}`, { method: 'DELETE', headers: headers() });
    toast('好友已移除');
    this.loadFriends();
  },

  // ══════════════════════════════════════
  //  公會
  // ══════════════════════════════════════
  async loadGuild() {
    const [myRes, listRes] = await Promise.all([
      fetch(`${API}/guild/my`,   { headers: headers() }),
      fetch(`${API}/guild/list`, { headers: headers() }),
    ]);
    const { guild }  = await myRes.json();
    const { guilds } = await listRes.json();

    const mySec    = document.getElementById('guild-my-section');
    const createSec = document.getElementById('guild-create-section');

    if (guild) {
      _myGuildId = guild.guild_id;
      window._myGuildId = guild.guild_id;
      const btn = document.getElementById('guild-chat-btn');
      if (btn) btn.style.opacity = '1';
      createSec.style.display = 'none';

      // 取公會排行榜
      let rankHTML = '';
      try {
        const rRes = await fetch(`${API}/guild/leaderboard`, { headers: headers() });
        if (rRes.ok) {
          const { list } = await rRes.json();
          rankHTML = `
            <div style="margin-top:10px">
              <div style="font-size:11px;color:#ffdd88;letter-spacing:2px;margin-bottom:6px">🏆 成員勝場榜</div>
              ${(list || []).slice(0, 10).map((m, i) => `
                <div class="member-row" style="padding:4px 0;border-bottom:1px solid rgba(255,255,255,0.06)">
                  <span style="width:18px;text-align:center;font-size:11px;color:${i<3?'#ffd700':'#888'}">${i+1}</span>
                  <span class="role-badge">${m.role === 'leader' ? '👑' : '👤'}</span>
                  <span style="flex:1;font-size:12px">${_esc(m.username || '—')}</span>
                  <span style="color:#ffd700;font-size:11px">${m.total_wins} 勝</span>
                  <span style="color:#888;font-size:10px;margin-left:6px">${m.win_rate}</span>
                </div>
              `).join('')}
            </div>`;
        }
      } catch (_) {}

      mySec.innerHTML = `
        <div class="my-guild-card">
          <h3>⚔️ ${_esc(guild.name)}</h3>
          <div style="font-size:11px;color:#aaa;margin-bottom:4px">我的身份：${guild.myRole === 'leader' ? '👑 會長' : '成員'} · 共 ${guild.members?.length || 0} 人</div>
          ${rankHTML}
          <div style="display:flex;gap:6px;margin-top:10px">
            <button class="small-btn" style="flex:1"
              onclick="switchChannel('guild:${guild.guild_id}', document.querySelector('[data-ch=guild]'))">💬 公會聊天</button>
            <button class="small-btn" style="flex:1;color:#ff6666;border-color:#ff6666"
              onclick="leaveGuild()">退出</button>
          </div>
        </div>
      `;
    } else {
      _myGuildId = null;
      window._myGuildId = null;
      createSec.style.display = 'block';
      mySec.innerHTML = '';
    }

    // 公開列表
    const listEl = document.getElementById('guild-list');
    if (!guilds?.length) {
      listEl.innerHTML = '<div style="color:#aaa;font-size:13px;text-align:center;padding:20px">目前沒有公會</div>';
    } else {
      listEl.innerHTML = guilds.map(g => `
        <div class="guild-card" onclick="joinGuild('${g.guild_id}')">
          <div class="gname">⚔️ ${_esc(g.name)}</div>
          <div class="gmeta">成員 ${g.memberCount} 人 · ${g.type || '一般'}</div>
        </div>
      `).join('');
    }
  },

  async createGuild() {
    const name = document.getElementById('guild-name-inp').value.trim();
    const res  = await fetch(`${API}/guild/create`, {
      method: 'POST', headers: headers(),
      body: JSON.stringify({ name, type: '一般' }),
    });
    const data = await res.json();
    if (!res.ok) { toast(data.error); return; }
    toast(`✅ 公會「${data.name}」建立成功！`, 3000);
    this.loadGuild();
  },

  async joinGuild(guildId) {
    const res  = await fetch(`${API}/guild/join`, {
      method: 'POST', headers: headers(),
      body: JSON.stringify({ guildId }),
    });
    const data = await res.json();
    if (!res.ok) { toast(data.error); return; }
    toast(`✅ 已加入公會「${data.name}」`, 3000);
    this.loadGuild();
  },

  async leaveGuild() {
    if (!confirm('確定退出公會？')) return;
    const res  = await fetch(`${API}/guild/leave`, { method: 'DELETE', headers: headers() });
    const data = await res.json();
    if (!res.ok) { toast(data.error); return; }
    toast('已退出公會');
    this.loadGuild();
  },

  // ══════════════════════════════════════
  //  聊天
  // ══════════════════════════════════════
  switchChannel(ch, el) {
    // 切離舊頻道
    if (_currentChannel !== ch) {
      _socket.emit('chat:leave', { channel: _currentChannel });
    }
    _currentChannel = ch;
    document.querySelectorAll('.ch-btn').forEach(b => b.classList.remove('active'));
    if (el) el.classList.add('active');

    document.getElementById('chat-messages').innerHTML = '';
    _socket.emit('chat:join', { channel: ch });

    // 若是公會頻道，先切到 chat tab
    if (ch.startsWith('guild:')) {
      this.switchTab('chat');
      // 高亮公會按鈕
      const guildBtn = document.querySelector('[data-ch="guild"]');
      if (guildBtn) {
        document.querySelectorAll('.ch-btn').forEach(b => b.classList.remove('active'));
        guildBtn.classList.add('active');
      }
    }
  },

  sendChat() {
    const inp = document.getElementById('chat-input');
    const text = inp.value.trim();
    if (!text) return;
    _socket.emit('chat:send', { channel: _currentChannel, content: text });
    inp.value = '';
  },
};

// ══════════════════════════════════════
//  聊天渲染
// ══════════════════════════════════════
function _renderHistory(messages) {
  const el = document.getElementById('chat-messages');
  el.innerHTML = '';
  for (const msg of messages) _appendMsg(msg, true);
  el.scrollTop = el.scrollHeight;
}

function _appendMsg(msg, noScroll = false) {
  const el  = document.getElementById('chat-messages');
  const div = document.createElement('div');
  div.className = 'chat-msg';
  const isMe = msg.sender_uid === _user?.uid;
  const name = msg.sender_name || (msg.sender_uid?.slice(0, 8) || '系統');
  div.innerHTML = `<span class="sender" style="${isMe ? 'color:#aaffcc' : ''}">${_esc(name)}：</span>` +
    `<span class="content">${_esc(msg.content)}</span>`;
  el.appendChild(div);

  // 最多保留 200 則
  while (el.children.length > 200) el.removeChild(el.firstChild);
  if (!noScroll) el.scrollTop = el.scrollHeight;
}

// ══════════════════════════════════════
//  任務卡片 HTML
// ══════════════════════════════════════
function questCardHTML(q) {
  const pct   = q.pct;
  const doneEl = q.completed
    ? (q.claimed
      ? `<span class="claimed-badge">✅ 已領取</span>`
      : `<button class="claim-btn" onclick="claimQuest('${q.questId}')">領取</button>`)
    : `<button class="claim-btn" disabled>領取</button>`;

  return `
    <div class="quest-card">
      <div class="quest-icon">${q.icon}</div>
      <div class="quest-body">
        <div class="quest-name">${_esc(q.name)}</div>
        <div class="quest-prog-wrap">
          <div class="quest-prog-fill" style="width:${pct}%"></div>
        </div>
        <div class="quest-nums">${q.progress} / ${q.goal}</div>
      </div>
      <div class="quest-reward">
        <div style="color:#ffd700;font-size:12px">💰 ${q.reward}</div>
        <div style="margin-top:4px">${doneEl}</div>
      </div>
    </div>
  `;
}

// ══════════════════════════════════════
//  好友邀請 UI
// ══════════════════════════════════════

/** 顯示桌金選擇浮層，選完後發出邀請 */
function _showBetPicker(targetUid, targetUsername) {
  _removeEl('_bet_picker');
  const overlay = document.createElement('div');
  overlay.id = '_bet_picker';
  overlay.style.cssText = [
    'position:fixed','inset:0','background:rgba(0,0,0,0.7)',
    'z-index:9000','display:flex','align-items:center','justify-content:center',
  ].join(';');

  const BETS = [
    { key: '10_3',     label: '10/3',      desc: '新手練習' },
    { key: '100_30',   label: '100/30',    desc: '標準' },
    { key: '1000_300', label: '1000/300',  desc: '進階' },
  ];

  overlay.innerHTML = `
    <div style="background:#1a0a3a;border:1.5px solid rgba(255,215,0,0.4);
      border-radius:18px;padding:20px;min-width:260px;text-align:center">
      <div style="color:#ffd700;font-size:15px;font-weight:bold;margin-bottom:6px">⚔️ 邀請對戰</div>
      <div style="font-size:12px;color:#aaa;margin-bottom:14px">邀請 ${_esc(targetUsername)}</div>
      <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:14px">
        ${BETS.map(b => `
          <button onclick="_confirmInvite('${targetUid}','${b.key}')"
            style="background:rgba(255,255,255,0.08);border:1px solid rgba(255,215,0,0.3);
            color:#fff;border-radius:10px;padding:10px;cursor:pointer;font-size:13px;
            display:flex;justify-content:space-between;align-items:center">
            <span style="color:#ffd700;font-weight:bold">${b.label}</span>
            <span style="color:#aaa;font-size:11px">${b.desc}</span>
          </button>
        `).join('')}
      </div>
      <button onclick="_removeEl('_bet_picker')"
        style="background:none;border:1px solid #555;color:#888;padding:6px 20px;
        border-radius:10px;cursor:pointer;font-size:12px">取消</button>
    </div>
  `;
  document.body.appendChild(overlay);
}

window._confirmInvite = function(targetUid, betKey) {
  _removeEl('_bet_picker');
  _socket.emit('friend:invite_send', { targetUid, betKey, roomType: 'short' });
  toast('📨 邀請已送出，等待對方接受...');
};

/** 收到對戰邀請時顯示浮層 */
function _showInviteModal({ fromUid, fromUsername, betKey, roomType, roomId }) {
  _removeEl('_invite_modal');
  const div = document.createElement('div');
  div.id = '_invite_modal';
  div.style.cssText = [
    'position:fixed','top:60px','left:50%','transform:translateX(-50%)',
    'background:#1a1a3a','border:1.5px solid #ffd700','border-radius:16px',
    'padding:18px 22px','z-index:9999','text-align:center','min-width:270px',
    'box-shadow:0 8px 32px rgba(0,0,0,0.6)',
  ].join(';');
  div.innerHTML = `
    <div style="color:#ffd700;font-size:15px;font-weight:bold;margin-bottom:6px">🀄 對戰邀請</div>
    <div style="font-size:12px;color:#ddd;margin-bottom:14px">
      ${_esc(fromUsername)} 邀請你加入<br>
      <span style="color:#ffd700;font-weight:bold">底注 ${betKey.replace('_','/')}</span> 的牌局
    </div>
    <div style="display:flex;gap:10px;justify-content:center">
      <button id="_invite_accept_btn"
        style="background:#00cc66;color:#fff;border:none;padding:9px 20px;
        border-radius:10px;cursor:pointer;font-size:13px;font-weight:bold">✅ 接受</button>
      <button onclick="_removeEl('_invite_modal')"
        style="background:rgba(255,0,0,0.15);color:#ff6666;border:1px solid #ff6666;
        padding:9px 20px;border-radius:10px;cursor:pointer;font-size:13px">✗ 拒絕</button>
    </div>
  `;
  document.body.appendChild(div);
  document.getElementById('_invite_accept_btn').onclick = () => {
    _removeEl('_invite_modal');
    location.href = `game.html?roomId=${roomId}&betKey=${betKey}&roomType=${roomType}`;
  };
  // 30 秒自動消失
  setTimeout(() => _removeEl('_invite_modal'), 30000);
}

function _removeEl(id) {
  document.getElementById(id)?.remove();
}

// ── 工具 ──────────────────────────────────
function toast(msg, ms = 2000) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), ms);
}

function _esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
