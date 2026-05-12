// ════════════════════════════════════════
//  server/socket/chatSocket.js  — 即時聊天（Phase 4 擴展）
// ════════════════════════════════════════

function registerChatSocket(io, socket) {
  // 加入頻道
  socket.on('chat:join', ({ channel }) => {
    socket.join(`chat:${channel}`);
  });

  // 發送訊息
  socket.on('chat:send', ({ channel, content }) => {
    if (!content || content.trim().length === 0) return;
    const msg = {
      senderSocketId: socket.id,
      content: content.trim().slice(0, 100),  // 限制長度
      sentAt: new Date().toISOString(),
    };
    io.to(`chat:${channel}`).emit('chat:message', { channel, ...msg });
    // TODO Phase 4: 存入 Supabase messages 資料表
  });
}

module.exports = { registerChatSocket };
