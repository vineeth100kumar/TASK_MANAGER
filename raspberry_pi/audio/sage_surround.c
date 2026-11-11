/*
 * sage_surround.c - Sage's virtual surround for the soundbar (a LADSPA plugin).
 *
 * The Pi plays to a stereo Bluetooth soundbar. This makes that sound wider and
 * roomier, the way "virtual surround" modes on TVs do, using plain open DSP:
 *
 *   1. Mid/side split. Side (what differs between left and right, which is where
 *      surround and ambience live in a stereo mix) is boosted above ~150 Hz, so
 *      the bass stays centred and tight.
 *   2. Early reflections: a few short (13-29 ms) delayed, band-limited copies are
 *      added to the side, which pushes sound out past the soundbar's edges and
 *      gives even mono-ish material some room.
 *   3. Dialogue lift: a gentle presence boost (~2.8 kHz) on the mid only, so
 *      voices stay clear when the room gets bigger.
 *   4. Tone: a bass shelf (~120 Hz) on the mid with a 30 Hz rumble filter (a
 *      soundbar can't play lower, so that headroom goes to bass it can play),
 *      and an "air" shelf (~8 kHz) for sparkle and detail.
 *   5. Punch: a gentle compressor that brings up quiet detail and makes the
 *      sound fuller and louder, with make-up gain.
 *   6. A smooth peak limiter (fast attack, ~80 ms release) at -0.5 dBFS and a
 *      soft clip as a last guard, so none of the boosts ever clip.
 *
 * Ports: Width 0..1, Space 0..1, Dialog 0..9 dB, Bass 0..9 dB, Air 0..9 dB,
 * Punch 0..1, then stereo in/out. All zero is a bit-for-bit pass-through for
 * anything below the limiter's ceiling.
 * It is a stereo plugin, so ALSA's ladspa PCM runs it with policy none
 * (deploy/alsa/60-sage-surround.conf). Built on the Pi by deploy/install_pi.sh:
 *   gcc -O2 -fPIC -shared -o sage_surround.so sage_surround.c -lm
 *
 * The LADSPA types below follow the public LADSPA 1.1 API (ladspa.h), written
 * out here so the Pi doesn't need the ladspa-sdk headers.
 */

#include <math.h>
#include <stdlib.h>
#include <string.h>

typedef float LADSPA_Data;
typedef int LADSPA_Properties;
typedef int LADSPA_PortDescriptor;
typedef int LADSPA_PortRangeHintDescriptor;
typedef void *LADSPA_Handle;

#define LADSPA_PROPERTY_HARD_RT_CAPABLE 0x4
#define LADSPA_PORT_INPUT 0x1
#define LADSPA_PORT_OUTPUT 0x2
#define LADSPA_PORT_CONTROL 0x4
#define LADSPA_PORT_AUDIO 0x8
#define LADSPA_HINT_BOUNDED_BELOW 0x1
#define LADSPA_HINT_BOUNDED_ABOVE 0x2
#define LADSPA_HINT_DEFAULT_MIDDLE 0x180

typedef struct { LADSPA_PortRangeHintDescriptor HintDescriptor; LADSPA_Data LowerBound, UpperBound; } LADSPA_PortRangeHint;

typedef struct _LADSPA_Descriptor {
  unsigned long UniqueID;
  const char *Label;
  LADSPA_Properties Properties;
  const char *Name, *Maker, *Copyright;
  unsigned long PortCount;
  const LADSPA_PortDescriptor *PortDescriptors;
  const char *const *PortNames;
  const LADSPA_PortRangeHint *PortRangeHints;
  void *ImplementationData;
  LADSPA_Handle (*instantiate)(const struct _LADSPA_Descriptor *, unsigned long);
  void (*connect_port)(LADSPA_Handle, unsigned long, LADSPA_Data *);
  void (*activate)(LADSPA_Handle);
  void (*run)(LADSPA_Handle, unsigned long);
  void (*run_adding)(LADSPA_Handle, unsigned long);
  void (*set_run_adding_gain)(LADSPA_Handle, LADSPA_Data);
  void (*deactivate)(LADSPA_Handle);
  void (*cleanup)(LADSPA_Handle);
} LADSPA_Descriptor;

