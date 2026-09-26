export declare const ONEBRAIN_ID = "onebrain";
export declare const ONEBRAIN_NAME = "OneBrain";
export interface SelfExtensionEdge { from: number; to: number; weight: number; fromValue?: number; toValue?: number; }
export declare function parseSelfExtension(json: string | object): SelfExtensionEdge[];
export declare function emptyOneBrain(now?: number): any;
export declare function foldEdges(model: any, edges: SelfExtensionEdge[], now?: number): any;
export declare function quantizeOneBrain(model: any): any;
export declare function readOneBrain(dir: string): { model: any; meta: any } | null;
export declare function writeOneBrain(dir: string, model: any, prevMeta?: any, sources?: string[], now?: number): string;
