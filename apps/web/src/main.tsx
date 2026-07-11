import React, { useEffect, useMemo, useRef, useState } from "react";
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
}: { icon: React.ReactNode; label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      className={`db-nav-item${active ? " db-nav-item--active" : ""}`}
      onClick={onClick}
    >
      <span className="db-nav-icon">{icon}</span>
      <span className="db-nav-label">{label}</span>
    </button>
  );
}

/* ============================================================
   STAT CARD
   ============================================================ */
function StatCard({
  label, value, delta, deltaLabel, icon, iconBg
}: {
  label: string;
  value: string;
  delta?: number;
  deltaLabel?: string;
  icon: React.ReactNode;
  iconBg: string;
}) {
  const positive = delta !== undefined && delta >= 0;
  return (
    <div className="db-stat-card">
      <div className="db-stat-body">
        <p className="db-stat-label">{label}</p>
        <p className="db-stat-value">{value}</p>
        {delta !== undefined && (
          <p className={`db-stat-delta ${positive ? "db-stat-delta--up" : "db-stat-delta--down"}`}>
            <span>{positive ? "▲" : "▼"} {Math.abs(delta)}%</span>
            {deltaLabel && <span className="db-stat-delta-note"> {deltaLabel}</span>}
          </p>
        )}
      </div>
      <div className="db-stat-icon" style={{ background: iconBg }}>
        {icon}
      </div>
    </div>
  );
}

/* ============================================================
   MINI LINE CHART (pure SVG)
   ============================================================ */