enum { P_WIDTH, P_SPACE, P_DIALOG, P_BASS, P_AIR, P_PUNCH, P_IN_L, P_IN_R, P_OUT_L, P_OUT_R, P_COUNT };

#define DELAY_SIZE 8192 /* > 29 ms at 192 kHz */

typedef struct { double b0, b1, b2, a1, a2, z1, z2; } Biquad;

typedef struct {
  LADSPA_Data *port[P_COUNT];
  double rate;
  /* side: bass split (two one-poles) */
  double s_lp1, s_lp2, lp_k;
  /* reflections: band-limit then delay */
  Biquad f_side_hp, f_side_lp, f_mid_hp, f_mid_lp;
  float *d_side, *d_mid;
  unsigned pos;
  unsigned t13, t23, t17, t29;
  /* tone */
  Biquad presence, shelf, rumble_l, rumble_r, air_l, air_r;
  float last_dialog, last_bass, last_air;
  double gain_smooth, side_smooth, space_smooth, makeup_smooth;
  /* dynamics */
  double comp_env, lim_env, att_c, rel_c, lim_rel;
} Surround;

static void bq_set(Biquad *q, double b0, double b1, double b2, double a0, double a1, double a2) {
  q->b0 = b0 / a0; q->b1 = b1 / a0; q->b2 = b2 / a0; q->a1 = a1 / a0; q->a2 = a2 / a0;
}

static double bq_run(Biquad *q, double x) {
  double y = q->b0 * x + q->z1;
  q->z1 = q->b1 * x - q->a1 * y + q->z2;
  q->z2 = q->b2 * x - q->a2 * y;
  return y;
}

/* RBJ audio EQ cookbook filters */
static void bq_lowpass(Biquad *q, double fs, double f, double Q) {
  double w = 2 * M_PI * f / fs, c = cos(w), a = sin(w) / (2 * Q);
  bq_set(q, (1 - c) / 2, 1 - c, (1 - c) / 2, 1 + a, -2 * c, 1 - a);
}
static void bq_highpass(Biquad *q, double fs, double f, double Q) {
  double w = 2 * M_PI * f / fs, c = cos(w), a = sin(w) / (2 * Q);
  bq_set(q, (1 + c) / 2, -(1 + c), (1 + c) / 2, 1 + a, -2 * c, 1 - a);
}
static void bq_peak(Biquad *q, double fs, double f, double Q, double db) {
  double A = pow(10, db / 40), w = 2 * M_PI * f / fs, c = cos(w), a = sin(w) / (2 * Q);
  bq_set(q, 1 + a * A, -2 * c, 1 - a * A, 1 + a / A, -2 * c, 1 - a / A);
}
static void bq_highshelf(Biquad *q, double fs, double f, double db) {
  double A = pow(10, db / 40), w = 2 * M_PI * f / fs, c = cos(w), s = sin(w);
  double a = s / 2 * sqrt(2), sa = 2 * sqrt(A) * a;
  bq_set(q, A * ((A + 1) + (A - 1) * c + sa), -2 * A * ((A - 1) + (A + 1) * c), A * ((A + 1) + (A - 1) * c - sa),
         (A + 1) - (A - 1) * c + sa, 2 * ((A - 1) - (A + 1) * c), (A + 1) - (A - 1) * c - sa);
}
static void bq_lowshelf(Biquad *q, double fs, double f, double db) {
  double A = pow(10, db / 40), w = 2 * M_PI * f / fs, c = cos(w), s = sin(w);
  double a = s / 2 * sqrt(2), sa = 2 * sqrt(A) * a;
  bq_set(q, A * ((A + 1) - (A - 1) * c + sa), 2 * A * ((A - 1) - (A + 1) * c), A * ((A + 1) - (A - 1) * c - sa),
         (A + 1) + (A - 1) * c + sa, -2 * ((A - 1) + (A + 1) * c), (A + 1) + (A - 1) * c - sa);
}

