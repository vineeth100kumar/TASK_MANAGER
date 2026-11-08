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
- Write the narration the way people talk: short sentences, plain words, contractions. Read it aloud. Spell out how numbers are said ("two thirds", "five lakh rupees"), or write 65% / ₹5 lakh and the voice will say them properly.
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
(voice: a Kokoro voice, af_heart (default, warm US woman), af_bella, af_nicole, af_sarah, am_adam, am_michael (US), bf_emma, bf_isabella, bm_george, bm_lewis (UK); or `voice: mine` when the author will record the narration themselves. speed: 0.9 slows it, 1.1 speeds it. captions: off removes the captions. fps: 30 is the default.)

Then each slide starts with `## <type>` exactly as in a post script (cover, statement, point, list, stat, compare, quote, chart, table, image, cta), with its own fields, and these extra lines:
say: <what the voice says over this slide>            (REQUIRED on every slide; plain sentences, no symbols or links)
show: <cue> | <cue> | <cue>                            (optional: the words in `say:` at which each piece of the slide should appear, in order; copy them exactly from `say:`)
motion: rise | pop | stagger | wipe | kenburns | fade  (optional, and usually best left out: each piece already arrives in the way that suits it. Naming one here puts that single motion on every piece of the slide.)
duration: 3                                            (optional, only for a slide with no `say:`: seconds to hold it)
pause: 0.5                                             (optional: extra silence after this slide's narration)

WHAT APPEARS, IN ORDER (each is one "piece"; with no `show:` they are spread evenly over the narration)
cover: headline, then the pill | point: headline, text, each bullet | list: headline, each item | stat: label, big number, explanation | compare: headline, left column, right column | quote: quote, author | chart/table: headline, then the chart or table | image: headline, picture (slow push-in), caption | cta: headline, pill, subtext
A `source:` line arrives with the last piece.

After the slides: `## caption` (the Instagram caption: a hook line, 3-6 short paragraphs of value, a question for the comments) and `## hashtags` (3 to 5 specific hashtags).

LAYOUT RULES (a reel is 9:16; Instagram covers the top and bottom, so the slide keeps to the middle and the captions sit below it)
- Keep headlines under 9 words and points/bullets under 12 words: they are set large for a phone screen.
- cta: the subtext sits beside the pill, so keep it to 3 or 4 short words (SAVE THIS + COMMENT 1, 2 OR 3).
- Do not write `music:`; music is added in Instagram.

EXAMPLE
(see example_reel.md in the same folder; it is returned with this guide)
<!-- PROMPT END -->

---

## The extra lines, in detail

| Line | Where | What it does |
|------|-------|--------------|
| `voice:` | header | A Kokoro voice name, or `mine` for your own recording. |
| `speed:` | header | 0.6 to 1.4; 1.0 normal. |
| `captions:` | header | `on` (word-by-word, brand red marker on the spoken word) or `off`. |
| `fps:` | header | 24 to 60, default 30. |
| `end_hold:` | header | Seconds the last slide stays after the last word (default 1.2). |
| `say:` | each slide | The narration. A continuation line may be indented under it. |
| `show:` | each slide | Cue phrases from `say:`, separated by `\|`. One per piece. If there is one fewer than there are pieces, the first piece simply opens the slide and the cues start at the second. |
| `motion:` | each slide | Forces one motion on the whole slide (see below). Leave it out and each piece gets its own. |
| `duration:` | each slide | Hold a slide that has no narration (1 to 30 s). |
| `pause:` | each slide | Extra silence after the narration (0 to 5 s). |

### How things move

You don't have to ask for any of this. Each piece arrives in the way that suits what it is, so a
slide reads as an infographic being built rather than a picture being shown:

| The piece | How it arrives |
| --- | --- |
| A headline | Wiped on from the left, as if being written |
| A big number | Punches in: small, past its size, then settles |
| A pill (`pill:`, a CTA) | Pressed on along its own slant |
| A list item, a bullet, a compare column | In from its own side, with a little overshoot |
| A picture | Uncovered upwards, then a slow push-in for as long as the slide is up |
| A table or chart | Builds downwards |
| Body text, a caption, a source line | A short fade |

Underneath that, the camera creeps slowly across each slide (a different direction each time) so
the picture is never frozen, and one slide wipes into the next instead of cutting.

Writing `motion:` overrides all of it and puts one motion on every piece of that slide:
**rise** (slides up and fades in), **pop** (grows in with a small overshoot), **stagger** (like
rise, tighter, for one-by-one lists), **wipe** (uncovers left to right), **kenburns** (rise, then
a slow push-in on a picture), **fade**.

## Your own voice

Write `voice: mine`, make the reel, and when it asks, record the narration on your phone (one take,
every slide's `say:` lines in order) or upload the file. The Pi listens to find when each word is said
(Whisper where installed, otherwise it measures the pauses), so slides, pieces and captions follow *your*
timing and your wording stays on the captions as written in `say:`. Read the `say:` lines as written:
if you change words the captions still show the script's words, and timing may drift a little.
With your own recording every slide needs a `say:` line.

## What the checks say

`reel-check` and the Reels screen list every error and warning with its line number: a missing
narration, a slide over about 20 seconds of speech, a link or symbols in the narration, a cue phrase
that isn't in `say:`, an unknown voice or motion, a length over 90 seconds. Layout problems (text that
cannot fit the screen even at the smallest size) stop the reel with the slide number, the same as a
failed post audit: shorten the text and make it again.

## How the video is made (for the curious)

1. The script is read; the slides are drawn by the Posts renderer on a 1080x1920 canvas (type set larger, content kept inside Instagram's safe area).
2. The voice is made (Kokoro, offline on the Pi's CPU) or your recording is levelled to -16 LUFS.
3. Each word gets a start time; each slide's pieces are timed to their cue words.
4. Each slide is photographed as a background plus one transparent picture per piece; the pieces are animated and blended frame by frame, with the word-by-word captions on top.
5. ffmpeg encodes H.264 High / AAC, 30 fps, yuv420p, BT.709, with the index at the front so it plays and seeks at once.
