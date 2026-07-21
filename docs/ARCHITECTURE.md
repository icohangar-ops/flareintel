# Architecture — FlareIntel

## System Overview

FlareIntel is a multi-layer system that brings off-chain geopolitical and financial risk data on-chain through Flare's native oracle and data connector protocols.

## Layers

### 1. Data Acquisition Layer (Off-Chain)

**WorldMonitor Adapter (`worldmonitor-adapter.py`)**
- Python service that extracts CII v8 sub-indices from WorldMonitor
- Computes Composite Institutional Intelligence (CII) scores
- Applies delta smoothing to prevent oracle manipulation
- Outputs normalized `scores.json` for the JS pipeline

**CII v8 Methodology:**
| Sub-Index | Range | Weight | Description |
|---|---|---|---|
| Political Stability (PSI) | 0–200 | 25% | Government stability, regime type, civil unrest |
| Economic Freedom (EFS) | 0–200 | 20% | Trade openness, fiscal policy, monetary stability |
| Financial Risk (FSR) | 0–200 | 20% | Banking sector health, debt levels, currency risk |
| Geopolitical Tension (GTI) | 0–200 | 20% | Conflicts, alliances, territorial disputes |
| Sanctions & Compliance (SCR) | 0–200 | 15% | International sanctions, AML compliance, regulatory |

**Final CII = (PSI×0.25 + EFS×0.20 + FSR×0.20 + GTI×0.20 + SCR×0.15) × 5**

### 2. Blockchain Oracle Layer (Flare Native)

**FTSOv2 Integration (`CIIOracleFeed` contract + `ftso-submitter.js`)**
- CII scores are submitted as FTSOv2 data feeds
- Each country gets a unique feed ID
- FTSOv2 provides decentralized consensus on submitted values
- Authorized submitters push data in epoch-aligned batches
- On-chain CII values are available to any DApp on Flare

**FDC Bridge (`fdc-bridge.js` + `CollateralManager`)**
- Geopolitical events (wars, sanctions, coups) are attested via FDC
- FDC provides cryptographically verified off-chain data to smart contracts
- High-severity events trigger collateral monitoring
- Attestations are stored on-chain for audit trail

### 3. Smart Contract Layer

| Contract | Role | Key Interactions |
|---|---|---|
| `RiskDataToken` | ERC-20 RDT with staking | Stakers earn yield from subscriptions |
| `CIIOracleFeed` | FTSOv2 CII submission | Receives scores, stores in FTSO feeds |
| `DataSubscription` | Tiered access control | Routes revenue to RDT yield pool |
| `CollateralManager` | FAsset collateral safety | Monitors positions, triggers alerts |

### 4. API Layer

**Express Server (`src/api/`)**
- REST API for frontend and third-party consumers
- Merges on-chain data with pipeline cache for low-latency reads
- Rate limiting and subscription checking
- Endpoints: `/api/risk/*`, `/api/subscription/*`

### 5. Presentation Layer

**React Dashboard (`src/dashboard/`)**
- Real-time country risk map
- CII score rankings table
- Risk alerts feed
- RDT token statistics
- Subscription tier information

## Data Flow

```
WorldMonitor API
       │
       ▼
worldmonitor-adapter.py  ──→  scores.json
       │
       ▼
ftso-submitter.js  ──→  CIIOracleFeed  ──→  FTSOv2 Protocol
                                              │
WorldMonitor Events  ──→  fdc-bridge.js  ──→  FDC Protocol
                                              │
                                        CollateralManager
                                              │
                                        Risk Alerts
                                              │
       ┌──────────────────────────────────────┘
       ▼
  Express API Server  ──→  React Dashboard
```

## Security Considerations

1. **Delta Smoothing**: CII scores cannot change by more than 100 points per epoch
2. **Authorized Submitters**: Only whitelisted addresses can submit to CIIOracleFeed
3. **Reentrancy Guards**: All contracts use OpenZeppelin's ReentrancyGuard
4. **Rate Limiting**: Subscription-based API access with per-hour limits
5. **FAsset Collateral**: Institutional positions backed by Flare FAssets
6. **Coston2 Testnet**: All development on testnet before mainnet deployment

## Flare-Specific Integrations

- **FTSOv2**: On-chain price/data feed protocol for CII score consensus
- **FDC**: Off-chain data attestation for geopolitical event verification
- **FAssets**: Trustless collateral backing using tokenized real-world assets
- **State Connector**: Flare's native proof system for cross-chain data verification