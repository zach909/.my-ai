"""Contacts plugin — manage local contacts via vCard files."""

from __future__ import annotations
import os, glob, json
from typing import Dict, List, Optional
from .plugin_base import Plugin

_CONTACTS_DIR = os.path.expanduser("~/.config/neuroclaw/contacts")


class ContactsPlugin(Plugin):
    name = "contacts"
    description = "Manage contacts stored as local JSON/vCard files."

    def _setup(self) -> None:
        os.makedirs(_CONTACTS_DIR, exist_ok=True)
        self.tools = {
            "add":    self._add,
            "get":    self._get,
            "list":   self._list,
            "search": self._search,
            "delete": self._delete,
        }

    def _path(self, name: str) -> str:
        safe = "".join(c if c.isalnum() or c in "-_ " else "_" for c in name)
        return os.path.join(_CONTACTS_DIR, safe + ".json")

    def _add(self, name: str, email: str = "", phone: str = "",
             notes: str = "", **extra) -> str:
        data = {"name": name, "email": email, "phone": phone,
                "notes": notes, **extra}
        with open(self._path(name), "w") as f:
            json.dump(data, f, indent=2)
        return f"Contact '{name}' saved"

    def _get(self, name: str) -> Optional[Dict]:
        p = self._path(name)
        if not os.path.exists(p):
            return None
        with open(p) as f:
            return json.load(f)

    def _list(self) -> List[str]:
        return [os.path.splitext(os.path.basename(p))[0]
                for p in glob.glob(os.path.join(_CONTACTS_DIR, "*.json"))]

    def _search(self, query: str) -> List[Dict]:
        q = query.lower()
        results = []
        for path in glob.glob(os.path.join(_CONTACTS_DIR, "*.json")):
            with open(path) as f:
                data = json.load(f)
            if q in str(data).lower():
                results.append(data)
        return results

    def _delete(self, name: str) -> str:
        p = self._path(name)
        if os.path.exists(p):
            os.remove(p)
            return f"Contact '{name}' deleted"
        return f"Contact '{name}' not found"
