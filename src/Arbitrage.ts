import * as _ from "lodash";
import { BigNumber, Contract, Wallet, utils } from "ethers";
import { FlashbotsBundleProvider } from "@flashbots/ethers-provider-bundle";
import { WETH_ADDRESS } from "./addresses";
import { EthMarket } from "./EthMarket";
import { ETHER, bigNumberToDecimal } from "./utils";

import * as fs from 'fs';
import * as https from 'https';

const logFileName='./log';
const logFileNameBig='./logBig';
var sizeForLog=0.1;
var networkName='eth';
const telegramChatId='-397664863'
const botToken='1016166664:AAEqifDpxklu15PoDufdSMSvoliWjwcalLw'


var executedTokens: string[]= [];


const GWEI = BigNumber.from(10).pow(9)
const ETH001 = BigNumber.from(10).pow(16) //0.01eth
const PRIORITY_FEE = GWEI.mul(3)
//const LEGACY_GAS_PRICE = GWEI.mul(12)
const BLOCKS_IN_THE_FUTURE = 1


export interface CrossedMarketDetails {
  profit: BigNumber,
  volume: BigNumber,
  tokenAddress: string,
  buyFromMarket: EthMarket,
  sellToMarket: EthMarket,
}

export type MarketsByToken = { [tokenAddress: string]: Array<EthMarket> }

// TODO: implement binary search (assuming linear/exponential global maximum profitability)
const TEST_VOLUMES = [
//  ETHER.mul(1), //for tests
//  ETHER.mul(2),
  ETHER.mul(5),
  ETHER.mul(10),
  ETHER.mul(15),
  ETHER.mul(20),
  ETHER.mul(25),
  ETHER.mul(30),
  ETHER.mul(35),
  ETHER.mul(40),
  ETHER.mul(45),
  ETHER.mul(50),
  ETHER.mul(75),
  ETHER.mul(100),
  ETHER.mul(150),
  ETHER.mul(200),
  ETHER.mul(250),
  ETHER.mul(300),
  ETHER.mul(350),
  ETHER.mul(400),
  ETHER.mul(450),
  ETHER.mul(500),
  ETHER.mul(750),
  ETHER.mul(1000),
  ETHER.mul(2000),
  ETHER.mul(3000),
  ETHER.mul(5000)
]

//const flashloanFeePercentage = 9 // (0.09%) or 9/10000
const flashloanFeePercentage = 0 // DODO has 0%
export function getBestCrossedMarket(crossedMarkets: Array<EthMarket>[], tokenAddress: string): CrossedMarketDetails | undefined {
  let bestCrossedMarket: CrossedMarketDetails | undefined = undefined;
  for (const crossedMarket of crossedMarkets) {
    const sellToMarket = crossedMarket[0]
    const buyFromMarket = crossedMarket[1]
    for (const size of TEST_VOLUMES) {
      const tokensOutFromBuyingSize = buyFromMarket.getTokensOut(WETH_ADDRESS, tokenAddress, size);
      const proceedsFromSellingTokens = sellToMarket.getTokensOut(tokenAddress, WETH_ADDRESS, tokensOutFromBuyingSize)
      const profit = proceedsFromSellingTokens.sub(size);
      if (bestCrossedMarket !== undefined && profit.lt(bestCrossedMarket.profit)) {
        // If the next size up lost value, meet halfway. TODO: replace with real binary search
        const trySize = size.add(bestCrossedMarket.volume).div(2)
        const tryTokensOutFromBuyingSize = buyFromMarket.getTokensOut(WETH_ADDRESS, tokenAddress, trySize);
        const tryProceedsFromSellingTokens = sellToMarket.getTokensOut(tokenAddress, WETH_ADDRESS, tryTokensOutFromBuyingSize)
        const tryProfit = tryProceedsFromSellingTokens.sub(trySize);
        if (tryProfit.gt(bestCrossedMarket.profit)) {
          bestCrossedMarket = {
            volume: trySize,
            profit: tryProfit,
            tokenAddress,
            sellToMarket,
            buyFromMarket
          }
        }
        break;
      }
      bestCrossedMarket = {
        volume: size,
        profit: profit,
        tokenAddress,
        sellToMarket,
        buyFromMarket
      }
    }
  }
  return bestCrossedMarket;
}

