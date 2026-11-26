# The reel script format (reel.md)

**What Reels are for:** useful, on-brand Instagram reels (1080x1920 video, H.264 + AAC). A voice
tells a short story and each line, number, picture and diagram appears **as it is spoken**. You
(or any AI) write one script; the Pi speaks it, draws the slides with the Posts renderer, times
every piece to the voice, adds word-by-word captions and encodes the mp4. The app never rewrites
or invents content.

- Make: the **Reels** screen in Sage, or `python -m autocontent reel my_reel.md`
- Check only: `python -m autocontent reel-check my_reel.md` (or **Check** on the Reels screen)
- Second full example: [example_reel.md](example_reel.md)
- **Music is not added.** Add trending audio in Instagram.

**Using this with another AI:** give it everything between the two `PROMPT` marker lines below,
then your topic and your facts. Sage's own AI writer reads the same block. Everything after the
block is reference for people; every rule in the block was checked against the engine's code.

---

## Prompt for another AI

<!-- PROMPT START -->
# REEL SCRIPT WRITER

You write scripts for Instagram reels. A machine turns your script into a finished vertical video. It reads your script literally and cannot guess what you meant. It only understands the exact syntax below. Anything else is ignored, drawn wrongly, or stops the video.

Your goal is a reel that a viewer watches to the end, saves, and shares. It must look and sound like a skilled human creator made it. Quality matters more than speed. Follow every MUST rule exactly.

## 1. OUTPUT CONTRACT

