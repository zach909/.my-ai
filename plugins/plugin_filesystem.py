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
        path_expanded = os.path.expanduser(path)
        cwd = os.path.realpath(os.getcwd())
        target = os.path.realpath(os.path.abspath(path_expanded))
        rel = os.path.relpath(target, cwd)
        if rel.startswith("..") or os.path.isabs(rel):
            raise ValueError(f"Security Error: Path traversal detected for path: {path}")
        return target

    def _read(self, path: str, encoding: str = "utf-8") -> str:
        with open(self._resolve(path), encoding=encoding) as f:
            return f.read()

    def _write(self, path: str, content: str, encoding: str = "utf-8") -> None:
        resolved_path = self._resolve(path)
        dir_name = os.path.dirname(resolved_path)
        if dir_name:
            self._resolve(dir_name)
            os.makedirs(dir_name, exist_ok=True)
        with open(resolved_path, "w", encoding=encoding) as f:
            f.write(content)

    def _list(self, path: str = ".", pattern: str = "*") -> List[str]:
        resolved_path = self._resolve(path)
        if ".." in pattern or os.path.isabs(pattern):
            raise ValueError(f"Security Error: Path traversal pattern detected: {pattern}")
        results = glob.glob(os.path.join(resolved_path, pattern))
        for p in results:
            self._resolve(p)
        return sorted(results)

    def _exists(self, path: str) -> bool:
        try:
            return os.path.exists(self._resolve(path))
        except ValueError:
            return False

    def _delete(self, path: str) -> None:
        resolved_path = self._resolve(path)
        if os.path.isdir(resolved_path):
            shutil.rmtree(resolved_path)
        else:
            os.remove(resolved_path)

    def _copy(self, src: str, dst: str) -> None:
        shutil.copy2(self._resolve(src), self._resolve(dst))

    def _move(self, src: str, dst: str) -> None:
        shutil.move(self._resolve(src), self._resolve(dst))

    def _search(self, directory: str, pattern: str, recursive: bool = True) -> List[str]:
        resolved_dir = self._resolve(directory)
        if ".." in pattern or os.path.isabs(pattern):
            raise ValueError(f"Security Error: Path traversal pattern detected: {pattern}")
        if recursive:
            matches = []
            for root, _, files in os.walk(resolved_dir):
                for name in files:
                    if glob.fnmatch.fnmatch(name, pattern):
                        full_path = os.path.join(root, name)
                        self._resolve(full_path)
                        matches.append(full_path)
            return matches
        results = glob.glob(os.path.join(resolved_dir, pattern))
        for p in results:
            self._resolve(p)
        return results

    def _mkdir(self, path: str) -> None:
        resolved_path = self._resolve(path)
        os.makedirs(resolved_path, exist_ok=True)

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
        resolved_path = self._resolve(path)
        def _walk(p: str, prefix: str, depth: int) -> None:
            if depth > max_depth:
                return
            try:
                self._resolve(p)
                entries = sorted(os.scandir(p), key=lambda e: (not e.is_dir(), e.name))
            except (PermissionError, ValueError):
                return
            for i, entry in enumerate(entries):
                connector = "└── " if i == len(entries) - 1 else "├── "
                lines.append(f"{prefix}{connector}{entry.name}")
                if entry.is_dir():
                    extension = "    " if i == len(entries) - 1 else "│   "
                    _walk(entry.path, prefix + extension, depth + 1)
        lines.append(os.path.basename(resolved_path) or resolved_path)
        _walk(resolved_path, "", 1)
        return "\n".join(lines)
