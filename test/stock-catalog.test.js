const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { buildStockUniverse, createStockCatalog, searchStocks } = require("../stock-catalog");

const nseCsv = [
  "SYMBOL,NAME OF COMPANY,SERIES,DATE OF LISTING",
  "RELIANCE,\"Reliance Industries Limited\",EQ,06-MAY-1995",
  "TCS,\"Tata Consultancy Services, Ltd.\",EQ,25-AUG-2004"
].join("\n");

const dhanCsv = [
  "SEM_EXM_EXCH_ID,SEM_SEGMENT,SEM_SMST_SECURITY_ID,SEM_INSTRUMENT_NAME,SEM_TRADING_SYMBOL,SEM_CUSTOM_SYMBOL,SEM_EXCH_INSTRUMENT_TYPE,SEM_SERIES,SM_SYMBOL_NAME",
  "BSE,E,500325,EQUITY,RELIANCE,\"Reliance Industries Limited\",ES,A,RELIANCE INDUSTRIES LTD.",
  "BSE,E,532540,EQUITY,TCS,\"Tata Consultancy Services, Ltd.\",ES,A,TCS LTD.",
  "BSE,E,900001,EQUITY,DEBENTURE,\"Example Debt\",DEB,F,EXAMPLE DEBT",
  "BSE,D,123,EQUITY,OPTION,\"Example Option\",OPTSTK,,EXAMPLE"
].join("\n");

test("builds separate NSE and BSE Yahoo mappings for matching company names", () => {
  const universe = buildStockUniverse(nseCsv, dhanCsv, { fetchedAt: "2026-11-25T10:00:00.000Z" });
  const reliance = universe.stocks.filter((stock) => stock.name === "Reliance Industries Limited");

  assert.equal(universe.counts.NSE, 2);
  assert.equal(universe.counts.BSE, 2);
  assert.deepEqual(
    reliance.map(({ exchange, symbol, exchangeSymbol }) => ({ exchange, symbol, exchangeSymbol })),
    [
      { exchange: "BSE", symbol: "RELIANCE.BO", exchangeSymbol: "RELIANCE" },
      { exchange: "NSE", symbol: "RELIANCE.NS", exchangeSymbol: "RELIANCE" }
    ]
  );
  assert.equal(universe.stocks.find((stock) => stock.exchange === "BSE" && stock.symbol === "TCS.BO").series, "A");
});

test("search keeps same-name listings distinct and returns all exchanges", () => {
  const universe = buildStockUniverse(nseCsv, dhanCsv);
  const results = searchStocks(universe.stocks, "reliance");

  assert.deepEqual(results.map((stock) => stock.symbol), ["RELIANCE.BO", "RELIANCE.NS"]);
  assert.deepEqual(results.map((stock) => stock.exchange), ["BSE", "NSE"]);
  assert.equal(searchStocks(universe.stocks, "", 3).length, 3);
});

test("refreshes both source files and persists a reusable cache", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "eqtrack-stock-catalog-"));
  const cachePath = path.join(directory, "universe.json");
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const requests = [];
  const fetchImpl = async (url) => {
    requests.push(url);
    return new Response(url.includes("nsearchives") ? nseCsv : dhanCsv, {
      status: 200,
      headers: { "last-modified": "Wed, 25 Nov 2026 02:50:06 GMT" }
    });
  };
  const now = () => new Date("2026-11-25T10:00:00.000Z");
  const catalog = createStockCatalog({ fetchImpl, cachePath, now });

  await catalog.refresh();

  assert.equal(requests.length, 2);
  assert.equal(catalog.getStocks().length, 4);
  assert.equal(catalog.getStatus().available, true);
  assert.equal(catalog.getStatus().stale, false);
  assert.equal(JSON.parse(fs.readFileSync(cachePath, "utf8")).counts.BSE, 2);

  const cachedCatalog = createStockCatalog({
    fetchImpl: async () => { throw new Error("Network should not be used for a fresh cache."); },
    cachePath,
    now
  });
  await cachedCatalog.refresh();
  assert.equal(cachedCatalog.getStocks().length, 4);
});
