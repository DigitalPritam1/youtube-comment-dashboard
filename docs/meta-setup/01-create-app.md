# Step 1 — Make the Meta app 🤖

**What is an app?** Think of it as a little robot helper you create at Meta. The
robot is *allowed* to read your Page's comments. You only make it once.

> ⏱️ Takes about 10 minutes. You need to be logged in to the Facebook account that
> manages your Page.

---

## A) Become a "developer" (one time only)

1. Go to **https://developers.facebook.com**.
2. Click **Get Started** (top right). If it asks you to **register**, say yes and
   accept the rules.
3. Meta will ask you to **verify** who you are. There are **two ways** — pick one:
   - **Phone number:** type your number and get a code by SMS.
   - **Credit card:** click *"verify with a credit card"*. This is only an ID check.
     Meta may hold a tiny amount for a moment and give it back — it is **not** a real
     charge.

> 😖 **Stuck?** If the phone box shows a red line like *"You can only complete this
> action in Accounts Center,"* the phone won't work right now. **Use the credit-card
> way instead** — it is faster. (Or go to Accounts Centre → your profile → *Personal
> details* → confirm the phone there first, then come back.)

---

## B) Create the app

1. Still on **https://developers.facebook.com**, click **My Apps** → **Create App**.
2. **App name:** anything, for example `Comment Extractor`. Add your email. Click **Next**.
3. **What do you want to do?** Choose **Other** → **Next**.
4. **App type:** choose **Business** → **Next**.
5. **Business portfolio:** ⚠️ **very important** — pick the portfolio your Page is in
   (for us that is **Indian Farmer**). This puts the app in the right folder so the
   next steps can find it. Click **Create app**.

> 🧠 **Why the portfolio matters:** an app and a Page must live in the **same
> folder** (portfolio) to work together. Picking the right one here saves a headache
> later.

---

## C) Add the Instagram part

1. In your new app's page, find **Add product** (left side).
2. Add **Instagram** (Instagram Graph API). Click **Set up**.
3. That's it — Facebook Page reading needs nothing extra.

You do **not** need "App Review" or approval, because you own the app **and** the
Page **and** the Instagram account. Reading your **own** things is always allowed.

---

## ✅ Done?

You have a robot helper (app) inside the correct portfolio, with Instagram added.

**Next:** [Step 2 — Make the System User and the key →](02-system-user-and-token.md)
