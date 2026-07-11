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

type ApiKeyScope = "rest" | "mcp";

type ApiKey = {
  id: string;
  name: string;
  tokenPrefix: string;
  scopes: ApiKeyScope[];
  createdAt: string;
  lastUsedAt?: string;
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
  proxyCountryPreference: string;
  autoPriceCheckNextRunAt?: string;
  autoPriceCheckLastRunAt?: string;
  autoPriceCheckLastJobId?: string;
  autoPriceCheckLastStatus?: PriceCheckJob["status"];
  autoPriceCheckLastMessage?: string;
  updatedAt: string;
};

type ProxySummary = {
  enabled: boolean;
  fingerprint: string;
  id?: string;
  source?: string;
  poolType?: string;
  country?: string;
  masked?: string;
};

type ProxyEvent = {
  id: string;
  operation: string;
  userId?: string;
  apiKeyId?: string;
  apiKeyPrefix?: string;
  source: "web" | "rest" | "mcp" | "scheduled" | "system";
  proxyFingerprint: string;
  proxyCountry?: string;
  proxySource?: string;
  proxyPoolType?: string;
  status: "success" | "failure" | "blocked" | "skipped";
  elapsedMs?: number;
  errorMessage?: string;
  createdAt: string;
};

type ProxyEventSummary = {
  total: number;
  apiKeyEvents: number;
  lastEvent?: ProxyEvent;
  byStatus: Array<{ key: ProxyEvent["status"]; count: number }>;
  bySource: Array<{ key: ProxyEvent["source"]; count: number }>;
  byCountry: Array<{ key: string; count: number }>;
};

type ProxyStatusResponse = {
  proxy: ProxySummary;
  countryOptions: string[];
};