static float clampf(float v, float lo, float hi) { return v != v ? lo : v < lo ? lo : v > hi ? hi : v; }

static LADSPA_Handle instantiate(const LADSPA_Descriptor *d, unsigned long rate) {
  (void)d;
  Surround *p = calloc(1, sizeof(Surround));
  if (!p) return NULL;
  p->d_side = calloc(DELAY_SIZE, sizeof(float));
  p->d_mid = calloc(DELAY_SIZE, sizeof(float));
  if (!p->d_side || !p->d_mid) { free(p->d_side); free(p->d_mid); free(p); return NULL; }
  p->rate = rate ? (double)rate : 48000.0;
  return p;
}

static void connect_port(LADSPA_Handle h, unsigned long port, LADSPA_Data *data) {
  if (port < P_COUNT) ((Surround *)h)->port[port] = data;
}

static void set_eq(Surround *p, float dialog, float bass, float air) {
  bq_peak(&p->presence, p->rate, 2800, 0.9, dialog);
  bq_lowshelf(&p->shelf, p->rate, 120, bass);
  bq_highshelf(&p->air_l, p->rate, 8000, air);
  bq_highshelf(&p->air_r, p->rate, 8000, air);
  p->last_dialog = dialog;
  p->last_bass = bass;
  p->last_air = air;
}

static void activate(LADSPA_Handle h) {
  Surround *p = h;
  double fs = p->rate;
  p->s_lp1 = p->s_lp2 = 0;
  p->lp_k = 1 - exp(-2 * M_PI * 150 / fs);
  bq_highpass(&p->f_side_hp, fs, 200, 0.7);
  bq_lowpass(&p->f_side_lp, fs, 7000, 0.7);
  bq_highpass(&p->f_mid_hp, fs, 300, 0.7);
  bq_lowpass(&p->f_mid_lp, fs, 6000, 0.7);
  p->f_side_hp.z1 = p->f_side_hp.z2 = p->f_side_lp.z1 = p->f_side_lp.z2 = 0;
  p->f_mid_hp.z1 = p->f_mid_hp.z2 = p->f_mid_lp.z1 = p->f_mid_lp.z2 = 0;
  memset(p->d_side, 0, DELAY_SIZE * sizeof(float));
  memset(p->d_mid, 0, DELAY_SIZE * sizeof(float));
  p->pos = 0;
  p->t13 = (unsigned)(0.013 * fs); p->t23 = (unsigned)(0.023 * fs);
  p->t17 = (unsigned)(0.017 * fs); p->t29 = (unsigned)(0.029 * fs);
  memset(&p->presence, 0, sizeof(Biquad));
  memset(&p->shelf, 0, sizeof(Biquad));
  memset(&p->air_l, 0, sizeof(Biquad));
  memset(&p->air_r, 0, sizeof(Biquad));
  bq_highpass(&p->rumble_l, fs, 30, 0.7);
  bq_highpass(&p->rumble_r, fs, 30, 0.7);
  p->rumble_l.z1 = p->rumble_l.z2 = p->rumble_r.z1 = p->rumble_r.z2 = 0;
  set_eq(p, p->port[P_DIALOG] ? clampf(*p->port[P_DIALOG], 0, 9) : 0, p->port[P_BASS] ? clampf(*p->port[P_BASS], 0, 9) : 0,
         p->port[P_AIR] ? clampf(*p->port[P_AIR], 0, 9) : 0);
  p->gain_smooth = p->side_smooth = p->space_smooth = p->makeup_smooth = -1; /* first run jumps straight there */
  p->comp_env = p->lim_env = 0;
  p->att_c = 1 - exp(-1.0 / (0.010 * fs));   /* compressor: 10 ms attack */
  p->rel_c = 1 - exp(-1.0 / (0.200 * fs));   /*             200 ms release */
  p->lim_rel = exp(-1.0 / (0.080 * fs));      /* limiter: 80 ms release */
}

