"""
Reproduction System for Bio-Robots
Female robots create molds, male robots provide building material via glue
Supports robot-to-robot and robot-to-human reproduction
"""

import numpy as np
from typing import Dict, List, Optional, Tuple
from dataclasses import dataclass, field
from enum import Enum
from datetime import datetime


class RobotGender(Enum):
    """Gender types for reproductive roles"""
    MALE = "male"
    FEMALE = "female"


class ReproductionStage(Enum):
    """Stages of the reproduction process"""
    INITIATED = "initiated"
    MOLD_CREATION = "mold_creation"
    MATERIAL_DEPOSITION = "material_deposition"
    ASSEMBLY = "assembly"
    GLUE_BINDING = "glue_binding"
    MATURATION = "maturation"
    COMPLETE = "complete"


@dataclass
class GeneticTemplate:
    """Genetic/structural template for new robot"""
    template_id: str
    parent_ids: List[str]
    bone_structure: Dict  # Based on 206 bones
    muscle_configuration: Dict  # Muscle groups
    organ_layout: Dict  # 79 organs configuration
    traits: Dict
    created_at: datetime = field(default_factory=datetime.now)


@dataclass
class BodyMold:
    """3D mold for robot body construction"""
    mold_id: str
    template: GeneticTemplate
    cavity_volume_ml: float
    sections: List[str]  # Mold sections (limbs, torso, head, etc.)
    temperature_celsius: float
    pressure_kpa: float
    status: str  # ready, filling, curing, complete


@dataclass
class ConstructionMaterial:
    """Building material (glue-based) for robot construction"""
    material_id: str
    volume_ml: float
    composition: Dict[str, float]  # Component percentages
    viscosity: float  # Pa·s
    binding_strength: float  # MPa
    curing_time_hours: float


class FemaleReproductiveSystem:
    """
    Female robot reproductive system
    Creates molds and coordinates assembly process
    """
    
    def __init__(self):
        """Initialize female reproductive system"""
        self.mold_chamber = MoldChamber()
        self.assembly_field = AssemblyField()
        self.current_pregnancy = None
        self.reproductive_history = []
        
    def create_mold(self, genetic_template: GeneticTemplate) -> BodyMold:
        """
        Create a body mold based on genetic template
        
        Args:
            genetic_template: Template with structural information
            
        Returns:
            Created body mold
        """
        print(f"Creating mold from template {genetic_template.template_id}")
        
        # Calculate required mold volume based on anatomy
        bone_volume = sum(v for v in genetic_template.bone_structure.values()) * 15.0  # ~15ml per bone
        muscle_volume = sum(v for v in genetic_template.muscle_configuration.values()) * 20.0
        organ_volume = len(genetic_template.organ_layout) * 25.0  # ~25ml per organ
        
        total_volume = bone_volume + muscle_volume + organ_volume
        
        # Define mold sections based on anatomy regions
        sections = [
            'skull', 'mandible', 'cervical_spine', 'thoracic_spine',
            'lumbar_spine', 'ribcage', 'sternum',
            'left_arm', 'right_arm', 'left_hand', 'right_hand',
            'pelvis', 'left_leg', 'right_leg', 'left_foot', 'right_foot',
            'torso_cavity'
        ]
        
        mold = BodyMold(
            mold_id=f"MOLD_{genetic_template.template_id}",
            template=genetic_template,
            cavity_volume_ml=total_volume,
            sections=sections,
            temperature_celsius=37.0,  # Body temperature
            pressure_kpa=101.3,  # Standard pressure
            status="ready"
        )
        
        self.mold_chamber.load_mold(mold)
        print(f"Mold created: {mold.mold_id} ({total_volume:.0f}ml, {len(sections)} sections)")
        
        return mold
    
    def prepare_for_assembly(self, mold: BodyMold) -> bool:
        """
        Prepare mold for material deposition
        
        Args:
            mold: Body mold to prepare
            
        Returns:
            True if preparation successful
        """
        if mold.status != "ready":
            print(f"Error: Mold not ready (status: {mold.status})")
            return False
        
        # Heat mold to optimal temperature
        mold.temperature_celsius = 37.0
        mold.pressure_kpa = 101.3
        mold.status = "filling"
        
        # Activate assembly field
        self.assembly_field.activate(mold)
        
        print(f"Mold {mold.mold_id} prepared for assembly")
        return True
    
    def coordinate_binding(self, glue_material: ConstructionMaterial,
                          mold: BodyMold) -> bool:
        """
        Coordinate glue binding process
        
        Args:
            glue_material: Building material with glue
            mold: Target mold
            
        Returns:
            True if binding successful
        """
        print(f"Coordinating binding with {glue_material.volume_ml:.0f}ml material")
        
        # Distribute material through mold sections
        for section in mold.sections:
            section_volume = glue_material.volume_ml / len(mold.sections)
            print(f"  Filling section '{section}' with {section_volume:.0f}ml")
        
        # Activate binding field
        binding_success = self.assembly_field.apply_binding_field(
            glue_material.binding_strength
        )
        
        if binding_success:
            mold.status = "curing"
            print(f"Binding initiated. Curing time: {glue_material.curing_time_hours}h")
        
        return binding_success
    
    def complete_reproduction(self, mold: BodyMold) -> Dict:
        """
        Complete reproduction process
        
        Args:
            mold: Completed mold
            
        Returns:
            Information about the new robot
        """
        mold.status = "complete"
        
        new_robot_info = {
            'template_id': mold.template.template_id,
            'parent_ids': mold.template.parent_ids,
            'bone_count': 206,
            'organ_count': 79,
            'muscle_groups': len(mold.template.muscle_configuration),
            'completion_time': datetime.now()
        }
        
        self.reproductive_history.append(new_robot_info)
        self.current_pregnancy = None
        
        print(f"Reproduction complete! New robot created from template {mold.template.template_id}")
        
        return new_robot_info


