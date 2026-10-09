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
    const { link } = checkout.serialize();
    return res.json({ link });
  } catch (e) {
    console.error("[createCheckout]", e);
    return res.status(500).json({ error: "Couldn't start checkout. Try again in a minute." });
  }
};
