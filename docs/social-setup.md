# Connecting an Instagram page to Sage

What you get: Sage pulls that page's numbers every morning and keeps them for
good, shows them in the Content dashboard, and lets Claude read them
(`sage_social_*`) to plan what to post.

**Cost: nothing.** No Facebook Page, no App Review, no business verification.
This uses *Instagram API with Instagram Login* with Standard Access, which is
the path Meta allows for reading an account **you own**.

Checked against Meta's docs on 2026-11-24 (API **v25.0**). Meta renames things,
so if a button below is called something else, look for the nearest match.

---

## Before you start

| | |
|---|---|
| Time | About 20 minutes, once per Instagram page |
| You need | The Instagram account switched to **Professional** (Creator or Business) |
| Where | developers.facebook.com, then Sage's Content dashboard |

Switch the account over in the Instagram app: **Settings › Account type and
tools › Switch to professional account**. Creator is fine. This is free and you
can switch back.

---

## Step 1 — Make a Meta app

1. Go to **developers.facebook.com** and log in. Verify your phone if it asks.
2. **My Apps › Create app.**
3. Name it something like `Sage Social`.
4. Leave it in **Development mode**. It never needs to go live.

## Step 2 — Add Instagram to the app

1. In the app, **Add product › Instagram**.
2. Pick **API setup with Instagram login**. (Meta also calls this **API setup
   with Unified login**. Either name is the right one — not "Facebook Login for
   Business", which is the path that wants a Facebook Page.)

## Step 3 — Make a free Business portfolio and connect it

Meta now asks for a **Business portfolio** before it hands over the two values.
It is **free**, takes a minute, and needs **no verification** for this. A
portfolio is just a folder Meta puts the app in — think of it as a free account
holder, not a company you have to prove exists.

1. On the **API setup with Unified login** page you will see a yellow banner:
   *"Business portfolio selection is mandatory."* Press **+ Business portfolio**.
2. If you already have one, pick it. If not, it offers to **create** one: give it
   any name (your own name is fine), and that is all it needs.
3. Back on the setup page, the portfolio now shows as connected.

> No business verification, no documents, no fee. A portfolio made here stays in
> Development mode with the app, which is all Sage needs to read your own page.

## Step 4 — Get the two values Sage needs

Open **Instagram › API setup with Unified login › Set up Instagram business
login › Business login settings**. You will see:

| Field | What to do |
|---|---|
| **Instagram App ID** | Copy it |
| **Instagram app secret** | Copy it |
| **OAuth redirect URIs** | Add `https://localhost/sage/social` and save |

That redirect page does not have to exist. Instagram just needs somewhere to
send you, and you copy the code out of the address bar yourself.

> If your Pi has a public address you would rather use, set `SAGE_IG_REDIRECT`
> in `/etc/sage/sage.env` to that URL and put the same URL in Meta.

## Step 5 — Give Sage the app id and secret

In Sage, open **Content**, pick this page's project in the dropdown, press **Connect Instagram**, and
paste both values. They are saved on the Pi only, never on your phone.

## Step 6 — Allow access

1. Press **Allow on Instagram** in Sage. It opens Instagram's own page.
2. Log in with this page's account and allow the two permissions
   (`instagram_business_basic`, `instagram_business_manage_insights`).
3. Instagram sends you to `https://localhost/sage/social?code=AQB...#_`, which
   **will not load**. That is expected.
4. Copy everything after `code=` from the address bar. Drop the `#_` at the end
   if it's there — Sage removes it anyway.

## Step 7 — Paste the code

Paste it into Sage and press **Connect**. Sage then:

- swaps the code for a short-lived token (a code lasts **1 hour** and works **once**),
- swaps that for a **60-day** long-lived token,
- keeps only the long-lived one, on the Pi,
- refreshes it by itself once it is a day old, well before it runs out,
- pulls your numbers straight away.

Done. After this the Pi pulls every morning at 6 (set `SAGE_SOCIAL_HOUR` to
change the hour), and **Pull now** fetches immediately.

---

## If something goes wrong

| It says | What it means |
|---|---|
| "Insufficient permission" | The account isn't Professional yet, or you allowed with the wrong account |
| The code is refused | Codes last an hour and work once. Press **Allow on Instagram** again for a new one |
| "Add your Instagram App ID and app secret" | Step 5 didn't save |
| App Review / business verification is offered | **Skip it.** That's only for reading accounts you don't own |
| A tile is blank | Instagram no longer gives that metric. Sage lists the dropped ones under the posts table |
| The token banner keeps showing | A token left unrefreshed for 60 days dies. Connect again from Step 6 |

## What Meta will and won't give

| Yes | No |
|---|---|
| Followers, reach, views, interactions, likes, comments, shares, saves, replies | Other people's account insights |
| Per post and reel: reach, views, likes, comments, saves, shares; reels add watch time | Your follower list, DM contents, hashtag reach |
| Audience age, city, country, gender — **only at 100+ followers** | Anything about accounts you don't own |

Two things worth knowing:

- **`impressions` is gone** (Meta retired it on 21 April 2025). **`views`**
  replaces it, and that's what Sage stores.
- Meta keeps account metrics about **90 days** and media metrics about **2
  years**, and demographics only while you're over 100 followers. Sage writes a
  snapshot every morning, so its own history outlives Meta's.

Rate limits are nowhere near a problem: Meta allows thousands of calls a day and
one page costs roughly 30.
