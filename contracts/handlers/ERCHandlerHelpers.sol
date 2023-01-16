// The Licensed Work is (c) 2022 Sygma
// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.11;

import "../interfaces/IERCHandler.sol";

/**
    @title Function used across handler contracts.
    @author ChainSafe Systems.
    @notice This contract is intended to be used with the Bridge contract.
 */
contract ERCHandlerHelpers is IERCHandler {
    address public immutable _bridgeAddress;

    // resourceID => token contract address
    mapping (bytes32 => address) public _resourceIDToTokenContractAddress;

    // token contract address => resourceID
    mapping (address => bytes32) public _tokenContractAddressToResourceID;

    // token contract address => is whitelisted
    mapping (address => bool) public _contractWhitelist;

    // token contract address => is burnable
    mapping (address => bool) public _burnList;

    // token contract address => decimals
    mapping (address => Decimals) public _decimals;

    struct Decimals {
        uint8 srcDecimals;
        uint8 destDecimals;
    }

    modifier onlyBridge() {
        _onlyBridge();
        _;
    }

    /**
        @param bridgeAddress Contract address of previously deployed Bridge.
     */
    constructor(
        address          bridgeAddress
    ) {
        _bridgeAddress = bridgeAddress;
    }

    function _onlyBridge() private view {
        require(msg.sender == _bridgeAddress, "sender must be bridge contract");
    }

    /**
        @notice First verifies {contractAddress} is whitelisted, then sets {_burnList}[{contractAddress}]
        to true.
        @param contractAddress Address of contract to be used when making or executing deposits.
     */
    function setBurnable(address contractAddress) external override onlyBridge{
        _setBurnable(contractAddress);
    }

    function withdraw(bytes memory data) external virtual override {}

    /**
        @notice First verifies {contractAddress} is whitelisted,
        then sets {_decimals}[{contractAddress}] to it's decimals value.
        @param contractAddress Address of contract to be used when making or executing deposits.
        @param srcDecimals Decimals of this token on source chain.
        @param destDecimals Decimals of this token on dest chain.
     */
    function setDecimals(address contractAddress, uint8 srcDecimals, uint8 destDecimals) external onlyBridge {
        _setDecimals(contractAddress, srcDecimals, destDecimals);
    }

    function _setResource(bytes32 resourceID, address contractAddress) internal {
        _resourceIDToTokenContractAddress[resourceID] = contractAddress;
        _tokenContractAddressToResourceID[contractAddress] = resourceID;

        _contractWhitelist[contractAddress] = true;
    }

    function _setBurnable(address contractAddress) internal {
        require(_contractWhitelist[contractAddress], "provided contract is not whitelisted");
        _burnList[contractAddress] = true;
    }

    function _setDecimals(address contractAddress, uint8 srcDecimals, uint8 destDecimals) internal {
        require(_contractWhitelist[contractAddress], "provided contract is not whitelisted");
        _decimals[contractAddress] = Decimals({
            srcDecimals: srcDecimals,
            destDecimals: destDecimals
        });
    }
}