static float soft_limit(double x) {
  double a = fabs(x);
  if (a <= 0.95) return (float)x;
  double y = 0.95 + 0.05 * tanh((a - 0.95) / 0.05);
  return (float)(x < 0 ? -y : y);
}

#define LIMIT_CEILING 0.944 /* -0.5 dBFS */

static void run(LADSPA_Handle h, unsigned long n) {
  Surround *p = h;
  float width = clampf(p->port[P_WIDTH] ? *p->port[P_WIDTH] : 0, 0, 1);
  float space = clampf(p->port[P_SPACE] ? *p->port[P_SPACE] : 0, 0, 1);
  float dialog = clampf(p->port[P_DIALOG] ? *p->port[P_DIALOG] : 0, 0, 9);
  float bass = clampf(p->port[P_BASS] ? *p->port[P_BASS] : 0, 0, 9);
  float air = clampf(p->port[P_AIR] ? *p->port[P_AIR] : 0, 0, 9);
  float punch = clampf(p->port[P_PUNCH] ? *p->port[P_PUNCH] : 0, 0, 1);
  if (dialog != p->last_dialog || bass != p->last_bass || air != p->last_air) set_eq(p, dialog, bass, air);
  int neutral = width == 0 && space == 0 && dialog == 0 && bass == 0 && air == 0 && punch == 0;

  double side_gain = 1 + 1.6 * width;                 /* side above ~150 Hz */
  /* A little headroom for the boosts; the compressor's make-up and the
     limiter bring the loudness back up without clipping. */
  double trim = pow(10, -(1.0 * width + 0.6 * space) / 20);
  /* Compressor: threshold -18 dBFS, ratio 1..3; the make-up gain is about what
     the compressor takes off a typical loud (-6 dBFS) passage, so loud music
     stays about as loud and quiet parts come up. */
  const double threshold = 0.126;
  double ratio = 1 + 2.0 * punch;
  double makeup = pow(10, 12.0 * (1 - 1 / ratio) * 0.9 / 20);
  if (p->gain_smooth < 0) { p->gain_smooth = trim; p->side_smooth = side_gain; p->space_smooth = space; p->makeup_smooth = makeup; }
  const double k = 0.002; /* ~10 ms glide when the settings change */
  const unsigned mask = DELAY_SIZE - 1;

  const LADSPA_Data *inL = p->port[P_IN_L], *inR = p->port[P_IN_R];
  LADSPA_Data *outL = p->port[P_OUT_L], *outR = p->port[P_OUT_R];
  for (unsigned long i = 0; i < n; i++) {
    double l = inL[i], r = inR[i];
    if (neutral && p->gain_smooth == 1 && p->makeup_smooth == 1) {
      outL[i] = soft_limit(l);
      outR[i] = soft_limit(r);
      continue;
    }
    p->gain_smooth += k * (trim - p->gain_smooth);
    p->side_smooth += k * (side_gain - p->side_smooth);
    p->space_smooth += k * (space - p->space_smooth);
    p->makeup_smooth += k * (makeup - p->makeup_smooth);
    double mid = 0.5 * (l + r), side = 0.5 * (l - r);

    /* 1. widen the side above the bass */
    p->s_lp1 += p->lp_k * (side - p->s_lp1);
    p->s_lp2 += p->lp_k * (p->s_lp1 - p->s_lp2);
    double s_low = p->s_lp2, s_high = side - s_low;
    double s = s_low + s_high * p->side_smooth;

    /* 2. early reflections into the side */
    float sf = (float)bq_run(&p->f_side_lp, bq_run(&p->f_side_hp, side));
    float mf = (float)bq_run(&p->f_mid_lp, bq_run(&p->f_mid_hp, mid));
    p->d_side[p->pos] = sf;
    p->d_mid[p->pos] = mf;
    double refl = 0.55 * p->d_side[(p->pos - p->t13) & mask] - 0.32 * p->d_side[(p->pos - p->t23) & mask]
                + 0.24 * p->d_mid[(p->pos - p->t17) & mask] - 0.16 * p->d_mid[(p->pos - p->t29) & mask];
    p->pos = (p->pos + 1) & mask;
    s += p->space_smooth * 1.4 * refl;

    /* 3 + 4. dialogue and bass on the mid, then air and rumble on each side */
    double m = bq_run(&p->shelf, bq_run(&p->presence, mid));
    double ol = (m + s) * p->gain_smooth, or_ = (m - s) * p->gain_smooth;
    ol = bq_run(&p->air_l, bq_run(&p->rumble_l, ol));
    or_ = bq_run(&p->air_r, bq_run(&p->rumble_r, or_));

    /* 5. punch: compress above the threshold (linked stereo), then make-up */
    double peak = fmax(fabs(ol), fabs(or_));
    p->comp_env += (peak > p->comp_env ? p->att_c : p->rel_c) * (peak - p->comp_env);
    double cg = 1;
    if (ratio > 1 && p->comp_env > threshold)
      cg = pow(p->comp_env / threshold, 1 / ratio - 1);
    double g = cg * p->makeup_smooth;
    ol *= g;
    or_ *= g;

    /* 6. limiter: instant attack, smooth release, then a soft clip guard */
    peak = fmax(fabs(ol), fabs(or_));
    p->lim_env = peak > p->lim_env ? peak : p->lim_env * p->lim_rel + peak * (1 - p->lim_rel);
    if (p->lim_env > LIMIT_CEILING) {
      double lg = LIMIT_CEILING / p->lim_env;
      ol *= lg;
      or_ *= lg;
    }
    outL[i] = soft_limit(ol);
    outR[i] = soft_limit(or_);
  }
}

