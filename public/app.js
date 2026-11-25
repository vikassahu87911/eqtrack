const searchInput = document.querySelector("#stock-search");
const suggestions = document.querySelector("#stock-options");
const customForm = document.querySelector("#custom-symbol-form");
const customInput = document.querySelector("#custom-symbol");
const resultArea = document.querySelector("#result-area");
const catalogStatus = document.querySelector("#catalog-status");
let searchTimer;

const stockCache = new Map();

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"
  })[character]);
}

function renderSuggestions(stocks) {
  if (!stocks.length) {
    suggestions.innerHTML = '<div class="suggestion"><span class="suggestion-name"><strong>No matches</strong><small>Try a ticker with .NS or .BO</small></span></div>';
  } else {
    suggestions.innerHTML = stocks.map((stock, index) => `
      <button class="suggestion" type="button" role="option" data-index="${index}">
        <span class="suggestion-name"><strong>${escapeHtml(stock.name)}</strong><small>${escapeHtml(stock.exchange)}${stock.series ? ` · Series ${escapeHtml(stock.series)}` : ""} · ${escapeHtml(stock.exchangeSymbol)}</small></span>
        <span class="suggestion-symbol">${escapeHtml(stock.symbol)}</span>
      </button>`).join("");
    stocks.forEach((stock) => stockCache.set(stock.symbol, stock));
  }
  suggestions.hidden = false;
}

async function loadCatalogStatus() {
  try {
    const response = await fetch("/api/stocks/status");
    const status = await response.json();
    if (!status.available) throw new Error(status.error || "Stock lists are unavailable.");
    const counts = `${status.counts.NSE.toLocaleString("en-IN")} NSE and ${status.counts.BSE.toLocaleString("en-IN")} BSE listings`;
    const sourceDates = [
      status.sources.NSE.lastModified && `NSE master ${formatDate(status.sources.NSE.lastModified)}`,
      status.sources.BSE.lastModified && `BSE master ${formatDate(status.sources.BSE.lastModified)}`
    ].filter(Boolean);
    const updated = status.fetchedAt ? ` Fetched ${formatDate(status.fetchedAt)}.` : "";
    catalogStatus.textContent = `${counts}.${sourceDates.length ? ` ${sourceDates.join(" · ")}.` : ""}${updated}`;
    if (status.stale || status.error) {
      catalogStatus.textContent += " Refresh is pending; list may be out of date.";
    }
  } catch (error) {
    catalogStatus.textContent = `${error.message} Search again after the catalogue is available.`;
    catalogStatus.classList.add("error");
  }
}

async function searchStocks(query) {
  try {
    const response = await fetch(`/api/stocks?q=${encodeURIComponent(query)}`);
    if (!response.ok) throw new Error("Search is temporarily unavailable.");
    renderSuggestions(await response.json());
  } catch (error) {
    suggestions.innerHTML = `<div class="suggestion"><span class="suggestion-name"><strong>${escapeHtml(error.message)}</strong></span></div>`;
    suggestions.hidden = false;
  }
}

function formatPrice(value, currency) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency", currency: currency || "INR", maximumFractionDigits: 2
  }).format(value);
}

function formatDate(value) {
  if (!value) return "Update time unavailable";
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium", timeZone: "Asia/Kolkata"
  }).format(new Date(value)) + " (IST date)";
}

