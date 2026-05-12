// ════════════════════════════════════════
//  client/js/socialClient.js
//  社交頁：任務 / 好友 / 公會 / 聊天
// ════════════════════════════════════════
import { authManager } from './auth.js';
import { getSocket }   from './socket.js';

const API = '/api';
let _user   = null;
let _socket = null;
let _currentChannel = 'world';

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
      createSec.style.display = 'none';
      mySec.innerHTML = `
        <div class="my-guild-card">
          <h3>⚔️ ${_esc(guild.name)}</h3>
          <div style="font-size:11px;color:#aaa">我的身份：${guild.myRole === 'leader' ? '👑 會長' : '成員'}</div>
          <div class="member-list">
            ${(guild.members || []).slice(0, 8).map(m => `
              <div class="member-row">
                <span class="role-badge">${m.role === 'leader' ? '👑' : '👤'}</span>
                <span>${_esc(m.username || '—')}</span>
                <span style="color:#888;font-size:10px;margin-left:auto">LV${m.game_level||1}</span>
              </div>
            `).join('')}
            ${guild.members?.length > 8 ? `<div style="color:#888;font-size:10px">...等 ${guild.members.length} 人</div>` : ''}
          </div>
          <button class="small-btn" style="margin-top:10px;width:100%;color:#ff6666;border-color:#ff6666"
            onclick="leaveGuild()">退出公會</button>
        </div>
      `;
    } else {
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
    _currentChannel = ch;
    document.querySelectorAll('.ch-btn').forEach(b => b.classList.remove('active'));
    el.classList.add('active');

    document.getElementById('chat-messages').innerHTML = '';
    _socket.emit('chat:join', { channel: ch });
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
