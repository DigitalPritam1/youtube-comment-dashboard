# Step 3 — Put the key into Supabase 🔒

Now we hide your key in the **Supabase safe**. The dashboard uses it from there; the
key never travels to your browser.

> ⏱️ 3 minutes. You need **two** things: the **key** you copied in Step 2, and your
> **Page ID** (a number). Getting the Page ID is below.

---

## A) Find your Page ID (a number)

Your **Page ID** is like your Page's house number. Two easy ways:

- **Easiest:** in **Business Settings → Pages**, click your Page — the number under
  the name is the Page ID.
- For this project, the main Page (*Courses by Indian Farmer*) has Page ID
  **`268916122981962`**.

---

## B) Open the Supabase secrets page

Go here:
**https://supabase.com/dashboard/project/aycfiqndcavzgipgurih/settings/functions**

Scroll to the **Secrets** section (also called *Edge Function Secrets*).

---

## C) Add two secrets

Add these **two** rows. The **Name** must be typed **exactly** as shown (all capital
letters, with underscores):

| Name (type exactly) | Value (what to paste) |
|---|---|
| `META_PAGE_TOKEN` | the long **key** you copied in Step 2 |
| `META_PAGE_ID` | your Page ID number, e.g. `268916122981962` |

Click **Save**.

> ⚠️ **Two easy mistakes:**
> - **Don't add a space** before or after the key. Copy the **whole** key — these
>   keys are very long (about 200 letters), so it's easy to miss the end.
> - Spell the names **exactly**. `META_PAGE_TOKEN`, not `Meta_Page_Token`.

---

## ✅ Done?

The safe now holds your key. Let's make sure the key is a good one before we use it.

**Next:** [Step 4 — Check your key →](04-check-your-token.md)
