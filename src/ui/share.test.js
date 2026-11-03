import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { encodeSharePath, parseSharePath, fmtNum } from './share.js';

describe('share path', () => {
  it('fmtNum drops trailing zeros', () => {
    assert.equal(fmtNum(5000), '5000');
    assert.equal(fmtNum(5000.0), '5000');
    assert.equal(fmtNum(10.5), '10.5');
  });

  it('round-trips encode → parse', () => {
    const params = {
      a: 5000,
      b: 5000,
      h: 3000,
      n: 6,
      beamsWidth: 150,
      beamsThickness: 50,
      osbThicknessMm: 10,
      osbFaceHeightMm: 3,
      panelGapMm: 8,
      pipeD: 108,
      pipeLengthMm: 150,
      hubGapMm: 0,
      supportBrace: true,
    };
    const path = encodeSharePath(params);
    assert.equal(
      path,
      '/a_5000_b_5000_h_3000_n_6_timber_150_50_osb_10_3_8_pipe_108_150_0_brace_1',
    );
    const parsed = parseSharePath(path);
    assert.deepEqual(parsed, {
      a: 5000,
      b: 5000,
      h: 3000,
      n: 6,
      beamsWidth: 150,
      beamsThickness: 50,
      osbThicknessMm: 10,
      osbFaceHeightMm: 3,
      panelGapMm: 8,
      pipeD: 108,
      pipeLengthMm: 150,
      hubGapMm: 0,
      supportBrace: true,
    });
  });

  it('returns null for / and non-share paths', () => {
    assert.equal(parseSharePath('/'), null);
    assert.equal(parseSharePath(''), null);
    assert.equal(parseSharePath('/index.html'), null);
  });

  it('throws on malformed share that starts with a known key', () => {
    assert.throws(() => parseSharePath('/a_5000_timber'), /incomplete/i);
  });

  it('brace 0 round-trips', () => {
    const path = encodeSharePath({
      a: 4000,
      b: 4000,
      h: 2000,
      n: 4,
      beamsWidth: 100,
      beamsThickness: 40,
      osbThicknessMm: 9,
      osbFaceHeightMm: 0,
      panelGapMm: 5,
      pipeD: 89,
      pipeLengthMm: 120,
      hubGapMm: 2,
      supportBrace: false,
    });
    assert.match(path, /brace_0$/);
    assert.equal(parseSharePath(path).supportBrace, false);
  });
});
