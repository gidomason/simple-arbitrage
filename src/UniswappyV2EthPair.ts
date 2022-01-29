import * as _ from "lodash";
import { BigNumber, Contract, Wallet, providers } from "ethers";
import { UNISWAP_PAIR_ABI, UNISWAP_QUERY_ABI } from "./abi";
import { UNISWAP_LOOKUP_CONTRACT_ADDRESS, WETH_ADDRESS } from "./addresses";
import { CallDetails, EthMarket, MultipleCallData, TokenBalances } from "./EthMarket";
import { ETHER } from "./utils";
import { MarketsByToken } from "./Arbitrage";
import { readFileSync, writeFile } from 'fs';

// batch count limit helpful for testing, loading entire set of uniswap markets takes a long time to load
const BATCH_COUNT_LIMIT = 1000; //0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73  PancakeSwap: Factory v2  lenght 703598  !!
const UNISWAP_BATCH_SIZE = 1000
const PAIRS_COUNT_LIMIT=3000 //update reserves limit count

// Not necessary, slightly speeds up loading initialization when we know tokens are bad
// Estimate gas will ensure we aren't submitting bad bundles, but bad tokens waste time
const blacklistTokens = [
//eth
  '0xD75EA151a61d06868E31F8988D28DFE5E9df57B4',
//bsc
  '0x8076C74C5e3F5852037F31Ff0093Eeb8c8ADd8D3', //safemoon baged bsc
  '0xFAd8E46123D7b4e77496491769C167FF894d2ACB', //fox ,fee 13%
  '0x8850D2c68c632E3B258e612abAA8FadA7E6958E5', //pig token BSC
  '0x2A9718defF471f3Bb91FA0ECEAB14154F150a385', //elongate fee 10%
  '0x3C00F8FCc8791fa78DAA4A480095Ec7D475781e2', //safestar fee 10%
  '0xd27D3F7f329D93d897612E413F207A4dbe8bF799', //moonshot fee 10%
  '0xF7844CB890F4C339c497aeAb599aBDc3c874B67A', //nftart?
  '0xA57ac35CE91Ee92CaEfAA8dc04140C8e232c2E50', //pitbul fee 4%
  '0x3aD9594151886Ce8538C1ff615EFa2385a8C3A88', // safemasrs , fee 4%
  '0x6158b3435DC3bc54a19A32Da2A2ed22aeC3bEF3e', //fee
  '0xEF2ec90e0b8D4CdFdB090989EA1Bc663F0D680BF', //fee
  '0x6D949f9297A522c0f97C232CC209a67Bd7CfA471', //fee
  '0x066fc8DD5955534A01a9f892314c9B01b59A9C11', //fee
  '0x579F11C75Eb4e47F5290122e87CA411644aDCD97', //fee
  '0xB09FE1613fE03E7361319d2a43eDc17422f36B09', //fee
  '0x066fc8DD5955534A01a9f892314c9B01b59A9C11', //fee
  '0x27Ae27110350B98d564b9A3eeD31bAeBc82d878d', //fee
  '0x9a3077F34cC30F9BF8E93A0369119bae0113d9cC', //fee , POLY play
  '0x8597ba143AC509189E89aaB3BA28d661A5dD9830', //fee VANCAT strange shit
  '0xB1CeD2e320E3f4C8e3511B1DC59203303493F382', //fee
  '0xcCe7F9eB881248E04f2975a3Fb3B62631ad9eE37', //fee
  '0x8ad8e9B85787ddd0D31b32ECF655E93bfc0747eF', //fee
  '0x1dEb45C74E0192D9272ADF54e9a7519C48C2bd81', //fee
  '0xe0191fEfdd0D2B39b1a2E4E029cCDA8A481b7995', //fee
  '0x73A14774b4E127180Ead92c03C3fA9C48d8Edfc7', //fee
  '0x6A841724d230574be192eE5B0137e24ee2a505eD', //fee
  '0xc7B15e17C95C6B31e5818E3c51ED8163D84d7Cbe', //fee
  '', //fee
]

interface GroupedMarkets {
  marketsByToken: MarketsByToken;
  allMarketPairs: Array<UniswappyV2EthPair>;
}

export class UniswappyV2EthPair extends EthMarket {
  static uniswapInterface = new Contract(WETH_ADDRESS, UNISWAP_PAIR_ABI);
  private _tokenBalances: TokenBalances
  static update:boolean

