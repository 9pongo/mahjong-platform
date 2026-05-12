// ════════════════════════════════════════
//  server/socket/chatSocket.js
//  世界聊天 / 公會聊天 / 私訊
// ════════════════════════════════════════
const supabase = require('../models/supabase');
const logger   = require('../utils/logger');

const MAX_MSG_LENGTH = 100;
const HISTORY_LIMIT  = 50;

// 簡易防洗版：uid → 最近一次發訊時間（ms）
const lastMsg = new Map();
const RATE_LIMIT_MS = 1500;  // 1.5 秒冷卻

function registerChatSocket(io, socket) {
  const uid      = socket.handshake.auth?.uid      || null;
  const username = socket.handshake.auth?.username || `玩家${socket.id.slice(0, 4)}`;

  // ── 加入頻道並讀取歷史 ──────────────────
  socket.on('chat:join', async ({ channel }) => {
    if (!channel) return;
    const room = `chat:${channel}`;
    socket.join(room);

    // 回傳最近 50 筆歷史
    try {
      const { data } = await supabase.from('messages')
        .select('msg_id, sender_uid, content, sent_at')
        .eq('channel', channel)
        .order('sent_at', { ascending: false })
        .limit(HISTORY_LIMIT);

      const history = (data || []).reverse();
      socket.emit('chat:history', { channel, messages: history });
    } catch (e) {
      logger.error('chat:join history error:', e.message);
    }
  });

  // ── 離開頻道 ────────────────────────────
  socket.on('chat:leave', ({ channel }) => {
    socket.leave(`chat:${channel}`);
  });

  // ── 發送訊息 ────────────────────────────
  socket.on('chat:send', async ({ channel, content }) => {
    if (!channel || !content || !content.trim()) return;

    // 頻率限制
    const now = Date.now();
    const last = lastMsg.get(uid || socket.id) || 0;
    if (now - last < RATE_LIMIT_MS) {
      socket.emit('chat:error', { message: '發送太頻繁，請稍後' });
      return;
    }
    lastMsg.set(uid || socket.id, now);

    const text = content.trim().slice(0, MAX_MSG_LENGTH);

    const msg = {
      channel,
      sender_uid: uid,
      sender_name: username,
      content: text,
      sent_at: new Date().toISOString(),
    };

    // 廣播給所有在此頻道的人
    io.to(`chat:${channel}`).emit('chat:message', msg);

    // 寫入 DB（非同步，失敗不影響廣播）
    if (uid) {
      supabase.from('messages').insert({
        channel,
        sender_uid: uid,
        content:    text,
      }).then(({ error }) => {
        if (error) logger.error('chat DB insert error:', error.message);
      });
    }
  });
}

module.exports = { registerChatSocket };
