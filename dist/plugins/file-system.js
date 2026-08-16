import * as fs from "fs";
import * as path from "path";
import { BasePlugin } from "../plugin_manager/sdk.js";
export class FileSystemPlugin extends BasePlugin {
    constructor(definition) {
        super(definition);
        this.rootDir = process.cwd();
    }
    setRootDir(dir) {
        this.rootDir = dir;
    }
    async readFile(filePath) {
        const fullPath = this.resolvePath(filePath);
        return fs.readFileSync(fullPath, "utf-8");
    }
    async writeFile(filePath, content) {
        const fullPath = this.resolvePath(filePath);
        const dir = path.dirname(fullPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(fullPath, content, "utf-8");
    }
    async deleteFile(filePath) {
        const fullPath = this.resolvePath(filePath);
        if (!fs.existsSync(fullPath)) {
            return false;
        }
        fs.unlinkSync(fullPath);
        return true;
    }
    async listDirectory(dirPath) {
        const fullPath = this.resolvePath(dirPath);
        if (!fs.existsSync(fullPath)) {
            return [];
        }
        const entries = fs.readdirSync(fullPath, { withFileTypes: true });
        return entries.map((entry) => {
            const entryPath = path.join(fullPath, entry.name);
            const stats = fs.statSync(entryPath);
            return {
                name: entry.name,
                path: entryPath,
                isDirectory: entry.isDirectory(),
                size: stats.size,
                modifiedAt: stats.mtime,
            };
        });
    }
    async exists(filePath) {
        const fullPath = this.resolvePath(filePath);
        return fs.existsSync(fullPath);
    }
    async mkdir(dirPath, recursive = true) {
        const fullPath = this.resolvePath(dirPath);
        fs.mkdirSync(fullPath, { recursive });
    }
    resolvePath(relativePath) {
        if (typeof relativePath !== "string") {
            throw new Error("Security Error: Path must be a string");
        }
        if (relativePath.includes("\0")) {
            throw new Error(`Security Error: Null byte injection detected in path: ${relativePath}`);
        }
        const absoluteRoot = path.resolve(this.rootDir);
        const fullPath = path.resolve(absoluteRoot, relativePath);
        const relative = path.relative(absoluteRoot, fullPath);
        if (relative.startsWith("..") || path.isAbsolute(relative)) {
            throw new Error(`Security Error: Path traversal detected for path: ${relativePath}`);
        }
        return fullPath;
    }
    async onMessage(message) {
        // Case-insensitive on the command keyword only -- lowercasing the whole
        // input previously mangled the extracted path too (`MyDir/MyFile.TXT`
        // became `mydir/myfile.txt`), breaking every case-sensitive path on a
        // case-sensitive filesystem.
        const input = String(message).trim();
        // read <path>
        const readMatch = input.match(/\bread\s+(\S+)/i);
        if (readMatch?.[1]) {
            try {
                const content = await this.readFile(readMatch[1]);
                return `[FileSystem] ${readMatch[1]}: ${content.slice(0, 200)}`;
            }
            catch {
                return `[FileSystem] Cannot read ${readMatch[1]}`;
            }
        }
        // list <path>
        const listMatch = input.match(/\blist\s+(\S+)/i);
        if (listMatch?.[1]) {
            const entries = await this.listDirectory(listMatch[1]);
            if (entries.length === 0)
                return `[FileSystem] Empty or not found: ${listMatch[1]}`;
            return `[FileSystem] ${listMatch[1]}: ${entries.slice(0, 10).map(e => e.name).join(', ')}`;
        }
        // exists <path>
        const existsMatch = input.match(/\bexists?\s+(\S+)/i);
        if (existsMatch?.[1]) {
            const ok = await this.exists(existsMatch[1]);
            return `[FileSystem] ${existsMatch[1]}: ${ok ? 'exists' : 'not found'}`;
        }
        return null;
    }
}
