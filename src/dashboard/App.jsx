/**
 * FlareIntel Dashboard — Main App Component
 *
 * A React dashboard showing:
 *  - World map with country risk coloring (placeholder)
 *  - Top risk countries table
 *  - RDT token info panel
 *  - Recent alerts feed
 *  - Subscription tier info
 */

const { useState, useEffect, useCallback } = React;

// ─── API Base ───────────────────────────────────────────────────────
const API = window.location.origin.replace(/\/dashboard\/?$/, "") + "/api";

// ─── Components ─────────────────────────────────────────────────────

function Header() {
  return (
    <header style={{
      background: "linear-gradient(135deg, #0f172a 0%, #1e293b 100%)",
      borderBottom: "1px solid #334155",
      padding: "16px 32px",
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span style={{ fontSize: 28 }}>🌍</span>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: "#f8fafc", lineHeight: 1.2 }}>
            FlareIntel
          </h1>
          <p style={{ fontSize: 11, color: "#94a3b8", letterSpacing: "0.5px" }}>
            ON-CHAIN GEOPOLITICAL &amp; FINANCIAL INTELLIGENCE
          </p>
        </div>
      </div>
      <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
        <span style={{
          background: "#ff6b35", color: "#fff", padding: "4px 12px", borderRadius: 12,
          fontSize: 11, fontWeight: 600,
        }}>
          Flare Coston2
        </span>
        <span style={{
          background: "#1e293b", color: "#94a3b8", padding: "4px 12px", borderRadius: 12,
          fontSize: 11, border: "1px solid #334155",
        }}>
          {new Date().toLocaleDateString()}
        </span>
      </div>
    </header>
  );
}

function StatCard({ label, value, sub, color }) {
  return (
    <div style={{
      background: "#1e293b", borderRadius: 12, padding: 20,
      border: "1px solid #334155",
    }}>
      <p style={{ fontSize: 12, color: "#94a3b8", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.5px" }}>
        {label}
      </p>
      <p style={{ fontSize: 28, fontWeight: 700, color: color || "#f8fafc" }}>
        {value || "—"}
      </p>
      {sub && <p style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>{sub}</p>}
    </div>
  );
}

function WorldMapPlaceholder() {
  // Simple SVG world map placeholder with colored regions
  return (
    <div style={{
      background: "#1e293b", borderRadius: 12, padding: 24,
      border: "1px solid #334155", position: "relative", overflow: "hidden",
    }}>
      <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16, color: "#f8fafc" }}>
        🗺️ Global Risk Map
      </h2>
      <svg viewBox="0 0 1000 500" style={{ width: "100%", opacity: 0.6 }}>
        {/* Simplified continent outlines as placeholders */}
        <rect x="50" y="80" width="180" height="150" rx="20" fill="#334155" opacity="0.5" />
        <text x="140" y="160" textAnchor="middle" fill="#94a3b8" fontSize="14">Americas</text>

        <rect x="350" y="60" width="120" height="200" rx="20" fill="#334155" opacity="0.5" />
        <text x="410" y="165" textAnchor="middle" fill="#94a3b8" fontSize="14">Europe</text>

        <rect x="520" y="80" width="180" height="170" rx="20" fill="#334155" opacity="0.5" />
        <text x="610" y="170" textAnchor="middle" fill="#94a3b8" fontSize="14">Asia</text>

        <rect x="680" y="300" width="120" height="120" rx="20" fill="#334155" opacity="0.5" />
        <text x="740" y="365" textAnchor="middle" fill="#94a3b8" fontSize="14">Oceania</text>

        <rect x="350" y="280" width="150" height="130" rx="20" fill="#334155" opacity="0.5" />
        <text x="425" y="350" textAnchor="middle" fill="#94a3b8" fontSize="14">Africa</text>

        {/* Sample risk indicators */}
        <circle cx="380" cy="100" r="8" fill="#ef4444" opacity="0.8">
          <animate attributeName="opacity" values="0.4;1;0.4" dur="2s" repeatCount="indefinite" />
        </circle>
        <circle cx="620" cy="120" r="8" fill="#f97316" opacity="0.8">
          <animate attributeName="opacity" values="0.4;1;0.4" dur="2.5s" repeatCount="indefinite" />
        </circle>
        <circle cx="100" cy="110" r="8" fill="#eab308" opacity="0.8">
          <animate attributeName="opacity" values="0.4;1;0.4" dur="3s" repeatCount="indefinite" />
        </circle>
        <circle cx="400" cy="90" r="6" fill="#22c55e" opacity="0.8">
          <animate attributeName="opacity" values="0.4;1;0.4" dur="1.8s" repeatCount="indefinite" />
        </circle>
      </svg>
      <p style={{ fontSize: 11, color: "#64748b", textAlign: "center", marginTop: 8 }}>
        Interactive map — CII scores color-coded by risk level
      </p>
    </div>
  );
}

