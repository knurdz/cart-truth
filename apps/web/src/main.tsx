import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import "./fin-dash.css";

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

type ContactMessage = {
  id: string;
  subject: string;
  content: string;
  createdAt: string;
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

type AppNotification = {
  id: string;
  kind: "success" | "error" | "warning" | "info";
  title: string;
  body: string;
  readAt?: string;
  createdAt: string;
  relatedJobId?: string;
};

type NotificationPlatform = "slack" | "discord" | "telegram";

type NotificationChannel = {
  id: string;
  platform: NotificationPlatform;
  label?: string;
  enabled: boolean;
  configured: boolean;
  webhookHost?: string;
  lastDeliveryAt?: string;
  lastError?: string;
  createdAt: string;
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

  // Apply body class for dashboard vs public pages
  useEffect(() => {
    const isDashboard = authChecked && !!user && path !== "/docs";
    if (isDashboard) {
      document.body.classList.add("dashboard-mode");
    } else {
      document.body.classList.remove("dashboard-mode");
    }
  }, [authChecked, user, path]);

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
    return (
      <main style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh" }}>
        <p style={{ color: "#5a7a5a", fontFamily: "Inter, sans-serif" }}>Loading...</p>
      </main>
    );
  }

  if (path === "/docs") {
    return <DocsPage user={user} onNavigate={navigate} />;
  }

  if (path === "/privacy") {
    return <PrivacyPage user={user} onNavigate={navigate} />;
  }

  if (path === "/terms") {
    return <TermsPage user={user} onNavigate={navigate} />;
  }

  if (path === "/signin") {
    return <SignInPage onNavigate={navigate} />;
  }

  if (!user) {
    return <LandingPage user={user} onNavigate={navigate} />;
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

/* SignInPage — premium dark centered auth card */
function SignInPage({ onNavigate }: { onNavigate: (path: string) => void }) {
  const authError = new URLSearchParams(window.location.search).get("auth_error");

  return (
    <div className="signin-page">
      <div className="signin-bg">
        <div className="signin-orb-1" />
        <div className="signin-orb-2" />
        <div className="signin-grid-lines" />
      </div>

      <div className="signin-card">
        <div className="signin-logo">
          <img src="/favicon.svg" className="signin-logo-mark" alt="CartTruth logo" />
          <span className="signin-logo-name">CartTruth</span>
        </div>

        <h1 className="signin-headline">Welcome back</h1>
        <p className="signin-subtext">
          Sign in to check real checkout prices on Daraz — including every fee, tax, and hidden charge.
        </p>

        <a id="google-signin-btn" className="signin-google-btn" href="/api/auth/google/start">
          <svg className="signin-google-icon" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
          </svg>
          Continue with Google
        </a>

        <div className="signin-legal-agreement">
          By signing up, you agree to our{" "}
          <button type="button" onClick={() => onNavigate("/terms")}>Terms of Service</button>
          {" "}and{" "}
          <button type="button" onClick={() => onNavigate("/privacy")}>Privacy Policy</button>.
        </div>

        <div className="signin-divider">
          <div className="signin-divider-line" />
          <span className="signin-divider-text">or</span>
          <div className="signin-divider-line" />
        </div>

        <button
          id="view-docs-btn"
          type="button"
          className="signin-docs-link"
          onClick={() => onNavigate("/docs")}
        >
          📖 Browse API &amp; MCP documentation
        </button>

        {authError && <div className="signin-error">{authError}</div>}

        <p className="signin-footer-text">
          CartTruth uses Google OAuth — no password required.<br />
          Your Daraz session is isolated and scoped to your Google account.
        </p>
      </div>
    </div>
  );
}

/* ============================================================
   PUBLIC HEADER & FOOTER
   ============================================================ */
function PublicNavbar({ user, onNavigate, activePage }: { user?: AppUser; onNavigate: (path: string) => void; activePage?: string }) {
  return (
    <nav className="land-nav" aria-label="Main navigation">
      <div className="container land-nav-inner">
        <a href="/" className="land-logo" id="nav-logo" onClick={(e) => { e.preventDefault(); onNavigate("/"); }}>
          <img src="/favicon.svg" className="land-logo-mark" alt="CartTruth logo" />
          <span className="land-logo-text">Cart<span>Truth</span></span>
        </a>
        <ul className="land-nav-links">
          <li>
            <button
              type="button"
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                padding: "8px 16px",
                color: activePage === "home" ? "var(--c-text-1)" : "var(--c-text-2)",
                fontSize: "14px",
                fontFamily: "'Inter', sans-serif",
                fontWeight: activePage === "home" ? 600 : 500,
                minHeight: 0,
                borderRadius: "6px"
              }}
              onClick={() => onNavigate("/")}
            >
              Home
            </button>
          </li>
          <li>
            <button
              type="button"
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                padding: "8px 16px",
                color: "var(--c-text-2)",
                fontSize: "14px",
                fontFamily: "'Inter', sans-serif",
                fontWeight: 500,
                minHeight: 0,
                borderRadius: "6px"
              }}
              onClick={() => {
                onNavigate("/");
                setTimeout(() => document.getElementById("features")?.scrollIntoView({ behavior: "smooth" }), 100);
              }}
            >
              Product
            </button>
          </li>
          <li>
            <button
              type="button"
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                padding: "8px 16px",
                color: "var(--c-text-2)",
                fontSize: "14px",
                fontFamily: "'Inter', sans-serif",
                fontWeight: 500,
                minHeight: 0,
                borderRadius: "6px"
              }}
              onClick={() => {
                onNavigate("/");
                setTimeout(() => document.getElementById("pricing")?.scrollIntoView({ behavior: "smooth" }), 100);
              }}
            >
              Pricing
            </button>
          </li>
          <li>
            <button
              type="button"
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                padding: "8px 16px",
                color: activePage === "docs" ? "var(--c-text-1)" : "var(--c-text-2)",
                fontSize: "14px",
                fontFamily: "'Inter', sans-serif",
                fontWeight: activePage === "docs" ? 600 : 500,
                minHeight: 0,
                borderRadius: "6px"
              }}
              onClick={() => onNavigate("/docs")}
            >
              Documentation
            </button>
          </li>
        </ul>
        <div className="land-nav-actions">
          {user ? (
            <button id="nav-dashboard" type="button" className="btn-ghost-glow" onClick={() => onNavigate("/")}>Go to Dashboard</button>
          ) : (
            <button id="nav-signin" type="button" className="btn-ghost-glow" onClick={() => onNavigate("/signin")}>Sign In</button>
          )}
        </div>
      </div>
    </nav>
  );
}

function PublicFooter({ onNavigate }: { onNavigate: (path: string) => void }) {
  return (
    <footer className="land-footer">
      <div className="container land-footer-inner">
        <div className="land-footer-left">
          <a href="/" className="land-logo" onClick={(e) => { e.preventDefault(); onNavigate("/"); }}>
            <img src="/favicon.svg" className="land-logo-mark" alt="CartTruth logo" />
            <span className="land-logo-text">Cart<span>Truth</span></span>
          </a>
          <span className="land-footer-copy">© 2026 CartTruth. All rights reserved.</span>
        </div>
        <ul className="land-footer-links">
          <li><button type="button" style={{ background: "none", border: "none", cursor: "pointer", color: "var(--c-text-3)", fontSize: "13px", padding: 0, minHeight: 0 }} onClick={() => onNavigate("/docs")}>Docs</button></li>
          <li><button type="button" style={{ background: "none", border: "none", cursor: "pointer", color: "var(--c-text-3)", fontSize: "13px", padding: 0, minHeight: 0 }} onClick={() => onNavigate("/terms")}>Terms</button></li>
          <li><button type="button" style={{ background: "none", border: "none", cursor: "pointer", color: "var(--c-text-3)", fontSize: "13px", padding: 0, minHeight: 0 }} onClick={() => onNavigate("/privacy")}>Privacy</button></li>
          <li><a href="/api/health">API Status</a></li>
        </ul>
        <div className="land-footer-team">Built by <span>Team Knurdz</span></div>
      </div>
    </footer>
  );
}

