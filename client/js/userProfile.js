// ════════════════════════════════════════
//  client/js/userProfile.js  —  個人資料頁邏輯
// ════════════════════════════════════════
import { authManager } from './auth.js';

const API = '/api';
function token() { return authManager.getToken(); }
function headers() { return { 'Content-Type':'application/json', Authorization:`Bearer ${token()}` }; }

// ── Toast ────────────────────────────────
function toast(msg, ms = 2000) {
  const el = document.getElementById('toast');
  el.textContent = msg; el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), ms);
}

// ── 雷達圖繪製 ────────────────────────────
function drawRadar(data) {
  const labels = ['勝場率','胡牌率','自摸率','放槍率','大牌率'];
  const vals   = [
    parseFloat(data.win_rate),
    parseFloat(data.hu_rate),
    parseFloat(data.zimo_rate),
    parseFloat(data.fangqiang_rate),
    0,  // 大牌率（Phase 3 後補）
  ].map(v => Math.min(v / 60, 1));  // 60% 對應滿分

  const R = 70; const cx = 0; const cy = 0;
  const angles = labels.map((_, i) => (i * 2 * Math.PI / labels.length) - Math.PI / 2);

  const svg = document.getElementById('radarSvg');
  svg.innerHTML = '';

  // 背景網格（3層）
  for (let r = 1; r <= 3; r++) {
    const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    const pts  = angles.map(a => `${cx + R * r/3 * Math.cos(a)},${cy + R * r/3 * Math.sin(a)}`).join(' ');
    poly.setAttribute('points', pts);
    poly.setAttribute('fill', 'none');
    poly.setAttribute('stroke', 'rgba(255,255,255,0.1)');
    svg.appendChild(poly);
  }

  // 中心線
  for (const a of angles) {
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', cx); line.setAttribute('y1', cy);
    line.setAttribute('x2', cx + R * Math.cos(a));
    line.setAttribute('y2', cy + R * Math.sin(a));
    line.setAttribute('stroke', 'rgba(255,255,255,0.1)');
    svg.appendChild(line);
  }

  // 數據多邊形
  const dataPts = angles.map((a, i) =>
    `${cx + R * vals[i] * Math.cos(a)},${cy + R * vals[i] * Math.sin(a)}`).join(' ');
  const dataPoly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
  dataPoly.setAttribute('points', dataPts);
  dataPoly.setAttribute('fill', 'rgba(255,215,0,0.25)');
  dataPoly.setAttribute('stroke', '#ffd700');
  dataPoly.setAttribute('stroke-width', '1.5');
  svg.appendChild(dataPoly);

  // 標籤
  labels.forEach((lbl, i) => {
    const a = angles[i]; const pad = 14;
    const tx = cx + (R + pad) * Math.cos(a);
    const ty = cy + (R + pad) * Math.sin(a);
    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('x', tx); text.setAttribute('y', ty);
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('dominant-baseline', 'middle');
    text.setAttribute('class', 'radar-label');
    text.textContent = lbl;
    svg.appendChild(text);
  });
}

