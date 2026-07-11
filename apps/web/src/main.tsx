import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

type Money = { currency: string; minorUnits?: number; amount?: string | number };

type AppUser = {
  id: string;
  username: string;
  googleSub?: string;
  email?: string;
  displayName?: string;
  avatarUrl?: string;
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
  browserUrl?: string;
};

type DarazCredentialStatus = {
  saved: boolean;
  username?: string;
  updatedAt?: string;
};

type UserSettings = {
  autoPriceCheckEnabled: boolean;
  autoPriceCheckIntervalHours: number;
  autoPriceCheckNextRunAt?: string;
  autoPriceCheckLastRunAt?: string;
  autoPriceCheckLastJobId?: string;
  autoPriceCheckLastStatus?: PriceCheckJob["status"];
  autoPriceCheckLastMessage?: string;
  updatedAt: string;
};

type PriceCheckJob = {
  id: string;
  source: "link_added" | "manual" | "scheduled";
  status: "queued" | "running" | "completed" | "failed" | "needs_user_action" | "skipped";
  linkIds?: string[];
  runId?: string;
  message?: string;
  session?: DarazSession & { browserUrl?: string };
  queuedAt: string;
  startedAt?: string;
  finishedAt?: string;
  updatedAt: string;
};

type DarazSessionActionResponse = {
  status: "needs_user_action";
  message?: string;
  browserUrl?: string;
  session?: DarazSession & { browserUrl?: string };
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
    return <LoginScreen />;
  }

  return (
    <Dashboard
      user={user}
      onLogout={async () => {
        await postJson("/api/auth/logout", {});
        setUser(undefined);
      }}
    />
  );
}

function LoginScreen() {
  const authError = new URLSearchParams(window.location.search).get("auth_error");

  return (
    <main className="shell login-shell">
      <section className="login-panel">
        <h1>CartTruth</h1>
        <p>Sign in to check Daraz final prices from your own saved Daraz session.</p>
        <a className="button-link google-login" href="/api/auth/google/start">Continue with Google</a>
        {authError && <p className="attention-message">{authError}</p>}
      </section>
    </main>
  );
}

function Dashboard({ user, onLogout }: { user: AppUser; onLogout: () => Promise<void> }) {
  const [tab, setTab] = useState<"links" | "settings" | "admin">("links");

  return (
    <main className="shell">
      <header className="hero">
        <div>
          <p className="eyebrow">Daraz final price checker</p>
          <h1>{user.role === "admin" ? "Admin dashboard" : "Your Daraz dashboard"}</h1>
          <p>Logged in as {displayUser(user)}. Daraz sessions, links, and evidence are scoped to this Google account.</p>
        </div>
        <div className="button-row">
          <button type="button" className={tab === "links" ? "" : "light-button"} onClick={() => setTab("links")}>My links</button>
          <button type="button" className={tab === "settings" ? "" : "light-button"} onClick={() => setTab("settings")}>Settings</button>
          {user.role === "admin" && <button type="button" className={tab === "admin" ? "" : "light-button"} onClick={() => setTab("admin")}>Users</button>}
          <button type="button" className="light-button" onClick={() => void onLogout()}>Logout</button>
        </div>
      </header>

      {tab === "admin" && user.role === "admin" ? <AdminPanel /> : tab === "settings" ? <SettingsPanel /> : <UserPanel />}
    </main>
  );
}

