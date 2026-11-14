import { createContext, useContext, useEffect, useState } from "react";
import {
  BrowserRouter, Routes, Route, Navigate, Link, NavLink,
  useNavigate, useSearchParams,
} from "react-router-dom";

const API = "http://127.0.0.1:8000/api";

async function api(path, method = "GET", body) {
  const token = localStorage.getItem("token");
  const res = await fetch(API + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(typeof data.detail === "string" ? data.detail : "Please check your input");
  }
  return data;
}

/* ---------- Auth state shared by all pages ---------- */
const AuthContext = createContext(null);
const useAuth = () => useContext(AuthContext);

function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(!!localStorage.getItem("token"));

  const loadUser = async () => {
    try {
      setUser(await api("/me"));
    } catch {
      localStorage.removeItem("token");
      setUser(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (localStorage.getItem("token")) loadUser();
  }, []);

  const signIn = async (token) => {
    localStorage.setItem("token", token);
    await loadUser();
  };
  const signOut = () => {
    localStorage.removeItem("token");
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

function Protected({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="center-msg">Loading...</div>;
  return user ? children : <Navigate to="/login" replace />;
}

function GuestOnly({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="center-msg">Loading...</div>;
  return user ? <Navigate to="/dashboard" replace /> : children;
}

/* ---------- Layout ---------- */
function Navbar() {
  const { user, signOut } = useAuth();
  const nav = useNavigate();
  return (
    <header className="nav">
      <div className="nav-inner">
        <Link to="/" className="brand">
          <span className="brand-dot" /> TravelRisk
        </Link>
        <nav className="nav-links">
          <NavLink to="/" end>Home</NavLink>
          {user ? (
            <>
              <NavLink to="/dashboard">Dashboard</NavLink>
              <button
                className="btn btn-ghost"
                onClick={() => { signOut(); nav("/"); }}
              >
                Log out
              </button>
            </>
          ) : (
            <>
              <NavLink to="/login">Log in</NavLink>
              <Link to="/signup" className="btn btn-primary">Sign up</Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}

function AuthCard({ title, subtitle, footer, children }) {
  return (
    <div className="auth-wrap">
      <div className="card auth-card">
        <h2>{title}</h2>
        <p className="muted">{subtitle}</p>
        {children}
        <div className="auth-footer">{footer}</div>
      </div>
    </div>
  );
}

function Field({ label, ...props }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input {...props} />
    </label>
  );
}

/* ---------- Pages ---------- */
function Home() {
  const { user } = useAuth();
  const features = [
    { icon: "☁", title: "Live conditions", text: "Bring weather and air quality together so you can see what a trip will really feel like." },
    { icon: "➜", title: "Smarter routes", text: "Compare routes by exposure and conditions, not just by distance and time." },
    { icon: "🔒", title: "Secure accounts", text: "Email-verified sign up, hashed passwords, and a protected dashboard." },
  ];
  return (
    <>
      <section className="hero">
        <span className="pill">Smarter, safer journeys</span>
        <h1>Plan routes with air quality and weather in mind</h1>
        <p>
          TravelRisk helps you choose healthier, safer ways to get around by
          combining conditions and route planning in one place.
        </p>
        <div className="hero-actions">
          {user ? (
            <Link className="btn btn-primary btn-lg" to="/dashboard">Go to dashboard</Link>
          ) : (
            <>
              <Link className="btn btn-primary btn-lg" to="/signup">Get started</Link>
              <Link className="btn btn-outline btn-lg" to="/login">Log in</Link>
            </>
          )}
        </div>
      </section>
      <section className="features">
        {features.map((f) => (
          <div className="card feature" key={f.title}>
            <div className="icon">{f.icon}</div>
            <h3>{f.title}</h3>
            <p>{f.text}</p>
          </div>
        ))}
      </section>
    </>
  );
}

function Signup() {
  const nav = useNavigate();
  const [f, setF] = useState({ name: "", email: "", password: "" });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      await api("/register", "POST", f);
      nav(`/verify?email=${encodeURIComponent(f.email)}`);
    } catch (x) {
      setErr(x.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthCard
      title="Create your account"
      subtitle="Sign up to get started."
      footer={<>Already have an account? <Link to="/login">Log in</Link></>}
    >
      <form onSubmit={submit}>
        {err && <div className="alert alert-error">{err}</div>}
        <Field label="Full name" value={f.name} onChange={set("name")} placeholder="Your name" required />
        <Field label="Email" type="email" value={f.email} onChange={set("email")} placeholder="you@example.com" required />
        <Field label="Password" type="password" value={f.password} onChange={set("password")} placeholder="At least 8 characters" required />
        <button className="btn btn-primary btn-block" disabled={busy}>
          {busy ? "Creating account..." : "Sign up"}
        </button>
      </form>
    </AuthCard>
  );
}

function Verify() {
  const nav = useNavigate();
  const { signIn } = useAuth();
  const [params] = useSearchParams();
  const email = params.get("email") || "";
  const [otp, setOtp] = useState("");
  const [err, setErr] = useState("");
  const [info, setInfo] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setErr("");
    setInfo("");
    setBusy(true);
    try {
      const d = await api("/verify-otp", "POST", { email, otp });
      await signIn(d.token);
      nav("/dashboard");
    } catch (x) {
      setErr(x.message);
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    setErr("");
    try {
      await api("/resend-otp", "POST", { email });
      setInfo("A new code has been sent.");
    } catch (x) {
      setErr(x.message);
    }
  };

  return (
    <AuthCard
      title="Verify your email"
      subtitle={`Enter the 6-digit code we sent to ${email || "your email"}.`}
      footer={<>Didn't get it? <button type="button" className="link-btn" onClick={resend}>Resend code</button></>}
    >
      <form onSubmit={submit}>
        {err && <div className="alert alert-error">{err}</div>}
        {info && <div className="alert alert-ok">{info}</div>}
        <label className="field">
          <span>Verification code</span>
          <input
            className="otp-input"
            value={otp}
            onChange={(e) => setOtp(e.target.value)}
            maxLength={6}
            inputMode="numeric"
            placeholder="000000"
            required
          />
        </label>
        <button className="btn btn-primary btn-block" disabled={busy}>
          {busy ? "Verifying..." : "Verify and continue"}
        </button>
      </form>
    </AuthCard>
  );
}

function Login() {
  const nav = useNavigate();
  const { signIn } = useAuth();
  const [f, setF] = useState({ email: "", password: "" });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      const d = await api("/login", "POST", f);
      await signIn(d.token);
      nav("/dashboard");
    } catch (x) {
      if (x.message.startsWith("Email not verified")) {
        nav(`/verify?email=${encodeURIComponent(f.email)}`);
      } else {
        setErr(x.message);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthCard
      title="Welcome back"
      subtitle="Log in to your account."
      footer={<>New here? <Link to="/signup">Create an account</Link></>}
    >
      <form onSubmit={submit}>
        {err && <div className="alert alert-error">{err}</div>}
        <Field label="Email" type="email" value={f.email} onChange={set("email")} placeholder="you@example.com" required />
        <Field label="Password" type="password" value={f.password} onChange={set("password")} placeholder="Your password" required />
        <button className="btn btn-primary btn-block" disabled={busy}>
          {busy ? "Logging in..." : "Log in"}
        </button>
      </form>
    </AuthCard>
  );
}

function Dashboard() {
  const { user } = useAuth();
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const initial = user.name.trim().charAt(0).toUpperCase();

  return (
    <div className="page">
      <div className="dash-head">
        <div className="avatar">{initial}</div>
        <div>
          <h1>{greeting}, {user.name}</h1>
          <p className="muted">Here is an overview of your account.</p>
        </div>
      </div>

      <div className="grid">
        <div className="card">
          <h3>Account details</h3>
          <dl className="details">
            <div><dt>Name</dt><dd>{user.name}</dd></div>
            <div><dt>Email</dt><dd>{user.email}</dd></div>
            <div><dt>Status</dt><dd><span className="badge badge-ok">Verified</span></dd></div>
            <div><dt>Account ID</dt><dd>#{user.id}</dd></div>
          </dl>
        </div>

        <div className="card">
          <h3>Security</h3>
          <ul className="checklist">
            <li>Email verified with a one-time code</li>
            <li>Password stored as a secure hash</li>
            <li>Signed session token (12 hours)</li>
          </ul>
        </div>

        <div className="card stat">
          <span className="badge badge-soon">Coming soon</span>
          <div className="stat-value">Route planner</div>
          <p>Compare routes by air quality and weather exposure.</p>
        </div>

        <div className="card stat">
          <span className="badge badge-soon">Coming soon</span>
          <div className="stat-value">Live conditions</div>
          <p>Current weather and air quality for your area.</p>
        </div>
      </div>
    </div>
  );
}

/* ---------- App ---------- */
export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Navbar />
        <main>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/signup" element={<GuestOnly><Signup /></GuestOnly>} />
            <Route path="/verify" element={<GuestOnly><Verify /></GuestOnly>} />
            <Route path="/login" element={<GuestOnly><Login /></GuestOnly>} />
            <Route path="/dashboard" element={<Protected><Dashboard /></Protected>} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
        <footer className="footer">© 2026 TravelRisk · Built with FastAPI and React</footer>
      </AuthProvider>
    </BrowserRouter>
  );
}