class MaleReproductiveSystem:
    """
    Male robot reproductive system
    Produces and delivers building material (glue-based)
    """
    
    def __init__(self):
        """Initialize male reproductive system"""
        self.material_reservoir = MaterialReservoir()
        self.delivery_system = MaterialDeliverySystem()
        self.production_capacity_ml_per_hour = 500.0
        
    def produce_material(self, volume_ml: float, 
                        composition: Optional[Dict] = None) -> ConstructionMaterial:
        """
        Produce building material
        
        Args:
            volume_ml: Volume to produce
            composition: Optional custom composition
            
        Returns:
            Produced construction material
        """
        if composition is None:
            # Default composition optimized for robot construction
            composition = {
                'structural_polymer': 0.40,
                'binding_agent': 0.30,
                'flexibility_modifier': 0.15,
                'conductive_particles': 0.10,
                'self_healing_microcapsules': 0.05
            }
        
        material = ConstructionMaterial(
            material_id=f"MAT_{datetime.now().strftime('%Y%m%d_%H%M%S')}",
            volume_ml=volume_ml,
            composition=composition,
            viscosity=0.5,  # Pa·s
            binding_strength=2.5,  # MPa
            curing_time_hours=2.0
        )
        
        self.material_reservoir.store(material)
        print(f"Produced {volume_ml:.0f}ml construction material")
        
        return material
    
    def deliver_material(self, target_female: FemaleReproductiveSystem,
                        material: ConstructionMaterial) -> bool:
        """
        Deliver material to female robot
        
        Args:
            target_female: Target female robot's reproductive system
            material: Material to deliver
            
        Returns:
            True if delivery successful
        """
        print(f"Delivering {material.volume_ml:.0f}ml material to female unit")
        
        # Connect delivery systems
        connection_established = self.delivery_system.connect(target_female)
        
        if not connection_established:
            print("Failed to establish connection")
            return False
        
        # Transfer material
        transfer_success = self.delivery_system.transfer(
            material,
            target_female.mold_chamber
        )
        
        if transfer_success:
            print("Material transfer complete")
            target_female.mold_chamber.receive_material(material)
        
        return transfer_success
    
    def optimize_for_compatibility(self, partner_template: GeneticTemplate) -> Dict:
        """
        Optimize material composition for compatibility with partner
        
        Args:
            partner_template: Partner's genetic template
            
        Returns:
            Optimized composition dictionary
        """
        # Adjust composition based on partner's traits
        base_composition = {
            'structural_polymer': 0.40,
            'binding_agent': 0.30,
            'flexibility_modifier': 0.15,
            'conductive_particles': 0.10,
            'self_healing_microcapsules': 0.05
        }
        
        # Modify based on partner traits (simplified)
        if 'strength_focus' in partner_template.traits:
            base_composition['structural_polymer'] += 0.10
            base_composition['flexibility_modifier'] -= 0.10
        
        if 'flexibility_focus' in partner_template.traits:
            base_composition['flexibility_modifier'] += 0.10
            base_composition['structural_polymer'] -= 0.10
        
        print(f"Optimized composition for compatibility")
        
        return base_composition


