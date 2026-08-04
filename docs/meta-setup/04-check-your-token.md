# Step 4 — Check your key 🔎

Before we use the key, let's make sure Meta thinks it's a **good** key. Meta has a
free tool that reads a key and tells you all about it.

> ⏱️ 30 seconds.

---

## Use Meta's key checker

1. Open **https://developers.facebook.com/tools/debug/accesstoken/**
2. Paste your **key** into the box → click **Debug**.
3. Look at what it says. A **good** key looks like this:

| Row | Should say |
|---|---|
| **Valid** | `True` ✅ |
| **Type** | `System User` |
| **Expires** | `Never` |
| **Scopes** | should list `pages_read_user_content`, `pages_read_engagement`, `pages_show_list`, `instagram_basic`, `instagram_manage_comments` |

> 🔒 This is Meta's **own** website, so it is safe to paste your key here — but nowhere
> else. When you finish, don't leave the key on screen for others to see.

---

## If something is wrong

| What you see | What it means | Fix |
|---|---|---|
| `Valid: False` | The key is broken or was copied wrong. | Make a new key in [Step 2](02-system-user-and-token.md) and paste the **whole** thing. |
| **Type** is `User` and **Expires** is in ~1 hour | You grabbed a short "practice" key, not the robot's key. | Use **System users → Generate token** in [Step 2](02-system-user-and-token.md), not the Graph Explorer. |
| `pages_read_user_content` is **missing** | The key can't read comments. | Re-make the key in [Step 2](02-system-user-and-token.md) and tick that box. |

---

## ✅ Done?

If your key is **Valid: True**, **System User**, **Never** expires, and has the five
scopes — it's perfect.

**Next:** [Step 5 — Pick which Page to read →](05-choose-which-page.md)
