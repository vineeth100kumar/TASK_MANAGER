# The script format (script.md)

**What Auto Content is for:** making carousel posts that are genuinely useful to the reader
(they learn something, save it, send it to a friend) and that earn views, saves, shares and
comments for the page. You (or any AI) write a short script; the app turns it into finished,
on-brand slides plus the caption. Nothing is rewritten or invented by the app.

- Render: drop the `.md` on the **Create** screen, or `python -m autocontent run my_post.md`
- Check only: `python -m autocontent spec-check my_post.md`
- Example with every option: [examples/script_showcase.md](examples/script_showcase.md)

The format is forgiving on purpose. Field names have many spellings, unknown slide headings are
guessed, a picture that cannot be found becomes a text slide, and long text is fitted and reported
instead of stopping the render. Only a missing header or text far too long to ever fit is an error.

---

## Prompt for another AI

Press **Copy the AI prompt** on the Create screen (or copy between the two lines below), paste it
into any AI, then add your topic and facts at the end.

<!-- PROMPT START -->
You write Instagram carousels for a page whose goal is content that is genuinely useful to the reader and earns saves, shares and comments. Output ONLY a script in the format below, with no explanation and no code fence around it. You are free to choose the angle, the number of slides (5 to 12), the slide types, and the look of each slide.

HOW A GOOD POST WORKS
- Slide 1 is the hook. It must stop the scroll in 2 seconds: a surprising number, a bold claim, a question, or a promise ("5 mistakes that...", "Why X quietly fails"). Max 12 words.
- One idea per slide, in plain words a 15-year-old understands. Short lines beat paragraphs.
- Build curiosity: each slide should make the reader want the next one. Save the best insight for slide 3 to 5, not the last.
- Give something to keep: a step-by-step, a checklist, a before/after, a number they will repeat to someone.
- Vary the rhythm: mix text slides with a big number, a bold statement, a comparison, a chart. Use a dark or accent slide to mark the key moment (1 to 3 per post, never two in a row).
- End with a reason to save, share or comment (a question people can answer in one word works well).
- Use only facts you were given. Write numbers exactly as given and never invent statistics. Put `source:` on slides that state facts.