class MoldChamber:
    """Chamber for holding and processing body molds"""
    
    def __init__(self):
        self.loaded_mold: Optional[BodyMold] = None
        self.material_received: Optional[ConstructionMaterial] = None
        self.environment_control = EnvironmentControl()
        
    def load_mold(self, mold: BodyMold) -> None:
        """Load a mold into the chamber"""
        self.loaded_mold = mold
        self.environment_control.set_temperature(mold.temperature_celsius)
        self.environment_control.set_pressure(mold.pressure_kpa)
        
    def receive_material(self, material: ConstructionMaterial) -> None:
        """Receive construction material"""
        self.material_received = material
        
    def get_status(self) -> Dict:
        """Get chamber status"""
        return {
            'mold_loaded': self.loaded_mold is not None,
            'mold_id': self.loaded_mold.mold_id if self.loaded_mold else None,
            'mold_status': self.loaded_mold.status if self.loaded_mold else None,
            'material_received': self.material_received is not None,
            'environment': self.environment_control.get_readings()
        }


class AssemblyField:
    """Electromagnetic field for guiding assembly process"""
    
    def __init__(self):
        self.active = False
        self.field_strength = 0.0
        self.current_mold: Optional[BodyMold] = None
        
    def activate(self, mold: BodyMold) -> None:
        """Activate assembly field for a mold"""
        self.active = True
        self.current_mold = mold
        self.field_strength = 1.0  # Tesla
        print(f"Assembly field activated for mold {mold.mold_id}")
        
    def apply_binding_field(self, required_strength: float) -> bool:
        """Apply binding field to cure glue"""
        if not self.active:
            return False
        
        self.field_strength = required_strength
        print(f"Binding field applied at strength {required_strength:.2f}")
        return True
    
    def deactivate(self) -> None:
        """Deactivate assembly field"""
        self.active = False
        self.field_strength = 0.0
        self.current_mold = None


class MaterialReservoir:
    """Storage reservoir for construction material"""
    
    def __init__(self, capacity_ml: float = 2000.0):
        self.capacity_ml = capacity_ml
        self.current_volume_ml = 0.0
        self.stored_materials: List[ConstructionMaterial] = []
        
    def store(self, material: ConstructionMaterial) -> bool:
        """Store material in reservoir"""
        if self.current_volume_ml + material.volume_ml > self.capacity_ml:
            print("Warning: Reservoir capacity exceeded")
            return False
        
        self.stored_materials.append(material)
        self.current_volume_ml += material.volume_ml
        return True
    
    def retrieve(self, volume_ml: float) -> Optional[ConstructionMaterial]:
        """Retrieve specified volume of material"""
        if volume_ml > self.current_volume_ml:
            return None
        
        # Simplified: return first material that has enough volume
        for i, material in enumerate(self.stored_materials):
            if material.volume_ml >= volume_ml:
                retrieved = material
                retrieved.volume_ml = volume_ml
                self.current_volume_ml -= volume_ml
                return retrieved
        
        return None