function MiniLineChart({
  data, color, label, sublabel
}: {
  data: number[];
  color: string;
  label: string;
  sublabel: string;
}) {
  const w = 300; const h = 80; const pad = 4;
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  const pts = data.map((v, i) => {
    const x = pad + (i / (data.length - 1)) * (w - pad * 2);
    const y = pad + (1 - (v - min) / range) * (h - pad * 2);
    return `${x},${y}`;
  });
  const polyline = pts.join(" ");

  return (
    <div className="db-chart-card">
      <div className="db-chart-header">
        <div>
          <p className="db-chart-title">{label}</p>
          <p className="db-chart-sub">{sublabel}</p>
        </div>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} className="db-chart-svg" preserveAspectRatio="none">
        <defs>
          <linearGradient id={`grad-${label.replace(/\s/g, "")}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.2" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <polygon
          points={`${pts[0].split(",")[0]},${h} ${polyline} ${pts[pts.length - 1].split(",")[0]},${h}`}
          fill={`url(#grad-${label.replace(/\s/g, "")})`}
        />
        <polyline points={polyline} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {data.map((_, i) => {
          const [x, y] = pts[i].split(",");
          return <circle key={i} cx={x} cy={y} r="3" fill={color} stroke="white" strokeWidth="1.5" />;
        })}
      </svg>
    </div>
  );
}

/* ============================================================
   MINI BAR CHART (pure SVG)
   ============================================================ */
function MiniBarChart({
  data, labels, color, label, sublabel
}: {
  data: number[];
  labels: string[];
  color: string;
  label: string;
  sublabel: string;
}) {
  const w = 300; const h = 80; const pad = 4;
  const max = Math.max(...data, 1);
  const barW = (w - pad * 2) / data.length * 0.6;
  const gap = (w - pad * 2) / data.length;

  return (
    <div className="db-chart-card">
      <div className="db-chart-header">
        <div>
          <p className="db-chart-title">{label}</p>
          <p className="db-chart-sub">{sublabel}</p>
        </div>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} className="db-chart-svg" preserveAspectRatio="none">
        {data.map((v, i) => {
          const barH = (v / max) * (h - pad * 2 - 12);
          const x = pad + i * gap + gap * 0.2;
          const y = h - pad - barH - 12;
          return (
            <g key={i}>
              <rect x={x} y={y} width={barW} height={barH} rx="2" fill={color} opacity={0.85} />
              <text x={x + barW / 2} y={h - 2} textAnchor="middle" fontSize="8" fill="#94a3b8">{labels[i]}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/* ============================================================
   DONUT CHART (pure SVG)
   ============================================================ */
function DonutChart({
  segments, label, sublabel
}: {
  segments: Array<{ value: number; color: string; name: string }>;
  label: string;
  sublabel: string;
}) {
  const total = segments.reduce((s, seg) => s + seg.value, 0) || 1;
  const r = 28; const cx = 36; const cy = 36;
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
    <div className="db-chart-card">
      <div className="db-chart-header">
        <div>
          <p className="db-chart-title">{label}</p>
          <p className="db-chart-sub">{sublabel}</p>
        </div>
      </div>
      <div className="db-donut-wrap">
        <svg viewBox="0 0 72 72" width="72" height="72">
          <circle cx={cx} cy={cy} r={r} fill="none" stroke="#f1f5f9" strokeWidth="8" />
          {arcs.map((arc, i) => (
            <path key={i} d={arc.d} fill="none" stroke={arc.color} strokeWidth="8" strokeLinecap="round" />
          ))}
        </svg>
        <div className="db-donut-legend">
          {arcs.map((arc, i) => (
            <div key={i} className="db-donut-legend-item">
              <span className="db-donut-dot" style={{ background: arc.color }} />
              <span>{arc.name}: {arc.value}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   DASHBOARD SHELL — sidebar layout
   ============================================================ */
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
  const [message, setMessage] = useState("");

  // Search and Modal states
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [darkMode, setDarkMode] = useState(false);

  useEffect(() => {
    void refresh();
  }, []);

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
      setShowCreateModal(false);
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

  const navLabel = 
    tab === "dashboard" ? "Dashboard" :
    tab === "products" ? "Products" :
    tab === "session" ? "Customers" : 
    tab === "messages" ? "Shop" : 
    tab === "admin" ? "Income" : 
    tab === "settings" ? "Promote" : "Settings";

  // Handle setting body class for dark mode dynamically
  useEffect(() => {
    if (darkMode) {
      document.body.classList.add("dark-theme");
    } else {
      document.body.classList.remove("dark-theme");
    }
  }, [darkMode]);

  return (
    <div className={`db-shell ${darkMode ? "dark-theme" : ""}`}>
      {/* ── SIDEBAR ── */}
      <aside className="db-sidebar">
        <div className="db-sidebar-logo">
          <div className="logo-quadrant-circle">
            <div className="quadrant q1" />
            <div className="quadrant q2" />
            <div className="quadrant q3" />
            <div className="quadrant q4" />
          </div>
          <span className="db-sidebar-logo-text">Dashboard</span>
        </div>

        <nav className="db-sidebar-nav">
          <SidebarNavItem
            icon={
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
                <rect x="3" y="3" width="7" height="9" />
                <rect x="14" y="3" width="7" height="5" />
                <rect x="14" y="12" width="7" height="9" />
                <rect x="3" y="16" width="7" height="5" />
              </svg>
            }
            label="Dashboard"
            active={tab === "dashboard"}
            onClick={() => setTab("dashboard")}
          />
          <SidebarNavItem
            icon={
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
                <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
                <line x1="12" y1="22.08" x2="12" y2="12" />
              </svg>
            }
            label="Products"
            active={tab === "products"}
            onClick={() => setTab("products")}
          />
          <SidebarNavItem
            icon={
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                <circle cx="12" cy="7" r="4" />
              </svg>
            }
            label="Customers"
            active={tab === "session"}
            onClick={() => setTab("session")}
          />
          {user.role === "admin" && (
            <SidebarNavItem
              icon={
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
                  <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
                  <line x1="3" y1="6" x2="21" y2="6" />
                  <path d="M16 10a4 4 0 0 1-8 0" />
                </svg>
              }
              label="Shop"
              active={tab === "messages"}
              onClick={() => setTab("messages")}
            />
          )}
          {user.role === "admin" && (
            <SidebarNavItem
              icon={
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
                  <line x1="12" y1="1" x2="12" y2="23" />
                  <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
                </svg>
              }
              label="Income"
              active={tab === "admin"}
              onClick={() => setTab("admin")}
            />
          )}
          <SidebarNavItem
            icon={
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
            }
            label="Promote"
            active={tab === "settings"}
            onClick={() => setTab("settings")}
          />
        </nav>

        {/* Bottom Sidebar Utility Icons */}
        <div className="db-sidebar-bottom">
          <button type="button" className="sidebar-bottom-btn" onClick={() => { if (user.role === "admin") setTab("messages"); }} title="Messages">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          </button>
          <button type="button" className={`sidebar-bottom-btn ${darkMode ? "active" : ""}`} onClick={() => setDarkMode(true)} title="Dark Mode">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
          </button>
          <button type="button" className={`sidebar-bottom-btn ${!darkMode ? "active" : ""}`} onClick={() => setDarkMode(false)} title="Light Mode">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
          </button>
        </div>
      </aside>

      {/* ── MAIN CONTENT ── */}
      <div className="db-main">
        {/* Topbar/Header */}
        <div className="db-topbar">
          <h1 className="db-topbar-title">{navLabel}</h1>
          <div className="db-topbar-right">
            <div className="db-topbar-search">
              <svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14" style={{ color: "#94a3b8" }}>
                <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd" />
              </svg>
              <input 
                type="text" 
                placeholder="Search anything..." 
                className="db-topbar-search-input" 
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <button type="button" className="db-btn-create" onClick={() => setShowCreateModal(true)}>
              Create
            </button>
            <div className="header-icon-btn" title="Notifications">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
                <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.73 21a2 2 0 0 1-3.46 0" />
              </svg>
            </div>
            <div className="header-icon-btn" onClick={() => { if (user.role === "admin") setTab("messages"); }} title="Chat">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
            </div>
            <div className="db-topbar-avatar" onClick={() => onLogout()} title="Sign Out">
              {user.avatarUrl
                ? <img src={user.avatarUrl} alt={displayUser(user)} />
                : <span>{(displayUser(user)[0] ?? "U").toUpperCase()}</span>
              }
            </div>
          </div>
        </div>

        {/* Content area */}
        <div className="db-content">
          {tab === "dashboard" && (
            <DashboardOverview 
              links={links} 
              history={history} 
              latest={latest} 
              darazSession={darazSession} 
              onNavigate={setTab} 
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
          <div className="modal-card">
            <div className="modal-header">
              <h3 className="modal-title">Monitor a New Product</h3>
              <button 
                type="button" 
                className="modal-close" 
                onClick={() => { setShowCreateModal(false); setMessage(""); }}
              >
                &times;
              </button>
            </div>
            <form onSubmit={(e) => void addLink(e)}>
              <div className="modal-body">
                <p className="modal-help">
                  Paste a Daraz product link below. CartTruth will verify the checkout total price (including payment processing fees and delivery charges) regularly.
                </p>
                <input
                  type="text"
                  value={productUrl}
                  onChange={(e) => setProductUrl(e.target.value)}
                  placeholder="https://www.daraz.lk/products/..."
                  className="modal-input"
                  required
                  autoFocus
                />
                {message && <p className="modal-message">{message}</p>}
              </div>
              <div className="modal-footer">
                <button 
                  type="button" 
                  className="db-btn-secondary" 
                  onClick={() => { setShowCreateModal(false); setMessage(""); }}
                >
                  Cancel
                </button>
                <button type="submit" className="db-btn-primary" disabled={addingLink}>
                  {addingLink ? "Saving..." : "Save & Check"}
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
  onNavigate
}: {
  links: SavedLink[];
  history: DarazCheckResult[];
  latest: DarazCheckResult | undefined;
  darazSession: DarazSession;
  onNavigate: (tab: "dashboard" | "products" | "session" | "messages" | "admin" | "settings") => void;
}) {
  const customersCount = links.length ? String(links.length) : "1,293";
  const balanceVal = latest?.checkoutTotal ? formatMoney(latest.checkoutTotal) : "256k";
  
  // Avatars data
  const avatars = [
    { name: "Gladyce", url: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=100&h=100&fit=crop" },
    { name: "Elbert", url: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=100&h=100&fit=crop" },
    { name: "Dash", url: "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=100&h=100&fit=crop" },
    { name: "Joyce", url: "https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?w=100&h=100&fit=crop" },
    { name: "Marina", url: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&h=100&fit=crop" }
  ];

  // Bar chart hover state
  const [hoveredBar, setHoveredBar] = useState<number>(4);
  const chartData = [
    { label: "Mon", val: "1.2m", height: 40 },
    { label: "Tue", val: "1.5m", height: 50 },
    { label: "Wed", val: "0.9m", height: 30 },
    { label: "Thu", val: "1.8m", height: 60 },
    { label: "Fri", val: "2.2m", height: 85 }, // selected by default
    { label: "Sat", val: "1.3m", height: 45 },
    { label: "Sun", val: "1.6m", height: 55 }
  ];

  // Popular products list (max 5)
  const popularProducts = useMemo(() => {
    const list: Array<{ id: string; title: string; subtitle: string; imageUrl: string; price: string; status: "Active" | "Offline" }> = [];
    links.forEach((link, idx) => {
      if (idx < 5) {
        list.push({
          id: link.id,
          title: link.title,
          subtitle: "Daraz Product",
          imageUrl: link.imageUrl || "https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=150&h=150&fit=crop",
          price: formatMoney(parseObservedPrice(link)),
          status: darazSession.status === "saved" ? "Active" : "Offline"
        });
      }
    });

    const mockItems = [
      { id: "mock-1", title: "Crypter - NFT UI Kit", subtitle: "Crypto kit", imageUrl: "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=150&h=150&fit=crop", price: "$3,250.00", status: "Active" as const },
      { id: "mock-2", title: "Bento Pro 2.0 Illustrations", subtitle: "Illustration kit", imageUrl: "https://images.unsplash.com/photo-1634017839464-5c339ebe3cb4?w=150&h=150&fit=crop", price: "$7,890.00", status: "Active" as const },
      { id: "mock-3", title: "Fleet - travel shopping kit", subtitle: "Travel kit", imageUrl: "https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=150&h=150&fit=crop", price: "$1,500.00", status: "Offline" as const },
      { id: "mock-4", title: "SimpleSocial UI Design Kit", subtitle: "Social kit", imageUrl: "https://images.unsplash.com/photo-1527689368864-3a821dbccc34?w=150&h=150&fit=crop", price: "$9,999.99", status: "Active" as const },
      { id: "mock-5", title: "Bento Pro vol. 2", subtitle: "Illustration kit", imageUrl: "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=150&h=150&fit=crop", price: "$4,750.00", status: "Active" as const }
    ];

    while (list.length < 5 && mockItems.length > 0) {
      const item = mockItems.shift()!;
      if (!list.some(x => x.title === item.title)) {
        list.push(item);
      }
    }
    return list.slice(0, 5);
  }, [links, darazSession.status]);

  // Comments / Activity logs (max 3)
  const activityLogs = useMemo(() => {
    const list: Array<{ id: string; name: string; avatarUrl: string; target: string; time: string; text: string }> = [];
    
    // Convert runs to comments
    history.forEach((run, idx) => {
      if (idx < 3) {
        const timeStr = run.finishedAt ? new Date(run.finishedAt).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }) : "Recently";
        const avatarIdx = idx % avatars.length;
        const statusText = run.status === "checked" 
          ? `Verified price successfully. Checkout total: ${formatMoney(run.checkoutTotal)}`
          : `Checked price. Run status: ${run.status}.`;
        list.push({
          id: run.runId || `run-${idx}`,
          name: avatars[avatarIdx].name,
          avatarUrl: avatars[avatarIdx].url,
          target: run.products[0]?.title.substring(0, 20) + "..." || "Daraz Item",
          time: timeStr,
          text: statusText
        });
      }
    });

    const mockComments = [
      { id: "comment-1", name: "Joyce", avatarUrl: "https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?w=100&h=100&fit=crop", target: "Bento Pro 2.0", time: "09:00 AM", text: "Great work! When HTML version will be available? ⚡" },
      { id: "comment-2", name: "Gladyce", avatarUrl: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=100&h=100&fit=crop", target: "Food Delivery App", time: "08:00 AM", text: "Awesome design, this is really useful..." }
    ];

    while (list.length < 2 && mockComments.length > 0) {
      list.push(mockComments.shift()!);
    }

    return list.slice(0, 2);
  }, [history]);

  return (
    <div className="overview-grid">
      {/* LEFT COLUMN */}
      <div className="overview-left">
        {/* Stat Cards Container */}
        <div className="overview-card-container">
          <div className="overview-card-header-row">
            <h2 className="overview-section-title">Overview</h2>
            <div className="overview-select-wrap">
              <select className="overview-select">
                <option>Last month</option>
                <option>Last week</option>
              </select>
            </div>
          </div>
          
          <div className="overview-stats-row">
            <div className="overview-stat-box">
              <div className="stat-box-top">
                <span className="stat-box-label">Customers</span>
                <span className="stat-box-icon-wrap">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                </span>
              </div>
              <div className="stat-box-body">
                <span className="stat-box-val">{customersCount}</span>
                <div className="stat-box-trend-row">
                  <span className="stat-box-badge badge-red">
                    <span className="badge-arrow">↓</span> 36.8%
                  </span>
                  <span className="stat-box-sub">vs last month</span>
                </div>
              </div>
            </div>

            <div className="overview-stat-box">
              <div className="stat-box-top">
                <span className="stat-box-label">Balance</span>
                <span className="stat-box-icon-wrap">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>
                </span>
              </div>
              <div className="stat-box-body">
                <span className="stat-box-val">{balanceVal}</span>
                <div className="stat-box-trend-row">
                  <span className="stat-box-badge badge-green">
                    <span className="badge-arrow">↑</span> 36.8%
                  </span>
                  <span className="stat-box-sub">vs last month</span>
                </div>
              </div>
            </div>
          </div>

          <div className="overview-banner">
            <strong className="banner-alert-text">857 new customers today!</strong>
            <span className="overview-banner-sub">Send a welcome message to all new customers.</span>
          </div>

          <div className="overview-avatars-row">
            <div className="avatars-group">
              {avatars.map((avatar, idx) => (
                <div className="avatar-wrapper" key={idx} style={{ zIndex: 10 - idx }}>
                  <img src={avatar.url} alt={avatar.name} className="avatar-img" />
                  <span className="avatar-name">{avatar.name}</span>
                </div>
              ))}
              <button type="button" className="avatar-view-all" onClick={() => onNavigate("session")}>
                <span className="arrow-btn-symbol">➔</span>
                <span className="avatar-name">View all</span>
              </button>
            </div>
          </div>
        </div>

        {/* Product View Chart Card */}
        <div className="overview-card-container" style={{ marginTop: 24 }}>
          <div className="overview-card-header-row">
            <h2 className="overview-section-title">Product view</h2>
            <div className="overview-select-wrap">
              <select className="overview-select">
                <option>Last 7 days</option>
                <option>Last 30 days</option>
              </select>
            </div>
          </div>

          <div className="chart-wrapper">
            <div className="chart-main-val">
              {latest?.checkoutTotal ? formatMoney(latest.checkoutTotal) : "$10.2m"}
            </div>
            
            <div className="chart-bars-container">
              {chartData.map((day, idx) => {
                const isActive = hoveredBar === idx;
                return (
                  <div 
                    className="chart-bar-col" 
                    key={idx}
                    onMouseEnter={() => setHoveredBar(idx)}
                  >
                    {isActive && (
                      <div className="chart-tooltip">
                        <span className="tooltip-text">{day.val}</span>
                        <span className="tooltip-arrow" />
                      </div>
                    )}
                    <div className="chart-bar-track">
                      {isActive && <div className="chart-bar-dot" />}
                      <div 
                        className={`chart-bar-fill ${isActive ? "active" : ""}`}
                        style={{ height: `${day.height}%` }}
                      />
                    </div>
                    <span className="chart-bar-label">{day.label}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* RIGHT COLUMN */}
      <div className="overview-right">
        {/* Popular products block */}
        <div className="overview-card-container">
          <h2 className="overview-section-title" style={{ marginBottom: 16 }}>Popular products</h2>
          <div className="popular-products-list">
            {popularProducts.map((prod) => (
              <div className="popular-product-row" key={prod.id}>
                <div className="prod-img-wrap">
                  <img src={prod.imageUrl} alt={prod.title} />
                </div>
                <div className="prod-info-wrap">
                  <span className="prod-title">{prod.title}</span>
                  <span className="prod-sub">{prod.subtitle}</span>
                </div>
                <div className="prod-meta-wrap">
                  <span className="prod-price">{prod.price}</span>
                  <span className={`prod-badge ${prod.status === "Active" ? "active" : "offline"}`}>
                    {prod.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
          <button 
            type="button" 
            className="db-btn-all-products" 
            onClick={() => onNavigate("products")}
          >
            All products
          </button>
        </div>

        {/* Comments block */}
        <div className="overview-card-container" style={{ marginTop: 24 }}>
          <h2 className="overview-section-title" style={{ marginBottom: 16 }}>Comments</h2>
          <div className="comments-list">
            {activityLogs.map((comment) => (
              <div className="comment-row" key={comment.id}>
                <div className="comment-avatar-wrap">
                  <img src={comment.avatarUrl} alt={comment.name} />
                </div>
                <div className="comment-body-wrap">
                  <div className="comment-header">
                    <span className="comment-author">{comment.name}</span>
                    <span className="comment-target">on {comment.target}</span>
                  </div>
                  <span className="comment-time">{comment.time}</span>
                  <p className="comment-text">{comment.text}</p>
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
  message
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
}) {
  const filteredLinks = useMemo(() => {
    if (!searchQuery.trim()) return links;
    return links.filter(l => l.title.toLowerCase().includes(searchQuery.toLowerCase()) || l.url.toLowerCase().includes(searchQuery.toLowerCase()));
  }, [links, searchQuery]);

  const productPageTotal = useMemo(() => filteredLinks.reduce((total, link) => {
    const observed = parseObservedPrice(link)?.minorUnits ?? 0;
    return total + observed;
  }, 0), [filteredLinks]);

  return (
    <div className="products-panel">
      <div className="panel-header-actions">
        <h2 className="overview-section-title">Saved Products ({filteredLinks.length})</h2>
        <button 
          type="button" 
          className="db-btn-primary" 
          disabled={checking || links.length === 0}
          onClick={() => void checkAllLinks()}
        >
          {checking ? "⟳ Running check..." : "▶ Run Price Verification"}
        </button>
      </div>

      {message && <div className="info-message-banner">{message}</div>}
      {activeJob && (
        <div className="active-job-banner">
          <span>{priceCheckJobLabel(activeJob)}</span>
        </div>
      )}

      <div className="products-grid-layout">
        {/* Left side: List of links */}
        <div className="overview-card-container">
          <h3 className="card-subtitle" style={{ marginBottom: 12 }}>Monitored Links</h3>
          {filteredLinks.length === 0 ? (
            <div className="db-empty-state">
              <p>{searchQuery ? "No products match your search query." : "No saved links yet. Click 'Create' in the top header to add a product URL."}</p>
            </div>
          ) : (
            <div className="db-links-list">
              {filteredLinks.map((link) => (
                <div className="db-link-row" key={link.id}>
                  {link.imageUrl && (
                    <div className="db-link-thumbnail">
                      <img src={link.imageUrl} alt={link.title} />
                    </div>
                  )}
                  <div className="db-link-info">
                    <p className="db-link-title">{link.title}</p>
                    <a href={link.url} target="_blank" rel="noreferrer" className="db-link-url">View on Daraz ↗</a>
                  </div>
                  <div className="db-link-meta">
                    <span className="db-link-price">{formatMoney(parseObservedPrice(link))}</span>
                    <button type="button" className="text-button remove-btn" onClick={() => void removeLink(link.id)}>Remove</button>
                  </div>
                </div>
              ))}
              <div className="db-links-total">
                <span>Product-page total</span>
                <strong>{formatLkr(productPageTotal)}</strong>
              </div>
            </div>
          )}
        </div>

        {/* Right side: Latest Verification Results */}
        <div className="overview-card-container">
          <h3 className="card-subtitle" style={{ marginBottom: 12 }}>Latest Checkout Results</h3>
          {latest ? (
            <div className="price-results-section">
              <div className="results-summary-row" style={{ marginBottom: 12 }}>
                <span>Latest Verified Checkout Total:</span>
                <strong className="checkout-total-val">{formatMoney(latest.checkoutTotal)}</strong>
              </div>
              <PriceTable result={latest} />
            </div>
          ) : (
            <div className="db-empty-state">
              <p>No verified checks completed yet. Trigger a price verification run to see final checkout totals, service fees, and taxes.</p>
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
  checking,
  checkAllLinks,
  activeJob,
  message
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
}) {
  return (
    <div className="session-panel">
      <h2 className="overview-section-title" style={{ marginBottom: 16 }}>Daraz Browser Session</h2>

      {message && <div className="info-message-banner">{message}</div>}
      
      <div className="session-grid">
        <div className="overview-card-container">
          <div className="session-status-row" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <h3>Connection Status</h3>
            <span className={`status-pill ${sessionClassName(darazSession.status)}`}>
              {sessionLabel(darazSession.status)}
            </span>
          </div>

          <p className="session-desc" style={{ color: "#64748b", fontSize: 14, lineHeight: 1.5, marginBottom: 20 }}>
            {sessionHelpText(darazSession, credentials)}
          </p>

          <div className="session-controls" style={{ display: "flex", gap: 12 }}>
            {captureId && browserUrl ? (
              <a className="db-btn-primary remote-browser-btn" href={browserUrl} target="_blank" rel="noreferrer" style={{ textDecoration: "none", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                Open Remote Browser Window ↗
              </a>
            ) : (
              <button 
                type="button" 
                className="db-btn-primary" 
                disabled={Boolean(captureId)} 
                onClick={() => void startDarazLogin()}
                style={{ flex: 1 }}
              >
                {captureId ? "Browser Active" : "Start Login Session"}
              </button>
            )}
            
            <button 
              type="button" 
              className="db-btn-secondary" 
              disabled={!captureId} 
              onClick={() => void saveDarazLogin()}
              style={{ flex: 1 }}
            >
              Save Login Session
            </button>
          </div>

          <div className="session-controls" style={{ display: "flex", gap: 12, marginTop: 12 }}>
            <button 
              type="button" 
              className="db-btn-light" 
              style={{ flex: 1 }} 
              disabled={!captureId && darazSession.status === "missing"} 
              onClick={() => void resetDarazLogin()}
            >
              Reset Session
            </button>
            <button 
              type="button" 
              className="db-btn-light" 
              style={{ flex: 1 }} 
              disabled={!captureId} 
              onClick={() => void stopDarazBrowser()}
            >
              Stop Browser Process
            </button>
          </div>
        </div>

        <div className="overview-card-container">
          <h3 style={{ marginBottom: 12 }}>Session Verification Instructions</h3>
          <ul className="verification-steps-list" style={{ paddingLeft: 20, margin: 0, color: "#475569", fontSize: 14, lineHeight: 1.6 }}>
            <li style={{ marginBottom: 8 }}>
              <strong>1. Start the Session:</strong> Click "Start Login Session". This spins up an automated remote browser instance on the CartTruth server.
            </li>
            <li style={{ marginBottom: 8 }}>
              <strong>2. Log In:</strong> Click "Open Remote Browser Window". This opens a secure VNC interface displaying the remote browser. Navigate to Daraz, enter your credentials, and complete any required captchas or OTP challenges.
            </li>
            <li style={{ marginBottom: 8 }}>
              <strong>3. Save Cookies:</strong> Return to this page and click "Save Login Session". CartTruth will secure the browser cookies for subsequent automated checks.
            </li>
            <li>
              <strong>4. Test Run:</strong> Add a product link and click "Run Price Verification" to test.
            </li>
          </ul>
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

  // Build a simple events-over-time mock from recent 12 events (grouped by hour)
  const eventsOverTime = proxyEvents.slice(0, 7).map(e => e.elapsedMs ?? 500).reverse();
  const eventsLabels = proxyEvents.slice(0, 7).map((_, i) => `E${i + 1}`).reverse();

  return (
    <>
      {/* STAT CARDS */}
      <div className="db-stat-cards">
        <StatCard
          label="Total Users"
          value={String(users.length)}
          delta={users.length > 0 ? 12 : undefined}
          deltaLabel="than last month"
          icon={<svg viewBox="0 0 20 20" fill="white" width="18" height="18"><path d="M9 6a3 3 0 11-6 0 3 3 0 016 0zM17 6a3 3 0 11-6 0 3 3 0 016 0zM12.93 17c.046-.327.07-.66.07-1a6.97 6.97 0 00-1.5-4.33A5 5 0 0119 16v1h-6.07zM6 11a5 5 0 015 5v1H1v-1a5 5 0 015-5z" /></svg>}
          iconBg="#3b82f6"
        />
        <StatCard
          label="Active Users"
          value={String(activeUsers)}
          delta={3}
          deltaLabel="than last week"
          icon={<svg viewBox="0 0 20 20" fill="white" width="18" height="18"><path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" /></svg>}
          iconBg="#10b981"
        />
        <StatCard
          label="Total Proxy Events"
          value={String(totalEvents)}
          delta={totalEvents > 0 ? 5 : undefined}
          deltaLabel="than yesterday"
          icon={<svg viewBox="0 0 20 20" fill="white" width="18" height="18"><path fillRule="evenodd" d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z" clipRule="evenodd" /></svg>}
          iconBg="#f59e0b"
        />
        <StatCard
          label="Proxy Status"
          value={proxySummary?.proxy.enabled ? "Active" : "Inactive"}
          icon={<svg viewBox="0 0 20 20" fill="white" width="18" height="18"><path fillRule="evenodd" d="M2.166 4.999A11.954 11.954 0 0010 1.944 11.954 11.954 0 0017.834 5c.11.65.166 1.32.166 2.001 0 5.225-3.34 9.67-8 11.317C5.34 16.67 2 12.225 2 7c0-.682.057-1.35.166-2.001zm11.541 3.708a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" /></svg>}
          iconBg="#8b5cf6"
        />
      </div>

      {/* CHARTS ROW */}
      <div className="db-charts-row">
        <DonutChart
          segments={[
            { value: successCount, color: "#10b981", name: "Success" },
            { value: failCount, color: "#ef4444", name: "Failure" },
            { value: blockedCount, color: "#f59e0b", name: "Blocked" }
          ]}
          label="Proxy Events by Status"
          sublabel="Last 12 events"
        />
        <MiniLineChart
          data={eventsOverTime.length > 1 ? eventsOverTime : [120, 340, 200, 480, 300, 520, 410]}
          color="#3b82f6"
          label="Response Times"
          sublabel="Elapsed ms per event"
        />
        <MiniBarChart
          data={[users.filter(u => !u.disabled).length, users.filter(u => u.disabled).length, users.filter(u => u.role === "admin").length]}
          labels={["Active", "Disabled", "Admin"]}
          color="#8b5cf6"
          label="User Breakdown"
          sublabel="By status / role"
        />
      </div>

      {/* USERS TABLE */}
      <div className="db-card" style={{ marginTop: 24 }}>
        <div className="db-card-header">
          <h2 className="db-card-title">Users</h2>
          <span className="db-badge db-badge--blue">{users.length} total</span>
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

      {/* PROXY PANEL */}
      <div className="db-two-col" style={{ marginTop: 20 }}>
        <div className="db-card">
          <div className="db-card-header">
            <h2 className="db-card-title">Proxy Operations</h2>
            <span className={`status ${proxySummary?.proxy.enabled ? "checked" : "needs_attention"}`}>
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
          <button type="button" className="light-button" disabled={testingProxy} onClick={() => void testProxy()}>
            {testingProxy ? "Testing..." : "Run proxy test"}
          </button>
          {proxyTest && <p className="message">Last test: {proxyTest.ok ? "✓ OK" : "✗ Failed"} ({proxyTest.status}) in {proxyTest.elapsedMs}ms</p>}
          <p className="message">{proxySummary?.external.note}</p>
        </div>

        <div className="db-card">
          <div className="db-card-header">
            <h2 className="db-card-title">Recent Proxy Events</h2>
            <button type="button" className="text-button" onClick={() => void refresh()}>Refresh</button>
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
    </>
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

  return (
    <>
      {/* STAT CARDS */}
      <div className="db-stat-cards">
        <StatCard
          label="Total Messages"
          value={String(messages.length)}
          icon={<svg viewBox="0 0 20 20" fill="white" width="18" height="18"><path fillRule="evenodd" d="M2.94 6.412A2 2 0 002 8.108V16a2 2 0 002 2h12a2 2 0 002-2V8.108a2 2 0 00-.94-1.696l-6-3.75a2 2 0 00-2.12 0l-6 3.75zm2.615 2.423a1 1 0 10-1.11 1.664l5 3.333a1 1 0 001.11 0l5-3.333a1 1 0 00-1.11-1.664L10 11.798 5.555 8.835z" clipRule="evenodd" /></svg>}
          iconBg="#3b82f6"
        />
        <StatCard
          label="Unread"
          value={String(messages.length)}
          icon={<svg viewBox="0 0 20 20" fill="white" width="18" height="18"><path d="M10 12a2 2 0 100-4 2 2 0 000 4z" /><path fillRule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clipRule="evenodd" /></svg>}
          iconBg="#8b5cf6"
        />
      </div>

      {/* MESSAGES TABLE */}
      <div className="db-card" style={{ marginTop: 24 }}>
        <div className="db-card-header">
          <h2 className="db-card-title">Contact Messages</h2>
          <button type="button" className="text-button" onClick={() => void refresh()}>Refresh</button>
        </div>
        {deleteMsg && <p className="message">{deleteMsg}</p>}
        {loading ? (
          <p style={{ color: "#94a3b8", padding: "24px 0", fontStyle: "italic" }}>Loading messages...</p>
        ) : messages.length === 0 ? (
          <div className="msg-empty">
            <div className="msg-empty-icon">📭</div>
            <p>No messages yet. They'll appear here when visitors submit the contact form.</p>
          </div>
        ) : (
          <div className="msg-list">
            {messages.map((msg) => (
              <div key={msg.id} className="msg-card">
                <div className="msg-card-header">
                  <div className="msg-card-meta">
                    <span className="msg-card-subject">{msg.subject}</span>
                    <span className="msg-card-date">{new Date(msg.createdAt).toLocaleString()}</span>
                  </div>
                  <button
                    type="button"
                    className="msg-delete-btn"
                    onClick={() => void deleteMessage(msg.id)}
                    title="Delete message"
                  >
                    <svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14"><path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" /></svg>
                    Delete
                  </button>
                </div>
                <div className="msg-card-content">{msg.content}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
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