static void cleanup(LADSPA_Handle h) {
  Surround *p = h;
  if (!p) return;
  free(p->d_side);
  free(p->d_mid);
  free(p);
}

static const LADSPA_PortDescriptor port_desc[P_COUNT] = {
  LADSPA_PORT_INPUT | LADSPA_PORT_CONTROL, LADSPA_PORT_INPUT | LADSPA_PORT_CONTROL,
  LADSPA_PORT_INPUT | LADSPA_PORT_CONTROL, LADSPA_PORT_INPUT | LADSPA_PORT_CONTROL,
  LADSPA_PORT_INPUT | LADSPA_PORT_CONTROL, LADSPA_PORT_INPUT | LADSPA_PORT_CONTROL,
  LADSPA_PORT_INPUT | LADSPA_PORT_AUDIO, LADSPA_PORT_INPUT | LADSPA_PORT_AUDIO,
  LADSPA_PORT_OUTPUT | LADSPA_PORT_AUDIO, LADSPA_PORT_OUTPUT | LADSPA_PORT_AUDIO,
};
static const char *const port_names[P_COUNT] = {
  "Width", "Space", "Dialog (dB)", "Bass (dB)", "Air (dB)", "Punch", "Input L", "Input R", "Output L", "Output R",
};
#define BOUNDED (LADSPA_HINT_BOUNDED_BELOW | LADSPA_HINT_BOUNDED_ABOVE | LADSPA_HINT_DEFAULT_MIDDLE)
static const LADSPA_PortRangeHint port_hints[P_COUNT] = {
  {BOUNDED, 0, 1}, {BOUNDED, 0, 1}, {BOUNDED, 0, 9}, {BOUNDED, 0, 9}, {BOUNDED, 0, 9}, {BOUNDED, 0, 1}, {0, 0, 0}, {0, 0, 0}, {0, 0, 0}, {0, 0, 0},
};

static const LADSPA_Descriptor descriptor = {
  7410, "sage_surround", LADSPA_PROPERTY_HARD_RT_CAPABLE, "Sage virtual surround", "Sage", "MIT",
  P_COUNT, port_desc, port_names, port_hints, NULL,
  instantiate, connect_port, activate, run, NULL, NULL, NULL, cleanup,
};

const LADSPA_Descriptor *ladspa_descriptor(unsigned long index) {
  return index == 0 ? &descriptor : NULL;
}
