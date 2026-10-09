const { norm, cors, requireUser, writeAccess, applyEmailAccess } = require("./_lib");

module.exports = async (req, res) => {
  if (cors(req, res)) return;
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  try {
    const user = await requireUser(req, res);
    if (!user) return;
    const email = norm(user.email);
    const owner = norm(process.env.OWNER_EMAIL);
    if (owner && email === owner) {
      await writeAccess(user.uid, true, "");
      return res.json({ active: true });
    }
    const active = await applyEmailAccess(email, user.email_verified === true);
    if (!active) {
      return res.json({ active: false, reason: user.email_verified === true ? "" : "Confirm your email first." });
    }
    return res.json({ active: true });
  } catch (e) {
    console.error("[checkLicense]", e);
    return res.status(500).json({ error: "Server error. Try again in a minute." });
  }
};