function chartMarkup(prices, signal) {
  const width = 600;
  const height = 100;
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min || 1;
  const points = prices.map((price, index) => {
    const x = (index / Math.max(prices.length - 1, 1)) * width;
    const y = height - ((price - min) / range) * (height - 12) - 6;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  const color = signal === "bullish" ? "#3d8b5a" : signal === "bearish" ? "#c65f53" : "#b69a48";
  const [lastX, lastY] = points.split(" ").at(-1).split(",");
  return `<svg class="price-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Recent closing prices trend">
    <line class="chart-grid" x1="0" y1="25" x2="${width}" y2="25"></line>
    <line class="chart-grid" x1="0" y1="75" x2="${width}" y2="75"></line>
    <polygon class="chart-area" fill="${color}" points="0,${height} ${points} ${width},${height}"></polygon>
    <polyline class="chart-line" stroke="${color}" points="${points}"></polyline>
    <circle class="chart-dot" fill="${color}" cx="${lastX}" cy="${lastY}" r="4"></circle>
  </svg>`;
}

function formatReason(data) {
  if (data.signal === "bullish") return "Price is above its 20-day average, which is above its 50-day average.";
  if (data.signal === "bearish") return "Price is below its 20-day average, which is below its 50-day average.";
  return "Price and moving averages are not fully aligned in either direction.";
}

function renderTrend(data) {
  const companyName = stockCache.get(data.symbol)?.name || data.exchangeName || data.symbol;
  const changeClass = data.changePercent >= 0 ? "positive" : "negative";
  const changeSign = data.changePercent > 0 ? "+" : "";
  resultArea.innerHTML = `
    <article class="trend-card">
      <div class="trend-top">
        <div><div class="trend-company">${escapeHtml(companyName)}</div><h2>${escapeHtml(data.symbol)}</h2></div>
        <span class="signal ${escapeHtml(data.signal)}">${escapeHtml(data.signal)}</span>
      </div>
      <div class="price-line"><span class="latest-price">${formatPrice(data.latestPrice, data.currency)}</span><span class="daily-change ${changeClass}">${changeSign}${data.changePercent.toFixed(2)}% <span>20 sessions</span></span></div>
      <div class="chart-wrap">${chartMarkup(data.prices, data.signal)}</div>
      <div class="stats">
        <div class="stat"><span class="stat-label">20-day average</span><span class="stat-value">${formatPrice(data.movingAverage20, data.currency)}</span></div>
        <div class="stat"><span class="stat-label">50-day average</span><span class="stat-value">${formatPrice(data.movingAverage50, data.currency)}</span></div>
        <div class="stat"><span class="stat-label">Latest close</span><span class="stat-value">${formatPrice(data.latestPrice, data.currency)}</span></div>
      </div>
      <p class="trend-reason">${formatReason(data)}</p>
      <p class="trend-updated">${escapeHtml(data.exchangeName)} · Latest daily candle ${escapeHtml(formatDate(data.updatedAt))}</p>
    </article>`;
}

async function loadTrend(symbol) {
  suggestions.hidden = true;
  resultArea.innerHTML = '<div class="loading"><div><div class="loader"></div>Loading recent daily prices…</div></div>';
  try {
    const response = await fetch(`/api/trend?symbol=${encodeURIComponent(symbol)}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not load this stock.");
    renderTrend(data);
  } catch (error) {
    resultArea.innerHTML = `<div class="error-state" role="alert">${escapeHtml(error.message)}</div>`;
  }
}

searchInput.addEventListener("focus", () => searchStocks(searchInput.value));
searchInput.addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => searchStocks(searchInput.value), 160);
});
suggestions.addEventListener("click", (event) => {
  const option = event.target.closest("[data-index]");
  if (!option) return;
  const stock = [...suggestions.querySelectorAll("[data-index]")][Number(option.dataset.index)];
  if (!stock) return;
  searchInput.value = stock.querySelector(".suggestion-symbol").textContent;
  loadTrend(searchInput.value);
});
document.addEventListener("click", (event) => {
  if (!event.target.closest(".search-wrap")) suggestions.hidden = true;
});
searchInput.addEventListener("keydown", (event) => {
  if (event.key === "Escape") suggestions.hidden = true;
  if (event.key === "Enter") {
    event.preventDefault();
    const firstOption = suggestions.querySelector("[data-index]");
    if (firstOption) firstOption.click();
  }
});
customForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const symbol = customInput.value.trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9&.-]{0,24}\.(NS|BO)$/.test(symbol)) {
    resultArea.innerHTML = '<div class="error-state" role="alert">Enter a valid Yahoo Finance ticker ending in .NS (NSE) or .BO (BSE), for example RELIANCE.NS.</div>';
    return;
  }
  searchInput.value = symbol;
  loadTrend(symbol);
});

loadCatalogStatus();
