#!/usr/bin/env node
import { CLI } from "./cli.js";
import { WebServer } from "./web-server.js";
export declare function bootstrap(): Promise<CLI>;
/**
 * Start the HTTP backend the Python bridge (interface/server.py) proxies to.
 * This is what makes "collapse Python/TS duplication through server.py" real:
 * server.py delegates /api/chat and /api/status here instead of falling back
 * to its own canned responses.
 */
export declare function startWeb(port: number): Promise<WebServer>;
