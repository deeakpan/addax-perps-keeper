import { createPublicClient, http, parseAbi, decodeFunctionData } from "viem";
import { config } from "./src/lib/config";

const hash = "0x3bac8dfd34affe9abcfc9be767cd1018510b0419a61d6d879d8ec46680d73f7c";

async function main() {
  const client = createPublicClient({
    chain: { id: 4441, name: "LiteForge", nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [config.rpcUrl] } } },
    transport: http(config.rpcUrl),
  });

  const tx = await client.getTransaction({ hash });
  const rc = await client.getTransactionReceipt({ hash });

  const openAbi = parseAbi([
    "function openTrade((address trader,uint256 pairIndex,uint256 index,uint256 initialPosToken,uint256 positionSizeDai,uint256 openPrice,bool buy,uint256 leverage,uint256 tp,uint256 sl) t, uint8 _type, uint256 _spreadReductionId, uint256 _slippageP, address _referral)",
  ]);

  const d = decodeFunctionData({ abi: openAbi, data: tx.input });
  const t: any = d.args?.[0];
  const slippageP: bigint = d.args?.[3] as bigint;
  const pair: bigint = t.pairIndex as bigint;
  const lev: bigint = t.leverage as bigint;
  const wanted: bigint = t.openPrice as bigint;
  const pos: bigint = t.positionSizeDai as bigint;

  const pairsStorage = "0xBeEF006F4765Db919Cd20b23d7362B4F1120Bed6";

  const pairAbi = parseAbi([
    "function pairSpreadP(uint256) view returns (uint256)",
    "function pairFeed(uint256) view returns ((address feed1,address feed2,uint8 feedCalculation,uint256 maxDeviationP))",
  ]);
  const feedAbi = parseAbi([
    "function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)",
  ]);
  const infoAbi = parseAbi([
    "function getTradePriceImpact(uint256,uint256,bool,uint256) view returns (uint256,uint256)",
    "function maxNegativePnlOnOpenP() view returns (uint256)",
  ]);

  const spread = await client.readContract({ address: pairsStorage as any, abi: pairAbi, functionName: "pairSpreadP", args: [pair], blockNumber: rc.blockNumber });
  const feed: any = await client.readContract({ address: pairsStorage as any, abi: pairAbi, functionName: "pairFeed", args: [pair], blockNumber: rc.blockNumber });
  const rd: any = await client.readContract({ address: feed.feed1, abi: feedAbi, functionName: "latestRoundData", blockNumber: rc.blockNumber });
  const raw = BigInt(rd[1]);
  const oraclePrice = raw * 100n; // 8 -> 10 decimals

  const execPrice = oraclePrice + (oraclePrice * BigInt(spread) / 100n / 10000000000n);
  const impactRes: any = await client.readContract({ address: config.pairInfos as any, abi: infoAbi, functionName: "getTradePriceImpact", args: [execPrice, pair, t.buy, pos * lev], blockNumber: rc.blockNumber });
  const impactP = BigInt(impactRes[0]);
  const priceAfter = BigInt(impactRes[1]);
  const maxNeg = await client.readContract({ address: config.pairInfos as any, abi: infoAbi, functionName: "maxNegativePnlOnOpenP", blockNumber: rc.blockNumber });

  const PRECISION = 10000000000n;
  const maxSlip = wanted * slippageP / 100n / PRECISION;
  const slipFail = t.buy ? (priceAfter > wanted + maxSlip) : (priceAfter < wanted - maxSlip);
  const impactFail = impactP * lev > BigInt(maxNeg as any);

  console.log(JSON.stringify({
    block: rc.blockNumber.toString(),
    wanted: wanted.toString(),
    slippageP: slippageP.toString(),
    maxSlip: maxSlip.toString(),
    oraclePrice: oraclePrice.toString(),
    execPrice: execPrice.toString(),
    priceAfter: priceAfter.toString(),
    spread: String(spread),
    impactP: impactP.toString(),
    lev: lev.toString(),
    maxNegativePnlOnOpenP: String(maxNeg),
    slipFail,
    impactFail,
  }, null, 2));
}

main().catch(console.error);
