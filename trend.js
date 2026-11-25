function isValidSymbol(symbol) {
  return typeof symbol === "string" && /^[A-Z0-9][A-Z0-9&.-]{0,24}\.(NS|BO)$/.test(symbol);
}

function average(values) {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function analyzePrices(prices) {
  if (!Array.isArray(prices) || prices.some((price) => !Number.isFinite(price) || price <= 0)) {
    throw new TypeError("Prices must be a list of positive numbers.");
  }
  if (prices.length < 50) {
    throw new Error(
      `At least 50 daily prices are needed to calculate the trend; the provider returned ${prices.length}. It may not have enough history for this listing.`
    );
  }

  const latestPrice = prices[prices.length - 1];
  const movingAverage20 = average(prices.slice(-20));
  const movingAverage50 = average(prices.slice(-50));
  const comparisonPrice = prices[prices.length - 21];
  let signal = "neutral";

  if (latestPrice > movingAverage20 && movingAverage20 > movingAverage50) {
    signal = "bullish";
  } else if (latestPrice < movingAverage20 && movingAverage20 < movingAverage50) {
    signal = "bearish";
  }

  return {
    signal,
    latestPrice,
    changePercent: ((latestPrice - comparisonPrice) / comparisonPrice) * 100,
    movingAverage20,
    movingAverage50
  };
}

module.exports = { analyzePrices, isValidSymbol };
