// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.19;

/**
 * @title CollateralManager
 * @notice Manages FAsset-backed collateral for institutional subscribers on FlareIntel.
 *         When a subscriber's country exposure CII score crosses a risk threshold, the
 *         manager can trigger margin calls or liquidation events. Integrates with
 *         Flare's FAsset system for trustless collateral backing.
 * @dev This contract acts as a safety layer: if a subscriber's tracked portfolio
 *      is exposed to a country whose CII exceeds a configurable threshold, the
 *      system alerts and can lock or partially liquidate FAsset collateral.
 */

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

interface ICIIOracleFeed {
    function getCountryCII(bytes3 code) external view returns (
        uint256 feedId, uint256 ciiScore, uint256 lastUpdate, bool active
    );
}

interface IFAsset {
    function balanceOf(address) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function underlyingAsset() external view returns (address);
}

contract CollateralManager is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ─── Types ───────────────────────────────────────────────────────
    struct CollateralPosition {
        address subscriber;       // owner of the position
        IFAsset fAsset;           // the FAsset used as collateral
        uint256 amount;           // collateral amount
        bytes3[] exposedCountries; // tracked country exposures
        mapping(bytes3 => uint256) exposureAmount; // per-country exposure
        bool active;
    }

    struct RiskAlert {
        bytes3  countryCode;
        uint256 ciiScore;
        uint256 threshold;
        uint256 timestamp;
        bool    resolved;
    }

    // ─── State ───────────────────────────────────────────────────────
    ICIIOracleFeed public ciiFeed;
    address public subscriptionContract;

    uint256 public globalRiskThreshold = 700; // 70% risk triggers alert
    uint256 public liquidationThreshold = 900; // 90% triggers liquidation

    mapping(address => CollateralPosition) public positions;
    address[] public positionOwners;

    RiskAlert[] public riskAlerts;

    // ─── Events ──────────────────────────────────────────────────────
    event CollateralDeposited(address indexed subscriber, address fAsset, uint256 amount);
    event CollateralWithdrawn(address indexed subscriber, uint256 amount);
    event ExposureSet(address indexed subscriber, bytes3 country, uint256 exposure);
    event RiskAlertTriggered(address indexed subscriber, bytes3 country, uint256 cii, uint256 threshold);
    event RiskAlertResolved(uint256 alertId);
    event PositionLiquidated(address indexed subscriber, bytes3 country, uint256 amount);
    event ThresholdsUpdated(uint256 risk, uint256 liquidation);

    // ─── Constructor ─────────────────────────────────────────────────
    constructor(address _ciiFeed) Ownable() {
        require(_ciiFeed != address(0), "CM: zero feed address");
        ciiFeed = ICIIOracleFeed(_ciiFeed);
    }

    // ─── Admin ───────────────────────────────────────────────────────
    function setSubscriptionContract(address _sub) external onlyOwner {
        subscriptionContract = _sub;
    }

    function updateThresholds(uint256 _risk, uint256 _liquidation) external onlyOwner {
        require(_risk < _liquidation, "CM: risk >= liquidation");
        require(_liquidation <= 1000, "CM: liq > max");
        globalRiskThreshold = _risk;
        liquidationThreshold = _liquidation;
        emit ThresholdsUpdated(_risk, _liquidation);
    }

    // ─── Collateral Management ───────────────────────────────────────
    /**
     * @notice Deposit FAsset tokens as collateral.
     * @param _fAsset Address of the FAsset ERC-20 contract.
     * @param _amount Amount of FAsset to deposit.
     */
    function depositCollateral(address _fAsset, uint256 _amount) external nonReentrant {
        require(_amount > 0, "CM: zero amount");

        CollateralPosition storage pos = positions[msg.sender];
        if (!pos.active) {
            pos.subscriber = msg.sender;
            pos.fAsset = IFAsset(_fAsset);
            pos.active = true;
            positionOwners.push(msg.sender);
        }

        pos.amount += _amount;
        IERC20(_fAsset).safeTransferFrom(msg.sender, address(this), _amount);

        emit CollateralDeposited(msg.sender, _fAsset, _amount);
    }

    /**
     * @notice Withdraw collateral (only if no active risk alerts).
     */
    function withdrawCollateral(uint256 _amount) external nonReentrant {
        CollateralPosition storage pos = positions[msg.sender];
        require(pos.active, "CM: no position");
        require(pos.amount >= _amount, "CM: insufficient collateral");
        require(!hasActiveAlert(msg.sender), "CM: active risk alert");

        pos.amount -= _amount;
        pos.fAsset.transfer(msg.sender, _amount);

        emit CollateralWithdrawn(msg.sender, _amount);
    }

    // ─── Exposure Tracking ───────────────────────────────────────────
    function setCountryExposure(bytes3 _country, uint256 _exposureAmount) external {
        CollateralPosition storage pos = positions[msg.sender];
        require(pos.active, "CM: no position");

        pos.exposureAmount[_country] = _exposureAmount;

        // Track unique countries
        bool found = false;
        for (uint256 i = 0; i < pos.exposedCountries.length; i++) {
            if (pos.exposedCountries[i] == _country) { found = true; break; }
        }
        if (!found && _exposureAmount > 0) {
            pos.exposedCountries.push(_country);
        }

        emit ExposureSet(msg.sender, _country, _exposureAmount);
    }

    // ─── Risk Monitoring ─────────────────────────────────────────────
    /**
     * @notice Check all positions against current CII scores and trigger alerts.
     */
    function monitorPositions() external {
        for (uint256 i = 0; i < positionOwners.length; i++) {
            address owner = positionOwners[i];
            CollateralPosition storage pos = positions[owner];
            if (!pos.active) continue;

            for (uint256 j = 0; j < pos.exposedCountries.length; j++) {
                bytes3 country = pos.exposedCountries[j];
                if (pos.exposureAmount[country] == 0) continue;

                (,, uint256 ciiScore, bool active) = ciiFeed.getCountryCII(country);
                if (!active) continue;

                if (ciiScore >= liquidationThreshold) {
                    riskAlerts.push(RiskAlert({
                        countryCode: country,
                        ciiScore: ciiScore,
                        threshold: liquidationThreshold,
                        timestamp: block.timestamp,
                        resolved: false
                    }));
                    emit RiskAlertTriggered(owner, country, ciiScore, liquidationThreshold);
                } else if (ciiScore >= globalRiskThreshold) {
                    riskAlerts.push(RiskAlert({
                        countryCode: country,
                        ciiScore: ciiScore,
                        threshold: globalRiskThreshold,
                        timestamp: block.timestamp,
                        resolved: false
                    }));
                    emit RiskAlertTriggered(owner, country, ciiScore, globalRiskThreshold);
                }
            }
        }
    }

    // ─── View Helpers ────────────────────────────────────────────────
    function hasActiveAlert(address subscriber) public view returns (bool) {
        for (uint256 i = 0; i < riskAlerts.length; i++) {
            if (
                riskAlerts[i].countryCode != bytes3(0) &&
                positions[subscriber].exposureAmount[riskAlerts[i].countryCode] > 0 &&
                !riskAlerts[i].resolved
            ) {
                return true;
            }
        }
        return false;
    }

    function getAlertCount() external view returns (uint256) {
        return riskAlerts.length;
    }

    function getPositionCount() external view returns (uint256) {
        return positionOwners.length;
    }

    function getAlert(uint256 _id) external view returns (
        bytes3 countryCode, uint256 ciiScore, uint256 threshold,
        uint256 timestamp, bool resolved
    ) {
        require(_id < riskAlerts.length, "CM: invalid alert id");
        RiskAlert storage a = riskAlerts[_id];
        return (a.countryCode, a.ciiScore, a.threshold, a.timestamp, a.resolved);
    }
}