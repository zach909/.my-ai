"""
Reproductive System - Production of new organisms.

Capable of combining design information and producing new organisms
through gradual construction from templates.
"""

from typing import Dict, List, Optional, Any


class ReproductiveSystem:
    """Reproductive system for creating new organisms."""
    
    def __init__(self, organism):
        self.organism = organism
        self.reproducing = False
        self.current_process: Optional[Dict] = None
        self.design_template: Optional[Dict] = None
        
    def initiate_reproduction(self, partner_data: Optional[Dict] = None) -> bool:
        """Begin reproduction process"""
        if self.reproducing:
            return False
            
        # Generate or combine design template
        self.design_template = self._generate_design_template(partner_data)
        
        self.current_process = {
            "stage": "template_generation",
            "progress": 0.0,
            "partner_data": partner_data
        }
        self.reproducing = True
        return True
        
    def _generate_design_template(self, partner_data: Optional[Dict]) -> Dict:
        """Generate design template for new organism"""
        base_template = {
            "skeletal_structure": "humanoid_standard",
            "muscular_configuration": "bilateral_symmetric",
            "neural_architecture": "elastic_mesh_v1",
            "energy_system_type": "multi_converter",
            "sex_configuration": self.organism.sex_config.value
        }
        
        if partner_data:
            # Combine designs (simplified)
            for key in partner_data.get("design_modifications", {}):
                base_template[key] = partner_data["design_modifications"][key]
                
        return base_template
        
    def is_reproducing(self) -> bool:
        return self.reproducing
        
    def update(self, delta_time: float):
        """Update reproduction process"""
        if not self.reproducing or not self.current_process:
            return
            
        stages = ["template_generation", "scaffold_creation", 
                  "system_assembly", "maturation"]
        current_stage_idx = stages.index(self.current_process["stage"])
        
        self.current_process["progress"] += delta_time * 0.01
        
        if self.current_process["progress"] >= 1.0:
            if current_stage_idx < len(stages) - 1:
                self.current_process["stage"] = stages[current_stage_idx + 1]
                self.current_process["progress"] = 0.0
            else:
                # Reproduction complete
                self.reproducing = False
                self.current_process = None
                
    def get_status(self) -> Dict[str, Any]:
        return {
            "reproducing": self.reproducing,
            "current_stage": self.current_process["stage"] if self.current_process else None,
            "progress": self.current_process["progress"] if self.current_process else 0.0
        }
