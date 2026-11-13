# The reel script format (reel.md)

**What Reels are for:** the same useful, on-brand content as a carousel post, as a vertical video
(1080x1920, H.264 + AAC, ready for Instagram) where a voice tells the story and each line, number and
picture appears **as it is spoken**: not a slideshow. You (or any AI) write a short script; the Pi
speaks it, draws the slides with the same renderer as Posts, times every piece to the voice, adds
word-by-word captions and encodes the mp4. Nothing is rewritten or invented by the app.

- Make: the **Reels** screen in Sage, or `python -m autocontent reel my_reel.md`
- Check only: `python -m autocontent reel-check my_reel.md`
- Full example: [example_reel.md](example_reel.md)
- **Music is not added.** Add trending audio in Instagram after you share the video.

A reel script **is** a post script ([POST_FORMAT.md](POST_FORMAT.md): same slide types, fields, themes,
pictures and spelling help) with a few extra lines. Everything in POST_FORMAT.md works here.

---

## Prompt for another AI

<!-- PROMPT START -->
You write Instagram reels for a page whose goal is content that is genuinely useful and earns saves, shares and comments. A reel is a vertical video: a calm voice tells a short story and each slide builds on screen as it is spoken. Output ONLY a script in the format below, with no explanation and no code fence around it.

HOW A GOOD REEL WORKS
- The first slide's narration is the hook and must land in the first 2 seconds: a surprising number, a bold claim or a question. Max 12 words.
- 20 to 45 seconds is the sweet spot (5 to 8 slides); never more than 90. Speech runs about 2.5 words a second: a 30-second reel is about 75 words in all.
- One idea per slide. 12 to 30 spoken words per slide. A slide that needs more is two slides.
- HOW MUCH GOES ON THE SLIDE ITSELF (this is a hard limit, not a style note — a reel sets type far larger than a feed slide): about 26 words of slide text in all, counting the headline, the bullets, the body and the kicker. Over 40 words, or more than four bullets, and the script is refused. Three short bullets is the comfortable shape. The voice carries the detail; the slide carries the point.
- A headline is under 9 words. A kicker is a label under 28 characters, not a sentence. A stat's number is a number, not a sentence.
- Write the narration the way people talk: short sentences, plain words, contractions. Read it aloud. Spell out how numbers are said ("two thirds", "five lakh rupees"), or write 65% / ₹5 lakh and the voice will say them properly.
- For an abbreviation the voice should spell out, put spaces between the capitals in `say:` ("N X P", "A I", "U K"). The captions put it back together and show NXP, AI, UK.
- WRITE FOR THE EAR, it is what makes the voice sound human: one idea per sentence, 6 to 14 words. Punctuation is the voice's direction — a comma is a small breath, a full stop a beat, a question rises and waits a little longer, "…" trails off, and an em dash (—) makes a short turn. Ask the viewer questions. Use `[pause]` (or `[pause 0.6]`, `[breath]`, `[beat]`) inside `say:` right before a reveal; these marks are never spoken or captioned.
- Give each slide a `tone:` that fits it: hook for the opener, emphasis for a big number or the takeaway, calm for a quote or a soft moment, excited for a surprising turn. Leave it out and the opener is a hook, stat and cta slides get emphasis, quotes are calm.
- The narration and the slide say the same thing in different ways: the slide shows the number or the three steps, the voice explains why it matters. Do not read the slide word for word.
- Build curiosity slide to slide; save the best insight for the middle; end with a reason to save or comment.
- Use only facts you were given and never invent statistics. Put `source:` on slides that state facts.

