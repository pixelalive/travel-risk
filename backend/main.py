import hashlib
import os
import secrets
import smtplib
import sqlite3
import time
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage

import bcrypt
import jwt
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, EmailStr

load_dotenv()
SECRET = os.getenv("JWT_SECRET", "dev-secret-change-me")
SMTP_USER = os.getenv("SMTP_USER")
SMTP_PASS = os.getenv("SMTP_PASS")

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def db():
    conn = sqlite3.connect("app.db")
    conn.row_factory = sqlite3.Row
    conn.execute(
        """CREATE TABLE IF NOT EXISTS users(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            verified INTEGER DEFAULT 0,
            otp_hash TEXT,
            otp_expires REAL
        )"""
    )
    return conn


class RegisterIn(BaseModel):
    name: str
    email: EmailStr
    password: str


class VerifyIn(BaseModel):
    email: EmailStr
    otp: str


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class EmailIn(BaseModel):
    email: EmailStr


def send_otp_email(to, code):
    if not (SMTP_USER and SMTP_PASS):
        print(f"[DEV] OTP for {to}: {code}")
        return
    try:
        msg = EmailMessage()
        msg["Subject"] = "Your verification code"
        msg["From"] = SMTP_USER
        msg["To"] = to
        msg.set_content(f"Your verification code is {code}. It expires in 10 minutes.")
        with smtplib.SMTP_SSL("smtp.gmail.com", 465) as s:
            s.login(SMTP_USER, SMTP_PASS)
            s.send_message(msg)
    except Exception as e:
        print(f"[EMAIL FAILED] {e}")
        print(f"[DEV] OTP for {to}: {code}")


def issue_otp(conn, email):
    code = f"{secrets.randbelow(1_000_000):06d}"
    conn.execute(
        "UPDATE users SET otp_hash=?, otp_expires=? WHERE email=?",
        (hashlib.sha256(code.encode()).hexdigest(), time.time() + 600, email),
    )
    conn.commit()
    send_otp_email(email, code)


def make_token(uid):
    payload = {"sub": str(uid), "exp": datetime.now(timezone.utc) + timedelta(hours=12)}
    return jwt.encode(payload, SECRET, algorithm="HS256")


bearer = HTTPBearer()


def current_user(cred: HTTPAuthorizationCredentials = Depends(bearer)):
    try:
        uid = int(jwt.decode(cred.credentials, SECRET, algorithms=["HS256"])["sub"])
    except Exception:
        raise HTTPException(401, "Invalid or expired token")
    conn = db()
    u = conn.execute("SELECT id, name, email FROM users WHERE id=?", (uid,)).fetchone()
    conn.close()
    if not u:
        raise HTTPException(401, "User not found")
    return dict(u)


@app.get("/api/hello")
def hello():
    return {"message": "Backend is alive"}


@app.post("/api/register")
def register(d: RegisterIn):
    if not 8 <= len(d.password) <= 72:
        raise HTTPException(400, "Password must be 8 to 72 characters")
    email = d.email.lower()
    pw = bcrypt.hashpw(d.password.encode(), bcrypt.gensalt()).decode()
    conn = db()
    try:
        conn.execute(
            "INSERT INTO users(name, email, password_hash) VALUES (?,?,?)",
            (d.name.strip(), email, pw),
        )
        conn.commit()
    except sqlite3.IntegrityError:
        conn.close()
        raise HTTPException(409, "Email already registered")
    issue_otp(conn, email)
    conn.close()
    return {"message": "Verification code sent"}


@app.post("/api/verify-otp")
def verify_otp(d: VerifyIn):
    conn = db()
    u = conn.execute("SELECT * FROM users WHERE email=?", (d.email.lower(),)).fetchone()
    if not u or not u["otp_hash"] or time.time() > u["otp_expires"]:
        conn.close()
        raise HTTPException(400, "Code expired or invalid. Request a new one.")
    if hashlib.sha256(d.otp.strip().encode()).hexdigest() != u["otp_hash"]:
        conn.close()
        raise HTTPException(400, "Wrong code")
    conn.execute("UPDATE users SET verified=1, otp_hash=NULL WHERE id=?", (u["id"],))
    conn.commit()
    conn.close()
    return {"token": make_token(u["id"])}


@app.post("/api/resend-otp")
def resend_otp(d: EmailIn):
    email = d.email.lower()
    conn = db()
    u = conn.execute("SELECT verified FROM users WHERE email=?", (email,)).fetchone()
    if u and not u["verified"]:
        issue_otp(conn, email)
    conn.close()
    return {"message": "If the account exists, a new code was sent"}


@app.post("/api/login")
def login(d: LoginIn):
    email = d.email.lower()
    conn = db()
    u = conn.execute("SELECT * FROM users WHERE email=?", (email,)).fetchone()
    ok = (
        u is not None
        and len(d.password) <= 72
        and bcrypt.checkpw(d.password.encode(), u["password_hash"].encode())
    )
    if not ok:
        conn.close()
        raise HTTPException(401, "Wrong email or password")
    if not u["verified"]:
        issue_otp(conn, email)
        conn.close()
        raise HTTPException(403, "Email not verified. We sent a new code.")
    conn.close()
    return {"token": make_token(u["id"])}


@app.get("/api/me")
def me(user=Depends(current_user)):
    return user