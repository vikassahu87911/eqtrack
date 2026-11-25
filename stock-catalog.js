const fs = require("node:fs");
const path = require("node:path");

const NSE_EQUITY_URL = "https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv";
const DHAN_MASTER_URL = "https://images.dhan.co/api-data/api-scrip-master.csv";
const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_CACHE_PATH = path.join(__dirname, ".cache", "stock-universe.json");

function* csvRecords(text) {
  let fields = [];
  let field = "";
  let quoted = false;
  let headers = null;
  const source = text.replace(/^\uFEFF/, "");

  for (let index = 0; index <= source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (character === '"' && source[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else if (character !== undefined) {
        field += character;
      }
      continue;
    }

    if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      fields.push(field);
      field = "";
    } else if (character === "\n" || character === undefined) {
      fields.push(field.replace(/\r$/, ""));
      field = "";
      if (fields.some((value) => value !== "")) {
        if (!headers) {
          headers = fields.map((header) => header.trim().toUpperCase());
        } else {
          const record = {};
          headers.forEach((header, fieldIndex) => {
            record[header] = (fields[fieldIndex] || "").trim();
          });
          yield record;
        }
      }
      fields = [];
    } else {
      field += character;
    }
  }
}

function addStock(stocks, seen, stock) {
  if (!stock.exchangeSymbol || !stock.name || !stock.yahooSymbol) return;
  const key = `${stock.exchange}:${stock.exchangeSymbol.toUpperCase()}`;
  if (seen.has(key)) return;
  seen.add(key);
  stocks.push({
    symbol: stock.yahooSymbol,
    exchangeSymbol: stock.exchangeSymbol,
    name: stock.name,
    exchange: stock.exchange,
    series: stock.series || ""
  });
}

function buildStockUniverse(nseCsv, dhanCsv, metadata = {}) {
  const stocks = [];
  const seen = new Set();

  for (const record of csvRecords(nseCsv)) {
    const exchangeSymbol = record.SYMBOL;
    if (!exchangeSymbol || exchangeSymbol === "SYMBOL") continue;
    addStock(stocks, seen, {
      symbol: exchangeSymbol,
      exchangeSymbol,
      yahooSymbol: `${exchangeSymbol}.NS`,
      name: record["NAME OF COMPANY"],
      exchange: "NSE",
      series: record.SERIES
    });
  }

  for (const record of csvRecords(dhanCsv)) {
    if (
      record.SEM_EXM_EXCH_ID !== "BSE" ||
      record.SEM_SEGMENT !== "E" ||
      record.SEM_INSTRUMENT_NAME !== "EQUITY" ||
      record.SEM_EXCH_INSTRUMENT_TYPE !== "ES"
    ) {
      continue;
    }

    const exchangeSymbol = record.SEM_TRADING_SYMBOL;
    addStock(stocks, seen, {
      exchangeSymbol,
      yahooSymbol: `${exchangeSymbol}.BO`,
      name: record.SEM_CUSTOM_SYMBOL || record.SM_SYMBOL_NAME,
      exchange: "BSE",
      series: record.SEM_SERIES
    });
  }

  stocks.sort((left, right) =>
    left.name.localeCompare(right.name) ||
    left.exchange.localeCompare(right.exchange) ||
    left.symbol.localeCompare(right.symbol)
  );

  const counts = {
    NSE: stocks.filter((stock) => stock.exchange === "NSE").length,
    BSE: stocks.filter((stock) => stock.exchange === "BSE").length
  };
  return {
    stocks,
    counts,
    fetchedAt: metadata.fetchedAt || new Date().toISOString(),
    sources: {
      NSE: {
        url: NSE_EQUITY_URL,
        lastModified: metadata.nseLastModified || null
      },
      BSE: {
        url: DHAN_MASTER_URL,
        lastModified: metadata.dhanLastModified || null
      }
    }
  };
}