  constructor(marketAddress: string, tokens: Array<string>, protocol: string) {
    super(marketAddress, tokens, protocol);
    this._tokenBalances = _.zipObject(tokens,[BigNumber.from(0), BigNumber.from(0)])
  }

  receiveDirectly(tokenAddress: string): boolean {
    return tokenAddress in this._tokenBalances
  }

  async prepareReceive(tokenAddress: string, amountIn: BigNumber): Promise<Array<CallDetails>> {
    if (this._tokenBalances[tokenAddress] === undefined) {
      throw new Error(`Market does not operate on token ${tokenAddress}`)
    }
    if (! amountIn.gt(0)) {
      throw new Error(`Invalid amount: ${amountIn.toString()}`)
    }
    // No preparation necessary
    return []
  }

  static async getUniswappyMarkets(provider: providers.JsonRpcProvider, factoryAddress: string): Promise<Array<UniswappyV2EthPair>> {
    console.log(factoryAddress)
    const PAIRSFILENAME=`./marketPairs${factoryAddress}.json`
    let rawPair=[]
    const marketPairs = new Array<UniswappyV2EthPair>()

    try{
	const rawdata = readFileSync(PAIRSFILENAME,'utf8');
	const rawPairs = JSON.parse(rawdata);
	for (const pair of rawPairs){
	    let tokenAddress: string;
	    if (pair['p0'] === WETH_ADDRESS) {
		tokenAddress = pair['p1']
	    } else if (pair['p1'] === WETH_ADDRESS) {
		tokenAddress = pair['p0']
	    } else {
		continue;
	    }
	    if (!blacklistTokens.includes(tokenAddress)) {
		const uniswappyV2EthPair = new UniswappyV2EthPair(pair['m'], [pair['p0'], pair['p1']], pair['f']);
		marketPairs.push(uniswappyV2EthPair);
	    }else {console.log("Blacklisted : %s",tokenAddress)}
	}
	return marketPairs
    }catch{console.log('Something wrong with reading  %s file. Rescaning .....',PAIRSFILENAME)}

    const uniswapQuery = new Contract(UNISWAP_LOOKUP_CONTRACT_ADDRESS, UNISWAP_QUERY_ABI, provider);
//    console.log(uniswapQuery)

    for (let i = 0; i < BATCH_COUNT_LIMIT * UNISWAP_BATCH_SIZE; i += UNISWAP_BATCH_SIZE) {
	console.log('Batch : %d, factory : %s',i,factoryAddress)
	await new Promise(f => setTimeout(f, 1000)); //pause 1 sec
      const pairs: Array<Array<string>> = (await uniswapQuery.functions.getPairsByIndexRange(factoryAddress, i, i + UNISWAP_BATCH_SIZE))[0];
      for (let i = 0; i < pairs.length; i++) {
        const pair = pairs[i];
        const marketAddress = pair[2];
	const pairone={'m':marketAddress,'p0':pair[0],'p1':pair[1],'f':factoryAddress}
	rawPair.push(pairone) //for cache .json
//	console.log(marketAddress,  pairs.length-i)
        let tokenAddress: string;
//	console.log(pair[0],pair[1])
        if (pair[0] === WETH_ADDRESS) {
          tokenAddress = pair[1]
        } else if (pair[1] === WETH_ADDRESS) {
          tokenAddress = pair[0]
        } else {
//		console.log(pair[0],pair[1])
          continue;
        }
        if (!blacklistTokens.includes(tokenAddress)) {
          const uniswappyV2EthPair = new UniswappyV2EthPair(marketAddress, [pair[0], pair[1]], "");
	    marketPairs.push(uniswappyV2EthPair);
        }
      }
      if (pairs.length < UNISWAP_BATCH_SIZE) {
        break
      }
    }
    let serializedPairs = JSON.stringify(rawPair)
    writeFile(PAIRSFILENAME, serializedPairs, function(err) {
	if(err) {
	    return console.log(err);
	}
	console.log("Market pairs searilized for factory : %s done",factoryAddress);
    });

    return marketPairs
  }

