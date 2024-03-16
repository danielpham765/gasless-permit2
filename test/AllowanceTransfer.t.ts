import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";
import { constants } from "ethers";
import { 
    PermitSingle, 
    PermitBatch, 
    AllowanceTransfer, 
    MaxAllowanceExpiration, 
    PERMIT2_ADDRESS 
} from "@uniswap/permit2-sdk";

describe("VaultAllowanceTransfer", function () {
  
  async function loadContracts() {
    const permit2 = await ethers.getContractAt("IPermit2", PERMIT2_ADDRESS);

    const Vault = await ethers.getContractFactory("VaultAllowanceTransfer");
    const vault = await Vault.deploy(PERMIT2_ADDRESS);

    const [account] = await ethers.getSigners();

    return { vault, permit2, account };
  }
  
  async function deployERC20() {
    const ERC20 = await ethers.getContractFactory("ERC20Mock");
    const erc20 = await ERC20.deploy("ERC20Mock", "EM");
    return erc20;
  }

  describe("Single", function () {
    it("Should deposit", async function () {
        const { vault, account } = await loadFixture(loadContracts);
        const erc20 = await deployERC20();

        const amount = 1000n;

        // Mint tokens to `account wallet`. And the `account` approves allownce to the `PERMIT2_ADDRESS`.
        // The `approve()` transaction is executed once for all protocols using Permit2 (this vault contract, kyberswap, uniswap, etc.)
        await erc20.mint(account.address, amount);
        await erc20.connect(account).approve(PERMIT2_ADDRESS, constants.MaxUint256); // approve max

        
        // ** Start depositing to the Vault contract **

        // The `account` prepares a Permit2 signature
        const permit: PermitSingle = {
            details: {
                token: erc20.address,
                amount: amount,
                expiration: MaxAllowanceExpiration,
                nonce: 0
            },
            spender: vault.address,
            sigDeadline: constants.MaxUint256
        };

        const { domain, types, values } = AllowanceTransfer.getPermitData(permit, PERMIT2_ADDRESS, 1);
        let signature = await account._signTypedData(domain, types, values);

        // The `account` deposits to the `Vault` contract without executing a separate `approve()` transaction. 
        await vault.connect(account).deposit(amount, permit, signature);

        expect(await vault.depositedBalances(account.address, erc20.address), amount.toString());
        expect(await erc20.balanceOf(account.address), '0');
        expect(await erc20.balanceOf(vault.address), amount.toString());
    })

    it("Should depositAllowed", async function () {
        const { vault, account } = await loadFixture(loadContracts);
        const erc20 = await deployERC20();

        const amount = 1000n;

        await erc20.mint(account.address, amount * 2n);
        await erc20.connect(account).approve(PERMIT2_ADDRESS, constants.MaxUint256); // approve max

        const permit: PermitSingle = {
            details: {
                token: erc20.address,
                amount: amount * 2n,
                expiration: MaxAllowanceExpiration,
                nonce: 0
            },
            spender: vault.address,
            sigDeadline: constants.MaxUint256
        };

        const { domain, types, values } = AllowanceTransfer.getPermitData(permit, PERMIT2_ADDRESS, 1);
        let signature = await account._signTypedData(domain, types, values);

        await vault.connect(account).deposit(amount, permit, signature);
        await vault.connect(account).depositAllowed(amount, erc20.address);

        expect(await vault.depositedBalances(account.address, erc20.address), (amount * 2n).toString());
        expect(await erc20.balanceOf(account.address), '0');
        expect(await erc20.balanceOf(vault.address), (amount * 2n).toString());
    })

    it("Should not depositAllowed if allowance too low", async function () {
        const { vault, account } = await loadFixture(loadContracts);
        const erc20 = await deployERC20();

        const amount = 1000n;

        await erc20.mint(account.address, amount * 2n);
        await erc20.connect(account).approve(PERMIT2_ADDRESS, constants.MaxUint256); // approve max

        const permit: PermitSingle = {
            details: {
                token: erc20.address,
                amount: amount,
                expiration: MaxAllowanceExpiration,
                nonce: 0
            },
            spender: vault.address,
            sigDeadline: constants.MaxUint256
        };

        const { domain, types, values } = AllowanceTransfer.getPermitData(permit, PERMIT2_ADDRESS, 1);
        let signature = await account._signTypedData(domain, types, values);

        await vault.connect(account).deposit(amount, permit, signature);
        await expect(vault.connect(account).depositAllowed(amount, erc20.address)).to.be.reverted;
    })

    it("Should not reuse permit", async function () {
        const { vault, account } = await loadFixture(loadContracts);
        const erc20 = await deployERC20();

        const amount = 1000n;

        await erc20.mint(account.address, amount);
        await erc20.connect(account).approve(PERMIT2_ADDRESS, constants.MaxUint256); // approve max

        const permit: PermitSingle = {
            details: {
                token: erc20.address,
                amount: amount,
                expiration: MaxAllowanceExpiration,
                nonce: 0
            },
            spender: vault.address,
            sigDeadline: constants.MaxUint256
        };

        const { domain, types, values } = AllowanceTransfer.getPermitData(permit, PERMIT2_ADDRESS, 1);
        let signature = await account._signTypedData(domain, types, values);

        await vault.connect(account).deposit(amount, permit, signature);
        await expect(vault.connect(account).deposit(amount, permit, signature)).to.be.reverted;
    })

    it("Should not use others permit", async function () {
        const { vault } = await loadFixture(loadContracts);
        const [acc1, acc2] = await ethers.getSigners();
        const erc20 = await deployERC20();

        const amount = 1000n;

        await erc20.mint(acc1.address, amount);
        await erc20.connect(acc1).approve(PERMIT2_ADDRESS, constants.MaxUint256); // approve max

        const permit: PermitSingle = {
            details: {
                token: erc20.address,
                amount: amount,
                expiration: MaxAllowanceExpiration,
                nonce: 0
            },
            spender: vault.address,
            sigDeadline: constants.MaxUint256
        };

        const { domain, types, values } = AllowanceTransfer.getPermitData(permit, PERMIT2_ADDRESS, 1);
        let signature = await acc1._signTypedData(domain, types, values);

        await expect(vault.connect(acc2).deposit(amount, permit, signature)).to.be.reverted;
    })
  })

  describe("Batch", function () {

    it("Should depositBatch", async function () {
        const { vault, account } = await loadFixture(loadContracts);
        const erc20A = await deployERC20();
        const erc20B = await deployERC20();
        const amount = 1000n;

        await erc20A.mint(account.address, amount);
        await erc20B.mint(account.address, amount);
        await erc20A.connect(account).approve(PERMIT2_ADDRESS, constants.MaxUint256); // approve max
        await erc20B.connect(account).approve(PERMIT2_ADDRESS, constants.MaxUint256); // approve max

        const permit: PermitBatch = {
            details: [
                {
                    token: erc20A.address,
                    amount: amount,
                    expiration: MaxAllowanceExpiration,
                    nonce: 0
                },
                {
                    token: erc20B.address,
                    amount: amount,
                    expiration: MaxAllowanceExpiration,
                    nonce: 0
                }
            ],
            spender: vault.address,
            sigDeadline: constants.MaxUint256
        };
        
        const { domain, types, values } = AllowanceTransfer.getPermitData(permit, PERMIT2_ADDRESS, 1);
        let signature = await account._signTypedData(domain, types, values);

        await vault.connect(account).depositBatch(amount, permit, signature);

        expect(await vault.depositedBalances(account.address, erc20A.address), amount.toString());
        expect(await vault.depositedBalances(account.address, erc20B.address), amount.toString());
        expect(await erc20A.balanceOf(account.address), '0');
        expect(await erc20B.balanceOf(account.address), '0');
        expect(await erc20A.balanceOf(vault.address), amount.toString());
        expect(await erc20B.balanceOf(vault.address), amount.toString());
    })

    it("Should depositBatchAllowed", async function () {
        const { vault, account } = await loadFixture(loadContracts);
        const erc20A = await deployERC20();
        const erc20B = await deployERC20();
        const amount = 1000n;

        await erc20A.mint(account.address, amount * 2n);
        await erc20B.mint(account.address, amount * 2n);
        await erc20A.connect(account).approve(PERMIT2_ADDRESS, constants.MaxUint256); // approve max
        await erc20B.connect(account).approve(PERMIT2_ADDRESS, constants.MaxUint256); // approve max

        const permit: PermitBatch = {
            details: [
                {
                    token: erc20A.address,
                    amount: amount * 2n,
                    expiration: MaxAllowanceExpiration,
                    nonce: 0
                },
                {
                    token: erc20B.address,
                    amount: amount * 2n,
                    expiration: MaxAllowanceExpiration,
                    nonce: 0
                }
            ],
            spender: vault.address,
            sigDeadline: constants.MaxUint256
        };
        
        const { domain, types, values } = AllowanceTransfer.getPermitData(permit, PERMIT2_ADDRESS, 1);
        let signature = await account._signTypedData(domain, types, values);

        await vault.connect(account).depositBatch(amount, permit, signature);

        await vault.connect(account).depositBatchAllowed(amount, [erc20A.address, erc20B.address]);

        expect(await vault.depositedBalances(account.address, erc20A.address), (amount * 2n).toString());
        expect(await vault.depositedBalances(account.address, erc20B.address), (amount * 2n).toString());
        expect(await erc20A.balanceOf(account.address), '0');
        expect(await erc20B.balanceOf(account.address), '0');
        expect(await erc20A.balanceOf(vault.address), (amount * 2n).toString());
        expect(await erc20B.balanceOf(vault.address), (amount * 2n).toString()); 
    })

    it("Should not depositBatchAllowed if allowance too low", async function () {
        const { vault, account } = await loadFixture(loadContracts);
        const erc20A = await deployERC20();
        const erc20B = await deployERC20();
        const amount = 1000n;

        await erc20A.mint(account.address, amount * 2n);
        await erc20B.mint(account.address, amount * 2n);
        await erc20A.connect(account).approve(PERMIT2_ADDRESS, constants.MaxUint256); // approve max
        await erc20B.connect(account).approve(PERMIT2_ADDRESS, constants.MaxUint256); // approve max

        const permit: PermitBatch = {
            details: [
                {
                    token: erc20A.address,
                    amount: amount,
                    expiration: MaxAllowanceExpiration,
                    nonce: 0
                },
                {
                    token: erc20B.address,
                    amount: amount,
                    expiration: MaxAllowanceExpiration,
                    nonce: 0
                }
            ],
            spender: vault.address,
            sigDeadline: constants.MaxUint256
        };
        
        const { domain, types, values } = AllowanceTransfer.getPermitData(permit, PERMIT2_ADDRESS, 1);
        let signature = await account._signTypedData(domain, types, values);

        await vault.connect(account).depositBatch(amount, permit, signature);
        await expect(vault.connect(account).depositBatchAllowed(amount, [erc20A.address, erc20B.address])).to.be.reverted; 
    })

    it("Should not reuse permit", async function () {
        const { vault, account } = await loadFixture(loadContracts);
        const erc20A = await deployERC20();
        const erc20B = await deployERC20();
        const amount = 1000n;

        await erc20A.mint(account.address, amount);
        await erc20B.mint(account.address, amount);
        await erc20A.connect(account).approve(PERMIT2_ADDRESS, constants.MaxUint256); // approve max
        await erc20B.connect(account).approve(PERMIT2_ADDRESS, constants.MaxUint256); // approve max

        const permit: PermitBatch = {
            details: [
                {
                    token: erc20A.address,
                    amount: amount,
                    expiration: MaxAllowanceExpiration,
                    nonce: 0
                },
                {
                    token: erc20B.address,
                    amount: amount,
                    expiration: MaxAllowanceExpiration,
                    nonce: 0
                }
            ],
            spender: vault.address,
            sigDeadline: constants.MaxUint256
        };
        
        const { domain, types, values } = AllowanceTransfer.getPermitData(permit, PERMIT2_ADDRESS, 1);
        let signature = await account._signTypedData(domain, types, values);

        await vault.connect(account).depositBatch(amount, permit, signature);

        await expect(vault.connect(account).depositBatch(amount, permit, signature)).to.be.reverted;
    })

    it("Should not use others permit", async function () {
        const { vault } = await loadFixture(loadContracts);
        const [acc1, acc2] = await ethers.getSigners();
        const erc20A = await deployERC20();
        const erc20B = await deployERC20();
        const amount = 1000n;

        await erc20A.mint(acc1.address, amount);
        await erc20B.mint(acc1.address, amount);
        await erc20A.connect(acc1).approve(PERMIT2_ADDRESS, constants.MaxUint256); // approve max
        await erc20B.connect(acc1).approve(PERMIT2_ADDRESS, constants.MaxUint256); // approve max

        const permit: PermitBatch = {
            details: [
                {
                    token: erc20A.address,
                    amount: amount,
                    expiration: MaxAllowanceExpiration,
                    nonce: 0
                },
                {
                    token: erc20B.address,
                    amount: amount,
                    expiration: MaxAllowanceExpiration,
                    nonce: 0
                }
            ],
            spender: vault.address,
            sigDeadline: constants.MaxUint256
        };
        
        const { domain, types, values } = AllowanceTransfer.getPermitData(permit, PERMIT2_ADDRESS, 1);
        let signature = await acc1._signTypedData(domain, types, values);

        await expect(vault.connect(acc2).depositBatch(amount, permit, signature)).to.be.reverted;
    })
  })

  describe("Withdraw", function () {
    it("Should withdraw", async function () {
        const { vault, account } = await loadFixture(loadContracts);
        const erc20 = await deployERC20();

        const amount = 1000n;

        await erc20.mint(account.address, amount);
        await erc20.connect(account).approve(PERMIT2_ADDRESS, constants.MaxUint256); // approve max

        const permit: PermitSingle = {
            details: {
                token: erc20.address,
                amount: amount,
                expiration: MaxAllowanceExpiration,
                nonce: 0
            },
            spender: vault.address,
            sigDeadline: constants.MaxUint256
        };

        const { domain, types, values } = AllowanceTransfer.getPermitData(permit, PERMIT2_ADDRESS, 1);
        let signature = await account._signTypedData(domain, types, values);

        await vault.connect(account).deposit(amount, permit, signature);
        await vault.connect(account).withdrawERC20(erc20.address, 1);

        expect(await erc20.balanceOf(account.address), '1');
        expect(await erc20.balanceOf(vault.address), (amount - 1n).toString());
        expect(await vault.depositedBalances(account.address, erc20.address), (amount - 1n).toString());
    })

    it("Should not withdraw others", async function () {
        const { vault } = await loadFixture(loadContracts);
        const erc20 = await deployERC20();
        const [acc1, acc2] = await ethers.getSigners();

        const amount = 1000n;

        await erc20.mint(acc1.address, amount);
        await erc20.connect(acc1).approve(PERMIT2_ADDRESS, constants.MaxUint256); // approve max

        const permit: PermitSingle = {
            details: {
                token: erc20.address,
                amount: amount,
                expiration: MaxAllowanceExpiration,
                nonce: 0
            },
            spender: vault.address,
            sigDeadline: constants.MaxUint256
        };

        const { domain, types, values } = AllowanceTransfer.getPermitData(permit, PERMIT2_ADDRESS, 1);
        let signature = await acc1._signTypedData(domain, types, values);

        await vault.connect(acc1).deposit(amount, permit, signature);
        await expect(vault.connect(acc2).withdrawERC20(erc20.address, 1)).to.be.reverted;
    })
  });
});
