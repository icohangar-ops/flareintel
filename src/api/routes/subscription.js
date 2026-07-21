/**
 * FlareIntel — Subscription Routes
 *
 * Endpoints for checking subscription status, viewing tier info,
 * and managing subscriptions.
 */

const express = require("express");
const { ethers } = require("ethers");
const router = express.Router();

// ─── Contract ABIs ──────────────────────────────────────────────────
const SUB_ABI = [
  "function getSubscription(address user) view returns (uint8 tier, uint256 expiresAt, bool active)",
  "function tierConfigs(uint8 tier) view returns (uint256 rdtPriceMonthly, uint256 flrPriceMonthly, uint256 maxFeeds, uint256 rateLimitPerHour)",
  "function totalSubscribers() view returns (uint256)",
  "function subscriptionRevenue() view returns (uint256)",
];

const TIER_NAMES = ["None", "Free", "Basic", "Premium", "Institutional"];

// ─── Routes ─────────────────────────────────────────────────────────

/**
 * GET /api/subscription/tiers
 * Get all subscription tier configurations.
 */
router.get("/tiers", async (req, res) => {
  try {
    const addresses = req.app.locals.contractAddresses;
    const provider = req.app.locals.provider;

    if (!addresses.DataSubscription) {
      // Return default tier info without contract
      return res.json({
        source: "defaults",
        tiers: [
          {
            id: 1, name: "Free",
            rdtPrice: "0", flrPrice: "0",
            maxFeeds: 5, rateLimitPerHour: 60,
            features: ["Public summary data", "Top 5 riskiest countries", "Daily updates"],
          },
          {
            id: 2, name: "Basic",
            rdtPrice: "100", flrPrice: "5",
            maxFeeds: 50, rateLimitPerHour: 300,
            features: ["All country CII scores", "Hourly updates", "Historical data (7 days)", "API access"],
          },
          {
            id: 3, name: "Premium",
            rdtPrice: "500", flrPrice: "25",
            maxFeeds: 200, rateLimitPerHour: 1000,
            features: ["Full CII breakdown (sub-indices)", "Real-time updates", "Historical data (1 year)", "Alerts & notifications", "FDC attestation access"],
          },
          {
            id: 4, name: "Institutional",
            rdtPrice: "2000", flrPrice: "100",
            maxFeeds: 500, rateLimitPerHour: 5000,
            features: ["Everything in Premium", "Custom country feeds", "Collateral monitoring", "Priority support", "SLA guarantee", "KYC oracle integration"],
          },
        ],
      });
    }

    const sub = new ethers.Contract(addresses.DataSubscription, SUB_ABI, provider);
    const tiers = [];

    for (let i = 1; i <= 4; i++) {
      const [rdtPrice, flrPrice, maxFeeds, rateLimit] = await sub.tierConfigs(i);
      tiers.push({
        id: i,
        name: TIER_NAMES[i],
        rdtPriceMonthly: ethers.formatEther(rdtPrice),
        flrPriceMonthly: ethers.formatEther(flrPrice),
        maxFeeds: Number(maxFeeds),
        rateLimitPerHour: Number(rateLimit),
      });
    }

    res.json({ source: "on-chain", tiers });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch tiers", message: err.message });
  }
});

/**
 * POST /api/subscription/check
 * Check the subscription status of a given address.
 */
router.post("/check", async (req, res) => {
  const { address } = req.body;

  if (!address || !ethers.isAddress(address)) {
    return res.status(400).json({ error: "Valid Ethereum address required" });
  }

  try {
    const addresses = req.app.locals.contractAddresses;

    if (!addresses.DataSubscription) {
      return res.json({
        address,
        tier: "None",
        active: false,
        message: "Subscription contract not deployed yet",
      });
    }

    const provider = req.app.locals.provider;
    const sub = new ethers.Contract(addresses.DataSubscription, SUB_ABI, provider);
    const [tier, expiresAt, active] = await sub.getSubscription(address);

    const tierNum = Number(tier);
    const expiryTs = Number(expiresAt);
    const isExpired = expiryTs > 0 && Date.now() / 1000 > expiryTs;

    res.json({
      address,
      tier: TIER_NAMES[tierNum] || "None",
      tierId: tierNum,
      active: active && !isExpired,
      expiresAt: expiryTs > 0 ? new Date(expiryTs * 1000).toISOString() : null,
      isExpired,
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to check subscription", message: err.message });
  }
});

/**
 * GET /api/subscription/stats
 * Global subscription statistics.
 */
router.get("/stats", async (req, res) => {
  try {
    const addresses = req.app.locals.contractAddresses;
    const provider = req.app.locals.provider;

    if (!addresses.DataSubscription) {
      return res.json({
        totalSubscribers: 0,
        totalRevenue: "0",
        message: "Not deployed yet",
      });
    }

    const sub = new ethers.Contract(addresses.DataSubscription, SUB_ABI, provider);
    const [totalSubscribers, subscriptionRevenue] = await Promise.all([
      sub.totalSubscribers(),
      sub.subscriptionRevenue(),
    ]);

    res.json({
      totalSubscribers: Number(totalSubscribers),
      totalRevenue: ethers.formatEther(subscriptionRevenue),
      revenueCurrency: "FLR",
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch stats", message: err.message });
  }
});

module.exports = router;