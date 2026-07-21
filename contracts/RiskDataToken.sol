// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.19;

/**
 * @title RiskDataToken
 * @notice ERC-20 token (RDT) used to access premium geopolitical & financial
 *         intelligence data on Flare. Holders can stake RDT to earn yield from
 *         subscription revenues. Unstaked tokens grant basic read access;
 *         staked tokens unlock real-time FTSOv2 CII feeds and FDC attestations.
 * @dev Built for the FlareIntel hackathon project on Flare Coston2.
 */

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

contract RiskDataToken is ERC20, ERC20Permit, Ownable, ReentrancyGuard {
    // ─── Constants ───────────────────────────────────────────────────
    uint256 public constant MAX_SUPPLY       = 100_000_000e18; // 100M RDT
    uint256 public constant MIN_STAKE_AMOUNT = 100e18;
    uint256 public constant UNSTAKE_LOCK     = 2 days;

    // ─── State ───────────────────────────────────────────────────────
    uint256 public totalStaked;
    uint256 public yieldPool;
    uint256 public lastYieldDistribution;
    uint256 public yieldRatePerSecond; // in RDT per staked-token per second (scaled 1e18)

    struct StakeInfo {
        uint256 amount;
        uint256 stakedAt;
        uint256 pendingYield;
    }

    mapping(address => StakeInfo) public stakes;
    address public dataSubscription;

    // ─── Events ──────────────────────────────────────────────────────
    event Staked(address indexed user, uint256 amount);
    event Unstaked(address indexed user, uint256 amount, uint256 reward);
    event YieldDeposited(address indexed from, uint256 amount);
    event YieldDistributed(uint256 totalDistributed, uint256 timestamp);

    // ─── Modifiers ───────────────────────────────────────────────────
    modifier onlySubscription() {
        require(msg.sender == dataSubscription, "RDT: caller is not DataSubscription");
        _;
    }

    // ─── Constructor ─────────────────────────────────────────────────
    constructor() ERC20("Risk Data Token", "RDT") ERC20Permit("Risk Data Token") {
        // Mint 20% to deployer for initial liquidity & team
        _mint(msg.sender, 20_000_000e18);
        lastYieldDistribution = block.timestamp;
    }

    // ─── Subscription integration ────────────────────────────────────
    /**
     * @notice Set the DataSubscription contract address (called once after deploy).
     */
    function setDataSubscription(address _sub) external onlyOwner {
        require(_sub != address(0), "RDT: zero address");
        dataSubscription = _sub;
    }

    /**
     * @notice Called by DataSubscription when a subscription is paid.
     *         Adds subscription revenue to the yield pool.
     */
    function depositYield() external payable onlySubscription {
        require(msg.value > 0, "RDT: zero yield");
        yieldPool += msg.value;
        emit YieldDeposited(msg.sender, msg.value);
    }

    /**
     * @notice Deposit FLR into yield pool from owner (e.g. FAsset rewards).
     */
    function depositYieldFromOwner() external payable onlyOwner {
        require(msg.value > 0, "RDT: zero yield");
        yieldPool += msg.value;
        emit YieldDeposited(msg.sender, msg.value);
    }

    // ─── Staking ─────────────────────────────────────────────────────
    /**
     * @notice Stake RDT tokens to earn a share of the yield pool.
     */
    function stake(uint256 amount) external nonReentrant {
        require(amount >= MIN_STAKE_AMOUNT, "RDT: below min stake");
        _distributeYield();

        StakeInfo storage s = stakes[msg.sender];
        s.amount += amount;
        s.pendingYield += _pendingYield(msg.sender);
        s.stakedAt = block.timestamp;
        totalStaked += amount;

        _transfer(msg.sender, address(this), amount);
        emit Staked(msg.sender, amount);
    }

    /**
     * @notice Unstake RDT tokens after the lock period.
     */
    function unstake(uint256 amount) external nonReentrant {
        StakeInfo storage s = stakes[msg.sender];
        require(s.amount >= amount, "RDT: insufficient stake");
        require(block.timestamp >= s.stakedAt + UNSTAKE_LOCK, "RDT: still locked");

        _distributeYield();
        uint256 reward = _pendingYield(msg.sender);

        s.amount -= amount;
        s.stakedAt = block.timestamp;
        s.pendingYield = 0;
        totalStaked -= amount;

        _transfer(address(this), msg.sender, amount);

        // Pay yield reward in FLR
        if (reward > 0 && reward <= yieldPool) {
            yieldPool -= reward;
            (bool ok,) = msg.sender.call{value: reward}("");
            require(ok, "RDT: yield transfer failed");
        }

        emit Unstaked(msg.sender, amount, reward);
    }

    /**
     * @notice Returns the staked balance and accrued yield for a user.
     */
    function getStakeInfo(address user) external view returns (uint256 staked, uint256 yield_) {
        StakeInfo storage s = stakes[user];
        staked = s.amount;
        yield_ = s.pendingYield + _pendingYield(user);
    }

    // ─── Internal ────────────────────────────────────────────────────
    function _pendingYield(address user) internal view returns (uint256) {
        StakeInfo storage s = stakes[user];
        if (totalStaked == 0 || s.amount == 0) return 0;
        uint256 elapsed = block.timestamp - lastYieldDistribution;
        return (s.amount * yieldRatePerSecond * elapsed) / 1e18;
    }

    function _distributeYield() internal {
        if (yieldPool == 0 || totalStaked == 0) {
            lastYieldDistribution = block.timestamp;
            return;
        }
        uint256 elapsed = block.timestamp - lastYieldDistribution;
        if (elapsed == 0) return;

        // Yield rate: total yield to distribute over staked tokens per second
        // Simplified: spread yieldPool evenly across a 30-day epoch
        yieldRatePerSecond = (yieldPool * 1e18) / (totalStaked * 30 days);
        lastYieldDistribution = block.timestamp;

        emit YieldDistributed(yieldPool, block.timestamp);
    }

    // ─── Rescue ──────────────────────────────────────────────────────
    function rescueERC20(address token, uint256 amount) external onlyOwner {
        IERC20(token).transfer(msg.sender, amount);
    }
}