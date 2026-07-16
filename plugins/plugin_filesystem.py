"""File system plugin — read, write, list, search files on the local machine."""

from __future__ import annotations
import os, glob, shutil, json, stat
from typing import Any, List, Optional
from .plugin_base import Plugin


class FileSystemPlugin(Plugin):
    name = "file_system"
    description = "Local file system access: read, write, list, search, copy, move."

    def _setup(self) -> None:
        self.tools = {
            "read":   self._read,
            "write":  self._write,
            "list":   self._list,
            "exists": self._exists,
            "delete": self._delete,
            "copy":   self._copy,
            "move":   self._move,
            "search": self._search,
            "mkdir":  self._mkdir,
            "stat":   self._stat,
            "tree":   self._tree,
        }

    def _resolve(self, path: str) -> str:
        """Resolve path and ensure it's within the current working directory."""
        root = os.path.abspath(os.getcwd())
        # Expand ~ and join with root if relative
        full_path = os.path.abspath(os.path.join(root, os.path.expanduser(path)))
        # Resolve symlinks for the final check
        real_path = os.path.realpath(full_path)

        rel = os.path.relpath(real_path, root)
        if rel.startswith("..") or os.path.isabs(rel):
            raise ValueError(f"Security Error: Path traversal detected: {path}")
        return real_path

    def _read(self, path: str, encoding: str = "utf-8") -> str:
        with open(self._resolve(path), encoding=encoding) as f:
            return f.read()

    def _write(self, path: str, content: str, encoding: str = "utf-8") -> None:
        path = self._resolve(path)
        os.makedirs(os.path.dirname(path), exist_ok=True) if os.path.dirname(path) else None
        with open(path, "w", encoding=encoding) as f:
            f.write(content)

    def _list(self, path: str = ".", pattern: str = "*") -> List[str]:
        # Sanitize pattern to prevent directory escape via glob
        if ".." in pattern or os.path.isabs(pattern):
            raise ValueError(f"Security Error: Invalid pattern: {pattern}")
        path = self._resolve(path)
        return sorted(glob.glob(os.path.join(path, pattern)))

    def _exists(self, path: str) -> bool:
        return os.path.exists(self._resolve(path))

    def _delete(self, path: str) -> None:
        path = self._resolve(path)
        if os.path.isdir(path):
            shutil.rmtree(path)
        else:
            os.remove(path)

    def _copy(self, src: str, dst: str) -> None:
        shutil.copy2(self._resolve(src), self._resolve(dst))

    def _move(self, src: str, dst: str) -> None:
        shutil.move(self._resolve(src), self._resolve(dst))

    def _search(self, directory: str, pattern: str, recursive: bool = True) -> List[str]:
        # Sanitize pattern to prevent directory escape via glob
        if ".." in pattern or os.path.isabs(pattern):
            raise ValueError(f"Security Error: Invalid pattern: {pattern}")
        directory = self._resolve(directory)
        if recursive:
            matches = []
            for root, _, files in os.walk(directory):
                for name in files:
                    if glob.fnmatch.fnmatch(name, pattern):
                        matches.append(os.path.join(root, name))
            return matches
        return glob.glob(os.path.join(directory, pattern))

    def _mkdir(self, path: str) -> None:
        os.makedirs(self._resolve(path), exist_ok=True)

    def _stat(self, path: str) -> dict:
        s = os.stat(self._resolve(path))
        return {
            "size": s.st_size,
            "mtime": s.st_mtime,
            "is_dir": stat.S_ISDIR(s.st_mode),
            "permissions": oct(stat.S_IMODE(s.st_mode)),
        }

    def _tree(self, path: str = ".", max_depth: int = 3) -> str:
        lines: List[str] = []
        path = self._resolve(path)
        def _walk(p: str, prefix: str, depth: int) -> None:
            if depth > max_depth:
                return
            try:
                entries = sorted(os.scandir(p), key=lambda e: (not e.is_dir(), e.name))
            except PermissionError:
                return
            for i, entry in enumerate(entries):
                connector = "└── " if i == len(entries) - 1 else "├── "
                lines.append(f"{prefix}{connector}{entry.name}")
                if entry.is_dir():
                    extension = "    " if i == len(entries) - 1 else "│   "
                    _walk(entry.path, prefix + extension, depth + 1)
        lines.append(os.path.basename(path) or path)
        _walk(path, "", 1)
        return "\n".join(lines)
