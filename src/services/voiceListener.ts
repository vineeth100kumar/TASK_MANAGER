// voiceListener.ts - Listens through the browser's microphone and cuts out the
// spoken clips, so only speech is sent for transcribing (never silence).
//
// It works the same on a phone and a laptop, Safari included: the mic is read as
// raw samples (getUserMedia + Web Audio), a small voice-activity detector finds
// where speech starts and stops, and each clip leaves as a 16 kHz mono WAV.

export const RATE = 16000;

// ---- pure parts (tested) ----------------------------------------------------

// Average the samples down to 16 kHz.
export function downsample(input: Float32Array, from: number, to = RATE): Float32Array {
  if (from <= to) return input;
  const ratio = from / to;
  const out = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const start = Math.floor(i * ratio), end = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end; j++) sum += input[j];
    out[i] = sum / Math.max(1, end - start);
  }
  return out;
}

export function rms(frame: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i];
  return Math.sqrt(sum / Math.max(1, frame.length));
}

// 16-bit PCM WAV, mono.
export function encodeWav(samples: Float32Array, rate = RATE): Uint8Array {
  const out = new Uint8Array(44 + samples.length * 2);
  const v = new DataView(out.buffer);
  const text = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  text(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true); text(8, 'WAVE'); text(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  text(36, 'data'); v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const x = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, x < 0 ? x * 0x8000 : x * 0x7fff, true);
  }
  return out;
}

export interface Clip { samples: Float32Array; seconds: number }

export interface SegmenterOptions {
  minSpeechMs?: number;    // shorter than this is a click or a cough
  endSilenceMs?: number;   // this much quiet ends the clip
  maxMs?: number;          // a clip is cut here however long it runs
  prerollMs?: number;      // kept from before the voice crossed the threshold
}

// Finds speech in a stream of 16 kHz frames. Feed it frames; it returns a clip when one ends.
export class Segmenter {
  private floor = 0.004;
  private loud = 0;
  private speaking = false;
  private silentMs = 0;
  private frames: Float32Array[] = [];
  private preroll: Float32Array[] = [];
  private prerollSamples = 0;
  private samples = 0;
  private lead = 0;            // samples of pre-roll at the start of this clip
  private opts: Required<SegmenterOptions>;

  constructor(opts: SegmenterOptions = {}) {
    this.opts = { minSpeechMs: 500, endSilenceMs: 800, maxMs: 9000, prerollMs: 350, ...opts };
  }

  get inSpeech(): boolean { return this.speaking; }

  push(frame: Float32Array): Clip | null {
    const level = rms(frame);
    const ms = (frame.length / RATE) * 1000;
    const threshold = Math.max(0.022, this.floor * 3.5);
    const voiced = level > threshold;
    if (!this.speaking) {
      if (!voiced && level < threshold) this.floor = this.floor * 0.95 + level * 0.05;   // learn the room's noise
      this.preroll.push(frame); this.prerollSamples += frame.length;
      while (this.prerollSamples > (this.opts.prerollMs / 1000) * RATE && this.preroll.length > 1) this.prerollSamples -= this.preroll.shift()!.length;
      this.loud = voiced ? this.loud + 1 : 0;
      if (this.loud >= 2) {
        this.speaking = true; this.silentMs = 0;
        this.frames = [...this.preroll]; this.samples = this.prerollSamples; this.lead = this.prerollSamples;
        this.preroll = []; this.prerollSamples = 0;
      }
      return null;
    }
    this.frames.push(frame); this.samples += frame.length;
    this.silentMs = level < threshold * 0.7 ? this.silentMs + ms : 0;
    const total = (this.samples / RATE) * 1000;
    if (this.silentMs >= this.opts.endSilenceMs || total >= this.opts.maxMs) return this.finish();
    return null;
  }

  // Ends the clip now (e.g. when the mic is switched off mid-sentence).
  flush(): Clip | null { return this.speaking ? this.finish() : null; }

  private finish(): Clip | null {
    const spoken = (((this.samples - this.lead) / RATE) * 1000) - this.silentMs;
    const all = new Float32Array(this.samples);
    let at = 0;
    for (const f of this.frames) { all.set(f, at); at += f.length; }
    this.speaking = false; this.loud = 0; this.frames = []; this.samples = 0;
    const keep = Math.max(0, all.length - Math.floor(((Math.max(0, this.silentMs - 250)) / 1000) * RATE));   // leave a little tail
    this.silentMs = 0;
    if (spoken < this.opts.minSpeechMs) return null;
    const samples = all.subarray(0, keep);
    return { samples, seconds: samples.length / RATE };
  }
}

// ---- the microphone ----------------------------------------------------------

export const micAvailable = (): boolean =>
  typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia &&
  typeof window !== 'undefined' && !!((window as any).AudioContext || (window as any).webkitAudioContext);

export interface ListenerEvents {
  clip: (wav: Blob, seconds: number) => void;
  level?: (speaking: boolean) => void;
  error: (message: string) => void;
}

export class VoiceListener {
  private stream: MediaStream | null = null;
  private ctx: AudioContext | null = null;
  private node: ScriptProcessorNode | null = null;
  private seg = new Segmenter();
  private lastSpeaking = false;

  constructor(private events: ListenerEvents, private opts: SegmenterOptions = {}) {}

  get running(): boolean { return this.stream !== null; }

  // Must run from a tap or click (iPhone Safari won't open the mic otherwise).
  async start(): Promise<void> {
    if (this.stream) return;
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
    } catch (e: any) {
      this.events.error(e?.name === 'NotAllowedError' ? 'The microphone is blocked. Allow it for this site in the browser, then try again.' : 'No microphone found.');
      return;
    }
    const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
    this.ctx = new Ctx();
    await this.ctx!.resume().catch(() => {});
    this.seg = new Segmenter(this.opts);
    const source = this.ctx!.createMediaStreamSource(this.stream);
    this.node = this.ctx!.createScriptProcessor(2048, 1, 1);
    const from = this.ctx!.sampleRate;
    this.node.onaudioprocess = ev => {
      const clip = this.seg.push(downsample(new Float32Array(ev.inputBuffer.getChannelData(0)), from));
      if (this.seg.inSpeech !== this.lastSpeaking) { this.lastSpeaking = this.seg.inSpeech; this.events.level?.(this.lastSpeaking); }
      if (clip) this.events.clip(new Blob([encodeWav(clip.samples) as BlobPart], { type: 'audio/wav' }), clip.seconds);
    };
    source.connect(this.node);
    this.node.connect(this.ctx!.destination);     // a processor only runs while connected; its output is silent
  }

  stop(): void {
    const clip = this.seg.flush();
    if (clip) this.events.clip(new Blob([encodeWav(clip.samples) as BlobPart], { type: 'audio/wav' }), clip.seconds);
    try { this.node?.disconnect(); } catch { /* gone */ }
    this.node = null;
    this.stream?.getTracks().forEach(t => t.stop());
    this.stream = null;
    this.ctx?.close().catch(() => {});
    this.ctx = null;
    this.lastSpeaking = false;
  }
}
