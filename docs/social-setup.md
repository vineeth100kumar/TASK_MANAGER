# Connecting an Instagram page to Sage

What you get: Sage pulls that page's numbers every morning and keeps them for
good, shows them in the Content dashboard, and lets Claude read them
(`sage_social_*`) to plan what to post.

**Cost: nothing.** No Facebook Page, no App Review, no business verification —
you read your **own** professional account as a tester of your own app.

Checked against Meta's live setup on 2026-11-24. Meta renamed the path to
**"API setup with Unified login"** (older apps may still show "API setup with
Instagram login" — Sage takes either). Meta renames things, so if a button below
is called something else, look for the nearest match.

> **What changed:** Meta removed the old "Instagram login" path (App ID + secret
> + a redirect) for newer apps. Newer apps use **Unified login**, where you copy
> an **access token** straight out of the Meta dashboard. That token **never
> expires**, so there is nothing to refresh. The steps below are the new way; the
> old way is at the bottom for older apps.

---

## Before you start

| | |
|---|---|
| Time | About 15 minutes, once per Instagram page |
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
4. When it asks the use case, pick the **Instagram** one.
5. Leave it in **Development mode**. It never needs to go live, and you never
   submit App Review.

## Step 2 — Make a free Business portfolio and connect it

Meta asks for a **Business portfolio** before it lets you go on. It is **free**,
takes a minute, and needs **no verification**. A portfolio is just a folder Meta
puts the app in — not a company you have to prove exists.

1. On the **API setup with Unified login** page you will see a yellow banner:
   *"Business portfolio selection is mandatory."* Press **+ Business portfolio**.
2. If you already have one, pick it. If not, **create** one: give it any name
   (your own name is fine), and that is all it needs.

> No business verification, no documents, no fee.

## Step 3 — Add your Instagram account as a tester

Still in the app:

1. Left menu → **App roles › Roles**.
2. Under **Instagram Testers**, add your Instagram account (by its username).
3. Open the **Instagram app** on your phone → **Settings › Apps and websites ›
   Tester invites** → **accept** the invite.

Without this, the token in the next step comes back empty.

## Step 4 — Generate the access token

Back on **Instagram › API setup with Unified login**:

1. Under **1. Configure your app**, press **Create new configuration** and set:
   - Login variation: **General**
   - Access token: **System-user access token**, Expiration: **Never**
   - Business assets: **Instagram account** (pick your page)
   - Permissions: include **instagram_manage_insights** (for the numbers),
     plus **instagram_basic**. Save.
2. Under **2. Generate access tokens**, pick your Instagram account and press
   **Generate token**.
3. **Copy** the long token. Treat it like a password — it never expires.

> You can **ignore** step 3 (webhooks) and step 4 (App Review). App Review is
> only for reading accounts you don't own.

## Step 5 — Give the token to Sage

In Sage, open **Content**, pick this page's project in the dropdown, press
**Connect Instagram**, and **paste the token**. That's it — no redirect, no code.

Sage then:

- resolves which Instagram account the token is for,
- keeps the token on the Pi only (never synced to your phone),
- pulls your numbers straight away.

Done. After this the Pi pulls every morning at 6 (set `SAGE_SOCIAL_HOUR` to
change the hour), and **Pull now** fetches immediately. The token never expires,
so there is nothing to renew.

---

## If something goes wrong

| It says | What it means |
|---|---|
| The token is refused / empty | You skipped the **tester invite** (Step 3), or generated the token before accepting it. Accept it, then generate again |
| "Insufficient permission" | The account isn't Professional yet, or **instagram_manage_insights** isn't on the configuration |
| App Review / business verification is offered | **Skip it.** That's only for reading accounts you don't own |
| A tile is blank | Instagram no longer gives that metric. Sage lists the dropped ones under the posts table |

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
  years**. Sage writes a snapshot every morning, so its own history outlives
  Meta's.

Rate limits are nowhere near a problem: Meta allows thousands of calls a day and
one page costs roughly 30.

---

## Older apps: the Instagram-login path

If your app still shows **"API setup with Instagram login"** with an **Instagram
App ID**, **app secret** and an **OAuth redirect URIs** field, you can use the
older way instead:

1. Add `https://localhost/sage/social` as an OAuth redirect URI (set
   `SAGE_IG_REDIRECT` in `/etc/sage/sage.env` if your Pi has a public URL).
2. Open Instagram's authorize page, allow `instagram_business_basic` and
   `instagram_business_manage_insights`, and copy the **code** from the address
   bar after it redirects (the page won't load — that's fine).
3. Paste that code into Sage's **Connect Instagram** box. Sage swaps it for a
   60-day token and refreshes it on its own.

Sage's Connect box takes either a token (new) or a code (old).
