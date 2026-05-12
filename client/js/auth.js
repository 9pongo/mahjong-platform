// ════════════════════════════════════════
//  client/js/auth.js  —  登入 / Token 管理
// ════════════════════════════════════════

const API = '/api';

export const authManager = {
  _user: null,

  getUser() {
    if (this._user) return this._user;
    const raw = localStorage.getItem('mj_user');
    if (raw) { this._user = JSON.parse(raw); return this._user; }
    return null;
  },

  getToken() {
    return localStorage.getItem('mj_token');
  },

  /** 取得現有帳號，若無則建立遊客帳號 */
  async getOrCreateGuest() {
    const existing = this.getUser();
    if (existing && this.getToken()) return existing;

    try {
      const res = await fetch(`${API}/auth/register-guest`, { method: 'POST' });
      const { token, user } = await res.json();
      localStorage.setItem('mj_token', token);
      localStorage.setItem('mj_user', JSON.stringify(user));
      this._user = user;
      return user;
    } catch (e) {
      console.warn('Guest register failed, using local fallback', e);
      // 本地 fallback（Server 未啟動時）
      const fallback = { uid: 'local_' + Date.now(), username: '本地玩家', coins: 10000, vip_level: 0 };
      this._user = fallback;
      return fallback;
    }
  },

  async fetchMe() {
    const token = this.getToken();
    if (!token) return null;
    const res = await fetch(`${API}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const user = await res.json();
    localStorage.setItem('mj_user', JSON.stringify(user));
    this._user = user;
    return user;
  },

  logout() {
    localStorage.removeItem('mj_token');
    localStorage.removeItem('mj_user');
    this._user = null;
  },
};
