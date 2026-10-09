const { db, norm, freemius, isSandbox, cors, requireUser } = require("./_lib");

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
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const cycle = body.plan === "yearly" ? "yearly" : "monthly";
    const wantTrial = body.trial === true && String(process.env.FREEMIUS_TRIAL || "paid").toLowerCase() !== "off";

    // One free trial per email. A trial started in the last 2 hours may be retried (abandoned checkout).
    const usedRef = db.doc(`trialUsed/${encodeURIComponent(email)}`);
    if (wantTrial) {
      const u = (await usedRef.get()).data();
      if (u && Date.now() - u.at > 2 * 3600 * 1000) {
        return res.status(400).json({ error: "You've already used your free trial. Choose a monthly or yearly plan.", code: "trial_used" });
      }
    }

    // Two separate Freemius plans (optional env vars), or one plan with monthly + annual billing.
    const planId = (cycle === "yearly" ? process.env.FREEMIUS_PLAN_ID_YEARLY : process.env.FREEMIUS_PLAN_ID_MONTHLY)
      || process.env.FREEMIUS_PLAN_ID || undefined;
    const fs = await freemius();
    const checkout = await fs.checkout.create({ user: { email }, planId, isSandbox: isSandbox() });
    // Card-required free trial: Freemius collects the card now and charges only when the trial ends.
    if (wantTrial && typeof checkout.setTrial === "function") checkout.setTrial("paid");
    let { link } = checkout.serialize();
    const add = (k, v) => { if (link && !new RegExp("[?&]" + k + "=").test(link)) link += (link.includes("?") ? "&" : "?") + k + "=" + v; };
    add("billing_cycle", cycle === "yearly" ? "annual" : "monthly");
    if (wantTrial) { add("trial", "paid"); await usedRef.set({ at: Date.now() }); }
    else add("trial", "false"); // straight subscription, no trial
    return res.json({ link });
  } catch (e) {
    console.error("[createCheckout]", e);
    return res.status(500).json({ error: "Couldn't start checkout. Try again in a minute." });
  }
};
