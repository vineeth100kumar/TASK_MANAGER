import { describe, it, expect } from 'vitest';
import { RATE, Segmenter, downsample, encodeWav } from './voiceListener';

const frame = (amp: number, ms = 40) => {
  const f = new Float32Array((RATE * ms) / 1000);
  for (let i = 0; i < f.length; i++) f[i] = amp * Math.sin(i * 0.3);
  return f;
};
const feed = (seg: Segmenter, amp: number, ms: number) => {
  let clip = null;
  for (let t = 0; t < ms; t += 40) clip = seg.push(frame(amp)) ?? clip;
  return clip;
};

describe('Segmenter', () => {
  it('sends nothing for silence', () => {
    const s = new Segmenter();
    expect(feed(s, 0.002, 5000)).toBeNull();
  });
  it('cuts one clip around speech', () => {
    const s = new Segmenter();
    feed(s, 0.002, 1000);
    expect(feed(s, 0.2, 1200)).toBeNull();
    const clip = feed(s, 0.002, 1200);
    expect(clip).not.toBeNull();
    expect(clip!.seconds).toBeGreaterThan(1.2);
    expect(clip!.seconds).toBeLessThan(2.6);
  });
  it('drops a click', () => {
    const s = new Segmenter();
    feed(s, 0.002, 500);
    feed(s, 0.3, 120);
    expect(feed(s, 0.002, 1500)).toBeNull();
  });
  it('cuts a very long clip', () => {
    const s = new Segmenter({ maxMs: 3000 });
    expect(feed(s, 0.2, 4000)).not.toBeNull();
  });
});

describe('audio helpers', () => {
  it('downsamples 48k to 16k', () => {
    expect(downsample(new Float32Array(4800), 48000).length).toBe(1600);
  });
  it('writes a WAV header', () => {
    const wav = encodeWav(new Float32Array(160));
    expect(String.fromCharCode(...wav.subarray(0, 4))).toBe('RIFF');
    expect(wav.length).toBe(44 + 320);
  });
});
