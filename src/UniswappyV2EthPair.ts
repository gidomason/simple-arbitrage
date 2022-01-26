import * as _ from "lodash";
import { BigNumber, Contract, providers } from "ethers";
import { UNISWAP_PAIR_ABI, UNISWAP_QUERY_ABI } from "./abi";
import { UNISWAP_LOOKUP_CONTRACT_ADDRESS, WETH_ADDRESS } from "./addresses";
import { CallDetails, EthMarket, MultipleCallData, TokenBalances } from "./EthMarket";
import { ETHER } from "./utils";
import { MarketsByToken } from "./Arbitrage";
import { readFileSync, writeFile } from 'fs';

// batch count limit helpful for testing, loading entire set of uniswap markets takes a long time to load
const BATCH_COUNT_LIMIT = 20; //0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73  PancakeSwap: Factory v2  lenght 703598  !!
const UNISWAP_BATCH_SIZE = 1000

// Not necessary, slightly speeds up loading initialization when we know tokens are bad
// Estimate gas will ensure we aren't submitting bad bundles, but bad tokens waste time
const blacklistTokens = [
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
]

interface GroupedMarkets {
  marketsByToken: MarketsByToken;
  allMarketPairs: Array<UniswappyV2EthPair>;
}

export class UniswappyV2EthPair extends EthMarket {
  static uniswapInterface = new Contract(WETH_ADDRESS, UNISWAP_PAIR_ABI);
  private _tokenBalances: TokenBalances

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
	    const uniswappyV2EthPair = new UniswappyV2EthPair(pair['market'], [pair['pair0'], pair['pair1']], pair['param']);
	    marketPairs.push(uniswappyV2EthPair);
	}
	return marketPairs
    }catch{console.log('Something wrong with reading  %s file. Rescaning .....',PAIRSFILENAME)}

    const uniswapQuery = new Contract(UNISWAP_LOOKUP_CONTRACT_ADDRESS, UNISWAP_QUERY_ABI, provider);
//    console.log(uniswapQuery)

    for (let i = 0; i < BATCH_COUNT_LIMIT * UNISWAP_BATCH_SIZE; i += UNISWAP_BATCH_SIZE) {
	console.log('Batch : %d, factory : %s',i,factoryAddress)
      const pairs: Array<Array<string>> = (await uniswapQuery.functions.getPairsByIndexRange(factoryAddress, i, i + UNISWAP_BATCH_SIZE))[0];
      for (let i = 0; i < pairs.length; i++) {
        const pair = pairs[i];
        const marketAddress = pair[2];
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
	    const pairone={'market':marketAddress,'pair0':pair[0],'pair1':pair[1],'param':""}
	    rawPair.push(pairone)
//	  console.log(pair[0],pair[1])
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
    console.log(test)
    const allMarketPairs = _.chain(test)
      .values()
      .flatten()
      .value()
//    console.log(allMarketPairs)

    await UniswappyV2EthPair.updateReserves(provider, allMarketPairs);

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
    const uniswapQuery = new Contract(UNISWAP_LOOKUP_CONTRACT_ADDRESS, UNISWAP_QUERY_ABI, provider);
    const pairAddresses = allMarketPairs.map(marketPair => marketPair.marketAddress);
    console.log("Updating markets, count:", pairAddresses.length)

    const PAIRS_COUNT_LIMIT=3000
    let reserves: Array<Array<BigNumber>>=[[]]
    for (let b = 0; b < pairAddresses.length; b += PAIRS_COUNT_LIMIT){
	console.log('Batch pairs: ',b)
	const reservesB: Array<Array<BigNumber>> = (await uniswapQuery.functions.getReservesByPairs(pairAddresses.slice( b, (pairAddresses.length-b < PAIRS_COUNT_LIMIT?pairAddresses.length:b+PAIRS_COUNT_LIMIT) )))[0];
	for (let i = 0; i < (pairAddresses.length-b < PAIRS_COUNT_LIMIT?pairAddresses.length-b:PAIRS_COUNT_LIMIT) ; i++) {
	    const marketPair = allMarketPairs[i+b];
	    const reserve = reservesB[i]
	    marketPair.setReservesViaOrderedBalances([reserve[0], reserve[1]])
	}
	console.log('response lenght : %s',reservesB.length)
	reserves.push(...reservesB)
//    console.log("UpdatE SUCCESS")
    }
  }

  static async updateReserves(provider: providers.JsonRpcProvider, allMarketPairs: Array<UniswappyV2EthPair>): Promise<void> {
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
    return numerator.div(denominator).add(1);
  }

  getAmountOut(reserveIn: BigNumber, reserveOut: BigNumber, amountIn: BigNumber): BigNumber {
    const amountInWithFee: BigNumber = amountIn.mul(997);
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
    const populatedTransaction = await UniswappyV2EthPair.uniswapInterface.populateTransaction.swap(amount0Out, amount1Out, recipient, []);
    if (populatedTransaction === undefined || populatedTransaction.data === undefined) throw new Error("HI")
    return populatedTransaction.data;
  }
}
