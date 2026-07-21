// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.19;

/**
 * @title DataSubscription
 * @notice Manages tiered subscriptions to FlareIntel's on-chain risk data.
 *         Subscribers pay in RDT or FLR. Revenue is routed to the
 *         RiskDataToken yield pool for stakers.
 * @dev Tiers: Free (public summary), Basic (100 RDT/mo), Premium (500 RDT/mo),
 *      Institutional (custom, requires KYC oracle attestation).
 */

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

interface IRiskDataToken {
    function depositYield() external payable;
    function balanceOf(address) external view returns (uint256);
}

contract DataSubscription is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ─── Enums & Structs ─────────────────────────────────────────────
    enum Tier { None, Free, Basic, Premium, Institutional }

    struct Subscription {
        Tier    tier;
        uint256 expiresAt;
        bool    active;
    }

    struct TierConfig {
        uint256 rdtPriceMonthly;  // RDT cost per 30-day period
        uint256 flrPriceMonthly;  // FLR cost per 30-day period
        uint256 maxFeeds;
        uint256 rateLimitPerHour;
    }

    // ─── State ───────────────────────────────────────────────────────
    IRiskDataToken public rdt;
    address public collateralManager;

    mapping(Tier => TierConfig) public tierConfigs;
    mapping(address => Subscription) public subscriptions;
    mapping(address => uint256) public lastAccessTime;
    mapping(address => uint256) public accessCount;

    uint256 public subscriptionRevenue;
    uint256 public totalSubscribers;

    // ─── Events ──────────────────────────────────────────────────────
    event Subscribed(address indexed user, Tier tier, uint256 duration);
    event SubscriptionRenewed(address indexed user, Tier tier, uint256 newExpiry);
    event SubscriptionCancelled(address indexed user);
    event TierConfigUpdated(Tier tier, uint256 rdtPrice, uint256 flrPrice);
    event RevenueRouted(uint256 amount, uint256 timestamp);
    event RateLimited(address indexed user);

    // ─── Modifiers ───────────────────────────────────────────────────
    modifier rateLimited(address user) {
        uint256 window = 1 hours;
        if (block.timestamp - lastAccessTime[user] < window) {
            Tier t = subscriptions[user].tier;
            require(
                accessCount[user] < tierConfigs[t].rateLimitPerHour,
                "DataSub: rate limited"
            );
            emit RateLimited(user);
        } else {
            accessCount[user] = 0;
            lastAccessTime[user] = block.timestamp;
        }
        _;
        accessCount[user]++;
    }

    modifier activeSubscription(address user) {
        require(
            subscriptions[user].active &&
            subscriptions[user].expiresAt > block.timestamp,
            "DataSub: no active subscription"
        );
        _;
    }

    // ─── Constructor ─────────────────────────────────────────────────
    constructor(address _rdt) Ownable() {
        require(_rdt != address(0), "DataSub: zero RDT address");
        rdt = IRiskDataToken(_rdt);

        // Default tier pricing
        tierConfigs[Tier.Free]          = TierConfig(0,   0,   5,   60);
        tierConfigs[Tier.Basic]         = TierConfig(100e18, 5e18, 50,  300);
        tierConfigs[Tier.Premium]       = TierConfig(500e18, 25e18, 200, 1000);
        tierConfigs[Tier.Institutional] = TierConfig(2000e18, 100e18, 500, 5000);
    }

    // ─── Admin ───────────────────────────────────────────────────────
    function setTierConfig(
        Tier _tier,
        uint256 _rdtPrice,
        uint256 _flrPrice,
        uint256 _maxFeeds,
        uint256 _rateLimit
    ) external onlyOwner {
        tierConfigs[_tier] = TierConfig(_rdtPrice, _flrPrice, _maxFeeds, _rateLimit);
        emit TierConfigUpdated(_tier, _rdtPrice, _flrPrice);
    }

    function setCollateralManager(address _cm) external onlyOwner {
        collateralManager = _cm;
    }

    // ─── Subscribe ───────────────────────────────────────────────────
    /**
     * @notice Subscribe using RDT tokens. Transfers RDT from caller.
     * @param _tier Desired subscription tier.
     * @param _months Number of months to subscribe for.
     */
    function subscribeWithRDT(Tier _tier, uint256 _months) external nonReentrant {
        require(_tier > Tier.Free && _tier <= Tier.Institutional, "DataSub: invalid tier");
        require(_months > 0 && _months <= 24, "DataSub: invalid duration");

        uint256 cost = tierConfigs[_tier].rdtPriceMonthly * _months;
        require(rdt.balanceOf(msg.sender) >= cost, "DataSub: insufficient RDT");

        IERC20(address(rdt)).safeTransferFrom(msg.sender, address(this), cost);

        _activateSubscription(msg.sender, _tier, _months * 30 days);
    }

    /**
     * @notice Subscribe using FLR (native token).
     */
    function subscribeWithFLR(Tier _tier, uint256 _months) external payable nonReentrant {
        require(_tier > Tier.Free && _tier <= Tier.Institutional, "DataSub: invalid tier");
        require(_months > 0 && _months <= 24, "DataSub: invalid duration");

        uint256 cost = tierConfigs[_tier].flrPriceMonthly * _months;
        require(msg.value >= cost, "DataSub: insufficient FLR");

        _activateSubscription(msg.sender, _tier, _months * 30 days);

        // Refund excess
        if (msg.value > cost) {
            (bool ok,) = msg.sender.call{value: msg.value - cost}("");
            require(ok, "DataSub: refund failed");
        }
    }

    // ─── Access Control ──────────────────────────────────────────────
    function checkAccess(address user, bytes3 countryCode) external
        rateLimited(user)
        returns (bool allowed, Tier tier)
    {
        Subscription storage sub = subscriptions[user];
        tier = sub.tier;

        if (tier == Tier.None) {
            // Free tier: limited access
            return (true, Tier.Free);
        }

        if (!sub.active || sub.expiresAt < block.timestamp) {
            sub.active = false;
            return (false, Tier.None);
        }

        return (true, tier);
    }

    // ─── Internal ────────────────────────────────────────────────────
    function _activateSubscription(address user, Tier tier, uint256 duration) internal {
        Subscription storage sub = subscriptions[user];

        if (sub.active && sub.expiresAt > block.timestamp) {
            // Extend existing subscription
            sub.expiresAt += duration;
            emit SubscriptionRenewed(user, tier, sub.expiresAt);
        } else {
            sub.tier = tier;
            sub.expiresAt = block.timestamp + duration;
            sub.active = true;
            totalSubscribers++;
            emit Subscribed(user, tier, duration);
        }
    }

    /**
     * @notice Route collected FLR revenue to the RDT yield pool.
     */
    function routeYield() external onlyOwner {
        uint256 balance = address(this).balance;
        require(balance > 0, "DataSub: no revenue");

        (bool ok,) = address(rdt).call{value: balance}("");
        require(ok, "DataSub: yield routing failed");

        rdt.depositYield{value: balance}();
        subscriptionRevenue += balance;
        emit RevenueRouted(balance, block.timestamp);
    }

    // ─── View ────────────────────────────────────────────────────────
    function getSubscription(address user) external view returns (
        Tier tier, uint256 expiresAt, bool active
    ) {
        Subscription storage s = subscriptions[user];
        return (s.tier, s.expiresAt, s.active);
    }
}