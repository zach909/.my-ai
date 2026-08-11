"""Email plugin — read and send email via IMAP/SMTP (no external API)."""

from __future__ import annotations
import email, imaplib, smtplib, ssl, os, json, re
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from typing import Dict, List, Optional
from .plugin_base import Plugin

_CREDS_FILE = os.path.expanduser("~/.config/neuroclaw/email_creds.json")


def _sanitize_header(value: str) -> str:
    """Strip CR and LF characters to prevent MIME header injection and HeaderParseError."""
    if not isinstance(value, str):
        return ""
    # Replace any sequence of carriage returns and line feeds with a space
    return re.sub(r"[\r\n]+", " ", value)


class EmailPlugin(Plugin):
    name = "email"
    description = "Read and send email via IMAP/SMTP. Credentials stored locally."

    def _setup(self) -> None:
        self.tools = {
            "configure":  self._configure,
            "send":       self._send,
            "inbox":      self._inbox,
            "read":       self._read_message,
            "search":     self._search,
        }
        self._creds: Optional[Dict] = None
        if os.path.exists(_CREDS_FILE):
            with open(_CREDS_FILE) as f:
                self._creds = json.load(f)

    def _configure(self, email_addr: str, password: str,
                   imap_host: str, smtp_host: str,
                   imap_port: int = 993, smtp_port: int = 587) -> str:
        self._creds = {
            "email": email_addr,
            "password": password,
            "imap_host": imap_host,
            "imap_port": imap_port,
            "smtp_host": smtp_host,
            "smtp_port": smtp_port,
        }
        os.makedirs(os.path.dirname(_CREDS_FILE), exist_ok=True)
        # Securely create the credential file with restrictive (0o600) permissions
        # to prevent unauthorized local reading on multi-user systems.
        flags = os.O_WRONLY | os.O_CREAT | os.O_TRUNC
        fd = os.open(_CREDS_FILE, flags, 0o600)
        with os.fdopen(fd, "w") as f:
            json.dump(self._creds, f)
        os.chmod(_CREDS_FILE, 0o600)
        return f"Email configured for {email_addr}"

    def _get_imap(self) -> imaplib.IMAP4_SSL:
        if not self._creds:
            raise RuntimeError("Email not configured. Call configure() first.")
        ctx = ssl.create_default_context()
        conn = imaplib.IMAP4_SSL(self._creds["imap_host"], self._creds["imap_port"], ssl_context=ctx)
        conn.login(self._creds["email"], self._creds["password"])
        return conn

    def _inbox(self, count: int = 10) -> List[Dict]:
        conn = self._get_imap()
        conn.select("INBOX")
        _, data = conn.search(None, "ALL")
        ids = data[0].split()[-count:]
        messages = []
        for mid in reversed(ids):
            _, mdata = conn.fetch(mid, "(RFC822.SIZE ENVELOPE)")
            messages.append({"id": mid.decode(), "raw_envelope": str(mdata[0])})
        conn.logout()
        return messages

    def _read_message(self, msg_id: str) -> str:
        conn = self._get_imap()
        conn.select("INBOX")
        _, data = conn.fetch(msg_id.encode(), "(RFC822)")
        msg = email.message_from_bytes(data[0][1])
        conn.logout()
        body = ""
        if msg.is_multipart():
            for part in msg.walk():
                if part.get_content_type() == "text/plain":
                    body = part.get_payload(decode=True).decode("utf-8", errors="replace")
                    break
        else:
            body = msg.get_payload(decode=True).decode("utf-8", errors="replace")
        return f"From: {msg['From']}\nSubject: {msg['Subject']}\n\n{body}"

    def _send(self, to: str, subject: str, body: str) -> str:
        if not self._creds:
            raise RuntimeError("Email not configured.")
        msg = MIMEMultipart()
        msg["From"] = _sanitize_header(self._creds["email"])
        msg["To"] = _sanitize_header(to)
        msg["Subject"] = _sanitize_header(subject)
        msg.attach(MIMEText(body, "plain"))
        ctx = ssl.create_default_context()
        with smtplib.SMTP(self._creds["smtp_host"], self._creds["smtp_port"]) as server:
            server.starttls(context=ctx)
            server.login(self._creds["email"], self._creds["password"])
            server.send_message(msg)
        return f"Email sent to {to}"

    def _search(self, query: str) -> List[str]:
        conn = self._get_imap()
        conn.select("INBOX")
        _, data = conn.search(None, f'(SUBJECT "{query}")')
        ids = data[0].split()
        conn.logout()
        return [mid.decode() for mid in ids]
