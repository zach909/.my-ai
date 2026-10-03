/**
 * Message -> tool call, for the tools the network has not been taught to pick.
 *
 * A tool neuron firing is the intended way for OneBrain to use a tool
 * (tool-neurons.ts), but it only does so once something has taught the mesh to
 * route activity there. Until then a person who types "run `ls`" would get
 * nothing. This is the scaffold under that: it reads a message that
 * explicitly names a tool call and returns which tool and with what
 * arguments. It deliberately recognises only explicit phrasings -- backticked
 * commands, "read file X", "write file X with Y" -- and returns null for
 * anything that merely sounds related, because a wrong guess here is a real
 * command run on a real machine.
 *
 * It does not call anything and it does not bypass access: the caller hands
 * the result to ToolNeuronLayer.dispatch(), which drives the tool's neuron
 * and enforces the same Access page capability the network's own calls do.
 */

export interface RoutedToolCall {
  plugin: string;
  tool: string;
  args: Record<string, unknown>;
  /** The phrasing that matched, so a reply can say why this tool was chosen. */
  why: string;
}

const LEAD = String.raw`^\s*(?:please\s+|can you\s+|could you\s+)?`;

function clean(value: string): string {
  return value.trim().replace(/^["'`]|["'`]$/g, "").trim();
}

/** The call a message explicitly asks for, or null when it does not ask for one. */
export function routeToolCall(message: string): RoutedToolCall | null {
  const text = message.trim();
  if (!text || text.length > 4000) return null;
  let m: RegExpMatchArray | null;

  // run `ls -la` / execute `npm test`
  m = text.match(new RegExp(`${LEAD}(?:run|execute)\\s+(?:the\\s+)?(?:command\\s+)?\`([^\`]+)\``, "i"));
  if (m) return { plugin: "terminal", tool: "run", args: { command: m[1].trim() }, why: "a backticked command after run/execute" };

  // run command: ls -la
  m = text.match(new RegExp(`${LEAD}(?:run|execute)\\s+(?:the\\s+)?command\\s*[:\\s]\\s*(.+)$`, "i"));
  if (m && clean(m[1])) return { plugin: "terminal", tool: "run", args: { command: clean(m[1]) }, why: "\"run command\" followed by a command" };

  // $ ls -la
  m = text.match(/^\$\s+(\S.*)$/);
  if (m) return { plugin: "terminal", tool: "run", args: { command: m[1].trim() }, why: "a line starting with \"$ \"" };

  // write file notes.txt with hello world
  m = text.match(new RegExp(`${LEAD}write\\s+(?:a\\s+)?file\\s+(\\S+)\\s+(?:with|containing)\\s+(?:the\\s+)?(?:content\\s+|text\\s+)?([\\s\\S]+)$`, "i"));
  if (m) return { plugin: "terminal", tool: "write_file", args: { path: clean(m[1]), content: m[2] }, why: "\"write file <path> with <content>\"" };

  // read file notes.txt / show the file ./a.md / cat file x
  m = text.match(new RegExp(`${LEAD}(?:read|show|open|cat)\\s+(?:me\\s+)?(?:the\\s+)?file\\s+(\\S+)\\s*$`, "i"));
  if (m) return { plugin: "terminal", tool: "read_file", args: { path: clean(m[1]) }, why: "\"read file <path>\"" };

  // list directory src / list the folder ./docs / ls src
  m = text.match(new RegExp(`${LEAD}(?:list|show)\\s+(?:the\\s+)?(?:directory|dir|folder|files in)\\s+(\\S+)\\s*$`, "i"))
    ?? text.match(/^\s*ls\s+(\S+)\s*$/i);
  if (m) return { plugin: "terminal", tool: "list_directory", args: { path: clean(m[1]) }, why: "a directory listing request" };

  // list terminals / list my background terminals
  if (/^\s*(?:please\s+)?list\s+(?:my\s+|the\s+|all\s+)?(?:background\s+)?terminals\s*[.!?]?\s*$/i.test(text)) {
    return { plugin: "terminal", tool: "list_terminals", args: {}, why: "\"list terminals\"" };
  }

  // list windows / what windows are open
  if (/^\s*(?:please\s+)?(?:list\s+(?:my\s+|the\s+|all\s+)?(?:open\s+)?windows|what windows are open)\s*[.!?]?\s*$/i.test(text)) {
    return { plugin: "desktop", tool: "list_windows", args: {}, why: "\"list windows\"" };
  }

  // take a screenshot
  if (/^\s*(?:please\s+)?take\s+a\s+screenshot\s*[.!?]?\s*$/i.test(text)) {
    return { plugin: "desktop", tool: "screenshot", args: {}, why: "\"take a screenshot\"" };
  }

  return null;
}
