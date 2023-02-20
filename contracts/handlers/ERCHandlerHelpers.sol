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

    uint8 public constant defaultDecimals = 18;

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
        bool isSet;
        uint8 externalDecimals;
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

    function _setResource(bytes32 resourceID, address contractAddress) internal {
        _resourceIDToTokenContractAddress[resourceID] = contractAddress;
        _tokenContractAddressToResourceID[contractAddress] = resourceID;

        _contractWhitelist[contractAddress] = true;
    }

    function _setBurnable(address contractAddress) internal {
        require(_contractWhitelist[contractAddress], "provided contract is not whitelisted");
        _burnList[contractAddress] = true;
    }

    /**
        @notice First verifies {contractAddress} is whitelisted,
        then sets {_decimals}[{contractAddress}] to it's decimals value.
        @param contractAddress Address of contract to be used when making or executing deposits.
        @param externalDecimals Decimal places of token that is transferred.
     */
    function _setDecimals(address contractAddress, uint8 externalDecimals) internal {
        require(_contractWhitelist[contractAddress], "provided contract is not whitelisted");
        _decimals[contractAddress] = Decimals({
            isSet: true,
            externalDecimals: externalDecimals
        });
    }

    /**
        @notice Converts token amount based on decimal places difference between the nework
        deposit is made on and bridge.
        @param tokenAddress Address of contract to be used when executing proposals.
        @param amount Decimals value to be set for {contractAddress}.
    */
    function convertToExternalBalance(address tokenAddress, uint256 amount) internal returns(uint256) {
        Decimals memory decimals = _decimals[tokenAddress];

        if (!decimals.isSet) {
            return amount;
        } else if (decimals.externalDecimals >= defaultDecimals) {
            return amount * (10 ** (decimals.externalDecimals - defaultDecimals));
        } else {
            return amount / (10 ** (defaultDecimals - decimals.externalDecimals));
        }
    }

    /**
        @notice Converts token amount based on decimal places difference between the bridge and nework
        deposit is executed on.
        @param tokenAddress Address of contract to be used when executing proposals.
        @param amount Decimals value to be set for {contractAddress}.
    */
    function convertToInternalBalance(address tokenAddress, uint256 amount) internal returns(bytes memory) {
        Decimals memory decimals = _decimals[tokenAddress];
        uint256 convertedBalance;

        if (!decimals.isSet) {
            return "";
        } else if (decimals.externalDecimals >= defaultDecimals) {
            convertedBalance =  amount / (10 ** (decimals.externalDecimals - defaultDecimals));
        } else {
            convertedBalance = amount * (10 ** (defaultDecimals - decimals.externalDecimals));
        }

        return abi.encodePacked(convertedBalance);
    }
}