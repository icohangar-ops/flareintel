# Upstream Credit — WorldMonitor

## Overview

FlareIntel's data layer and scoring methodology are derived from **WorldMonitor**, an open-source geopolitical and financial intelligence platform.

## Original Project

- **Project Name**: WorldMonitor
- **Author**: Elie Habib
- **Repository**: https://github.com/koala73/worldmonitor
- **License**: GNU Affero General Public License v3.0 (AGPL-3.0)
- **Description**: WorldMonitor provides real-time geopolitical risk scoring, news monitoring, and financial intelligence data for countries worldwide. It implements a Composite Institutional Intelligence (CII) scoring methodology that combines multiple risk sub-indices into a single, actionable risk score.

## What Was Ported

### CII v8 Scoring Methodology
The CII (Composite Institutional Intelligence) scoring algorithm was ported from WorldMonitor's implementation. This includes:

1. **Five Sub-Indices** (each 0–200 scale):
   - **Political Stability Index (PSI)**: Measures government stability, regime type indicators, civil unrest frequency, and institutional strength.
   - **Economic Freedom Score (EFS)**: Evaluates trade openness, fiscal policy soundness, monetary stability, and economic growth trajectory.
   - **Financial System Risk (FSR)**: Assesses banking sector health, sovereign debt levels, currency stability, and capital flow risks.
   - **Geopolitical Tension Index (GTI)**: Tracks active conflicts, military posture, alliance dynamics, and territorial disputes.
   - **Sanctions & Compliance Risk (SCR)**: Monitors international sanctions programs, AML/KYC compliance gaps, and regulatory actions.

2. **Weighted Composition**:
   - CII = (PSI × 0.25 + EFS × 0.20 + FSR × 0.20 + GTI × 0.20 + SCR × 0.15) × 5
   - Final score range: 0 (safest) to 1000 (highest risk)

3. **Delta Smoothing**: Anti-manipulation mechanism that limits score changes to a maximum of 100 points per epoch.

### Data Model
- Country identification using ISO 3166-1 alpha-3 codes
- Risk label categorization (Very Low / Low / Moderate / Elevated / High / Critical)
- Timestamped score history for trend analysis

## What Was Newly Built for FlareIntel

The following components are original to FlareIntel and were not part of WorldMonitor:

### Smart Contracts (Solidity)
- **RiskDataToken (RDT)**: ERC-20 token with staking and yield distribution mechanics
- **CIIOracleFeed**: FTSOv2 integration for on-chain CII score submission and consensus
- **DataSubscription**: Tiered subscription management (Free/Basic/Premium/Institutional)
- **CollateralManager**: FAsset-backed collateral safety monitoring and risk alerting

### Flare-Specific Integrations
- FTSOv2 oracle feed submission protocol integration
- FDC (Flare Data Connector) event attestation bridge
- FAsset collateral management for institutional subscribers
- Coston2 testnet deployment and configuration

### Infrastructure
- Express REST API server with on-chain data aggregation
- React dashboard with real-time risk visualization
- Python-to-JS data pipeline bridge
- Hardhat-based development, testing, and deployment toolchain

## License Compliance

This project is licensed under **AGPL-3.0** to maintain compatibility with the upstream WorldMonitor project. Per the AGPL-3.0 license:

- The source code of this project, including all modifications and additions, is freely available
- Any network use of this software provides users with the ability to receive the complete source code
- Attribution to the original WorldMonitor project and its author (Elie Habib) is provided in this document and in the project README

## Attribution Notice

```
FlareIntel includes code and methodology derived from WorldMonitor.

WorldMonitor
Copyright (C) Elie Habib
GitHub: https://github.com/koala73/worldmonitor
License: GNU Affero General Public License v3.0

The CII v8 scoring methodology, sub-index definitions, and weighted
composition algorithm are adapted from WorldMonitor's implementation.
All modifications and new components are also licensed under AGPL-3.0.
```

## Contact

For questions about the upstream WorldMonitor project, please refer to:
- GitHub Issues: https://github.com/koala73/worldmonitor/issues

For questions about FlareIntel's use of WorldMonitor data:
- See this repository's issue tracker.