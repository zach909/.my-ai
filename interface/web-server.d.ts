import { NeuroclawRunner } from './runner.js';
export declare class WebServer {
    private runner;
    private server;
    private port;
    constructor(runner: NeuroclawRunner);
    start(port?: number): Promise<void>;
    stop(): Promise<void>;
    getPort(): number;
    private setCorsHeaders;
    private sendJson;
    private sendHtml;
    private parseBody;
    private handleRequest;
}