type AdminProxySummary = ProxyStatusResponse & {
  events: ProxyEventSummary;
  external: {
    provider: string;
    apiConfigured: boolean;
    syncStatus: string;
    note: string;
  };
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
  const [path, setPath] = useState(window.location.pathname);

  useEffect(() => {
    void refreshMe();
  }, []);

  useEffect(() => {
    const onPopState = () => setPath(window.location.pathname);
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  async function refreshMe() {
    const response = await fetchJson<{ user?: AppUser }>("/api/auth/me");
    setUser(response.user);
    setAuthChecked(true);
  }

  function navigate(pathname: string) {
    window.history.pushState({}, "", pathname);
    setPath(pathname);
  }

  if (!authChecked) {
    return <main className="shell"><p className="empty">Loading...</p></main>;
  }

  if (path === "/docs") {
    return <DocsPage user={user} onNavigate={navigate} />;
  }

  if (!user) {
    return <LoginScreen onNavigate={navigate} />;
  }

  return (
    <Dashboard
      user={user}
      onNavigate={navigate}
      onLogout={async () => {
        await postJson("/api/auth/logout", {});
        setUser(undefined);
      }}
    />
  );
}

function LoginScreen({ onNavigate }: { onNavigate: (path: string) => void }) {
  const authError = new URLSearchParams(window.location.search).get("auth_error");

  return (
    <main className="shell login-shell">
      <section className="login-panel">
        <h1>CartTruth</h1>
        <p>Sign in to check Daraz final prices from your own saved Daraz session.</p>
        <a className="button-link google-login" href="/api/auth/google/start">Continue with Google</a>
        <button type="button" className="light-button full-width" onClick={() => onNavigate("/docs")}>Read API and MCP docs</button>
        {authError && <p className="attention-message">{authError}</p>}
      </section>
    </main>
  );
}

function Dashboard({ user, onLogout, onNavigate }: { user: AppUser; onLogout: () => Promise<void>; onNavigate: (path: string) => void }) {
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
          <button type="button" className="light-button" onClick={() => onNavigate("/docs")}>Docs</button>
          <button type="button" className="light-button" onClick={() => void onLogout()}>Logout</button>
        </div>
      </header>

      {tab === "admin" && user.role === "admin" ? <AdminPanel /> : tab === "settings" ? <SettingsPanel /> : <UserPanel />}
    </main>
  );
}

function AdminPanel() {
  const [users, setUsers] = useState<AppUser[]>([]);
  const [proxySummary, setProxySummary] = useState<AdminProxySummary | undefined>();
  const [proxyEvents, setProxyEvents] = useState<ProxyEvent[]>([]);
  const [proxyTest, setProxyTest] = useState<{ ok: boolean; status: number; elapsedMs: number; proxy: string; bodyPreview: string } | undefined>();
  const [testingProxy, setTestingProxy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    void refresh();
  }, []);

  async function refresh() {
    const [response, proxy, events] = await Promise.all([
      fetchJson<{ users: AppUser[] }>("/api/admin/users"),
      fetchJson<AdminProxySummary>("/api/admin/proxy/summary"),
      fetchJson<{ events: ProxyEvent[] }>("/api/admin/proxy/events?limit=12")
    ]);
    setUsers(response.users);
    setProxySummary(proxy);
    setProxyEvents(events.events);
  }

  async function setDisabled(userId: string, disabled: boolean) {
    await postJson(`/api/admin/users/${userId}/disabled`, { disabled });
    setMessage(disabled ? "User disabled." : "User enabled.");
    await refresh();
  }

  async function testProxy() {
    setTestingProxy(true);
    setMessage("");
    try {
      const result = await postJson<{ ok: boolean; status: number; elapsedMs: number; proxy: string; bodyPreview: string }>("/api/admin/proxy/test", { timeoutMs: 10000 });
      setProxyTest(result);
      setMessage(result.ok ? "Proxy connectivity test completed." : "Proxy connectivity test returned a non-OK response.");
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
      await refresh().catch(() => undefined);
    } finally {
      setTestingProxy(false);
    }
  }

  return (
    <>
      <section className="admin-grid">
        <section className="price-section">
          <div className="section-title">
            <h2>Users</h2>
          </div>
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

        <section className="price-section proxy-admin-panel">
          <div className="section-title">
            <h2>Proxy Operations</h2>
            <span className={`status ${proxySummary?.proxy.enabled ? "checked" : "needs_attention"}`}>
              {proxySummary?.proxy.enabled ? "TorchProxies configured" : "setup required"}
            </span>
          </div>
          <div className="proxy-facts">
            <p><span>Provider</span><strong>{proxySummary?.proxy.source ?? "not configured"}</strong></p>
            <p><span>Profile</span><strong>{proxySummary?.proxy.id ?? "none"}</strong></p>
            <p><span>Pool</span><strong>{proxySummary?.proxy.poolType ?? "unknown"}</strong></p>
            <p><span>Country</span><strong>{proxySummary?.proxy.country ?? "unknown"}</strong></p>
            <p><span>Endpoint</span><strong>{proxySummary?.proxy.masked ?? "none"}</strong></p>
          </div>
          <div className="proxy-metrics">
            <Metric label="Events" value={String(proxySummary?.events.total ?? 0)} />
            <Metric label="API key events" value={String(proxySummary?.events.apiKeyEvents ?? 0)} />
            <Metric label="External API" value={proxySummary?.external.apiConfigured ? "configured" : "not configured"} />
          </div>
          <button type="button" className="light-button" disabled={testingProxy} onClick={() => void testProxy()}>
            {testingProxy ? "Testing..." : "Run proxy test"}
          </button>
          {proxyTest && (
            <p className="message">
              Last test: {proxyTest.ok ? "OK" : "Failed"} ({proxyTest.status}) in {proxyTest.elapsedMs}ms via {proxyTest.proxy}
            </p>
          )}
          <p className="message">{proxySummary?.external.note}</p>
        </section>
      </section>

      <section className="price-section">
        <div className="section-title">
          <h2>Recent proxy events</h2>
          <button type="button" className="text-button" onClick={() => void refresh()}>Refresh</button>
        </div>
        {message && <p className="message">{message}</p>}
        <div className="event-summary">
          <Metric label="Status" value={formatCounts(proxySummary?.events.byStatus)} />
          <Metric label="Source" value={formatCounts(proxySummary?.events.bySource)} />
          <Metric label="Country" value={formatCounts(proxySummary?.events.byCountry)} />
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>Operation</th>
                <th>Source</th>
                <th>Status</th>
                <th>Proxy</th>
                <th>API key</th>
              </tr>
            </thead>
            <tbody>
              {proxyEvents.length === 0 ? (
                <tr><td colSpan={6}>No proxy events yet.</td></tr>
              ) : proxyEvents.map((event) => (
                <tr key={event.id}>
                  <td>{new Date(event.createdAt).toLocaleString()}</td>
                  <td>{event.operation}{event.errorMessage && <small>{event.errorMessage}</small>}</td>
                  <td>{event.source}</td>
                  <td>{event.status}{event.elapsedMs !== undefined && <small>{event.elapsedMs}ms</small>}</td>
                  <td>{event.proxySource ?? "none"} / {event.proxyPoolType ?? "unknown"} / {event.proxyCountry ?? "unknown"}</td>
                  <td>{event.apiKeyPrefix ?? "none"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
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
          {activeJob && (
            <>
              <p className="job-state">{priceCheckJobLabel(activeJob)}</p>
              {activeJob.status === "needs_user_action" && activeJob.session?.browserUrl && (
                <a className="browser-link" href={activeJob.session.browserUrl} target="_blank" rel="noreferrer">Open remote browser</a>
              )}
            </>
          )}
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
  const [proxyStatus, setProxyStatus] = useState<ProxySummary | undefined>();
  const [countryOptions, setCountryOptions] = useState<string[]>(["US", "GB", "CA", "AU", "DE", "FR", "NL", "SG", "IN", "LK"]);
  const [proxyCountry, setProxyCountry] = useState("US");
  const [stickyPreview, setStickyPreview] = useState(true);
  const [rotatePreview, setRotatePreview] = useState(false);
  const [fallbackPreview, setFallbackPreview] = useState(true);
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
    const [settingsResponse, credentialStatus, proxyResponse] = await Promise.all([
      fetchJson<UserSettings>("/api/settings"),
      fetchJson<DarazCredentialStatus>("/api/daraz/credentials"),
      fetchJson<ProxyStatusResponse>("/api/proxy/status")
    ]);
    setSettings(settingsResponse);
    setAutoEnabled(settingsResponse.autoPriceCheckEnabled);
    setIntervalHours(settingsResponse.autoPriceCheckIntervalHours);
    setProxyCountry(settingsResponse.proxyCountryPreference);
    setProxyStatus(proxyResponse.proxy);
    setCountryOptions(proxyResponse.countryOptions);
    setCredentials(credentialStatus);
    setDarazUsername(credentialStatus.username ?? "");
  }

  async function saveSettings(event: React.FormEvent) {
    event.preventDefault();
    try {
      const updated = await patchJson<UserSettings>("/api/settings", {
        autoPriceCheckEnabled: autoEnabled,
        autoPriceCheckIntervalHours: intervalHours,
        proxyCountryPreference: proxyCountry
      });
      setSettings(updated);
      setProxyCountry(updated.proxyCountryPreference);
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

      <section className="price-section">
        <div className="section-title">
          <h2>TorchProxies Network</h2>
          <span className={`status ${proxyStatus?.enabled ? "checked" : "needs_attention"}`}>
            {proxyStatus?.enabled ? "TorchProxies configured" : "setup required"}
          </span>
        </div>
        <div className="proxy-facts">
          <p><span>Active profile</span><strong>{proxyStatus?.id ?? "none"}</strong></p>
          <p><span>Pool</span><strong>{proxyStatus?.poolType ?? "unknown"}</strong></p>
          <p><span>Active country</span><strong>{proxyStatus?.country ?? "unknown"}</strong></p>
          <p><span>Endpoint</span><strong>{proxyStatus?.masked ?? "none"}</strong></p>
        </div>
        <form className="settings-form proxy-preview-form" onSubmit={(event) => void saveSettings(event)}>
          <label>
            Requested country
            <select value={proxyCountry} onChange={(event) => setProxyCountry(event.target.value)}>
              {countryOptions.map((country) => (
                <option key={country} value={country}>{countryLabel(country)}</option>
              ))}
            </select>
          </label>
          <label className="checkbox-row">
            <input type="checkbox" checked={stickyPreview} onChange={(event) => setStickyPreview(event.target.checked)} />
            <span>Sticky checkout session</span>
          </label>
          <label className="checkbox-row">
            <input type="checkbox" checked={rotatePreview} onChange={(event) => setRotatePreview(event.target.checked)} />
            <span>Rotate proxy before next check</span>
          </label>
          <label className="checkbox-row">
            <input type="checkbox" checked={fallbackPreview} onChange={(event) => setFallbackPreview(event.target.checked)} />
            <span>Auto fallback country</span>
          </label>
          <button type="submit">Save network preference</button>
        </form>
        <div className="settings-meta">
          <p>MVP preview: requested country is saved but not applied to live routing yet.</p>
          <p>Powered by configured TorchProxies profile when proxy status is enabled.</p>
        </div>
      </section>

      <ApiKeysPanel />
    </section>
  );
}

function ApiKeysPanel() {
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [name, setName] = useState("Automation key");
  const [restEnabled, setRestEnabled] = useState(true);
  const [mcpEnabled, setMcpEnabled] = useState(true);
  const [newToken, setNewToken] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    void refresh();
  }, []);

  async function refresh() {
    const response = await fetchJson<{ apiKeys: ApiKey[] }>("/api/api-keys");
    setApiKeys(response.apiKeys);
  }

  async function createApiKey(event: React.FormEvent) {
    event.preventDefault();
    const scopes = selectedScopes(restEnabled, mcpEnabled);
    if (scopes.length === 0) {
      setMessage("Select REST, MCP, or both.");
      return;
    }
    try {
      const response = await postJson<{ apiKey: ApiKey; token: string }>("/api/api-keys", { name, scopes });
      setNewToken(response.token);
      setMessage("API key created. Copy it now; CartTruth will not show it again.");
      setApiKeys((items) => [response.apiKey, ...items]);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function updateApiKey(apiKey: ApiKey, input: { name: string; scopes: ApiKeyScope[] }) {
    const response = await patchJson<{ apiKey: ApiKey }>(`/api/api-keys/${apiKey.id}`, input);
    setApiKeys((items) => items.map((item) => item.id === apiKey.id ? response.apiKey : item));
    setMessage("API key updated.");
  }

  async function deleteApiKey(apiKey: ApiKey) {
    await fetchJson(`/api/api-keys/${apiKey.id}`, { method: "DELETE" });
    setApiKeys((items) => items.filter((item) => item.id !== apiKey.id));
    setMessage("API key deleted.");
  }

  async function copyNewToken() {
    await navigator.clipboard.writeText(newToken);
    setMessage("API key copied.");
  }

  return (
    <section className="price-section api-key-panel">
      <div className="section-title">
        <h2>API Keys</h2>
        <span className="status checked">{apiKeys.length}</span>
      </div>
      <form className="settings-form" onSubmit={(event) => void createApiKey(event)}>
        <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Key name" />
        <div className="scope-row">
          <label className="checkbox-row">
            <input type="checkbox" checked={restEnabled} onChange={(event) => setRestEnabled(event.target.checked)} />
            <span>REST</span>
          </label>
          <label className="checkbox-row">
            <input type="checkbox" checked={mcpEnabled} onChange={(event) => setMcpEnabled(event.target.checked)} />
            <span>MCP</span>
          </label>
        </div>
        <button type="submit">Create key</button>
      </form>
      {newToken && (
        <div className="token-box">
          <span>{newToken}</span>
          <button type="button" className="light-button" onClick={() => void copyNewToken()}>Copy</button>
        </div>
      )}
      <div className="api-key-list">
        {apiKeys.length === 0 ? <p className="empty">No API keys yet.</p> : apiKeys.map((apiKey) => (
          <ApiKeyRow
            key={apiKey.id}
            apiKey={apiKey}
            onSave={(input) => void updateApiKey(apiKey, input)}
            onDelete={() => void deleteApiKey(apiKey)}
          />
        ))}
      </div>
      {message && <p className="message">{message}</p>}
    </section>
  );
}

function ApiKeyRow({ apiKey, onSave, onDelete }: {
  apiKey: ApiKey;
  onSave: (input: { name: string; scopes: ApiKeyScope[] }) => void;
  onDelete: () => void;
}) {
  const [name, setName] = useState(apiKey.name);
  const [restEnabled, setRestEnabled] = useState(apiKey.scopes.includes("rest"));
  const [mcpEnabled, setMcpEnabled] = useState(apiKey.scopes.includes("mcp"));
  const scopes = selectedScopes(restEnabled, mcpEnabled);

  useEffect(() => {
    setName(apiKey.name);
    setRestEnabled(apiKey.scopes.includes("rest"));
    setMcpEnabled(apiKey.scopes.includes("mcp"));
  }, [apiKey]);

  return (
    <div className="api-key-row">
      <div>
        <input value={name} onChange={(event) => setName(event.target.value)} aria-label="API key name" />
        <p>
          <span>{apiKey.tokenPrefix}...</span>
          <span>Created {new Date(apiKey.createdAt).toLocaleDateString()}</span>
          <span>Last used {apiKey.lastUsedAt ? new Date(apiKey.lastUsedAt).toLocaleString() : "never"}</span>
        </p>
      </div>
      <div className="scope-row">
        <label className="checkbox-row">
          <input type="checkbox" checked={restEnabled} onChange={(event) => setRestEnabled(event.target.checked)} />
          <span>REST</span>
        </label>
        <label className="checkbox-row">
          <input type="checkbox" checked={mcpEnabled} onChange={(event) => setMcpEnabled(event.target.checked)} />
          <span>MCP</span>
        </label>
      </div>
      <div className="api-key-actions">
        <button type="button" className="light-button" disabled={!name.trim() || scopes.length === 0} onClick={() => onSave({ name: name.trim(), scopes })}>Save</button>
        <button type="button" className="text-button" onClick={onDelete}>Delete</button>
      </div>
    </div>
  );
}

function selectedScopes(restEnabled: boolean, mcpEnabled: boolean): ApiKeyScope[] {
  return [
    ...(restEnabled ? ["rest" as const] : []),
    ...(mcpEnabled ? ["mcp" as const] : [])
  ];
}

function DocsPage({ user, onNavigate }: { user?: AppUser; onNavigate: (path: string) => void }) {
  const baseUrl = window.location.origin;
  const apiKey = "ct_your_api_key";

  return (
    <main className="shell docs-shell">
      <header className="hero">
        <div>
          <p className="eyebrow">CartTruth developer docs</p>
          <h1>REST API and MCP</h1>
          <p>Automate saved links, settings, queued checks, jobs, and run history with scoped API keys.</p>
        </div>
        <div className="button-row">
          {user ? (
            <button type="button" onClick={() => onNavigate("/")}>Dashboard</button>
          ) : (
            <a className="button-link" href="/api/auth/google/start">Sign in</a>
          )}
        </div>
      </header>

      <section className="docs-layout">
        <aside className="docs-nav">
          <a href="#quickstart">Quickstart</a>
          <a href="#rest">REST API</a>
          <a href="#mcp">MCP</a>
          <a href="#security">Security</a>
        </aside>

        <article className="docs-content">
          <section id="quickstart">
            <h2>Quickstart</h2>
            <p>Create a key from Settings after signing in. Choose REST, MCP, or both. Copy the token immediately; only its prefix is shown later.</p>
            <CodeBlock code={`export CARTTRUTH_API_KEY=${apiKey}
curl ${baseUrl}/api/v1/links \\
  -H "Authorization: Bearer $CARTTRUTH_API_KEY"`} />
          </section>

          <section id="rest">
            <h2>REST API</h2>
            <p>REST endpoints live under <code>/api/v1</code> and use bearer authentication. Responses are JSON. Task-creating calls return queued jobs that can be polled.</p>
            <div className="endpoint-list">
              <span>GET /api/v1/me</span>
              <span>GET /api/v1/links</span>
              <span>POST /api/v1/links</span>
              <span>DELETE /api/v1/links/:linkId</span>
              <span>GET /api/v1/settings</span>
              <span>PATCH /api/v1/settings</span>
              <span>POST /api/v1/links/check-jobs</span>
              <span>GET /api/v1/price-check-jobs</span>
              <span>GET /api/v1/price-check-jobs/:jobId</span>
              <span>GET /api/v1/runs</span>
              <span>GET /api/v1/runs/:runId</span>
            </div>
            <h3>Add a link and queue a check</h3>
            <CodeBlock code={`curl ${baseUrl}/api/v1/links \\
  -H "Authorization: Bearer $CARTTRUTH_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"url":"https://www.daraz.lk/products/example.html"}'`} />
            <h3>Poll a job</h3>
            <CodeBlock code={`const apiKey = process.env.CARTTRUTH_API_KEY;

async function carttruth(path, init = {}) {
  const response = await fetch("${baseUrl}/api/v1" + path, {
    ...init,
    headers: {
      authorization: \`Bearer \${apiKey}\`,
      "content-type": "application/json",
      ...(init.headers || {})
    }
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

const { job } = await carttruth("/links/check-jobs", {
  method: "POST",
  body: JSON.stringify({})
});
const latest = await carttruth(\`/price-check-jobs/\${job.id}\`);`} />
          </section>

          <section id="mcp">
            <h2>MCP</h2>
            <p>The MCP endpoint is <code>{baseUrl}/mcp</code>. Keys must include the MCP scope. Available tools mirror the REST automation surface.</p>
            <h3>Codex</h3>
            <CodeBlock code={`# ~/.codex/config.toml
[mcp_servers.carttruth]
url = "${baseUrl}/mcp"
bearer_token_env_var = "CARTTRUTH_API_KEY"`} />
            <h3>Cursor</h3>
            <CodeBlock code={`{
  "mcpServers": {
    "carttruth": {
      "url": "${baseUrl}/mcp",
      "headers": {
        "Authorization": "Bearer \${env:CARTTRUTH_API_KEY}"
      }
    }
  }
}`} />
            <h3>Claude Code</h3>
            <CodeBlock code={`claude mcp add --transport http carttruth ${baseUrl}/mcp \\
  --header "Authorization: Bearer $CARTTRUTH_API_KEY"`} />
            <h3>VS Code</h3>
            <CodeBlock code={`{
  "inputs": [
    {
      "id": "carttruth-api-key",
      "type": "promptString",
      "description": "CartTruth API key",
      "password": true
    }
  ],
  "servers": {
    "carttruth": {
      "type": "http",
      "url": "${baseUrl}/mcp",
      "headers": {
        "Authorization": "Bearer \${input:carttruth-api-key}"
      }
    }
  }
}`} />
          </section>

          <section id="security">
            <h2>Security</h2>
            <p>Use the narrowest surface scope that works, keep tokens in environment variables or secret managers, rotate keys that may have been exposed, and delete unused keys. Rate limits return <code>429</code> with <code>Retry-After</code> and <code>x-ratelimit-*</code> headers.</p>
            <p>API and MCP clients cannot save Daraz credentials or control the remote browser. If a job needs login, OTP, captcha, or verification, finish that step in the CartTruth web dashboard and retry the check.</p>
          </section>
        </article>
      </section>
    </main>
  );
}

function CodeBlock({ code }: { code: string }) {
  return <pre><code>{code}</code></pre>;
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

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function formatCounts(items?: Array<{ key: string; count: number }>) {
  if (!items || items.length === 0) {
    return "none";
  }
  return items.slice(0, 3).map((item) => `${plainStatus(item.key)} ${item.count}`).join(", ");
}

function countryLabel(country: string) {
  const names: Record<string, string> = {
    US: "United States",
    GB: "United Kingdom",
    CA: "Canada",
    AU: "Australia",
    DE: "Germany",
    FR: "France",
    NL: "Netherlands",
    SG: "Singapore",
    IN: "India",
    LK: "Sri Lanka"
  };
  return `${country} - ${names[country] ?? country}`;
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
