#!/usr/bin/env python3
"""
FlareIntel — WorldMonitor Data Adapter

This adapter extracts CII v8 (Composite Institutional Intelligence) scoring
data from the WorldMonitor system (github.com/koala73/worldmonitor) and
normalizes it for on-chain submission via the FTSO submitter.

WorldMonitor CII v8 Methodology (ported):
  The CII score is a 0-1000 composite index combining:
    - Political Stability Index (PSI): 0-200, weight 25%
    - Economic Freedom Score (EFS): 0-200, weight 20%
    - Financial System Risk (FSR): 0-200, weight 20%
    - Geopolitical Tension Index (GTI): 0-200, weight 20%
    - Sanctions & Compliance Risk (SCR): 0-200, weight 15%

  Total: CII = PSI*0.25 + EFS*0.20 + FSR*0.20 + GTI*0.20 + SCR*0.15

This adapter:
  1. Connects to the WorldMonitor data source (API or database)
  2. Extracts the 5 sub-indices for each country
  3. Computes the CII v8 composite score
  4. Applies delta smoothing to prevent oracle manipulation
  5. Writes normalized scores to scores.json for the JS submitter

Usage:
  python worldmonitor-adapter.py --source api --output ../data/scores.json
  python worldmonitor-adapter.py --source demo  # Generate demo data for testing
"""

import json
import argparse
import hashlib
import math
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

try:
    import requests
except ImportError:
    requests = None  # Fallback to demo mode


# ═══════════════════════════════════════════════════════════════════════
#  CII v8 Configuration
# ═══════════════════════════════════════════════════════════════════════

CII_V8_WEIGHTS = {
    "psi": 0.25,  # Political Stability Index
    "efs": 0.20,  # Economic Freedom Score
    "fsr": 0.20,  # Financial System Risk
    "gti": 0.20,  # Geopolitical Tension Index
    "scr": 0.15,  # Sanctions & Compliance Risk
}

# Maximum allowed delta per epoch (prevents sudden score changes)
MAX_DELTA_PER_EPOCH = 100

# ISO 3166-1 alpha-3 country codes included in the CII feed
DEFAULT_COUNTRIES = [
    "USA", "CHN", "RUS", "GBR", "DEU", "JPN", "IND", "BRA",
    "ZAF", "KOR", "TUR", "SAU", "NGA", "ARG", "IDN", "MEX",
    "EGY", "UKR", "IRN", "VNZ", "PAK", "THA", "PHL", "COL",
    "POL", "CHE", "SWE", "NOR", "CAN", "AUS", "NZL", "SGP",
    "MYS", "CHL", "PER", "CZE", "ROU", "ISR", "ARE", "QAT",
]


# ═══════════════════════════════════════════════════════════════════════
#  CII v8 Scoring Engine (ported from WorldMonitor)
# ═══════════════════════════════════════════════════════════════════════

def compute_cii_v8(sub_indices: dict) -> float:
    """
    Compute the Composite Institutional Intelligence (CII) v8 score.

    Each sub-index is on a 0-200 scale. The CII composite is on a 0-1000 scale.

    Higher CII = Higher risk.
    Lower CII = Lower risk (safer).

    Args:
        sub_indices: Dict with keys 'psi', 'efs', 'fsr', 'gti', 'scr', each 0-200.

    Returns:
        CII score as float, range 0-1000.
    """
    total = 0.0
    for key, weight in CII_V8_WEIGHTS.items():
        value = sub_indices.get(key, 0)
        # Clamp to valid range
        value = max(0, min(200, value))
        total += value * weight

    # Scale from weighted sub-indices (max 200) to 0-1000 range
    cii = total * 5.0  # 200 * 5 = 1000
    return round(cii, 2)


def apply_delta_smoothing(new_score: float, prev_score: Optional[float]) -> float:
    """
    Apply delta smoothing to prevent oracle manipulation.
    If the change exceeds MAX_DELTA_PER_EPOCH, cap the movement.
    """
    if prev_score is None:
        return new_score

    delta = new_score - prev_score
    if abs(delta) > MAX_DELTA_PER_EPOCH:
        sign = 1 if delta > 0 else -1
        new_score = prev_score + (sign * MAX_DELTA_PER_EPOCH)

    return round(new_score, 2)


def generate_risk_label(cii: float) -> str:
    """Map CII score to a human-readable risk label."""
    if cii < 200:
        return "Very Low"
    elif cii < 350:
        return "Low"
    elif cii < 500:
        return "Moderate"
    elif cii < 650:
        return "Elevated"
    elif cii < 800:
        return "High"
    else:
        return "Critical"


# ═══════════════════════════════════════════════════════════════════════
#  Data Sources
# ═══════════════════════════════════════════════════════════════════════

