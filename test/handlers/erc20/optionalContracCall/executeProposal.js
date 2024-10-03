// The Licensed Work is (c) 2022 Sygma
// SPDX-License-Identifier: LGPL-3.0-only

const TruffleAssert = require("truffle-assertions");
const Ethers = require("ethers");

const Helpers = require("../../../helpers");

const DefaultMessageReceiverContract = artifacts.require("DefaultMessageReceiver");
const ERC20HandlerContract = artifacts.require("ERC20Handler");
const PercentageFeeHandlerContract = artifacts.require("PercentageERC20FeeHandler");
const FeeHandlerRouterContract = artifacts.require("FeeHandlerRouter");
const ERC20MintableContract = artifacts.require("ERC20PresetMinterPauser");
const ERC721MintableContract = artifacts.require("ERC721MinterBurnerPauser");

contract("Bridge - [execute proposal - erc20 token with contract call]", async (accounts) => {
  const originDomainID = 1;
  const destinationDomainID = 2;
  const adminAddress = accounts[0];
  const depositorAddress = accounts[1];
  const evmRecipientAddress = accounts[2];
  const relayer1Address = accounts[3];

  const expectedDepositNonce = 1;
  const emptySetResourceData = "0x";
  const resourceID = "0x0000000000000000000000000000000000000000000000000000000000000650";
  const initialTokenAmount = 100;
  const depositAmount = 10;
  const fee = 1000000; // BPS
  const transferredAmount = 9;
  const transactionId = "0x0000000000000000000000000000000000000000000000000000000000000001";
  const executionGasAmount = 30000000;
  const feeData = "0x";
  const amountToMint = 1;
  const returnBytesLength = 128;

  let BridgeInstance;
  let DefaultMessageReceiverInstance;
  let ERC20HandlerInstance;
  let PercentageFeeHandlerInstance;
  let FeeHandlerRouterInstance;
  let ERC20MintableInstance;
  let ERC721MintableInstance;
  let dataHash;

  beforeEach(async () => {
    await Promise.all([
      (BridgeInstance = await Helpers.deployBridge(
        originDomainID,
        adminAddress
      )),
    ]);


    FeeHandlerRouterInstance = await FeeHandlerRouterContract.new(
      BridgeInstance.address
    );
    PercentageFeeHandlerInstance = await PercentageFeeHandlerContract.new(
      BridgeInstance.address,
      FeeHandlerRouterInstance.address
    );
    DefaultMessageReceiverInstance = await DefaultMessageReceiverContract.new([], 100000);
    ERC20HandlerInstance = await ERC20HandlerContract.new(
      BridgeInstance.address,
      DefaultMessageReceiverInstance.address,
    );

    ERC20MintableInstance = await ERC20MintableContract.new(
      "token",
      "TOK"
    );
    ERC721MintableInstance = await ERC721MintableContract.new("token721", "TOK721", "")
    await ERC20MintableInstance.mint(depositorAddress, initialTokenAmount);

    await BridgeInstance.adminSetResource(
        ERC20HandlerInstance.address,
        resourceID,
        ERC20MintableInstance.address,
        emptySetResourceData
      );

      await ERC20MintableInstance.approve(
        ERC20HandlerInstance.address,
        depositAmount,
        {from: depositorAddress}
      );

    await PercentageFeeHandlerInstance.changeFee(destinationDomainID, resourceID, fee);
    // await PercentageFeeHandlerInstance.changeFeeBounds(resourceID, 2, 10)
    await BridgeInstance.adminChangeFeeHandler(FeeHandlerRouterInstance.address),
    await FeeHandlerRouterInstance.adminSetResourceHandler(
      destinationDomainID,
      resourceID,
      PercentageFeeHandlerInstance.address
    ),
    await DefaultMessageReceiverInstance.grantRole(
      await DefaultMessageReceiverInstance.SYGMA_HANDLER_ROLE(),
      ERC20HandlerInstance.address
    );
    await ERC721MintableInstance.grantRole(
      await ERC721MintableInstance.MINTER_ROLE(),
      DefaultMessageReceiverInstance.address
    );

    await ERC20MintableInstance.approve(
      ERC20HandlerInstance.address,
      depositAmount,
      {from: depositorAddress}
    );

    const mintableERC721Iface = new Ethers.utils.Interface(
      ["function mint(address to, uint256 tokenId, string memory _data)"]
    );
    const actions = [{
      nativeValue: 0,
      callTo: ERC721MintableInstance.address,
      approveTo: Ethers.constants.AddressZero,
      tokenSend: Ethers.constants.AddressZero,
      tokenReceive: Ethers.constants.AddressZero,
      data: mintableERC721Iface.encodeFunctionData("mint", [evmRecipientAddress, "5", ""]),
    }]
    message = Helpers.createMessageCallData(
      transactionId,
      actions,
      evmRecipientAddress
    );


    depositProposalData = Helpers.createOptionalContractCallDepositData(
      transferredAmount,
      Ethers.constants.AddressZero,
      executionGasAmount,
      message
    );

    proposal = {
      originDomainID: originDomainID,
      depositNonce: expectedDepositNonce,
      resourceID: resourceID,
      data: depositProposalData
    };

    dataHash = Ethers.utils.keccak256(
      ERC20HandlerInstance.address + depositProposalData.substr(2)
    );

    // set MPC address to unpause the Bridge
    await BridgeInstance.endKeygen(Helpers.mpcAddress);
  });

  it("isProposalExecuted returns false if depositNonce is not used", async () => {
    const destinationDomainID = await BridgeInstance._domainID();

    assert.isFalse(
      await BridgeInstance.isProposalExecuted(
        destinationDomainID,
        expectedDepositNonce
      )
    );
  });

  it("should create and execute executeProposal with contract call successfully", async () => {
    const proposalSignedData = await Helpers.signTypedProposal(
      BridgeInstance.address,
      [proposal]
    );

    // depositorAddress makes initial deposit of depositAmount
    assert.isFalse(await BridgeInstance.paused());
    await TruffleAssert.passes(
      BridgeInstance.deposit(
        destinationDomainID,
        resourceID,
        depositProposalData,
        feeData,
        {
          from: depositorAddress
      })
    );

    const recipientNativeBalanceBefore = await web3.eth.getBalance(evmRecipientAddress);
    const recipientERC721BalanceBefore = await ERC721MintableInstance.balanceOf(evmRecipientAddress);
    const defaultReceiverBalanceBefore = await web3.eth.getBalance(DefaultMessageReceiverInstance.address);

    await TruffleAssert.passes(
      BridgeInstance.executeProposal(proposal, proposalSignedData, {
        from: relayer1Address,
        gas: executionGasAmount
      })
    );

    // check that deposit nonce has been marked as used in bitmap
    assert.isTrue(
      await BridgeInstance.isProposalExecuted(
        originDomainID,
        expectedDepositNonce
      )
    );

    // check that tokens are transferred to recipient address
    const recipientNativeBalanceAfter = await web3.eth.getBalance(evmRecipientAddress);
    const recipientERC721BalanceAfter = await ERC721MintableInstance.balanceOf(evmRecipientAddress);
    const defaultReceiverBalanceAfter = await web3.eth.getBalance(DefaultMessageReceiverInstance.address);

    assert.strictEqual(
      recipientNativeBalanceBefore,
      recipientNativeBalanceAfter
    );
    assert.strictEqual(new Ethers.BigNumber.from(amountToMint).add(
      recipientERC721BalanceBefore.toString()).toString(), recipientERC721BalanceAfter.toString()
    );
    assert.strictEqual(defaultReceiverBalanceBefore.toString(), defaultReceiverBalanceAfter.toString());
  });

  it("should skip executing proposal if deposit nonce is already used", async () => {
    const proposalSignedData = await Helpers.signTypedProposal(
      BridgeInstance.address,
      [proposal]
    );

    // depositorAddress makes initial deposit of depositAmount
    assert.isFalse(await BridgeInstance.paused());
    await TruffleAssert.passes(
      BridgeInstance.deposit(
        destinationDomainID,
        resourceID,
        depositProposalData,
        feeData,
      {
        from: depositorAddress
      })
    );

    await TruffleAssert.passes(
      BridgeInstance.executeProposal(proposal, proposalSignedData, {
        from: relayer1Address,
        gas: executionGasAmount
      })
    );

    const skipExecuteTx = await BridgeInstance.executeProposal(
      proposal,
      proposalSignedData,
      {
        from: relayer1Address,
        gas: executionGasAmount
      }
    );

    // check that no ProposalExecution events are emitted
    assert.equal(skipExecuteTx.logs.length, 0);
  });

  it("executeProposal event should be emitted with expected values", async () => {
    const proposalSignedData = await Helpers.signTypedProposal(
      BridgeInstance.address,
      [proposal]
    );

    // depositorAddress makes initial deposit of depositAmount
    assert.isFalse(await BridgeInstance.paused());
    await TruffleAssert.passes(
      BridgeInstance.deposit(
        destinationDomainID,
        resourceID,
        depositProposalData,
        feeData,
      {
        from: depositorAddress
      })
    );

    const recipientBalanceBefore = await ERC20MintableInstance.balanceOf(evmRecipientAddress);

    const proposalTx = await BridgeInstance.executeProposal(
      proposal,
      proposalSignedData,
      {
        from: relayer1Address,
        gas: executionGasAmount
      }
    );

    TruffleAssert.eventEmitted(proposalTx, "ProposalExecution", (event) => {
      return (
        event.originDomainID.toNumber() === originDomainID &&
        event.depositNonce.toNumber() === expectedDepositNonce &&
        event.dataHash === dataHash &&
        event.handlerResponse === Ethers.utils.defaultAbiCoder.encode(
          ["address", "address", "uint256", "uint16", "uint256"],
          [
            ERC20MintableInstance.address,
            DefaultMessageReceiverInstance.address,
            transferredAmount,
            returnBytesLength,
            0
          ]
        )
      );
    });

    // check that deposit nonce has been marked as used in bitmap
    assert.isTrue(
      await BridgeInstance.isProposalExecuted(
        originDomainID,
        expectedDepositNonce
      )
    );

    // check that ERC20 tokens are transferred to recipient address
    const recipientBalanceAfter = await ERC20MintableInstance.balanceOf(evmRecipientAddress);
    assert.strictEqual(new Ethers.BigNumber.from(transferredAmount).add(
      Number(recipientBalanceBefore)).toString(),
      recipientBalanceAfter.toString()
    );
  });

  it(`should fail to executeProposal if signed Proposal has different
    chainID than the one on which it should be executed`, async () => {
    const proposalSignedData =
      await Helpers.mockSignTypedProposalWithInvalidChainID(
        BridgeInstance.address,
        [proposal]
      );

    // depositorAddress makes initial deposit of depositAmount
    assert.isFalse(await BridgeInstance.paused());
    await TruffleAssert.passes(
      BridgeInstance.deposit(
        destinationDomainID,
        resourceID,
        depositProposalData,
        feeData,
      {
        from: depositorAddress
      })
    );

    await Helpers.expectToRevertWithCustomError(
      BridgeInstance.executeProposal(proposal, proposalSignedData, {
        from: relayer1Address,
      }),
      "InvalidProposalSigner()"
    );
  });
});