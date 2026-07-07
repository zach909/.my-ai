import * as fs from "fs";
import * as path from "path";
import { BasePlugin } from "../plugin_manager/sdk";
export class FileSystemPlugin extends BasePlugin {
    rootDir = process.cwd();
    constructor(definition) {
        super(definition);
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
        if (path.isAbsolute(relativePath)) {
            return relativePath;
        }
        return path.resolve(this.rootDir, relativePath);
    }
    async onMessage(message) {
        const input = String(message).toLowerCase().trim();
        // read <path>
        const readMatch = input.match(/\bread\s+(\S+)/);
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
        const listMatch = input.match(/\blist\s+(\S+)/);
        if (listMatch?.[1]) {
            const entries = await this.listDirectory(listMatch[1]);
            if (entries.length === 0)
                return `[FileSystem] Empty or not found: ${listMatch[1]}`;
            return `[FileSystem] ${listMatch[1]}: ${entries.slice(0, 10).map(e => e.name).join(', ')}`;
        }
        // exists <path>
        const existsMatch = input.match(/\bexists?\s+(\S+)/);
        if (existsMatch?.[1]) {
            const ok = await this.exists(existsMatch[1]);
            return `[FileSystem] ${existsMatch[1]}: ${ok ? 'exists' : 'not found'}`;
        }
        return null;
    }
}
