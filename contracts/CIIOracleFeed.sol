// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.19;

/**
 * @title CIIOracleFeed
 * @notice Submits Composite Institutional Intelligence (CII) scores to Flare's
 *         FTSOv2 system. Each feed represents a country's geopolitical &
 *         financial risk on a 0-1000 scale (basis points of risk).
 * @dev Integrates with IFTSOv2Feed for on-chain data availability and uses
 *      Flare's native attestation mechanisms.
 */

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

interface IFTSOv2Submitter {
    function submitFeed(
        uint256 feedId,
        uint256 value,
        uint256 timestamp
    ) external;
}

interface IFTSOv2Feed {
    function getFeedValue(uint256 feedId) external view returns (uint256, uint256);
}

contract CIIOracleFeed is Ownable, ReentrancyGuard {
    // ─── Types ───────────────────────────────────────────────────────
    struct CountryFeed {
        uint256 feedId;           // FTSOv2 feed identifier
        string  countryCode;      // ISO 3166-1 alpha-3
        string  countryName;
        uint256 latestCII;        // latest submitted CII score (0-1000)
        uint256 lastUpdate;
        bool    active;
    }

    // ─── Constants ───────────────────────────────────────────────────
    uint256 public constant MAX_CII        = 1000;  // maximum risk score
    uint256 public constant MIN_CII        = 0;
    uint256 public constant FEED_DECIMALS  = 18;
    uint256 public constant MAX_SUBMITTERS = 20;

    // ─── State ───────────────────────────────────────────────────────
    IFTSOv2Submitter public ftsoSubmitter;
    IFTSOv2Feed     public ftsoFeed;

    mapping(bytes3 => CountryFeed) public countryFeeds;  // bytes3 = alpha-3 packed
    bytes3[] public countryCodes;
    mapping(address => bool) public authorizedSubmitters;

    uint256 public feedEpochSize = 120; // seconds per FTSO epoch

    // ─── Events ──────────────────────────────────────────────────────
    event FeedRegistered(bytes3 indexed countryCode, uint256 feedId, string countryName);
    event CIISubmitted(bytes3 indexed countryCode, uint256 ciiScore, uint256 timestamp);
    event SubmitterAuthorized(address indexed submitter);
    event SubmitterRevoked(address indexed submitter);

    // ─── Modifiers ───────────────────────────────────────────────────
    modifier onlySubmitter() {
        require(authorizedSubmitters[msg.sender], "CIIOracle: not authorized");
        _;
    }

    // ─── Constructor ─────────────────────────────────────────────────
    constructor(address _ftsoSubmitter, address _ftsoFeed) Ownable() {
        require(_ftsoSubmitter != address(0), "CIIOracle: zero submitter");
        ftsoSubmitter = IFTSOv2Submitter(_ftsoSubmitter);
        ftsoFeed     = IFTSOv2Feed(_ftsoFeed);
        authorizedSubmitters[msg.sender] = true;
    }

    // ─── Admin ───────────────────────────────────────────────────────
    function authorizeSubmitter(address _submitter) external onlyOwner {
        require(_submitter != address(0), "CIIOracle: zero address");
        authorizedSubmitters[_submitter] = true;
        emit SubmitterAuthorized(_submitter);
    }

    function revokeSubmitter(address _submitter) external onlyOwner {
        authorizedSubmitters[_submitter] = false;
        emit SubmitterRevoked(_submitter);
    }

    // ─── Feed Registration ───────────────────────────────────────────
    /**
     * @notice Register a new country CII feed with its FTSOv2 feed ID.
     * @param _code ISO 3166-1 alpha-3 country code (e.g. "USA", "CHN").
     * @param _feedId The FTSOv2 feed identifier for this country's CII.
     */
    function registerFeed(
        bytes3 _code,
        uint256 _feedId,
        string calldata _name
    ) external onlyOwner {
        require(_code != bytes3(0), "CIIOracle: empty code");
        require(!countryFeeds[_code].active, "CIIOracle: already registered");

        countryFeeds[_code] = CountryFeed({
            feedId: _feedId,
            countryCode: _code,
            countryName: _name,
            latestCII: 0,
            lastUpdate: 0,
            active: true
        });
        countryCodes.push(_code);
        emit FeedRegistered(_code, _feedId, _name);
    }

    // ─── Data Submission ─────────────────────────────────────────────
    /**
     * @notice Submit a CII score for a country. Validates the score is
     *         within bounds and forwards to the FTSOv2 submitter contract.
     * @param _code ISO 3166-1 alpha-3 country code.
     * @param _ciiScore Risk score from 0 (safest) to 1000 (highest risk).
     */
    function submitCII(bytes3 _code, uint256 _ciiScore) external onlySubmitter nonReentrant {
        CountryFeed storage feed = countryFeeds[_code];
        require(feed.active, "CIIOracle: feed not registered");
        require(_ciiScore >= MIN_CII && _ciiScore <= MAX_CII, "CIIOracle: score out of range");

        // Submit to FTSOv2 (value scaled to 18 decimals)
        uint256 scaledValue = _ciiScore * (10 ** FEED_DECIMALS);
        ftsoSubmitter.submitFeed(feed.feedId, scaledValue, block.timestamp);

        feed.latestCII = _ciiScore;
        feed.lastUpdate = block.timestamp;

        emit CIISubmitted(_code, _ciiScore, block.timestamp);
    }

    // ─── Batch Submission ────────────────────────────────────────────
    /**
     * @notice Submit CII scores for multiple countries in a single tx.
     * @param _codes Array of ISO alpha-3 country codes.
     * @param _scores Array of corresponding CII scores.
     */
    function submitBatchCII(
        bytes3[] calldata _codes,
        uint256[] calldata _scores
    ) external onlySubmitter nonReentrant {
        require(_codes.length == _scores.length, "CIIOracle: length mismatch");
        require(_codes.length <= 50, "CIIOracle: batch too large");

        for (uint256 i = 0; i < _codes.length; i++) {
            CountryFeed storage feed = countryFeeds[_codes[i]];
            if (!feed.active) continue;
            if (_scores[i] > MAX_CII) continue;

            uint256 scaledValue = _scores[i] * (10 ** FEED_DECIMALS);
            ftsoSubmitter.submitFeed(feed.feedId, scaledValue, block.timestamp);

            feed.latestCII = _scores[i];
            feed.lastUpdate = block.timestamp;
            emit CIISubmitted(_codes[i], _scores[i], block.timestamp);
        }
    }

    // ─── View ────────────────────────────────────────────────────────
    function getCountryCII(bytes3 _code) external view returns (
        uint256 feedId,
        uint256 ciiScore,
        uint256 lastUpdate,
        bool active
    ) {
        CountryFeed storage f = countryFeeds[_code];
        return (f.feedId, f.latestCII, f.lastUpdate, f.active);
    }

    function getFeedCount() external view returns (uint256) {
        return countryCodes.length;
    }

    function getAllCountryCodes() external view returns (bytes3[] memory) {
        return countryCodes;
    }
}