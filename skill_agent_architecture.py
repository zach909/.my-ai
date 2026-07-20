"""
Skill-Based AI Agent Architecture Prototype

This module implements the core concept where skills are dynamic plugins
that plug into an AI Agent through a central Skill System.
"""

from abc import ABC, abstractmethod
from typing import List, Dict, Any, Optional
from dataclasses import dataclass, field
import json

# -----------------------------------------------------------------------------
# 1. Core Interfaces & Data Structures
# -----------------------------------------------------------------------------

@dataclass
class Tool:
    """Represents a tool available to a skill (e.g., File Editor, Web Search)."""
    name: str
    description: str
    
    def execute(self, **kwargs) -> Any:
        print(f"  [Tool: {self.name}] Executing with args: {kwargs}")
        return f"Result from {self.name}"

@dataclass
class SkillDefinition:
    """The metadata and configuration for a skill."""
    name: str
    description: str
    keywords: List[str]  # Used for matching user requests
    tools_required: List[str]
    instructions: str
    
    def to_dict(self) -> Dict:
        return {
            "name": self.name,
            "description": self.description,
            "keywords": self.keywords,
            "tools_required": self.tools_required,
            "instructions": self.instructions
        }

class Skill(ABC):
    """
    Abstract Base Class for all Skills.
    A skill is a capability package containing instructions, knowledge, and workflows.
    """
    
    @property
    @abstractmethod
    def definition(self) -> SkillDefinition:
        """Returns the metadata describing this skill."""
        pass

    @abstractmethod
    def execute(self, context: Dict[str, Any]) -> str:
        """
        The main entry point when the agent activates this skill.
        Returns the result of the skill's workflow.
        """
        pass

    def get_tools(self) -> Dict[str, Tool]:
        """Returns the specific tools this skill needs."""
        tools = {}
        for tool_name in self.definition.tools_required:
            # In a real system, these would be complex objects connected to APIs
            tools[tool_name] = Tool(name=tool_name, description=f"Tool for {self.definition.name}")
        return tools

# -----------------------------------------------------------------------------
# 2. Concrete Skill Implementations
# -----------------------------------------------------------------------------

class CodingSkill(Skill):
    """Skill for analyzing and fixing code."""
    
    @property
    def definition(self) -> SkillDefinition:
        return SkillDefinition(
            name="CodingSkill",
            description="Analyzes, writes, and fixes code in various languages.",
            keywords=["code", "fix", "bug", "program", "script", "developer", "github"],
            tools_required=["FileReader", "FileEditor", "TestRunner"],
            instructions="1. Read the project files.\n2. Identify the error.\n3. Apply the fix.\n4. Run tests."
        )

    def execute(self, context: Dict[str, Any]) -> str:
        print(f"\n--- Activating Skill: {self.definition.name} ---")
        print(f"Instruction: {self.definition.instructions}")
        
        tools = self.get_tools()
        # Simulate workflow
        tools["FileReader"].execute(path=context.get('path', '.'))
        tools["FileEditor"].execute(changes="fixed bug")
        tools["TestRunner"].execute(suite="unit_tests")
        
        return "Code analysis complete. Bugs fixed and tests passed."

class ResearchSkill(Skill):
    """Skill for gathering and analyzing information."""
    
    @property
    def definition(self) -> SkillDefinition:
        return SkillDefinition(
            name="ResearchSkill",
            description="Searches the web and synthesizes technical reports.",
            keywords=["research", "search", "analyze", "report", "study", "information"],
            tools_required=["WebSearch", "DataAnalyzer", "DocumentWriter"],
            instructions="1. Define search queries.\n2. Gather sources.\n3. Synthesize findings.\n4. Write report."
        )

    def execute(self, context: Dict[str, Any]) -> str:
        print(f"\n--- Activating Skill: {self.definition.name} ---")
        print(f"Instruction: {self.definition.instructions}")
        
        tools = self.get_tools()
        tools["WebSearch"].execute(query=context.get('topic', 'AI'))
        tools["DataAnalyzer"].execute(data="search_results")
        tools["DocumentWriter"].execute(content="synthesized_report.md")
        
        return "Research complete. Report generated."

class SkillBuilderSkill(Skill):
    """
    A meta-skill: Its job is to create new skills and install them into the system.
    This enables the agent to expand its own capabilities.
    """
    
    @property
    def definition(self) -> SkillDefinition:
        return SkillDefinition(
            name="SkillBuilderSkill",
            description="Creates and installs new skills into the agent's library.",
            keywords=["create skill", "new capability", "install plugin", "extend agent", 
                      "understand", "blender", "3d", "modeling", "add skill"],
            tools_required=["SkillGenerator", "LibraryManager"],
            instructions="1. Analyze required capability.\n2. Generate skill definition.\n3. Register with Skill System."
        )

    def execute(self, context: Dict[str, Any]) -> str:
        print(f"\n--- Activating Skill: {self.definition.name} ---")
        print("Analyzing request to create a new capability...")
        
        # Simulate creating a new skill dynamically
        new_skill_name = context.get('new_skill_name', 'GenericSkill')
        new_skill_keywords = context.get('keywords', ['generic'])
        
        print(f"Generating definition for: {new_skill_name}")
        
        # In a real system, this would generate a class or load a module
        # Here we simulate returning the definition to be registered
        new_def = SkillDefinition(
            name=new_skill_name,
            description=f"Dynamically created skill for {new_skill_name}",
            keywords=new_skill_keywords,
            tools_required=["GenericTool"],
            instructions="Execute dynamic workflow."
        )
        
        # Return the new definition so the Agent can register it
        return json.dumps({"action": "REGISTER_NEW_SKILL", "definition": new_def.to_dict()})

