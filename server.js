const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { analyzePrices, isValidSymbol } = require("./trend");
const { createStockCatalog, searchStocks } = require("./stock-catalog");

const port = Number(process.env.PORT) || 3000;
const publicDirectory = path.join(__dirname, "public");
const catalog = createStockCatalog();

function sendJson(response, status, value) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(value));
}

function serveStatic(pathname, response) {
  const requestedFile = pathname === "/" ? "index.html" : pathname.slice(1);
  const filePath = path.resolve(publicDirectory, requestedFile);
  if (!filePath.startsWith(`${publicDirectory}${path.sep}`)) {
    response.writeHead(404);
    response.end("Not found");
    return;
  }

  fs.readFile(filePath, (error, contents) => {
    if (error) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }

    const contentTypes = {
      ".css": "text/css; charset=utf-8",
      ".html": "text/html; charset=utf-8",
      ".js": "text/javascript; charset=utf-8"
    };
    response.writeHead(200, {
      "Content-Type": contentTypes[path.extname(filePath)] || "application/octet-stream"
    });
    response.end(contents);
  });
}

async function fetchTrend(symbol) {
  const period2 = Math.floor(Date.now() / 1000);
  const period1 = period2 - 100 * 24 * 60 * 60;
  const query = new URLSearchParams({
    period1: String(period1),
    period2: String(period2),
    interval: "1d"
  });
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?${query}`;
  const upstream = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0" },
    signal: AbortSignal.timeout(10000)
  });
  if (!upstream.ok) {
    throw new Error(`Market data provider returned HTTP ${upstream.status}`);
  }

  const payload = await upstream.json();
  const result = payload.chart?.result?.[0];
  if (!result) {
    throw new Error(payload.chart?.error?.description || "No price history was returned.");
  }

  const closes = result.indicators?.quote?.[0]?.close || [];
  const prices = closes.filter((close) => Number.isFinite(close));
  const trend = analyzePrices(prices);
  const latestIndex = closes.length - 1;
  const latestTimestamp = result.timestamp?.[latestIndex];

  return {
    ...trend,
    symbol,
    currency: result.meta?.currency || "INR",
    exchangeName: result.meta?.fullExchangeName || "Indian market",
    updatedAt: latestTimestamp ? new Date(latestTimestamp * 1000).toISOString() : null,
    prices: prices.slice(-60)
  };
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);

  if (url.pathname === "/api/stocks" && request.method === "GET") {
    const query = (url.searchParams.get("q") || "").trim().toLowerCase();
    const stocks = catalog.getStocks();
    if (stocks.length === 0) {
      sendJson(response, 503, {
        error: catalog.getStatus().error || "The NSE/BSE stock catalogue is still loading."
      });
      return;
    }
    sendJson(response, 200, searchStocks(stocks, query));
    return;
  }

  if (url.pathname === "/api/stocks/status" && request.method === "GET") {
    sendJson(response, 200, catalog.getStatus());
    return;
  }

  if (url.pathname === "/api/trend" && request.method === "GET") {
    const symbol = (url.searchParams.get("symbol") || "").trim().toUpperCase();
    if (!isValidSymbol(symbol)) {
      sendJson(response, 400, { error: "Choose an Indian-listed symbol ending in .NS or .BO." });
      return;
    }

    try {
      sendJson(response, 200, await fetchTrend(symbol));
    } catch (error) {
      sendJson(response, 502, {
        error: error.name === "TimeoutError"
          ? "The market data provider took too long to respond. Please try again."
          : `Could not load prices: ${error.message}`
      });
    }
    return;
  }

  if (url.pathname.startsWith("/api/")) {
    sendJson(response, 404, { error: "API route not found." });
    return;
  }
  if (request.method !== "GET") {
    response.writeHead(405);
    response.end("Method not allowed");
    return;
  }
  serveStatic(url.pathname, response);
});

if (require.main === module) {
  async function start() {
    try {
      await catalog.refresh();
    } catch (error) {
      console.error(`Could not refresh stock catalogue: ${error.message}`);
    }
    server.listen(port, () => {
      console.log(`Indian Equity Trend is available at http://localhost:${port}`);
    });
    const refreshTimer = setInterval(() => {
      catalog.refresh().catch((error) => {
        console.error(`Could not refresh stock catalogue: ${error.message}`);
      });
    }, 6 * 60 * 60 * 1000);
    refreshTimer.unref();
  }
  start();
}

module.exports = { server, catalog };
