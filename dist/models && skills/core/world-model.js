/**
 * World Model (Spec Section 4).
 *
 * A thin, spec-aligned vocabulary layer over KnowledgeGraph rather than a
 * second, duplicate graph. KnowledgeGraph (Section 4's own header comment
 * calls it out as the "semantic structure the spec asks for") already
 * stores typed relations with a confidence score (uncertainty) and a
 * superseded flag (continuous updating as new information arrives) --
 * exactly what a world model needs structurally. What it does not give
 * callers is a stable, self-documenting way to say "this is a person",
 * "this caused that", or "this happened at this time" without hand-rolling
 * relation-type strings at every call site. WorldModel is that layer.
 */
const ENTITY_CATEGORIES = [
    "object", "person", "place", "physical-system", "software", "organization", "event",
];
export class WorldModel {
    constructor(graph) {
        this.graph = graph;
    }
    /** Register (or update) an entity as belonging to one of Section 4's categories. */
    registerEntity(name, category, definition = "") {
        const concept = this.graph.addConcept(name, definition);
        this.graph.relate(name, "is", category);
        return concept;
    }
    /** All currently-believed entities of a given category. */
    getEntitiesByCategory(category) {
        return this.graph.instancesOf(category, "is");
    }
    /** The category `name` is currently believed to belong to, if registered. */
    getCategory(name) {
        const rels = this.graph.current(name, "is");
        const hit = rels.find(r => ENTITY_CATEGORIES.includes(r.concept.name));
        return hit?.concept.name;
    }
    /**
     * Record a causal relationship (Section 4: "cause and effect"), with a
     * confidence reflecting how certain the system is (Section 4:
     * "uncertainty") -- an input to be reasoned about, not asserted as fact.
     */
    recordCause(cause, effect, confidence = 1) {
        return this.graph.relate(cause, "causes", effect, { confidence });
    }
    /** What is currently believed to cause `effect`. */
    getCausesOf(effect) {
        return this.graph.instancesOf(effect, "causes");
    }
    /** What `cause` is currently believed to cause. */
    getEffectsOf(cause) {
        return this.graph.current(cause, "causes").map(n => n.concept);
    }
    /**
     * Record when an event occurred (Section 4: "time"). Registers the event
     * entity itself if it isn't already known.
     */
    recordEventTime(eventName, occurredAt) {
        if (!this.getCategory(eventName))
            this.registerEntity(eventName, "event");
        return this.graph.relate(eventName, "occurred-at", String(occurredAt));
    }
    /** When `eventName` is currently believed to have occurred, if known.
     * The most recently recorded time wins if it was recorded more than once. */
    getEventTime(eventName) {
        const rels = this.graph.current(eventName, "occurred-at");
        const ts = rels[rels.length - 1]?.concept.name;
        return ts !== undefined ? Number(ts) : undefined;
    }
    /**
     * How confident the world model currently is in a specific
     * (subject, relation, object) fact -- Section 4's "uncertainty".
     * Undefined if the fact isn't currently asserted at all. When the same
     * fact has been asserted more than once (Section 4: "continuously
     * updated as the AI receives new information") without an explicit
     * supersede(), the most recent assertion wins -- current() itself
     * returns every non-superseded match in insertion order, oldest first.
     */
    getConfidence(subject, relType, object) {
        const targetId = this.graph.getConcept(object)?.id;
        if (!targetId)
            return undefined;
        const rels = this.graph.current(subject, relType).filter(r => r.relation.to === targetId);
        return rels.length > 0 ? rels[rels.length - 1].relation.confidence : undefined;
    }
}
