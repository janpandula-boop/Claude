/**
 * Example webhook target for the "no confirmation" branch of the sunset flow.
 *
 * Klaviyo's flow "Webhook" action calls this endpoint (POST) with the
 * profile's email/ID when a contact reaches the flow step without having
 * confirmed. This handler unsubscribes them from email marketing entirely
 * (not just one list), by revoking marketing consent via the Klaviyo API.
 *
 * Written for Cloudflare Workers, but the body is plain fetch/JSON so it
 * ports to any Node/serverless runtime with minimal changes.
 *
 * Required secret: KLAVIYO_PRIVATE_API_KEY (Settings > API Keys > Private key,
 * needs "Profiles: Write" / "Lists: Write" scope). Never expose this key
 * client-side — that's why this runs server-side and the landing page only
 * ever talks to Klaviyo's public Client API.
 */

const KLAVIYO_REVISION = "2024-10-15";

export default {
  async fetch(request, env) {
    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    let payload;
    try {
      payload = await request.json();
    } catch (err) {
      return new Response("Invalid JSON", { status: 400 });
    }

    // Klaviyo webhook actions let you configure the JSON body sent, e.g.
    // { "email": "{{ person.email }}", "flow_id": "{{ flow.id }}" }
    const email = payload.email;
    if (!email) {
      return new Response("Missing email", { status: 400 });
    }

    try {
      await revokeMarketingConsent(email, env.KLAVIYO_PRIVATE_API_KEY);
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    } catch (err) {
      return new Response(
        JSON.stringify({ ok: false, error: String(err) }),
        { status: 502, headers: { "Content-Type": "application/json" } }
      );
    }
  }
};

async function revokeMarketingConsent(email, apiKey) {
  const profileId = await findProfileIdByEmail(email, apiKey);
  if (!profileId) {
    throw new Error("profile_not_found:" + email);
  }

  const res = await fetch(
    `https://a.klaviyo.com/api/profiles/${profileId}/`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Klaviyo-API-Key ${apiKey}`,
        "Content-Type": "application/json",
        revision: KLAVIYO_REVISION
      },
      body: JSON.stringify({
        data: {
          type: "profile",
          id: profileId,
          attributes: {
            subscriptions: {
              email: {
                marketing: {
                  consent: "UNSUBSCRIBED"
                }
              }
            }
          }
        }
      })
    }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`unsubscribe_failed:${res.status}:${text}`);
  }
}

async function findProfileIdByEmail(email, apiKey) {
  const url =
    "https://a.klaviyo.com/api/profiles/?filter=" +
    encodeURIComponent(`equals(email,"${email}")`);

  const res = await fetch(url, {
    headers: {
      Authorization: `Klaviyo-API-Key ${apiKey}`,
      revision: KLAVIYO_REVISION
    }
  });

  if (!res.ok) {
    throw new Error(`profile_lookup_failed:${res.status}`);
  }

  const json = await res.json();
  return json.data && json.data[0] ? json.data[0].id : null;
}