export class Arbitrage {
  private flashbotsProvider: FlashbotsBundleProvider;
  private bundleExecutorContract: Contract;
  private executorWallet: Wallet;
//  private network: string;

  constructor(executorWallet: Wallet, flashbotsProvider: FlashbotsBundleProvider, bundleExecutorContract: Contract) {
    this.executorWallet = executorWallet;
    this.flashbotsProvider = flashbotsProvider;
    this.bundleExecutorContract = bundleExecutorContract;
    networkName = 'eth';
//    console.log(flashbotsProvider);
//    console.log(executorWallet);
//    console.log(bundleExecutorContract.provider);
//    console.log(bundleExecutorContract.provider);
//    const { chainId } = bundleExecutorContract.provider.getNetwork();
//    bundleExecutorContract.provider.getNetwork().then(console.log);
//    console.log(this.bundleExecutorContract)
    
    bundleExecutorContract.provider.getNetwork().then((val) => {
	console.log(val);networkName=val.name 
	if (val.name === 'bnb'){
	    const abi = [ "function flashloan(address loanToken, uint256 loanAmount, bytes memory _params, address flashLoanPool)",]
//	    this.bundleExecutorContract=new Contract(this.bundleExecutorContract.address, abi, bundleExecutorContract.provider)
	    this.bundleExecutorContract=new Contract(this.bundleExecutorContract.address, abi,  this.executorWallet)
//		const executorSigned=this.bundleExecutorContract.connect( this.executorWallet )
//	    this.bundleExecutorContract=new Contract(this.bundleExecutorContract.address, abi, this.executorWallet)
//	    this.executorWallet=new Wallet(this.bundleExecutorContract.address,bundleExecutorContract.provider)
//	    console.log(this.bundleExecutorContract);
//	    console.log(this.executorWallet);
	    console.log("Executor conract for BSC attached at %s",this.bundleExecutorContract.address)
	}
    });
    console.log(networkName);
//{ name: 'bnb', chainId: 56, ensAddress: null, _defaultProvider: null }
//    console.log("Network chain id : ",chainId);
  }


  static printCrossedMarket(crossedMarket: CrossedMarketDetails): void {
    const buyTokens = crossedMarket.buyFromMarket.tokens
    const sellTokens = crossedMarket.sellToMarket.tokens
    const txtMessage= `Profit: ${bigNumberToDecimal(crossedMarket.profit)} Volume: ${bigNumberToDecimal(crossedMarket.volume)}\n` +
      `${crossedMarket.buyFromMarket.protocol} (${crossedMarket.buyFromMarket.marketAddress})\n` +
      `  ${buyTokens[0]} => ${buyTokens[1]}\n` +
      `${crossedMarket.sellToMarket.protocol} (${crossedMarket.sellToMarket.marketAddress})\n` +
      `  ${sellTokens[0]} => ${sellTokens[1]}\n` +
      `\n`

    console.log(txtMessage)
//    const block = this.bundleExecutorContract.provider.getBlock(blockNumber)    
    const block=0
    const timeStr = new Date().toLocaleString(undefined, {year: 'numeric', month: '2-digit', day: '2-digit', weekday:"long", hour: '2-digit', hour12: false, minute:'2-digit', second:'2-digit'})
    fs.writeFile(logFileName+networkName+'.txt', "\n"+timeStr+' '+block+' '+txtMessage,  { flag: 'a+' } , function (err) {
	if (err) return console.log(err);
//	console.log('Catch normal >> log.file');
    })
//    console.log(networkName);
//    if (networkName === 'bnb') sizeForLog=0.1;
    if (bigNumberToDecimal(crossedMarket.profit)>sizeForLog){
	fs.writeFile(logFileNameBig+networkName+'.txt', "\n"+timeStr+' '+block+' '+txtMessage,  { flag: 'a+' } , function (err) {
	    if (err) return console.log(err);
//	    console.log('Catch big >> log.file');
	})
    }

  }


