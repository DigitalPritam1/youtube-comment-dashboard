# Step 2 — Make the System User and the key 🔑

**What is a System User?** A robot employee that never sleeps and **holds the key**.
Because it never sleeps, the dashboard can read comments even at night. We call ours
`dashboard-bot`.

> ⏱️ About 10 minutes. Do this at **https://business.facebook.com** → click the
> **gear (Settings)** → **Business Settings**. Make sure the folder name at the top
> says your portfolio (for us: **Indian Farmer**).

---

## A) Create the robot employee

1. Left menu → **Users → System users**.
2. Click **Add**. Name it `dashboard-bot`. Role: **Admin**. Click **Create system user**.

*(If `dashboard-bot` already exists, just click it — no need to make a new one.)*

---

## B) Give the robot its tools (do this **before** making the key)

Click your `dashboard-bot`, then click **Add assets** and add **three** things. For
each one, turn the **Full control** switch **ON**, then **Save**.

| Add this asset type | Tick this |
|---|---|
| **Apps** | your app from Step 1 (e.g. `Comment Extractor`) |
| **Pages** | your Facebook Page (e.g. *Courses by Indian Farmer*) |
| **Instagram accounts** | your linked Instagram |

> 😖 **This is the #1 mistake!** If you skip **Apps → your app**, then when you try to
> make the key you will see **"No permissions available."** That's Meta saying *"this
> robot has no job at that app yet."* Fix = add the app to the robot here, with Full
> control.

---

## C) Make the key (the token)

1. Still on `dashboard-bot`, click **Generate token**.
2. **Select app:** choose your app.
3. **Expiry:** choose **Never**. (So the key never stops working. 🎉)
4. **Permissions:** tick **all five** of these boxes:
   - `pages_read_engagement`
   - `pages_read_user_content`  ← *the important one for reading comments*
   - `pages_show_list`
   - `instagram_basic`
   - `instagram_manage_comments`
5. Click **Generate token** → a long secret appears → click **Copy**.

> 🔒 **Keep it secret.** This key is like your house key. Do **not** paste it in a
> chat or email. It goes to only **one** place — the Supabase safe (Step 3).

> 🧠 **Why five permissions?** They are five little "allowed to…" stickers:
> read the Page, read the Page's comments, see your list of Pages, see basic
> Instagram info, and read Instagram comments.

---

## ✅ Done?

You copied a long key. It is on your clipboard right now — go straight to Step 3 and
paste it before you copy anything else.

**Next:** [Step 3 — Put the key into Supabase →](03-add-secrets-to-supabase.md)
