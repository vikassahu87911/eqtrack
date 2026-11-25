# EquityTrend India

A small web app for checking the recent direction of Indian-listed equities.

## Run locally

Requires Node.js 18 or newer.

```sh
npm start
```

Open [http://localhost:3000](http://localhost:3000). Set `PORT` to use a different local port.

## Trend signal

The app retrieves daily closing prices from Yahoo Finance's chart endpoint. A trend is labelled **bullish** when the latest close is above its 20-day simple moving average and the 20-day average is above the 50-day average. It is **bearish** when all three are aligned in the opposite order; otherwise it is **neutral**. The displayed percentage is the change over the latest 20 trading sessions.

The stock search refreshes once per day from NSE's published [`EQUITY_L.csv`](https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv) and BSE equity records in Dhan's published [instrument master](https://images.dhan.co/api-data/api-scrip-master.csv). A local cache is retained between restarts; the browser shows the last successful refresh date and NSE/BSE record counts. Searches preserve separate exchange listings, even when the company name is the same. NSE symbols map to Yahoo Finance `.NS` tickers; BSE symbols map to `.BO` tickers. Other NSE or BSE symbols can still be entered manually using Yahoo Finance's `.NS` or `.BO` suffix.

The catalogue is based on the securities present in these source files; it may lag exchange changes or omit a listing not represented by the Dhan master. Yahoo Finance may not provide history for every BSE/NSE symbol, and its chart endpoint is unofficial and can be delayed, incomplete, rate-limited, or unavailable. A failed refresh leaves the previous cached catalogue available and marks it stale. This app is for educational purposes only, not financial advice; historical indicators do not predict future prices.

## Tests

```sh
npm test
```
