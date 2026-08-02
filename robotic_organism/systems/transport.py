"""
Transport System - Stage 5 of development

Multi-fluid internal transport network (artificial circulatory system).

Instead of one substance doing everything, uses different internal materials for different jobs:
- Energy fluid
- Repair material  
- Structural material
- Waste removal

Damage detection routes appropriate repair material to damage location.
"""

from enum import Enum
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple
import math


class FluidType(Enum):
    """Types of fluids transported through the organism."""
    ENERGY_FLUID = "energy_fluid"  # Carries chemical energy
    REPAIR_SEALANT = "repair_sealant"  # Seals punctures
    REPAIR_ADHESIVE = "repair_adhesive"  # Structural adhesive
    REPAIR_REINFORCE = "repair_reinforce"  # Reinforces damaged areas
    STRUCTURAL_MATERIAL = "structural_material"  # For building new structures
    WASTE_FLUID = "waste_fluid"  # Removes waste products
    COOLANT = "coolant"  # Thermal management


@dataclass
class TransportNode:
    """A junction point in the transport network."""
    id: str
    x: float = 0.0
    y: float = 0.0
    z: float = 0.0
    connections: List[str] = field(default_factory=list)
    
    # Fluid reservoirs at this node
    reservoirs: Dict[FluidType, float] = field(default_factory=dict)
    
    def distance_to(self, other: 'TransportNode') -> float:
        """Calculate 3D distance to another node."""
        return math.sqrt(
            (self.x - other.x)**2 +
            (self.y - other.y)**2 +
            (self.z - other.z)**2
        )


@dataclass
class TransportChannel:
    """A channel connecting two nodes."""
    id: str
    node_a: str
    node_b: str
    length: float = 1.0
    diameter: float = 0.01  # meters
    max_flow_rate: float = 0.001  # m³/s
    
    # Current flow
    current_flow: Dict[FluidType, float] = field(default_factory=dict)
    
    def get_capacity(self) -> float:
        """Get volume capacity of channel in m³."""
        return math.pi * (self.diameter/2)**2 * self.length


@dataclass 
class TransportPump:
    """A pump that moves fluid through channels."""
    id: str
    location_node: str
    connected_channel: str
    max_pressure: float = 100000.0  # Pascals
    efficiency: float = 0.85
    
    active: bool = True
    flow_rate: float = 0.0  # Current flow rate m³/s
    direction: int = 1  # 1 or -1 for direction


@dataclass
class DamageReport:
    """Report of damage requiring repair material delivery."""
    location: Tuple[float, float, float]
    damage_type: str  # puncture, tear, structural, electrical
    severity: float  # 0.0 to 1.0
    timestamp: float
    nearest_node: Optional[str] = None
    repair_material: Optional[FluidType] = None


