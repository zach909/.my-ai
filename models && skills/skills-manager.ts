import { PROGRAMMING_SKILLS, ProgrammingSkill, getSkillById, getSkillsByCategory, getSkillsByExpertType, searchSkills } from './programming-skills.js';
import { MoERouter } from './core/moe-router.js';
import { ExpertNetwork } from './core/expert.js';

export interface SkillActivation {
  skillId: string;
  skillName: string;
  activationLevel: number;
  confidence: number;
  timestamp: number;
}

export interface SkillUsageStats {
  skillId: string;
  skillName: string;
  usageCount: number;
  lastUsed: number;
  averageActivation: number;
  successRate: number;
}

export interface SkillsManagerConfig {
  maxActiveSkills: number;
  activationThreshold: number;
  decayRate: number;
  learningRate: number;
}

export class SkillsManager {
  private config: SkillsManagerConfig;
  private activeSkills: Map<string, SkillActivation>;
  private skillUsageStats: Map<string, SkillUsageStats>;
  private moeRouter: MoERouter | null;
  private expertNetworks: Map<string, ExpertNetwork>;
  private skillEmbeddings: Map<string, Float32Array>;

  constructor(config: Partial<SkillsManagerConfig> = {}) {
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

  connectMoERouter(router: MoERouter): void {
    this.moeRouter = router;
    this.registerSkillsAsExperts();
  }

  private initializeSkillStats(): void {
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

  private registerSkillsAsExperts(): void {
    if (!this.moeRouter) return;

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

  activateSkill(skillId: string, confidence: number = 0.5): boolean {
    const skill = getSkillById(skillId);
    if (!skill) return false;

    if (confidence < this.config.activationThreshold) return false;

    // Check if we have room for more active skills
    if (this.activeSkills.size >= this.config.maxActiveSkills) {
      // Deactivate least recently used skill
      const oldest = this.findLeastRecentlyUsedSkill();
      if (oldest) {
        this.activeSkills.delete(oldest.skillId);
      }
    }

    const activation: SkillActivation = {
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

  deactivateSkill(skillId: string): boolean {
    return this.activeSkills.delete(skillId);
  }

  getActiveSkills(): SkillActivation[] {
    return Array.from(this.activeSkills.values()).sort((a, b) => b.activationLevel - a.activationLevel);
  }

  getSkillActivation(skillId: string): SkillActivation | undefined {
    return this.activeSkills.get(skillId);
  }

  searchAndActivate(query: string, maxResults: number = 5): SkillActivation[] {
    const results = searchSkills(query).slice(0, maxResults);
    const activated: SkillActivation[] = [];

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

  private calculateSearchConfidence(query: string, skill: ProgrammingSkill): number {
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

  getSkillsByCategory(category: string): ProgrammingSkill[] {
    return getSkillsByCategory(category);
  }

  getSkillsByExpertType(expertType: string): ProgrammingSkill[] {
    return getSkillsByExpertType(expertType);
  }

  getAllSkills(): ProgrammingSkill[] {
    return PROGRAMMING_SKILLS;
  }

  getSkillUsageStats(skillId: string): SkillUsageStats | undefined {
    return this.skillUsageStats.get(skillId);
  }

  getAllUsageStats(): SkillUsageStats[] {
    return Array.from(this.skillUsageStats.values()).sort((a, b) => b.usageCount - a.usageCount);
  }

  private updateSkillUsageStats(skillId: string, activation: number, success: boolean): void {
    const stats = this.skillUsageStats.get(skillId);
    if (!stats) return;

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

  private findLeastRecentlyUsedSkill(): SkillActivation | undefined {
    let oldest: SkillActivation | undefined;
    let oldestTime = Infinity;

    for (const activation of this.activeSkills.values()) {
      if (activation.timestamp < oldestTime) {
        oldestTime = activation.timestamp;
        oldest = activation;
      }
    }

    return oldest;
  }

  decayActivations(): void {
    for (const [skillId, activation] of this.activeSkills) {
      activation.activationLevel *= (1 - this.config.decayRate);
      
      if (activation.activationLevel < this.config.activationThreshold) {
        this.deactivateSkill(skillId);
      }
    }
  }

  getSkillEmbedding(skillId: string): Float32Array | undefined {
    return this.skillEmbeddings.get(skillId);
  }

  setSkillEmbedding(skillId: string, embedding: Float32Array): void {
    this.skillEmbeddings.set(skillId, embedding);
  }

  generateSkillEmbedding(skill: ProgrammingSkill): Float32Array {
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

  routeToSkillExpert(input: Float32Array, skillId: string): Float32Array | null {
    const skill = getSkillById(skillId);
    if (!skill) return null;

    const expertNetwork = this.expertNetworks.get(skill.expertType);
    if (!expertNetwork) return null;

    return expertNetwork.forward(input);
  }

  getExpertNetwork(expertType: string): ExpertNetwork | undefined {
    return this.expertNetworks.get(expertType);
  }

  getAllExpertTypes(): string[] {
    return Array.from(this.expertNetworks.keys());
  }

  getRecommendations(context: string, maxRecommendations: number = 5): ProgrammingSkill[] {
    const lowerContext = context.toLowerCase();
    const scored: { skill: ProgrammingSkill; score: number }[] = [];

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

  exportActiveSkills(): { skills: SkillActivation[]; timestamp: number } {
    return {
      skills: this.getActiveSkills(),
      timestamp: Date.now()
    };
  }

  importActiveSkills(data: { skills: SkillActivation[]; timestamp: number }): void {
    this.activeSkills.clear();
    for (const activation of data.skills) {
      this.activeSkills.set(activation.skillId, activation);
    }
  }

  reset(): void {
    this.activeSkills.clear();
    this.initializeSkillStats();
  }

  getConfig(): SkillsManagerConfig {
    return { ...this.config };
  }

  updateConfig(config: Partial<SkillsManagerConfig>): void {
    this.config = { ...this.config, ...config };
  }
}
