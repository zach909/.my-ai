/**
 * Web search through a SearXNG instance (open source metasearch engine).
 *
 * The instance is the operator's choice, set with NEUROCLAW_SEARXNG_URL, and
 * defaults to one on this machine (http://127.0.0.1:8080). Not a public
 * instance: those rate-limit, often switch off the JSON format this reads,
 * and would send every query off the machine to a host nobody here chose.
 * The URL is configuration, never taken from a message, so it is fetched
 * directly rather than through BrowserPlugin.fetchUrl()'s private-host block.
 *
 * Search is optional. Anything wrong -- no instance running, JSON disabled,
 * a timeout -- returns no results and says why once, so a person can fix it.
 */
let warned = false;
export function searxngBaseUrl() {
    const raw = (process.env.NEUROCLAW_SEARXNG_URL ?? "").trim() || "http://127.0.0.1:8080";
    return (/^https?:\/\//i.test(raw) ? raw : `http://${raw}`).replace(/\/+$/, "");
}
function warnOnce(reason) {
    if (warned)
        return;
    warned = true;
    console.warn(`[search] No web results: ${reason}. Web search needs a SearXNG instance with the json format enabled `
        + `(search.formats: [html, json] in its settings.yml). Using ${searxngBaseUrl()}; set NEUROCLAW_SEARXNG_URL to change it.`);
}
export async function searxngSearch(query, maxResults = 8) {
    const base = searxngBaseUrl();
    try {
        const res = await fetch(`${base}/search?q=${encodeURIComponent(query)}&format=json`, {
            headers: { Accept: "application/json", "User-Agent": "NeuroClaw" },
            signal: AbortSignal.timeout(8000),
        });
        if (!res.ok) {
            warnOnce(res.status === 403 ? `${base} answered 403 (the json format is probably disabled there)` : `${base} answered ${res.status}`);
            return [];
        }
        const data = await res.json();
        if (!Array.isArray(data.results))
            return [];
        const hits = [];
        for (const r of data.results) {
            if (typeof r.title !== "string" || typeof r.url !== "string" || !/^https?:\/\//i.test(r.url))
                continue;
            hits.push({ title: r.title, url: r.url, snippet: typeof r.content === "string" ? r.content : "" });
            if (hits.length >= maxResults)
                break;
        }
        return hits;
    }
    catch (e) {
        warnOnce(`could not reach ${base} (${e instanceof Error ? e.message : String(e)})`);
        return [];
    }
}
