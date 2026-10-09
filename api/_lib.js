// Shared helpers for the FlexoCalculator server functions (run on Vercel).
const admin = require("firebase-admin");

if (!admin.apps.length) {
  const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  admin.initializeApp({ credential: admin.credential.cert(sa) });
}
const db = admin.firestore();
const norm = (e) => String(e || "").trim().toLowerCase();

let _fs = null;
async function freemius() {
  if (_fs) return _fs;
  const { Freemius } = await import("@freemius/sdk");
  _fs = new Freemius({
    productId: process.env.FREEMIUS_PRODUCT_ID,
    apiKey: process.env.FREEMIUS_API_KEY,
    secretKey: process.env.FREEMIUS_SECRET_KEY,
    publicKey: process.env.FREEMIUS_PUBLIC_KEY,
  });
  return _fs;
}
const isSandbox = () => process.env.FREEMIUS_SANDBOX !== "false";

function cors(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  if (req.method === "OPTIONS") { res.status(204).end(); return true; }
  return false;
}

async function requireUser(req, res) {
  const h = req.headers.authorization || "";
  const m = h.match(/^Bearer (.+)$/);
  if (!m) { res.status(401).json({ error: "Sign in first." }); return null; }
  try {
    return await admin.auth().verifyIdToken(m[1]);
  } catch (e) {
    res.status(401).json({ error: "Your session expired. Sign in again." });
    return null;
  }
}

async function writeAccess(uid, active, reason) {
  await db.doc(`users/${uid}/meta/license`).set(
    { active, reason: reason || "", checkedAt: Date.now() },
    { merge: true }
  );
}

// Decide access for one email from the stored purchases, and update that user's access doc.
async function applyEmailAccess(email) {
  email = norm(email);
  if (!email) return false;
  const snap = await db.collection("entitlements").where("email", "==", email).get();
  const active = snap.docs.some((d) => d.data().active === true);
  let user = null;
  try { user = await admin.auth().getUserByEmail(email); } catch (e) { /* not signed up yet */ }
  if (!user) return active;
  if (active && !user.emailVerified) {
    await writeAccess(user.uid, false, "Payment found. Confirm your email (check your inbox), then press \"I've paid, refresh\".");
    return false;
  }
  await writeAccess(user.uid, active, active ? "" : "No payment found for this email yet.");
  return active;
}

// Turn a Freemius purchase into an access record. One-time purchases stay active unless refunded/cancelled.
async function syncLicense(licenseId) {
  const fs = await freemius();
  const purchase = await fs.purchase.retrievePurchase(String(licenseId));
  if (!purchase) return;
  const rec = purchase.toEntitlementRecord();
  const expired = rec.expiration && new Date(rec.expiration) < new Date();
  const active = !expired && !rec.isCanceled;
  const email = norm(purchase.email);
  await db.doc(`entitlements/${String(licenseId)}`).set(
    {
      email,
      active,
      type: rec.type || null,
      planId: String(rec.fsPlanId || ""),
      expiration: rec.expiration ? new Date(rec.expiration).getTime() : null,
      updatedAt: Date.now(),
    },
    { merge: true }
  );
  await applyEmailAccess(email);
}

module.exports = { admin, db, norm, freemius, isSandbox, cors, requireUser, writeAccess, applyEmailAccess, syncLicense };
