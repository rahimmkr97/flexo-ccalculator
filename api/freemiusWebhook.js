const { db, freemius, applyEmailAccess, syncLicense } = require("./_lib");

async function readRaw(req) {
  const chunks = [];
  for await (const c of req) chunks.push(typeof c === "string" ? Buffer.from(c) : c);
  return Buffer.concat(chunks);
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).send("Method not allowed");
  try {
    const fs = await freemius();
    const listener = fs.webhook.createListener();
    const LICENSE_EVENTS = [
      "license.created", "license.extended", "license.shortened", "license.updated",
      "license.cancelled", "license.expired", "license.plan.changed",
    ];
    listener.on(LICENSE_EVENTS, async ({ objects: { license } }) => {
      if (license && license.id) await syncLicense(license.id);
    });
    listener.on("license.deleted", async ({ data }) => {
      const ref = db.doc(`entitlements/${String(data.license_id)}`);
      const s = await ref.get();
      const email = s.exists ? s.data().email : null;
      await ref.delete().catch(() => {});
      if (email) await applyEmailAccess(email);
    });

    // Rebuild a standard Request from the untouched raw body so the signature can be verified.
    const raw = await readRaw(req);
    const url = `https://${req.headers.host}${req.url}`;
    const request = new Request(url, { method: "POST", headers: req.headers, body: raw });
    const response = await fs.webhook.processFetch(listener, request);
    res.status(response.status).send(await response.text());
  } catch (e) {
    console.error("[webhook]", e);
    res.status(500).send("Webhook error");
  }
};