class TransportSystem:
    """
    Multi-fluid internal transport network.
    
    Functions like a biological circulatory system but with:
    - Multiple specialized fluids
    - Active pumping
    - Damage-responsive routing
    - Distributed reservoirs
    """
    
    def __init__(self):
        # Network structure
        self.nodes: Dict[str, TransportNode] = {}
        self.channels: Dict[str, TransportChannel] = {}
        self.pumps: Dict[str, TransportPump] = {}
        
        # Fluid management
        self.total_fluid: Dict[FluidType, float] = {ft: 0.0 for ft in FluidType}
        self.fluid_reserves: Dict[FluidType, float] = {
            FluidType.ENERGY_FLUID: 0.001,  # m³
            FluidType.REPAIR_SEALANT: 0.0005,
            FluidType.REPAIR_ADHESIVE: 0.0005,
            FluidType.REPAIR_REINFORCE: 0.0005,
            FluidType.STRUCTURAL_MATERIAL: 0.001,
            FluidType.WASTE_FLUID: 0.0,
            FluidType.COOLANT: 0.002
        }
        
        # Damage tracking
        self.active_damage: List[DamageReport] = []
        self.repair_routes: List[Dict] = []
        
        # Statistics
        self.total_pumped = {ft: 0.0 for ft in FluidType}
        self.repairs_completed = 0
        
        # Create default body network
        self._create_default_network()
    
    def _create_default_network(self):
        """Create a basic transport network for a small organism."""
        # Spine nodes
        for i in range(5):
            node_id = f"spine_{i}"
            self.add_node(node_id, x=0.0, y=i*0.1, z=0.0)
        
        # Connect spine
        for i in range(4):
            self.add_channel(f"spine_ch_{i}", f"spine_{i}", f"spine_{i+1}")
        
        # Branch nodes (simplified limbs)
        branches = [
            ("limb_L1", 0.05, 0.1, 0.0),
            ("limb_R1", -0.05, 0.1, 0.0),
            ("limb_L2", 0.05, 0.3, 0.0),
            ("limb_R2", -0.05, 0.3, 0.0),
        ]
        
        for node_id, x, y, z in branches:
            self.add_node(node_id, x=x, y=y, z=z)

        # Connect each branch node to its nearest spine node -- without this,
        # limb_L1/limb_R1/limb_L2/limb_R2 are added to self.nodes but never
        # appear in any TransportChannel, so their `connections` list stays
        # empty forever. _find_path_to_node()'s BFS only ever walks a node's
        # `connections`, starting from "spine_0", so any damage report whose
        # nearest_node resolves to one of these isolated limb nodes (i.e.
        # most damage locations off the spine's x=0 axis) can never find a
        # route, silently failing repair-material delivery.
        branch_spine_links = [
            ("limb_L1", "spine_1"),
            ("limb_R1", "spine_1"),
            ("limb_L2", "spine_3"),
            ("limb_R2", "spine_3"),
        ]
        for branch_id, spine_id in branch_spine_links:
            self.add_channel(f"{branch_id}_ch", branch_id, spine_id)

        # Add pumps along spine
        for i in range(3):
            pump_id = f"pump_{i}"
            channel_id = f"spine_ch_{i}"
            self.add_pump(pump_id, f"spine_{i}", channel_id)
        
        # Initialize node reservoirs
        for node in self.nodes.values():
            for ft in FluidType:
                node.reservoirs[ft] = 0.0
    
    def add_node(self, node_id: str, x: float, y: float, z: float):
        """Add a transport node to the network."""
        self.nodes[node_id] = TransportNode(id=node_id, x=x, y=y, z=z)
    
    def add_channel(self, channel_id: str, node_a: str, node_b: str, 
                    diameter: float = 0.01):
        """Add a channel between two nodes."""
        if node_a not in self.nodes or node_b not in self.nodes:
            raise ValueError("Both nodes must exist")
        
        node_a_obj = self.nodes[node_a]
        node_b_obj = self.nodes[node_b]
        length = node_a_obj.distance_to(node_b_obj)
        
        self.channels[channel_id] = TransportChannel(
            id=channel_id,
            node_a=node_a,
            node_b=node_b,
            length=max(length, 0.01),  # Minimum length
            diameter=diameter
        )
        
        # Update node connections
        node_a_obj.connections.append(channel_id)
        node_b_obj.connections.append(channel_id)
    
    def add_pump(self, pump_id: str, location_node: str, connected_channel: str):
        """Add a pump at a node controlling a channel."""
        self.pumps[pump_id] = TransportPump(
            id=pump_id,
            location_node=location_node,
            connected_channel=connected_channel
        )
    
    def report_damage(self, x: float, y: float, z: float, 
                      damage_type: str, severity: float, timestamp: float):
        """Report damage that needs repair material delivery."""
        # Find nearest node
        nearest = None
        min_dist = float('inf')
        
        for node_id, node in self.nodes.items():
            dist = math.sqrt((node.x - x)**2 + (node.y - y)**2 + (node.z - z)**2)
            if dist < min_dist:
                min_dist = dist
                nearest = node_id
        
        # Determine required repair material
        material_map = {
            'puncture': FluidType.REPAIR_SEALANT,
            'tear': FluidType.REPAIR_ADHESIVE,
            'structural': FluidType.REPAIR_REINFORCE,
            'electrical': FluidType.STRUCTURAL_MATERIAL
        }
        repair_material = material_map.get(damage_type, FluidType.REPAIR_ADHESIVE)
        
        damage = DamageReport(
            location=(x, y, z),
            damage_type=damage_type,
            severity=severity,
            timestamp=timestamp,
            nearest_node=nearest,
            repair_material=repair_material
        )
        
        self.active_damage.append(damage)
        return damage
    
    def route_repair_material(self, damage: DamageReport) -> Optional[Dict]:
        """Route repair material to damage location."""
        if damage.nearest_node is None:
            return None
        
        if damage.repair_material is None:
            return None
        
        # Check if we have enough material
        needed_volume = damage.severity * 0.0001  # m³ based on severity
        available = self.fluid_reserves.get(damage.repair_material, 0.0)
        
        if available < needed_volume:
            return {'status': 'insufficient_material'}
        
        # Calculate route through network
        route = self._find_path_to_node(damage.nearest_node)
        
        if route:
            repair_route = {
                'damage': damage,
                'route': route,
                'material': damage.repair_material,
                'volume': needed_volume,
                'status': 'routing'
            }
            self.repair_routes.append(repair_route)
            
            # Reserve the material
            self.fluid_reserves[damage.repair_material] -= needed_volume
            
            return {'status': 'routing_started', 'route': route}
        
        return {'status': 'no_route_found'}
    
    def _find_path_to_node(self, target_node: str, start_node: str = "spine_0") -> List[str]:
        """Find path through network to target node using BFS."""
        if start_node == target_node:
            return [start_node]
        
        visited = {start_node}
        queue = [(start_node, [start_node])]
        
        while queue:
            current, path = queue.pop(0)
            node = self.nodes.get(current)
            
            if not node:
                continue
            
            for channel_id in node.connections:
                channel = self.channels.get(channel_id)
                if not channel:
                    continue
                
                # Get the other node
                next_node = channel.node_b if channel.node_a == current else channel.node_a
                
                if next_node == target_node:
                    return path + [next_node]
                
                if next_node not in visited:
                    visited.add(next_node)
                    queue.append((next_node, path + [next_node]))
        
        return []
    
    def update_pumps(self, dt: float = 1.0):
        """Update all pumps to move fluid."""
        for pump in self.pumps.values():
            if not pump.active:
                continue
            
            # Simple pump model - move fluid based on pressure
            target_flow = pump.max_pressure * 0.00001 * pump.direction
            pump.flow_rate = target_flow * pump.efficiency
            
            # Update statistics
            for ft in FluidType:
                moved = abs(pump.flow_rate) * dt * 0.1  # Simplified
                self.total_pumped[ft] += moved
    
    def deliver_repair_materials(self, dt: float = 1.0):
        """Deliver repair materials along active routes."""
        completed = []
        delivered_timestamps = []

        for i, route in enumerate(self.repair_routes):
            if route['status'] == 'delivered':
                completed.append(i)
                continue

            # Simulate delivery progress
            route['progress'] = route.get('progress', 0.0) + dt * 0.5

            if route['progress'] >= 1.0:
                route['status'] = 'delivered'
                self.repairs_completed += 1
                completed.append(i)

                # Mark damage as being repaired
                for damage in self.active_damage:
                    if damage.timestamp == route['damage'].timestamp:
                        damage.severity *= 0.3  # Reduce severity after repair
                delivered_timestamps.append(route['damage'].timestamp)

        # Remove completed routes
        for i in sorted(completed, reverse=True):
            self.repair_routes.pop(i)

        # active_damage otherwise grows forever: this loop (and update()'s own
        # dedup scan over the whole list) both cost more every tick as it
        # grows. Drop damage the same tick its route finishes delivering.
        if delivered_timestamps:
            delivered = set(delivered_timestamps)
            self.active_damage = [
                d for d in self.active_damage if d.timestamp not in delivered
            ]
    
    def update(self, dt: float = 1.0) -> Dict:
        """Update transport system for one timestep."""
        self.update_pumps(dt)
        self.deliver_repair_materials(dt)
        
        # Auto-route new damage
        for damage in self.active_damage[-5:]:  # Process recent damage
            if not any(r['damage'].timestamp == damage.timestamp 
                      for r in self.repair_routes):
                self.route_repair_material(damage)
        
        return {
            'active_damage': len(self.active_damage),
            'active_routes': len(self.repair_routes),
            'repairs_completed': self.repairs_completed,
            'fluid_reserves': {
                ft.name: vol for ft, vol in self.fluid_reserves.items()
            },
            'pump_status': {
                p.id: {'active': p.active, 'flow': p.flow_rate}
                for p in self.pumps.values()
            }
        }
    
    def get_status(self) -> Dict:
        """Get detailed status of transport system."""
        return {
            'network': {
                'nodes': len(self.nodes),
                'channels': len(self.channels),
                'pumps': len(self.pumps)
            },
            'fluid_reserves': {
                ft.name: f"{vol*1e6:.1f} mL" 
                for ft, vol in self.fluid_reserves.items()
            },
            'damage': {
                'active': len(self.active_damage),
                'details': [
                    {
                        'location': d.location,
                        'type': d.damage_type,
                        'severity': d.severity,
                        'material': d.repair_material.name if d.repair_material else None
                    }
                    for d in self.active_damage[-5:]
                ]
            },
            'repairs': {
                'in_progress': len(self.repair_routes),
                'completed': self.repairs_completed
            },
            'statistics': {
                'total_pumped': {
                    ft.name: f"{vol*1e6:.1f} mL"
                    for ft, vol in self.total_pumped.items()
                }
            }
        }
