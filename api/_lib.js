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

async function writeAccess(uid, active, reason, trialEnds) {
  const data = { active, reason: reason || "", checkedAt: Date.now() };
  // trialEnds is set only while a free trial is what grants access; paid access clears it.
  data.trialEnds = trialEnds ? trialEnds : admin.firestore.FieldValue.delete();
  await db.doc(`users/${uid}/meta/license`).set(data, { merge: true });
}

const TRIAL_DAYS = () => Math.max(0, Number(process.env.TRIAL_DAYS || 0));

// Decide access for one email: a paid license wins, otherwise the free trial (one per email address).
// allowTrial=true is passed only when the customer themselves opens the app (checkLicense),
// so webhook events never start a trial by accident.
async function applyEmailAccess(email, allowTrial) {
  email = norm(email);
  if (!email) return false;
  const snap = await db.collection("entitlements").where("email", "==", email).get();
  const paid = snap.docs.some((d) => d.data().active === true);
  let user = null;
  try { user = await admin.auth().getUserByEmail(email); } catch (e) { /* not signed up yet */ }
  if (!user) return paid;
  if (paid && user.emailVerified) {
    await writeAccess(user.uid, true, "");
    return true;
  }
  if (paid && !user.emailVerified) {
    await writeAccess(user.uid, false, "Payment found. Confirm your email (check your inbox), then press \"Refresh\".");
    return false;
  }
  // No paid license: free trial?
  const days = TRIAL_DAYS();
  if (days > 0 && user.emailVerified) {
    const ref = db.doc(`trials/${encodeURIComponent(email)}`);
    let t = (await ref.get()).data();
    if (!t && allowTrial) {
      t = { start: Date.now(), end: Date.now() + days * 86400000 };
      await ref.set(t);
    }
    if (t) {
      if (t.end > Date.now()) {
        await writeAccess(user.uid, true, "", t.end);
        return true;
      }
      await writeAccess(user.uid, false, "Your free trial has ended. Choose a monthly or yearly plan to keep going.");
      return false;
    }
  }
  await writeAccess(user.uid, false, days > 0 ? "" : "No payment found for this email yet.");
  return false;
}

// Turn a Freemius purchase into an access record. One-time purchases stay active unless refunded/cancelled.
async function syncLicense(licenseId) {
  const fs = await freemius();
  const purchase = await fs.purchase.retrievePurchase(String(licenseId));
  if (!purchase) { console.log("[syncLicense] no purchase for license", String(licenseId)); return; }
  const rec = purchase.toEntitlementRecord();
  console.log("[syncLicense]", String(licenseId), JSON.stringify(rec));
  const expired = rec.expiration && new Date(rec.expiration) < new Date();
  // Subscriptions: a cancelled plan keeps working until the period they already paid for ends.
  // One-time purchases: active unless refunded/cancelled.
  const active = rec.type === "subscription"
    ? (rec.expiration ? !expired : !rec.isCanceled)
    : (!expired && !rec.isCanceled);
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
