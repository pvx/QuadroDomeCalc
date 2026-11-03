/**
 * Compact share path for carcass params.
 * Example: /a_5000_b_5000_h_3000_n_6_timber_150_50_osb_10_3_8_pipe_108_150_0_brace_1
 */

const KEYS = [
  { key: 'a', fields: ['a'], count: 1 },
  { key: 'b', fields: ['b'], count: 1 },
  { key: 'h', fields: ['h'], count: 1 },
  { key: 'n', fields: ['n'], count: 1 },
  { key: 'timber', fields: ['beamsWidth', 'beamsThickness'], count: 2 },
  { key: 'osb', fields: ['osbThicknessMm', 'osbFaceHeightMm', 'panelGapMm'], count: 3 },
  { key: 'pipe', fields: ['pipeD', 'pipeLengthMm', 'hubGapMm'], count: 3 },
  { key: 'brace', fields: ['supportBrace'], count: 1 },
];

const KEY_SET = new Set(KEYS.map((k) => k.key));

/** Format number without trailing zeros (5000, not 5000.0). */
export function fmtNum(n) {
  if (!Number.isFinite(n)) return '0';
  const r = Math.round(n * 1000) / 1000;
  if (Number.isInteger(r)) return String(r);
  return String(r);
}

/**
 * @param {Record<string, unknown>} params
 * @returns {string} pathname starting with /
 */
export function encodeSharePath(params) {
  const parts = [];
  for (const { key, fields } of KEYS) {
    const vals = fields.map((f) => {
      if (f === 'supportBrace') return params.supportBrace ? 1 : 0;
      return params[f];
    });
    if (vals.some((v) => v == null || (typeof v === 'number' && !Number.isFinite(v)))) continue;
    parts.push(key, ...vals.map((v) => (typeof v === 'number' ? fmtNum(v) : String(v))));
  }
  return '/' + parts.join('_');
}

/**
 * @param {string} pathname
 * @returns {Record<string, number|boolean>|null}
 * @throws {Error} when path looks like a share string but is malformed
 */
export function parseSharePath(pathname) {
  if (!pathname || pathname === '/') return null;
  const raw = pathname.replace(/^\/+|\/+$/g, '');
  if (!raw) return null;

  const tokens = raw.split('_');
  if (tokens.length < 2) return null;
  if (!KEY_SET.has(tokens[0])) return null;

  const out = {};
  let i = 0;
  while (i < tokens.length) {
    const key = tokens[i];
    const spec = KEYS.find((k) => k.key === key);
    if (!spec) {
      throw new Error(`Unknown share key "${key}" in path.`);
    }
    i += 1;
    if (i + spec.count - 1 >= tokens.length) {
      throw new Error(`Share path incomplete for "${key}".`);
    }
    const nums = [];
    for (let c = 0; c < spec.count; c += 1) {
      const t = tokens[i + c];
      if (KEY_SET.has(t) && !/^-?\d/.test(t)) {
        throw new Error(`Share path incomplete for "${key}".`);
      }
      const n = parseFloat(t.replace(',', '.'));
      if (!Number.isFinite(n)) {
        throw new Error(`Invalid number "${t}" for "${key}".`);
      }
      nums.push(n);
    }
    i += spec.count;

    if (key === 'brace') {
      out.supportBrace = nums[0] !== 0;
    } else {
      for (let c = 0; c < spec.fields.length; c += 1) {
        out[spec.fields[c]] = nums[c];
      }
    }
  }

  if (Object.keys(out).length === 0) return null;
  return out;
}
