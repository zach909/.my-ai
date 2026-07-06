import { PROGRAMMING_SKILLS, getSkillById, getSkillsByCategory, getSkillsByExpertType, searchSkills } from './programming-skills.js';
import { ExpertNetwork } from './core/expert.js';
export class SkillsManager {
    config;
    activeSkills;
    skillUsageStats;
    moeRouter;
    expertNetworks;
    skillEmbeddings;
    constructor(config = {}) {
        this.config = {
            maxActiveSkills: config.maxActiveSkills ?? 10,
            activationThreshold: config.activationThreshold ?? 0.3,
            decayRate: config.decayRate ?? 0.01,
            learningRate: config.learningRate ?? 0.1,
            ...config
        };
        this.activeSkills = new Map();
        this.skillUsageStats = new Map();
        this.moeRouter = null;
        this.expertNetworks = new Map();
        this.skillEmbeddings = new Map();
        this.initializeSkillStats();
    }
    connectMoERouter(router) {
        this.moeRouter = router;
        this.registerSkillsAsExperts();
    }
    initializeSkillStats() {
        for (const skill of PROGRAMMING_SKILLS) {
            this.skillUsageStats.set(skill.id, {
                skillId: skill.id,
                skillName: skill.name,
                usageCount: 0,
                lastUsed: 0,
                averageActivation: 0,
                successRate: 1.0
            });
        }
    }
    registerSkillsAsExperts() {
        if (!this.moeRouter)
            return;
        // Register skills as experts in MoE based on expert type
        const expertTypes = new Set(PROGRAMMING_SKILLS.map(s => s.expertType));
        for (const expertType of expertTypes) {
            const skills = getSkillsByExpertType(expertType);
            if (skills.length > 0) {
                // Create an expert network for this type
                const expertId = this.moeRouter.addExpert({
                    id: `expert_${expertType}`,
                    name: `${expertType} Expert`,
                    specialization: expertType
                });
                // Store the expert network reference
                const expertNetwork = new ExpertNetwork(expertId, {
                    inputDim: 768,
                    hiddenDim: 512,
                    outputDim: 768,
                    learningRate: this.config.learningRate
                });
                this.expertNetworks.set(expertType, expertNetwork);
            }
        }
    }
    activateSkill(skillId, confidence = 0.5) {
        const skill = getSkillById(skillId);
        if (!skill)
            return false;
        if (confidence < this.config.activationThreshold)
            return false;
        // Check if we have room for more active skills
        if (this.activeSkills.size >= this.config.maxActiveSkills) {
            // Deactivate least recently used skill
            const oldest = this.findLeastRecentlyUsedSkill();
            if (oldest) {
                this.activeSkills.delete(oldest.skillId);
            }
        }
        const activation = {
            skillId: skill.id,
            skillName: skill.name,
            activationLevel: confidence,
            confidence,
            timestamp: Date.now()
        };
        this.activeSkills.set(skillId, activation);
        this.updateSkillUsageStats(skillId, confidence, true);
        return true;
    }
    deactivateSkill(skillId) {
        return this.activeSkills.delete(skillId);
    }
    getActiveSkills() {
        return Array.from(this.activeSkills.values()).sort((a, b) => b.activationLevel - a.activationLevel);
    }
    getSkillActivation(skillId) {
        return this.activeSkills.get(skillId);
    }
    searchAndActivate(query, maxResults = 5) {
        const results = searchSkills(query).slice(0, maxResults);
        const activated = [];
        for (const skill of results) {
            const confidence = this.calculateSearchConfidence(query, skill);
            if (this.activateSkill(skill.id, confidence)) {
                const activation = this.activeSkills.get(skill.id);
                if (activation) {
                    activated.push(activation);
                }
            }
        }
        return activated;
    }
    calculateSearchConfidence(query, skill) {
        const lowerQuery = query.toLowerCase();
        let score = 0;
        // Exact name match
        if (skill.name.toLowerCase() === lowerQuery) {
            score += 1.0;
        }
        // Partial name match
        else if (skill.name.toLowerCase().includes(lowerQuery)) {
            score += 0.7;
        }
        // Keyword matches
        for (const keyword of skill.keywords) {
            if (keyword.toLowerCase().includes(lowerQuery)) {
                score += 0.3;
            }
        }
        // Category match
        if (skill.category.toLowerCase().includes(lowerQuery)) {
            score += 0.2;
        }
        return Math.min(1.0, score);
    }
    getSkillsByCategory(category) {
        return getSkillsByCategory(category);
    }
    getSkillsByExpertType(expertType) {
        return getSkillsByExpertType(expertType);
    }
    getAllSkills() {
        return PROGRAMMING_SKILLS;
    }
    getSkillUsageStats(skillId) {
        return this.skillUsageStats.get(skillId);
    }
    getAllUsageStats() {
        return Array.from(this.skillUsageStats.values()).sort((a, b) => b.usageCount - a.usageCount);
    }
    updateSkillUsageStats(skillId, activation, success) {
        const stats = this.skillUsageStats.get(skillId);
        if (!stats)
            return;
        stats.usageCount++;
        stats.lastUsed = Date.now();
        // Update average activation (exponential moving average)
        stats.averageActivation = stats.averageActivation * (1 - this.config.learningRate) +
            activation * this.config.learningRate;
        // Update success rate (exponential moving average)
        const successValue = success ? 1 : 0;
        stats.successRate = stats.successRate * (1 - this.config.learningRate) +
            successValue * this.config.learningRate;
    }
    findLeastRecentlyUsedSkill() {
        let oldest;
        let oldestTime = Infinity;
        for (const activation of this.activeSkills.values()) {
            if (activation.timestamp < oldestTime) {
                oldestTime = activation.timestamp;
                oldest = activation;
            }
        }
        return oldest;
    }
    decayActivations() {
        for (const [skillId, activation] of this.activeSkills) {
            activation.activationLevel *= (1 - this.config.decayRate);
            if (activation.activationLevel < this.config.activationThreshold) {
                this.deactivateSkill(skillId);
            }
        }
    }
    getSkillEmbedding(skillId) {
        return this.skillEmbeddings.get(skillId);
    }
    setSkillEmbedding(skillId, embedding) {
        this.skillEmbeddings.set(skillId, embedding);
    }
    generateSkillEmbedding(skill) {
        const embedding = new Float32Array(768);
        const name = skill.name.toLowerCase();
        const keywords = skill.keywords.map(k => k.toLowerCase());
        const description = skill.description.toLowerCase();
        const category = skill.category.toLowerCase();
        const expertType = skill.expertType.toLowerCase();
        // Simple hash-based embedding generation
        for (let i = 0; i < embedding.length; i++) {
            const charCode = name.charCodeAt(i % name.length);
            const keywordCode = keywords.length > 0 ? keywords[i % keywords.length].charCodeAt(0) : 0;
            const descCode = description.charCodeAt(i % description.length);
            const catCode = category.charCodeAt(i % category.length);
            const typeCode = expertType.charCodeAt(i % expertType.length);
            embedding[i] = ((charCode + keywordCode + descCode + catCode + typeCode) % 256) / 256 * 2 - 1;
        }
        this.skillEmbeddings.set(skill.id, embedding);
        return embedding;
    }
    routeToSkillExpert(input, skillId) {
        const skill = getSkillById(skillId);
        if (!skill)
            return null;
        const expertNetwork = this.expertNetworks.get(skill.expertType);
        if (!expertNetwork)
            return null;
        return expertNetwork.forward(input);
    }
    getExpertNetwork(expertType) {
        return this.expertNetworks.get(expertType);
    }
    getAllExpertTypes() {
        return Array.from(this.expertNetworks.keys());
    }
    getRecommendations(context, maxRecommendations = 5) {
        const lowerContext = context.toLowerCase();
        const scored = [];
        for (const skill of PROGRAMMING_SKILLS) {
            let score = 0;
            // Check if skill name appears in context
            if (lowerContext.includes(skill.name.toLowerCase())) {
                score += 0.5;
            }
            // Check keywords
            for (const keyword of skill.keywords) {
                if (lowerContext.includes(keyword.toLowerCase())) {
                    score += 0.2;
                }
            }
            // Check category
            if (lowerContext.includes(skill.category.toLowerCase())) {
                score += 0.1;
            }
            // Boost based on usage stats
            const stats = this.skillUsageStats.get(skill.id);
            if (stats && stats.usageCount > 0) {
                score += Math.min(0.3, stats.usageCount * 0.01);
            }
            if (score > 0) {
                scored.push({ skill, score });
            }
        }
        scored.sort((a, b) => b.score - a.score);
        return scored.slice(0, maxRecommendations).map(s => s.skill);
    }
    exportActiveSkills() {
        return {
            skills: this.getActiveSkills(),
            timestamp: Date.now()
        };
    }
    importActiveSkills(data) {
        this.activeSkills.clear();
        for (const activation of data.skills) {
            this.activeSkills.set(activation.skillId, activation);
        }
    }
    reset() {
        this.activeSkills.clear();
        this.initializeSkillStats();
    }
    getConfig() {
        return { ...this.config };
    }
    updateConfig(config) {
        this.config = { ...this.config, ...config };
    }
}
