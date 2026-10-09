// Customer portal: lets a signed-in customer see their plan and cancel renewal.
// One endpoint; the Freemius SDK handles data (?action=portal_data) and every signed action.
const { norm, freemius, isSandbox, cors, requireUser } = require("./_lib");

async function readRaw(req) {
  const chunks = [];
  for await (const c of req) chunks.push(typeof c === "string" ? Buffer.from(c) : c);
  return Buffer.concat(chunks);
}

module.exports = async (req, res) => {
  if (cors(req, res)) return;
  try {
    const user = await requireUser(req, res);
    if (!user) return;
    const email = norm(user.email);
    if (!email || user.email_verified !== true) {
      return res.status(400).json({ error: "Confirm your email first." });
    }
    const fs = await freemius();
    const host = req.headers["x-forwarded-host"] || req.headers.host;
    const portalEndpoint = `https://${host}/api/portal`;
    const processor = fs.customerPortal.request.createProcessor({
      portalEndpoint,
      isSandbox: isSandbox(),
      getUser: async () => {
        const u = await fs.api.user.retrieveByEmail(email);
        return u && u.id ? { id: String(u.id), email } : { email };
      },
    });
    const init = { method: req.method, headers: req.headers };
    if (req.method !== "GET" && req.method !== "HEAD") init.body = await readRaw(req);
    const request = new Request(`https://${host}${req.url}`, init);
    const response = await processor(request);
    res.status(response.status);
    const ct = response.headers.get("content-type");
    if (ct) res.setHeader("Content-Type", ct);
    res.send(Buffer.from(await response.arrayBuffer()));
  } catch (e) {
    console.error("[portal]", e);
    res.status(500).json({ error: "Couldn't load your plan right now. Try again in a minute." });
  }
};