function searchStocks(stocks, query = "", limit = 12) {
  const normalizedQuery = query.trim().toLowerCase();
  return stocks
    .filter((stock) =>
      `${stock.symbol} ${stock.exchangeSymbol} ${stock.name} ${stock.exchange} ${stock.series}`
        .toLowerCase()
        .includes(normalizedQuery)
    )
    .slice(0, limit);
}

function readCache(cachePath) {
  try {
    const cached = JSON.parse(fs.readFileSync(cachePath, "utf8"));
    if (
      !Array.isArray(cached.stocks) ||
      !cached.counts ||
      !cached.fetchedAt ||
      cached.stocks.length === 0
    ) {
      return null;
    }
    return cached;
  } catch (error) {
    if (error.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
    return null;
  }
}

function createStockCatalog({
  fetchImpl = globalThis.fetch,
  cachePath = DEFAULT_CACHE_PATH,
  now = () => new Date()
} = {}) {
  let universe = readCache(cachePath);
  let refreshPromise = null;
  let lastError = null;

  async function refresh(force = false) {
    if (refreshPromise) return refreshPromise;
    if (
      !force &&
      !lastError &&
      universe &&
      now().getTime() - new Date(universe.fetchedAt).getTime() < REFRESH_INTERVAL_MS
    ) {
      return universe;
    }

    refreshPromise = (async () => {
      const requestOptions = { signal: AbortSignal.timeout(60000) };
      const [nseResponse, dhanResponse] = await Promise.all([
        fetchImpl(NSE_EQUITY_URL, requestOptions),
        fetchImpl(DHAN_MASTER_URL, requestOptions)
      ]);
      if (!nseResponse.ok) throw new Error(`NSE catalogue returned HTTP ${nseResponse.status}.`);
      if (!dhanResponse.ok) throw new Error(`Dhan instrument master returned HTTP ${dhanResponse.status}.`);

      const [nseCsv, dhanCsv] = await Promise.all([
        nseResponse.text(),
        dhanResponse.text()
      ]);
      const refreshed = buildStockUniverse(nseCsv, dhanCsv, {
        fetchedAt: now().toISOString(),
        nseLastModified: nseResponse.headers.get("last-modified"),
        dhanLastModified: dhanResponse.headers.get("last-modified")
      });
      if (refreshed.counts.NSE === 0 || refreshed.counts.BSE === 0) {
        throw new Error("One or both stock catalogues contained no equity listings.");
      }

      fs.mkdirSync(path.dirname(cachePath), { recursive: true });
      const temporaryPath = `${cachePath}.${process.pid}.tmp`;
      try {
        fs.writeFileSync(temporaryPath, JSON.stringify(refreshed));
        fs.renameSync(temporaryPath, cachePath);
      } catch (error) {
        if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
        throw error;
      }

      universe = refreshed;
      lastError = null;
      return universe;
    })();

    try {
      return await refreshPromise;
    } catch (error) {
      lastError = error.message;
      throw error;
    } finally {
      refreshPromise = null;
    }
  }

  function getStatus() {
    const fetchedAt = universe?.fetchedAt || null;
    const age = fetchedAt ? now().getTime() - new Date(fetchedAt).getTime() : Infinity;
    return {
      available: Boolean(universe?.stocks.length),
      refreshing: Boolean(refreshPromise),
      stale: age >= REFRESH_INTERVAL_MS,
      fetchedAt,
      counts: universe?.counts || { NSE: 0, BSE: 0 },
      sources: universe?.sources || {
        NSE: { url: NSE_EQUITY_URL, lastModified: null },
        BSE: { url: DHAN_MASTER_URL, lastModified: null }
      },
      error: lastError
    };
  }

  return {
    getStocks: () => universe?.stocks || [],
    getStatus,
    refresh
  };
}

module.exports = {
  BSE_MASTER_URL: DHAN_MASTER_URL,
  NSE_EQUITY_URL,
  buildStockUniverse,
  createStockCatalog,
  csvRecords,
  searchStocks
};