  static async getUniswapMarketsByToken(provider: providers.JsonRpcProvider, factoryAddresses: Array<string>): Promise<GroupedMarkets> {
    const allPairs = await Promise.all(
      _.map(factoryAddresses, factoryAddress => UniswappyV2EthPair.getUniswappyMarkets(provider, factoryAddress))
    )

    const marketsByTokenAll = _.chain(allPairs)
      .flatten()
      .groupBy(pair => pair.tokens[0] === WETH_ADDRESS ? pair.tokens[1] : pair.tokens[0])
      .value()

/*
    const allMarketPairs = _.chain(
      _.pickBy(marketsByTokenAll, a => a.length > 1) // weird TS bug, chain'd pickBy is Partial<>
    )
      .values()
      .flatten()
      .value()
*/
//    console.log(marketsByTokenAll)
//    const test=_.pickBy(marketsByTokenAll, a => a.length === 1)
    const test=_.pickBy(marketsByTokenAll, a => a.length > 1)
//    console.log(test)
    const allMarketPairs = _.chain(test)
      .values()
      .flatten()
      .value()
//    console.log(allMarketPairs)

    await UniswappyV2EthPair.updateReserves2(provider, allMarketPairs);

    const marketsByToken = _.chain(allMarketPairs)
      .filter(pair => (pair.getBalance(WETH_ADDRESS).gt(ETHER.mul(10))))
      .groupBy(pair => pair.tokens[0] === WETH_ADDRESS ? pair.tokens[1] : pair.tokens[0])
      .value()

    return {
      marketsByToken,
      allMarketPairs
    }
  }

  static async updateReserves2(provider: providers.JsonRpcProvider, allMarketPairs: Array<UniswappyV2EthPair>): Promise<void> {
    this.update=true
    const uniswapQuery = new Contract(UNISWAP_LOOKUP_CONTRACT_ADDRESS, UNISWAP_QUERY_ABI, provider);
    const pairAddresses = allMarketPairs.map(marketPair => marketPair.marketAddress);
    console.log("Updating markets, count:", pairAddresses.length)
//    const PAIRS_COUNT_LIMIT=3000
    let reserves: Array<Array<BigNumber>>=[[]]
    for (let b = 0; b < pairAddresses.length; b += PAIRS_COUNT_LIMIT){
	console.log('Batch pairs: ',b)
//	const estimate=await uniswapQuery.estimateGas.getReservesByPairs(pairAddresses.slice( b, (pairAddresses.length-b < PAIRS_COUNT_LIMIT?pairAddresses.length:b+PAIRS_COUNT_LIMIT) ))
//	console.log('Estimate gas : ',estimate)

//	const reservesB: Array<Array<BigNumber>> = (await uniswapQuery.functions.getReservesByPairs(pairAddresses.slice( b, (pairAddresses.length-b < PAIRS_COUNT_LIMIT?pairAddresses.length:b+PAIRS_COUNT_LIMIT) )))[0];
	let reservesB: Array<Array<BigNumber>>
	try{
	    reservesB = (await uniswapQuery.functions.getReservesByPairs(pairAddresses.slice( b, (pairAddresses.length-b < PAIRS_COUNT_LIMIT?pairAddresses.length:b+PAIRS_COUNT_LIMIT) )))[0];
	}catch(e){
	    console.log(e)
	    console.log("reserves update fail. exit and rescan.")
//	    this.update=false
	    break;
	}
	
	for (let i = 0; i < (pairAddresses.length-b < PAIRS_COUNT_LIMIT?pairAddresses.length-b:PAIRS_COUNT_LIMIT) ; i++) {
	    const marketPair = allMarketPairs[i+b];
	    const reserve = reservesB[i]
	    marketPair.setReservesViaOrderedBalances([reserve[0], reserve[1]])
	}
	console.log('response lenght : %s',reservesB.length)
	reserves.push(...reservesB)
//    console.log("UpdatE SUCCESS")
    }
    this.update=false
  }

  static async updateReserves(provider: providers.JsonRpcProvider, allMarketPairs: Array<UniswappyV2EthPair>): Promise<void> {
    console.log('OLD UPDATES!')
    return
    const uniswapQuery = new Contract(UNISWAP_LOOKUP_CONTRACT_ADDRESS, UNISWAP_QUERY_ABI, provider);
    const pairAddresses = allMarketPairs.map(marketPair => marketPair.marketAddress);
    console.log("Updating markets, count:", pairAddresses.length)
    const reserves: Array<Array<BigNumber>> = (await uniswapQuery.functions.getReservesByPairs(pairAddresses))[0];
    for (let i = 0; i < allMarketPairs.length; i++) {
      const marketPair = allMarketPairs[i];
      const reserve = reserves[i]
      marketPair.setReservesViaOrderedBalances([reserve[0], reserve[1]])
    }
//    console.log("UpdatE SUCCESS")
  }

