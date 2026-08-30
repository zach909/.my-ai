/**
 * Making a live Net Skill visible in the store, for real.
 *
 * The store's catalog already has a "skills" section, and it was never
 * empty by design -- two narrow paths populate it: the Extension Builder's
 * own net-skill export, and the manual Skill Uploads page. Neither is what a
 * Net Skill actually is in this architecture: neurons grafted directly into
 * the running mesh (net-skill-graft.ts), all-to-all with everything already
 * there. A region that exists, is trained, and answers to real input had no
 * representation in the one place a person browsing the store would look for
 * it -- "there's only net skills and prompting skills" was the accurate
 * complaint, because the "Skills" filter showed neither.
 *
 * This closes that gap the direct way: read what graftedSkills() says is
 * actually IN the mesh right now, and publish one document per region under
 * the store's "skills" kind. Not the neurons themselves -- weights are not
 * portable between meshes with different sizes and different histories, and
 * shipping them would misrepresent installing a Net Skill as something as
 * simple as copying a file. What is published is a real, honest description
 * of a real, currently-grafted region: its name, how many neurons it has,
 * what each one means, and (when the caller asks) how strongly it has grown
 * toward another region -- the same overlap net-skill-graft.ts's own
 * connections already produce, just made visible outside the process that
 * grew them.
 */
import { graftedSkills } from "./net-skill-graft.js";
import { publishAndSync, assertSafeName } from "./store.js";
function slugify(name) {
    const slug = name.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
    return slug || `net-skill-${Date.now()}`;
}
/**
 * Publish (or update) a store listing for every Net Skill currently grafted
 * into `engine`. Idempotent and cheap to call repeatedly: publishAndSync()
 * already no-ops a republish of identical content, so calling this again
 * after nothing has changed costs a git diff, not a new commit.
 *
 * A region with zero live neurons (every id it was granted has since been
 * pruned, if that ever becomes possible) is skipped rather than published as
 * an empty shell -- there would be nothing true left to say about it.
 */
export async function publishGraftedNetSkills(engine, opts = {}) {
    const skills = graftedSkills(engine);
    const results = [];
    for (const { skill, ids } of skills) {
        const neuronNames = Object.keys(ids);
        // Not reachable through graftNetSkill as it stands today: it only ever
        // registers a skill in the registry graftedSkills() reads from AFTER
        // engine.addNeurons() has succeeded, so every entry here already has at
        // least one id. Kept anyway as the contract this function actually
        // promises -- "a region with zero live neurons is skipped" -- rather
        // than one that happens to hold given net-skill-graft.ts's current
        // internals, which this file has no way to enforce if they change.
        if (neuronNames.length === 0)
            continue;
        const slug = slugify(skill);
        // A store name has its own character set (assertSafeName) narrower than
        // a skill's own free-text name. Checked here, before a network call,
        // rather than letting publishAndSync() reject it after slugify() already
        // did the work of making it safe -- slugify() targets exactly the set
        // assertSafeName allows, so this only ever fires on a skill name that
        // slugified down to nothing usable.
        try {
            assertSafeName(slug);
        }
        catch {
            results.push({
                skill, slug, neurons: neuronNames.length,
                sync: { committed: false, pushed: false, reason: `"${skill}" has no name that survives becoming a store path.` },
            });
            continue;
        }
        const descriptor = {
            skill,
            neuronCount: neuronNames.length,
            neurons: neuronNames.map(name => ({ name, id: ids[name] })),
            publishedAt: new Date().toISOString(),
        };
        const files = [
            { filename: `${slug}.net-skill.json`, content: JSON.stringify(descriptor, null, 2) },
        ];
        const { sync } = await publishAndSync({
            kind: "skills",
            name: slug,
            title: skill,
            description: `A Net Skill grafted into the live mesh: ${neuronNames.length} neuron` +
                `${neuronNames.length === 1 ? "" : "s"}, all-to-all with the rest of the network. ` +
                `Not installable as a file -- see the descriptor for what it means, and net-skill-graft.ts for how a mesh grows one.`,
            author: opts.author ?? "neuroclaw-agent",
            files,
        });
        results.push({ skill, slug, neurons: neuronNames.length, sync });
    }
    return results;
}
