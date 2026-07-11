import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

type Money = { currency: string; minorUnits?: number; amount?: string | number };

type AppUser = {
  id: string;
  username: string;
  role: "admin" | "user";
  disabled: boolean;
  mustChangePassword: boolean;
  createdAt: string;
};

type DarazSearchResult = {
  id: string;
  title: string;
  url: string;
  imageUrl?: string;
  observedPrice?: Money;
  availability?: string;
};

type SavedLink = {
  id: string;
  title: string;
  url: string;
  imageUrl?: string;
  observedPriceJson?: string;
  availability?: string;
  createdAt: string;
  updatedAt: string;
};

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

type DarazSessionStatus = "missing" | "saved" | "needs_login" | "needs_verification" | "unknown";

type DarazSession = {
  status: DarazSessionStatus;
  savedAt?: string;
  lastValidatedAt?: string;
  validationUrl?: string;
  message?: string;
  live?: boolean;
  captureId?: string;
};

type DarazCredentialStatus = {
  saved: boolean;
  username?: string;
  updatedAt?: string;
};

function App() {
  const [user, setUser] = useState<AppUser | undefined>();
  const [authChecked, setAuthChecked] = useState(false);

  useEffect(() => {
    void refreshMe();
  }, []);

  async function refreshMe() {
    const response = await fetchJson<{ user?: AppUser }>("/api/auth/me");
    setUser(response.user);
    setAuthChecked(true);
  }

  if (!authChecked) {
    return <main className="shell"><p className="empty">Loading...</p></main>;
  }

  if (!user) {
    return <LoginScreen onLogin={setUser} />;
  }

  return (
    <Dashboard
      user={user}
      onUserChange={setUser}
      onLogout={async () => {
        await postJson("/api/auth/logout", {});
        setUser(undefined);
      }}
    />
  );
}

