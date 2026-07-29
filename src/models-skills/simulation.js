const SYNONYMS = {
    create: ["make", "build", "generate", "produce", "form"],
    find: ["locate", "search", "discover", "identify", "detect"],
    explain: ["describe", "clarify", "define", "elaborate", "outline"],
    fix: ["repair", "resolve", "correct", "address", "patch"],
    help: ["assist", "support", "aid", "guide", "enable"],
    analyze: ["examine", "evaluate", "inspect", "assess", "review"],
    update: ["modify", "change", "edit", "revise", "alter"],
    remove: ["delete", "eliminate", "erase", "drop", "clear"],
    write: ["compose", "author", "draft", "pen", "inscribe"],
    read: ["peruse", "study", "scan", "review", "browse"],
    run: ["execute", "start", "launch", "operate", "invoke"],
    test: ["verify", "validate", "check", "trial", "examine"],
    build: ["construct", "assemble", "compile", "forge", "erect"],
    configure: ["setup", "initialize", "tune", "adjust", "calibrate"],
    implement: ["execute", "realize", "deploy", "install", "apply"],
    optimize: ["improve", "enhance", "refine", "streamline", "tune"],
    debug: ["troubleshoot", "diagnose", "fix", "resolve", "correct"],
    search: ["seek", "hunt", "explore", "scan", "probe"],
    generate: ["produce", "create", "output", "yield", "render"],
    transform: ["convert", "change", "morph", "transmute", "reshape"],
    integrate: ["merge", "combine", "unify", "incorporate", "blend"],
};
const EXAMPLES = {
    create: ["create a file", "create a function", "create a new project"],
    find: ["find all errors", "find the definition", "find related code"],
    explain: ["explain how it works", "explain the error", "explain the design"],
    fix: ["fix the bug", "fix the test", "fix the import"],
    help: ["help me understand", "help configure", "help debug"],
    analyze: ["analyze the code", "analyze performance", "analyze dependencies"],
    update: ["update the config", "update the version", "update the logic"],
    remove: ["remove the duplicate", "remove unused code", "remove the reference"],
    write: ["write documentation", "write unit tests", "write a script"],
    read: ["read the input", "read the file", "read the documentation"],
    run: ["run the simulation", "run the tests", "run the application"],
    test: ["test the function", "test the endpoint", "test the integration"],
    build: ["build the project", "build the binary", "build the container"],
    configure: ["configure the server", "configure the environment", "configure the settings"],
    implement: ["implement the feature", "implement the protocol", "implement the interface"],
    optimize: ["optimize the query", "optimize the algorithm", "optimize the pipeline"],
    debug: ["debug the crash", "debug the memory leak", "debug the race condition"],
    search: ["search the database", "search for patterns", "search the logs"],
    generate: ["generate the report", "generate the graph", "generate the output data"],
    transform: ["transform the shape", "transform the data", "transform the coordinates"],
    integrate: ["integrate the api", "integrate the modules", "integrate the systems"],
};
const DEFINITIONS = {
    create: "bring something into existence by authoring or generating it",
    find: "locate or identify a specific element within a search space",
    explain: "make the meaning or mechanism of something clear and understandable",
    fix: "restore correct behavior by identifying and resolving a defect",
    help: "provide assistance or guidance toward accomplishing a goal",
    analyze: "examine methodically to understand structure, behavior, or properties",
    update: "modify existing content to reflect a new state or requirement",
    remove: "eliminate or detach an element from its context",
    write: "compose text or code for a specific purpose",
    read: "access and interpret stored information or data",
    run: "execute a process or program to produce a result",
    test: "verify correctness or performance through systematic trials",
    build: "assemble components into a complete functional unit",
    configure: "arrange settings or parameters to achieve desired behavior",
    implement: "realize a specification as a concrete working artifact",
    optimize: "improve efficiency or effectiveness through refinement",
    debug: "identify and eliminate errors or unwanted behaviors",
    search: "systematically examine a space to find specific elements",
    generate: "produce or create something from a set of inputs or rules",
    transform: "change the form, structure, or state of something",
    integrate: "combine separate elements into a unified whole",
};
function extractVerb(input) {
    const lower = input.toLowerCase();
    for (const verb of Object.keys(SYNONYMS)) {
        if (lower.includes(verb))
            return verb;
    }
    const verbPattern = /^(?:please\s+)?(\w+)/i;
    const m = lower.match(verbPattern);
    return m ? (m[1] ?? "do") : "do";
}
function extractNoun(input) {
    const stopWords = new Set(["the", "a", "an", "this", "that", "these", "those", "my", "your", "our", "its", "i", "we", "you", "it", "me", "us"]);
    const words = input.replace(/[^\w\s]/g, " ").split(/\s+/).filter(w => w.length > 2 && !stopWords.has(w.toLowerCase()));
    const verb = extractVerb(input);
    const filtered = words.filter(w => w.toLowerCase() !== verb);
    return filtered[0] ?? input.split(/\s+/)[0] ?? input;
}
function extractWhoPhrase(input) {
    const whoMatch = input.match(/(?:by|for|with|from|to)\s+([A-Za-z][A-Za-z\s]{1,30}?)(?:\s|$|[,.])/i);
    if (whoMatch)
        return whoMatch[1].trim();
    const userMatch = input.match(/\b(user|system|agent|developer|client|server|bot|human|machine)\b/i);
    return userMatch ? userMatch[1] : "user";
}
function extractWhyPhrase(input) {
    const whyMatch = input.match(/(?:because|so that|in order to|to|for)\s+(.{5,60})$/i);
    if (whyMatch)
        return whyMatch[1].trim();
    return "to accomplish the stated goal";
}
function extractHowPhrase(input) {
    const howMatch = input.match(/(?:by|using|via|with|through)\s+([A-Za-z][\w\s]{2,50})(?:[,.]|$)/i);
    if (howMatch)
        return howMatch[1].trim();
    return "through direct action";
}
function extractWherePhrase(input) {
    const whereMatch = input.match(/(?:in|at|on|inside|within|from)\s+([\w/.\-:]+(?:\s+[\w/.\-:]+){0,3})/i);
    if (whereMatch)
        return whereMatch[1].trim();
    return "in the current context";
}
function extractWhenPhrase(input) {
    const whenMatch = input.match(/(?:when|after|before|once|until|during)\s+(.{3,50})(?:[,.]|$)/i);
    if (whenMatch)
        return whenMatch[1].trim();
    return "now";
}
function buildWH(text, fallbackVerb) {
    const key = fallbackVerb.toLowerCase();
    return {
        text,
        synonyms: SYNONYMS[key] ?? [text],
        examples: EXAMPLES[key] ?? [text],
        definition: DEFINITIONS[key] ?? text,
    };
}
function computeConfidence(input, verb) {
    const hasKnownVerb = verb in SYNONYMS;
    const wordCount = input.split(/\s+/).length;
    const base = hasKnownVerb ? 0.75 : 0.45;
    const lengthBonus = Math.min(wordCount / 20, 0.2);
    return Math.min(base + lengthBonus, 0.99);
}
function crossCheckPlan(plan, intent) {
    const checks = [];
    if (plan.length === 0) {
        checks.push("WARN: empty plan generated");
        return checks;
    }
    checks.push(`Plan covers ${plan.length} step(s)`);
    checks.push(`Core concept identified: "${intent.coreConcept}"`);
    checks.push(`Primary action: ${intent.dimensions.what.text}`);
    checks.push(`Actor: ${intent.dimensions.who.text}`);
    checks.push(`Purpose: ${intent.dimensions.why.text}`);
    if (intent.confidence < 0.5) {
        checks.push("WARN: low confidence in intent analysis — consider clarifying input");
    }
    const uniqueSteps = new Set(plan);
    if (uniqueSteps.size < plan.length) {
        checks.push("WARN: duplicate steps detected in plan");
    }
    return checks;
}
function detectErrors(plan, intent) {
    const errors = [];
    if (!intent.rawInput || intent.rawInput.trim().length === 0) {
        errors.push("ERROR: empty input");
    }
    if (intent.confidence < 0.3) {
        errors.push("ERROR: intent confidence too low to generate reliable output");
    }
    if (plan.length > 20) {
        errors.push("WARN: plan has excessive steps — may be over-specified");
    }
    return errors;
}
function buildOutput(plan, intent) {
    const lines = [];
    lines.push(`To ${intent.dimensions.what.text}:`);
    for (let i = 0; i < plan.length; i++) {
        lines.push(`${i + 1}. ${plan[i]}`);
    }
    return lines.join("\n");
}
function buildPlan(intent) {
    const plan = [];
    const { what, who, how, why, where, when } = intent.dimensions;
    plan.push(`Understand the goal: ${intent.rawInput}`);
    plan.push(`Identify the action: ${what.text}`);
    if (who.text !== "user") {
        plan.push(`Involve actor: ${who.text}`);
    }
    plan.push(`Determine approach: ${how.text}`);
    plan.push(`Locate target: ${where.text}`);
    plan.push(`Timing: ${when.text}`);
    plan.push(`Purpose: ${why.text}`);
    const verb = extractVerb(intent.rawInput);
    if (verb in SYNONYMS) {
        const syns = SYNONYMS[verb];
        plan.push(`Alternative approaches: ${syns.slice(0, 3).join(", ")}`);
    }
    plan.push(`Execute: ${what.text} on ${intent.coreConcept}`);
    plan.push(`Verify the result matches the stated purpose`);
    return plan;
}
export class SimulationEngine {
    analyzeIntent(input) {
        const trimmed = input.trim();
        const verb = extractVerb(trimmed);
        const noun = extractNoun(trimmed);
        const whatText = `${verb} ${noun}`.trim();
        const whoText = extractWhoPhrase(trimmed);
        const whyText = extractWhyPhrase(trimmed);
        const howText = extractHowPhrase(trimmed);
        const whereText = extractWherePhrase(trimmed);
        const whenText = extractWhenPhrase(trimmed);
        return {
            rawInput: trimmed,
            dimensions: {
                what: buildWH(whatText, verb),
                who: buildWH(whoText, verb),
                why: buildWH(whyText, verb),
                how: buildWH(howText, verb),
                where: buildWH(whereText, verb),
                when: buildWH(whenText, verb),
            },
            coreConcept: noun,
            confidence: computeConfidence(trimmed, verb),
        };
    }
    simulate(intent) {
        const plan = buildPlan(intent);
        const crossChecks = crossCheckPlan(plan, intent);
        const errors = detectErrors(plan, intent);
        const output = buildOutput(plan, intent);
        return { plan, crossChecks, errors, output };
    }
    review(result) {
        if (result.errors.some(e => e.startsWith("ERROR:"))) {
            const errorDetail = result.errors.filter(e => e.startsWith("ERROR:")).join("; ");
            return {
                status: "error",
                feedback: errorDetail,
            };
        }
        const hasWarnings = result.errors.some(e => e.startsWith("WARN:")) ||
            result.crossChecks.some(c => c.startsWith("WARN:"));
        if (hasWarnings) {
            const warnings = [
                ...result.errors.filter(e => e.startsWith("WARN:")),
                ...result.crossChecks.filter(c => c.startsWith("WARN:")),
            ];
            return {
                status: "continue",
                feedback: warnings.join("; "),
            };
        }
        return {
            status: "done",
            feedback: `Plan complete with ${result.plan.length} steps and ${result.crossChecks.length} validations`,
        };
    }
    run(input, maxIterations = 3) {
        let intent = this.analyzeIntent(input);
        let simResult = this.simulate(intent);
        let reviewOutcome = this.review(simResult);
        let iterations = 1;
        let finalOutput = simResult.output;
        const fullPlan = [...simResult.plan];
        while (reviewOutcome.status === "continue" && iterations < maxIterations) {
            const refinedInput = reviewOutcome.correctedOutput ?? input;
            intent = this.analyzeIntent(refinedInput);
            simResult = this.simulate(intent);
            reviewOutcome = this.review(simResult);
            iterations++;
            finalOutput = simResult.output;
            for (const step of simResult.plan) {
                if (!fullPlan.includes(step)) {
                    fullPlan.push(step);
                }
            }
        }
        if (reviewOutcome.status === "error") {
            finalOutput = reviewOutcome.feedback;
        }
        else if (reviewOutcome.correctedOutput) {
            finalOutput = reviewOutcome.correctedOutput;
        }
        return {
            input,
            output: finalOutput,
            plan: fullPlan,
            iterations,
            saved: reviewOutcome.status !== "error",
        };
    }
}
