const test = require("node:test");
const assert = require("node:assert/strict");
const { analyzePrices, isValidSymbol } = require("../trend");

test("classifies an aligned rising trend as bullish", () => {
  const prices = Array.from({ length: 60 }, (_, index) => 100 + index);
  const result = analyzePrices(prices);
  assert.equal(result.signal, "bullish");
  assert.equal(result.latestPrice, 159);
  assert.ok(result.movingAverage20 > result.movingAverage50);
  assert.equal(result.changePercent, ((159 - 139) / 139) * 100);
});

test("classifies an aligned falling trend as bearish", () => {
  const prices = Array.from({ length: 60 }, (_, index) => 200 - index);
  assert.equal(analyzePrices(prices).signal, "bearish");
});

test("keeps a mixed trend neutral", () => {
  const prices = [...Array(30).fill(200), ...Array(19).fill(100), 150];
  assert.equal(analyzePrices(prices).signal, "neutral");
});

test("requires enough valid daily prices", () => {
  assert.throws(() => analyzePrices(Array(49).fill(100)), /At least 50/);
  assert.throws(() => analyzePrices([...Array(49).fill(100), 0]), /positive numbers/);
});

test("accepts Indian exchange ticker suffixes only", () => {
  assert.equal(isValidSymbol("RELIANCE.NS"), true);
  assert.equal(isValidSymbol("500325.BO"), true);
  assert.equal(isValidSymbol("RELIANCE"), false);
  assert.equal(isValidSymbol("https://example.com.NS"), false);
});