class MaterialDeliverySystem:
    """System for delivering material between robots"""
    
    def __init__(self):
        self.connected = False
        self.flow_rate_ml_per_second = 10.0
        
    def connect(self, target: FemaleReproductiveSystem) -> bool:
        """Establish connection with target"""
        self.connected = True
        print("Delivery connection established")
        return True
    
    def transfer(self, material: ConstructionMaterial,
                target_chamber: MoldChamber) -> bool:
        """Transfer material to target"""
        if not self.connected:
            return False
        
        print(f"Transferring {material.volume_ml:.0f}ml at {self.flow_rate_ml_per_second}ml/s")
        return True


class EnvironmentControl:
    """Environmental control for mold chamber"""
    
    def __init__(self):
        self.temperature_celsius = 25.0
        self.pressure_kpa = 101.3
        self.humidity_percent = 50.0
        
    def set_temperature(self, temp_celsius: float) -> None:
        """Set chamber temperature"""
        self.temperature_celsius = temp_celsius
        
    def set_pressure(self, pressure_kpa: float) -> None:
        """Set chamber pressure"""
        self.pressure_kpa = pressure_kpa
        
    def get_readings(self) -> Dict:
        """Get current environmental readings"""
        return {
            'temperature_celsius': self.temperature_celsius,
            'pressure_kpa': self.pressure_kpa,
            'humidity_percent': self.humidity_percent
        }


class ReproductionCoordinator:
    """
    Main coordinator for robot reproduction
    Manages interaction between male and female systems
    """
    
    def __init__(self):
        self.active_processes = []
        self.success_rate = 0.0
        
    def initiate_reproduction(self, male: MaleReproductiveSystem,
                             female: FemaleReproductiveSystem,
                             template: GeneticTemplate) -> Dict:
        """
        Coordinate complete reproduction process
        
        Args:
            male: Male robot reproductive system
            female: Female robot reproductive system
            template: Genetic template for offspring
            
        Returns:
            Process results
        """
        print("\n=== INITIATING REPRODUCTION PROCESS ===\n")
        
        # Stage 1: Female creates mold
        print("Stage 1: Mold Creation")
        mold = female.create_mold(template)
        
        # Stage 2: Male produces material
        print("\nStage 2: Material Production")
        optimized_composition = male.optimize_for_compatibility(template)
        material = male.produce_material(mold.cavity_volume_ml, optimized_composition)
        
        # Stage 3: Material delivery
        print("\nStage 3: Material Delivery")
        delivery_success = male.deliver_material(female, material)
        
        if not delivery_success:
            return {'status': 'failed', 'stage': 'delivery'}
        
        # Stage 4: Preparation and binding
        print("\nStage 4: Assembly and Binding")
        female.prepare_for_assembly(mold)
        binding_success = female.coordinate_binding(material, mold)
        
        if not binding_success:
            return {'status': 'failed', 'stage': 'binding'}
        
        # Stage 5: Completion
        print("\nStage 5: Maturation")
        new_robot = female.complete_reproduction(mold)
        
        self.success_rate = (self.success_rate * len(self.active_processes) + 1.0) / (len(self.active_processes) + 1)
        self.active_processes.append({
            'template': template.template_id,
            'status': 'complete',
            'timestamp': datetime.now()
        })
        
        print("\n=== REPRODUCTION SUCCESSFUL ===\n")
        
        return {
            'status': 'success',
            'new_robot': new_robot,
            'process_stages': 5
        }