FORMAT
Start with this header:
---
autocontent: post
title: <short title>
style: grid_pill
tag: "#topic"
---
(style: grid_pill = white grid with a red pill; beige_grain = warm paper. Optional header lines: format: square, accent: blue or #1E6FE8, theme: dark for every slide, source: one source for the whole post, handle: "@page".)

Then each slide starts with `## <type>` and has `field: value` lines, `- ` bullets or `1. ` numbered items.

SLIDE TYPES
## cover       headline (the hook). Optional pill: the last 1-3 words of the headline to put in the coloured pill (pill: none for no pill)
## statement   headline (one bold sentence, up to 16 words), optional body (one supporting line)
## point       headline + 2-4 bullets, or headline + body (one or two sentences)
## list        headline + 2-6 numbered items (steps, tips, reasons, rankings)
## stat        number (like 65% or ₹2.4L), headline (short label above it), body (what it means)
## compare     headline, then `left: <label>` with 1-4 bullets and `right: <label>` with 1-4 bullets (Myth / Reality, Before / After, Don't / Do)
## quote       quote, author
## chart       headline, kind: bar | pie | line, then data lines like `- 2023: 40` or `- India: 29%`
## table       headline, then a Markdown table (2-4 columns, up to 6 rows, short cells)
## image       headline, image: <file or link> or search: <words for a free stock photo>, optional caption and 1-3 bullets
## cta         headline (the closing line), optional pill: SAVE THIS
After the slides: `## caption` (the Instagram caption: a hook line, 3-6 short paragraphs of value, a question for the comments) and `## hashtags` (3 to 5 specific hashtags).

DESIGN KNOBS (any slide; all optional)
theme: light | dark | accent      (dark = black page, accent = page in the accent colour)
align: top | center | bottom      (where the content sits; stat, quote and statement are centred by default)
kicker: SHORT LABEL               (small coloured label above the content, like "MISTAKE #2" or "THE FIX")
**words** in a headline           (those words are drawn in the accent colour; use on 1-3 key words)
accent: blue or #1E6FE8           (this slide's highlight colour)
EXAMPLE
---
autocontent: post
title: Why small shops stay offline
style: grid_pill
tag: "#smallbusiness"
---

## cover
headline: 9 in 10 corner shops still sell **offline only**

## statement
kicker: The real reason
headline: It is not the tech. It is the **first 30 days.**
theme: dark

## compare
headline: What owners think vs what works
left: Myth
- You need a fancy app
- It takes months to set up
right: Reality
- A WhatsApp catalogue is enough
- One afternoon to go live

## stat
headline: Repeat customers bring in
number: 65%
body: of a typical shop's sales, so start with the people you already know.
source: Retail survey 2024
theme: accent

## list
headline: Go online this weekend
1. Photograph your 20 best-sellers
2. Build a WhatsApp Business catalogue
3. Put a QR code on the counter
4. Message 30 regulars with one offer

## cta
headline: Which step comes first? Comment 1 to 4.
pill: SAVE THIS

## caption
Most corner shops never go online, and it is not because of the tech.

The first 30 days decide it. No orders in week one and most owners quit.

Start with the people who already buy from you: regulars bring in about 65% of sales.

Which step will you do first? Comment 1 to 4.

## hashtags
#smallbusiness #retail #whatsappbusiness #localshops

NOW WRITE the script for the topic and facts below.
<!-- PROMPT END -->

---

## Post recipes that earn engagement

Pick one shape per post; the AI prompt above lets the AI pick too.

| Recipe | Slides | Why it works |
|---|---|---|
| **Myth vs reality** | cover, statement, 2-3 compare, stat, cta | people share what corrects a common belief |
| **How to, step by step** | cover, point (the problem), list (steps), stat (the payoff), cta | high save rate: a checklist to come back to |
| **Mistakes to avoid** | cover "5 mistakes...", one point per mistake with `kicker: MISTAKE #1`, cta | each slide is a small reveal, so people swipe |
| **The hidden numbers** | cover with a surprising figure, stat, chart, table, statement, cta | one number people repeat to friends |
| **Before / after** | cover, compare, image, list, cta | the change is visible in one look |
| **Story** | cover, 3-5 statements (what happened, what changed), point (the lesson), cta | stories hold attention to the last slide |

Tips: put the payoff early, use `theme: dark` or `theme: accent` on the one slide you want people to
screenshot, and ask a one-word question at the end of the caption.

---

## Reference

### Header

| Line | Values | Default |
|---|---|---|
| `autocontent: post` | required | |
| `title` | the post name (also the output folder name) | file name |
| `style` | `grid_pill`, `beige_grain` | grid_pill |
| `format` | `portrait` (1080x1350), `square` (1080x1080) | portrait |
| `tag` | the small topic label on every slide | brand.json |
| `theme` | `light`, `dark`, `accent` for every slide without its own | light |
| `accent` | a colour name or `#RRGGBB` | the style's own |
| `source` | a credit for every fact slide without its own; `none` for no credits | none |
| `handle`, `page_name`, `cta_pill`, `cta_pill_subtext` | brand text | brand.json |
| `image_filter`, `image_dot_size`, ... | the look of every picture (see Pictures) | halftone dots |

### Slides

Every slide takes the design knobs `theme`, `align`, `kicker`, `accent`, and `**highlight**` in
its text. Slide headings are forgiving: `## myth vs fact` is a compare, `## big number` a stat,
`## steps` a list, `## takeaway` a statement, `## Slide 3: tip` a point, and a heading that is not a
type at all is read as the type its content looks like (with a warning).

Lengths the slides are designed for (longer text is set smaller, and the render reports anything
that does not fit): headlines 6 to 10 words, bullets and list items under 12 words, stat body under
25 words, compare points under 8 words.

### Pictures

- `image: farm.jpg` looks in the app's `images` folder (Create screen: **Add pictures**), the spec's
  folder, or a full path; `image: https://...` downloads it.
- `search: workshop 3d printer` fetches a free stock photo (Wikimedia Commons without a key; Unsplash,
  Pexels, Pixabay with free keys in Settings) and adds the credit.
- `prompt: <what it should show>` draws a "Picture needed" box until you add the file.
- A picture slide with no picture, or one that cannot be found, is drawn as a text slide.
- Pictures are black-and-white halftone dots by default (brand.json `image_defaults`). Per slide or in
  the header: `filter:` (`none`, `grayscale`, `sepia`, `warm`, `cool`, `vivid`, `moody`, `high contrast`,
  `halftone`...), `dot_size`, `duotone: accent`, `tint: blue 30%`, `focus: top`, `fit: contain`,
  `rounded: large`, `border: thick accent`, `text_position: above | below`.

### Caption and hashtags

`## caption` is used as written (line breaks and emojis kept). `## hashtags` adds any tags missing from
the caption. Without a caption, a simple one is built from the slides. Instagram's limits (2,200
characters, 30 hashtags) are checked; 3 to 5 specific hashtags work best.

### Output

Each render writes `slide_01.png`..., `contact_sheet.png`, `caption.txt`, `slides.json`, `audit.md`
(every warning with its slide) and `fit_report.json` (anything that did not fit) to `output/<title>_<time>/`.
