/**
 * RiskDataToken — Basic Test Suite
 * Covers: deployment, minting, staking, unstaking, yield distribution.
 */

const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-toolbox/network-helpers");

describe("RiskDataToken", function () {
  let rdt, owner, alice, bob;

  const STAKE_AMOUNT = ethers.parseEther("1000");

  beforeEach(async function () {
    [owner, alice, bob] = await ethers.getSigners();

    const RiskDataToken = await ethers.getContractFactory("RiskDataToken");
    rdt = await RiskDataToken.deploy();
    await rdt.waitForDeployment();
  });

  describe("Deployment", function () {
    it("should set the correct name and symbol", async function () {
      expect(await rdt.name()).to.equal("Risk Data Token");
      expect(await rdt.symbol()).to.equal("RDT");
    });

    it("should mint 20M tokens to deployer", async function () {
      const balance = await rdt.balanceOf(owner.address);
      expect(balance).to.equal(ethers.parseEther("20000000"));
    });

    it("should set correct max supply constant", async function () {
      expect(await rdt.MAX_SUPPLY()).to.equal(ethers.parseEther("100000000"));
    });
  });

  describe("Staking", function () {
    it("should stake tokens successfully", async function () {
      await rdt.connect(alice).approve(alice.address, STAKE_AMOUNT);
      await rdt.connect(alice).stake(STAKE_AMOUNT);

      const info = await rdt.getStakeInfo(alice.address);
      expect(info.staked).to.equal(STAKE_AMOUNT);
    });

    it("should fail if stake is below minimum", async function () {
      const tinyAmount = ethers.parseEther("50"); // below 100 minimum
      await expect(rdt.connect(alice).stake(tinyAmount)).to.be.revertedWith(
        "RDT: below min stake"
      );
    });

    it("should update totalStaked", async function () {
      // Transfer tokens to Alice first
      await rdt.transfer(alice.address, STAKE_AMOUNT);
      await rdt.connect(alice).stake(STAKE_AMOUNT);

      expect(await rdt.totalStaked()).to.equal(STAKE_AMOUNT);
    });

    it("should emit Staked event", async function () {
      await rdt.transfer(alice.address, STAKE_AMOUNT);
      await expect(rdt.connect(alice).stake(STAKE_AMOUNT))
        .to.emit(rdt, "Staked")
        .withArgs(alice.address, STAKE_AMOUNT);
    });
  });

  describe("Unstaking", function () {
    beforeEach(async function () {
      await rdt.transfer(alice.address, STAKE_AMOUNT);
      await rdt.connect(alice).stake(STAKE_AMOUNT);
    });

    it("should fail during lock period", async function () {
      // Lock is 2 days, advance 1 day
      await time.increase(86400); // 1 day
      await expect(rdt.connect(alice).unstake(STAKE_AMOUNT)).to.be.revertedWith(
        "RDT: still locked"
      );
    });

    it("should succeed after lock period", async function () {
      await time.increase(3 * 86400); // 3 days
      await rdt.connect(alice).unstake(STAKE_AMOUNT);

      const info = await rdt.getStakeInfo(alice.address);
      expect(info.staked).to.equal(0);
    });
  });

  describe("Admin", function () {
    it("should allow owner to set subscription contract", async function () {
      await rdt.setDataSubscription(alice.address);
      expect(await rdt.dataSubscription()).to.equal(alice.address);
    });

    it("should reject zero address for subscription", async function () {
      await expect(rdt.setDataSubscription(ethers.ZeroAddress)).to.be.revertedWith(
        "RDT: zero address"
      );
    });

    it("should allow owner to deposit yield", async function () {
      await expect(
        rdt.depositYieldFromOwner({ value: ethers.parseEther("1") })
      ).to.emit(rdt, "YieldDeposited");
    });
  });

  describe("ERC20Permit", function () {
    it("should support permit", async function () {
      const domain = await rdt.DOMAIN_SEPARATOR();
      expect(domain).to.be.properHex;
    });
  });
});