def fetch_from_worldmonitor_api(base_url: str, api_key: Optional[str] = None) -> list:
    """
    Fetch country risk data from the WorldMonitor API.
    Expects the endpoint to return CII sub-indices per country.
    """
    if requests is None:
        print("[WARN] 'requests' not installed. Install with: pip install requests")
        return []

    headers = {"Accept": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    try:
        resp = requests.get(
            f"{base_url}/api/v1/cii/raw",
            headers=headers,
            timeout=30,
        )
        resp.raise_for_status()
        data = resp.json()
        return data.get("countries", [])
    except requests.RequestException as e:
        print(f"[ERROR] WorldMonitor API fetch failed: {e}")
        return []


def generate_demo_data(countries: list = None) -> list:
    """
    Generate realistic demo CII scores for testing.
    Uses deterministic seeding based on country code for consistency.
    """
    countries = countries or DEFAULT_COUNTRIES
    scores = []
    timestamp = int(time.time())

    # Seed-like deterministic values based on country code hash
    for code in countries:
        h = int(hashlib.sha256(code.encode()).hexdigest()[:8], 16)

        # Generate plausible sub-indices
        psi = (h % 180) + 10        # Political Stability: 10-190
        efs = ((h >> 8) % 160) + 20  # Economic Freedom: 20-180
        fsr = ((h >> 16) % 170) + 15 # Financial Risk: 15-185
        gti = ((h >> 24) % 150) + 25 # Geopolitical Tension: 25-175
        scr = ((h >> 4) % 130) + 10  # Sanctions Risk: 10-140

        sub_indices = {
            "psi": psi,
            "efs": efs,
            "fsr": fsr,
            "gti": gti,
            "scr": scr,
        }

        cii = compute_cii_v8(sub_indices)

        scores.append({
            "countryCode": code,
            "ciiScore": int(round(cii)),
            "subIndices": sub_indices,
            "riskLabel": generate_risk_label(cii),
            "timestamp": timestamp,
            "source": "worldmonitor-v8-demo",
        })

    return scores


# ═══════════════════════════════════════════════════════════════════════
#  Main Adapter Logic
# ═══════════════════════════════════════════════════════════════════════

def load_previous_scores(filepath: str) -> dict:
    """Load previous scores for delta smoothing."""
    if not os.path.exists(filepath):
        return {}
    try:
        with open(filepath, "r") as f:
            data = json.load(f)
            return {s["countryCode"]: s["ciiScore"] for s in data.get("scores", [])}
    except (json.JSONDecodeError, IOError):
        return {}


def run_adapter(source: str, output_path: str, api_url: Optional[str], api_key: Optional[str]):
    """
    Main adapter entry point.

    1. Fetch data from the configured source
    2. Compute CII v8 scores
    3. Apply delta smoothing
    4. Write to output file
    """
    print(f"[{datetime.now(timezone.utc).isoformat()}] FlareIntel WorldMonitor Adapter v0.1.0")
    print(f"  Source:  {source}")
    print(f"  Output:  {output_path}")
    print()

    # Fetch raw data
    if source == "demo":
        raw_countries = generate_demo_data()
    elif source == "api":
        if not api_url:
            print("[ERROR] --api-url required when source is 'api'")
            sys.exit(1)
        raw_countries = fetch_from_worldmonitor_api(api_url, api_key)
    else:
        print(f"[ERROR] Unknown source: {source}")
        sys.exit(1)

    if not raw_countries:
        print("[WARN] No data received. Generating demo data as fallback.")
        raw_countries = generate_demo_data()

    # Load previous scores for delta smoothing
    prev_scores = load_previous_scores(output_path)

    # Process each country
    processed = []
    for country in raw_countries:
        code = country.get("countryCode") or country.get("code", "UNK")

        # If data already has CII, use it; otherwise compute
        if "ciiScore" in country and isinstance(country["ciiScore"], (int, float)):
            raw_cii = float(country["ciiScore"])
        elif "subIndices" in country:
            raw_cii = compute_cii_v8(country["subIndices"])
        else:
            # Extract sub-indices from flat fields
            sub = {
                "psi": country.get("psi", country.get("politicalStability", 100)),
                "efs": country.get("efs", country.get("economicFreedom", 100)),
                "fsr": country.get("fsr", country.get("financialRisk", 100)),
                "gti": country.get("gti", country.get("geopoliticalTension", 100)),
                "scr": country.get("scr", country.get("sanctionsRisk", 100)),
            }
            raw_cii = compute_cii_v8(sub)

        # Apply delta smoothing
        prev = prev_scores.get(code)
        smoothed = apply_delta_smoothing(raw_cii, prev)

        processed.append({
            "countryCode": code,
            "ciiScore": int(round(smoothed)),
            "rawCII": round(raw_cii, 2),
            "subIndices": country.get("subIndices", {}),
            "riskLabel": generate_risk_label(smoothed),
            "timestamp": int(time.time()),
            "source": "worldmonitor-cii-v8",
            "version": "8.0",
        })

    # Write output
    output = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "version": "8.0",
        "methodology": "CII v8 — Composite Institutional Intelligence",
        "countries": len(processed),
        "scores": processed,
    }

    # Ensure output directory exists
    os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)

    with open(output_path, "w") as f:
        json.dump(output, f, indent=2)

    print(f"  Wrote {len(processed)} CII scores to {output_path}")
    print()
    print("  Top 5 Riskiest Countries:")
    sorted_scores = sorted(processed, key=lambda x: x["ciiScore"], reverse=True)
    for s in sorted_scores[:5]:
        print(f"    {s['countryCode']:3s}  CII: {s['ciiScore']:4d}/1000  {s['riskLabel']}")
    print()
    print("  Top 5 Safest Countries:")
    for s in sorted_scores[-5:]:
        print(f"    {s['countryCode']:3s}  CII: {s['ciiScore']:4d}/1000  {s['riskLabel']}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="FlareIntel WorldMonitor CII v8 Adapter")
    parser.add_argument(
        "--source",
        choices=["demo", "api"],
        default="demo",
        help="Data source: 'demo' for synthetic, 'api' for WorldMonitor API",
    )
    parser.add_argument(
        "--output",
        default=os.path.join(os.path.dirname(__file__), "..", "..", "data", "scores.json"),
        help="Output JSON file path",
    )
    parser.add_argument("--api-url", default=None, help="WorldMonitor API base URL")
    parser.add_argument("--api-key", default=None, help="WorldMonitor API key")

    args = parser.parse_args()
    run_adapter(args.source, args.output, args.api_url, args.api_key)