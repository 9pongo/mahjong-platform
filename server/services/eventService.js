// ════════════════════════════════════════
//  server/services/eventService.js
//  限時活動：金幣倍率 / RP 加成 / 雙倍勝場
// ════════════════════════════════════════
const supabase = require('../models/supabase');
const logger   = require('../utils/logger');

// ── 取得目前進行中活動 ──────────────────
async function getActiveEvents() {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('events')
    .select('*')
    .eq('active', true)
    .lte('starts_at', now)
    .gte('ends_at', now)
    .order('starts_at', { ascending: true });

  if (error) {
    logger.warn('[Event] getActiveEvents error: ' + error.message);
    return [];
  }
  return data || [];
}

// ── 計算金幣加成後的值 ──────────────────
// type: 'coin_bonus'
async function applyEventBonus(baseCoins) {
  const events = await getActiveEvents();
  const coinEvent = events.find(e => e.type === 'coin_bonus');
  if (!coinEvent) return { coins: baseCoins, multiplier: 1, eventName: null };

  const multiplier  = parseFloat(coinEvent.multiplier) || 1;
  const finalCoins  = Math.round(baseCoins * multiplier);
  return { coins: finalCoins, multiplier, eventName: coinEvent.name };
}

// ── 計算 RP 加成倍率 ─────────────────────
async function getRpMultiplier() {
  const events = await getActiveEvents();
  const rpEvent = events.find(e => e.type === 'rp_bonus');
  if (!rpEvent) return 1;
  return parseFloat(rpEvent.multiplier) || 1;
}

// ── Admin：建立活動 ──────────────────────
async function createEvent({ name, description, type, multiplier, starts_at, ends_at }) {
  const { data, error } = await supabase
    .from('events')
    .insert({ name, description, type, multiplier, starts_at, ends_at, active: true })
    .select()
    .single();
  if (error) throw error;
  return data;
}

// ── Admin：結束活動 ──────────────────────
async function endEvent(id) {
  const { error } = await supabase
    .from('events')
    .update({ active: false })
    .eq('id', id);
  if (error) throw error;
  return { ok: true };
}

module.exports = { getActiveEvents, applyEventBonus, getRpMultiplier, createEvent, endEvent };
