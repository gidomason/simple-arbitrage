import dotenv from "dotenv";
dotenv.config(); // load env vars from .env
import * as fs from 'fs';

import { FlashbotsBundleProvider } from "@flashbots/ethers-provider-bundle";
import { Contract, providers, Wallet } from "ethers";
import { BUNDLE_EXECUTOR_ABI } from "./abi";
import { UniswappyV2EthPair } from "./UniswappyV2EthPair";
import { FACTORY_ADDRESSES } from "./addresses";
import { Arbitrage } from "./Arbitrage";
import { get } from "https"

const ETHEREUM_RPC_URL = process.env.ETHEREUM_RPC_URL || "http://127.0.0.1:8545"
const PRIVATE_KEY = process.env.PRIVATE_KEY || ""
const BUNDLE_EXECUTOR_ADDRESS = process.env.BUNDLE_EXECUTOR_ADDRESS || ""
const FLASHBOTS_AUTH_KEY = process.env.FLASHBOTS_AUTH_KEY || "";
const FLASHBOTS_EP = process.env.FLASHBOTS_EP || "";
//const NETWORK = process.env.NETWORK || "";

const MINER_REWARD_PERCENTAGE = parseInt(process.env.MINER_REWARD_PERCENTAGE || "80")

const logFileName='./log.txt';

if (PRIVATE_KEY === "") {
  console.warn("Must provide PRIVATE_KEY environment variable")
  process.exit(1)
}
if (BUNDLE_EXECUTOR_ADDRESS === "") {
  console.warn("Must provide BUNDLE_EXECUTOR_ADDRESS environment variable. Please see README.md")
  process.exit(1)
}
if (FLASHBOTS_AUTH_KEY === "" ) {
  console.warn("Must provide FLASHBOTS_AUTH_KEY environment variable.")
  process.exit(1)
}

const HEALTHCHECK_URL = process.env.HEALTHCHECK_URL || ""

const provider = new providers.StaticJsonRpcProvider(ETHEREUM_RPC_URL);

function healthcheck() {
  if (HEALTHCHECK_URL === "") {
    return
  }
  get(HEALTHCHECK_URL).on('error', console.error);
}

async function main() {

    const timeStr = new Date().toLocaleString(undefined, {year: 'numeric', month: '2-digit', day: '2-digit', weekday:"long", hour: '2-digit', hour12: false, minute:'2-digit', second:'2-digit'})
//    console.log(timeStr)
fs.writeFile(logFileName, "\n"+timeStr+' Start!',  { flag: 'a+' } , function (err) {
  if (err) return console.log(err);
  console.log(timeStr);
});
  const markets = await UniswappyV2EthPair.getUniswapMarketsByToken(provider, FACTORY_ADDRESSES);
 console.log(markets)
  const arbitrage = new Arbitrage(
    new Wallet(PRIVATE_KEY),
//    await FlashbotsBundleProvider.create(provider, new Wallet(FLASHBOTS_AUTH_KEY), FLASHBOTS_EP),
    await FlashbotsBundleProvider.create(
  new providers.StaticJsonRpcProvider('https://goerli.infura.io/v3/72e17810a98144ed8fd9858977f4e480'),
  new Wallet(FLASHBOTS_AUTH_KEY),
  'https://relay-goerli.flashbots.net/',
  'goerli'),
    new Contract(BUNDLE_EXECUTOR_ADDRESS, BUNDLE_EXECUTOR_ABI, provider) )

  provider.on('block', async (blockNumber) => {
    if ((blockNumber % 10 !== 0) && 1==1) return
    try{
	await UniswappyV2EthPair.updateReserves2(provider, markets.allMarketPairs);
    } catch (e){
	console.log(e)
	return
    }
    const bestCrossedMarkets = await arbitrage.evaluateMarkets(markets.marketsByToken);
    if (bestCrossedMarkets.length === 0) {
      console.log("No crossed markets")
      return
    }
    bestCrossedMarkets.forEach(Arbitrage.printCrossedMarket);
    arbitrage.takeCrossedMarkets(bestCrossedMarkets, blockNumber, MINER_REWARD_PERCENTAGE).then(healthcheck).catch(console.error)
  })
}

main();