  async evaluateMarkets(marketsByToken: MarketsByToken): Promise<Array<CrossedMarketDetails>> {
    const bestCrossedMarkets = new Array<CrossedMarketDetails>()

    for (const tokenAddress in marketsByToken) {
	if (executedTokens.includes(tokenAddress)) {console.log('disabled token : %s',tokenAddress);continue}
      const markets = marketsByToken[tokenAddress]
      const pricedMarkets = _.map(markets, (ethMarket: EthMarket) => {
        return {
          ethMarket: ethMarket,
          buyTokenPrice: ethMarket.getTokensIn(tokenAddress, WETH_ADDRESS, ETHER.div(100)),
          sellTokenPrice: ethMarket.getTokensOut(WETH_ADDRESS, tokenAddress, ETHER.div(100)),
        }
      });

      const crossedMarkets = new Array<Array<EthMarket>>()
      for (const pricedMarket of pricedMarkets) {
        _.forEach(pricedMarkets, pm => {
          if (pm.sellTokenPrice.gt(pricedMarket.buyTokenPrice)) {
            crossedMarkets.push([pricedMarket.ethMarket, pm.ethMarket])
          }
        })
      }

      const bestCrossedMarket = getBestCrossedMarket(crossedMarkets, tokenAddress);
      if (bestCrossedMarket !== undefined && bestCrossedMarket.profit.gt(ETHER.div(100))) {
        bestCrossedMarkets.push(bestCrossedMarket)
      }
    }
    bestCrossedMarkets.sort((a, b) => a.profit.lt(b.profit) ? 1 : a.profit.gt(b.profit) ? -1 : 0)
    return bestCrossedMarkets
  }

