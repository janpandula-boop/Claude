# Sunset / re-engagement confirmation flow

Goal: for contacts at risk of going stale, send one last email asking them
to confirm they still want emails. If they click through and confirm on the
landing page, they stay subscribed. If they take no action within a set
window, they're automatically unsubscribed.

## Files

- `index.html` — the confirmation landing page. Host it wherever you like
  (Klaviyo custom domain, Vercel/Netlify/S3, your own site) — Klaviyo emails
  just need a URL to link to.
- `webhook/unsubscribe.js` — example serverless function (Cloudflare Worker
  syntax, easy to port) that revokes marketing consent for contacts who
  don't confirm. Only needed if you want a full consent revoke rather than
  Klaviyo's native "Unsubscribe from List" flow action (see Step 4 below).

## How the mechanics work

1. **Trigger**: a segment of "at risk" contacts (e.g. no email opens/clicks
   in 90+ days) enters the Sunset flow.
2. **Email**: sends with a CTA button linking to the landing page, with the
   contact's email passed as a query param so the page can pre-fill it:
   ```
   https://yourdomain.com/resubscribe?email={{ person.email|url_encode }}
   ```
3. **Landing page action**: contact clicks "Keep me signed up" →
   `index.html` fires a `Confirmed Subscription` custom event to Klaviyo via
   the public Client API (no secret key needed, safe to run in the browser),
   and optionally re-subscribes them to a specific list.
4. **Time delay + conditional split** (back in the flow, after the email):
   - Wait 3–5 days (long enough for someone to see and act on the email).
   - Conditional split: **"Has since [time delay started]" → metric
     `Confirmed Subscription`**.
     - **Yes branch**: contact confirmed — exit the flow (optionally add
       them to an "Engaged" list, remove the at-risk flag).
     - **No branch**: contact didn't act — this is the unsubscribe path.
5. **No-branch action** — two ways to implement, pick one:
   - **Simplest (native, recommended to start)**: add Klaviyo's built-in
     **"Unsubscribe from List"** flow action. No code needed, works for the
     list(s) you specify.
   - **Full consent revoke (webhook)**: if you want them fully unsubscribed
     from all marketing (not just one list), add a **Webhook** flow action
     that POSTs `{ "email": "{{ person.email }}" }` to your deployed
     `webhook/unsubscribe.js` endpoint, which calls Klaviyo's Profiles API
     server-side with a private key to set `marketing.consent` to
     `UNSUBSCRIBED`.

## Setup checklist

- [ ] In `index.html`, set `KLAVIYO_COMPANY_ID` to your **public** API key.
- [ ] (Optional) set `LIST_ID` if you want an explicit list re-subscribe on
      confirmation.
- [ ] Deploy `index.html` somewhere reachable at a stable URL.
- [ ] In Klaviyo, create the custom metric `Confirmed Subscription` (it'll
      auto-appear the first time the event fires — you can trigger a test
      submission from the page to seed it).
- [ ] Build the flow: at-risk segment trigger → email → time delay →
      conditional split on `Confirmed Subscription` → Yes: exit/tag,
      No: unsubscribe action.
- [ ] If using the webhook path: deploy `webhook/unsubscribe.js`, set the
      `KLAVIYO_PRIVATE_API_KEY` secret (Profiles: Write scope), and point
      the flow's Webhook action at its URL.
- [ ] Test end-to-end with a real (test) profile: click the email link,
      confirm, verify the event fires and the conditional split routes to
      "Yes". Then test the no-action path and confirm the unsubscribe
      actually revokes consent.

## Notes

- The public Client API (`a.klaviyo.com/client/...`) is safe to call
  directly from the browser — it's rate-limited and can't read data back,
  only write events/subscriptions. Never put your **private** API key in
  `index.html`.
- If you'd rather not host custom HTML at all, Klaviyo's native Landing
  Pages + Forms builder can do the same job (a form triggers a "Submitted
  Form" metric) — swap that metric in for `Confirmed Subscription` in the
  conditional split and skip `index.html`/hosting entirely.
