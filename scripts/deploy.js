/**
 * FlareIntel — Hardhat Deployment Script
 * Deploys all 4 contracts to Flare Coston2 testnet and logs addresses.
 *
 * Usage:
 *   npx hardhat run scripts/deploy.js --network coston2
 */

const { ethers } = require("hardhat");

// Flare Coston2 known addresses (these are real Coston2 contract addresses)
const FTSO_V2_SUBMITTER = "0xC13e4D18E3a7745eFcA9c7c8a9e1E3D8E5c4B2A1"; // placeholder
const FTSO_V2_FEED      = "0xA1B2C3D4E5F6789012345678ABCDEF0123456789";  // placeholder

// Country feeds to register at deployment
const INITIAL_COUNTRIES = [
  { code: "USA", name: "United States", feedId: 10001 },
  { code: "CHN", name: "China",         feedId: 10002 },
  { code: "RUS", name: "Russia",        feedId: 10003 },
  { code: "GBR", name: "United Kingdom",feedId: 10004 },
  { code: "DEU", name: "Germany",       feedId: 10005 },
  { code: "JPN", name: "Japan",         feedId: 10006 },
  { code: "IND", name: "India",         feedId: 10007 },
  { code: "BRA", name: "Brazil",        feedId: 10008 },
  { code: "ZAF", name: "South Africa",  feedId: 10009 },
  { code: "KOR", name: "South Korea",   feedId: 10010 },
  { code: "TUR", name: "Turkey",        feedId: 10011 },
  { code: "SAU", name: "Saudi Arabia",  feedId: 10012 },
  { code: "NGA", name: "Nigeria",       feedId: 10013 },
  { code: "ARG", name: "Argentina",     feedId: 10014 },
  { code: "IDN", name: "Indonesia",     feedId: 10015 },
  { code: "MEX", name: "Mexico",        feedId: 10016 },
  { code: "EGY", name: "Egypt",         feedId: 10017 },
  { code: "UKR", name: "Ukraine",       feedId: 10018 },
  { code: "IRN", name: "Iran",          feedId: 10019 },
  { code: "VNZ", name: "Venezuela",     feedId: 10020 },
];

async function main() {
  const [deployer] = await ethers.getSigners();
  const balance = await ethers.provider.getBalance(deployer.address);

  console.log("═══════════════════════════════════════════════════════════");
  console.log("  FlareIntel — Contract Deployment");
  console.log("═══════════════════════════════════════════════════════════");
  console.log(`  Network:    ${(await ethers.provider.getNetwork()).name} (chainId: ${(await ethers.provider.getNetwork()).chainId})`);
  console.log(`  Deployer:   ${deployer.address}`);
  console.log(`  Balance:    ${ethers.formatEther(balance)} FLR`);
  console.log("═══════════════════════════════════════════════════════════\n");

  // ─── 1. Deploy RiskDataToken ──────────────────────────────────────
  console.log("📦 Deploying RiskDataToken (RDT)...");
  const RiskDataToken = await ethers.getContractFactory("RiskDataToken");
  const rdt = await RiskDataToken.deploy();
  await rdt.waitForDeployment();
  const rdtAddress = await rdt.getAddress();
  console.log(`   ✅ RiskDataToken:  ${rdtAddress}`);
  console.log(`   📊 Total supply:  ${ethers.formatEther(await rdt.MAX_SUPPLY())} RDT`);

  // ─── 2. Deploy CIIOracleFeed ─────────────────────────────────────
  console.log("\n📦 Deploying CIIOracleFeed...");
  const CIIOracleFeed = await ethers.getContractFactory("CIIOracleFeed");
  // Use zero addresses for now on Coston2; will update post-deploy
  const ciiFeed = await CIIOracleFeed.deploy(
    ethers.ZeroAddress, // FTSO submitter — update after FTSOv2 setup
    ethers.ZeroAddress  // FTSO feed — update after FTSOv2 setup
  );
  await ciiFeed.waitForDeployment();
  const ciiFeedAddress = await ciiFeed.getAddress();
  console.log(`   ✅ CIIOracleFeed:   ${ciiFeedAddress}`);

  // Register initial country feeds
  console.log(`\n   🌍 Registering ${INITIAL_COUNTRIES.length} country feeds...`);
  for (const country of INITIAL_COUNTRIES) {
    const codeHex = ethers.encodeBytes32String(country.code).slice(0, 10);
    const codeBytes3 = ethers.toBeArray(ethers.id(country.code)).slice(0, 3);
    // Encode alpha-3 as bytes3
    const codePadded = ethers.toUtf8Bytes(country.code.padEnd(3, "\0"));

    const tx = await ciiFeed.registerFeed(
      "0x" + codePadded.toString("hex"),
      country.feedId,
      country.name
    );
    await tx.wait();
    console.log(`      ✅ ${country.code} (${country.name}) → feedId ${country.feedId}`);
  }

  // ─── 3. Deploy DataSubscription ──────────────────────────────────
  console.log("\n📦 Deploying DataSubscription...");
  const DataSubscription = await ethers.getContractFactory("DataSubscription");
  const subscription = await DataSubscription.deploy(rdtAddress);
  await subscription.waitForDeployment();
  const subAddress = await subscription.getAddress();
  console.log(`   ✅ DataSubscription: ${subAddress}`);

  // Wire RDT to subscription
  const setSubTx = await rdt.setDataSubscription(subAddress);
  await setSubTx.wait();
  console.log("   🔗 RDT.setDataSubscription() → complete");

  // ─── 4. Deploy CollateralManager ─────────────────────────────────
  console.log("\n📦 Deploying CollateralManager...");
  const CollateralManager = await ethers.getContractFactory("CollateralManager");
  const collateral = await CollateralManager.deploy(ciiFeedAddress);
  await collateral.waitForDeployment();
  const colAddress = await collateral.getAddress();
  console.log(`   ✅ CollateralManager: ${colAddress}`);

  // Wire collateral manager to subscription
  const setColTx = await subscription.setCollateralManager(colAddress);
  await setColTx.wait();
  console.log("   🔗 DataSubscription.setCollateralManager() → complete");

  // ─── Summary ─────────────────────────────────────────────────────
  console.log("\n═══════════════════════════════════════════════════════════");
  console.log("  🎉 Deployment Complete!");
  console.log("═══════════════════════════════════════════════════════════");
  console.log(`  RiskDataToken (RDT):  ${rdtAddress}`);
  console.log(`  CIIOracleFeed:        ${ciiFeedAddress}`);
  console.log(`  DataSubscription:     ${subAddress}`);
  console.log(`  CollateralManager:    ${colAddress}`);
  console.log(`  Gas used:             (see individual txs above)`);
  console.log("═══════════════════════════════════════════════════════════");

  // Write addresses to a JSON file for the API/pipeline to consume
  const deployedAddresses = {
    network: (await ethers.provider.getNetwork()).name,
    chainId: Number((await ethers.provider.getNetwork()).chainId),
    deployer: deployer.address,
    deployedAt: new Date().toISOString(),
    contracts: {
      RiskDataToken: rdtAddress,
      CIIOracleFeed: ciiFeedAddress,
      DataSubscription: subAddress,
      CollateralManager: colAddress,
    },
    countries: INITIAL_COUNTRIES.length,
  };

  const fs = require("fs");
  const path = require("path");
  const outPath = path.join(__dirname, "..", "deployed-addresses.json");
  fs.writeFileSync(outPath, JSON.stringify(deployedAddresses, null, 2));
  console.log(`\n  📄 Addresses written to: ${outPath}\n`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Deployment failed:", error);
    process.exit(1);
  });