# -----------------------------------------------------------------------------
# 3. The Skill System (Capability Manager)
# -----------------------------------------------------------------------------

class SkillSystem:
    """
    The central manager that handles skill registration, discovery, and activation.
    Acts as the plugin layer between the Agent Brain and the Tools.
    """
    
    def __init__(self):
        self.skill_library: Dict[str, Skill] = {}
        self.active_skills: List[str] = []
        
    def register_skill(self, skill: Skill):
        """Installs a new skill into the library."""
        name = skill.definition.name
        self.skill_library[name] = skill
        print(f"[SkillSystem] Registered skill: {name}")
        
    def discover_skill(self, user_request: str) -> Optional[List[Skill]]:
        """
        Determines which skills are relevant to the user's request based on keywords.
        Returns a list of matching skills.
        """
        request_lower = user_request.lower()
        matched_skills = []
        
        for skill in self.skill_library.values():
            # Check if any keyword from the skill matches the request
            if any(keyword in request_lower for keyword in skill.definition.keywords):
                matched_skills.append(skill)
                
        return matched_skills if matched_skills else None

    def activate_skill(self, skill_name: str):
        """Marks a skill as active."""
        if skill_name in self.skill_library:
            self.active_skills.append(skill_name)
            
    def deactivate_all(self):
        """Resets active skills after a task."""
        self.active_skills = []

# -----------------------------------------------------------------------------
# 4. The AI Agent (The Brain)
# -----------------------------------------------------------------------------

class AIAgent:
    """
    The central intelligence.
    It receives goals, consults the Skill System to find capabilities,
    and orchestrates the execution.
    """
    
    def __init__(self):
        self.skill_system = SkillSystem()
        self.memory = []
        
        # Initialize with base skills
        self.install_default_skills()
        
    def install_default_skills(self):
        """Boots up the agent with core capabilities."""
        self.skill_system.register_skill(CodingSkill())
        self.skill_system.register_skill(ResearchSkill())
        self.skill_system.register_skill(SkillBuilderSkill())
        
    def install_new_skill(self, definition_dict: Dict):
        """
        Called by the SkillBuilderSkill to dynamically add a new skill.
        """
        # In a real system, this would dynamically load a class based on the dict
        # For this prototype, we acknowledge the registration
        print(f"[Agent] Installing new skill from definition: {definition_dict['name']}")
        # Note: In a full implementation, we would instantiate a generic skill class here
        # using the provided definition.
        
    def process_request(self, user_request: str):
        """
        Main loop: Understand -> Select Skills -> Execute -> Evaluate
        """
        print(f"\n{'='*60}")
        print(f"USER REQUEST: '{user_request}'")
        print(f"{'='*60}")
        
        # 1. Understand & Select
        print("\n[Agent Brain] Analyzing request for required capabilities...")
        relevant_skills = self.skill_system.discover_skill(user_request)
        
        if not relevant_skills:
            print("No suitable skills found. Request cannot be fulfilled.")
            return
            
        print(f"Matched Skills: {[s.definition.name for s in relevant_skills]}")
        
        # 2. Activate & Execute
        results = []
        for skill in relevant_skills:
            self.skill_system.activate_skill(skill.definition.name)
            
            # Execute the skill's workflow
            result = skill.execute(context={"request": user_request})
            
            # Check if the result indicates a new skill should be installed (Meta-capability)
            if "REGISTER_NEW_SKILL" in result:
                payload = json.loads(result)
                self.install_new_skill(payload['definition'])
                result += " (New skill installed successfully)"
                
            results.append(result)
            self.skill_system.deactivate_all() # Deactivate after use
            
        # 3. Final Output
        print(f"\n[Agent] Task Completed. Results:")
        for i, res in enumerate(results, 1):
            print(f"  {i}. {res}")

# -----------------------------------------------------------------------------
# 5. Demonstration
# -----------------------------------------------------------------------------

if __name__ == "__main__":
    # Initialize the Agent
    agent = AIAgent()
    
    # Scenario 1: Single Skill (Coding)
    agent.process_request("Analyze this GitHub project and fix the broken code.")
    
    # Scenario 2: Single Skill (Research)
    agent.process_request("Research the latest AI architectures and write a summary.")
    
    # Scenario 3: Multi-Skill (Research + Writing implied in Research for this demo)
    # Note: In a complex graph, the agent would chain these. 
    # Here we just show discovery of multiple if keywords overlap or sequential calls.
    
    # Scenario 4: Dynamic Expansion (The Skill Builder)
    agent.process_request("I want the AI to understand Blender. Create a new skill for 3D modeling.")
    
    # Verify the system state (Conceptual)
    print("\n[System Status] Agent capability library expanded.")