// ── 主模組 ───────────────────────────────
export const profileManager = {
  _stats: null,

  render(user) {
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    set('nameEl',    user.username || '—');
    set('uidEl',     `UID: ${user.uid?.slice(0,12)}...`);
    set('statusEl',  user.phone_verified ? '✅ 已驗證' : '⚠️ 遊客帳號');
    set('coinsEl',   (user.coins || 0).toLocaleString());
    set('diamondEl', (user.diamond_balance || 0).toLocaleString());
    set('vipEl',     `VIP ${user.vip_level || 0}`);
    set('lvEl',      `LV ${user.game_level || 1}`);
    // 頭像
    this._renderAvatar(user.avatar_url);
  },

  _renderAvatar(url) {
    const el = document.getElementById('avatarEl');
    if (url) {
      el.innerHTML = `<img src="${url}" alt="頭像" onerror="this.parentElement.innerHTML='🐰'">`;
    } else {
      el.textContent = '🐰';
    }
  },

  /** 點擊頭像觸發：彈出 file picker → 壓縮 → 上傳 */
  async uploadAvatar() {
    return new Promise((resolve) => {
      const inp = document.createElement('input');
      inp.type = 'file';
      inp.accept = 'image/jpeg,image/png,image/webp';
      inp.onchange = async () => {
        const file = inp.files[0];
        if (!file) return resolve();
        if (file.size > 5 * 1024 * 1024) { toast('圖片需小於 5 MB'); return resolve(); }

        toast('處理中…');
        try {
          const dataUrl = await this._resizeImage(file, 256);
          const res  = await fetch(`${API}/user/avatar`, {
            method: 'POST',
            headers: headers(),
            body: JSON.stringify({ imageData: dataUrl }),
          });
          const data = await res.json();
          if (!res.ok) { toast(data.error || '上傳失敗'); return resolve(); }
          this._renderAvatar(data.avatarUrl);
          toast('✅ 頭像已更新');
          resolve(data.avatarUrl);
        } catch (e) {
          toast('上傳失敗：' + e.message);
          resolve();
        }
      };
      inp.click();
    });
  },

  /** 用 Canvas 將圖片縮放至 maxSize × maxSize，輸出 base64 JPEG */
  _resizeImage(file, maxSize = 256) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        const scale  = Math.min(1, maxSize / Math.max(img.width, img.height));
        const w = Math.round(img.width  * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('圖片讀取失敗')); };
      img.src = url;
    });
  },

  async loadVipInfo() {
    const res  = await fetch(`${API}/user/vip-info`, { headers: headers() });
    if (!res.ok) return;
    const data = await res.json();
    document.getElementById('vipVP').textContent = `累積 V 點：${data.v_points?.toLocaleString() || 0}`;
    document.getElementById('vipHongbao').textContent = `每日紅包：${data.current?.dailyHongbao || 1} 次`;
    document.getElementById('vipCurLbl').textContent = `VIP ${data.vip_level}`;

    if (data.next) {
      document.getElementById('vipNextLbl').textContent = `→ VIP ${data.next.level}（需 ${data.next.minVP.toLocaleString()} V點）`;
      const pct = Math.min(100, (data.v_points / data.next.minVP) * 100);
      document.getElementById('vipBarFill').style.width = pct + '%';
    } else {
      document.getElementById('vipNextLbl').textContent = '已達最高等級';
      document.getElementById('vipBarFill').style.width = '100%';
    }
  },

  async loadStats() {
    const res = await fetch(`${API}/user/stats`, { headers: headers() });
    if (!res.ok) return;
    const data = await res.json();
    this._stats = data;
    if (data.games > 0) {
      document.getElementById('s_win').textContent  = data.win_rate;
      document.getElementById('s_hu').textContent   = data.hu_rate;
      document.getElementById('s_zimo').textContent = data.zimo_rate;
      document.getElementById('s_fang').textContent = data.fangqiang_rate;
      document.getElementById('s_big').textContent  = '0%';
      drawRadar(data);
    }
  },

  async loadRewardStatus() {
    const res = await fetch(`${API}/reward/daily-status`, { headers: headers() });
    if (!res.ok) return;
    const data = await res.json();
    const spinBtn    = document.getElementById('spinBtn');
    const hongbaoBtn = document.getElementById('hongbaoBtn');
    const statusEl   = document.getElementById('rewardStatus');

    if (data.spinClaimed) {
      spinBtn.disabled = true;
      spinBtn.textContent = '✅ 已轉盤';
    }
    hongbaoBtn.textContent = `🧧 紅包（${data.hongbaoLeft} 次）`;
    if (data.hongbaoLeft === 0) {
      hongbaoBtn.disabled = true;
      hongbaoBtn.textContent = '今日紅包已領完';
    }
    statusEl.textContent = `轉盤${data.spinClaimed ? '已使用' : '未使用'} · 紅包 ${data.hongbaoUsed}/${data.hongbaoLimit}`;
  },

  async doSpin() {
    const btn = document.getElementById('spinBtn');
    btn.disabled = true;
    const res  = await fetch(`${API}/reward/spin`, { method:'POST', headers: headers() });
    const data = await res.json();
    if (!res.ok) { toast(data.error); btn.disabled = false; return; }
    toast(`🎰 轉盤獎勵：${data.prize}（+${data.coins} 金幣）`, 3000);
    btn.textContent = '✅ 已轉盤';
    this.reloadCoins();
  },

  async doHongbao() {
    const btn = document.getElementById('hongbaoBtn');
    const res = await fetch(`${API}/reward/hongbao`, { method:'POST', headers: headers() });
    const data = await res.json();
    if (!res.ok) { toast(data.error); return; }
    toast(`🧧 紅包：+${data.coins} 金幣（剩 ${data.remaining} 次）`, 3000);
    btn.textContent = `🧧 紅包（${data.remaining} 次）`;
    if (data.remaining === 0) btn.disabled = true;
    this.reloadCoins();
  },

  async reloadCoins() {
    const user = await authManager.fetchMe();
    if (user) document.getElementById('coinsEl').textContent = user.coins.toLocaleString();
  },

  promptEditName() {
    const name = prompt('輸入新暱稱（2~12字）：');
    if (!name || name.length < 2 || name.length > 12) { toast('暱稱長度需2~12字'); return; }
    fetch(`${API}/user/profile`, {
      method: 'PUT',
      headers: headers(),
      body: JSON.stringify({ username: name }),
    }).then(r => r.json()).then(d => {
      if (d.ok) { document.getElementById('nameEl').textContent = name; toast('改名成功'); }
      else toast(d.error || '改名失敗');
    });
  },

  async sendCode() {
    const phone = document.getElementById('phoneInp').value.trim();
    if (!/^09\d{8}$/.test(phone)) { toast('手機號碼格式錯誤'); return; }
    const btn = document.getElementById('sendCodeBtn');
    btn.disabled = true; btn.textContent = '發送中…';
    const res  = await fetch(`${API}/auth/send-sms`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ phone }),
    });
    const data = await res.json();
    if (!res.ok) { toast(data.error); btn.disabled = false; btn.textContent = '發送驗證碼'; return; }
    document.getElementById('codeSection').style.display = 'block';
    btn.textContent = '60秒後重發';
    if (data.dev_code) toast(`[DEV] 驗證碼：${data.dev_code}`, 5000);
    let s = 60;
    const t = setInterval(() => {
      btn.textContent = `${--s}秒後重發`;
      if (s <= 0) { clearInterval(t); btn.disabled = false; btn.textContent = '重新發送'; }
    }, 1000);
  },

  async verifyCode() {
    const phone = document.getElementById('phoneInp').value.trim();
    const code  = document.getElementById('codeInp').value.trim();
    const res   = await fetch(`${API}/auth/verify-sms`, {
      method:'POST', headers: headers(),
      body: JSON.stringify({ phone, code }),
    });
    const data = await res.json();
    if (!res.ok) { toast(data.error); return; }
    toast('✅ 手機認證成功！');
    document.getElementById('verifySection').style.display = 'none';
    document.getElementById('statusEl').textContent = '✅ 已驗證';
  },
};