  getBalance(tokenAddress: string): BigNumber {
    const balance = this._tokenBalances[tokenAddress]
    if (balance === undefined) throw new Error("bad token")
    return balance;
  }

  setReservesViaOrderedBalances(balances: Array<BigNumber>): void {
    this.setReservesViaMatchingArray(this._tokens, balances)
  }

  setReservesViaMatchingArray(tokens: Array<string>, balances: Array<BigNumber>): void {
    const tokenBalances = _.zipObject(tokens, balances)
    if (!_.isEqual(this._tokenBalances, tokenBalances)) {
      this._tokenBalances = tokenBalances
    }
  }

  getTokensIn(tokenIn: string, tokenOut: string, amountOut: BigNumber): BigNumber {
    const reserveIn = this._tokenBalances[tokenIn]
    const reserveOut = this._tokenBalances[tokenOut]
    return this.getAmountIn(reserveIn, reserveOut, amountOut);
  }

  getTokensOut(tokenIn: string, tokenOut: string, amountIn: BigNumber): BigNumber {
    const reserveIn = this._tokenBalances[tokenIn]
    const reserveOut = this._tokenBalances[tokenOut]
    return this.getAmountOut(reserveIn, reserveOut, amountIn);
  }

  getAmountIn(reserveIn: BigNumber, reserveOut: BigNumber, amountOut: BigNumber): BigNumber {
    const numerator: BigNumber = reserveIn.mul(amountOut).mul(1000);
    const denominator: BigNumber = reserveOut.sub(amountOut).mul(997);
//    const denominator: BigNumber = reserveOut.sub(amountOut).mul(907);
    return numerator.div(denominator).add(1);
  }

  getAmountOut(reserveIn: BigNumber, reserveOut: BigNumber, amountIn: BigNumber): BigNumber {
    const amountInWithFee: BigNumber = amountIn.mul(997);
//    const amountInWithFee: BigNumber = amountIn.mul(907);
    const numerator = amountInWithFee.mul(reserveOut);
    const denominator = reserveIn.mul(1000).add(amountInWithFee);
    return numerator.div(denominator);
  }

  async sellTokensToNextMarket(tokenIn: string, amountIn: BigNumber, ethMarket: EthMarket): Promise<MultipleCallData> {
    if (ethMarket.receiveDirectly(tokenIn) === true) {
      const exchangeCall = await this.sellTokens(tokenIn, amountIn, ethMarket.marketAddress)
      return {
        data: [exchangeCall],
        targets: [this.marketAddress]
      }
    }

    const exchangeCall = await this.sellTokens(tokenIn, amountIn, ethMarket.marketAddress)
    return {
      data: [exchangeCall],
      targets: [this.marketAddress]
    }
  }

  async sellTokens(tokenIn: string, amountIn: BigNumber, recipient: string): Promise<string> {
    // function swap(uint amount0Out, uint amount1Out, address to, bytes calldata data) external lock {
    let amount0Out = BigNumber.from(0)
    let amount1Out = BigNumber.from(0)
    let tokenOut: string;
    if (tokenIn === this.tokens[0]) {
      tokenOut = this.tokens[1]
      amount1Out = this.getTokensOut(tokenIn, tokenOut, amountIn)
    } else if (tokenIn === this.tokens[1]) {
      tokenOut = this.tokens[0]
      amount0Out = this.getTokensOut(tokenIn, tokenOut, amountIn)
    } else {
      throw new Error("Bad token input address")
    }
    let populatedTransaction
//    console.log('protocol : %s',this.protocol)
    if (this.protocol === "0x01bF7C66c6BD861915CdaaE475042d3c4BaE16A7"){ //bakery swap
	console.log('Bakery special format')
//	populatedTransaction = await UniswappyV2EthPair.uniswapInterface.populateTransaction.swap(amount0Out, amount1Out, recipient);
//	console.log(populatedTransaction)
	const data=await UniswappyV2EthPair.uniswapInterface.interface.encodeFunctionData("swap", [ amount0Out, amount1Out, recipient ])
	return data
    }else{
	populatedTransaction = await UniswappyV2EthPair.uniswapInterface.populateTransaction.swap(amount0Out, amount1Out, recipient, []);
    }
    if (populatedTransaction === undefined || populatedTransaction.data === undefined) throw new Error("HI")
    return populatedTransaction.data;
  }
}
