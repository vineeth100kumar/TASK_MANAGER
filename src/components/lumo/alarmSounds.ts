// Made by lumo/tools/alarm_sounds.py from lumo/esp32_client/tones.h. Don't edit by hand.
// Each sound's notes over one cycle: [start ms, length ms, pitch Hz, peak 0-255].
export interface AlarmSoundShape { cycleMs: number; buildMs: number; notes: [number, number, number, number][] }

export const ALARM_SOUND_SHAPES: Record<string, AlarmSoundShape> = {
  pulse: { cycleMs: 1300, buildMs: 20000, notes: [[0, 130, 2960, 255], [257, 130, 2349, 255]] },
  classic: { cycleMs: 1310, buildMs: 8000, notes: [[0, 90, 2700, 255], [180, 90, 2700, 255], [360, 90, 2700, 255], [540, 90, 2700, 255]] },
  rising: { cycleMs: 1600, buildMs: 60000, notes: [[0, 160, 2349, 255], [220, 160, 2960, 255], [440, 280, 3520, 255]] },
  chirp: { cycleMs: 1169, buildMs: 6000, notes: [[0, 14, 2637, 255], [14, 12, 3136, 255], [26, 17, 3520, 255], [113, 14, 2637, 255], [127, 12, 3136, 255], [139, 17, 3520, 255], [226, 14, 2637, 255], [240, 12, 3136, 255], [252, 17, 3520, 255]] },
  chime: { cycleMs: 2740, buildMs: 30000, notes: [[0, 420, 3520, 255], [420, 420, 2960, 255], [840, 700, 2349, 255]] },
  dawn: { cycleMs: 4580, buildMs: 120000, notes: [[0, 280, 2349, 200], [1180, 280, 2960, 200], [2360, 420, 3520, 230]] },
  melody: { cycleMs: 2630, buildMs: 20000, notes: [[0, 150, 2349, 255], [180, 150, 2637, 255], [360, 150, 2960, 255], [540, 300, 3520, 255], [900, 150, 2960, 255], [1080, 450, 3520, 255]] },
  urgent: { cycleMs: 1290, buildMs: 3000, notes: [[0, 70, 2637, 255], [70, 70, 3520, 255], [140, 70, 2637, 255], [210, 70, 3520, 255], [280, 70, 2637, 255], [350, 70, 3520, 255], [420, 70, 2637, 255], [490, 70, 3520, 255], [560, 70, 2637, 255], [630, 70, 3520, 255], [700, 70, 2637, 255], [770, 70, 3520, 255]] },
};
