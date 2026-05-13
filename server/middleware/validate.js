// ════════════════════════════════════════
//  server/middleware/validate.js
//  輕量輸入驗證（無依賴，純函式工廠）
// ════════════════════════════════════════

/**
 * 使用方式：
 *   router.post('/register', validate({ username: 'string|3-20', coins: 'int' }), handler)
 *
 * 規則語法：
 *   'string'         → 必填，string 型別
 *   'string|3-20'    → 必填，長度 3~20
 *   'int'            → 必填，整數
 *   'int|1-1000'     → 必填，值域 1~1000
 *   'optional:string'→ 選填，string
 */
function validate(schema) {
  return (req, res, next) => {
    const body   = req.body   || {};
    const params = req.params || {};
    const query  = req.query  || {};
    const source = { ...query, ...body, ...params };

    const errors = [];

    for (const [field, rule] of Object.entries(schema)) {
      const optional = rule.startsWith('optional:');
      const rawRule  = optional ? rule.slice(9) : rule;
      const [type, range] = rawRule.split('|');
      const value = source[field];

      // 選填且缺失 → 跳過
      if (optional && (value === undefined || value === null || value === '')) continue;

      // 必填缺失
      if (!optional && (value === undefined || value === null || value === '')) {
        errors.push(`${field} 為必填`);
        continue;
      }

      if (type === 'string') {
        if (typeof value !== 'string') {
          errors.push(`${field} 必須是字串`);
          continue;
        }
        if (range) {
          const [min, max] = range.split('-').map(Number);
          if (value.length < min || value.length > max) {
            errors.push(`${field} 長度需在 ${min}~${max} 之間`);
          }
        }

      } else if (type === 'int' || type === 'number') {
        const n = Number(value);
        if (!Number.isFinite(n) || (type === 'int' && !Number.isInteger(n))) {
          errors.push(`${field} 必須是${type === 'int' ? '整數' : '數字'}`);
          continue;
        }
        if (range) {
          const [min, max] = range.split('-').map(Number);
          if (n < min || n > max) {
            errors.push(`${field} 需在 ${min}~${max} 之間`);
          }
        }

      } else if (type === 'boolean') {
        if (value !== true && value !== false && value !== 'true' && value !== 'false') {
          errors.push(`${field} 必須是布林值`);
        }

      } else if (type === 'uuid') {
        const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (!uuidRe.test(value)) {
          errors.push(`${field} 格式不正確`);
        }
      }
    }

    if (errors.length > 0) {
      return res.status(400).json({ error: errors.join('；') });
    }
    next();
  };
}

/**
 * XSS 過濾：將使用者輸入的 string 欄位做基本 HTML escape
 * 使用方式：router.post('/xxx', sanitize('username','bio'), handler)
 */
function sanitize(...fields) {
  return (req, _res, next) => {
    for (const f of fields) {
      if (typeof req.body?.[f] === 'string') {
        req.body[f] = req.body[f]
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#x27;')
          .trim();
      }
    }
    next();
  };
}

module.exports = { validate, sanitize };