function LoginScreen({ onLogin }: { onLogin: (user: AppUser) => void }) {
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");

  async function login(event: React.FormEvent) {
    event.preventDefault();
    setMessage("");
    try {
      const response = await postJson<{ user: AppUser }>("/api/auth/login", { username, password });
      onLogin(response.user);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <main className="shell login-shell">
      <section className="login-panel">
        <h1>CartTruth</h1>
        <p>Sign in to check Daraz final prices from your own saved Daraz session.</p>
        <form onSubmit={(event) => void login(event)}>
          <input value={username} onChange={(event) => setUsername(event.target.value)} placeholder="Username" autoComplete="username" />
          <input value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Password" type="password" autoComplete="current-password" />
          <button type="submit">Sign in</button>
        </form>
        {message && <p className="attention-message">{message}</p>}
      </section>
    </main>
  );
}

function Dashboard({ user, onUserChange, onLogout }: { user: AppUser; onUserChange: (user: AppUser) => void; onLogout: () => Promise<void> }) {
  const [tab, setTab] = useState<"links" | "admin">(user.role === "admin" ? "admin" : "links");

  return (
    <main className="shell">
      <header className="hero">
        <div>
          <p className="eyebrow">Daraz final price checker</p>
          <h1>{user.role === "admin" ? "Admin dashboard" : "Your Daraz dashboard"}</h1>
          <p>Logged in as {user.username}. Daraz sessions, links, and evidence are scoped to this app account.</p>
        </div>
        <div className="button-row">
          <button type="button" className={tab === "links" ? "" : "light-button"} onClick={() => setTab("links")}>My links</button>
          {user.role === "admin" && <button type="button" className={tab === "admin" ? "" : "light-button"} onClick={() => setTab("admin")}>Users</button>}
          <button type="button" className="light-button" onClick={() => void onLogout()}>Logout</button>
        </div>
      </header>

      {user.mustChangePassword && <ChangePasswordPanel onChanged={(updated) => onUserChange(updated)} />}
      {tab === "admin" && user.role === "admin" ? <AdminPanel /> : <UserPanel />}
    </main>
  );
}

function ChangePasswordPanel({ onChanged }: { onChanged: (user: AppUser) => void }) {
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("Change the temporary password before sharing this account.");

  async function changePassword(event: React.FormEvent) {
    event.preventDefault();
    try {
      const response = await postJson<{ user: AppUser }>("/api/auth/change-password", { password });
      onChanged(response.user);
      setPassword("");
      setMessage("Password changed.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <section className="login-box">
      <strong>Temporary password</strong>
      <form className="inline-form" onSubmit={(event) => void changePassword(event)}>
        <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" placeholder="New password" />
        <button type="submit">Change password</button>
      </form>
      <p>{message}</p>
    </section>
  );
}

function AdminPanel() {
  const [users, setUsers] = useState<AppUser[]>([]);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"admin" | "user">("user");
  const [message, setMessage] = useState("");

  useEffect(() => {
    void refresh();
  }, []);

  async function refresh() {
    const response = await fetchJson<{ users: AppUser[] }>("/api/admin/users");
    setUsers(response.users);
  }

  async function createUser(event: React.FormEvent) {
    event.preventDefault();
    try {
      await postJson("/api/admin/users", { username, password, role });
      setUsername("");
      setPassword("");
      setRole("user");
      setMessage("User created.");
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function setDisabled(userId: string, disabled: boolean) {
    await postJson(`/api/admin/users/${userId}/disabled`, { disabled });
    await refresh();
  }

  return (
    <section className="price-section">
      <div className="section-title">
        <h2>Users</h2>
      </div>
      <form className="toolbar" onSubmit={(event) => void createUser(event)}>
        <input value={username} onChange={(event) => setUsername(event.target.value)} placeholder="Username" />
        <input value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Temporary password" type="password" />
        <select value={role} onChange={(event) => setRole(event.target.value as "admin" | "user")}>
          <option value="user">User</option>
          <option value="admin">Admin</option>
        </select>
        <button type="submit">Create user</button>
      </form>
      {message && <p className="message">{message}</p>}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Username</th>
              <th>Role</th>
              <th>Status</th>
              <th>Created</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {users.map((item) => (
              <tr key={item.id}>
                <td>{item.username}</td>
                <td>{item.role}</td>
                <td>{item.disabled ? "disabled" : item.mustChangePassword ? "temporary password" : "active"}</td>
                <td>{new Date(item.createdAt).toLocaleString()}</td>
                <td>
                  <button type="button" className="text-button" onClick={() => void setDisabled(item.id, !item.disabled)}>
                    {item.disabled ? "Enable" : "Disable"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function UserPanel() {
  const [productUrl, setProductUrl] = useState("");
  const [links, setLinks] = useState<SavedLink[]>([]);
  const [darazSession, setDarazSession] = useState<DarazSession>({ status: "missing" });
  const [captureId, setCaptureId] = useState("");
  const [browserUrl, setBrowserUrl] = useState("");
  const [checking, setChecking] = useState(false);
  const [history, setHistory] = useState<DarazCheckResult[]>([]);
  const [latest, setLatest] = useState<DarazCheckResult | undefined>();
  const [credentials, setCredentials] = useState<DarazCredentialStatus>({ saved: false });
  const [darazUsername, setDarazUsername] = useState("");
  const [darazPassword, setDarazPassword] = useState("");
  const [addingLink, setAddingLink] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    void refresh();
  }, []);

  const productPageTotal = useMemo(() => links.reduce((total, link) => {
    const observed = parseObservedPrice(link)?.minorUnits ?? 0;
    return total + observed;
  }, 0), [links]);

  async function refresh() {
    const [session, saved, runs, credentialStatus] = await Promise.all([
      fetchJson<DarazSession>("/api/daraz/session/status"),
      fetchJson<{ links: SavedLink[] }>("/api/links"),
      fetchJson<DarazCheckResult[]>("/api/daraz/runs"),
      fetchJson<DarazCredentialStatus>("/api/daraz/credentials")
    ]);
    setDarazSession(session);
    setCaptureId(session.captureId ?? "");
    if (!session.live) {
      setBrowserUrl("");
    }
    setLinks(saved.links);
    setHistory(runs);
    setCredentials(credentialStatus);
    setDarazUsername(credentialStatus.username ?? "");
    if (!latest && runs[0]) {
      setLatest(runs[0]);
    }
  }

  async function addLink(event: React.FormEvent) {
    event.preventDefault();
    if (!credentials.saved && darazSession.status !== "saved") {
      setMessage("Add your Daraz email/phone and password before saving products.");
      return;
    }
    setAddingLink(true);
    setMessage("Reading product page price...");
    try {
      const response = await postJson<{
        link?: SavedLink;
        status?: string;
        message?: string;
        browserUrl?: string;
        session?: DarazSession & { browserUrl?: string };
      }>("/api/links", { url: productUrl.trim() });
      if (response.status === "needs_user_action") {
        setBrowserUrl(response.browserUrl ?? response.session?.browserUrl ?? "");
        setCaptureId(response.session?.captureId ?? "");
        setDarazSession(response.session ?? darazSession);
        setMessage(response.message ?? "Daraz needs verification. Open the remote browser, finish verification, then save session.");
        await refresh().catch(() => undefined);
        return;
      }
      if (response.link) {
        setLinks((items) => [response.link!, ...items.filter((item) => item.id !== response.link!.id)]);
      }
      setMessage("Checking final checkout price...");
      const finalPrice = await postJson<DarazCheckResult>("/api/links/check", { linkIds: response.link ? [response.link.id] : undefined });
      setLatest(finalPrice);
      setProductUrl("");
      setMessage(finalPrice.message ?? "Product page price and final checkout price updated.");
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setAddingLink(false);
    }
  }

  async function removeLink(linkId: string) {
    await fetchJson(`/api/links/${linkId}`, { method: "DELETE" });
    await refresh();
  }

  async function startDarazLogin() {
    setMessage("Opening your Daraz browser session...");
    try {
      const response = await postJson<{ captureId: string; browserUrl?: string }>("/api/daraz/session/start", {});
      setCaptureId(response.captureId);
      setBrowserUrl(response.browserUrl ?? "");
      setMessage("Daraz browser opened on the server. Complete login or verification there, then save.");
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function saveDarazLogin() {
    if (!captureId) return;
    try {
      const response = await postJson<{ session?: DarazSession }>("/api/daraz/session/save", { captureId });
      setDarazSession(response.session ?? { status: "saved" });
      setMessage("Your Daraz session was saved.");
    } catch (error) {
      await refresh().catch(() => undefined);
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function resetDarazLogin() {
    const session = await postJson<DarazSession>("/api/daraz/session/reset", {});
    setDarazSession(session);
    setCaptureId("");
    setBrowserUrl("");
    setMessage("Daraz session reset.");
  }

  async function stopDarazBrowser() {
    const session = await postJson<DarazSession>("/api/daraz/session/stop", {});
    setDarazSession(session);
    setCaptureId("");
    setBrowserUrl("");
    setMessage("Remote Daraz browser closed.");
  }

  async function saveDarazCredentials(event: React.FormEvent) {
    event.preventDefault();
    try {
      await postJson("/api/daraz/credentials", { username: darazUsername, password: darazPassword });
      setDarazPassword("");
      setMessage("Daraz credentials saved for best-effort auto-login.");
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function deleteDarazCredentials() {
    await fetchJson("/api/daraz/credentials", { method: "DELETE" });
    setDarazUsername("");
    setDarazPassword("");
    setMessage("Saved Daraz credentials removed.");
    await refresh();
  }

  async function checkAllLinks() {
    if (links.length === 0) {
      setMessage("Save at least one Daraz link first.");
      return;
    }
    setChecking(true);
    setMessage("Checking saved links...");
    try {
      const result = await postJson<DarazCheckResult>("/api/links/check", {});
      setLatest(result);
      setMessage(result.message ?? "Price check finished.");
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setChecking(false);
    }
  }

  return (
    <>
      <section className="workspace">
        <section className="search-panel">
          <h2>Saved Daraz links</h2>
          <form className="toolbar" onSubmit={(event) => void addLink(event)}>
            <input value={productUrl} onChange={(event) => setProductUrl(event.target.value)} placeholder="Paste Daraz product URL" />
            <button type="submit" disabled={addingLink}>{addingLink ? "Checking..." : "Save and check"}</button>
          </form>
          {links.length === 0 ? <p className="empty">No saved links yet.</p> : (
            <div className="selected-list">
              {links.map((link) => (
                <div className="selected-item" key={link.id}>
                  <strong>{link.title}</strong>
                  <a href={link.url} target="_blank" rel="noreferrer">Open product</a>
                  <span>{formatMoney(parseObservedPrice(link))}</span>
                  <span>Qty 1</span>
                  <button type="button" className="text-button" onClick={() => void removeLink(link.id)}>Remove</button>
                </div>
              ))}
              <div className="selected-total">
                <span>Product-page total</span>
                <strong>{formatLkr(productPageTotal)}</strong>
              </div>
            </div>
          )}
        </section>

        <aside className="cart-box">
          <h2>Your Daraz session</h2>
          <p className={`session-state ${sessionClassName(darazSession.status)}`}>{sessionLabel(darazSession.status)}</p>
          <p>{darazSession.live ? "Your server-side Daraz browser is active." : "Connect your Daraz account before checking checkout totals."}</p>
          <div className="button-row">
            <button type="button" disabled={Boolean(captureId)} onClick={() => void startDarazLogin()}>
              {captureId ? "Browser active" : "Open Daraz browser"}
            </button>
            <button type="button" disabled={!captureId} onClick={() => void saveDarazLogin()}>Save session</button>
            <button type="button" className="light-button" disabled={!captureId && darazSession.status === "missing"} onClick={() => void resetDarazLogin()}>Reset</button>
            <button type="button" className="light-button" disabled={!captureId} onClick={() => void stopDarazBrowser()}>Stop browser</button>
          </div>
          {browserUrl && <a className="browser-link" href={browserUrl} target="_blank" rel="noreferrer">Open remote browser</a>}
          <button type="button" className="primary-action" disabled={checking || links.length === 0} onClick={() => void checkAllLinks()}>
            {checking ? "Checking..." : "Check saved links"}
          </button>
          <details className="remember-login">
            <summary>Optional Daraz auto-login</summary>
            <form className="inline-form" onSubmit={(event) => void saveDarazCredentials(event)}>
              <input value={darazUsername} onChange={(event) => setDarazUsername(event.target.value)} placeholder="Daraz email or phone" autoComplete="username" />
              <input value={darazPassword} onChange={(event) => setDarazPassword(event.target.value)} placeholder={credentials.saved ? "New password" : "Daraz password"} type="password" autoComplete="current-password" />
              <button type="submit">Save encrypted</button>
            </form>
            {credentials.saved && (
              <p>
                Saved for {credentials.username}. <button type="button" className="text-button" onClick={() => void deleteDarazCredentials()}>Remove</button>
              </p>
            )}
          </details>
          {darazSession.message && <p className="attention-message">{darazSession.message}</p>}
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
          <h2>Your previous checks</h2>
          <div className="history-list">
            {history.slice(0, 8).map((item) => (
              <button type="button" key={item.runId} onClick={() => setLatest(item)}>
                <span>{new Date(item.startedAt).toLocaleString()}</span>
                <strong>{plainStatus(item.status)}</strong>
              </button>
            ))}
          </div>
        </section>
      )}
    </>
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
        <span>Product price</span>
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
    platform_fee: "Online fee",
    service_fee: "Online fee",
    tax: "Tax",
    discount: "Discount",
    voucher: "Applicable coupon",
    total: "Total",
    other: "Other charge"
  };
  return item.label || kindLabel[item.kind];
}

function parseObservedPrice(link: SavedLink): Money | undefined {
  if (!link.observedPriceJson) {
    return undefined;
  }
  try {
    return JSON.parse(link.observedPriceJson) as Money;
  } catch {
    return undefined;
  }
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

function sessionLabel(status: DarazSessionStatus) {
  switch (status) {
    case "saved":
      return "Daraz login saved";
    case "needs_verification":
      return "Verification needed";
    case "needs_login":
      return "Login expired";
    case "unknown":
      return "Session needs check";
    default:
      return "Login required";
  }
}

function sessionClassName(status: DarazSessionStatus) {
  return status === "saved" ? "saved" : "required";
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
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