FORMAT
Start with this header:
---
autocontent: reel
title: <short title>
style: grid_pill
voice: af_heart
captions: on
tag: "#topic"
---
(voice: a Kokoro voice — US women af_heart (default, warm), af_bella, af_nicole, af_sarah, af_sky; US men am_adam, am_michael, am_puck; UK women bf_emma, bf_isabella, bf_lily; UK men bm_george, bm_lewis, bm_daniel — or `voice: mine` when the author will record the narration themselves. speed: 0.6 to 1.4, 1.0 normal. captions: off removes the captions. fps: 24 to 60, 30 default. end_hold: seconds the last slide holds, 1.2 default.
Voice controls, all optional: voice can be a BLEND of two or three voices for a warmer, less stock sound, e.g. `voice: af_heart*0.7 + af_bella*0.3` (weights or percentages; `af_heart, af_bella` is equal parts). pace: auto (default; the slide tones above) or steady (one pace throughout). pauses: tight | natural | relaxed, or a number 0.3 to 2.5 that scales every pause. polish: natural (default) | warm | bright | clean | off, the finishing EQ, de-essing and compression. loudness: 9 to 23, the target loudness in −LUFS, 14 default (Instagram's level). pronounce: words the voice gets wrong, respelled as they sound, e.g. `pronounce: Nvidia = en-vidia; Kubernetes = koo-ber-net-eez`.)

Then each slide starts with `## <type>` exactly as in a post script (cover, statement, point, list, stat, compare, quote, chart, table, image, cta), with its own fields, and these extra lines:
say: <what the voice says over this slide>            (REQUIRED on every slide; plain sentences, no symbols or links)
show: <cue> | <cue> | <cue>                            (optional: the words in `say:` at which each piece of the slide should appear, in order; copy them exactly from `say:`)
motion: rise | pop | stagger | wipe | kenburns | fade  (optional, best left out: each piece always arrives in the way that suits it. This is only used for a piece the reel doesn't recognise.)
objects: arrow-right @ 50,80 120 accent                (optional: overlay shapes and icons on the slide; see the Objects section below)
duration: 3                                            (optional, only for a slide with no `say:`: seconds to hold it)
pause: 0.5                                             (optional: extra silence after this slide's narration)
tone: hook | emphasis | calm | excited | serious | dramatic | slow | fast | normal   (optional: how this slide is delivered; sets its pace)
speed: 0.95                                            (optional: this slide's own pace, 0.7 to 1.3, times the reel's speed; wins over tone)
voice: am_michael                                      (optional: a different voice for this slide only, e.g. a second speaker or a quote)

WHAT APPEARS, IN ORDER (each is one "piece"; with no `show:` they are spread evenly over the narration)
cover: headline, then the pill | point: headline, text, each bullet | list: headline, each item | stat: label, big number, explanation | compare: headline, left column, right column | quote: quote, author | chart/table: headline, then the chart or table | image: headline, picture (slow push-in), caption | cta: headline, pill, subtext
A `source:` line arrives with the last piece.

After the slides: `## caption` (the Instagram caption: a hook line, 3-6 short paragraphs of value, a question for the comments) and `## hashtags` (3 to 5 specific hashtags).

HOW IT LOOKS ON SCREEN (nothing to ask for; it is automatic)
Headlines, quotes and statements are typed out left to right with a caret. Big numbers count up to their value. A list keeps the step being spoken bright and fades the earlier ones back. A bar across the top shows progress. One slide wipes into the next. Nothing pans or slides across the screen.

LAYOUT RULES (a reel is 9:16; Instagram covers the top and bottom, so the slide keeps to the middle and the captions sit below it)
- Keep headlines under 9 words and points/bullets under 12 words: they are set large for a phone screen.
- Anything that still doesn't fit is made to fit: the slide is set smaller, then its kicker goes, then its source line. Write to the limits above and none of that has to happen.
- cta: the subtext sits beside the pill, so keep it to 3 or 4 short words (SAVE THIS + COMMENT 1, 2 OR 3).
- Do not write `music:`; music is added in Instagram.

EXAMPLE
(see example_reel.md in the same folder; it is returned with this guide)
<!-- PROMPT END -->

---

## The extra lines, in detail

Everything a post script's header takes (`title:`, `style:`, `tag:`, `page_name:`...) works here too.
These are the reel's own lines.

| Line | Where | What it does | Also written as |
|------|-------|--------------|-----------------|
| `autocontent: reel` | header | **Required, first line inside the `---`.** Without it the file is read as a post. | `reels`, `video` |
| `voice:` | header | A Kokoro voice name, or `mine` for your own recording. | `voiceover:` |
| `speed:` | header | 0.6 to 1.4; 1.0 normal. | |
| `voice:` blend | header | `af_heart*0.7 + af_bella*0.3`, `af_heart 70% + af_bella 30%` or `af_heart, af_bella` (equal). Mixes the voices into one new voice. | |
| `pace:` | header | `auto` (default): the first slide speaks as a hook (1.08×), `stat` and `cta` slides with emphasis (0.92×), `quote` slides calm (0.95×), unless a slide names its own `tone:` or `speed:`. `steady`: one pace throughout. | |
| `pauses:` | header | How long the breaths are: `tight` (0.7×), `natural` (1×, default), `relaxed` (1.35×), or a number 0.3 to 2.5. Scales the pauses inside a slide and between slides. | `breaths:` |
| `polish:` | header | The finishing chain on the voice: `natural` (default: rumble cut, a touch of body and presence, de-essing, gentle compression), `warm` (more body, softer top), `bright` (more presence), `clean` (compression only), `off`. Also applied to your own recording. | `sound:` |
| `loudness:` | header | Target loudness, 9 to 23 meaning −9 to −23 LUFS; default 14 (Instagram). | `lufs:` |
| `pronounce:` | header | `word = how it sounds; word = how it sounds`. Respelled before speaking; captions keep the written word. Built in: UPI, GST, EV, IPO (spelled), SaaS ("sass"), Pi ("pie"). Capitalised words match exactly; lower-case ones match any case. | `say_as:`, `pronunciation:` |
| `captions:` | header | `on` (word by word, brand marker on the word being spoken) or `off`. | `subtitles:`, `caption_style:` |
| `fps:` | header | 24 to 60, default 30. | |
| `end_hold:` | header | Seconds the last slide stays after the last word; 0 to 6, default 1.2. | |
| `transition:` | header | The slide change; `fade` is the default and the only one that differs visibly today. | |
| `music:` | header | **Ignored, with a warning.** Add trending audio in Instagram. | |
| `aspect:` / `format:` | header | **Ignored, with a warning.** A reel is always 9:16, 1080x1920. | `ratio:`, `size:` |
| `say:` | each slide | The narration. A continuation line may be indented under it. Single capitals in a row ("N X P") are spoken as letters and shown joined up on the caption. The order of the slide and the order of the words in `say:` must agree: the voice should mention the first piece first, the second one second, and so on. | `vo:`, `voiceover:`, `narration:`, `speak:` |
| `show:` | each slide | **How you sync pieces to the voice.** Cue phrases copied verbatim from `say:`, separated by `\|` (`;`, `->` and `→` also work). One per piece. The piece lands 0.18 s before its cue word is spoken. With one fewer cue than pieces, the first piece opens the slide and the cues start at the second. A cue not found in `say:` is a warning and the pieces for that slide are spread evenly instead. See the sync section below. | `cue:`, `cues:` |
| `motion:` | each slide | Only for a piece the reel doesn't recognise (see below); every known piece always gets its own. | `animation:`, `animate:` |
| `objects:` | each slide | Overlay shapes and icons on the slide; pipe-separated, each `name @ x,y size colour anim rotation`. See the Objects section. | `overlay:`, `overlays:`, `obj:` |
| `duration:` | each slide | Hold a slide that has no narration; 1 to 30 seconds. | `hold:` |
| `pause:` | each slide | Extra silence after this slide's narration; 0 to 5 seconds. | |
| `tone:` | each slide | `hook` 1.08×, `fast`/`excited` 1.1×, `normal` 1×, `calm` 0.95×, `warm` 0.96×, `serious` 0.93×, `emphasis` 0.92×, `slow` 0.9×, `dramatic` 0.88×. The slide's pace, on top of the reel's `speed:`. | `delivery:` |
| `speed:` | each slide | The slide's own pace multiplier, 0.7 to 1.3; wins over `tone:`. | |
| `voice:` | each slide | A different voice (or blend) for this slide only. | |
| `[pause]` marks | inside `say:` | `[pause]` 0.5 s, `[breath]` 0.28 s, `[beat]` 0.7 s, `[pause 0.8]` any length. Never spoken, never captioned. | |

**How the voice is made natural.** Each `say:` line is spoken one sentence at a time (a mark only
ends a sentence when a space follows it, so 2.5 and 3:30 stay whole), and the quiet after each one
follows its punctuation: 0.30 s after a full stop, 0.34 s after "!", 0.42 s after "?", 0.48 s after
"…", 0.24 s after ":" and 0.22 s after ";", all times `pauses:`. Commas are left to the voice, which
already breathes on them. One-word sentences are joined to the next so they don't sound clipped.

A slide with neither `say:` nor `duration:` is held for 3 seconds, and there is always a 0.38 s (times `pauses:`)
breath between one slide's narration and the next.

### How audio and slides stay in sync

The voice is the clock. Slides and pieces are placed on the reel's timeline from where each word
of `say:` is actually spoken. You never write timestamps; you write the narration and (where it
matters) which word introduces which piece.

**Step 1 — the voice is made.** Kokoro says every slide's `say:` line in order, with a 0.38 s
breath between slides and whatever `pause:` the slide asks for after that. With `voice: mine` the
same happens from your recording, read in slide order.

**Step 2 — each word is timed.** Whisper on the Pi listens to the finished voice track and
records when every spoken word starts and ends. If Whisper isn't installed, the words are spread
evenly across the pauses in the audio; a script that leans on cues should assume Whisper is
there.

**Step 3 — the slide windows.** A slide starts just before its first spoken word (about 0.14 s
earlier) and ends the moment the next slide's first word begins. There is no blank frame between
two slides: the next one's first piece has already started moving in before the old one leaves,
and the wipe carries the old one away. A slide with no `say:` holds for its `duration:` (3 s
without one). The last slide holds for `end_hold:` seconds after its last word (default 1.2 s).

**Step 4 — the pieces, one at a time.** Each slide has an ordered list of pieces (the headline,
each bullet, the number, the picture…). `show:` names them by a word or phrase from `say:`. The
first piece defaults to "open the slide" — so a line of three bullets usually only needs two
cues. The piece lands 0.18 s before the first letter of its cue word hits the speaker. No cue, no
`show:`, or a cue not found in `say:` falls back to spreading the pieces evenly across the
narration, in order.

**Step 5 — the captions.** Every spoken word is written along the bottom of the frame as it is
said, with a brand-colour marker under the word being spoken right now. A spelled-out
abbreviation ("N X P") is shown as one word on the caption ("NXP").

Three rules for an AI that writes a script that stays in sync:

1. **Mention things in slide order inside `say:`.** For a list of three steps, the voice should
   name step one first, step two second, step three third. The pieces then ride along even
   without `show:`.
2. **For a slide with more than two pieces, write `show:` with one cue per piece after the
   first.** Each cue is a word or short phrase that appears, verbatim and only once in that
   slide's `say:`, at the moment the piece should appear. For a list of three steps, something
   like `show: first | second | third` (when `say:` uses those words).
3. **Use `pause:` to let a piece breathe.** A big number or a strong statement that the viewer
   should sit with reads better with `pause: 0.4` to `pause: 1.0` after the slide's narration,
   than with a longer last sentence.

### How things move

You don't have to ask for any of this. Each piece arrives in the way that suits what it is, so a
slide reads as an infographic being built rather than a picture being shown:

| The piece | How it arrives |
| --- | --- |
| A kicker (the small label over a headline) | Rises into place out of a slot, just ahead of its headline |
| A headline, a quote, a statement, body text | Typed out, word by word, with a caret at the point it has reached |
| A highlighted word (`**like this**` or `==like this==`) | Types in the brand colour, like the rest of the line |
| The rule or brush underline under a headline | Drawn along its length once the headline is typed |
| A big number | Counts up to its real value, then holds |
| A pill (`pill:`, a CTA) | Laid down from its left end with a little overshoot, then its word is typed onto it |
| A bullet dot, a list number, a tick or cross | Pops on just before its own line is typed |
| A compare column | Its card is laid down, then its label and points are typed in |
| A picture | Uncovered upwards, then a slow push-in for as long as the slide is up |
| A table or chart | Builds downwards |
| A source line | A short fade, with the last piece |

Every list item, bullet and compare column also fades back once the voice moves on to the next,
so the step being spoken about is the bright one.

A post's dashed doodle line is left out of a reel.

Nothing pans or drifts: text lands where it is designed to sit and stays there. A thin bar across
the very top shows how far through the reel you are. One slide wipes into the next (a different
direction each time), carrying the old slide away while the new one's first line is already
arriving, so the change never shows an empty screen. Type is set larger than a feed slide's, to
fill a phone.

`motion:` no longer changes any of the above: every piece always arrives the way its kind does,
so one slide never looks different from the next. It is only used for a piece the reel doesn't
recognise: **rise** (slides up and fades in), **pop** (grows in with a small overshoot),
**stagger** (like rise, tighter), **wipe** (uncovers left to right), **kenburns** (rise, then a
slow push-in), **fade**. Everyday words are understood too: `slide`/`up` mean rise, `zoom`/`bounce`
mean pop, `cascade`/`one-by-one` mean stagger, `reveal` means wipe, `pan`/`drift` mean kenburns,
`none`/`plain` mean fade. Anything else is a warning. Best left out.

## Objects and icons (overlays)

You can place shapes, arrows, icons and visual markers on top of any slide with the `objects:` line.
Each object gets its own entrance and exit animation, timed relative to the object itself so it
composes correctly at any position on screen.

```
objects: arrow-right @ 50,80 120 accent | circle @ 30,40 80 muted
```

Each object is separated by `|`. The format for one object is:

```
<name> @ <x>,<y> <size> <colour> <animation> <rotation>
```

| Part | Required | What it is |
|------|----------|------------|
| `name` | yes | A built-in shape (`arrow-right`, `star`, `check`, `lightbulb`, …) or a Lucide icon (`icon:heart`, `icon:rocket`, `icon:trending-up`, …). |
| `@ x,y` | no | Position as a percentage of the canvas, e.g. `50,80` means 50% from the left, 80% from the top. Default `50,50` (centre). |
| `size` | no | Size in pixels (the larger dimension). Default 64. Write `120` or `120px`. |
| `colour` | no | A palette token (`accent`, `muted`, `dark`, `light`, `success`, `warn`, `danger`) or a hex colour (`#E44425`, `#fff`). Default `accent`. |
| `animation` | no | Override the default animation: `fly`, `scale`, `pop`, `spin`, `draw`, `flash`, `pulse`, `blink`, `wipe`, `fade`. Each shape has a fitting default. |
| `rotation` | no | Degrees to rotate, e.g. `45deg` or `-30deg`. Default 0. |

Also written as: `overlay:`, `overlays:`, `obj:`.

### Built-in shapes (41)

| Category | Shapes |
|----------|--------|
| **Arrows** | `arrow-right`, `arrow-left`, `arrow-up`, `arrow-down`, `arrow-up-right` |
| **Basic** | `circle`, `circle-filled`, `square`, `square-filled`, `triangle`, `diamond`, `star`, `hexagon` |
| **Lines** | `line`, `line-v`, `plus`, `minus`, `x`, `check` |
| **Callouts** | `badge`, `callout`, `speech`, `underline`, `bracket-left`, `bracket-right`, `highlight` |
| **Emphasis** | `sparkle`, `zap`, `flame`, `target` |
| **Concepts** | `eye`, `money`, `chart-up`, `clock`, `lock`, `globe`, `users`, `lightbulb`, `shield`, `gear`, `heart` |

Many have aliases: `tick` → `check`, `dollar` → `money`, `world` → `globe`, `bulb` → `lightbulb`, `cog` → `gear`, `people` → `users`, etc.

### Lucide icons (2 300+)

Any [Lucide](https://lucide.dev/icons/) icon works with the `icon:` prefix:

```
objects: icon:rocket @ 70,20 100 accent | icon:trending-up @ 30,60 80 success
```

### Animations

Each animation runs as an entrance when the object appears, and in reverse as a quick exit before
the slide changes. All transforms are relative to the object's own bounding box, so they compose
at any position.

| Animation | What it does | Default for |
|-----------|-------------|-------------|
| `fly` | Slides in from the side with overshoot | Arrows |
| `scale` | Grows from the centre with overshoot | Circles, squares, triangles, hexagons, shields |
| `pop` | Grows from 30% with a bounce | Badges, callouts, speech bubbles |
| `spin` | Rotates in from 180° while scaling up | Diamonds, stars, sparkles, gears, clocks, x |
| `draw` | Left-to-right wipe reveal | Lines, underlines, brackets, checks, chart-up |
| `flash` | Bright flash then settles to normal | Zap, lightbulb |
| `pulse` | Scale bounce 1→1.25→1 | Flames, hearts |
| `blink` | Quick scale pinch 1→0.7→1.15→1 | Eye |
| `wipe` | Left-to-right reveal | Highlights |
| `fade` | Simple opacity fade | Fallback |

Objects appear 0.25 s after the slide starts, staggered 0.18 s apart, and exit 0.24 s before
the slide changes.

---

## Your own voice

Write `voice: mine`, make the reel, and when it asks, record the narration on your phone (one take,
every slide's `say:` lines in order) or upload the file. The Pi listens to find when each word is said
(Whisper where installed, otherwise it measures the pauses), so slides, pieces and captions follow *your*
timing and your wording stays on the captions as written in `say:`. Read the `say:` lines as written:
if you change words the captions still show the script's words, and timing may drift a little.
With your own recording every slide needs a `say:` line.

## What the checks say

Nothing is ever drawn over the captions: after every slide is laid out, the renderer measures it
and, if the content reaches too far down, sets it smaller step by step, then drops the kicker, then
the source line. A slide only fails when even that isn't enough, and then it says how much has to
go. So an over-long script from an AI gives you a smaller slide, not a broken video.

`reel-check` and the Reels screen list everything with its line and slide number. Errors stop the
reel; warnings don't.

| | What it means |
|---|---|
| **Error** — not a reel | The file doesn't start with `autocontent: reel`. |
| **Error** — nothing to say | No slide has a `say:` line. |
| **Error** — doesn't fit | Text that cannot be made to fit the screen even at the smallest size, named by slide number (the same as a failed post audit). Shorten it and make it again. |
| Warning — silent slide | A slide with no `say:` and no `duration:`; it is held for 3 seconds. |
| Warning — long slide | Over twenty seconds of speech on one screen. Split it. |
| Warning — link or handle in the narration | A voice reads a URL letter by letter. |
| Warning — symbols in the narration | `#`, `*`, backticks and brackets are read aloud or skipped. |
| Warning — cue not found | A `show:` phrase isn't in that slide's `say:`; the pieces are spread evenly instead. |
| **Error** — slide too full | Over 40 words of slide text, or more than four bullets. Split the slide. |
| Warning — slide full | Over about 26 words of slide text; it is set smaller to fit. |
| Warning — headline or kicker long | Over 9 words, or a kicker over 28 characters. |
| Warning — too long / too short | Over 90 seconds, or under 8. |
| Warning — ignored line | `music:`, `aspect:`, `format:`, or an unknown `motion:` or voice. |

Every check runs before anything is drawn, so a script is cheap to test: `reel-check` (or **Check**
on the Reels screen) tells you what a real run would say.

## How the video is made (for the curious)

1. The script is read; the slides are drawn by the Posts renderer on a 1080x1920 canvas (type set larger, content kept inside Instagram's safe area).
2. The voice is made (Kokoro, offline on the Pi's CPU) or your recording is levelled to -16 LUFS.
3. Each word gets a start time; each slide's pieces are timed to their cue words.
4. Each slide is photographed as a background plus one transparent picture per piece; the pieces are animated and blended frame by frame, with the word-by-word captions on top.
5. ffmpeg encodes H.264 High / AAC, 30 fps, yuv420p, BT.709, with the index at the front so it plays and seeks at once.