function AdminPanel() {
  const [users, setUsers] = useState<AppUser[]>([]);
  const [message, setMessage] = useState("");

  useEffect(() => {
    void refresh();
  }, []);

  async function refresh() {
    const response = await fetchJson<{ users: AppUser[] }>("/api/admin/users");
    setUsers(response.users);
  }

  async function setDisabled(userId: string, disabled: boolean) {
    await postJson(`/api/admin/users/${userId}/disabled`, { disabled });
    setMessage(disabled ? "User disabled." : "User enabled.");
    await refresh();
  }

  return (
    <section className="price-section">
      <div className="section-title">
        <h2>Users</h2>
      </div>
      {message && <p className="message">{message}</p>}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Status</th>
              <th>Created</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {users.map((item) => (
              <tr key={item.id}>
                <td>{item.displayName ?? item.email ?? item.username}</td>
                <td>{item.email ?? "Legacy password user"}</td>
                <td>{item.role}</td>
                <td>{item.disabled ? "disabled" : "active"}</td>
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
  const [addingLink, setAddingLink] = useState(false);
  const [activeJob, setActiveJob] = useState<PriceCheckJob | undefined>();
  const [message, setMessage] = useState("");

  useEffect(() => {
    void refresh();
  }, []);

  const productPageTotal = useMemo(() => links.reduce((total, link) => {
    const observed = parseObservedPrice(link)?.minorUnits ?? 0;
    return total + observed;
  }, 0), [links]);
  const hasSavedCredentialsForExpiredSession = credentials.saved && darazSession.status !== "saved";

  async function refresh() {
    const [session, saved, runs, credentialStatus] = await Promise.all([
      fetchJson<DarazSession>("/api/daraz/session/status"),
      fetchJson<{ links: SavedLink[] }>("/api/links"),
      fetchJson<DarazCheckResult[]>("/api/daraz/runs"),
      fetchJson<DarazCredentialStatus>("/api/daraz/credentials")
    ]);
    setDarazSession(session);
    setCaptureId(session.captureId ?? "");
    setBrowserUrl(session.browserUrl ?? (session.live ? browserUrl : ""));
    setLinks(saved.links);
    setHistory(runs);
    setCredentials(credentialStatus);
    if (!latest && runs[0]) {
      setLatest(runs[0]);
    }
  }

  async function addLink(event: React.FormEvent) {
    event.preventDefault();
    setAddingLink(true);
    setMessage("Reading product page price...");
    try {
      const response = await postJson<{ link: SavedLink; checkJob: PriceCheckJob; message?: string }>("/api/links", { url: productUrl.trim() });
      if (response.link) {
        setLinks((items) => [response.link!, ...items.filter((item) => item.id !== response.link!.id)]);
      }
      setProductUrl("");
      setMessage("Final checkout price check queued.");
      await trackPriceCheckJob(response.checkJob.id);
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

  async function checkAllLinks() {
    if (links.length === 0) {
      setMessage("Save at least one Daraz link first.");
      return;
    }
    setChecking(true);
    setMessage(hasSavedCredentialsForExpiredSession ? "Reconnecting to Daraz..." : "Queueing saved-link check...");
    try {
      const response = await postJson<{ job: PriceCheckJob }>("/api/links/check-jobs", {});
      await trackPriceCheckJob(response.job.id);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setChecking(false);
    }
  }

  async function handleDarazSessionAction(response: DarazSessionActionResponse) {
    setBrowserUrl(response.browserUrl ?? response.session?.browserUrl ?? "");
    setCaptureId(response.session?.captureId ?? "");
    setDarazSession(response.session ?? darazSession);
    setMessage(response.message ?? "Daraz needs verification. Open the remote browser, finish it, then save session.");
  }

  async function trackPriceCheckJob(jobId: string) {
    let current: PriceCheckJob | undefined;
    for (let attempt = 0; attempt < 120; attempt += 1) {
      const response = await fetchJson<{ job: PriceCheckJob }>(`/api/price-check-jobs/${jobId}`);
      current = response.job;
      setActiveJob(current);
      if (current.status === "queued") {
        setMessage("Final checkout price check queued.");
      } else if (current.status === "running") {
        setMessage(hasSavedCredentialsForExpiredSession ? "Reconnecting to Daraz..." : "Checking final checkout price...");
      } else {
        break;
      }
      await delay(1000);
    }

    if (!current) {
      return;
    }
    if (current.status === "needs_user_action") {
      await handleDarazSessionAction({
        status: "needs_user_action",
        message: current.message,
        session: current.session,
        browserUrl: current.session?.browserUrl
      });
      await refresh().catch(() => undefined);
      return;
    }
    if (current.status === "completed" && current.runId) {
      const result = await fetchJson<DarazCheckResult>(`/api/daraz/runs/${current.runId}`);
      setLatest(result);
      setMessage(current.message ?? "Product page price and final checkout price updated.");
      await refresh();
      return;
    }
    setMessage(current.message ?? plainStatus(current.status));
    await refresh().catch(() => undefined);
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
          <p>{sessionHelpText(darazSession, credentials)}</p>
          <div className="button-row">
            {captureId && browserUrl ? (
              <a className="button-link" href={browserUrl} target="_blank" rel="noreferrer">Open remote browser</a>
            ) : (
              <button type="button" disabled={Boolean(captureId)} onClick={() => void startDarazLogin()}>
                {captureId ? "Browser active" : "Open Daraz browser"}
              </button>
            )}
            <button type="button" disabled={!captureId} onClick={() => void saveDarazLogin()}>Save session</button>
            <button type="button" className="light-button" disabled={!captureId && darazSession.status === "missing"} onClick={() => void resetDarazLogin()}>Reset</button>
            <button type="button" className="light-button" disabled={!captureId} onClick={() => void stopDarazBrowser()}>Stop browser</button>
          </div>
          {browserUrl && !captureId && <a className="browser-link" href={browserUrl} target="_blank" rel="noreferrer">Open remote browser</a>}
          <button type="button" className="primary-action" disabled={checking || links.length === 0} onClick={() => void checkAllLinks()}>
            {checking ? "Queued..." : "Check saved links"}
          </button>
          {activeJob && <p className="job-state">{priceCheckJobLabel(activeJob)}</p>}
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

function SettingsPanel() {
  const [settings, setSettings] = useState<UserSettings | undefined>();
  const [credentials, setCredentials] = useState<DarazCredentialStatus>({ saved: false });
  const [darazUsername, setDarazUsername] = useState("");
  const [darazPassword, setDarazPassword] = useState("");
  const [intervalHours, setIntervalHours] = useState(24);
  const [autoEnabled, setAutoEnabled] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    void refresh();
  }, []);

  async function refresh() {
    const [settingsResponse, credentialStatus] = await Promise.all([
      fetchJson<UserSettings>("/api/settings"),
      fetchJson<DarazCredentialStatus>("/api/daraz/credentials")
    ]);
    setSettings(settingsResponse);
    setAutoEnabled(settingsResponse.autoPriceCheckEnabled);
    setIntervalHours(settingsResponse.autoPriceCheckIntervalHours);
    setCredentials(credentialStatus);
    setDarazUsername(credentialStatus.username ?? "");
  }

  async function saveSettings(event: React.FormEvent) {
    event.preventDefault();
    try {
      const updated = await patchJson<UserSettings>("/api/settings", {
        autoPriceCheckEnabled: autoEnabled,
        autoPriceCheckIntervalHours: intervalHours
      });
      setSettings(updated);
      setMessage("Settings saved.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
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

  return (
    <section className="settings-grid">
      <section className="price-section">
        <div className="section-title">
          <h2>Auto Price Checking</h2>
          <span className={`status ${settings?.autoPriceCheckEnabled ? "checked" : "blocked"}`}>
            {settings?.autoPriceCheckEnabled ? "on" : "off"}
          </span>
        </div>
        <form className="settings-form" onSubmit={(event) => void saveSettings(event)}>
          <label className="checkbox-row">
            <input type="checkbox" checked={autoEnabled} onChange={(event) => setAutoEnabled(event.target.checked)} />
            <span>Run automatic final-price checks</span>
          </label>
          <label>
            Check interval in hours
            <input type="number" min={1} max={24} value={intervalHours} onChange={(event) => setIntervalHours(Number(event.target.value))} />
          </label>
          <button type="submit">Save settings</button>
        </form>
        <div className="settings-meta">
          <p>Next run: {settings?.autoPriceCheckEnabled && settings.autoPriceCheckNextRunAt ? new Date(settings.autoPriceCheckNextRunAt).toLocaleString() : "Not scheduled"}</p>
          <p>Last auto check: {settings?.autoPriceCheckLastRunAt ? `${new Date(settings.autoPriceCheckLastRunAt).toLocaleString()} (${settings.autoPriceCheckLastStatus ?? "unknown"})` : "None yet"}</p>
          {settings?.autoPriceCheckLastMessage && <p>{settings.autoPriceCheckLastMessage}</p>}
        </div>
      </section>

      <section className="price-section">
        <div className="section-title">
          <h2>Daraz Credentials</h2>
          <span className={`status ${credentials.saved ? "checked" : "needs_attention"}`}>{credentials.saved ? "saved" : "missing"}</span>
        </div>
        <form className="settings-form" onSubmit={(event) => void saveDarazCredentials(event)}>
          <input value={darazUsername} onChange={(event) => setDarazUsername(event.target.value)} placeholder="Daraz email or phone" autoComplete="username" />
          <input value={darazPassword} onChange={(event) => setDarazPassword(event.target.value)} placeholder={credentials.saved ? "New Daraz password" : "Daraz password"} type="password" autoComplete="current-password" />
          <button type="submit">Save encrypted</button>
        </form>
        {credentials.saved && (
          <p className="message">
            Saved for {credentials.username}. <button type="button" className="text-button" onClick={() => void deleteDarazCredentials()}>Remove</button>
          </p>
        )}
        {message && <p className="message">{message}</p>}
      </section>
    </section>
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

function priceCheckJobLabel(job: PriceCheckJob) {
  return `${plainStatus(job.source)}: ${plainStatus(job.status)}${job.message ? ` - ${job.message}` : ""}`;
}

function displayUser(user: AppUser) {
  return user.displayName ? `${user.displayName}${user.email ? ` (${user.email})` : ""}` : user.email ?? user.username;
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

function sessionHelpText(session: DarazSession, credentials: DarazCredentialStatus) {
  if (session.live) {
    return "Your server-side Daraz browser is active.";
  }
  if (credentials.saved && session.status !== "saved") {
    return "Auto-login credentials saved. CartTruth will try to reconnect before checking.";
  }
  return "Connect your Daraz account before checking checkout totals.";
}

function isDarazSessionActionResponse(value: unknown): value is DarazSessionActionResponse {
  return Boolean(value && typeof value === "object" && (value as { status?: unknown }).status === "needs_user_action");
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

async function patchJson<T = unknown>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error(await readErrorMessage(response));
  return response.json() as Promise<T>;
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
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
