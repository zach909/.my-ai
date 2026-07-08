import { EventEmitter } from 'node:events';
export interface LaunchedApp {
    id: string;
    name: string;
    command: string;
    pid: number | null;
    workspace: number;
    windowId: string | null;
    active: boolean;
    started: number;
}
export declare class AppLauncher extends EventEmitter {
    private apps;
    private nextId;
    constructor();
    launch(command: string, options?: {
        name?: string;
        workspace?: number;
        args?: string[];
        waitForWindow?: boolean;
        env?: Record<string, string>;
    }): LaunchedApp;
    launchOnAiDesktop(command: string, workspace: number, options?: {
        name?: string;
        args?: string[];
    }): LaunchedApp;
    private waitForWindow;
    moveToWorkspace(app: LaunchedApp, workspace: number): void;
    moveWindowById(windowId: string, workspace: number): void;
    bringToCurrentWorkspace(appIdOrWindowId: string): void;
    close(appId: string): boolean;
    closeAll(): void;
    getApp(appId: string): LaunchedApp | undefined;
    listApps(): LaunchedApp[];
    listActive(): LaunchedApp[];
    listOnWorkspace(workspace: number): LaunchedApp[];
    launchBrowser(url?: string, workspace?: number): LaunchedApp;
    launchTerminal(workspace?: number): LaunchedApp;
    launchFileManager(workspace?: number): LaunchedApp;
}
