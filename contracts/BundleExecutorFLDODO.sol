//SPDX-License-Identifier: UNLICENSED
pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;

import "./Interfaces.sol";
import "./Libraries.sol";
//import "../interfaces/IERC20.sol";
import "hardhat/console.sol";

interface IWETH is IERC20 {
    function deposit() external payable;
    function withdraw(uint) external;
}

interface IDODO {
    function flashLoan(
        uint256 baseAmount,
        uint256 quoteAmount,
        address assetTo,
        bytes calldata data
    ) external;

    function _BASE_TOKEN_() external view returns (address);
}


contract FlashBotsMultiCallFL {
    using SafeMath for uint256;
    address private immutable owner;
    address private immutable executor;
//    IWETH private constant WETH = IWETH(0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2);
//    IWETH private constant WETH = IWETH(0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c); //BSC
    IWETH private WETH = IWETH(0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c); //BSC
    address private constant ETH_address = address(0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE);

    modifier onlyExecutor() {
        require(msg.sender == executor);
        _;
    }

    modifier onlyOwner() {
        require(msg.sender == owner);
        _;
    }

    constructor(address _executor)  public payable {
        owner = msg.sender;
        executor = _executor;
	console.log(_executor);
        if (msg.value > 0) {
            WETH.deposit{value: msg.value}();
        }
    }


    function _flashLoanCallBack(address sender, uint256 amount0, uint256 amount1, bytes calldata data) internal {
        (address flashLoanPool, address loanToken, uint256 loanAmount,bytes memory params) = abi.decode(data, (address, address, uint256, bytes));
        require(sender == address(this) && msg.sender == flashLoanPool, "HANDLE_FLASH_NENIED");

	console.log('token : %s',loanToken);
	console.log('amount : %s',loanAmount/10**18);
	console.log('amount0 : %s',amount0);
	console.log('amount1 : %s',amount1);
	uniswapWethFLParams(loanAmount, params, loanAmount);
        //Note: Realize your own logic using the token from flashLoan pool.

        //Return funds
        IERC20(loanToken).transfer(flashLoanPool, loanAmount);
    }

    //Note: CallBack function executed by DODOV2(DVM) flashLoan pool
    function DVMFlashLoanCall(address sender, uint256 baseAmount, uint256 quoteAmount,bytes calldata data) external {
        _flashLoanCallBack(sender,baseAmount,quoteAmount,data);
    }

    //Note: CallBack function executed by DODOV2(DPP) flashLoan pool
    function DPPFlashLoanCall(address sender, uint256 baseAmount, uint256 quoteAmount, bytes calldata data) external {
        _flashLoanCallBack(sender,baseAmount,quoteAmount,data);
    }

    //Note: CallBack function executed by DODOV2(DSP) flashLoan pool
    function DSPFlashLoanCall(address sender, uint256 baseAmount, uint256 quoteAmount, bytes calldata data) external {
        _flashLoanCallBack(sender,baseAmount,quoteAmount,data);
    }

    function flashloan(
        address loanToken,
        uint256 loanAmount,
	bytes memory _params,
	address flashLoanPool //You will make a flashloan from this DODOV2 pool
    ) external onlyExecutor() {
	console.log(flashLoanPool,loanAmount,loanToken);
        //Note: The data can be structured with any variables required by your logic. The following code is just an example
	WETH = IWETH(address(loanToken));
        bytes memory data = abi.encode(flashLoanPool, loanToken, loanAmount,_params);
	console.log('before BASE TOKEN');
        address flashLoanBase = IDODO(flashLoanPool)._BASE_TOKEN_();
	console.log('flashLoanBase : %s',flashLoanBase);
        if(flashLoanBase == loanToken) {
	    console.log('flashLoanBase == loanToken TRUE');
            IDODO(flashLoanPool).flashLoan(loanAmount, 0, address(this), data);
        } else {
	    console.log('flashLoanBase == loanToken FALSE');
            IDODO(flashLoanPool).flashLoan(0, loanAmount, address(this), data);
        }
    }

    function uniswapWethFLParams(uint256 _amountToFirstMarket, bytes memory _params, uint256 totalAaveDebt) internal {
        (uint256 _ethAmountToCoinbase, address[] memory _targets, bytes[] memory _payloads) = abi.decode(_params, (uint256, address[], bytes[]));
//	console.log(_ethAmountToCoinbase);
	console.log(_targets.length,_payloads.length);
        require(_targets.length == _payloads.length,'_targets.length!=_payloads.length');

	console.log('WETH balance x100: %s',WETH.balanceOf(address(this))*100/10**18);
//	console.log('TOKEN balance x100: %s',WETH.balanceOf(address(this))*100/10**18);
        WETH.transfer(_targets[0], _amountToFirstMarket);
	console.log("WETH.transfer compelte");
        for (uint256 i = 0; i < _targets.length; i++) {
            (bool _success, bytes memory _response) = _targets[i].call(_payloads[i]);
	    console.log(_targets[i]);
	    console.log(_success);
//	    console.log('TOK x100 : %s',IERC20(0x8597ba143AC509189E89aaB3BA28d661A5dD9830).balanceOf(address(this))*100/10**18);
	    console.log('WETH x100 : %s',WETH.balanceOf(address(this))*100/10**18);
            require(_success,'payload operation failed'); 
        }

        uint256 _wethBalanceAfter = WETH.balanceOf(address(this));
	console.log('payloads results:');
	console.log('WETH x100 : %s',_wethBalanceAfter*100/10**18);
	console.log('totalAaveDebt x100 : %s',totalAaveDebt*100/10**18);
	console.log('_ethAmountToCoinbase x100 : %s',_ethAmountToCoinbase*100/10**18);

        require(_wethBalanceAfter > totalAaveDebt + _ethAmountToCoinbase,'Not profitable');

        uint256 _ethBalance = address(this).balance;
        if (_ethBalance < _ethAmountToCoinbase) {
            WETH.withdraw(_ethAmountToCoinbase - _ethBalance);
        }
        block.coinbase.transfer(_ethAmountToCoinbase);
    }

    function call(address payable _to, uint256 _value, bytes calldata _data) external onlyOwner payable returns (bytes memory) {
        require(_to != address(0));
        (bool _success, bytes memory _result) = _to.call{value: _value}(_data);
        require(_success,'Call operation failed');
        return _result;
    }

    function withdraw(address token) external onlyOwner {
        if (token == ETH_address) {
            uint256 bal = address(this).balance;
            msg.sender.transfer(bal);
        } else if (token != ETH_address) {
            uint256 bal = IERC20(token).balanceOf(address(this));
            IERC20(token).transfer(address(msg.sender), bal);
        }
    }

    receive() external payable {
    }
}
