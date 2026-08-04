# Step 7 — Troubleshooting 🔴 → 🟢

Something red on the screen? Find it below. Each row says **what it means** and **how
to fix it**. Don't worry — every one of these has a simple fix.

---

## Errors you might see

### "Invalid OAuth 2.0 Access Token"
- **Where:** in the dashboard, after clicking *Fetch*.
- **Means:** the key was rejected by Meta.
- **Fix:**
  1. Check the key with [Meta's key checker](04-check-your-token.md). If it says
     *Valid: False*, make a new key ([Step 2](02-system-user-and-token.md)).
  2. If the checker says the key is **good**, the key was probably **pasted wrong**
     into Supabase (a missing letter or an extra space). Re-copy the **whole** key and
     paste it again into `META_PAGE_TOKEN` ([Step 3](03-add-secrets-to-supabase.md)).
- **Good news:** the dashboard already knows the trick where a System User key must be
  swapped for a "Page key" behind the scenes — that part is automatic. You don't have
  to do anything for it.

### "No permissions available" (when making the token)
- **Where:** at **Generate token**, on the permissions screen.
- **Means:** the robot (`dashboard-bot`) has no job at that app yet.
- **Fix:** close the box. Go to **System users → `dashboard-bot` → Add assets →
  Apps**, tick your app, give **Full control**, Save. Then generate the token again.
  (Full steps: [Step 2](02-system-user-and-token.md).)

### "This account is not approved for the shared Meta token"
- **Means:** the email you signed in with isn't on the allow-list, so it can't use the
  shared key.
- **Fix:** the owner adds your email to the `allowed_emails` list in Supabase. Or use
  the **"Use my own token"** box instead.

### "Server has no META_PAGE_TOKEN / META_PAGE_ID configured"
- **Means:** the safe is empty — the secrets weren't saved.
- **Fix:** add both secrets again, spelled exactly, in
  [Step 3](03-add-secrets-to-supabase.md).

### A Page is missing from the dropdown
- **Means:** the robot can't see that Page.
- **Fix:**
  - If you **own** the Page: assign it to `dashboard-bot`
    ([Step 5](05-choose-which-page.md)).
  - If the Page is in **another portfolio**: share it across first
    ([Step 6](06-a-page-in-another-portfolio.md)), then assign it.

### The developer sign-up won't verify my phone
- **Means:** Meta wants the phone confirmed in Accounts Centre first.
- **Fix:** use the **credit-card** verify option instead (it's just an ID check), or
  confirm the phone in Accounts Centre, then retry. See
  [Step 1](01-create-app.md).

### Instagram shows nothing, but Facebook works
- **Means:** the Instagram account isn't linked to that Page, or wasn't assigned.
- **Fix:** in the Page's settings, link the Instagram Business account to the Page,
  and assign the Instagram to `dashboard-bot` ([Step 5](05-choose-which-page.md)).

### A thumbnail picture is blank on an old saved report
- **Means:** Facebook/Instagram picture links **expire** after a while (this is normal
  and not your fault).
- **Fix:** nothing needed — the **link/title still works**, and re-fetching brings the
  pictures back. Nothing is broken.

---

## Still stuck?

Note **exactly** what the red text says (a screenshot helps), and which step you were
on. That makes it quick to find the fix. Then re-read the matching page above — the
answer is almost always "assign the Page/app to `dashboard-bot`" or "re-paste the
whole key."

**Back to the start:** [Guide home](README.md)
