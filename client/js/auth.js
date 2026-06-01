// ════════════════════════════════════════
//  client/js/auth.js  —  登入 / Token 管理
// ════════════════════════════════════════

const API = '/api';

export const authManager = {
  _user: null,

  getUser() {
    if (this._user) return this._user;
    try {
      const raw = localStorage.getItem('mj_user');
      // 防止 localStorage 存入字串 "undefined"（register-guest 失敗時的舊 bug）
      if (raw && raw !== 'undefined' && raw !== 'null') {
        this._user = JSON.parse(raw);
        return this._user;
      }
    } catch {}
    return null;
  },

  getToken() {
    const t = localStorage.getItem('mj_token');
    return (t && t !== 'undefined' && t !== 'null') ? t : null;
  },

  /** 帶超時的 fetch 輔助（預設 6 秒）*/
  async _fetchWithTimeout(url, options = {}, ms = 6000) {
    const ctrl = new AbortController();
    const tid  = setTimeout(() => ctrl.abort(), ms);
    try {
      return await fetch(url, { ...options, signal: ctrl.signal });
    } finally {
      clearTimeout(tid);
    }
  },

  /** 取得現有帳號，若無則建立遊客帳號 */
  async getOrCreateGuest() {
    const existing = this.getUser();
    if (existing && this.getToken()) return existing;

    try {
      // ★ 加入 6 秒超時：避免 fetch 無限等待導致 init() 卡住
      const res = await this._fetchWithTimeout(`${API}/auth/register-guest`, { method: 'POST' }, 6000);
      if (!res.ok) throw new Error(`register-guest HTTP ${res.status}`);
      const data = await res.json();
      if (!data.token || !data.user) throw new Error('register-guest: invalid response');
      localStorage.setItem('mj_token', data.token);
      localStorage.setItem('mj_user', JSON.stringify(data.user));
      this._user = data.user;
      return data.user;
    } catch (e) {
      console.warn('Guest register failed, using local fallback', e);
      // 優先沿用先前已存的本地 uid（避免重連時 uid 改變導致 GAME_START 收不到）
      const saved = (() => { try { const r = localStorage.getItem('mj_user'); return (r && r !== 'undefined') ? JSON.parse(r) : null; } catch { return null; } })();
      if (saved?.uid) { this._user = saved; return saved; }
      // 全新本地 fallback — 同步寫入 localStorage 確保 uid 穩定
      const fallback = { uid: 'local_' + Date.now(), username: '本地玩家', coins: 10000, vip_level: 0 };
      this._user = fallback;
      try { localStorage.setItem('mj_user', JSON.stringify(fallback)); } catch {}
      return fallback;
    }
  },

  async fetchMe() {
    const token = this.getToken();
    if (!token) return null;
    try {
      const res = await this._fetchWithTimeout(`${API}/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
      }, 6000);
      if (!res.ok) return null;
      const user = await res.json();
      localStorage.setItem('mj_user', JSON.stringify(user));
      this._user = user;
      return user;
    } catch {
      return null;
    }
  },

  logout() {
    localStorage.removeItem('mj_token');
    localStorage.removeItem('mj_user');
    this._user = null;
  },
};