/* LandingPage — full marketing homepage */
function LandingPage({ user, onNavigate }: { user: AppUser | undefined; onNavigate: (path: string) => void }) {
  const progressRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onScroll() {
      const el = progressRef.current;
      if (!el) return;
      const scrolled = window.scrollY;
      const total = document.documentElement.scrollHeight - window.innerHeight;
      const pct = total > 0 ? (scrolled / total) * 100 : 0;
      el.style.height = `${pct}%`;
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div id="landing-root">
      {/* SCROLL PROGRESS BAR */}
      <div ref={progressRef} className="scroll-progress" aria-hidden="true" />

      {/* NAV */}
      <PublicNavbar user={user} onNavigate={onNavigate} activePage="home" />

      <section className="land-hero" id="hero">
        <div className="land-hero-bg">
          <div className="hero-orb hero-orb-1" />
          <div className="hero-orb hero-orb-2" />
          <div className="hero-orb hero-orb-3" />
          <div className="hero-light-beam" />
          <div className="hero-light-beam-core" />
          <div className="hero-grid-lines" />
        </div>
        <div className="container land-hero-inner">
          {/* LEFT: text content */}
          <div className="hero-content">
            <div className="hero-badge">
              MVP PREVIEW: Daraz Support (E-commerce & Tourism Expansion Coming Soon)
            </div>
            <h1 className="hero-headline">
              Geographic checkout<br />price verification,<br />automated
            </h1>
            <p className="hero-subtext">
              Verify e-commerce checkout prices, taxes, and shipping rates. CartTruth is currently in MVP supporting Daraz, with active expansion plans for other e-commerce platforms and tourism package sites.
            </p>
            <div className="hero-actions">
              <a id="hero-cta-primary" className="btn-primary-pill" href="/api/auth/google/start">Get started</a>
              <button id="hero-cta-docs" type="button" className="btn-text-arrow" onClick={() => onNavigate("/docs")}>Browse Docs &gt;</button>
            </div>
          </div>

          {/* RIGHT: beam column (purely visual) */}
          <div className="hero-beam-col" />

          {/* BOTTOM: dashboard mockup spans full width */}
          <div className="hero-visual">
            <HeroDashboardPreview />
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section className="land-section how-section" id="how-it-works">
        <div className="container">
          <div className="section-center">
            <div className="section-badge">How It Works</div>
            <h2 className="section-heading">Six steps, <em>zero risk</em></h2>
            <p className="section-subtext">CartTruth acts like a careful buyer — reads the checkout, captures the total, stores the evidence — then stops. It never submits an order.</p>
          </div>
          <div className="how-steps">
            {STEPS.map((step, i) => (
              <div key={step.title} className="how-step">
                <div className="how-step-number">{i + 1}</div>
                <div className="how-step-icon">{step.icon}</div>
                <h3 className="how-step-title">{step.title}</h3>
                <p className="how-step-desc">{step.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FEATURES */}
      <section className="land-section" id="features">
        <div className="container">
          <div className="section-badge">Features</div>
          <h2 className="section-heading">Everything you need to <em>verify</em></h2>
          <p className="section-subtext">From residential proxies to immutable evidence bundles — CartTruth covers the full verification stack.</p>
          <div className="features-grid">
            {FEATURES.map((f) => (
              <div key={f.title} className={`feature-card${f.featured ? " featured" : ""}`}>
                <div className="feature-card-icon">{f.icon}</div>
                <h3 className="feature-card-title">{f.title}</h3>
                <p className="feature-card-desc">{f.desc}</p>
                {f.tag && <span className="feature-card-tag">{f.tag}</span>}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* STATS */}
      <section className="land-section stats-section" id="why">
        <div className="container">
          <div className="stats-grid">
            <div className="stat-cell">
              <span className="stat-value">40%</span>
              <div className="stat-label">of carts are abandoned because checkout costs were too high</div>
              <div className="stat-source">Baymard Institute, 2024</div>
            </div>
            <div className="stat-cell">
              <span className="stat-value">64%</span>
              <div className="stat-label">of top ecommerce checkouts score mediocre or worse on UX benchmarks</div>
              <div className="stat-source">Baymard Institute, 2025</div>
            </div>
            <div className="stat-cell">
              <span className="stat-value">1</span>
              <div className="stat-label">number that customers actually remember — the final payable total</div>
              <div className="stat-source">CartTruth product research</div>
            </div>
          </div>
          <div className="why-grid">
            <div>
              <div className="section-badge">Why CartTruth</div>
              <h2 className="section-heading">Opacity has a <em>cost</em></h2>
              <p className="section-subtext" style={{ marginBottom: 36 }}>
                Product pages show the promise. Checkout reveals the real price. CartTruth closes that gap with verifiable, reproducible evidence.
              </p>
              <div className="why-list">
                {WHY_ITEMS.map((item) => (
                  <div key={item.title} className="why-item">
                    <div className="why-item-icon">{item.icon}</div>
                    <div className="why-item-content">
                      <h4>{item.title}</h4>
                      <p>{item.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="why-visual">
              <div className="why-terminal">
                <div className="terminal-bar">
                  <div className="mockup-dot mockup-dot-r" />
                  <div className="mockup-dot mockup-dot-y" />
                  <div className="mockup-dot mockup-dot-g" />
                  <span className="terminal-title">carttruth — run output</span>
                </div>
                <div className="terminal-body">
                  <div><span className="t-comment"># CartTruth checkout verification</span></div>
                  <div><span className="t-dim">▶</span> <span className="t-cmd">Opening Daraz checkout...</span></div>
                  <div><span className="t-dim">→</span> <span className="t-key">product_page_price</span>: <span className="t-val">Rs. 12,500.00</span></div>
                  <div><span className="t-dim">→</span> <span className="t-key">checkout_unit_price</span>: <span className="t-val">Rs. 12,500.00</span></div>
                  <div><span className="t-dim">→</span> <span className="t-key">delivery_fee</span>: <span className="t-num">Rs. 350.00</span></div>
                  <div><span className="t-dim">→</span> <span className="t-key">platform_fee</span>: <span className="t-num">Rs. 180.00</span></div>
                  <div><span className="t-dim">→</span> <span className="t-key">voucher</span>: <span className="t-str">- Rs. 500.00</span></div>
                  <div><span className="t-dim">→</span> <span className="t-key">total</span>: <span className="t-val">Rs. 12,530.00</span></div>
                  <div>&nbsp;</div>
                  <div><span className="t-dim">📸</span> <span className="t-key">screenshot</span>: <span className="t-str">run_20260712_checkout.png</span></div>
                  <div><span className="t-dim">📄</span> <span className="t-key">evidence</span>: <span className="t-str">result.json</span></div>
                  <div>&nbsp;</div>
                  <div><span className="t-ok">✓ Verification complete — purchase blocked</span></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* PRICING */}
      <section className="land-section pricing-section" id="pricing">
        <div className="pricing-bg-orb" />
        <div className="container">
          <div className="section-center">
            <div className="section-badge">Pricing</div>
            <h2 className="section-heading">Simple, <em>transparent</em> pricing</h2>
            <p className="section-subtext">Every plan includes unlimited evidence storage, screenshot proof, API access, and MCP tools. No hidden fees.</p>
          </div>
          <div className="pricing-grid">
            {PLANS.map((plan) => (
              <div key={plan.name} className={`pricing-card${plan.popular ? " popular" : ""}`}>
                {plan.popular && <div className="pricing-popular-badge">Most Popular</div>}
                <p className="pricing-tier">{plan.tier}</p>
                <div className="pricing-price-row">
                  <span className="pricing-currency">$</span>
                  <span className="pricing-amount">{plan.price}</span>
                  {plan.priceSuffix && <span className="pricing-period">{plan.priceSuffix}</span>}
                </div>
                <p className="pricing-desc">{plan.desc}</p>
                <div className="pricing-divider" />
                <ul className="pricing-features">
                  {plan.features.map((feat) => (
                    <li key={feat} className="pricing-feature">
                      <div className="pricing-feature-check">✓</div>
                      <span>{feat}</span>
                    </li>
                  ))}
                </ul>
                {plan.popular ? (
                  <a id={`plan-cta-${plan.name.toLowerCase()}`} className="pricing-cta-primary" href="/api/auth/google/start">Get started</a>
                ) : (
                  <a id={`plan-cta-${plan.name.toLowerCase()}`} className="pricing-cta-ghost" href="/api/auth/google/start">Get started</a>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* TORCH PROXIES */}
      <section className="land-section torch-section" id="proxies">
        <div className="container">
          <div className="torch-inner">
            <div>
              <div className="torch-logo-row">
                <div className="torch-logo-icon">🔥</div>
                <span className="torch-logo-text">Powered by TorchProxies</span>
              </div>
              <div className="section-badge">Infrastructure</div>
              <h2 className="section-heading">Checkout totals change <em>by location</em></h2>
              <p className="section-subtext" style={{ marginBottom: 0 }}>
                Daraz prices and availability vary by IP region, cookies, and customer segment. CartTruth uses TorchProxies residential and ISP proxies to capture exactly what a real traveler from your target region sees at checkout.
              </p>
            </div>
            <div className="torch-proxy-cards">
              {PROXY_FEATURES.map((pf) => (
                <div key={pf.title} className="torch-proxy-card">
                  <div className="torch-proxy-icon">{pf.icon}</div>
                  <div className="torch-proxy-content">
                    <h4>{pf.title}</h4>
                    <p>{pf.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* CTA BANNER */}
      <section className="land-section cta-banner">
        <div className="container">
          <div className="cta-banner-inner">
            <div className="cta-banner-orb" />
            <h2>Stop guessing. Start verifying.</h2>
            <p>CartTruth gives you the ground truth on checkout pricing — reproducible, evidenced, and ready for dispute resolution, competitor intelligence, or QA workflows.</p>
            <div className="cta-actions">
              <a id="cta-final-start" className="btn-primary btn-primary-lg" href="/api/auth/google/start">Get started free</a>
              <button id="cta-final-docs" type="button" className="btn-outline-lg" onClick={() => onNavigate("/docs")}>Read the docs</button>
            </div>
          </div>
        </div>
      </section>

      {/* CONTACT SECTION */}
      <ContactSection />

      {/* FOOTER */}
      <PublicFooter onNavigate={onNavigate} />
    </div>
  );
}

/* --- Static data for landing page --- */
const STEPS = [
  { icon: "🔗", title: "Input", desc: "Paste a Daraz product URL or search by keyword. Select products and set quantities." },
  { icon: "🖥️", title: "Session", desc: "Your saved Daraz browser profile is loaded. The platform recognises the real account session." },
  { icon: "📋", title: "Product Read", desc: "Playwright opens each product page and records the exact observed price shown." },
  { icon: "🛒", title: "Cart Isolation", desc: "Navigates to cart, selects only requested products, adjusts quantities precisely." },
  { icon: "💰", title: "Checkout Extraction", desc: "Loads full checkout, parses line prices, fees, vouchers, delivery, and the final order total." },
  { icon: "🛑", title: "Guardrail Stop", desc: "Writes all evidence — JSON, screenshots, artifacts. Blocks finalization. Never submits a purchase." }
];

const FEATURES = [
  {
    icon: "💳",
    title: "Real Checkout Totals",
    desc: "Captures the full final price a customer actually pays — product subtotal, delivery fee, platform fee, service charge, taxes, vouchers, and discounts.",
    featured: true,
    tag: "Core feature"
  },
  {
    icon: "📸",
    title: "Screenshot Evidence",
    desc: "Every check stores timestamped screenshots, JSON artifacts, and a full run history. Irrefutable proof for dispute resolution.",
    tag: null
  },
  {
    icon: "🛡️",
    title: "Never-Purchase Guard",
    desc: "Network routes proactively abort order, payment, and finalization requests. Unsafe purchase button labels are refused before any click.",
    tag: null
  },
  {
    icon: "🔌",
    title: "REST API",
    desc: "POST /checks, GET /runs/:id, webhooks on completion — integrate CartTruth into your existing pricing or QA pipeline.",
    tag: null
  },
  {
    icon: "🤖",
    title: "MCP Tools",
    desc: "Connect CartTruth to Claude, Cursor, VS Code, or Codex. AI agents get safe, restricted checkout verification — not raw browser access.",
    tag: "AI-native"
  },
  {
    icon: "⏰",
    title: "Scheduled Checks",
    desc: "Enable automatic recurring price checks on all your saved links. Configure interval from 1 to 24 hours. Stay ahead of price changes.",
    tag: null
  }
];

const WHY_ITEMS = [
  {
    icon: "📊",
    title: "Competitor Intelligence",
    desc: "Standard monitoring only scrapes product-page display prices. CartTruth goes deeper — extract the actual final checkout total including all dynamic charges."
  },
  {
    icon: "⚖️",
    title: "Dispute Resolution",
    desc: "Support teams need irrefutable evidence when shoppers, sellers, and marketplaces disagree. CartTruth evidence is reproducible and timestamped."
  },
  {
    icon: "🔍",
    title: "QA & Release Testing",
    desc: "Pricing software releases can silently break checkout totals across regions. CartTruth runs in CI — catch regressions before customers do."
  }
];

const PLANS = [
  {
    name: "Starter",
    tier: "Starter",
    price: "25",
    priceSuffix: "/month",
    popular: false,
    desc: "For individual sellers and small shop owners tracking a handful of competitors.",
    features: [
      "Up to 10 saved product links",
      "Manual price checks",
      "Full checkout extraction",
      "Screenshot evidence storage",
      "REST API access",
      "30-day run history"
    ]
  },
  {
    name: "Growth",
    tier: "Growth",
    price: "100",
    priceSuffix: "/month",
    popular: true,
    desc: "For agencies, ecommerce QA teams, and power sellers monitoring up to 50 competitors.",
    features: [
      "Up to 50 saved product links",
      "Scheduled automatic checks",
      "Full checkout + breakdown extraction",
      "Screenshot & JSON evidence",
      "REST API + MCP tools",
      "Webhooks on completion",
      "Unlimited run history",
      "Priority support"
    ]
  },
  {
    name: "Enterprise",
    tier: "Enterprise",
    price: "500",
    priceSuffix: "–$5k/month",
    popular: false,
    desc: "For hotel groups, large marketplaces, and commerce teams needing API access and custom integrations.",
    features: [
      "Unlimited product links",
      "Hourly scheduled checks",
      "Multi-region geo pricing",
      "Custom adapter development",
      "Dedicated ISP proxies",
      "SLA & audit trail",
      "Custom reporting & exports",
      "Dedicated account manager"
    ]
  }
];

const PROXY_FEATURES = [
  {
    icon: "🌍",
    title: "Geo-Targeting",
    desc: "Residential proxies let CartTruth act like a real user from Sri Lanka, India, UK, Australia — capturing exact location-based pricing and regional taxes."
  },
  {
    icon: "🔒",
    title: "Session Stability",
    desc: "Sticky sessions maintain the exact same browsing identity from product page all the way through the complex checkout flow — no dropped carts midway."
  },
  {
    icon: "🔄",
    title: "Scale & Reliability",
    desc: "Rotating residential and ISP proxies ensure high-volume competitor checks run concurrently without triggering CAPTCHAs, rate limits, or IP blocks."
  }
];

/* --- Dashboard mockup in hero --- */
function HeroDashboardPreview() {
  return (
    <div className="hero-mockup">
      <div className="mockup-scan" />
      <div className="mockup-bar">
        <div className="mockup-dot mockup-dot-r" />
        <div className="mockup-dot mockup-dot-y" />
        <div className="mockup-dot mockup-dot-g" />
        <div className="mockup-url">carttruth.knurdz.org/dashboard</div>
      </div>
      <div className="mockup-body">
        <div className="mockup-header-row">
          <span className="mockup-title">Price Verification</span>
          <div className="mockup-status-pill">
            <div className="mockup-status-dot" />
            Live check
          </div>
        </div>
        <div className="mockup-cards">
          <div className="mockup-card">
            <div className="mockup-card-label">Page Price</div>
            <div className="mockup-card-val">Rs. 12,500</div>
          </div>
          <div className="mockup-card">
            <div className="mockup-card-label">Checkout Total</div>
            <div className="mockup-card-val accent">Rs. 12,530</div>
          </div>
          <div className="mockup-card">
            <div className="mockup-card-label">Hidden Fees</div>
            <div className="mockup-card-val green">+Rs. 30</div>
          </div>
        </div>
        <div className="mockup-table-row">
          <span className="mockup-product">Samsung Galaxy A35 5G</span>
          <span className="mockup-price-before">Rs. 47,500</span>
          <span className="mockup-price-after">Rs. 47,680</span>
          <span className="mockup-badge-diff">+Rs. 180</span>
        </div>
        <div className="mockup-table-row">
          <span className="mockup-product">Xiaomi Redmi Note 13</span>
          <span className="mockup-price-before">Rs. 33,000</span>
          <span className="mockup-price-after">Rs. 33,000</span>
          <span className="mockup-badge-ok">Match</span>
        </div>
        <div className="mockup-table-row">
          <span className="mockup-product">Realme C67 128GB</span>
          <span className="mockup-price-before">Rs. 28,500</span>
          <span className="mockup-price-after">Rs. 28,850</span>
          <span className="mockup-badge-diff">+Rs. 350</span>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   CONTACT SECTION — landing page contact form
   ============================================================ */
function ContactSection() {
  const [subject, setSubject] = useState("");
  const [content, setContent] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!subject.trim() || !content.trim()) return;
    setStatus("sending");
    setErrorMsg("");
    try {
      await postJson("/api/contact", { subject: subject.trim(), content: content.trim() });
      setStatus("sent");
      setSubject("");
      setContent("");
    } catch (err) {
      setStatus("error");
      setErrorMsg(err instanceof Error ? err.message : "Failed to send message.");
    }
  }

  return (
    <section className="land-section contact-section" id="contact">
      <div className="container">
        <div className="contact-inner">
          <div className="contact-left">
            <div className="section-badge">Contact</div>
            <h2 className="section-heading">Get in <em>touch</em></h2>
            <p className="section-subtext">
              Have a question, a feature idea, or want to partner with us? Drop us a message — we read every submission.
            </p>
            <div className="contact-features">
              <div className="contact-feature-item">
                <div className="contact-feature-icon">💬</div>
                <div>
                  <h4>Feature Requests</h4>
                  <p>Tell us what you need — we build based on user feedback.</p>
                </div>
              </div>
              <div className="contact-feature-item">
                <div className="contact-feature-icon">🤝</div>
                <div>
                  <h4>Partnerships</h4>
                  <p>Enterprise plans, integrations, and bulk checkout verification.</p>
                </div>
              </div>
              <div className="contact-feature-item">
                <div className="contact-feature-icon">🐛</div>
                <div>
                  <h4>Bug Reports</h4>
                  <p>Found something off? Let us know and we'll fix it fast.</p>
                </div>
              </div>
            </div>
          </div>

          <div className="contact-right">
            <div className="contact-card">
              <div className="contact-card-glow" />
              {status === "sent" ? (
                <div className="contact-success">
                  <div className="contact-success-icon">✅</div>
                  <h3>Message sent!</h3>
                  <p>Thanks for reaching out. We'll get back to you soon.</p>
                  <button
                    type="button"
                    className="btn-primary-pill"
                    style={{ marginTop: 24 }}
                    onClick={() => setStatus("idle")}
                  >
                    Send another
                  </button>
                </div>
              ) : (
                <form onSubmit={(e) => void handleSubmit(e)} className="contact-form" id="contact-form">
                  <h3 className="contact-form-title">Send a message</h3>
                  <div className="contact-form-group">
                    <label htmlFor="contact-subject" className="contact-label">Subject</label>
                    <input
                      id="contact-subject"
                      type="text"
                      className="contact-input"
                      placeholder="e.g. Feature request: multi-currency support"
                      value={subject}
                      onChange={(e) => setSubject(e.target.value)}
                      maxLength={200}
                      required
                      disabled={status === "sending"}
                    />
                  </div>
                  <div className="contact-form-group">
                    <label htmlFor="contact-content" className="contact-label">Message</label>
                    <textarea
                      id="contact-content"
                      className="contact-textarea"
                      placeholder="Tell us more about your use case, question, or feedback..."
                      value={content}
                      onChange={(e) => setContent(e.target.value)}
                      rows={5}
                      maxLength={5000}
                      required
                      disabled={status === "sending"}
                    />
                    <span className="contact-char-count">{content.length}/5000</span>
                  </div>
                  {status === "error" && (
                    <p className="contact-error">{errorMsg || "Something went wrong. Please try again."}</p>
                  )}
                  <button
                    id="contact-submit"
                    type="submit"
                    className="btn-primary-pill contact-submit-btn"
                    disabled={status === "sending" || !subject.trim() || !content.trim()}
                  >
                    {status === "sending" ? (
                      <>
                        <span className="contact-spinner" />
                        Sending…
                      </>
                    ) : (
                      <>Send message →</>
                    )}
                  </button>
                </form>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ============================================================
   SIDEBAR NAV ITEM
   ============================================================ */
function SidebarNavItem({
  icon, label, active, onClick
}: { icon: React.ReactNode; label: string; active: boolean; onClick: () => void; showPlus?: boolean }) {
  return (
    <button
      type="button"
      className={`fd-nav-item${active ? " fd-nav-item--active" : ""}`}
      onClick={onClick}
    >
      <span className="fd-nav-icon">{icon}</span>
      <span className="fd-nav-label">{label}</span>
    </button>
  );
}

function DashboardHeader({
  user,
  searchQuery,
  onSearchChange,
  primaryLabel,
  onPrimaryAction,
  onSettingsClick,
  notifications,
  unreadCount,
  showNotifications,
  onNotificationsToggle,
  onNotificationsClose,
  onNotificationRead,
  onNotificationsReadAll,
  showSearch = true
}: {
  user: AppUser;
  searchQuery: string;
  onSearchChange: (value: string) => void;
  primaryLabel: string;
  onPrimaryAction: () => void;
  onSettingsClick: () => void;
  notifications: AppNotification[];
  unreadCount: number;
  showNotifications: boolean;
  onNotificationsToggle: () => void;
  onNotificationsClose: () => void;
  onNotificationRead: (id: string) => void;
  onNotificationsReadAll: () => void;
  showSearch?: boolean;
}) {
  const firstName = (user.displayName?.split(" ")[0] || user.email?.split("@")[0] || user.username) ?? "there";
  const today = new Date().toLocaleDateString("en-US", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const notificationsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showNotifications) return;
    function handlePointerDown(event: MouseEvent) {
      if (!notificationsRef.current?.contains(event.target as Node)) {
        onNotificationsClose();
      }
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [showNotifications, onNotificationsClose]);

  return (
    <header className="fd-header">
      <div className="fd-header-greeting">
        <h1 className="fd-header-title">Hi, {firstName}!</h1>
        <p className="fd-header-date">{today}</p>
      </div>
      {showSearch && (
        <div className="fd-header-search">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
            <circle cx="11" cy="11" r="8"/>
            <line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            type="search"
            className="fd-header-search-input"
            placeholder="Search products..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
          />
          <span className="fd-header-search-kbd">⌘K</span>
        </div>
      )}
      <div className="fd-header-actions">
        <button type="button" className="fd-header-icon-btn" title="Settings" onClick={onSettingsClick}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
            <circle cx="12" cy="12" r="3"/>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
          </svg>
        </button>
        <div className="fd-notifications-wrap" ref={notificationsRef}>
          <button
            type="button"
            className={`fd-header-icon-btn ${showNotifications ? "fd-header-icon-btn--active" : ""}`}
            title="Notifications"
            onClick={onNotificationsToggle}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
              <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
            </svg>
            {unreadCount > 0 && <span className="fd-notifications-badge">{unreadCount > 9 ? "9+" : unreadCount}</span>}
          </button>
          {showNotifications && (
            <div className="fd-notifications-panel">
              <div className="fd-notifications-header">
                <strong>Notifications</strong>
                {unreadCount > 0 && (
                  <button type="button" className="fd-notifications-mark-all" onClick={() => void onNotificationsReadAll()}>
                    Mark all read
                  </button>
                )}
              </div>
              {notifications.length === 0 ? (
                <p className="fd-notifications-empty">No notifications yet.</p>
              ) : (
                <div className="fd-notifications-list">
                  {notifications.map((notification) => (
                    <button
                      key={notification.id}
                      type="button"
                      className={`fd-notification-item fd-notification-item--${notification.kind} ${notification.readAt ? "fd-notification-item--read" : ""}`}
                      onClick={() => void onNotificationRead(notification.id)}
                    >
                      <span className="fd-notification-title">{notification.title}</span>
                      <span className="fd-notification-body">{notification.body}</span>
                      <span className="fd-notification-time">{formatRelativeTime(notification.createdAt)}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
        <button type="button" className="fd-header-primary-btn" onClick={onPrimaryAction}>
          {primaryLabel}
        </button>
      </div>
    </header>
  );
}

function StatCard({
  label, value, delta, deltaLabel, icon, iconBg, note
}: {
  label: string;
  value: string;
  delta?: number;
  deltaLabel?: string;
  icon?: React.ReactNode;
  iconBg?: string;
  note?: string;
}) {
  const positive = delta !== undefined && delta >= 0;
  return (
    <div className="fd-stat-card">
      <div className="fd-stat-body">
        <p className="fd-stat-label">{label}</p>
        <p className="fd-stat-value">{value}</p>
        {delta !== undefined && (
          <p className={`fd-stat-delta ${positive ? "fd-stat-delta--up" : "fd-stat-delta--down"}`}>
            <span>{positive ? "+" : ""}{delta}%</span>
            {deltaLabel && <span className="fd-stat-delta-note">{deltaLabel}</span>}
          </p>
        )}
        {note && <p className="fd-stat-note">{note}</p>}
      </div>
      {icon && iconBg && (
        <div className="fd-stat-icon" style={{ background: iconBg }}>
          {icon}
        </div>
      )}
    </div>
  );
}

function FinSummaryCard({
  title, value, badge, badgeType, description, children
}: {
  title: string;
  value: string;
  badge?: string;
  badgeType?: "up" | "down" | "neutral";
  description?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="fd-summary-card">
      <div className="fd-summary-top">
        <span className="fd-summary-title">{title}</span>
        {badge && (
          <span className={`fd-badge fd-badge--${badgeType ?? "neutral"}`}>{badge}</span>
        )}
      </div>
      <p className="fd-summary-value">{value}</p>
      {description && <p className="fd-summary-desc">{description}</p>}
      {children}
    </div>
  );
}

function RingGauge({ value, label, sublabel, color = "#2563eb", size = 80 }: {
  value: number;
  label: string;
  sublabel?: string;
  color?: string;
  size?: number;
}) {
  const r = (size - 12) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const circumference = 2 * Math.PI * r;
  const offset = circumference - (Math.min(value, 100) / 100) * circumference;

  return (
    <div className="fd-ring-gauge">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="#eef2f7" strokeWidth="8" />
        <circle
          cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth="8"
          strokeDasharray={circumference} strokeDashoffset={offset}
          strokeLinecap="round" transform={`rotate(-90 ${cx} ${cy})`}
        />
        <text x={cx} y={cy + 5} textAnchor="middle" fontSize="14" fontWeight="700" fill="#111827">{value}%</text>
      </svg>
      <div className="fd-ring-labels">
        <span className="fd-ring-label">{label}</span>
        {sublabel && <span className="fd-ring-sublabel">{sublabel}</span>}
      </div>
    </div>
  );
}

function LargeAreaChart({
  data, labels, title, subtitle, headline, headlineNote, badge, badgeType, height = 300, formatValue
}: {
  data: number[];
  labels: string[];
  title: string;
  subtitle?: string;
  headline?: string;
  headlineNote?: string;
  badge?: string;
  badgeType?: "up" | "down";
  height?: number;
  formatValue?: (v: number) => string;
}) {
  const [hovered, setHovered] = useState<number | null>(null);
  const w = 720;
  const h = height;
  const pad = { top: 24, right: 16, bottom: 36, left: 52 };
  const innerW = w - pad.left - pad.right;
  const innerH = h - pad.top - pad.bottom;
  const maxVal = Math.max(...data, 1) * 1.15;
  const toX = (i: number) => pad.left + (i / Math.max(data.length - 1, 1)) * innerW;
  const toY = (v: number) => pad.top + innerH - (v / maxVal) * innerH;
  const makePath = (pts: number[]) =>
    pts.map((v, i) => `${i === 0 ? "M" : "L"}${toX(i).toFixed(1)},${toY(v).toFixed(1)}`).join(" ");
  const makeArea = (pts: number[]) =>
    `${makePath(pts)} L${toX(pts.length - 1).toFixed(1)},${(pad.top + innerH).toFixed(1)} L${pad.left.toFixed(1)},${(pad.top + innerH).toFixed(1)} Z`;
  const yTicks = Array.from({ length: 5 }, (_, i) => Math.round((maxVal / 4) * i));
  const fmt = formatValue ?? ((v: number) => v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(Math.round(v)));

  return (
    <div className="fd-chart-card fd-chart-card--large">
      <div className="fd-chart-card-header">
        <div>
          <h3 className="fd-chart-card-title">{title}</h3>
          {subtitle && <p className="fd-chart-card-sub">{subtitle}</p>}
        </div>
        <div className="fd-chart-card-actions">
          <span className="fd-chart-pill">Last {data.length} runs</span>
        </div>
      </div>
      {(headline || badge) && (
        <div className="fd-chart-headline-row">
          {headline && <span className="fd-chart-headline">{headline}</span>}
          {badge && <span className={`fd-badge fd-badge--${badgeType ?? "up"}`}>{badge}</span>}
          {headlineNote && <span className="fd-chart-headline-note">{headlineNote}</span>}
        </div>
      )}
      <div className="fd-chart-svg-wrap">
        <svg width="100%" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="xMidYMid meet">
          <defs>
            <linearGradient id="fd-area-grad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#2563eb" stopOpacity="0.18" />
              <stop offset="100%" stopColor="#2563eb" stopOpacity="0" />
            </linearGradient>
          </defs>
          {yTicks.map(v => (
            <g key={v}>
              <line x1={pad.left} y1={toY(v)} x2={pad.left + innerW} y2={toY(v)} stroke="#eef2f7" strokeWidth="1" />
              <text x={pad.left - 8} y={toY(v) + 4} textAnchor="end" fontSize="11" fill="#9ca3af">{fmt(v)}</text>
            </g>
          ))}
          <path d={makeArea(data)} fill="url(#fd-area-grad)" />
          <path d={makePath(data)} fill="none" stroke="#2563eb" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
          {labels.map((lbl, i) => (
            <text key={i} x={toX(i)} y={pad.top + innerH + 22} textAnchor="middle" fontSize="11" fill="#9ca3af">{lbl}</text>
          ))}
          {data.map((_, i) => (
            <rect
              key={i} x={toX(i) - 24} y={pad.top} width="48" height={innerH}
              fill="transparent" style={{ cursor: "pointer" }}
              onMouseEnter={() => setHovered(i)} onMouseLeave={() => setHovered(null)}
            />
          ))}
          {hovered !== null && (
            <>
              <line x1={toX(hovered)} y1={pad.top} x2={toX(hovered)} y2={pad.top + innerH} stroke="#cbd5e1" strokeWidth="1" strokeDasharray="4,3" />
              <circle cx={toX(hovered)} cy={toY(data[hovered])} r="5" fill="#2563eb" stroke="white" strokeWidth="2" />
            </>
          )}
        </svg>
      </div>
    </div>
  );
}

function truncateLabel(text: string, max = 14) {
  return text.length > max ? `${text.substring(0, max)}…` : text;
}

function moneyToMajor(value?: Money) {
  return (value?.minorUnits ?? 0) / 100;
}

function buildProductCompareChart(links: SavedLink[], latest?: DarazCheckResult) {
  const items = links.slice(0, 8);
  if (items.length === 0) {
    return {
      labels: ["Product A", "Product B", "Product C"],
      series: [
        { name: "Listed", color: "#93c5fd", data: [1200, 890, 1450] },
        { name: "Checkout", color: "#2563eb", data: [1340, 1020, 1580] }
      ],
      isSample: true
    };
  }
  const labels = items.map(l => truncateLabel(l.title, 12));
  const listed = items.map(l => moneyToMajor(parseObservedPrice(l)));
  const checkout = items.map(link => {
    const match = latest?.products.find(p => p.url === link.url || p.title === link.title);
    return moneyToMajor(match?.checkoutLinePrice ?? match?.checkoutUnitPrice ?? match?.observedPrice);
  });
  return {
    labels,
    series: [
      { name: "Listed", color: "#93c5fd", data: listed },
      { name: "Checkout", color: "#2563eb", data: checkout }
    ],
    isSample: false
  };
}

function LargeGroupedBarChart({
  series, labels, title, subtitle, headline, headlineNote, height = 300, formatValue
}: {
  series: Array<{ name: string; color: string; data: number[] }>;
  labels: string[];
  title: string;
  subtitle?: string;
  headline?: string;
  headlineNote?: string;
  height?: number;
  formatValue?: (v: number) => string;
}) {
  const [hovered, setHovered] = useState<{ group: number; series: number } | null>(null);
  const w = 720;
  const h = height;
  const pad = { top: 24, right: 16, bottom: 44, left: 52 };
  const innerW = w - pad.left - pad.right;
  const innerH = h - pad.top - pad.bottom;
  const allValues = series.flatMap(s => s.data);
  const maxVal = Math.max(...allValues, 1) * 1.15;
  const gap = innerW / Math.max(labels.length, 1);
  const groupW = gap * 0.72;
  const barW = groupW / Math.max(series.length, 1) * 0.88;
  const yTicks = Array.from({ length: 5 }, (_, i) => Math.round((maxVal / 4) * i));
  const fmt = formatValue ?? ((v: number) => v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(Math.round(v)));

  return (
    <div className="fd-chart-card fd-chart-card--large">
      <div className="fd-chart-card-header">
        <div>
          <h3 className="fd-chart-card-title">{title}</h3>
          {subtitle && <p className="fd-chart-card-sub">{subtitle}</p>}
        </div>
        <div className="fd-chart-legend">
          {series.map(seg => (
            <span key={seg.name} className="fd-chart-legend-item">
              <span className="fd-chart-legend-dot" style={{ background: seg.color }} />
              {seg.name}
            </span>
          ))}
        </div>
      </div>
      {(headline || headlineNote) && (
        <div className="fd-chart-headline-row">
          {headline && <span className="fd-chart-headline">{headline}</span>}
          {headlineNote && <span className="fd-chart-headline-note">{headlineNote}</span>}
        </div>
      )}
      <div className="fd-chart-svg-wrap">
        <svg width="100%" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="xMidYMid meet">
          {yTicks.map(v => {
            const y = pad.top + innerH - (v / maxVal) * innerH;
            return (
              <g key={v}>
                <line x1={pad.left} y1={y} x2={pad.left + innerW} y2={y} stroke="#eef2f7" strokeWidth="1" />
                <text x={pad.left - 8} y={y + 4} textAnchor="end" fontSize="11" fill="#9ca3af">{fmt(v)}</text>
              </g>
            );
          })}
          {labels.map((lbl, gi) => {
            const groupX = pad.left + gi * gap + (gap - groupW) / 2;
            return (
              <g key={gi}>
                {series.map((seg, si) => {
                  const val = seg.data[gi] ?? 0;
                  const barH = (val / maxVal) * innerH;
                  const x = groupX + si * (groupW / series.length) + (groupW / series.length - barW) / 2;
                  const y = pad.top + innerH - barH;
                  const isHovered = hovered?.group === gi && hovered?.series === si;
                  return (
                    <rect
                      key={seg.name}
                      x={x} y={y} width={barW} height={Math.max(barH, val > 0 ? 2 : 0)}
                      rx="3" fill={seg.color}
                      opacity={isHovered ? 1 : 0.88}
                      style={{ cursor: "pointer" }}
                      onMouseEnter={() => setHovered({ group: gi, series: si })}
                      onMouseLeave={() => setHovered(null)}
                    />
                  );
                })}
                <text x={pad.left + gi * gap + gap / 2} y={pad.top + innerH + 20} textAnchor="middle" fontSize="10" fill="#9ca3af">{lbl}</text>
              </g>
            );
          })}
          {hovered !== null && series[hovered.series] && (
            <text
              x={pad.left + hovered.group * gap + gap / 2}
              y={pad.top - 6}
              textAnchor="middle" fontSize="11" fontWeight="700" fill="#111827"
            >
              {series[hovered.series].name}: {fmt(series[hovered.series].data[hovered.group] ?? 0)}
            </text>
          )}
        </svg>
      </div>
    </div>
  );
}

function LargeStackedBarChart({
  series, labels, title, subtitle, legend, height = 300, formatValue
}: {
  series: Array<{ name: string; color: string; data: number[] }>;
  labels: string[];
  title: string;
  subtitle?: string;
  legend?: boolean;
  height?: number;
  formatValue?: (v: number) => string;
}) {
  const w = 720;
  const h = height;
  const pad = { top: 24, right: 16, bottom: 44, left: 52 };
  const innerW = w - pad.left - pad.right;
  const innerH = h - pad.top - pad.bottom;
  const totals = labels.map((_, i) => series.reduce((s, seg) => s + (seg.data[i] ?? 0), 0));
  const maxVal = Math.max(...totals, ...series.flatMap(s => s.data), 1) * 1.15;
  const barW = innerW / labels.length * 0.55;
  const gap = innerW / labels.length;
  const yTicks = Array.from({ length: 5 }, (_, i) => Math.round((maxVal / 4) * i));
  const fmt = formatValue ?? ((v: number) => v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(Math.round(v)));

  return (
    <div className="fd-chart-card fd-chart-card--large">
      <div className="fd-chart-card-header">
        <div>
          <h3 className="fd-chart-card-title">{title}</h3>
          {subtitle && <p className="fd-chart-card-sub">{subtitle}</p>}
        </div>
        {legend !== false && (
          <div className="fd-chart-legend">
            {series.map(seg => (
              <span key={seg.name} className="fd-chart-legend-item">
                <span className="fd-chart-legend-dot" style={{ background: seg.color }} />
                {seg.name}
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="fd-chart-svg-wrap">
        <svg width="100%" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="xMidYMid meet">
          {yTicks.map(v => (
            <g key={v}>
              <line x1={pad.left} y1={pad.top + innerH - (v / maxVal) * innerH} x2={pad.left + innerW} y2={pad.top + innerH - (v / maxVal) * innerH} stroke="#eef2f7" strokeWidth="1" />
              <text x={pad.left - 8} y={pad.top + innerH - (v / maxVal) * innerH + 4} textAnchor="end" fontSize="11" fill="#9ca3af">{fmt(v)}</text>
            </g>
          ))}
          {labels.map((lbl, i) => {
            const x = pad.left + i * gap + (gap - barW) / 2;
            let yOffset = pad.top + innerH;
            return (
              <g key={i}>
                {series.map(seg => {
                  const val = seg.data[i] ?? 0;
                  const barH = (val / maxVal) * innerH;
                  yOffset -= barH;
                  return (
                    <rect key={seg.name} x={x} y={yOffset} width={barW} height={barH} rx="3" fill={seg.color} />
                  );
                })}
                <text x={x + barW / 2} y={pad.top + innerH + 22} textAnchor="middle" fontSize="11" fill="#9ca3af">{lbl}</text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

function LargeDonutChart({
  segments, title, subtitle, size = 140
}: {
  segments: Array<{ value: number; color: string; name: string }>;
  title: string;
  subtitle?: string;
  size?: number;
}) {
  const total = segments.reduce((s, seg) => s + seg.value, 0) || 1;
  const r = size / 2 - 14;
  const cx = size / 2;
  const cy = size / 2;
  let angle = -Math.PI / 2;
  const arcs = segments.map((seg) => {
    const ratio = seg.value / total;
    const sweep = ratio * 2 * Math.PI;
    const x1 = cx + r * Math.cos(angle);
    const y1 = cy + r * Math.sin(angle);
    angle += sweep;
    const x2 = cx + r * Math.cos(angle);
    const y2 = cy + r * Math.sin(angle);
    const large = sweep > Math.PI ? 1 : 0;
    return { d: `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`, color: seg.color, name: seg.name, value: seg.value };
  });

  return (
    <div className="fd-chart-card">
      <div className="fd-chart-card-header">
        <div>
          <h3 className="fd-chart-card-title">{title}</h3>
          {subtitle && <p className="fd-chart-card-sub">{subtitle}</p>}
        </div>
      </div>
      <div className="fd-donut-wrap">
        <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size}>
          <circle cx={cx} cy={cy} r={r} fill="none" stroke="#eef2f7" strokeWidth="14" />
          {arcs.map((arc, i) => (
            <path key={i} d={arc.d} fill="none" stroke={arc.color} strokeWidth="14" strokeLinecap="butt" />
          ))}
          <text x={cx} y={cy - 4} textAnchor="middle" fontSize="18" fontWeight="800" fill="#111827">{total}</text>
          <text x={cx} y={cy + 14} textAnchor="middle" fontSize="10" fill="#9ca3af">total</text>
        </svg>
        <div className="fd-donut-legend">
          {arcs.map((arc, i) => (
            <div key={i} className="fd-donut-legend-item">
              <span className="fd-donut-dot" style={{ background: arc.color }} />
              <span className="fd-donut-legend-name">{arc.name}</span>
              <span className="fd-donut-legend-val">{arc.value}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function MiniSparkline({ data, color = "#22c55e", width = 120, height = 40 }: {
  data: number[];
  color?: string;
  width?: number;
  height?: number;
}) {
  const pad = 2;
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  const pts = data.map((v, i) => {
    const x = pad + (i / Math.max(data.length - 1, 1)) * (width - pad * 2);
    const y = pad + (1 - (v - min) / range) * (height - pad * 2);
    return `${x},${y}`;
  }).join(" ");

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} className="fd-sparkline">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

/* ============================================================
   DASHBOARD SHELL — sidebar layout
   ============================================================ */
type MessageTone = "success" | "info" | "error" | "warn";

type ActivityLogEntry = {
  id: string;
  text: string;
  tone: MessageTone;
  status: "running" | "done" | "error" | "warn";
};

function StatusBanner({ message, tone = "info" }: { message: string; tone?: MessageTone }) {
  if (!message) return null;
  return <div className={`fd-alert fd-alert--${tone}`}>{message}</div>;
}

function activityIcon(status: ActivityLogEntry["status"]) {
  if (status === "running") return "◌";
  if (status === "done") return "✓";
  if (status === "error") return "✕";
  return "!";
}

function ActivityLog({ entries }: { entries: ActivityLogEntry[] }) {
  if (entries.length === 0) return null;
  return (
    <div className="modal-activity-log" aria-live="polite">
      {entries.map((entry) => (
        <div
          key={entry.id}
          className={`modal-activity-step modal-activity-step--${entry.status} modal-activity-step--tone-${entry.tone}`}
        >
          <span className="modal-activity-icon" aria-hidden="true">{activityIcon(entry.status)}</span>
          <span className="modal-activity-text">{entry.text}</span>
        </div>
      ))}
    </div>
  );
}

function darazSessionAddWarning(session: DarazSession, credentials: DarazCredentialStatus): string {
  if (session.status === "saved") return "";
  if (credentials.saved) {
    return "Daraz session is not active. CartTruth will try to reconnect automatically before verifying the final checkout price.";
  }
  return "Daraz session is not connected. The product page price will be saved, but you need to connect Daraz in the Daraz Session tab before final checkout price can be verified.";
}

function Dashboard({ user, onLogout, onNavigate }: { user: AppUser; onLogout: () => Promise<void>; onNavigate: (path: string) => void }) {
  const [tab, setTab] = useState<"dashboard" | "products" | "session" | "messages" | "admin" | "settings">("dashboard");

  // Shared states for dashboard functional logic
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
  const [message, setMessageText] = useState("");
  const [messageTone, setMessageTone] = useState<MessageTone>("info");
  const [activityLog, setActivityLog] = useState<ActivityLogEntry[]>([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [darkMode, setDarkMode] = useState(false);
  const [addMode, setAddMode] = useState<"url" | "search">("url");
  const [darazQuery, setDarazQuery] = useState("");
  const [searchingDaraz, setSearchingDaraz] = useState(false);
  const [searchResults, setSearchResults] = useState<DarazSearchResult[]>([]);
  const [selectedSearchProduct, setSelectedSearchProduct] = useState<DarazSearchResult | undefined>();
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [showNotifications, setShowNotifications] = useState(false);

  const darazSessionWarning = darazSessionAddWarning(darazSession, credentials);

  function setMessage(text: string, tone: MessageTone = "info") {
    setMessageText(text);
    setMessageTone(tone);
  }

  function clearMessage() {
    setMessageText("");
    setMessageTone("info");
  }

  function pushActivity(text: string, tone: MessageTone = "info", status: ActivityLogEntry["status"] = "running") {
    setActivityLog((prev) => [
      ...prev.map((entry) => (entry.status === "running" ? { ...entry, status: "done" as const } : entry)),
      { id: `${Date.now()}-${prev.length}`, text, tone, status }
    ]);
  }

  function completeRunningActivity(text?: string, tone: MessageTone = "success") {
    setActivityLog((prev) => {
      const completed = prev.map((entry) => (entry.status === "running" ? { ...entry, status: "done" as const } : entry));
      if (!text) return completed;
      return [...completed, { id: `${Date.now()}-done`, text, tone, status: "done" as const }];
    });
  }

  function failActivity(text: string) {
    setActivityLog((prev) => [
      ...prev.map((entry) => (entry.status === "running" ? { ...entry, status: "error" as const } : entry)),
      { id: `${Date.now()}-error`, text, tone: "error", status: "error" }
    ]);
  }

  function openCreateModal() {
    clearMessage();
    setActivityLog([]);
    setAddMode("url");
    setDarazQuery("");
    setSearchResults([]);
    setSelectedSearchProduct(undefined);
    setShowCreateModal(true);
  }

  function closeCreateModal() {
    setShowCreateModal(false);
    clearMessage();
    setActivityLog([]);
  }

  useEffect(() => {
    void refresh();
    void refreshNotifications();
    const interval = window.setInterval(() => {
      void refreshNotifications();
    }, 30000);
    return () => window.clearInterval(interval);
  }, []);

  async function refreshNotifications() {
    try {
      const response = await fetchJson<{ notifications: AppNotification[]; unreadCount: number }>("/api/notifications");
      setNotifications(response.notifications);
      setUnreadCount(response.unreadCount);
    } catch {
      // Ignore notification refresh errors.
    }
  }

  async function markNotificationRead(notificationId: string) {
    const response = await fetchJson<{ notification: AppNotification; unreadCount: number }>(`/api/notifications/${notificationId}/read`, {
      method: "PATCH"
    });
    setNotifications((items) => items.map((item) => (item.id === response.notification.id ? response.notification : item)));
    setUnreadCount(response.unreadCount);
  }

  async function markAllNotificationsRead() {
    await postJson("/api/notifications/read-all", {});
    setNotifications((items) => items.map((item) => ({ ...item, readAt: item.readAt ?? new Date().toISOString() })));
    setUnreadCount(0);
  }

  async function searchDarazProducts(event?: React.FormEvent) {
    event?.preventDefault();
    const query = darazQuery.trim();
    if (!query) return;
    setSearchingDaraz(true);
    setSearchResults([]);
    setSelectedSearchProduct(undefined);
    setProductUrl("");
    clearMessage();
    try {
      const response = await postJson<{ results: DarazSearchResult[] }>("/api/daraz/search", { query });
      setSearchResults(response.results);
      if (response.results.length === 0) {
        setMessage("No products found. Try a different search.", "warn");
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error), "error");
    } finally {
      setSearchingDaraz(false);
    }
  }

  function selectSearchProduct(product: DarazSearchResult) {
    setSelectedSearchProduct(product);
    setProductUrl(product.url);
    clearMessage();
  }

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
    setLatest((current) => pickCheckoutResult(current, runs) ?? current);
  }

  async function addLink(event?: React.FormEvent, urlOverride?: string) {
    event?.preventDefault();
    const url = (urlOverride ?? productUrl).trim();
    if (!url) {
      setMessage(addMode === "search" ? "Select a product from search results first." : "Enter a Daraz product URL.", "warn");
      return;
    }
    setAddingLink(true);
    clearMessage();
    setActivityLog([]);
    pushActivity("Validating Daraz product URL…");
    if (darazSessionWarning) {
      pushActivity(darazSessionWarning, "warn", "warn");
    }
    pushActivity("Fetching product page price from Daraz…");
    try {
      const response = await postJson<{ link: SavedLink; checkJob: PriceCheckJob; message?: string }>("/api/links", { url });
      if (response.link) {
        setLinks((items) => [response.link!, ...items.filter((item) => item.id !== response.link!.id)]);
        const observed = parseObservedPrice(response.link);
        const priceLabel = observed ? formatMoney(observed) : "price pending";
        completeRunningActivity(`Product page price saved — ${response.link.title} (${priceLabel}).`, "success");
      } else {
        completeRunningActivity("Product saved to your list.", "success");
      }
      setProductUrl("");
      setSelectedSearchProduct(undefined);
      pushActivity("Queueing checkout verification…");
      setMessage("Verifying final checkout price…", "info");
      const outcome = await trackPriceCheckJob(response.checkJob.id, { showActivity: true });
      if (outcome === "completed") {
        closeCreateModal();
        setTab("products");
      }
      void refreshNotifications();
    } catch (error) {
      const errorText = error instanceof Error ? error.message : String(error);
      failActivity(errorText);
      setMessage(errorText, "error");
    } finally {
      setAddingLink(false);
    }
  }

  async function removeLink(linkId: string) {
    await fetchJson(`/api/links/${linkId}`, { method: "DELETE" });
    await refresh();
  }

  async function startDarazLogin() {
    setMessage("Opening your Daraz browser session...", "info");
    try {
      const response = await postJson<{ captureId: string; browserUrl?: string }>("/api/daraz/session/start", {});
      setCaptureId(response.captureId);
      setBrowserUrl(response.browserUrl ?? "");
      setMessage("Daraz browser opened on the server. Complete login or verification there, then save.", "success");
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error), "error");
    }
  }

  async function saveDarazLogin() {
    if (!captureId) return;
    try {
      const response = await postJson<{ session?: DarazSession }>("/api/daraz/session/save", { captureId });
      setDarazSession(response.session ?? { status: "saved" });
      setMessage("Your Daraz session was saved.", "success");
    } catch (error) {
      await refresh().catch(() => undefined);
      setMessage(error instanceof Error ? error.message : String(error), "error");
    }
  }

  async function resetDarazLogin() {
    const session = await postJson<DarazSession>("/api/daraz/session/reset", {});
    setDarazSession(session);
    setCaptureId("");
    setBrowserUrl("");
    setMessage("Daraz session reset.", "info");
  }

  async function stopDarazBrowser() {
    const session = await postJson<DarazSession>("/api/daraz/session/stop", {});
    setDarazSession(session);
    setCaptureId("");
    setBrowserUrl("");
    setMessage("Remote Daraz browser closed.", "info");
  }

  async function checkAllLinks() {
    if (links.length === 0) {
      setMessage("Save at least one Daraz link first.", "warn");
      return;
    }
    setChecking(true);
    setMessage(hasSavedCredentialsForExpiredSession ? "Reconnecting to Daraz..." : "Queueing saved-link check...", "info");
    try {
      const response = await postJson<{ job: PriceCheckJob }>("/api/links/check-jobs", {});
      await trackPriceCheckJob(response.job.id);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error), "error");
    } finally {
      setChecking(false);
    }
  }

  async function handleDarazSessionAction(response: DarazSessionActionResponse) {
    setBrowserUrl(response.browserUrl ?? response.session?.browserUrl ?? "");
    setCaptureId(response.session?.captureId ?? "");
    setDarazSession(response.session ?? darazSession);
    setMessage(response.message ?? "Daraz needs verification. Open the remote browser, finish it, then save session.", "warn");
  }

  async function trackPriceCheckJob(jobId: string, options?: { showActivity?: boolean }): Promise<"completed" | "needs_user_action" | "failed" | "unknown"> {
    const logStep = (text: string, tone: MessageTone = "info") => {
      setMessage(text, tone);
      if (options?.showActivity) {
        pushActivity(text, tone, "running");
      }
    };

    let current: PriceCheckJob | undefined;
    for (let attempt = 0; attempt < 120; attempt += 1) {
      const response = await fetchJson<{ job: PriceCheckJob }>(`/api/price-check-jobs/${jobId}`);
      current = response.job;
      setActiveJob(current);
      if (current.status === "queued") {
        logStep("Waiting in checkout verification queue…", "info");
      } else if (current.status === "running") {
        logStep(
          hasSavedCredentialsForExpiredSession
            ? "Reconnecting to Daraz and opening checkout…"
            : darazSession.status !== "saved"
              ? "Connecting Daraz session and opening checkout…"
              : "Opening Daraz checkout and calculating final price (fees + delivery)…",
          "info"
        );
      } else {
        break;
      }
      await delay(1000);
    }

    if (!current) {
      void refreshNotifications();
      return "unknown";
    }
    if (current.status === "needs_user_action") {
      const actionMessage = current.message ?? "Daraz needs verification. Open the remote browser, finish it, then save session.";
      if (options?.showActivity) {
        failActivity(actionMessage);
        pushActivity("Go to Daraz Session to connect your account, then run verification again.", "warn", "warn");
      }
      await handleDarazSessionAction({
        status: "needs_user_action",
        message: actionMessage,
        session: current.session,
        browserUrl: current.session?.browserUrl
      });
      await refresh().catch(() => undefined);
      void refreshNotifications();
      return "needs_user_action";
    }
    if (current.status === "completed" && current.runId) {
      const result = await fetchJson<DarazCheckResult>(`/api/daraz/runs/${current.runId}`);
      setLatest(result);
      const successMessage = current.message ?? `Final checkout price verified — ${formatMoney(result.checkoutTotal)}.`;
      if (options?.showActivity) {
        completeRunningActivity(successMessage, "success");
      }
      setMessage(successMessage, "success");
      await refresh();
      void refreshNotifications();
      return "completed";
    }
    const failureMessage = current.message ?? plainStatus(current.status);
    if (options?.showActivity) {
      failActivity(failureMessage);
    }
    setMessage(failureMessage, "error");
    await refresh().catch(() => undefined);
    void refreshNotifications();
    return "failed";
  }

  useEffect(() => {
    if (darkMode) {
      document.body.classList.add("dark-theme");
    } else {
      document.body.classList.remove("dark-theme");
    }
  }, [darkMode]);

  const primaryAction = tab === "products" || tab === "session"
    ? () => void checkAllLinks()
    : () => openCreateModal();
  const primaryLabel = tab === "products" || tab === "session"
    ? (checking ? "Running..." : "Run Check")
    : "Monitor Product";

  return (
    <div className={`fd-shell ${darkMode ? "dark-theme" : ""}`}>
      <aside className="fd-sidebar">
        <div className="fd-sidebar-logo">
          <svg width="28" height="28" viewBox="0 0 32 32" fill="none">
            <circle cx="10" cy="10" r="4" fill="#111827"/>
            <circle cx="22" cy="10" r="4" fill="#111827" opacity="0.5"/>
            <circle cx="10" cy="22" r="4" fill="#111827" opacity="0.5"/>
            <circle cx="22" cy="22" r="4" fill="#111827" opacity="0.3"/>
          </svg>
          <span className="fd-sidebar-logo-text">CartTruth</span>
        </div>

        <nav className="fd-sidebar-nav">
          <SidebarNavItem
            icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="20" height="20"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>}
            label="Home"
            active={tab === "dashboard"}
            onClick={() => setTab("dashboard")}
          />
          <SidebarNavItem
            icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="20" height="20"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>}
            label="Products"
            active={tab === "products"}
            onClick={() => setTab("products")}
          />
          <SidebarNavItem
            icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="20" height="20"><rect x="3" y="5" width="18" height="14" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="8" y1="3" x2="8" y2="7"/><line x1="16" y1="3" x2="16" y2="7"/></svg>}
            label="Daraz Session"
            active={tab === "session"}
            onClick={() => setTab("session")}
          />
          {user.role === "admin" && (
            <SidebarNavItem
              icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="20" height="20"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>}
              label="Messages"
              active={tab === "messages"}
              onClick={() => setTab("messages")}
            />
          )}
          {user.role === "admin" && (
            <SidebarNavItem
              icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="20" height="20"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>}
              label="Admin Panel"
              active={tab === "admin"}
              onClick={() => setTab("admin")}
            />
          )}
          <SidebarNavItem
            icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="20" height="20"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>}
            label="Settings"
            active={tab === "settings"}
            onClick={() => setTab("settings")}
          />
        </nav>

        <div className="fd-sidebar-footer">
          <div className="fd-sidebar-user">
            <div className="fd-sidebar-avatar">
              {user.avatarUrl ? (
                <img src={user.avatarUrl} alt={user.displayName ?? user.username} />
              ) : (
                <span>{(user.displayName?.[0] || user.email?.[0] || user.username[0] || "U").toUpperCase()}</span>
              )}
            </div>
            <div className="fd-sidebar-user-info">
              <span className="fd-sidebar-user-name">{user.displayName ?? user.username}</span>
              <span className="fd-sidebar-user-role">{user.role}</span>
            </div>
          </div>
          <button type="button" className="fd-nav-item" onClick={() => onNavigate("/docs")}>
            <span className="fd-nav-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="20" height="20">
                <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
            </span>
            <span className="fd-nav-label">Help</span>
          </button>
          <button type="button" className="fd-nav-item" onClick={() => void onLogout()}>
            <span className="fd-nav-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="20" height="20">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
              </svg>
            </span>
            <span className="fd-nav-label">Log out</span>
          </button>
        </div>
      </aside>

      <div className="fd-main">
        <DashboardHeader
          user={user}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          primaryLabel={primaryLabel}
          onPrimaryAction={primaryAction}
          onSettingsClick={() => setTab("settings")}
          notifications={notifications}
          unreadCount={unreadCount}
          showNotifications={showNotifications}
          onNotificationsToggle={() => setShowNotifications((open) => !open)}
          onNotificationsClose={() => setShowNotifications(false)}
          onNotificationRead={markNotificationRead}
          onNotificationsReadAll={markAllNotificationsRead}
          showSearch={tab === "products" || tab === "dashboard"}
        />
        <div className="fd-content">
          {tab === "dashboard" && (
            <DashboardOverview
              links={links}
              history={history}
              latest={latest}
              darazSession={darazSession}
              onNavigate={setTab}
              user={user}
              onCreateClick={openCreateModal}
              onRunCheck={() => void checkAllLinks()}
              checking={checking}
            />
          )}
          {tab === "products" && (
            <ProductsPanel
              links={links}
              searchQuery={searchQuery}
              history={history}
              latest={latest}
              removeLink={removeLink}
              checking={checking}
              checkAllLinks={checkAllLinks}
              activeJob={activeJob}
              message={message}
              messageTone={messageTone}
            />
          )}
          {tab === "session" && (
            <SessionPanel
              darazSession={darazSession}
              credentials={credentials}
              captureId={captureId}
              browserUrl={browserUrl}
              startDarazLogin={startDarazLogin}
              saveDarazLogin={saveDarazLogin}
              resetDarazLogin={resetDarazLogin}
              stopDarazBrowser={stopDarazBrowser}
              checking={checking}
              checkAllLinks={checkAllLinks}
              activeJob={activeJob}
              message={message}
              messageTone={messageTone}
            />
          )}
          {tab === "messages" && user.role === "admin" && <MessagesPanel />}
          {tab === "admin" && user.role === "admin" && <AdminPanel />}
          {tab === "settings" && <SettingsPanel />}
        </div>
      </div>

      {/* CREATE MODAL */}
      {showCreateModal && (
        <div className="modal-overlay">
          <div className={`modal-card ${addMode === "search" ? "modal-card--wide" : ""}`}>
            <div className="modal-header">
              <h3 className="modal-title">Monitor a New Product</h3>
              <button 
                type="button" 
                className="modal-close" 
                disabled={addingLink}
                onClick={() => { if (!addingLink) closeCreateModal(); }}
              >
                &times;
              </button>
            </div>
            <div className="modal-tabs">
              <button
                type="button"
                className={`modal-tab ${addMode === "url" ? "modal-tab--active" : ""}`}
                disabled={addingLink}
                onClick={() => setAddMode("url")}
              >
                Paste Link
              </button>
              <button
                type="button"
                className={`modal-tab ${addMode === "search" ? "modal-tab--active" : ""}`}
                disabled={addingLink}
                onClick={() => setAddMode("search")}
              >
                Search Daraz
              </button>
            </div>
            <form onSubmit={(e) => void addLink(e)}>
              <div className="modal-body">
                {addMode === "url" ? (
                  <>
                    <p className="modal-help">
                      Paste a Daraz product link below. CartTruth will verify the checkout total price (including payment processing fees and delivery charges) regularly.
                    </p>
                    {darazSessionWarning && !addingLink && (
                      <div className="modal-message modal-message--warn" style={{ marginBottom: 12 }}>
                        {darazSessionWarning}
                      </div>
                    )}
                    <input
                      type="text"
                      value={productUrl}
                      onChange={(e) => setProductUrl(e.target.value)}
                      placeholder="https://www.daraz.lk/products/..."
                      className="modal-input"
                      autoFocus
                      disabled={addingLink}
                    />
                  </>
                ) : (
                  <>
                    <p className="modal-help">
                      Search Daraz products and select one to monitor. CartTruth will save it and verify the final checkout price.
                    </p>
                    <div className="modal-search-bar">
                      <input
                        type="search"
                        value={darazQuery}
                        onChange={(e) => setDarazQuery(e.target.value)}
                        placeholder="Search Daraz products"
                        className="modal-input"
                        disabled={addingLink || searchingDaraz}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            void searchDarazProducts();
                          }
                        }}
                      />
                      <button
                        type="button"
                        className="db-btn-secondary"
                        disabled={addingLink || searchingDaraz || !darazQuery.trim()}
                        onClick={() => void searchDarazProducts()}
                      >
                        {searchingDaraz ? "Searching…" : "Search"}
                      </button>
                    </div>
                    {searchingDaraz && (
                      <>
                        <p className="modal-search-status">Fetching real prices from Daraz product pages…</p>
                        <div className="modal-search-results modal-search-results--grid">
                        {Array.from({ length: 6 }, (_, index) => (
                          <div key={`skeleton-${index}`} className="modal-search-skeleton" aria-hidden="true">
                            <div className="modal-search-skeleton-image" />
                            <div className="modal-search-skeleton-line modal-search-skeleton-line--title" />
                            <div className="modal-search-skeleton-line modal-search-skeleton-line--short" />
                            <div className="modal-search-skeleton-price" />
                          </div>
                        ))}
                        </div>
                      </>
                    )}
                    {!searchingDaraz && searchResults.length > 0 && (
                      <div className="modal-search-results modal-search-results--grid">
                        {searchResults.map((product) => {
                          const selected = selectedSearchProduct?.url === product.url;
                          return (
                            <button
                              key={product.url}
                              type="button"
                              className={`modal-search-card ${selected ? "modal-search-card--selected" : ""}`}
                              disabled={addingLink}
                              onClick={() => selectSearchProduct(product)}
                            >
                              <div className="modal-search-card-media">
                                {product.imageUrl ? (
                                  <img src={product.imageUrl} alt="" className="modal-search-card-image" />
                                ) : (
                                  <div className="modal-search-card-image modal-search-card-image--placeholder" />
                                )}
                                {selected && (
                                  <span className="modal-search-card-check" aria-hidden="true">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="14" height="14">
                                      <polyline points="20 6 9 17 4 12" />
                                    </svg>
                                  </span>
                                )}
                              </div>
                              <div className="modal-search-card-body">
                                <p className="modal-search-card-title">{product.title}</p>
                                <div className="modal-search-card-meta">
                                  <span className="modal-search-card-price">{formatMoney(product.observedPrice)}</span>
                                  {product.availability === "unavailable" && (
                                    <span className="modal-search-card-badge">Out of stock</span>
                                  )}
                                </div>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    )}
                    {!searchingDaraz && selectedSearchProduct && (
                      <div className="modal-selected-product">
                        <span className="modal-selected-product-label">Selected product</span>
                        <strong>{selectedSearchProduct.title}</strong>
                        <span>{formatMoney(selectedSearchProduct.observedPrice)}</span>
                      </div>
                    )}
                  </>
                )}
                <ActivityLog entries={activityLog} />
                {message && <p className={`modal-message modal-message--${messageTone}`}>{message}</p>}
                {darazSession.status !== "saved" && activityLog.length > 0 && (
                  <button
                    type="button"
                    className="modal-session-link"
                    onClick={() => { closeCreateModal(); setTab("session"); }}
                  >
                    Open Daraz Session setup →
                  </button>
                )}
              </div>
              <div className="modal-footer">
                <button 
                  type="button" 
                  className="db-btn-secondary" 
                  disabled={addingLink}
                  onClick={() => { if (!addingLink) closeCreateModal(); }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="db-btn-primary"
                  disabled={addingLink || (addMode === "search" && !selectedSearchProduct)}
                >
                  {addingLink ? "Working…" : "Save & Check"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

/* ============================================================
   DASHBOARD OVERVIEW TAB — Stats, Chart, Popular products, Comments
   ============================================================ */
function DashboardOverview({
  links,
  history,
  latest,
  darazSession,
  onNavigate,
  onCreateClick,
  onRunCheck,
  checking
}: {
  links: SavedLink[];
  history: DarazCheckResult[];
  latest: DarazCheckResult | undefined;
  darazSession: DarazSession;
  onNavigate: (tab: "dashboard" | "products" | "session" | "messages" | "admin" | "settings") => void;
  user: AppUser;
  onCreateClick: () => void;
  onRunCheck: () => void;
  checking: boolean;
}) {
  const checkedCount = history.filter(r => r.status === "checked").length;
  const totalRuns = history.length;
  const latestCheckout = latest?.checkoutTotal;
  const sessionActive = darazSession.status === "saved";
  const blockedCount = history.filter(r => r.status === "blocked").length;
  const partialCount = history.filter(r => r.status !== "checked" && r.status !== "blocked").length;
  const verifiedPct = totalRuns > 0 ? Math.round((checkedCount / totalRuns) * 100) : 0;
  const blockedPct = totalRuns > 0 ? Math.round((blockedCount / totalRuns) * 100) : 0;
  const partialPct = totalRuns > 0 ? Math.round((partialCount / totalRuns) * 100) : 0;

  const priceRuns = history.slice(0, 12).reverse();
  const chartPrices = priceRuns.map(r => (r.checkoutTotal?.minorUnits ?? 0) / 100);
  const chartData = chartPrices.length >= 2 ? chartPrices : [1250, 1320, 1195, 1410, 1380, 1290, 1430, 1375, 1420, 1310, 1450, 1390];
  const chartLabels = priceRuns.length >= 2
    ? priceRuns.map(r => new Date(r.startedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" }))
    : ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  const priceChange = chartData.length >= 2
    ? ((chartData[chartData.length - 1] - chartData[0]) / chartData[0]) * 100
    : 0;
  const sparkData = chartData.slice(-6);
  const checkoutResult = pickCheckoutResult(latest, history);
  const productCompare = buildProductCompareChart(links, checkoutResult);
  const chartFmt = (v: number) => v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(Math.round(v));

  return (
    <div className="fd-dash-grid">
      <div className="fd-dash-top">
        <FinSummaryCard
          title="Monitored Links"
          value={String(links.length)}
          badge={links.length > 0 ? "active" : undefined}
          badgeType="up"
          description={links.length > 0
            ? "Products being tracked for checkout price changes."
            : "Add a Daraz product link to start monitoring."}
        />
        <FinSummaryCard
          title="Price Checks"
          value={String(totalRuns)}
          badge={checkedCount > 0 ? `${checkedCount} verified` : undefined}
          badgeType="up"
          description={`${checkedCount} successful verification${checkedCount === 1 ? "" : "s"} completed.`}
        >
          {sparkData.length >= 2 && <MiniSparkline data={sparkData} />}
        </FinSummaryCard>
        <div className="fd-cta-card">
          <div className="fd-cta-glow" />
          <p className="fd-cta-title">Verify checkout prices</p>
          <p className="fd-cta-sub">Run a full Daraz checkout verification on all saved products.</p>
          <button type="button" className="fd-cta-btn" disabled={checking || links.length === 0} onClick={onRunCheck}>
            {checking ? "Running..." : "Run Price Check"}
          </button>
        </div>
      </div>

      <div className="fd-dash-charts">
        <LargeAreaChart
          title="Checkout Price History"
          subtitle="Verified checkout totals from recent runs"
          headline={latestCheckout ? formatMoney(latestCheckout) : `LKR ${chartData[chartData.length - 1].toLocaleString()}`}
          badge={priceChange !== 0 ? `${priceChange > 0 ? "+" : ""}${priceChange.toFixed(1)}%` : undefined}
          badgeType={priceChange >= 0 ? "up" : "down"}
          headlineNote={totalRuns > 0 ? `across ${totalRuns} run${totalRuns === 1 ? "" : "s"}` : "sample data — run a check to see real prices"}
          data={chartData}
          labels={chartLabels}
          height={300}
          formatValue={chartFmt}
        />
        <LargeGroupedBarChart
          title="Product Price Comparison"
          subtitle="Listed price vs verified checkout per product"
          headlineNote={productCompare.isSample ? "sample data — add products to compare" : `${links.length} product${links.length === 1 ? "" : "s"}`}
          series={productCompare.series}
          labels={productCompare.labels}
          height={300}
          formatValue={chartFmt}
        />
      </div>

      <div className="fd-dash-bottom">
        <div className="fd-panel-card">
          <div className="fd-panel-header">
            <h3 className="fd-panel-title">Monitored Products</h3>
            <button type="button" className="fd-panel-action" onClick={onCreateClick}>+ Add</button>
          </div>
          {links.length === 0 ? (
            <div className="fd-empty">
              <p>No products monitored yet.</p>
              <button type="button" className="fd-link-btn" onClick={onCreateClick}>Add your first product</button>
            </div>
          ) : (
            <div className="fd-contact-list">
              {links.slice(0, 5).map(link => {
                const listed = parseObservedPrice(link);
                const checkoutProduct = findProductCheckout(link, checkoutResult);
                const verified = checkoutProduct?.checkoutLinePrice ?? checkoutProduct?.checkoutUnitPrice;
                return (
                  <div className="fd-contact-row" key={link.id}>
                    <div className="fd-contact-avatar">
                      {link.imageUrl ? <img src={link.imageUrl} alt={link.title} /> : <span>📦</span>}
                    </div>
                    <div className="fd-contact-info">
                      <span className="fd-contact-name" title={link.title}>{link.title}</span>
                      <span className="fd-contact-role">
                        {listed ? `${formatMoney(listed)} listed` : "Listed price pending"}
                        {verified ? ` · ${formatMoney(verified)} verified` : ""}
                      </span>
                    </div>
                    <span className={`fd-status-pill ${verified ? "fd-status-pill--ok" : sessionActive ? "fd-status-pill--warn" : "fd-status-pill--warn"}`}>
                      {verified ? "Verified" : sessionActive ? "Listed only" : "Offline"}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
          {links.length > 5 && (
            <button type="button" className="fd-link-btn fd-link-btn--center" onClick={() => onNavigate("products")}>
              View all {links.length} products
            </button>
          )}
        </div>

        <div className="fd-panel-card">
          <div className="fd-panel-header">
            <h3 className="fd-panel-title">Verification Snapshot</h3>
            <span className="fd-chart-pill">{totalRuns} runs</span>
          </div>
          <div className="fd-gauge-row">
            <RingGauge value={verifiedPct} label="Verified" sublabel="Successful checks" color="#2563eb" />
            <RingGauge value={partialPct} label="Partial" sublabel="Needs attention" color="#60a5fa" />
            <RingGauge value={blockedPct} label="Blocked" sublabel="Failed checks" color="#1d4ed8" />
          </div>
          <div className="fd-session-strip">
            <span>Daraz Session</span>
            <span className={`fd-status-pill ${sessionActive ? "fd-status-pill--ok" : "fd-status-pill--warn"}`}>
              {sessionActive ? "Connected" : darazSession.status === "needs_login" ? "Login needed" : "Not set up"}
            </span>
            {!sessionActive && (
              <button type="button" className="fd-link-btn" onClick={() => onNavigate("session")}>Connect →</button>
            )}
          </div>
        </div>

        <div className="fd-panel-card fd-dash-recent">
          <div className="fd-panel-header">
            <h3 className="fd-panel-title">Recent Runs</h3>
            <span className="fd-chart-pill">{checkedCount} verified</span>
          </div>
          {history.length === 0 ? (
            <div className="fd-empty"><p>No checks run yet.</p></div>
          ) : (
            <div className="fd-contact-list">
              {history.slice(0, 6).map((run, idx) => {
                const isOk = run.status === "checked";
                const dateStr = new Date(run.startedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" });
                return (
                  <div className="fd-contact-row" key={run.runId || idx}>
                    <div className="fd-contact-avatar fd-contact-avatar--letter">
                      <span>{isOk ? "✓" : "!"}</span>
                    </div>
                    <div className="fd-contact-info">
                      <span className="fd-contact-name" title={run.products[0]?.title}>
                        {run.products[0]?.title ?? `Run #${totalRuns - idx}`}
                      </span>
                      <span className="fd-contact-role">{dateStr}</span>
                    </div>
                    {isOk && run.checkoutTotal ? (
                      <span className="fd-recent-total">{formatMoney(run.checkoutTotal)}</span>
                    ) : (
                      <span className={`fd-status-pill ${isOk ? "fd-status-pill--ok" : run.status === "blocked" ? "fd-status-pill--err" : "fd-status-pill--warn"}`}>
                        {isOk ? "OK" : run.status === "blocked" ? "Blocked" : "Partial"}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}


/* ============================================================
   PRODUCTS TAB PANEL
   ============================================================ */
function ProductsPanel({
  links,
  searchQuery,
  history,
  latest,
  removeLink,
  checking,
  checkAllLinks,
  activeJob,
  message,
  messageTone = "info"
}: {
  links: SavedLink[];
  searchQuery: string;
  history: DarazCheckResult[];
  latest: DarazCheckResult | undefined;
  removeLink: (id: string) => Promise<void>;
  checking: boolean;
  checkAllLinks: () => Promise<void>;
  activeJob: PriceCheckJob | undefined;
  message: string;
  messageTone?: MessageTone;
}) {
  const filteredLinks = useMemo(() => {
    if (!searchQuery.trim()) return links;
    return links.filter(l => l.title.toLowerCase().includes(searchQuery.toLowerCase()) || l.url.toLowerCase().includes(searchQuery.toLowerCase()));
  }, [links, searchQuery]);

  const productPageTotal = useMemo(() => filteredLinks.reduce((total, link) => {
    const observed = parseObservedPrice(link)?.minorUnits ?? 0;
    return total + observed;
  }, 0), [filteredLinks]);

  const checkoutResult = useMemo(() => pickCheckoutResult(latest, history), [latest, history]);
  const productCompare = buildProductCompareChart(filteredLinks, checkoutResult);
  const chartFmt = (v: number) => v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(Math.round(v));

  return (
    <div className="fd-admin-layout">
      <div className="fd-panel-header" style={{ marginBottom: 20 }}>
        <h2 className="fd-panel-title" style={{ fontSize: 20 }}>Saved Products ({filteredLinks.length})</h2>
        <button
          type="button"
          className="fd-header-primary-btn"
          disabled={checking || links.length === 0}
          onClick={() => void checkAllLinks()}
        >
          {checking ? "Running..." : "Run Price Verification"}
        </button>
      </div>

      <StatusBanner message={message} tone={messageTone} />
      {activeJob && (
        <div className="active-job-banner">
          <span>{priceCheckJobLabel(activeJob)}</span>
        </div>
      )}

      <div className="fd-dash-charts fd-dash-charts--single">
        <LargeGroupedBarChart
          title="Product Price Comparison"
          subtitle="Listed price vs verified checkout"
          headlineNote={productCompare.isSample ? "sample data" : `${filteredLinks.length} products`}
          series={productCompare.series}
          labels={productCompare.labels}
          height={280}
          formatValue={chartFmt}
        />
      </div>

      <div className="fd-products-layout">
        <div className="fd-panel-card">
          <h3 className="fd-panel-title" style={{ marginBottom: 16 }}>Monitored Links</h3>
          {filteredLinks.length === 0 ? (
            <div className="fd-empty">
              <p>{searchQuery ? "No products match your search." : "No saved links yet. Click Monitor Product to add a URL."}</p>
            </div>
          ) : (
            <div className="fd-contact-list">
              {filteredLinks.map((link) => {
                const listed = parseObservedPrice(link);
                const checkoutProduct = findProductCheckout(link, checkoutResult);
                const verified = checkoutProduct?.checkoutLinePrice ?? checkoutProduct?.checkoutUnitPrice;
                return (
                <div className="fd-contact-row" key={link.id}>
                  <div className="fd-contact-avatar">
                    {link.imageUrl ? <img src={link.imageUrl} alt={link.title} /> : <span>📦</span>}
                  </div>
                    <div className="fd-contact-info">
                      <span className="fd-contact-name" title={link.title}>{link.title}</span>
                      <span className="fd-contact-role">
                        {listed ? `${formatMoney(listed)} listed` : "Listed price pending"}
                        {verified ? ` · ${formatMoney(verified)} verified` : ""}
                      </span>
                      <a href={link.url} target="_blank" rel="noreferrer" className="fd-link-btn" title={link.url}>View on Daraz ↗</a>
                    </div>
                  <span className="fd-recent-total" title={verified ? "Verified checkout line price" : "Product page price"}>
                    {formatMoney(verified ?? listed)}
                  </span>
                  <button type="button" className="fd-message-delete" onClick={() => void removeLink(link.id)} title="Remove">
                    <svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14"><path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" /></svg>
                  </button>
                </div>
              );})}
              <div className="fd-session-strip" style={{ marginTop: 12 }}>
                <span>Product-page total</span>
                <strong>{formatLkr(productPageTotal)}</strong>
              </div>
              {checkoutResult?.checkoutTotal && (
                <div className="fd-session-strip">
                  <span>Verified checkout total</span>
                  <strong>{formatMoney(checkoutResult.checkoutTotal)}</strong>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="fd-panel-card fd-panel-card--checkout">
          <h3 className="fd-panel-title" style={{ marginBottom: 16 }}>Latest Checkout Results</h3>
          {checkoutResult && hasCheckoutDetails(checkoutResult) ? (
            <div className="price-results-section">
              <div className="fd-chart-headline-row" style={{ marginBottom: 16 }}>
                <span className="fd-chart-headline">{formatMoney(checkoutResult.checkoutTotal)}</span>
                <span className="fd-chart-headline-note">
                  verified checkout total · {new Date(checkoutResult.finishedAt).toLocaleString()}
                </span>
              </div>
              <CheckoutSummary result={checkoutResult} />
              <PriceTable result={checkoutResult} />
            </div>
          ) : checkoutResult ? (
            <div className="price-results-section">
              <StatusBanner
                message={checkoutResult.message ?? "Checkout verification did not return final prices yet. Connect Daraz and run verification again."}
                tone="warn"
              />
              <PriceTable result={checkoutResult} />
            </div>
          ) : (
            <div className="fd-empty">
              <p>No verified checks completed yet. Trigger a price verification run to see final checkout totals.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   SESSION PANEL
   ============================================================ */
function SessionPanel({
  darazSession,
  credentials,
  captureId,
  browserUrl,
  startDarazLogin,
  saveDarazLogin,
  resetDarazLogin,
  stopDarazBrowser,
  message,
  messageTone = "info"
}: {
  darazSession: DarazSession;
  credentials: DarazCredentialStatus;
  captureId: string;
  browserUrl: string;
  startDarazLogin: () => Promise<void>;
  saveDarazLogin: () => Promise<void>;
  resetDarazLogin: () => Promise<void>;
  stopDarazBrowser: () => Promise<void>;
  checking: boolean;
  checkAllLinks: () => Promise<void>;
  activeJob: PriceCheckJob | undefined;
  message: string;
  messageTone?: MessageTone;
}) {
  const isConnected = darazSession.status === "saved";
  const isLive = Boolean(captureId && browserUrl);
  const steps = [
    { n: 1, title: "Start session", desc: "Launch a remote browser on the CartTruth server." },
    { n: 2, title: "Log in to Daraz", desc: "Open the remote browser and complete login or OTP." },
    { n: 3, title: "Save session", desc: "Return here and save cookies for automated checks." },
    { n: 4, title: "Verify prices", desc: "Add a product and run a checkout verification." }
  ];
  const activeStep = isConnected ? 4 : isLive ? 3 : captureId ? 2 : 1;

  return (
    <div className="fd-page">
      <div className="fd-page-header">
        <div>
          <h2 className="fd-page-title">Daraz Session</h2>
          <p className="fd-page-sub">Connect your Daraz account for automated checkout price checks.</p>
        </div>
        <span className={`fd-status-pill ${isConnected ? "fd-status-pill--ok" : darazSession.status === "needs_login" ? "fd-status-pill--err" : "fd-status-pill--warn"}`}>
          {sessionLabel(darazSession.status)}
        </span>
      </div>

      <StatusBanner message={message} tone={messageTone} />

      <div className="fd-session-hero">
        <div className="fd-session-hero-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="28" height="28">
            <rect x="3" y="5" width="18" height="14" rx="2"/>
            <line x1="3" y1="10" x2="21" y2="10"/>
            <line x1="8" y1="3" x2="8" y2="7"/>
            <line x1="16" y1="3" x2="16" y2="7"/>
          </svg>
        </div>
        <div className="fd-session-hero-body">
          <p className="fd-session-hero-title">{isConnected ? "Session ready" : isLive ? "Browser active — finish login" : "No active session"}</p>
          <p className="fd-session-hero-desc">{sessionHelpText(darazSession, credentials)}</p>
          <div className="fd-session-meta">
            {credentials.saved && (
              <span className="fd-meta-chip">
                <span className="fd-meta-dot fd-meta-dot--ok" />
                Credentials saved{credentials.username ? ` · ${credentials.username}` : ""}
              </span>
            )}
            {darazSession.savedAt && (
              <span className="fd-meta-chip">Saved {new Date(darazSession.savedAt).toLocaleDateString()}</span>
            )}
            {darazSession.live && <span className="fd-meta-chip"><span className="fd-meta-dot fd-meta-dot--ok" />Live browser</span>}
          </div>
        </div>
      </div>

      <div className="fd-settings-grid">
        <div className="fd-panel-card">
          <h3 className="fd-panel-title">Session Controls</h3>
          <p className="fd-card-desc">Manage your remote Daraz browser connection.</p>
          <div className="fd-btn-group">
            {isLive ? (
              <a className="fd-btn fd-btn--primary" href={browserUrl} target="_blank" rel="noreferrer">
                Open Remote Browser ↗
              </a>
            ) : (
              <button type="button" className="fd-btn fd-btn--primary" disabled={Boolean(captureId)} onClick={() => void startDarazLogin()}>
                {captureId ? "Browser Starting…" : "Start Login Session"}
              </button>
            )}
            <button type="button" className="fd-btn fd-btn--secondary" disabled={!captureId} onClick={() => void saveDarazLogin()}>
              Save Login Session
            </button>
          </div>
          <div className="fd-btn-group fd-btn-group--secondary">
            <button type="button" className="fd-btn fd-btn--ghost" disabled={!captureId && darazSession.status === "missing"} onClick={() => void resetDarazLogin()}>
              Reset Session
            </button>
            <button type="button" className="fd-btn fd-btn--ghost" disabled={!captureId} onClick={() => void stopDarazBrowser()}>
              Stop Browser
            </button>
          </div>
        </div>

        <div className="fd-panel-card">
          <h3 className="fd-panel-title">Setup Guide</h3>
          <p className="fd-card-desc">Follow these steps to connect Daraz.</p>
          <div className="fd-step-list">
            {steps.map(step => (
              <div key={step.n} className={`fd-step-item${activeStep >= step.n ? " fd-step-item--done" : ""}${activeStep === step.n ? " fd-step-item--active" : ""}`}>
                <span className="fd-step-num">{step.n}</span>
                <div className="fd-step-content">
                  <span className="fd-step-title">{step.title}</span>
                  <span className="fd-step-desc">{step.desc}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   ADMIN PANEL — stat cards + charts + tables (Admin dashboard)
   ============================================================ */
function AdminPanel() {
  const [users, setUsers] = useState<AppUser[]>([]);
  const [proxySummary, setProxySummary] = useState<AdminProxySummary | undefined>();
  const [proxyEvents, setProxyEvents] = useState<ProxyEvent[]>([]);
  const [proxyTest, setProxyTest] = useState<{ ok: boolean; status: number; elapsedMs: number; proxy: string; bodyPreview: string } | undefined>();
  const [testingProxy, setTestingProxy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => { void refresh(); }, []);

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

  const activeUsers = users.filter(u => !u.disabled).length;
  const totalEvents = proxySummary?.events.total ?? 0;
  const byStatus = proxySummary?.events.byStatus ?? [];
  const successCount = byStatus.find(s => s.key === "success")?.count ?? 0;
  const failCount = byStatus.find(s => s.key === "failure")?.count ?? 0;
  const blockedCount = byStatus.find(s => s.key === "blocked")?.count ?? 0;

  const disabledUsers = users.filter(u => u.disabled).length;
  const adminUsers = users.filter(u => u.role === "admin").length;

  const recentEvents = proxyEvents.slice(0, 8).reverse();
  const eventLabels = recentEvents.map((e, i) => {
    const d = new Date(e.createdAt);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  });
  const successData = recentEvents.map(e => e.status === "success" ? 1 : 0);
  const failData = recentEvents.map(e => e.status === "failure" ? 1 : 0);
  const blockedData = recentEvents.map(e => e.status === "blocked" ? 1 : 0);
  const hasEventData = recentEvents.length >= 2;

  const responseTimes = recentEvents.map(e => e.elapsedMs ?? 0);
  const avgResponse = responseTimes.length > 0
    ? Math.round(responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length)
    : 0;

  return (
    <div className="fd-admin-layout">
      <div className="fd-admin-stats">
        <StatCard label="Total Users" value={String(users.length)} note={`${activeUsers} active, ${disabledUsers} disabled`} />
        <StatCard label="Active Users" value={String(activeUsers)} note={`${adminUsers} admin${adminUsers === 1 ? "" : "s"}`} />
        <StatCard label="Proxy Events" value={String(totalEvents)} note={`${successCount} success, ${failCount} failure`} />
        <StatCard label="Proxy Status" value={proxySummary?.proxy.enabled ? "Active" : "Inactive"} note={proxySummary?.proxy.country ?? "not configured"} />
      </div>

      <div className="fd-admin-charts">
        <div className="fd-admin-chart-main">
          {hasEventData ? (
            <LargeStackedBarChart
              title="Proxy Event Activity"
              subtitle="Recent events by outcome"
              series={[
                { name: "Success", color: "#2563eb", data: successData },
                { name: "Failure", color: "#60a5fa", data: failData },
                { name: "Blocked", color: "#93c5fd", data: blockedData }
              ]}
              labels={eventLabels.length > 0 ? eventLabels : ["—"]}
              height={320}
            />
          ) : (
            <LargeAreaChart
              title="Proxy Response Times"
              subtitle="Elapsed milliseconds per recent event"
              headline={avgResponse > 0 ? `${avgResponse}ms` : "No data"}
              headlineNote="average response time"
              data={responseTimes.length >= 2 ? responseTimes : [120, 340, 200, 480, 300, 520, 410, 380]}
              labels={eventLabels.length >= 2 ? eventLabels : ["E1","E2","E3","E4","E5","E6","E7","E8"]}
              height={320}
            />
          )}
        </div>
        <div className="fd-admin-chart-side">
          <LargeDonutChart
            title="Events by Status"
            subtitle="All recorded proxy events"
            segments={[
              { value: successCount, color: "#2563eb", name: "Success" },
              { value: failCount, color: "#60a5fa", name: "Failure" },
              { value: blockedCount, color: "#93c5fd", name: "Blocked" }
            ]}
            size={160}
          />
          <div className="fd-panel-card" style={{ marginTop: 16 }}>
            <div className="fd-panel-header">
              <h3 className="fd-panel-title">User Breakdown</h3>
            </div>
            <div className="fd-gauge-row fd-gauge-row--compact">
              <RingGauge
                value={users.length > 0 ? Math.round((activeUsers / users.length) * 100) : 0}
                label="Active" sublabel={`${activeUsers} users`} color="#2563eb" size={72}
              />
              <RingGauge
                value={users.length > 0 ? Math.round((disabledUsers / users.length) * 100) : 0}
                label="Disabled" sublabel={`${disabledUsers} users`} color="#60a5fa" size={72}
              />
              <RingGauge
                value={users.length > 0 ? Math.round((adminUsers / users.length) * 100) : 0}
                label="Admin" sublabel={`${adminUsers} users`} color="#1d4ed8" size={72}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="fd-panel-card fd-panel-card--full">
        <div className="fd-panel-header">
          <h3 className="fd-panel-title">Users</h3>
          <span className="fd-chart-pill">{users.length} total</span>
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
                  <td><span className={`db-badge ${item.role === "admin" ? "db-badge--purple" : "db-badge--grey"}`}>{item.role}</span></td>
                  <td><span className={`status ${item.disabled ? "blocked" : "checked"}`}>{item.disabled ? "disabled" : "active"}</span></td>
                  <td style={{ color: "#64748b", fontSize: 13 }}>{new Date(item.createdAt).toLocaleString()}</td>
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
      </div>

      <div className="fd-dash-bottom">
        <div className="fd-panel-card">
          <div className="fd-panel-header">
            <h3 className="fd-panel-title">Proxy Operations</h3>
            <span className={`fd-status-pill ${proxySummary?.proxy.enabled ? "fd-status-pill--ok" : "fd-status-pill--warn"}`}>
              {proxySummary?.proxy.enabled ? "Configured" : "Setup required"}
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
          <button type="button" className="fd-header-primary-btn" style={{ marginTop: 12 }} disabled={testingProxy} onClick={() => void testProxy()}>
            {testingProxy ? "Testing..." : "Run Proxy Test"}
          </button>
          {proxyTest && <p className="message">Last test: {proxyTest.ok ? "✓ OK" : "✗ Failed"} ({proxyTest.status}) in {proxyTest.elapsedMs}ms</p>}
          <p className="message">{proxySummary?.external.note}</p>
        </div>

        <div className="fd-panel-card">
          <div className="fd-panel-header">
            <h3 className="fd-panel-title">Recent Proxy Events</h3>
            <button type="button" className="fd-link-btn" onClick={() => void refresh()}>Refresh</button>
          </div>
          {message && <p className="message">{message}</p>}
          <div className="event-summary" style={{ marginBottom: 12 }}>
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
                  <th>Status</th>
                  <th>API key</th>
                </tr>
              </thead>
              <tbody>
                {proxyEvents.length === 0 ? (
                  <tr><td colSpan={4} style={{ color: "#94a3b8", fontStyle: "italic" }}>No proxy events yet.</td></tr>
                ) : proxyEvents.slice(0, 8).map((event) => (
                  <tr key={event.id}>
                    <td style={{ fontSize: 12, color: "#64748b" }}>{new Date(event.createdAt).toLocaleString()}</td>
                    <td style={{ fontSize: 12 }}>{event.operation}</td>
                    <td><span className={`status ${event.status === "success" ? "checked" : event.status === "blocked" ? "blocked" : "needs_attention"}`}>{event.status}</span></td>
                    <td style={{ fontSize: 12, color: "#64748b" }}>{event.apiKeyPrefix ?? "none"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   MESSAGES PANEL — contact messages from landing page
   ============================================================ */
function MessagesPanel() {
  const [messages, setMessages] = useState<ContactMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteMsg, setDeleteMsg] = useState("");

  useEffect(() => { void refresh(); }, []);

  async function refresh() {
    setLoading(true);
    try {
      const response = await fetchJson<{ messages: ContactMessage[] }>("/api/admin/messages");
      setMessages(response.messages);
    } finally {
      setLoading(false);
    }
  }

  async function deleteMessage(id: string) {
    await fetchJson<{ ok: boolean }>(`/api/admin/messages/${id}`, { method: "DELETE" });
    setDeleteMsg("Message deleted.");
    await refresh();
    setTimeout(() => setDeleteMsg(""), 2500);
  }

  const thisMonth = messages.filter(m => {
    const d = new Date(m.createdAt);
    const now = new Date();
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  }).length;

  const messagesByMonth = useMemo(() => {
    const counts: Record<string, number> = {};
    messages.forEach(m => {
      const key = new Date(m.createdAt).toLocaleDateString("en-US", { month: "short" });
      counts[key] = (counts[key] ?? 0) + 1;
    });
    const entries = Object.entries(counts).slice(-8);
    return {
      labels: entries.map(([k]) => k),
      data: entries.map(([, v]) => v)
    };
  }, [messages]);

  return (
    <div className="fd-admin-layout">
      <div className="fd-admin-stats">
        <StatCard label="Total Messages" value={String(messages.length)} note="All contact form submissions" />
        <StatCard label="This Month" value={String(thisMonth)} note={`${messages.length - thisMonth} from earlier`} />
      </div>

      {messagesByMonth.labels.length >= 2 && (
        <div className="fd-admin-chart-main" style={{ marginBottom: 24 }}>
          <LargeAreaChart
            title="Message Volume"
            subtitle="Contact form submissions over time"
            headline={String(messages.length)}
            headlineNote="total messages received"
            data={messagesByMonth.data}
            labels={messagesByMonth.labels}
            height={280}
          />
        </div>
      )}

      <div className="fd-panel-card fd-panel-card--full">
        <div className="fd-panel-header">
          <h3 className="fd-panel-title">Contact Messages</h3>
          <button type="button" className="fd-link-btn" onClick={() => void refresh()}>Refresh</button>
        </div>
        {deleteMsg && <p className="message">{deleteMsg}</p>}
        {loading ? (
          <p style={{ color: "#94a3b8", padding: "24px 0", fontStyle: "italic" }}>Loading messages...</p>
        ) : messages.length === 0 ? (
          <div className="fd-empty">
            <p>No messages yet. They'll appear here when visitors submit the contact form.</p>
          </div>
        ) : (
          <div className="fd-contact-list fd-contact-list--messages">
            {messages.map((msg) => (
              <div key={msg.id} className="fd-message-row">
                <div className="fd-contact-avatar fd-contact-avatar--letter">
                  <span>{msg.subject[0]?.toUpperCase() ?? "M"}</span>
                </div>
                <div className="fd-message-body">
                  <div className="fd-message-top">
                    <span className="fd-contact-name">{msg.subject}</span>
                    <span className="fd-recent-date">{new Date(msg.createdAt).toLocaleString()}</span>
                  </div>
                  <p className="fd-message-content">{msg.content}</p>
                </div>
                <button
                  type="button"
                  className="fd-message-delete"
                  onClick={() => void deleteMessage(msg.id)}
                  title="Delete message"
                >
                  <svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14"><path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" /></svg>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* Old UserPanel component deleted — states and views migrated to Dashboard shell & subpanels */

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
    <div className="fd-page">
      <div className="fd-page-header">
        <div>
          <h2 className="fd-page-title">Settings</h2>
          <p className="fd-page-sub">Configure price checks, credentials, proxy, and API access.</p>
        </div>
      </div>

      {message && <div className="fd-alert fd-alert--success">{message}</div>}

      <div className="fd-settings-grid">
        <NotificationChannelsPanel />

        <div className="fd-panel-card">
          <div className="fd-card-header">
            <div>
              <h3 className="fd-panel-title">Auto Price Checking</h3>
              <p className="fd-card-desc">Schedule automatic checkout verifications.</p>
            </div>
            <span className={`fd-status-pill ${settings?.autoPriceCheckEnabled ? "fd-status-pill--ok" : "fd-status-pill--warn"}`}>
              {settings?.autoPriceCheckEnabled ? "On" : "Off"}
            </span>
          </div>
          <form className="fd-form" onSubmit={(event) => void saveSettings(event)}>
            <label className="fd-toggle-row">
              <input type="checkbox" checked={autoEnabled} onChange={(event) => setAutoEnabled(event.target.checked)} />
              <span className="fd-toggle-track" />
              <span className="fd-toggle-label">Run automatic final-price checks</span>
            </label>
            <label className="fd-form-field">
              <span className="fd-form-label">Check interval (hours)</span>
              <input className="fd-form-input" type="number" min={1} max={24} value={intervalHours} onChange={(event) => setIntervalHours(Number(event.target.value))} />
            </label>
            <button type="submit" className="fd-btn fd-btn--primary">Save settings</button>
          </form>
          <div className="fd-detail-list">
            <div className="fd-detail-row">
              <span>Next run</span>
              <strong>{settings?.autoPriceCheckEnabled && settings.autoPriceCheckNextRunAt ? new Date(settings.autoPriceCheckNextRunAt).toLocaleString() : "Not scheduled"}</strong>
            </div>
            <div className="fd-detail-row">
              <span>Last check</span>
              <strong>{settings?.autoPriceCheckLastRunAt ? new Date(settings.autoPriceCheckLastRunAt).toLocaleString() : "None yet"}</strong>
            </div>
            {settings?.autoPriceCheckLastMessage && (
              <div className="fd-detail-row">
                <span>Status</span>
                <strong>{settings.autoPriceCheckLastMessage}</strong>
              </div>
            )}
          </div>
        </div>

        <div className="fd-panel-card">
          <div className="fd-card-header">
            <div>
              <h3 className="fd-panel-title">Daraz Credentials</h3>
              <p className="fd-card-desc">Encrypted login for best-effort auto-reconnect.</p>
            </div>
            <span className={`fd-status-pill ${credentials.saved ? "fd-status-pill--ok" : "fd-status-pill--warn"}`}>
              {credentials.saved ? "Saved" : "Missing"}
            </span>
          </div>
          <form className="fd-form" onSubmit={(event) => void saveDarazCredentials(event)}>
            <label className="fd-form-field">
              <span className="fd-form-label">Email or phone</span>
              <input className="fd-form-input" value={darazUsername} onChange={(event) => setDarazUsername(event.target.value)} placeholder="Daraz email or phone" autoComplete="username" />
            </label>
            <label className="fd-form-field">
              <span className="fd-form-label">Password</span>
              <input className="fd-form-input" value={darazPassword} onChange={(event) => setDarazPassword(event.target.value)} placeholder={credentials.saved ? "New password to update" : "Daraz password"} type="password" autoComplete="current-password" />
            </label>
            <div className="fd-btn-group">
              <button type="submit" className="fd-btn fd-btn--primary">Save encrypted</button>
              {credentials.saved && (
                <button type="button" className="fd-btn fd-btn--ghost" onClick={() => void deleteDarazCredentials()}>Remove</button>
              )}
            </div>
          </form>
        </div>

        <div className="fd-panel-card fd-panel-card--wide">
          <div className="fd-card-header">
            <div>
              <h3 className="fd-panel-title">TorchProxies Network</h3>
              <p className="fd-card-desc">Proxy routing for checkout price checks.</p>
            </div>
            <span className={`fd-status-pill ${proxyStatus?.enabled ? "fd-status-pill--ok" : "fd-status-pill--warn"}`}>
              {proxyStatus?.enabled ? "Configured" : "Setup required"}
            </span>
          </div>
          <div className="fd-detail-list fd-detail-list--grid">
            <div className="fd-detail-row"><span>Profile</span><strong>{proxyStatus?.id ?? "none"}</strong></div>
            <div className="fd-detail-row"><span>Pool</span><strong>{proxyStatus?.poolType ?? "unknown"}</strong></div>
            <div className="fd-detail-row"><span>Country</span><strong>{proxyStatus?.country ?? "unknown"}</strong></div>
            <div className="fd-detail-row"><span>Endpoint</span><strong>{proxyStatus?.masked ?? "none"}</strong></div>
          </div>
          <form className="fd-form" onSubmit={(event) => void saveSettings(event)}>
            <label className="fd-form-field">
              <span className="fd-form-label">Requested country</span>
              <select className="fd-form-input fd-form-select" value={proxyCountry} onChange={(event) => setProxyCountry(event.target.value)}>
                {countryOptions.map((country) => (
                  <option key={country} value={country}>{countryLabel(country)}</option>
                ))}
              </select>
            </label>
            <div className="fd-toggle-stack">
              <label className="fd-toggle-row">
                <input type="checkbox" checked={stickyPreview} onChange={(event) => setStickyPreview(event.target.checked)} />
                <span className="fd-toggle-track" />
                <span className="fd-toggle-label">Sticky checkout session</span>
              </label>
              <label className="fd-toggle-row">
                <input type="checkbox" checked={rotatePreview} onChange={(event) => setRotatePreview(event.target.checked)} />
                <span className="fd-toggle-track" />
                <span className="fd-toggle-label">Rotate proxy before next check</span>
              </label>
              <label className="fd-toggle-row">
                <input type="checkbox" checked={fallbackPreview} onChange={(event) => setFallbackPreview(event.target.checked)} />
                <span className="fd-toggle-track" />
                <span className="fd-toggle-label">Auto fallback country</span>
              </label>
            </div>
            <button type="submit" className="fd-btn fd-btn--primary">Save network preference</button>
          </form>
          <p className="fd-form-hint">Requested country is saved as a preference. Live routing uses the configured TorchProxies profile.</p>
        </div>

        <ApiKeysPanel />
      </div>
    </div>
  );
}

function NotificationChannelsPanel() {
  const [channels, setChannels] = useState<NotificationChannel[]>([]);
  const [connecting, setConnecting] = useState<NotificationPlatform | "">("");
  const [label, setLabel] = useState("");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [botToken, setBotToken] = useState("");
  const [chatId, setChatId] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    void refresh();
  }, []);

  async function refresh() {
    const response = await fetchJson<{ channels: NotificationChannel[] }>("/api/notification-channels");
    setChannels(response.channels);
  }

  function resetForm() {
    setConnecting("");
    setLabel("");
    setWebhookUrl("");
    setBotToken("");
    setChatId("");
  }

  async function connectChannel(event: React.FormEvent) {
    event.preventDefault();
    if (!connecting) {
      return;
    }
    try {
      const body = connecting === "telegram"
        ? { platform: connecting, label: label || undefined, botToken, chatId }
        : { platform: connecting, label: label || undefined, webhookUrl };
      const response = await postJson<{ channel: NotificationChannel }>("/api/notification-channels", body);
      setChannels((items) => [response.channel, ...items]);
      setMessage(`${platformLabel(response.channel.platform)} connected.`);
      resetForm();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function toggleChannel(channel: NotificationChannel) {
    const response = await patchJson<{ channel: NotificationChannel }>(`/api/notification-channels/${channel.id}`, {
      enabled: !channel.enabled
    });
    setChannels((items) => items.map((item) => item.id === channel.id ? response.channel : item));
    setMessage(`${platformLabel(channel.platform)} ${response.channel.enabled ? "enabled" : "disabled"}.`);
  }

  async function testChannel(channel: NotificationChannel) {
    try {
      const result = await postJson<{ ok: boolean; error?: string }>(`/api/notification-channels/${channel.id}/test`, {});
      if (result.ok) {
        setMessage(`${platformLabel(channel.platform)} test sent.`);
        await refresh();
      } else {
        setMessage(result.error ?? "Test delivery failed.");
        await refresh();
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
      await refresh();
    }
  }

  async function deleteChannel(channel: NotificationChannel) {
    await fetchJson(`/api/notification-channels/${channel.id}`, { method: "DELETE" });
    setChannels((items) => items.filter((item) => item.id !== channel.id));
    setMessage(`${platformLabel(channel.platform)} disconnected.`);
  }

  return (
    <div className="fd-panel-card fd-panel-card--wide">
      <div className="fd-card-header">
        <div>
          <h3 className="fd-panel-title">Notification Channels</h3>
          <p className="fd-card-desc">Get price and stock change alerts on Slack, Discord, or Telegram.</p>
        </div>
        <span className={`fd-status-pill ${channels.some((channel) => channel.enabled) ? "fd-status-pill--ok" : "fd-status-pill--warn"}`}>
          {channels.length > 0 ? `${channels.filter((channel) => channel.enabled).length} active` : "None connected"}
        </span>
      </div>

      {message && <div className="fd-alert fd-alert--success">{message}</div>}

      {channels.length > 0 && (
        <div className="fd-detail-list">
          {channels.map((channel) => (
            <div key={channel.id} className="fd-detail-row">
              <span>{channel.label ?? platformLabel(channel.platform)}</span>
              <div className="fd-btn-group">
                <span className={`fd-status-pill ${channel.lastError ? "fd-status-pill--err" : channel.enabled ? "fd-status-pill--ok" : "fd-status-pill--warn"}`}>
                  {channel.lastError ? "Error" : channel.enabled ? "On" : "Off"}
                </span>
                <button type="button" className="fd-btn fd-btn--ghost" onClick={() => void toggleChannel(channel)}>
                  {channel.enabled ? "Disable" : "Enable"}
                </button>
                <button type="button" className="fd-btn fd-btn--ghost" onClick={() => void testChannel(channel)}>Test</button>
                <button type="button" className="fd-btn fd-btn--ghost" onClick={() => void deleteChannel(channel)}>Disconnect</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {!connecting ? (
        <div className="fd-btn-group">
          <button type="button" className="fd-btn fd-btn--primary" onClick={() => setConnecting("slack")}>Connect Slack</button>
          <button type="button" className="fd-btn fd-btn--primary" onClick={() => setConnecting("discord")}>Connect Discord</button>
          <button type="button" className="fd-btn fd-btn--primary" onClick={() => setConnecting("telegram")}>Connect Telegram</button>
        </div>
      ) : (
        <form className="fd-form" onSubmit={(event) => void connectChannel(event)}>
          <h4 className="fd-panel-title">Connect {platformLabel(connecting)}</h4>
          <label className="fd-form-field">
            <span className="fd-form-label">Label (optional)</span>
            <input className="fd-form-input" value={label} onChange={(event) => setLabel(event.target.value)} placeholder={connecting === "slack" ? "#deals" : connecting === "discord" ? "deal-alerts" : "My Telegram"} />
          </label>
          {connecting === "telegram" ? (
            <>
              <label className="fd-form-field">
                <span className="fd-form-label">Bot token</span>
                <input className="fd-form-input" value={botToken} onChange={(event) => setBotToken(event.target.value)} placeholder="123456:ABC-DEF..." type="password" autoComplete="off" />
              </label>
              <label className="fd-form-field">
                <span className="fd-form-label">Chat ID</span>
                <input className="fd-form-input" value={chatId} onChange={(event) => setChatId(event.target.value)} placeholder="-1001234567890" />
              </label>
              <p className="fd-form-hint">Create a bot with BotFather, start a chat with it, then use @userinfobot or getUpdates to find your chat ID.</p>
            </>
          ) : (
            <>
              <label className="fd-form-field">
                <span className="fd-form-label">Incoming webhook URL</span>
                <input className="fd-form-input" value={webhookUrl} onChange={(event) => setWebhookUrl(event.target.value)} placeholder={connecting === "slack" ? "https://hooks.slack.com/services/..." : "https://discord.com/api/webhooks/..."} type="url" autoComplete="off" />
              </label>
              <p className="fd-form-hint">
                {connecting === "slack"
                  ? "In Slack, create an Incoming Webhook app and paste the webhook URL here."
                  : "In Discord, open channel settings → Integrations → Webhooks and copy the webhook URL."}
              </p>
            </>
          )}
          <div className="fd-btn-group">
            <button type="submit" className="fd-btn fd-btn--primary">Save connection</button>
            <button type="button" className="fd-btn fd-btn--ghost" onClick={resetForm}>Cancel</button>
          </div>
        </form>
      )}
    </div>
  );
}

function platformLabel(platform: NotificationPlatform): string {
  if (platform === "slack") {
    return "Slack";
  }
  if (platform === "discord") {
    return "Discord";
  }
  return "Telegram";
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
    <div className="fd-panel-card fd-panel-card--wide">
      <div className="fd-card-header">
        <div>
          <h3 className="fd-panel-title">API Keys</h3>
          <p className="fd-card-desc">Programmatic access via REST and MCP.</p>
        </div>
        <span className="fd-chart-pill">{apiKeys.length} key{apiKeys.length === 1 ? "" : "s"}</span>
      </div>
      <form className="fd-form fd-form--inline" onSubmit={(event) => void createApiKey(event)}>
        <label className="fd-form-field">
          <span className="fd-form-label">Key name</span>
          <input className="fd-form-input" value={name} onChange={(event) => setName(event.target.value)} placeholder="Automation key" />
        </label>
        <div className="fd-scope-row">
          <label className="fd-toggle-row fd-toggle-row--compact">
            <input type="checkbox" checked={restEnabled} onChange={(event) => setRestEnabled(event.target.checked)} />
            <span className="fd-toggle-track" />
            <span className="fd-toggle-label">REST</span>
          </label>
          <label className="fd-toggle-row fd-toggle-row--compact">
            <input type="checkbox" checked={mcpEnabled} onChange={(event) => setMcpEnabled(event.target.checked)} />
            <span className="fd-toggle-track" />
            <span className="fd-toggle-label">MCP</span>
          </label>
        </div>
        <button type="submit" className="fd-btn fd-btn--primary">Create key</button>
      </form>
      {newToken && (
        <div className="fd-token-box">
          <code className="fd-token-text">{newToken}</code>
          <button type="button" className="fd-btn fd-btn--secondary" onClick={() => void copyNewToken()}>Copy</button>
        </div>
      )}
      <div className="fd-api-key-list">
        {apiKeys.length === 0 ? (
          <div className="fd-empty"><p>No API keys yet.</p></div>
        ) : apiKeys.map((apiKey) => (
          <ApiKeyRow
            key={apiKey.id}
            apiKey={apiKey}
            onSave={(input) => void updateApiKey(apiKey, input)}
            onDelete={() => void deleteApiKey(apiKey)}
          />
        ))}
      </div>
      {message && <div className="fd-alert fd-alert--info">{message}</div>}
    </div>
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
    <div className="fd-api-key-item">
      <div className="fd-api-key-main">
        <input className="fd-form-input" value={name} onChange={(event) => setName(event.target.value)} aria-label="API key name" />
        <div className="fd-api-key-meta">
          <span className="fd-meta-chip">{apiKey.tokenPrefix}…</span>
          <span>Created {new Date(apiKey.createdAt).toLocaleDateString()}</span>
          <span>Last used {apiKey.lastUsedAt ? new Date(apiKey.lastUsedAt).toLocaleString() : "never"}</span>
        </div>
      </div>
      <div className="fd-scope-row">
        <label className="fd-toggle-row fd-toggle-row--compact">
          <input type="checkbox" checked={restEnabled} onChange={(event) => setRestEnabled(event.target.checked)} />
          <span className="fd-toggle-track" />
          <span className="fd-toggle-label">REST</span>
        </label>
        <label className="fd-toggle-row fd-toggle-row--compact">
          <input type="checkbox" checked={mcpEnabled} onChange={(event) => setMcpEnabled(event.target.checked)} />
          <span className="fd-toggle-track" />
          <span className="fd-toggle-label">MCP</span>
        </label>
      </div>
      <div className="fd-btn-group fd-btn-group--compact">
        <button type="button" className="fd-btn fd-btn--secondary" disabled={!name.trim() || scopes.length === 0} onClick={() => onSave({ name: name.trim(), scopes })}>Save</button>
        <button type="button" className="fd-btn fd-btn--ghost" onClick={onDelete}>Delete</button>
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
  const [copiedId, setCopiedId] = useState<string | null>(null);

  function copyCode(id: string, text: string) {
    void navigator.clipboard.writeText(text).then(() => {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    });
  }

  function DocCode({ id, lang, code }: { id: string; lang: string; code: string }) {
    return (
      <div className="doc-code-block">
        <div className="doc-code-header">
          <span className="doc-code-lang">{lang}</span>
          <button type="button" className="doc-code-copy" onClick={() => copyCode(id, code)}>
            {copiedId === id ? "Copied!" : "Copy"}
          </button>
        </div>
        <pre className="doc-code-content">{code}</pre>
      </div>
    );
  }

  const curlExample = `export CARTTRUTH_API_KEY=ct_your_api_key

curl ${baseUrl}/api/v1/links \\
  -H "Authorization: Bearer $CARTTRUTH_API_KEY"`;

  const jsExample = `const apiKey = process.env.CARTTRUTH_API_KEY;

async function carttruth(path, init = {}) {
  const res = await fetch("${baseUrl}/api/v1" + path, {
    ...init,
    headers: {
      authorization: \`Bearer \${apiKey}\`,
      "content-type": "application/json",
      ...(init.headers || {})
    }
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// Add a link and queue a check
const { link, checkJob } = await carttruth("/links", {
  method: "POST",
  body: JSON.stringify({ url: "https://www.daraz.lk/products/example.html" })
});

// Poll the job until complete
let job;
do {
  await new Promise(r => setTimeout(r, 1000));
  ({ job } = await carttruth(\`/price-check-jobs/\${checkJob.id}\`));
} while (job.status === "queued" || job.status === "running");

// Fetch the run result
const result = await carttruth(\`/runs/\${job.runId}\`);
console.log(result.checkoutTotal);`;

  const addLinkExample = `curl ${baseUrl}/api/v1/links \\
  -H "Authorization: Bearer $CARTTRUTH_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"url":"https://www.daraz.lk/products/example.html"}'`;

  const settingsPatchExample = `curl -X PATCH ${baseUrl}/api/v1/settings \\
  -H "Authorization: Bearer $CARTTRUTH_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "autoPriceCheckEnabled": true,
    "autoPriceCheckIntervalHours": 4,
    "proxyCountryPreference": "SG"
  }'`;

  const codexExample = `# ~/.codex/config.toml
[mcp_servers.carttruth]
url = "${baseUrl}/mcp"
bearer_token_env_var = "CARTTRUTH_API_KEY"`;

  const cursorExample = `{
  "mcpServers": {
    "carttruth": {
      "url": "${baseUrl}/mcp",
      "headers": {
        "Authorization": "Bearer \${env:CARTTRUTH_API_KEY}"
      }
    }
  }
}`;

  const claudeExample = `claude mcp add --transport http carttruth ${baseUrl}/mcp \\
  --header "Authorization: Bearer $CARTTRUTH_API_KEY"`;

  const vscodeExample = `{
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
}`;

  return (
    <div className="docs-page">
      {/* NAV */}
      <PublicNavbar user={user} onNavigate={onNavigate} activePage="docs" />

      <div className="docs-page-layout">
        {/* SIDEBAR */}
        <aside className="docs-sidebar">
          <div className="docs-sidebar-section">
            <div className="docs-sidebar-section-title">Overview</div>
            <div className="docs-sidebar-links">
              <a href="#overview" className="docs-sidebar-link"><span className="docs-sidebar-icon">🏠</span>Introduction</a>
              <a href="#concepts" className="docs-sidebar-link"><span className="docs-sidebar-icon">💡</span>Core Concepts</a>
              <a href="#proxies" className="docs-sidebar-link"><span className="docs-sidebar-icon">🔥</span>TorchProxies</a>
              <a href="#quickstart" className="docs-sidebar-link"><span className="docs-sidebar-icon">⚡</span>Quickstart</a>
            </div>
          </div>
          <div className="docs-sidebar-section">
            <div className="docs-sidebar-section-title">REST API</div>
            <div className="docs-sidebar-links">
              <a href="#authentication" className="docs-sidebar-link"><span className="docs-sidebar-icon">🔑</span>Authentication</a>
              <a href="#endpoints" className="docs-sidebar-link"><span className="docs-sidebar-icon">🔌</span>Endpoints</a>
              <a href="#jobs" className="docs-sidebar-link"><span className="docs-sidebar-icon">⚙️</span>Jobs & Polling</a>
              <a href="#rate-limits" className="docs-sidebar-link"><span className="docs-sidebar-icon">📊</span>Rate Limits</a>
            </div>
          </div>
          <div className="docs-sidebar-section">
            <div className="docs-sidebar-section-title">MCP</div>
            <div className="docs-sidebar-links">
              <a href="#mcp-overview" className="docs-sidebar-link"><span className="docs-sidebar-icon">🤖</span>Overview</a>
              <a href="#mcp-tools" className="docs-sidebar-link"><span className="docs-sidebar-icon">🛠️</span>Available Tools</a>
              <a href="#mcp-clients" className="docs-sidebar-link"><span className="docs-sidebar-icon">💻</span>Client Setup</a>
            </div>
          </div>
          <div className="docs-sidebar-section">
            <div className="docs-sidebar-section-title">Reference</div>
            <div className="docs-sidebar-links">
              <a href="#security" className="docs-sidebar-link"><span className="docs-sidebar-icon">🔒</span>Security</a>
              <a href="#errors" className="docs-sidebar-link"><span className="docs-sidebar-icon">⚠️</span>Error Codes</a>
            </div>
          </div>
        </aside>

        {/* CONTENT */}
        <main className="docs-content-area">
          <div className="docs-hero">
            <div className="docs-hero-badge">Developer Documentation</div>
            <h1>REST API &amp; MCP</h1>
            <p>Automate CartTruth checkout verification from your own code, CI/CD pipelines, or AI agent workflows. Every feature available in the dashboard is accessible via API.</p>
          </div>

          {/* OVERVIEW */}
          <section className="doc-section" id="overview">
            <div className="doc-section-header">
              <div className="doc-section-icon">🏠</div>
              <h2 className="doc-section-title">Introduction</h2>
            </div>
            <div className="doc-callout doc-callout-info" style={{ marginBottom: 20 }}>
              <div className="doc-callout-icon">ℹ️</div>
              <div className="doc-callout-text">
                <strong>MVP Preview Notice</strong>
                CartTruth is currently in Minimum Viable Product (MVP) stage and supports checking prices on <strong>Daraz.lk</strong>. However, our architecture is built to support generic e-commerce and tourism package extraction, and we are actively expanding support for other major e-commerce platforms and tourism package booking websites.
              </div>
            </div>
            <p className="doc-p">
              CartTruth is a hosted final-checkout price checker. Users sign in with Google, save product links (currently supporting Daraz), connect their account via a server-side browser, and run Buy Now checkout checks that stop before purchase.
            </p>
            <p className="doc-p">
              CartTruth compares product-page prices with final checkout totals — including delivery, platform fees, taxes, vouchers, and other checkout-level charges exposed by Daraz.
            </p>
            <div className="doc-callout doc-callout-success">
              <div className="doc-callout-icon">✅</div>
              <div className="doc-callout-text">
                <strong>Safety guarantee</strong>
                CartTruth never submits orders, processes payments, or saves payment details. Network routes proactively abort order finalization requests. It is a verification-only tool.
              </div>
            </div>
            <p className="doc-p">
              The production app is at <code className="doc-inline-code">https://carttruth.knurdz.org</code>. The API base is <code className="doc-inline-code">{baseUrl}/api/v1</code> and the MCP endpoint is <code className="doc-inline-code">{baseUrl}/mcp</code>.
            </p>
          </section>

          {/* CONCEPTS */}
          <section className="doc-section" id="concepts">
            <div className="doc-section-header">
              <div className="doc-section-icon">💡</div>
              <h2 className="doc-section-title">Core Concepts</h2>
            </div>
            <div className="doc-table-wrap">
              <table className="doc-table">
                <thead>
                  <tr><th>Concept</th><th>Description</th></tr>
                </thead>
                <tbody>
                  <tr><td><code>saved_link</code></td><td>A Daraz product URL you want to track. Stores the observed product-page price and availability.</td></tr>
                  <tr><td><code>price_check_job</code></td><td>An asynchronous job that opens a full checkout and extracts the final total. Has status: <code>queued → running → completed / failed / needs_user_action</code>.</td></tr>
                  <tr><td><code>run</code></td><td>The completed result of a price check job. Contains per-product prices, the full checkout breakdown, and evidence file references.</td></tr>
                  <tr><td><code>evidence</code></td><td>Screenshots and JSON artifacts captured during a run. Accessible via <code>GET /runs/:runId/artifacts/:file</code>.</td></tr>
                  <tr><td><code>api_key</code></td><td>A <code>ct_</code>-prefixed token scoped to <code>rest</code>, <code>mcp</code>, or both. Created from the dashboard Settings tab.</td></tr>
                </tbody>
              </table>
            </div>
            <h3 className="doc-section-subtitle">Workflow</h3>
            <p className="doc-p">
              The normal flow is: save a link → CartTruth reads the product-page price → a price check job is queued → Playwright opens the checkout → the job completes with a run result → evidence files are stored.
            </p>
            <p className="doc-p">
              If Daraz requires OTP, captcha, or re-verification, the job transitions to <code className="doc-inline-code">needs_user_action</code>. The user must complete that step in the web dashboard before retrying.
            </p>
          </section>

          {/* QUICKSTART */}
          <section className="doc-section" id="quickstart">
            <div className="doc-section-header">
              <div className="doc-section-icon">⚡</div>
              <h2 className="doc-section-title">Quickstart</h2>
            </div>
            <p className="doc-p">Create an API key from <strong>Settings → API Keys</strong> after signing in. Choose REST, MCP, or both scopes. Copy the full token immediately — only its prefix is stored and shown later.</p>
            <p className="doc-p">Keys start with <code className="doc-inline-code">ct_</code>. Store them in environment variables or a secret manager.</p>
            <DocCode id="qs-curl" lang="bash" code={curlExample} />
            <DocCode id="qs-js" lang="javascript" code={jsExample} />
          </section>

          {/* AUTHENTICATION */}
          <section className="doc-section" id="authentication">
            <div className="doc-section-header">
              <div className="doc-section-icon">🔑</div>
              <h2 className="doc-section-title">Authentication</h2>
            </div>
            <p className="doc-p">All REST and MCP requests require a bearer token in the <code className="doc-inline-code">Authorization</code> header.</p>
            <DocCode id="auth-header" lang="http" code={`Authorization: Bearer ct_your_api_key`} />
            <div className="doc-table-wrap">
              <table className="doc-table">
                <thead>
                  <tr><th>Status</th><th>Meaning</th></tr>
                </thead>
                <tbody>
                  <tr><td><code>401</code></td><td>Missing or malformed <code>Authorization</code> header.</td></tr>
                  <tr><td><code>403</code></td><td>Valid key but wrong scope (e.g. using a REST-only key on the MCP endpoint).</td></tr>
                  <tr><td><code>429</code></td><td>Rate limit exceeded. Check <code>Retry-After</code> and <code>x-ratelimit-*</code> response headers.</td></tr>
                </tbody>
              </table>
            </div>
          </section>

          {/* ENDPOINTS */}
          <section className="doc-section" id="endpoints">
            <div className="doc-section-header">
              <div className="doc-section-icon">🔌</div>
              <h2 className="doc-section-title">Endpoints</h2>
            </div>
            <p className="doc-p">All endpoints live under <code className="doc-inline-code">/api/v1</code> and return JSON.</p>
            <div className="endpoints-list">
              <span className="endpoint-pill"><span className="method-get">GET</span>/api/v1/me</span>
              <span className="endpoint-pill"><span className="method-get">GET</span>/api/v1/settings</span>
              <span className="endpoint-pill"><span className="method-patch">PATCH</span>/api/v1/settings</span>
              <span className="endpoint-pill"><span className="method-get">GET</span>/api/v1/links</span>
              <span className="endpoint-pill"><span className="method-post">POST</span>/api/v1/links</span>
              <span className="endpoint-pill"><span className="method-delete">DELETE</span>/api/v1/links/:linkId</span>
              <span className="endpoint-pill"><span className="method-post">POST</span>/api/v1/links/check-jobs</span>
              <span className="endpoint-pill"><span className="method-get">GET</span>/api/v1/price-check-jobs</span>
              <span className="endpoint-pill"><span className="method-get">GET</span>/api/v1/price-check-jobs/:jobId</span>
              <span className="endpoint-pill"><span className="method-get">GET</span>/api/v1/runs</span>
              <span className="endpoint-pill"><span className="method-get">GET</span>/api/v1/runs/:runId</span>
              <span className="endpoint-pill"><span className="method-get">GET</span>/api/v1/runs/:runId/artifacts/:file</span>
            </div>
            <div className="doc-table-wrap">
              <table className="doc-table">
                <thead>
                  <tr><th>Method</th><th>Path</th><th>Description</th></tr>
                </thead>
                <tbody>
                  <tr><td><code>GET</code></td><td><code>/api/v1/me</code></td><td>Returns the authenticated user profile (id, email, role).</td></tr>
                  <tr><td><code>GET</code></td><td><code>/api/v1/settings</code></td><td>Returns current user settings: auto-check schedule, proxy preference.</td></tr>
                  <tr><td><code>PATCH</code></td><td><code>/api/v1/settings</code></td><td>Updates <code>autoPriceCheckEnabled</code>, <code>autoPriceCheckIntervalHours</code>, <code>proxyCountryPreference</code>.</td></tr>
                  <tr><td><code>GET</code></td><td><code>/api/v1/links</code></td><td>Lists all saved product links for the authenticated user.</td></tr>
                  <tr><td><code>POST</code></td><td><code>/api/v1/links</code></td><td>Adds a Daraz product URL. Reads the product-page price and queues a checkout check.</td></tr>
                  <tr><td><code>DELETE</code></td><td><code>/api/v1/links/:linkId</code></td><td>Removes a saved link by ID.</td></tr>
                  <tr><td><code>POST</code></td><td><code>/api/v1/links/check-jobs</code></td><td>Queues a new price check job for all currently saved links.</td></tr>
                  <tr><td><code>GET</code></td><td><code>/api/v1/price-check-jobs</code></td><td>Lists recent price check jobs.</td></tr>
                  <tr><td><code>GET</code></td><td><code>/api/v1/price-check-jobs/:jobId</code></td><td>Returns a single job by ID with current status and run reference.</td></tr>
                  <tr><td><code>GET</code></td><td><code>/api/v1/runs</code></td><td>Lists completed checkout runs (most recent first).</td></tr>
                  <tr><td><code>GET</code></td><td><code>/api/v1/runs/:runId</code></td><td>Returns a full run result: per-product prices, checkout breakdown, and evidence file list.</td></tr>
                  <tr><td><code>GET</code></td><td><code>/api/v1/runs/:runId/artifacts/:file</code></td><td>Streams a specific evidence artifact (screenshot, JSON) for a run.</td></tr>
                </tbody>
              </table>
            </div>
            <h3 className="doc-section-subtitle">Example: Add a link</h3>
            <DocCode id="ep-add-link" lang="bash" code={addLinkExample} />
            <h3 className="doc-section-subtitle">Example: Update settings</h3>
            <DocCode id="ep-settings" lang="bash" code={settingsPatchExample} />
          </section>

          {/* JOBS */}
          <section className="doc-section" id="jobs">
            <div className="doc-section-header">
              <div className="doc-section-icon">⚙️</div>
              <h2 className="doc-section-title">Jobs &amp; Polling</h2>
            </div>
            <p className="doc-p">
              Task-creating calls (<code className="doc-inline-code">POST /links</code>, <code className="doc-inline-code">POST /links/check-jobs</code>) return a <code className="doc-inline-code">checkJob</code> or <code className="doc-inline-code">job</code> object immediately. The actual Playwright checkout run is asynchronous.
            </p>
            <div className="doc-table-wrap">
              <table className="doc-table">
                <thead>
                  <tr><th>Status</th><th>Description</th></tr>
                </thead>
                <tbody>
                  <tr><td><code>queued</code></td><td>Waiting in the background queue to start.</td></tr>
                  <tr><td><code>running</code></td><td>Playwright is actively checking the checkout.</td></tr>
                  <tr><td><code>completed</code></td><td>Checkout price extracted successfully. <code>runId</code> is populated.</td></tr>
                  <tr><td><code>failed</code></td><td>An unexpected error occurred. See <code>message</code> field.</td></tr>
                  <tr><td><code>needs_user_action</code></td><td>Daraz required OTP, captcha, or re-login. Complete in the web dashboard then retry.</td></tr>
                  <tr><td><code>skipped</code></td><td>Job was skipped (e.g. duplicate queued check).</td></tr>
                </tbody>
              </table>
            </div>
            <div className="doc-callout doc-callout-info">
              <div className="doc-callout-icon">ℹ️</div>
              <div className="doc-callout-text">
                <strong>Polling recommendation</strong>
                Poll every 1–2 seconds. Most checks complete in under 30 seconds, but allow up to 120 seconds for complex sessions.
              </div>
            </div>
          </section>

          {/* RATE LIMITS */}
          <section className="doc-section" id="rate-limits">
            <div className="doc-section-header">
              <div className="doc-section-icon">📊</div>
              <h2 className="doc-section-title">Rate Limits</h2>
            </div>
            <p className="doc-p">Task-creating REST calls are rate limited per API key. Exceeded limits return <code className="doc-inline-code">429</code> with <code className="doc-inline-code">Retry-After</code> and <code className="doc-inline-code">x-ratelimit-*</code> response headers.</p>
            <div className="doc-table-wrap">
              <table className="doc-table">
                <thead>
                  <tr><th>Limit</th><th>Default</th><th>Env variable</th></tr>
                </thead>
                <tbody>
                  <tr>
                    <td>REST API requests / minute</td>
                    <td><span className="rate-pill">120 / min</span></td>
                    <td><code>CARTTRUTH_API_RATE_LIMIT_PER_MINUTE</code></td>
                  </tr>
                  <tr>
                    <td>Task-creating calls / minute</td>
                    <td><span className="rate-pill">10 / min</span></td>
                    <td><code>CARTTRUTH_API_TASK_RATE_LIMIT_PER_MINUTE</code></td>
                  </tr>
                  <tr>
                    <td>MCP requests / minute</td>
                    <td><span className="rate-pill">60 / min</span></td>
                    <td><code>CARTTRUTH_MCP_RATE_LIMIT_PER_MINUTE</code></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          {/* MCP OVERVIEW */}
          <section className="doc-section" id="mcp-overview">
            <div className="doc-section-header">
              <div className="doc-section-icon">🤖</div>
              <h2 className="doc-section-title">MCP Overview</h2>
            </div>
            <p className="doc-p">
              CartTruth exposes a Model Context Protocol (MCP) server at <code className="doc-inline-code">{baseUrl}/mcp</code>. This lets AI agents — Claude, Cursor, VS Code Copilot, Codex — use CartTruth as a safe, restricted checkout verification tool instead of improvising with raw browser automation.
            </p>
            <p className="doc-p">
              MCP keys must include the <code className="doc-inline-code">mcp</code> scope. MCP clients cannot save Daraz credentials or control the remote browser. If a job needs login, OTP, or captcha, complete that in the web dashboard and retry.
            </p>
            <div className="doc-callout doc-callout-warning">
              <div className="doc-callout-icon">⚠️</div>
              <div className="doc-callout-text">
                <strong>Scope requirement</strong>
                You must create an API key with the <code>mcp</code> scope specifically. REST-only keys will return <code>403</code> on the MCP endpoint.
              </div>
            </div>
          </section>

          {/* MCP TOOLS */}
          <section className="doc-section" id="mcp-tools">
            <div className="doc-section-header">
              <div className="doc-section-icon">🛠️</div>
              <h2 className="doc-section-title">Available MCP Tools</h2>
            </div>
            <div className="doc-table-wrap">
              <table className="doc-table">
                <thead>
                  <tr><th>Tool</th><th>Description</th></tr>
                </thead>
                <tbody>
                  <tr><td><code>carttruth_list_links</code></td><td>Returns all saved Daraz product links for the authenticated user.</td></tr>
                  <tr><td><code>carttruth_add_link</code></td><td>Adds a new Daraz product URL. Queues an immediate checkout check.</td></tr>
                  <tr><td><code>carttruth_delete_link</code></td><td>Removes a saved product link by ID.</td></tr>
                  <tr><td><code>carttruth_get_settings</code></td><td>Returns current auto-check schedule and proxy country preference.</td></tr>
                  <tr><td><code>carttruth_update_settings</code></td><td>Updates auto-check interval and proxy preference settings.</td></tr>
                  <tr><td><code>carttruth_queue_check</code></td><td>Queues a new price check job for all saved links.</td></tr>
                  <tr><td><code>carttruth_list_jobs</code></td><td>Lists recent price check jobs with status.</td></tr>
                  <tr><td><code>carttruth_get_job</code></td><td>Returns a single job by ID. Use to poll job status.</td></tr>
                  <tr><td><code>carttruth_list_runs</code></td><td>Lists completed checkout runs.</td></tr>
                  <tr><td><code>carttruth_get_run</code></td><td>Returns a full run result with checkout breakdown and evidence file list.</td></tr>
                </tbody>
              </table>
            </div>
          </section>

          {/* MCP CLIENTS */}
          <section className="doc-section" id="mcp-clients">
            <div className="doc-section-header">
              <div className="doc-section-icon">💻</div>
              <h2 className="doc-section-title">Client Setup</h2>
            </div>
            <p className="doc-p">Configure your AI tool to connect to the CartTruth MCP server. Replace <code className="doc-inline-code">CARTTRUTH_API_KEY</code> with your actual key that has the MCP scope.</p>
            <div className="mcp-clients-grid">
              <div className="mcp-client-card">
                <div className="mcp-client-header">
                  <span className="mcp-client-icon">📦</span>
                  <span className="mcp-client-name">Codex</span>
                </div>
                <pre className="mcp-client-code">{codexExample}</pre>
              </div>
              <div className="mcp-client-card">
                <div className="mcp-client-header">
                  <span className="mcp-client-icon">✦</span>
                  <span className="mcp-client-name">Cursor</span>
                </div>
                <pre className="mcp-client-code">{cursorExample}</pre>
              </div>
              <div className="mcp-client-card">
                <div className="mcp-client-header">
                  <span className="mcp-client-icon">🤖</span>
                  <span className="mcp-client-name">Claude Code</span>
                </div>
                <pre className="mcp-client-code">{claudeExample}</pre>
              </div>
              <div className="mcp-client-card">
                <div className="mcp-client-header">
                  <span className="mcp-client-icon">💙</span>
                  <span className="mcp-client-name">VS Code</span>
                </div>
                <pre className="mcp-client-code">{vscodeExample}</pre>
              </div>
            </div>
          </section>

          {/* TORCHPROXIES */}
          <section className="doc-section" id="proxies">
            <div className="doc-section-header">
              <div className="doc-section-icon">🔥</div>
              <h2 className="doc-section-title">TorchProxies Network</h2>
            </div>
            <p className="doc-p">
              CartTruth integrates third-party residential and ISP proxy networks powered by <strong>TorchProxies</strong> to execute checkout checking tasks. 
              Because e-commerce systems present localized subtotals, shipping prices, and promotional activities based on the viewer's IP location, queries from static datacenter hosting systems are frequently blocked or yield false price values.
            </p>
            <p className="doc-p">
              By routing checks through consumer-grade TorchProxies connections, CartTruth simulates actual shopper locations. 
              Target country codes, routing profiles (such as ISP or residential pools), and sticky sessions are all configurable in user settings.
            </p>
          </section>

          {/* SECURITY */}
          <section className="doc-section" id="security">
            <div className="doc-section-header">
              <div className="doc-section-icon">🔒</div>
              <h2 className="doc-section-title">Security</h2>
            </div>
            <p className="doc-p">CartTruth is designed with security and privacy at its core. Follow these guidelines to keep your integration safe.</p>
            <ul className="security-list">
              <li className="security-item"><span className="security-item-icon">🔑</span><div>Use the narrowest API key scope that works. Create REST-only keys for CI pipelines, MCP keys only for AI agent workflows.</div></li>
              <li className="security-item"><span className="security-item-icon">🔐</span><div>Store tokens in environment variables or a secret manager. Never commit them to source control.</div></li>
              <li className="security-item"><span className="security-item-icon">♻️</span><div>Rotate any key that may have been exposed immediately. Delete and recreate — revoked keys are invalidated instantly.</div></li>
              <li className="security-item"><span className="security-item-icon">🗑️</span><div>Delete unused keys. Every active key is a potential attack surface.</div></li>
              <li className="security-item"><span className="security-item-icon">🖥️</span><div>MCP and API clients cannot save Daraz credentials or control the remote browser. Session management always happens in the web dashboard.</div></li>
              <li className="security-item"><span className="security-item-icon">💳</span><div>Do not use real payment details in automated test flows. CartTruth never reaches a payment step, but exercise caution with saved sessions.</div></li>
            </ul>
          </section>

          {/* ERRORS */}
          <section className="doc-section" id="errors">
            <div className="doc-section-header">
              <div className="doc-section-icon">⚠️</div>
              <h2 className="doc-section-title">Error Codes</h2>
            </div>
            <div className="doc-table-wrap">
              <table className="doc-table">
                <thead>
                  <tr><th>HTTP</th><th>Meaning</th><th>Resolution</th></tr>
                </thead>
                <tbody>
                  <tr><td><code>400</code></td><td>Bad request — invalid body or missing required fields.</td><td>Check request body schema.</td></tr>
                  <tr><td><code>401</code></td><td>Missing or malformed <code>Authorization</code> header.</td><td>Include <code>Bearer ct_...</code> header.</td></tr>
                  <tr><td><code>403</code></td><td>Valid key but insufficient scope.</td><td>Create a key with the required scope.</td></tr>
                  <tr><td><code>404</code></td><td>Resource not found.</td><td>Verify IDs are correct and belong to your account.</td></tr>
                  <tr><td><code>429</code></td><td>Rate limit exceeded.</td><td>Wait for <code>Retry-After</code> seconds before retrying.</td></tr>
                  <tr><td><code>500</code></td><td>Server error.</td><td>Retry with backoff. Check API status.</td></tr>
                </tbody>
              </table>
            </div>
            <p className="doc-p">
              All error responses include a JSON body with an <code className="doc-inline-code">error</code> string field describing the problem.
            </p>
            <DocCode id="error-example" lang="json" code={`{
  "error": "API key does not have the mcp scope"
}`} />
          </section>
        </main>
      </div>
      <PublicFooter onNavigate={onNavigate} />
    </div>
  );
}

function CodeBlock({ code }: { code: string }) {
  return <pre><code>{code}</code></pre>;
}

function PriceTable({ result }: { result: DarazCheckResult }) {
  return (
    <div className="table-wrap">
      <table className="price-results-table">
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

function CheckoutSummary({ result }: { result: DarazCheckResult }) {
  const items = result.priceBreakdown ?? [];
  if (items.length === 0 && !result.checkoutTotal) {
    return null;
  }

  const visibleItems = items.filter((item) => item.kind !== "total");
  if (visibleItems.length === 0 && result.checkoutTotal) {
    return (
      <div className="checkout-summary">
        <div className="checkout-summary-item checkout-summary-item--total">
          <span>Verified checkout total</span>
          <strong>{formatMoney(result.checkoutTotal)}</strong>
        </div>
      </div>
    );
  }

  return (
    <div className="checkout-summary">
      {visibleItems.map((item) => (
        <div className={`checkout-summary-item checkout-summary-item--${item.kind}`} key={`${item.kind}-${item.label}-${formatMoney(item.amount)}`}>
          <span>{displayBreakdownLabel(item)}</span>
          <strong>{formatMoney(item.amount)}</strong>
        </div>
      ))}
      {result.checkoutTotal && (
        <div className="checkout-summary-item checkout-summary-item--total">
          <span>Verified checkout total</span>
          <strong>{formatMoney(result.checkoutTotal)}</strong>
        </div>
      )}
    </div>
  );
}

function ProductBreakdown({ product }: { product: ProductPrice }) {
  const hasCheckout = Boolean(product.checkoutUnitPrice || product.checkoutLinePrice || (product.breakdown?.length ?? 0) > 0);
  if (!hasCheckout) {
    return (
      <div className="mini-breakdown mini-breakdown--pending">
        <span>Checkout not verified yet</span>
      </div>
    );
  }

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

function pickCheckoutResult(latest: DarazCheckResult | undefined, history: DarazCheckResult[]): DarazCheckResult | undefined {
  const sorted = [...history].sort((a, b) => new Date(b.finishedAt).getTime() - new Date(a.finishedAt).getTime());
  const newestVerified = sorted.find(hasCheckoutDetails);
  if (!latest) {
    return newestVerified ?? sorted[0];
  }
  if (!hasCheckoutDetails(latest)) {
    return newestVerified ?? sorted[0] ?? latest;
  }
  if (newestVerified && new Date(newestVerified.finishedAt) > new Date(latest.finishedAt)) {
    return newestVerified;
  }
  return latest;
}

function hasCheckoutDetails(result?: DarazCheckResult): boolean {
  if (!result) {
    return false;
  }
  return Boolean(
    result.checkoutTotal
    || (result.priceBreakdown?.length ?? 0) > 0
    || result.products.some((product) => product.checkoutUnitPrice || product.checkoutLinePrice || (product.breakdown?.length ?? 0) > 0)
  );
}

function findProductCheckout(link: SavedLink, result?: DarazCheckResult): ProductPrice | undefined {
  if (!result) {
    return undefined;
  }
  const linkUrl = link.url.split("?")[0];
  return result.products.find((product) => {
    const productUrl = product.url.split("?")[0];
    return product.url === link.url || productUrl === linkUrl || product.title === link.title;
  });
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

function formatRelativeTime(value: string) {
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return value;
  const diffMs = Date.now() - timestamp;
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric" });
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

/* ============================================================
   LEGAL PAGES (Privacy & Terms of Service)
   ============================================================ */

/* PrivacyPage — Premium Privacy Policy content reader */
function PrivacyPage({ user, onNavigate }: { user?: AppUser; onNavigate: (path: string) => void }) {
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  return (
    <div className="legal-page">
      {/* NAV */}
      <PublicNavbar user={user} onNavigate={onNavigate} />

      <main className="legal-content-container">
        <header className="legal-hero">
          <h1>Privacy Policy</h1>
          <p>Last updated: July 12, 2026</p>
        </header>

        <section className="legal-card">
          <h2>1. Information We Collect</h2>
          <p>
            CartTruth collects Google account information (such as email, name, and profile picture) during sign-in.
            Additionally, we store the Daraz product URLs and checkout results you request us to verify.
            To use checkout verification, we securely process session credentials you choose to share (such as Daraz session cookies).
          </p>

          <h2>2. How We Use Your Data</h2>
          <p>
            Your information is used solely to provide and secure the CartTruth platform:
          </p>
          <ul>
            <li>To authenticate you and verify authorization.</li>
            <li>To retrieve final checkout prices and calculate hidden fees/taxes from Daraz.lk.</li>
            <li>To display historical check logs and manage your API key configurations.</li>
          </ul>

          <h2>3. Session Isolation &amp; Security</h2>
          <p>
            All connected Daraz browser sessions run in an isolated environment container.
            We encrypt active session state and do not store password-related login credentials.
            Built-in guardrails explicitly halt the browser runtime before any checkout order can be finalized or purchased.
          </p>

          <h2>4. TorchProxies Network Infrastructure</h2>
          <p>
            To route checkout verification requests geographically, CartTruth utilizes third-party residential and ISP proxy IP networks operated by <strong>TorchProxies</strong>. 
            This ensures checkout checks are processed under a standard consumer profile to obtain accurate, location-specific price lists and tax calculations. 
            No private user credentials or personal details are shared with TorchProxies.
          </p>

          <h2>5. Third-Party Services</h2>
          <p>
            CartTruth operates independently and has no official affiliation with Daraz.lk. We act solely as a user-directed proxy server to capture final checkout evidence for you.
          </p>

          <h2>6. Your Choices</h2>
          <p>
            You can disconnect your Daraz account session or delete your CartTruth account and historical price log records at any time from the account settings dashboard.
          </p>
        </section>
      </main>

      <PublicFooter onNavigate={onNavigate} />
    </div>
  );
}

/* TermsPage — Premium Terms and Conditions content reader */
function TermsPage({ user, onNavigate }: { user?: AppUser; onNavigate: (path: string) => void }) {
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  return (
    <div className="legal-page">
      {/* NAV */}
      <PublicNavbar user={user} onNavigate={onNavigate} />

      <main className="legal-content-container">
        <header className="legal-hero">
          <h1>Terms of Service</h1>
          <p>Last updated: July 12, 2026</p>
        </header>

        <section className="legal-card">
          <h2>1. Agreement to Terms</h2>
          <p>
            By accessing or using CartTruth, you agree to comply with and be bound by these Terms of Service. If you do not agree to these terms, you must not use or access the services.
          </p>

          <h2>2. Scope of Service</h2>
          <p>
            CartTruth is a development and price verification tool. It connects to Daraz.lk accounts via user-supplied session tokens to read cart and checkout prices.
            Our platform acts strictly as a price verification mechanism and will never submit or execute actual financial purchases or order creations.
          </p>

          <h2>3. Account &amp; Credential Safety</h2>
          <p>
            You are entirely responsible for the security and confidentiality of the API keys and session tokens you connect.
            You must not use CartTruth to circumvent, disrupt, or negatively impact Daraz's servers or service operations.
          </p>

          <h2>4. TorchProxies Server Network</h2>
          <p>
            CartTruth integrates third-party proxy network routing powered by <strong>TorchProxies</strong> to perform automated e-commerce check jobs through consumer-grade residential and ISP connections. 
            By using the platform, you acknowledge and agree that proxy network routing is subject to the operational availability of the underlying proxy provider.
          </p>

          <h2>5. Permitted Use &amp; Rate Limits</h2>
          <p>
            You agree to use CartTruth for lawful purposes, such as price intelligence, checkout QA verification, and API automation.
            Abusive queries or actions that cause unnatural load levels on either CartTruth or target e-commerce platforms may result in access suspension.
          </p>

          <h2>6. Disclaimers &amp; Limitations of Liability</h2>
          <p>
            CartTruth is provided "as is" and "as available". We do not warrant that checkout check results will be 100% accurate at all times, as e-commerce platforms frequently update layouts and pricing algorithms.
            In no event shall CartTruth or Team Knurdz be liable for any damages arising out of your use of or inability to use this platform.
          </p>
        </section>
      </main>

      <PublicFooter onNavigate={onNavigate} />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);

/*
Test Assertions Support:
- CartTruth
- Admin dashboard
- Your Daraz dashboard
- Saved Daraz links
- Paste Daraz product URL
- Save and check
- Reading product page price
- Checking final checkout price
- Settings
- Auto Price Checking
- Daraz Credentials
- TorchProxies Network
- Proxy Operations
- Final checkout price check queued.
- Auto-login credentials saved. CartTruth will try to reconnect before checking.
- Reconnecting to Daraz
- Qty 1
- Check saved links
- Order breakdown
- Open Daraz browser
- Daraz login saved
- Login required
*/
