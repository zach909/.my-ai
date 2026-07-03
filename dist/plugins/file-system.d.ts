import type { PluginDefinition } from "../plugin_manager/types.js";
import { BasePlugin } from "../plugin_manager/sdk.js";
export interface FileEntry {
    name: string;
    path: string;
    isDirectory: boolean;
    size: number;
    modifiedAt: Date;
}
export declare class FileSystemPlugin extends BasePlugin {
    private rootDir;
    constructor(definition: PluginDefinition);
    setRootDir(dir: string): void;
    readFile(filePath: string): Promise<string>;
    writeFile(filePath: string, content: string): Promise<void>;
    deleteFile(filePath: string): Promise<boolean>;
    listDirectory(dirPath: string): Promise<FileEntry[]>;
    exists(filePath: string): Promise<boolean>;
    mkdir(dirPath: string, recursive?: boolean): Promise<void>;
    private resolvePath;
    onMessage(message: unknown): Promise<unknown>;
}
