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
(voice: a Kokoro voice — US women af_heart (default, warm), af_bella, af_nicole, af_sarah, af_sky; US men am_adam, am_michael, am_puck; UK women bf_emma, bf_isabella, bf_lily; UK men bm_george, bm_lewis, bm_daniel — or `voice: mine` when the author will record the narration themselves. speed: 0.6 to 1.4, 1.0 normal. captions: off removes the captions. fps: 24 to 60, 30 default. end_hold: seconds the last slide holds, 1.2 default.)

Then each slide starts with `## <type>` exactly as in a post script (cover, statement, point, list, stat, compare, quote, chart, table, image, cta), with its own fields, and these extra lines:
say: <what the voice says over this slide>            (REQUIRED on every slide; plain sentences, no symbols or links)
show: <cue> | <cue> | <cue>                            (optional: the words in `say:` at which each piece of the slide should appear, in order; copy them exactly from `say:`)
motion: rise | pop | stagger | wipe | kenburns | fade  (optional, best left out: each piece always arrives in the way that suits it. This is only used for a piece the reel doesn't recognise.)
duration: 3                                            (optional, only for a slide with no `say:`: seconds to hold it)
pause: 0.5                                             (optional: extra silence after this slide's narration)

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
| `captions:` | header | `on` (word by word, brand marker on the word being spoken) or `off`. | `subtitles:`, `caption_style:` |
| `fps:` | header | 24 to 60, default 30. | |
| `end_hold:` | header | Seconds the last slide stays after the last word; 0 to 6, default 1.2. | |
| `transition:` | header | The slide change; `fade` is the default and the only one that differs visibly today. | |
| `music:` | header | **Ignored, with a warning.** Add trending audio in Instagram. | |
| `aspect:` / `format:` | header | **Ignored, with a warning.** A reel is always 9:16, 1080x1920. | `ratio:`, `size:` |
| `say:` | each slide | The narration. A continuation line may be indented under it. Single capitals in a row ("N X P") are spoken as letters and shown joined up on the caption. | `vo:`, `voiceover:`, `narration:`, `speak:` |
| `show:` | each slide | Cue phrases copied from `say:`, separated by `\|` (`;`, `->` and `→` also work). One per piece. With one fewer than there are pieces, the first piece opens the slide and the cues start at the second. | `cue:`, `cues:` |
| `motion:` | each slide | Only for a piece the reel doesn't recognise (see below); every known piece always gets its own. | `animation:`, `animate:` |
| `duration:` | each slide | Hold a slide that has no narration; 1 to 30 seconds. | `hold:` |
| `pause:` | each slide | Extra silence after this slide's narration; 0 to 5 seconds. | |

A slide with neither `say:` nor `duration:` is held for 3 seconds, and there is always a 0.38 s
breath between one slide's narration and the next.

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