function CountryTable({ countries, loading }) {
  return (
    <div style={{
      background: "#1e293b", borderRadius: 12, padding: 24,
      border: "1px solid #334155",
    }}>
      <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16, color: "#f8fafc" }}>
        📊 Country Risk Rankings
      </h2>
      {loading ? (
        <p style={{ color: "#64748b", textAlign: "center", padding: 40 }}>Loading risk data...</p>
      ) : countries.length === 0 ? (
        <p style={{ color: "#64748b", textAlign: "center", padding: 40 }}>
          No data. Run the pipeline: <code>python src/pipeline/worldmonitor-adapter.py</code>
        </p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid #334155" }}>
              {["#", "Country", "CII Score", "Risk Level", "Status"].map((h) => (
                <th key={h} style={{
                  padding: "10px 12px", textAlign: "left", fontSize: 11,
                  color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.5px",
                }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {countries.slice(0, 15).map((c, i) => (
              <tr key={c.countryCode} style={{ borderBottom: "1px solid #1a2332" }}>
                <td style={{ padding: "10px 12px", color: "#64748b", fontSize: 13 }}>{i + 1}</td>
                <td style={{ padding: "10px 12px", fontWeight: 600, fontSize: 14 }}>{c.countryCode}</td>
                <td style={{ padding: "10px 12px", fontSize: 14 }}>
                  <span style={{ color: c.riskColor || "#e2e8f0", fontWeight: 700 }}>
                    {c.ciiScore}/1000
                  </span>
                </td>
                <td style={{ padding: "10px 12px" }}>
                  <span style={{
                    background: (c.riskColor || "#334155") + "22",
                    color: c.riskColor || "#94a3b8",
                    padding: "3px 10px", borderRadius: 8, fontSize: 12, fontWeight: 500,
                  }}>
                    {c.riskLabel || "Unknown"}
                  </span>
                </td>
                <td style={{ padding: "10px 12px" }}>
                  <span style={{
                    width: 8, height: 8, borderRadius: "50%", display: "inline-block",
                    background: c.source === "on-chain" ? "#22c55e" : "#eab308",
                    marginRight: 6,
                  }} />
                  <span style={{ fontSize: 12, color: "#94a3b8" }}>{c.source || "cached"}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function AlertsPanel({ alerts }) {
  return (
    <div style={{
      background: "#1e293b", borderRadius: 12, padding: 24,
      border: "1px solid #334155",
    }}>
      <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16, color: "#f8fafc" }}>
        🚨 Risk Alerts
      </h2>
      {alerts.length === 0 ? (
        <p style={{ color: "#64748b", fontSize: 13 }}>
          No active alerts. CollateralManager monitoring is active.
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {alerts.map((a, i) => (
            <div key={i} style={{
              background: "#0f172a", borderRadius: 8, padding: 12,
              borderLeft: "3px solid #ef4444",
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontWeight: 600, fontSize: 14 }}>{a.countryCode}</span>
                <span style={{ fontSize: 12, color: "#ef4444", fontWeight: 600 }}>
                  CII {a.ciiScore}/1000
                </span>
              </div>
              <p style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>
                Threshold: {a.threshold} · {new Date(a.timestamp * 1000).toLocaleString()}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main App ───────────────────────────────────────────────────────
export default function App() {
  const [countries, setCountries] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [tokenInfo, setTokenInfo] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const [countriesRes, alertsRes, tokenRes] = await Promise.all([
        fetch(`${API}/risk/countries`).then((r) => r.json()),
        fetch(`${API}/risk/alerts`).then((r) => r.json()),
        fetch(`${API}/risk/token`).then((r) => r.json()),
      ]);

      setCountries(countriesRes.countries || []);
      setAlerts(alertsRes.alerts || []);
      setTokenInfo(tokenRes);
    } catch (err) {
      console.error("Failed to fetch data:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 60_000); // Refresh every minute
    return () => clearInterval(interval);
  }, [fetchData]);

  const avgCII = countries.length > 0
    ? Math.round(countries.reduce((sum, c) => sum + c.ciiScore, 0) / countries.length)
    : 0;

  return (
    <div style={{ minHeight: "100vh", background: "#0a0e1a" }}>
      <Header />

      <main style={{ maxWidth: 1400, margin: "0 auto", padding: "24px 32px" }}>
        {/* Stats Row */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16, marginBottom: 24 }}>
          <StatCard label="Countries Tracked" value={countries.length} sub="with active CII feeds" color="#f8fafc" />
          <StatCard label="Avg. Global CII" value={avgCII} sub="out of 1000" color={avgCII > 500 ? "#f97316" : "#22c55e"} />
          <StatCard label="RDT Total Staked" value={tokenInfo?.totalStaked || "—"} sub={tokenInfo?.address ? "Risk Data Token" : "Not deployed"} color="#ff6b35" />
          <StatCard label="Active Alerts" value={alerts.length} sub="CollateralManager" color={alerts.length > 0 ? "#ef4444" : "#22c55e"} />
        </div>

        {/* Map + Table Row */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, marginBottom: 24 }}>
          <WorldMapPlaceholder />
          <CountryTable countries={countries} loading={loading} />
        </div>

        {/* Alerts Row */}
        <AlertsPanel alerts={alerts} />

        {/* Footer */}
        <footer style={{
          textAlign: "center", padding: "40px 0 24px", color: "#475569", fontSize: 12,
        }}>
          <p>FlareIntel — Flare Blockchain Hackathon Project</p>
          <p style={{ marginTop: 4 }}>
            Built on Flare · Powered by FTSOv2 &amp; FDC · Data: WorldMonitor CII v8
          </p>
        </footer>
      </main>
    </div>
  );
}