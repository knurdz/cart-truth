import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

type Money = { currency: string; minorUnits?: number; amount?: string | number };

type DarazSearchResult = {
  id: string;
  title: string;
  url: string;
  imageUrl?: string;
  observedPrice?: Money;
  availability?: string;
};

type SelectedProduct = DarazSearchResult & { quantity: number };

type ProductPrice = {
  title: string;
  url: string;
  quantity: number;
  observedPrice?: Money;
  checkoutUnitPrice?: Money;
  checkoutLinePrice?: Money;
  breakdown?: PriceBreakdownItem[];
  status: "checked" | "unavailable" | "login_required" | "blocked" | "needs_attention";
  note?: string;
};

type PriceBreakdownItem = {
  label: string;
  kind: "product_subtotal" | "delivery" | "platform_fee" | "service_fee" | "tax" | "discount" | "voucher" | "total" | "other";
  amount: Money;
};

type DarazCheckResult = {
  runId: string;
  status: "checked" | "login_required" | "blocked" | "needs_attention" | "error";
  startedAt: string;
  finishedAt: string;
  products: ProductPrice[];
  checkoutTotal?: Money;
  priceBreakdown?: PriceBreakdownItem[];
  message?: string;
  evidence: Array<{ kind: string; uri: string }>;
};