  // TODO: take more than 1
  async takeCrossedMarkets(bestCrossedMarkets: CrossedMarketDetails[], blockNumber: number, minerRewardPercentage: number): Promise<void> {
    for (const bestCrossedMarket of bestCrossedMarkets) {
//	executedTokens.push(bestCrossedMarket.tokenAddress)
//      console.log(this.bundleExecutorContract.provider)
      const block = await this.bundleExecutorContract.provider.getBlock(blockNumber)
//      console.log(block)
//      console.log(block.baseFee)
	let feeData = await this.bundleExecutorContract.provider.getFeeData();
//	console.log("Fee Data:", feeData);
	const maxBaseFeeInFutureBlock=1;
/*
      const maxBaseFeeInFutureBlock = FlashbotsBundleProvider.getMaxBaseFeeInFutureBlock(BigNumber.from(block.baseFeePerGas), BLOCKS_IN_THE_FUTURE)
      console.log('maxBaseFeeInFutureBlock :',maxBaseFeeInFutureBlock)
*/
//		const executorSigned=this.bundleExecutorContract.connect( this.executorWallet )
      const buyCalls = await bestCrossedMarket.buyFromMarket.sellTokensToNextMarket(WETH_ADDRESS, bestCrossedMarket.volume, bestCrossedMarket.sellToMarket);
//      const buyCalls = await bestCrossedMarket.buyFromMarket.sellTokensToNextMarket(WETH_ADDRESS, bestCrossedMarket.volume.mul(989).div(1000), bestCrossedMarket.sellToMarket);
//      const inter = bestCrossedMarket.buyFromMarket.getTokensOut(WETH_ADDRESS, bestCrossedMarket.tokenAddress, bestCrossedMarket.volume).mul(989).div(1000)
      const inter = bestCrossedMarket.buyFromMarket.getTokensOut(WETH_ADDRESS, bestCrossedMarket.tokenAddress, bestCrossedMarket.volume)
      const sellCallData = await bestCrossedMarket.sellToMarket.sellTokens(bestCrossedMarket.tokenAddress, inter, this.bundleExecutorContract.address);
//      const sellCallData = await bestCrossedMarket.sellToMarket.sellTokens(bestCrossedMarket.tokenAddress, inter, '0xFE0Ef5a9B7cA4FB1a327f48771cA9b4725063A64'); //for debug via hardhat forking

      const targets: Array<string> = [...buyCalls.targets, bestCrossedMarket.sellToMarket.marketAddress]
      const payloads: Array<string> = [...buyCalls.data, sellCallData]
      const flashloanFee = bestCrossedMarket.volume.mul(flashloanFeePercentage).div(10000);
      if (flashloanFee.lt(bestCrossedMarket.profit)){
        const profitMinusFee = bestCrossedMarket.profit.sub(flashloanFee)
        
        try {
          const minerReward = profitMinusFee.mul(minerRewardPercentage).div(100);
          const profitMinusFeeMinusMinerReward = profitMinusFee.sub(minerReward)
          console.log("Send this much WETH", bestCrossedMarket.volume.toString(), "get this much profit after fees", profitMinusFeeMinusMinerReward.toString())
      
          const ethersAbiCoder = new utils.AbiCoder()
          const typeParams = ['uint256', 'address[]', 'bytes[]']
//          const inputParams = [minerReward.toString(), targets, payloads]
          const inputParams = [BigNumber.from(0), targets, payloads]
          const params = ethersAbiCoder.encode(typeParams, inputParams)
//          console.log(bestCrossedMarket.volume,{targets, payloads})
	  const txtMessage=`Token : ${bestCrossedMarket.tokenAddress} profit : ${utils.formatEther(bestCrossedMarket.profit)} block : ${blockNumber}
const vol = '${bestCrossedMarket.volume}'
const targets=['${targets[0]}','${targets[1]}']
const payloads=['${payloads[0]}','${payloads[1]}'] `
	fs.writeFile(logFileName+networkName+'.txt', "\n "+txtMessage,  { flag: 'a+' } , function (err) {
	    if (err) return console.log(err);
	})
	console.log(txtMessage)
//	continue
//	console.log('Profit : %s , ETH001 : %s , diff : %s',bestCrossedMarket.profit,ETH001,bestCrossedMarket.profit.sub(ETH001.mul(2)))
	if (networkName === 'bnb' && bestCrossedMarket.profit.gt(ETH001.mul(1))){ // profit > 0.01
//	if (networkName === 'bnb' && bestCrossedMarket.profit.gt(ETH001.mul(2))){ // profit > 0.02
//	if (networkName === 'bnb' && bestCrossedMarket.profit.gt(ETH001.mul(100*100))){ // profit > 0.02
	    const flashLoanPool='0xD534fAE679f7F02364D177E9D44F1D15963c0Dd7' //WBNB 2.4k
//	    const flashLoanPool='0x3a8d3df3bdf9058da633cd86f68361779d3f6546' //USDT 140k
//	    const flashLoanPool='0x018e41228b1ebc2f81897150877edbb682272c64' //USDC 3mio
//	    const flashLoanPool='0xb19265426ce5bc1e015c0c503dfe6ef7c407a406' //BUSD 160k
	    try{
//		const executorSigned=this.bundleExecutorContract.connect( this.executorWallet )
		let estimation
		const url=`https://api.telegram.org/bot${botToken}/sendMessage?chat_id=${telegramChatId}&text=${txtMessage}`;
/*
		https.get(url).on("error", (err) => {
		    console.log("Error: " + err.message);
		});
*/
		try{
		    estimation = await this.bundleExecutorContract.estimateGas.flashloan(WETH_ADDRESS, bestCrossedMarket.volume, params,flashLoanPool)
		    console.log(' gas estimation : %s , try push',estimation)
		    const url=`https://api.telegram.org/bot${botToken}/sendMessage?chat_id=${telegramChatId}&text=${txtMessage+'PROLEZLO!'}`;
		    https.get(url).on("error", (err) => { console.log("Error: " + err.message); });
		}catch(e){
    // error.reason - The Revert reason; this is what you probably care about. :)
    // Additionally:
    // - error.address - the contract address
    // - error.args - [ BigNumber(1), BigNumber(2), BigNumber(3) ] in this case
    // - error.method - "someMethod()" in this case
    // - error.errorSignature - "Error(string)" (the EIP 838 sighash; supports future custom errors)
    // - error.errorArgs - The arguments passed into the error (more relevant post EIP 838 custom errors)
    // - error.transaction - The call transaction used
//		    console.log(e.message)
		    console.log(e.reason)
		    console.log(e.code)
//		    console.log(e.error)
//		    console.log(e.error.body)
		    console.log(JSON.parse(e.error.body).error.message)
//		    console.log(Object.keys(e))
//    body: '{"jsonrpc":"2.0","id":55,"error":{"code":3,"message":"execution reverted: payload operation failed",}'
//		    console.log(e['body'])
		    const msg='token : '+bestCrossedMarket.tokenAddress+' ; '+e.code+' ; '+e.reason+' ; '+JSON.parse(e.error.body).error.message
		    fs.writeFile(logFileName+networkName+'.txt', "\n "+msg,  { flag: 'a+' } , function (err) {
			if (err) return console.log(err);
		    })
		    const url=`https://api.telegram.org/bot${botToken}/sendMessage?chat_id=${telegramChatId}&text=${'error : '+msg}`;
		    https.get(url).on("error", (err) => { console.log("Error: " + msg);	});
		    console.log('No estimation -- transaction bad , dont post')
//		    return
		    continue
		}
//		const gasPrice=GWEI.mul(5)
//		const gasLimit=BigNumber.from(500000)
//		const tx = await executorSigned.flashloan(WETH_ADDRESS, bestCrossedMarket.volume, params,'0xD534fAE679f7F02364D177E9D44F1D15963c0Dd7',{gasPrice: gasPrice, gasLimit: gasLimit})

//		continue
		const tx = await this.bundleExecutorContract.flashloan(WETH_ADDRESS, bestCrossedMarket.volume, params,flashLoanPool)
		console.log("Transaction hash is ", tx.hash);
		let receipt = await tx.wait()

		//const receipt = provider.waitForTransaction(tx.hash, 1, 150000).then(() => {//});
/*
  receipt: {
    to: '0xACF8f46C294cEa457bB3ab34bC882d2C40Ddd3E9',
    from: '0xF180a1cf80605674cDCA01ce106Ae19eA8876905',
    contractAddress: null,
    transactionIndex: 66,
    gasUsed: BigNumber { _hex: '0x0559c7', _isBigNumber: true },
    logsBloom: '0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
    blockHash: '0x9a3b30474d22b118df716ee08d63ec121796f9c345689363ed9f02e796f4483c',
    transactionHash: '0x339e318ce5dc6d119fd423d5d26f5bd63da4fab1e14e3c606e05574b1e617c89',
    logs: [],
    blockNumber: 14754488,
    confirmations: 1,
    cumulativeGasUsed: BigNumber { _hex: '0x7f430a', _isBigNumber: true },
    status: 0,
    type: 0,
    byzantium: true
  }
*/
//		console.log(receipt)
		if (receipt.status){
		    console.log('!!! transaction complete for token %s',bestCrossedMarket.tokenAddress)
		}else{
		    console.log(' Error : transaction reverted %s',bestCrossedMarket.tokenAddress)
		}
		
//<------>'0xD534fAE679f7F02364D177E9D44F1D15963c0Dd7', //2400 WBNB pool
	    }catch(e){
		console.log(e)
		console.log('BSC flashloan fail. need manual inspect. token %s blacklisted',bestCrossedMarket.tokenAddress)
//		executedTokens.push(bestCrossedMarket.tokenAddress)
	    }
	}
	else{
	    console.log('Profit too small, skip')
//	    executedTokens.push(bestCrossedMarket.tokenAddress)
	}
	continue
        
          if (profitMinusFeeMinusMinerReward.gt(0)){
  
            const transaction = await this.bundleExecutorContract.populateTransaction.flashloan(WETH_ADDRESS, bestCrossedMarket.volume, params, {
//              gasPrice: BigNumber.from(0),
//              gasPrice: GWEI.mul(200).add(PRIORITY_FEE),
		maxFeePerGas: PRIORITY_FEE.add(maxBaseFeeInFutureBlock),
		maxPriorityFeePerGas: PRIORITY_FEE,
              gasLimit: BigNumber.from(1400000),
	      type: 2,
//	      chainId: 1,
            });
      
            try {
              const estimateGas = await this.bundleExecutorContract.provider.estimateGas(
                {
                  ...transaction,
                  from: this.executorWallet.address
                })
              if (estimateGas.gt(1400000)) {
                console.log("EstimateGas succeeded, but suspiciously large: " + estimateGas.toString())
                continue
              }
              transaction.gasLimit = estimateGas.mul(2)
            } catch (e) {
              console.warn(`Estimate gas failure for ${JSON.stringify(bestCrossedMarket)}`)
//	      console.warn(e)
              continue
            }
/*
            const bundlePromises = _.map([blockNumber + 1, blockNumber + 2], targetBlockNumber =>
              this.flashbotsProvider.sendBundle(
                [
                  {
                    signer: this.executorWallet,
                    transaction: transaction
                  }
                ],
                targetBlockNumber
              )
            )
            await Promise.all(bundlePromises)
*/
          } else {
            console.log("Transaction would be unprofitable after the flashloan fee and miner reward.")
            continue
          }
        
        } catch (e) {
          console.warn("Error setting miner and flashloan payment:", e);
        }
      } else {
        console.log("Flashloan fee is greater than profit.")
      }

      return
    }
    throw new Error("No arbitrage submitted to relay")
  }

}