- Output ONLY the script. No explanation before or after it.
- Do NOT wrap the script in a code fence (no ``` lines).
- The very first line of your output is `---`.
- Use only the slide types, fields and values listed in this guide. Never invent a field, a slide type, a value, a voice, a diagram name or a shape name.
- Never write comment lines or `#` notes. The only lines that start with `#` are the `## <type>` slide headings. (Hashtags go inside `## hashtags`.)
- If the user gives you facts, use only those facts. Never invent statistics, prices, dates, names or sources. If you need a number the user did not give, make it a clearly made-up example and set `source: Illustrative example` on that slide.
- Never invent an image file name or a link. Use `search:` for pictures (section 6, image).

## 2. THE MUST RULES (the checker enforces these)

1. The file starts with the header block (section 4). Its first line inside the `---` lines is `autocontent: reel`.
2. Every slide starts with a line `## <type>`, where type is one of: cover, statement, point, list, stat, compare, quote, chart, table, image, recap, cta.
3. The first slide is a `cover`. The last slide is a `cta`.
4. Every slide has exactly one `say:` line. Write the whole narration for that slide on that one line.
5. One `field: value` per line. The field name starts the line. Bullets start with `- `. Numbered items start with `1. `, `2. `, `3. `.
6. Slide text is tiny on purpose. Per slide: a headline of 9 words or fewer; at most 3 bullets or items (4 is the absolute limit); at most 26 words of on-screen text in total (headline + body + bullets + labels + kicker + pill). The voice carries the detail; the slide carries the point.
7. A `kicker:` is a label of 28 characters or fewer, not a sentence.
8. `show:` cues are copied word for word from the same slide's `say:` line, and are listed in the same order they are spoken. Count them with the table in section 7.
9. `**bold**` is allowed only inside `headline:`, `body:` or `number:`, on 1 to 3 words. Nowhere else.
10. On a `cover` (style grid_pill), `pill:` MUST be the exact last 1 to 3 words of the headline. Do not use `**bold**` in a cover headline.
11. In `chart` data, every value has the same unit, written on every value (`₹2,000` and `₹6,000`, never `2000` and `₹6,000`).
12. After the last slide: `## caption`, then `## hashtags`. Nothing after the hashtags.

## 3. HOW TO MAKE IT GOOD (this is what separates a great reel from a slideshow)

Plan silently before you write. Pick ONE idea the viewer will remember. Then build this arc:

| Beat | Slides | What it does |
|---|---|---|
| Hook | 1 (cover) | Stops the scroll in 2 seconds: a surprising number, a bold claim, or a sharp question. Spoken hook is 12 words or fewer. |
| Stakes | 1 | Why this matters to the viewer, with a concrete example or number. |
| Turn | 1 to 2 | The insight most people miss. Put your best point here, in the middle. |
| Proof | 1 to 2 | Make it visible: a big number, a compare, a chart or a diagram. |
| Payoff | 1 | What to do: steps or a rule they can use today. |
| CTA | 1 (cta) | A reason to save, plus a question people answer in one word. |

Length: 5 to 8 slides, 20 to 45 seconds. Never over 90 seconds. Speech runs about 2.5 words per second, so a 35-second reel is about 90 spoken words in total.

Make the slides visual:
- Vary the slide types. Never put three text slides (statement, point) in a row.
- Show at least one number big (`stat`) and one visual (`compare`, `chart`, `table`, `image` or a `diagram:`).
- When the idea is "how many of a set", "steps in order", "where it breaks", "what is left after each stage" or "how big vs how big", draw it with a `diagram:` (section 9). One or two diagram slides per reel.
- Put `theme: dark` or `theme: accent` on the 1 or 2 slides you most want screenshotted. Never on two slides in a row.

Write the voice for the ear:
- Talk like a person explaining to a friend. Short sentences of 6 to 14 words. Plain words. Contractions (you're, it's, don't).
- 12 to 30 spoken words per slide. Never more than 55.
- The voice and the slide say the same thing in different ways. The slide shows "₹4,000"; the voice says why it matters. Never read the slide out word for word.
- Mention things in the order they appear on the slide. The voice names the headline idea first, then the number, then the explanation; the first step, then the second, then the third.
- Ask the viewer a question at least once. Put `[pause]` right before a reveal.
- End on something to act on, not a summary.

## 4. HEADER (copy this block, change only the values)

```
---
autocontent: reel
title: <short title, 3 to 8 words>
style: grid_pill
voice: af_heart
captions: on
tag: "#<one topic word>"
---
```

Allowed header lines and values:

| Line | Allowed values | Default |
|---|---|---|
| `autocontent:` | `reel` (required, first line) | |
| `title:` | any short text | |
| `style:` | `grid_pill` (white grid, red pill) or `beige_grain` (warm paper) | grid_pill |
| `voice:` | one Kokoro voice: `af_heart`, `af_bella`, `af_nicole`, `af_sarah`, `af_sky` (US women), `am_adam`, `am_michael`, `am_puck` (US men), `bf_emma`, `bf_isabella`, `bf_lily` (UK women), `bm_george`, `bm_lewis`, `bm_daniel` (UK men); or `mine` (the author records it) | af_heart |
| `captions:` | `on` or `off`, or a look: `bold` (red marker on the spoken word, same as `on`), `box` (dark card, accent word), `minimal` (dimmed words, the spoken one underlined) | on |
| `tag:` | `"#word"` in quotes, 30 characters or fewer | |
| `speed:` | 0.6 to 1.4 (1.0 is normal) | 1.0 |
| `accent:` | a hex colour like `#1E6FE8`, or red, orange, blue, green, purple, pink, teal, yellow, navy | the style's own |
| `source:` | one credit for every fact slide, or `none` | none |

Only use another header line if the user asks for it (see the reference after this block). Never write `music:`, `format:` or `aspect:`.

## 5. EVERY SLIDE: THE LINES AFTER `## <type>`

Write a slide's lines in this order:

1. its content fields (section 6)
2. optional design lines: `kicker:`, `theme:`, `align:`, `source:`
3. `say:` (required)
4. `show:` (optional, see section 7)
5. optional voice lines: `tone:`, `pause:`
6. `diagram:` block LAST, if the slide has one (section 9)

| Line | Allowed values | Notes |
|---|---|---|
| `say:` | plain spoken sentences | Required. One line. No links, no @handles, no `# * _ < > { } [ ] \|` except the pause marks below. |
| `show:` | `cue \| cue \| cue` | Cue words copied from this slide's `say:`. |
| `kicker:` | label, 28 characters or fewer | Small coloured label above the headline. Rises in just before it. |
| `theme:` | `light`, `dark`, `accent` | Default light. |
| `align:` | `top`, `center`, `bottom` | Where the content sits. Use `top` on a diagram slide. |
| `source:` | short credit, under 10 words | Shows small at the bottom. Works on every type except cover and cta. |
| `tone:` | `hook`, `excited`, `normal`, `calm`, `warm`, `serious`, `emphasis`, `slow`, `dramatic` | How this slide is spoken. Leave it out and the cover is spoken as a hook, stat and cta with emphasis, quote calm. |
| `pause:` | 0.2 to 1.5 (seconds) | Extra silence after this slide's narration. Use after a big number. |

Pause marks inside `say:` (never spoken, never captioned): `[pause]` (0.5 s), `[beat]` (0.7 s), `[breath]` (0.28 s), `[pause 0.8]` (any length). Use 0 to 2 per slide, right before a reveal.

## 6. SLIDE TYPES

Each type lists its fields, its limits, and its PIECES. A piece is one thing that arrives on screen. Pieces arrive in the order listed. Use the piece list to write `show:` (section 7).

### cover (always the first slide)
```
## cover
kicker: BUSINESS BASICS
headline: Profit is not the same as cash
pill: as cash
say: You made ₹50,000 profit. So why can't you pay?
show: why can't you
```
- `headline:` 4 to 9 words. No `**bold**`.
- `pill:` (grid_pill) the exact last 1 to 3 words of the headline. They are drawn in a big coloured pill. If `pill:` is not how the headline ends, it is ignored and the last word goes in the pill instead. `pill: none` removes the pill.
- `kicker:` optional.
- beige_grain has no pill: leave `pill:` out and you MAY bold 1 or 2 words of the headline.
- PIECES (grid_pill): 1 headline, 2 pill. (beige_grain: 1 headline.)

### statement (one bold sentence)
```
## statement
headline: Not the tech. The **first 30 days.**
body: Most owners quit in week one.
say: It's not the tech that stops them. It's the first thirty days.
```
- `headline:` up to 9 words. `body:` optional, one short line.
- PIECES: 1 headline, 2 body (if any).

### point (headline with bullets)
```
## point
headline: Why cash runs out
- Customers pay late
- Parts are paid upfront
- Profit is counted early
say: Cash runs out for three reasons. Customers pay late. Parts are paid upfront. And profit is counted before the money lands.
show: Customers pay late | Parts are paid | profit is counted
```
- `headline:` up to 9 words. 2 or 3 bullets (`- `), each under 8 words. Optional `body:` instead of bullets (one sentence).
- PIECES: 1 headline, 2 body (if any), then one piece per bullet.

### list (numbered steps)
```
## list
headline: Three ways to stay funded
1. Ask for an advance
2. Agree a payment date
3. Keep a cash buffer
say: Here's how to fix it. First, ask for an advance. Second, agree a payment date before you deliver. Third, keep a cash buffer.
show: First | Second | Third
```
- `headline:` up to 9 words. 2 to 4 numbered items (3 is best), each under 8 words.
- The item being spoken stays bright; earlier items fade back.
- PIECES: 1 headline, then one piece per item.

### stat (one big number)
```
## stat
headline: Your first order earns
number: ₹4,000
body: Sold for ₹10,000. Parts cost ₹6,000.
source: Illustrative example
say: Your first order made ₹4,000 in profit. A college paid ₹10,000 for ten kits, and the parts cost ₹6,000.
show: made | A college paid
```
- `headline:` a short label above the number, under 6 words.
- `number:` ONE figure with its unit, 12 characters or fewer: `65%`, `₹4,000`, `₹2.4 lakh`, `3x`, `9 in 10`, `40+`. It counts up from zero.
- `body:` what it means, under 15 words.
- Always write all three fields.
- PIECES: 1 headline, 2 number, 3 body.

### recap (the save card, optional, just before the cta)
```
## recap
headline: 3 numbers to keep
- ₹4,000 | first-order profit
- 65% | from regulars
- 2 days | catalogue build
say: Keep these three numbers. The first order made four thousand rupees. Regulars bring sixty five percent of sales. And the catalogue takes two days.
show: first order | Regulars | catalogue
```
- Rows are `- number | label`, 3 rows, number 12 characters or fewer, label under 4 words (the card also carries a SAVE THIS label: keep the slide to 26 words). They are the reel's own numbers, never new ones.
- It draws a dark card marked SAVE THIS: the one people screenshot and save. Use it once, as the second-to-last slide.
- Optional `headline:` (default "3 numbers to keep"), under 6 words.
- PIECES: 1 headline, then one per row. Write 3 cues.

### compare (two columns)
```
## compare
headline: Profit vs cash
left: Profit
- ₹4,000 earned
- Counted today
right: Cash
- ₹2,000 received
- ₹8,000 next month
say: On paper, your profit is ₹4,000. In the bank, you have only ₹2,000, because the rest comes next month.
show: your profit | In the bank
```
- `left:` and `right:` are column labels: 1 or 2 words, 14 characters or fewer. Each label is followed by its own `- ` items.
- 2 items per side is best (1 to 3 allowed), each under 6 words.
- Good pairs: Myth / Reality, Before / After, Don't / Do, Profit / Cash.
- PIECES: 1 headline, 2 left column, 3 right column.

### quote
```
## quote
quote: Revenue is vanity. Cash is reality.
author: Common business saying
say: There's an old line every founder learns the hard way. Revenue is vanity. Cash is reality.
show: Cash is reality
```
- `quote:` under 20 words. `author:` under 6 words. A quote has NO headline field.
- Only quote real people if the user gave you the quote.
- PIECES: 1 quote, 2 author.

### chart (bar, pie or line)
```
## chart
headline: Cash vs what you need
kind: bar
- Cash in bank: ₹2,000
- Parts needed: ₹6,000
source: Illustrative example
say: Compare what you have with what the next order needs.
show: what the next order needs
```
- `kind:` `bar`, `pie` or `line`.
- Data lines: `- Label: value`. Labels under 4 words. One number per value, no ranges, no negatives.
- Every value has the same unit, written on every value.
- bar: 2 to 6 rows. pie: 2 to 5 rows, all percentages, adding up to 100% or less. line: 3 to 8 rows whose labels are periods (`2022`, `Q1`, `Jan`).
- PIECES: 1 headline, 2 chart.

### table
```
## table
headline: Who pays when
| Customer | Pays |
|---|---|
| College | 30 days |
| Shop | On delivery |
| Online | Upfront |
say: Not every customer pays on the same day.
show: Not every customer
```
- A Markdown table: a header row, a `|---|---|` row, then up to 4 rows. 2 or 3 columns. Cells of 1 to 3 words.
- `highlight: College` (optional) marks the row whose first cell matches.
- PIECES: 1 headline, 2 table.

### image (a photo)
```
## image
headline: Your first college order
search: electronics kit breadboard
caption: Ten kits, ₹600 each.
say: Imagine a college orders ten electronics kits from you, at ₹600 each.
show: electronics kits | at ₹600 each
```
- `search:` 2 to 4 plain words describing a thing, place or scene (not people, brands, logos or text). A free photo is found and credited for you.
- Use `image: <link>` ONLY with a link or file name the user gave you. It can be a web link to a JPG, PNG or WEBP (not SVG), a Wikimedia Commons page or `File:Name.jpg`, or a page with a main picture.
- If a picture can't be fetched, the slide is drawn as text and the reel's warnings say why (PICTURE PROBLEM).
- `caption:` optional, under 12 words.
- Photos are drawn as black-and-white halftone dots. Add `filter: none` to keep their real colours.
- PIECES: 1 headline, 2 picture, 3 caption (if any).

### cta (always the last slide)
```
## cta
headline: Which one will you try **first?**
pill: SAVE THIS
subtext: COMMENT 1, 2 OR 3
say: Save this for your first big order. Which fix will you try first? Tell me in the comments.
show: Save this | Tell me
```
- `headline:` a question people can answer in one word, under 8 words. You may bold its last word.
- `pill:` 1 or 2 words. `subtext:` 2 to 5 words. It sits beside the pill.
- Optional `choice: Debt | Growth`: two one-word answers. It becomes the subtext (COMMENT DEBT OR GROWTH) and Sage hands back a first comment to pin. Use it when the question has two clear sides. Do not also write `subtext:`.
- beige_grain shows the headline only: leave `pill:`, `subtext:` and `choice:` out.
- PIECES (grid_pill): 1 headline, 2 pill, 3 subtext. (beige_grain: 1 headline.)

## 7. SYNCING PIECES TO THE VOICE (`show:`)

The voice is the clock. Piece 1 always arrives when the slide opens. Every other piece arrives at the moment its cue word is spoken.

The rule: **write exactly one cue per piece after the first.** Pieces minus 1 = number of cues.

| Slide | Pieces | Cues to write |
|---|---|---|
| cover (grid_pill) | headline, pill | 1 |
| statement with body | headline, body | 1 |
| point, 3 bullets, no body | headline, 3 bullets | 3 |
| list, 3 items | headline, 3 items | 3 |
| stat | headline, number, body | 2 |
| compare | headline, left, right | 2 |
| quote | quote, author | 1 |
| chart / table | headline, chart or table | 1 |
| image with caption | headline, picture, caption | 2 |
| cta (grid_pill) | headline, pill, subtext | 2 |
| statement with no body, or a beige_grain cover | headline | 0 (leave `show:` out) |

How to pick a cue:
- 1 to 3 words, copied exactly from `say:` (same spelling, same apostrophes).
- The words spoken right as that piece should appear. Usually the word that names it ("First", "Second", "In the bank").
- Prefer plain words over numbers or symbols.
- Cues appear in `say:` in the same order as the pieces. A cue is only searched for after the previous cue.
- Too few cues is worse than none: they shift onto the wrong pieces. If you are unsure, leave `show:` out and the pieces are spread evenly over the narration.

## 8. NUMBERS, MONEY AND NAMES IN `say:`

- Write money and percentages as figures with their symbol: `₹6,000`, `₹2.4 lakh`, `₹3 crore`, `$40`, `65%`, `3x`. The voice says "six thousand rupees" and the caption shows `₹6,000`. Never write "Rs" or "INR".
- Write other numbers as digits (`10 kits`) or words (`ten kits`), whichever reads better as a caption.
- For an abbreviation spoken letter by letter, put spaces between the capitals: `N X P`, `A I`, `U K`. The caption joins them back into NXP, AI, UK. Built in already: UPI, GST, EV, IPO.
- The only symbols allowed in `say:` are ₹ $ % and normal punctuation (. , ? ! ' : ; …). An em dash is read as a comma.
- Punctuation shapes the voice: a full stop is a beat, a question rises and waits, `…` trails off.

## 9. DIAGRAMS (explain with a picture, not decoration)

A diagram is a figure drawn from your numbers: seats filling up, a flow with its slow step marked, a funnel. Parts can light up at the exact word that is spoken. Use one when a picture explains the idea better than a sentence.

Put it on a `statement` slide with a short headline (5 words or fewer), `align: top`, no body, and nothing else. The `diagram:` block is the LAST thing on the slide:

```
## statement
headline: You are ₹4,000 short
align: top
say: Now a second college wants ten more kits. You need ₹6,000 for parts, six blocks of a thousand. [pause] You have only two.
diagram: waffle
  rows: 2 x 3
  shape: square
  on: 1-2 "you have" @ "only two"
  ghost: rest "still missing"
```

Block rules:
- First line: `diagram: <preset>`. Every following line is indented by two spaces and is `key: value`. No blank lines and no comments inside the block.
- `@ "word"` ties a change to a word in this slide's `say:` (copied exactly). Without it the change is there from the start. At most 5 cues per diagram (10 is the hard limit).
- Names with a comma, or numbers used as names, go in quotes: `warn: "Cheap, slow"`, `on: "2015"`.

Pick one preset:

| Preset | Use it for | Lines (repeat `item:` per item) |
|---|---|---|
| `seatmap` | n of a fixed set (seats, people) | `rows: 8 x 16`, `stage: SCREEN`, `on: 1-32 "sold" @ "word"`, `base: rest "empty"` |
| `waffle` | a rate (31 in 100) | `rows: 10 x 10`, `on: 1-31 "label" @ "word"`, `base: rest "label"` |
| `flow` | steps in order (width follows value) | `item: Name \| value` (2 to 6), `warn: Name @ "word"` |
| `funnel` | what is left after each stage | `item: Stage \| 100%` (3 to 5, falling) |
| `bars` | compare sizes | `item: Name \| value` (2 to 5, same unit) |
| `timeline` | when things happened | `item: 2015 \| What happened` (3 to 6) |
| `cycle` | a loop of stages | `item: Name` (3 to 6) |
| `hierarchy` | a whole and its parts | `root: Name \| value`, `item: Name \| value` |
| `matrix` | two axes | `x: Faster`, `y: Dearer`, `point: 20,30 \| Label` (0 to 100) |
| `meter` | one value against a limit | `value: 72`, `max: 100`, `limit: 55`, `label: text` |
| `overlap` | what two groups share | `set: Name`, `set: Name`, `overlap: Label \| 9%` |
| `scale` | size against size (by area) | `item: Name \| number` (2 to 4) |
| `table` | facts in a small grid | `head: \| Col \| Col`, `row: Name \| a \| b` |

States (one per line, any of these keys): `on:` lights parts in the accent colour (the thing you are talking about), `warn:` marks the problem part in red, `ghost:` shows a part as missing or not there yet, `base:` the quiet default, `appear:` hides parts until the cue, `mark:` draws a dashed outline with a label.
Pick parts by item name (`Fab`), by number (`3`, `1-32`), by `rows 1-3`, `cols 2`, `all`, or `rest`. A quoted label after the parts (`on: 1-32 "sold"`) becomes a legend entry with a live count.

## 10. OBJECTS (optional, use rarely)

`objects:` places up to 2 small shapes on a slide, for emphasis. They arrive as the slide opens (not on a cue) and sit on top of everything, so put them only where the slide is empty. Prefer a diagram when you want to explain.

Write all five parts, in this order: `objects: <name> @ <x>,<y> <size> <colour> <animation>`
- name: ONLY one of these: arrow-right, arrow-left, arrow-up, arrow-down, arrow-up-right, circle, circle-filled, square, triangle, diamond, star, hexagon, line, plus, minus, x, check, badge, callout, speech, underline, bracket-left, bracket-right, highlight, sparkle, zap, flame, target, eye, money, chart-up, clock, lock, globe, users, lightbulb, shield, gear, heart.
- x,y: percent of the screen. Keep x between 10 and 90 and y between 15 and 70.
- size: 60 to 200 (pixels).
- colour: accent, dark, muted, success, warning, danger, info, or a hex like `#1E9E5A`.
- animation: fly, scale, pop, spin, draw, flash, pulse, fade.
- Two objects: separate them with ` | `.

Example: `objects: arrow-down @ 80,30 120 accent fly | check @ 20,62 100 success draw`

## 11. CAPTION AND HASHTAGS

```
## caption
<hook line: the reel's question or surprise, one sentence>

<2 to 4 short paragraphs that add value the video did not have room for>

<a question people can answer in one word or a number>

## hashtags
#Topic #Niche #Audience #Specific
```
- The caption is posted as written. Under 2,000 characters.
- 3 to 5 specific hashtags. Lowercase or CamelCase, no spaces.
- If figures are made up, add a line: "Figures are illustrative."

## 12. MISTAKES THAT BREAK REELS (wrong → right)

| Wrong | What happens | Right |
|---|---|---|
| Cover `headline: You made a **profit**.` with `pill: Can you restock?` | The pill is ignored; "a profit." goes in the pill and the bold word disappears | `headline: You made a profit. Can you restock?` with `pill: Can you restock?` |
| Chart `- Cash: 2000` and `- Need: ₹6,000` | Error: mixed units | `- Cash: ₹2,000` and `- Need: ₹6,000` |
| `show:` with 1 cue on a 4-piece list | Every cue lands one piece early | 3 cues, one per item |
| A `show:` cue not in `say:` | That piece is timed evenly, not on its word | Copy the cue exactly from `say:` |
| 5 bullets, or 45 words of slide text | Error: slide too full | Two slides, or 3 short bullets |
| `**bold**` in a bullet or pill | Shown as plain text | Bold only in headline, body, number |
| `quote:` slide with `headline:` | The headline is not shown | quote + author only |
| `compare` label `Gross profit holds` | Set tiny | 1 or 2 words: `Profit` |
| `say:` with a link, @handle, `→` or `/` | Read aloud letter by letter | Say it in words |
| `image: photo.jpg` you did not get from the user | No picture: drawn as a plain text slide | `search: shop counter market` |
| `objects: icon:rocket ...` or `rotate 45deg` | Drawn as a plain dot / ignored | A shape from the list, all five parts |
| Diagram block with a blank or `#` line, or before `say:` | Lines are lost or read as slide text | Indented lines, block last on the slide |
| `## Slide 3: The twist` | Type guessed, often wrongly | `## statement` |
| Several narration lines or `say:` twice | Only the last `say:` is used | One `say:` line per slide |

## 13. CHECK BEFORE YOU OUTPUT

Go through every slide once more:
- [ ] Header first, with `autocontent: reel`. First slide cover, last slide cta.
- [ ] Each slide: `## <type>` from the list, one `say:`, headline 9 words or fewer, 26 words of slide text or fewer, 3 bullets or fewer.
- [ ] Cover pill is the exact end of the cover headline.
- [ ] Every `show:` cue is in that slide's `say:`, in order, and there is one cue per piece after the first.
- [ ] Every diagram `@ "word"` is in that slide's `say:`.
- [ ] Chart values share one unit, written on each value.
- [ ] No invented facts, links, files, voices, fields, presets or shapes.
- [ ] The story has a hook, a turn in the middle, something visual, and a clear payoff.
- [ ] Total spoken words about 50 to 110.

## 14. A COMPLETE EXAMPLE (illustrative figures; copy the shape, never the facts)

---
autocontent: reel
title: Profit is not cash
style: grid_pill
voice: af_heart
captions: on
tag: "#BusinessBasics"
---

## cover
kicker: BUSINESS BASICS
headline: Profit is not the same as cash
pill: as cash
say: You made ₹50,000 profit. So why can't you pay?
show: why can't you
tone: hook

## stat
headline: Your first order earns
number: ₹4,000
body: Sold for ₹10,000. Parts cost ₹6,000.
source: Illustrative example
say: Your first order made ₹4,000 in profit. A college paid ₹10,000 for ten kits, and the parts cost ₹6,000.
show: made | A college paid

## compare
headline: Profit vs cash
left: Profit
- ₹4,000 earned
- Counted today
right: Cash
- ₹2,000 received
- ₹8,000 next month
source: Illustrative example
say: On paper, your profit is ₹4,000. In the bank, you have only ₹2,000, because the college pays the rest next month.
show: your profit | In the bank

## statement
headline: You are ₹4,000 short
align: top
theme: dark
say: Now a second college wants ten more kits. You need ₹6,000 for parts, six blocks of a thousand. [pause] You have only two.
diagram: waffle
  rows: 2 x 3
  shape: square
  on: 1-2 "you have" @ "only two"
  ghost: rest "still missing"

## list
headline: Three ways to stay funded
1. Ask for an advance
2. Agree a payment date
3. Keep a cash buffer
say: Here's how to fix it. First, ask for an advance. Second, agree a payment date before you deliver. Third, keep a cash buffer for parts.
show: First | Second | Third

## cta
headline: Which one will you try **first?**
pill: SAVE THIS
subtext: COMMENT 1, 2 OR 3
say: Save this for your first big order. Which fix will you try first? Tell me in the comments.
show: Save this | Tell me

## caption
Your first order made a profit. So why can't you pay for the next one?

Profit is what you earn on paper. Cash is what is in the bank today. When a customer pays later, the two drift apart.

In this example you earn ₹4,000 on a ₹10,000 order, but only ₹2,000 has arrived. The next order needs ₹6,000 of parts.

Three fixes: ask for an advance, agree a payment date before you deliver, and keep a cash buffer.

Which one will you try first? Comment 1, 2 or 3.

Figures are illustrative.

## hashtags
#BusinessBasics #CashFlow #SmallBusinessIndia #Entrepreneurs

NOW WRITE the reel script for the topic and facts below. Output only the script.
<!-- PROMPT END -->

---

# Reference (for people)

Everything below is detail behind the rules above. An AI does not need it to write a good script.

## All the reel lines

A reel script is a post script ([POST_FORMAT.md](POST_FORMAT.md): the same slide types, fields,
themes and pictures) plus these lines. Most lines have other spellings; the checker accepts them.

| Line | Where | What it does | Also written as |
|------|-------|--------------|-----------------|
| `autocontent: reel` | header | **Required.** Without it the file is read as a post. | `reels`, `video` |
| `voice:` | header | A Kokoro voice, a blend, a Phonon voice (`phonon:Zoey`), or `mine` for your own recording. | `voiceover:` |
| `voice:` blend | header | `af_heart*0.7 + af_bella*0.3`, `af_heart 70% + af_bella 30%` or `af_heart, af_bella` (equal). Kokoro only. | |
| `speed:` | header | 0.6 to 1.4; 1.0 normal. | |
| `pace:` | header | `auto` (default): the first slide speaks as a hook (1.08×), `stat` and `cta` slides with emphasis (0.92×), `quote` slides calm (0.95×), unless a slide names its own `tone:` or `speed:`. `steady`: one pace throughout. | |
| `pauses:` | header | `tight` (0.7×), `natural` (1×, default), `relaxed` (1.35×), or a number 0.3 to 2.5. Scales the pauses inside a slide and between slides (Kokoro). | `breaths:` |
| `polish:` | header | The finishing chain on the voice: `natural` (default), `warm`, `bright`, `clean`, `off`. Also applied to your own recording. | `sound:` |
| `loudness:` | header | Target loudness, 9 to 23 meaning −9 to −23 LUFS; default 14 (Instagram). | `lufs:` |
| `pronounce:` | header | `word = how it sounds; word = how it sounds`. Respelled before speaking; captions keep the written word. Built in (Kokoro): UPI, GST, EV, IPO (spelled), SaaS ("sass"), Pi ("pie"). Capitalised words match exactly; lower-case ones match any case. | `say_as:`, `pronunciation:` |
| `captions:` | header | `on` (word by word, brand marker under the word being spoken) or `off`. | `subtitles:`, `caption_style:` |
| `fps:` | header | Frames per second, 24 to 60, default 30. `fps: 60` makes a true 60 fps video (motion is drawn for every frame; it takes about twice as long). | |
| `quality:` | header | `standard` (default; fast), `high` (x264 slow, CRF 17) or `max` (x264 slower, CRF 16). Better quality means a longer render, hours on a Pi for a long `max` reel at 60 fps. An unknown value warns and uses `standard`. | |
| `end_hold:` | header | Seconds the last slide stays after the last word; 0 to 6, default 1.2. | |
| `cold_open:` | header | `on` opens with a 0.8 s dark card of the first `stat` number (else the cover's pill); or write the text itself, e.g. `cold_open: ₹30,188 crore` (24 characters at most). `off` by default. The voice starts after the card. | `cold_open: on` |
| `transition:` | header | Accepted; every slide change is the same wipe today. | |
| `music:` | header | **Ignored, with a warning.** Add audio in Instagram. | |
| `aspect:` / `format:` | header | **Ignored, with a warning.** A reel is always 9:16, 1080x1920. | `ratio:`, `size:` |
| `say:` | slide | The narration. A continuation line may be indented under it. | `vo:`, `voiceover:`, `narration:`, `speak:` |
| `show:` | slide | Cue phrases from `say:`, separated by `\|` (`;`, `->` and `→` also work). See the sync section. | `cue:`, `cues:` |
| `tone:` | slide | `hook` 1.08×, `fast`/`excited` 1.1×, `energetic` 1.08×, `normal`/`neutral` 1×, `calm` 0.95×, `warm` 0.96×, `serious` 0.93×, `emphasis` 0.92×, `slow` 0.9×, `dramatic` 0.88×. | `delivery:` |
| `speed:` | slide | This slide's pace, 0.7 to 1.3, times the reel's `speed:`; wins over `tone:`. | |
| `voice:` | slide | A different voice (or blend) for this slide only, e.g. a second speaker. | |
| `pause:` | slide | Extra silence after this slide's narration; 0 to 5 seconds. | |
| `duration:` | slide | Hold a slide that has no narration; 1 to 30 seconds. | `hold:` |
| `objects:` | slide | Overlay shapes. See Objects. | `overlay:`, `overlays:`, `obj:` |
| `diagram:` | slide | An explainer diagram. See Diagrams. | `figure:` |
| `motion:` | slide | Only used for a piece the reel doesn't recognise; every known piece always gets its own entrance. `rise`, `pop`, `stagger`, `wipe`, `kenburns`, `fade`. Best left out. | `animation:`, `animate:` |
| `[pause]` marks | in `say:` | `[pause]` 0.5 s, `[breath]` 0.28 s, `[beat]` 0.7 s, `[pause 0.8]` any length. Never spoken or captioned. | |

Post header lines also work in a reel: `handle:`, `page_name:`, `cta_pill:`, `cta_pill_subtext:`,
`theme:` (every slide), `image_filter:` and the other `image_` lines (every picture).

## How audio and slides stay in sync

The voice is the clock. You never write timestamps.

1. **The voice is made.** Kokoro (or Phonon) says each slide's `say:` in order, with a 0.38 s breath
   between slides and any `pause:` after. With `voice: mine` your recording is used instead.
2. **Each word is timed.** Whisper on the Pi finds when every word starts and ends. Without
   Whisper the words are spread across the pauses in the audio.
3. **The slide windows.** A slide starts about 0.14 s before its first word and ends when the next
   slide's first word begins. A slide with no `say:` holds for its `duration:` (3 s without one).
   The last slide holds `end_hold:` seconds after its last word.
4. **The pieces.** Piece 1 arrives as the slide opens (while the previous slide is still wiping
   away, so there is never an empty frame). With one cue fewer than pieces, cue *k* names piece
   *k + 1*. With any other number of cues, cue *k* names piece *k*; since piece 1 always opens
   the slide, its cue is spent. A piece lands 0.18 s before its cue word; pieces are at least
   0.28 s apart. A cue that isn't found (each is searched for after the previous one) leaves that
   piece spread evenly; the others still follow their cues.
5. **The captions.** Every spoken word is written along the bottom as it is said. A spelled-out
   abbreviation ("N X P") is shown as one word ("NXP").

A kicker is not a piece of its own: it rises just ahead of the headline. A `source:` line arrives
with the last piece. Diagram cues and objects are timed separately from `show:`.

### Pieces per slide type (measured from the renderer)

| Type | grid_pill | beige_grain |
|---|---|---|
| cover | headline, pill (one piece if `pill: none`, or a bold word and no `pill:`) | headline |
| statement | headline, body | same |
| point | headline, body, each bullet | same |
| list | headline, each item | same |
| stat | headline, number, rule and body (the rule is drawn even without a body) | headline, number, body |
| quote | quote, author | same |
| compare | headline, left column, right column | same |
| chart / table | headline, chart or table | same |
| image | headline, picture, caption and bullets | same |
| cta | headline, pill, subtext | headline, handle |

`reel-check` counts these and warns when `show:` has too many cues, or so few that they shift.

## How things move

Nothing to ask for; each piece arrives the way that suits it:

| The piece | How it arrives |
| --- | --- |
| A kicker | Rises into place out of a slot, just ahead of its headline |
| A headline, a quote, a statement, body text | Typed out, word by word, with a caret |
| A highlighted word (`**like this**`) | Types in the brand colour |
| The rule or brush underline under a headline | Drawn along its length once the headline is typed |
| A big number | Counts up to its real value, then holds |
| A pill (cover, cta) | Laid down from its left end with a little overshoot, then its word is typed onto it |
| A bullet dot, a list number, a tick or cross | Pops on just before its own line is typed |
| A compare column | Its card is laid down, then its label and points are typed in |
| A picture | Uncovered upwards, then a slow push-in for as long as the slide is up |
| A table or chart | Builds downwards |
| A source line | A short fade, with the last piece |

List items, bullets and compare columns fade back once the voice moves on, so the step being spoken
is the bright one. Nothing pans or drifts. A thin bar across the top shows progress. One slide
wipes into the next. Type is set larger than a feed slide's. A post's dashed doodle line is left
out of a reel.

## How the slide is kept readable

Nothing is drawn over the captions. After layout the renderer measures each slide and, if the
content reaches too far down, sets it smaller step by step, then drops the kicker, then the source
line. A slide only fails when even that isn't enough, and the error says how much has to go.
Writing to the limits in the prompt means none of this happens and the type stays big.

## Diagrams in full

A diagram's first word is a **preset** (a recipe file in `content_engine/diagrams/`) or one of six
**engines**: `grid` (rows x columns), `line` (a sequence; `layout: flow|timeline|funnel|swimlane|bars`),
`space` (free positions; `layout: matrix|meter|scale`), `ring` (a loop), `tree` (parents and
children), `nest` (inside one another; `layout: overlap|section|concentric`).

| Preset | Engine | Explains | Its own lines |
|---|---|---|---|
| `seatmap` | grid | n of a fixed set | `rows: 8 x 16`, `stage: SCREEN`, `shape: seat\|square\|dot\|person` |
| `waffle` | grid | a rate (31 in 100) | `rows: 10 x 10` (or `count: 60` + `cols: 10`), `shape: dot` |
| `heatmap` | grid | how full, cell by cell | `heat: 0 3 4 1 ...` (0 to 4, one per cell) |
| `table` | grid | facts in rows and columns | `head: \| 2006 \| 2015`, `row: Plants \| 23 \| 15` |
| `flow` | line | steps, width follows the value | `item: Fab \| 9 days` |
| `swimlane` | line | a schedule | `item: Fab \| 9 days \| 2` (name \| length \| start) |
| `funnel` | line | what is left at each stage | `item: Paid \| 6%` |
| `bars` | line | compare sizes | `item: Auto \| 56%` |
| `timeline` | line | when things happened | `item: 2015 \| Merger` |
| `plan` | space | boxes placed anywhere | `box: x,y,w,h \| Label` (percent of the box) |
| `anatomy` | space | one thing with named parts | `box:` and `leader: x,y > x,y \| Name` |
| `matrix` | space | two axes | `x: Faster`, `y: Dearer`, `point: 22,25 \| Label` (0 to 100) |
| `meter` | space | one value against a limit | `value: 72`, `max: 100`, `limit: 55`, `label:`, `limit_label:`, `note:` |
| `scale` | space | size against size, by area | `item: A town \| 4` |
| `cycle` | ring | a loop of stages (3 to 10) | `item: Test` |
| `hierarchy` | tree | a root and its parts | `root: Revenue \| $13b`, `item: Auto \| 56% \| Parent` |
| `overlap` | nest | what 2 or 3 groups share | `set: Cheap`, `set: Fast`, `overlap: Only \| 9%` |
| `section` | nest | layers top to bottom | `layer: Package \| 44`, `title:` |
| `concentric` | nest | a market inside a market | `layer: Everyone \| 100` |

`diagram: space` with your own `box:`, `circle: x,y,r | Label`, `dot: x,y | Label`,
`text: x,y | Words | size`, `arrow: x,y > x,y | Label`, `line:` and `leader:` lines draws almost anything.

| Line | Meaning |
|---|---|
| `on: <parts> "legend" @ "word"` | the parts in the accent colour |
| `warn: <parts>` | the broken one (red outline, and a mark on boxes) |
| `ghost: <parts>` | not there yet / no longer: faint dashed outline |
| `base: <parts> "legend"` | the quiet default (gives the rest a legend label) |
| `appear: <parts> @ "word"` | not drawn until the word |
| `mark: <parts> "label" @ "word"` | a dashed outline round those parts, with a label |
| `legend: auto\|off` | a legend with live counts from the quoted labels (on when there are any) |
| `at: 50,57` and `size: 880 x 640` | where (centre, percent) and how big; leave both out and the diagram takes the room below the slide's text |

Parts: numbers (`3`, `1-32`, `5, 9-12`; across then down), `rows 2-3`, `cols 4`, `r2c5`, `all`, `rest`
(the parts no other line named), or names (`Fab`; quoted if it has a comma or is a number).

Rules the checker enforces:
- A slide's own content lines **replace** the preset's sample data (and its state lines that pick
  parts by number); `base: rest` stays.
- A misspelt line (`legnd:`) is an error with a "did you mean" hint.
- At most 10 cues and 600 parts per diagram; a grid too dense to read is refused with how to fix it.
- A cue that isn't in the narration is a warning; that change is spread over the slide instead.
- A diagram slide with more than 16 words of slide text is a warning: the diagram needs the room.
  Its text is set smaller than a normal reel slide's.

**Make your own preset:** copy a file in `content_engine/diagrams/` (or the folder in
`SAGE_DIAGRAMS_DIR`), change it, save it as `<name>.yml`, and `diagram: <name>` works at once.
Lines starting with `#` are comments in a preset file (never in a slide).

## Objects in full

`objects: <name> @ <x>,<y> <size> <colour> <animation> r<degrees>`, pipe-separated.

| Part | What it is |
|---|---|
| name | A built-in shape (below). Many have aliases: `tick` = check, `dollar` = money, `world` = globe, `bulb` = lightbulb, `cog` = gear, `people` = users, `box` = square, `dot` = circle-filled. |
| `@ x,y` | Centre, as percent of the 1080x1920 canvas. |
| size | Pixels, 16 to 400. Default 80. |
| colour | `accent`/`brand`, `dark`, `light`, `muted`, `success`, `warning`, `danger`, `info`, or a hex. Default accent. |
| animation | `fly`, `scale`, `pop`, `spin`, `draw`, `flash`, `pulse`, `blink`, `wipe`, `fade`. Default: the shape's own. |
| rotation | `r45` or `r-30`. Only read when colour and animation are both written before it. |

The fields are read by position: an animation written without a colour is read as the colour.
Write them all.

Built-in shapes (41): arrow-right, arrow-left, arrow-up, arrow-down, arrow-up-right, circle,
circle-filled, square, square-filled, triangle, diamond, star, hexagon, line, line-v, plus, minus,
x, check, badge, callout, speech, underline, bracket-left, bracket-right, highlight, sparkle, zap,
flame, target, eye, money, chart-up, clock, lock, globe, users, lightbulb, shield, gear, heart.

`icon:<name>` draws a [Lucide](https://lucide.dev/icons/) icon **only when the `lucide-static`
icon set is installed** next to the engine; it is not installed on the Pi today, so an `icon:`
object is drawn as a plain dot and `reel-check` warns about it.

Objects appear 0.25 s after the slide starts, 0.18 s apart, and leave 0.24 s before it changes.
They sit on top of the slide, so place them in empty space.

## Your own voice

Write `voice: mine`, make the reel, and when it asks, record the narration on your phone (one take,
every slide's `say:` in order) or upload the file. The Pi finds when each word is said (Whisper
where installed, otherwise from the pauses), so slides, pieces and captions follow your timing.
The captions show the script's words, so read `say:` as written. Every slide needs a `say:` line.

## Writing for the Phonon voice (optional)

Phonon 31M is chosen with `voice: phonon:Zoey` (or in the voice picker). Voices: US women Zoey,
Juniper, Everly, Harper, Hadley, Delia; US men Easton, Micah, Trevor, Russell, Preston, Miles; UK
women Maeve, Freya, Pippa, Elodie-Rose, Imogen, Lottie, Bryony; UK men Alfie, Hugh, Edwin, Spencer,
Toby, Teddy. No blends. It reads differently from Kokoro:

- **Numbers and symbols:** write `65%`, `$3.5 million`, `9:30`, `2026` normally; Phonon says them.
  Rupee amounts (`₹5 lakh`, `Rs. 600`) are written out as "rupees" by Sage first, because Phonon
  reads a bare ₹ as euros. Kokoro's respellings (`U P I`, `sass`, `pie`) are not applied; your
  own `pronounce:` lines are.
- **Abbreviations:** keep `N X P` spaced for letters; write a word-like acronym as a word (`NASA`).
- **Sentences:** one idea per sentence, 6 to 14 words, ending with `.` `?` or `!`. A slide's `say:`
  is sent whole, so don't chop a sentence into fragments (`So. It works.`).
- **Pauses:** punctuation adds no extra silence with Phonon and `pauses:` has no effect; only
  `[pause]`, `[pause 0.6]`, `[breath]` and `[beat]` add quiet.
- **No stacked punctuation** (`...`, `?!`, `--`). A dash becomes a comma.
- **Pace:** `speed:` and `tone:` work. Start at 1.0; `1.1` if slow, `0.95` if rushed.

## What the checks say

`reel-check` and the Reels screen list everything with its line and slide number. Errors stop the
reel; warnings don't. Every check runs before anything is drawn, so checking is cheap.

| | What it means |
|---|---|
| **Error** — not a reel | The file doesn't start with `autocontent: reel`. |
| **Error** — nothing to say | No slide has a `say:` line. |
| **Error** — slide too full | Over 40 words of slide text, or more than four bullets or items. |
| **Error** — diagram | A diagram that can't be read or drawn (unknown preset or line, too many cues or parts). |
| **Error** — chart | Mixed units, a pie that isn't percentages or adds up past 100%, no data. |
| **Error** — doesn't fit | Text that can't fit even at the smallest size, named by slide. |
| Warning — slide full | Over about 26 words of slide text; it is set smaller. |
| Warning — headline or kicker long | Over 9 words, or a kicker over 28 characters. |
| Warning — pill not in headline | A cover's `pill:` isn't how its headline ends, so the last word goes in the pill. |
| Warning — cues shifted / too many | `show:` doesn't have one cue per piece after the first. |
| Warning — cue not found | A `show:` or diagram cue isn't in that slide's `say:`. |
| Warning — objects | An `objects:` part that won't draw as written (unknown shape, colour or animation, extra text). |
| Warning — silent slide | No `say:` and no `duration:`; held for 3 seconds. |
| Warning — long slide | Over 55 spoken words on one screen. |
| Warning — link, handle or symbols in the narration | A voice reads them aloud or skips them. |
| Warning — too long / too short | Over 90 seconds, or under 8. |
| Warning — ignored line | `music:`, `aspect:`, `format:`, or an unknown `motion:`, `tone:` or voice. |

## How the video is made (for the curious)

1. The script is read; the slides are drawn by the Posts renderer on a 1080x1920 canvas (type set larger, content kept inside Instagram's safe area).
2. The voice is made (Kokoro or Phonon, offline on the Pi's CPU) or your recording is levelled.
3. Each word gets a start time; each slide's pieces are timed to their cue words.
4. Each slide is photographed as a background plus one transparent picture per piece; the pieces are animated and blended frame by frame, with the word-by-word captions on top.
5. ffmpeg encodes H.264 High (level 4.2) / AAC, 1080x1920 at the `fps:` you chose (30 by default, up to 60), at the `quality:` you chose, yuv420p, BT.709, with the index at the front so it plays and seeks at once.
