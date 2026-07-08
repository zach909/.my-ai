export interface ProgrammingSkill {
    id: string;
    name: string;
    category: string;
    extensions: string[];
    keywords: string[];
    description: string;
    expertType: 'coding' | 'scripting' | 'markup' | 'data' | 'system' | 'functional' | 'esoteric';
}
export declare const PROGRAMMING_SKILLS: ProgrammingSkill[];
export declare function getSkillById(id: string): ProgrammingSkill | undefined;
export declare function getSkillsByCategory(category: string): ProgrammingSkill[];
export declare function getSkillsByExpertType(expertType: string): ProgrammingSkill[];
export declare function searchSkills(query: string): ProgrammingSkill[];
export declare function getAllCategories(): string[];
export declare function getAllExpertTypes(): string[];