function App() {
  const [query, setQuery] = useState("phone");
  const [productUrl, setProductUrl] = useState("");
  const [searching, setSearching] = useState(false);
  const [addingLink, setAddingLink] = useState(false);
  const [recalculatingUrls, setRecalculatingUrls] = useState<string[]>([]);
  const [checking, setChecking] = useState(false);
  const [results, setResults] = useState<DarazSearchResult[]>([]);
  const [selected, setSelected] = useState<SelectedProduct[]>([]);
  const [latest, setLatest] = useState<DarazCheckResult | undefined>();
  const [history, setHistory] = useState<DarazCheckResult[]>([]);
  const [message, setMessage] = useState("");
  const [captureId, setCaptureId] = useState("");
  const [hasSession, setHasSession] = useState(false);

  useEffect(() => {
    void refresh();
  }, []);

  const selectedTotal = useMemo(() => {
    return selected.reduce((total, product) => total + (product.observedPrice?.minorUnits ?? 0) * product.quantity, 0);
  }, [selected]);

  async function refresh() {
    const health = await fetchJson<{ hasDarazSession: boolean }>("/api/health");
    setHasSession(health.hasDarazSession);
    const checks = await fetchJson<DarazCheckResult[]>("/api/daraz/runs");
    setHistory(checks);
    if (!latest && checks[0]) {
      setLatest(checks[0]);
    }
  }

  async function search(event?: React.FormEvent) {
    event?.preventDefault();
    if (!query.trim()) return;
    setSearching(true);
    setMessage("");
    try {
      const response = await postJson<{ results: DarazSearchResult[] }>("/api/daraz/search", { query });
      setResults(response.results);
      if (response.results.length === 0) {
        setMessage("No products found. Try a different search.");
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setSearching(false);
    }
  }

  async function addProductLink(event?: React.FormEvent) {
    event?.preventDefault();
    if (!productUrl.trim()) {
      setMessage("Paste a Daraz product link first.");
      return;
    }

    setAddingLink(true);
    setMessage("Reading product link...");
    try {
      const response = await postJson<{ product: DarazSearchResult }>("/api/daraz/product", { url: productUrl.trim() });
      addProduct(response.product);
      setProductUrl("");
      setMessage("Product added from link.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setAddingLink(false);
    }
  }

  async function recalculateProduct(product: SelectedProduct) {
    setRecalculatingUrls((urls) => [...urls, product.url]);
    setMessage(`Recalculating ${product.title}...`);
    try {
      const refreshed = await fetchDarazProduct(product.url);
      replaceSelectedProduct(product.url, refreshed);
      setMessage("Product price recalculated.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setRecalculatingUrls((urls) => urls.filter((url) => url !== product.url));
    }
  }

  async function recalculateAllProducts() {
    if (selected.length === 0) return;
    setMessage("Recalculating selected products...");
    for (const product of selected) {
      setRecalculatingUrls((urls) => [...urls, product.url]);
      try {
        const refreshed = await fetchDarazProduct(product.url);
        replaceSelectedProduct(product.url, refreshed);
      } catch (error) {
        setMessage(error instanceof Error ? error.message : String(error));
      } finally {
        setRecalculatingUrls((urls) => urls.filter((url) => url !== product.url));
      }
    }
    setMessage("Selected product prices recalculated.");
  }

  async function fetchDarazProduct(url: string): Promise<DarazSearchResult> {
    const response = await postJson<{ product: DarazSearchResult }>("/api/daraz/product", { url });
    return response.product;
  }

  async function startAppLogin() {
    setMessage("Opening inbuilt Daraz login...");
    try {
      const response = await postJson<{ captureId: string }>("/api/daraz/session/start", {});
      setCaptureId(response.captureId);
      setMessage("Inbuilt Daraz browser opened. Sign in there, then click Save Login here.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function saveLogin() {
    if (!captureId) return;
    try {
      await postJson("/api/daraz/session/save", { captureId });
      setCaptureId("");
      setHasSession(true);
      setMessage("Daraz login saved. You can check final prices now.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function checkPrices() {
    if (selected.length === 0) {
      setMessage("Add at least one product first.");
      return;
    }

    setChecking(true);
    setMessage("Checking final prices...");
    try {
      const result = await postJson<DarazCheckResult>("/api/daraz/check", {
        products: selected
      });
      setLatest(result);
      setMessage(result.message ?? "Price check finished.");
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setChecking(false);
    }
  }

  function addProduct(product: DarazSearchResult) {
    setSelected((items) => {
      const existing = items.find((item) => item.url === product.url);
      if (existing) {
        return items.map((item) => item.url === product.url ? { ...item, quantity: item.quantity + 1 } : item);
      }
      return [...items, { ...product, quantity: 1 }];
    });
  }

  function changeQuantity(url: string, quantity: number) {
    setSelected((items) => items.map((item) => item.url === url ? { ...item, quantity: Math.max(1, quantity) } : item));
  }

  function replaceSelectedProduct(url: string, refreshed: DarazSearchResult) {
    setSelected((items) => items.map((item) => item.url === url ? { ...refreshed, quantity: item.quantity } : item));
  }

  function removeProduct(url: string) {
    setSelected((items) => items.filter((item) => item.url !== url));
  }

  return (
    <main className="shell">
      <header className="hero">
        <div>
          <h1>Daraz Price Checker</h1>
          <p>Search Daraz, add products, and see the price shown at checkout.</p>
        </div>
        <button type="button" className="light-button" onClick={() => void refresh()}>Refresh</button>
      </header>

      <section className="layout">
        <section className="workspace">
          <form className="search-bar" onSubmit={(event) => void search(event)}>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search Daraz products" />
            <button type="submit" disabled={searching}>{searching ? "Searching..." : "Search"}</button>
          </form>

          <form className="link-bar" onSubmit={(event) => void addProductLink(event)}>
            <input value={productUrl} onChange={(event) => setProductUrl(event.target.value)} placeholder="Paste Daraz product link" />
            <button type="submit" disabled={addingLink}>{addingLink ? "Adding..." : "Add link"}</button>
          </form>

          <div className="results-grid">
            {results.map((product) => (
              <article className="product-card" key={product.url}>
                {product.imageUrl ? <img src={product.imageUrl} alt="" /> : <div className="image-placeholder" />}
                <div>
                  <h2>{product.title}</h2>
                  <p className="price">{formatMoney(product.observedPrice)}</p>
                  <button type="button" onClick={() => addProduct(product)}>Add</button>
                </div>
              </article>
            ))}
          </div>
        </section>

        <aside className="cart-box">
          <h2>Selected Products</h2>
          <p className={`session-state ${hasSession ? "saved" : "required"}`}>
            {hasSession ? "Daraz login saved" : "Login required"}
          </p>
          {selected.length === 0 ? <p className="empty">Add products from search results.</p> : (
            <div className="selected-list">
              {selected.map((product) => (
                <div className="selected-item" key={product.url}>
                  <strong>{product.title}</strong>
                  <span>{formatMoney(product.observedPrice)}</span>
                  <label>
                    Qty
                    <input type="number" min="1" value={product.quantity} onChange={(event) => changeQuantity(product.url, Number(event.target.value))} />
                  </label>
                  <div className="selected-actions">
                    <button type="button" className="text-button" disabled={recalculatingUrls.includes(product.url)} onClick={() => void recalculateProduct(product)}>
                      {recalculatingUrls.includes(product.url) ? "Checking..." : "Recalculate"}
                    </button>
                    <button type="button" className="text-button" onClick={() => removeProduct(product.url)}>Remove</button>
                  </div>
                </div>
              ))}
              <div className="selected-total">
                <span>Product-page total</span>
                <strong>{formatLkr(selectedTotal)}</strong>
              </div>
              <button type="button" className="light-button recalculate-all" disabled={recalculatingUrls.length > 0} onClick={() => void recalculateAllProducts()}>
                {recalculatingUrls.length > 0 ? "Recalculating..." : "Recalculate all"}
              </button>
            </div>
          )}

          {!hasSession && (
            <div className="login-box">
              <strong>Login with Daraz</strong>
              <p>Use the inbuilt browser so checkout can reuse the same Daraz session.</p>
              <div className="button-row">
                <button type="button" onClick={() => void startAppLogin()}>Open Inbuilt Daraz Login</button>
                <button type="button" disabled={!captureId} onClick={() => void saveLogin()}>Save Login</button>
              </div>
            </div>
          )}

          <button type="button" className="primary-action" disabled={checking || selected.length === 0 || Boolean(captureId)} onClick={() => void checkPrices()}>
            {checking ? "Checking..." : "Check final prices"}
          </button>
          {message && <p className="message">{message}</p>}
        </aside>
      </section>

      <section className="price-section">
        <div className="section-title">
          <h2>Latest Prices</h2>
          {latest?.checkoutTotal && <strong>{formatMoney(latest.checkoutTotal)}</strong>}
        </div>
        {latest ? <PriceTable result={latest} /> : <p className="empty">No price check yet.</p>}
      </section>

      {history.length > 0 && (
        <section className="history-section">
          <h2>Previous Checks</h2>
          <div className="history-list">
            {history.slice(0, 6).map((item) => (
              <button type="button" key={item.runId} onClick={() => setLatest(item)}>
                <span>{new Date(item.startedAt).toLocaleString()}</span>
                <strong>{plainStatus(item.status)}</strong>
              </button>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}

function PriceTable({ result }: { result: DarazCheckResult }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Product</th>
            <th>Qty</th>
            <th>Observed price</th>
            <th>Checkout breakdown</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {result.products.map((product) => (
            <tr key={product.url}>
              <td>
                <a href={product.url} target="_blank" rel="noreferrer">{product.title}</a>
                {product.note && <small>{product.note}</small>}
              </td>
              <td>{product.quantity}</td>
              <td>{formatMoney(product.observedPrice)}</td>
              <td><ProductBreakdown product={product} /></td>
              <td><span className={`status ${product.status}`}>{plainStatus(product.status)}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
      <OrderBreakdown result={result} />
      <details>
        <summary>Details</summary>
        <pre>{JSON.stringify(result, null, 2)}</pre>
        <div className="file-links">
          {result.evidence.map((item) => {
            const file = item.uri.split("/").pop() ?? "";
            return <a key={item.uri} href={`/api/daraz/runs/${result.runId}/artifacts/${file}`} target="_blank" rel="noreferrer">{file}</a>;
          })}
        </div>
      </details>
    </div>
  );
}

function ProductBreakdown({ product }: { product: ProductPrice }) {
  return (
    <div className="mini-breakdown">
      <div>
        <span>Unit</span>
        <strong>{formatMoney(product.checkoutUnitPrice)}</strong>
      </div>
      <div>
        <span>Line</span>
        <strong>{formatMoney(product.checkoutLinePrice ?? product.checkoutUnitPrice)}</strong>
      </div>
      {(product.breakdown ?? []).filter((item) => !/product page|unit price|line price/i.test(item.label)).map((item) => (
        <div key={`${item.kind}-${item.label}`}>
          <span>{item.label}</span>
          <strong>{formatMoney(item.amount)}</strong>
        </div>
      ))}
    </div>
  );
}

function OrderBreakdown({ result }: { result: DarazCheckResult }) {
  const items = result.priceBreakdown ?? [];
  if (items.length === 0 && !result.checkoutTotal) {
    return null;
  }

  return (
    <section className="breakdown-box">
      <div className="section-title">
        <h2>Order breakdown</h2>
        {result.checkoutTotal && <strong>{formatMoney(result.checkoutTotal)}</strong>}
      </div>
      <div className="breakdown-list">
        {items.map((item) => (
          <div className={`breakdown-row ${item.kind}`} key={`${item.kind}-${item.label}-${formatMoney(item.amount)}`}>
            <span>{displayBreakdownLabel(item)}</span>
            <strong>{formatMoney(item.amount)}</strong>
          </div>
        ))}
      </div>
    </section>
  );
}

function displayBreakdownLabel(item: PriceBreakdownItem) {
  const kindLabel: Record<PriceBreakdownItem["kind"], string> = {
    product_subtotal: "Product subtotal",
    delivery: "Delivery fee",
    platform_fee: "Platform fee",
    service_fee: "Service fee",
    tax: "Tax",
    discount: "Discount",
    voucher: "Voucher",
    total: "Total",
    other: "Other charge"
  };
  return item.label || kindLabel[item.kind];
}

function formatMoney(value?: Money) {
  if (!value) return "Not found";
  if (value.minorUnits !== undefined) return formatLkr(value.minorUnits);
  return `${value.currency} ${value.amount}`;
}

function formatLkr(minorUnits: number) {
  return `Rs. ${(minorUnits / 100).toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function plainStatus(status: string) {
  return status.replace(/_/g, " ");
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(await readErrorMessage(response));
  return response.json() as Promise<T>;
}

async function postJson<T = unknown>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error(await readErrorMessage(response));
  return response.json() as Promise<T>;
}

async function readErrorMessage(response: Response): Promise<string> {
  const text = await response.text();
  try {
    const body = JSON.parse(text) as { error?: string };
    return body.error ?? text;
  } catch {
    return text;
  }
}

createRoot(document.getElementById("root")!).render(<App />);
