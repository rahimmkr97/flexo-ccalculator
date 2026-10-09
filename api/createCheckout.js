const { norm, freemius, isSandbox, cors, requireUser } = require("./_lib");

module.exports = async (req, res) => {
  if (cors(req, res)) return;
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  try {
    const user = await requireUser(req, res);
    if (!user) return;
    const email = norm(user.email);
    if (!email) return res.status(400).json({ error: "Your account has no email." });
    if (user.email_verified !== true) {
      return res.status(400).json({ error: "Confirm your email before buying." });
    }
    const fs = await freemius();
    const checkout = await fs.checkout.create({
      user: { email },
      planId: process.env.FREEMIUS_PLAN_ID || undefined,
      isSandbox: isSandbox(),
    });
    // Card-required free trial: Freemius collects the card now and charges only when the trial ends.
    // Turn off with FREEMIUS_TRIAL=off in Vercel. The plan itself must have a trial set in the Freemius dashboard.
    const wantTrial = String(process.env.FREEMIUS_TRIAL || "paid").toLowerCase() !== "off";
    if (wantTrial && typeof checkout.setTrial === "function") checkout.setTrial("paid");
    let { link } = checkout.serialize();
    if (wantTrial && link && !/[?&]trial=/.test(link)) link += (link.includes("?") ? "&" : "?") + "trial=paid";
    return res.json({ link });
  } catch (e) {
    console.error("[createCheckout]", e);
    return res.status(500).json({ error: "Couldn't start checkout. Try again in a minute." });
  }
};
