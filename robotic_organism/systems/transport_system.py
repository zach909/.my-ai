"""
Transport System - Internal material transport network.

Transports energy-rich materials, water, repair materials, construction
materials, and other resources throughout the organism via engineered
channels and pumps.
"""

from typing import Dict, List, Optional, Any
from dataclasses import dataclass


@dataclass
class TransportChannel:
    """Single transport channel in the network"""
    id: str
    channel_type: str  # artery, vein, lymphatic, specialized
    capacity: float  # Volume flow rate
    current_flow: float = 0.0
    contents: Dict[str, float] = None
    
    def __post_init__(self):
        if self.contents is None:
            self.contents = {}


@dataclass
class TransportNode:
    """Junction point in transport network"""
    id: str
    position: tuple
    connected_channels: List[str] = None
    
    def __post_init__(self):
        if self.connected_channels is None:
            self.connected_channels = []


class TransportSystem:
    """
    Complete internal transport network analogous to circulatory system.
    """
    
    def __init__(self, organism):
        self.organism = organism
        self.channels: Dict[str, TransportChannel] = {}
        self.nodes: Dict[str, TransportNode] = {}
        self.pumps: List[Dict] = []
        self.cargo: Dict[str, Dict] = {}
        
        self._initialize_network()
        
    def _initialize_network(self):
        """Create transport network structure"""
        # Main trunk lines
        self.channels["main_artery"] = TransportChannel(
            id="main_artery",
            channel_type="artery",
            capacity=100.0
        )
        self.channels["main_vein"] = TransportChannel(
            id="main_vein",
            channel_type="vein",
            capacity=100.0
        )
        
        # Regional channels
        regions = ["head", "torso", "left_arm", "right_arm", "left_leg", "right_leg"]
        for region in regions:
            self.channels[f"{region}_artery"] = TransportChannel(
                id=f"{region}_artery",
                channel_type="artery",
                capacity=30.0
            )
            self.channels[f"{region}_vein"] = TransportChannel(
                id=f"{region}_vein",
                channel_type="vein",
                capacity=30.0
            )
            
        # Create nodes at junctions
        self.nodes["heart"] = TransportNode(id="heart", position=(0, 0, 0))
        self.nodes["head_junction"] = TransportNode(id="head_junction", position=(0, 0, 0.5))
        self.nodes["torso_junction"] = TransportNode(id="torso_junction", position=(0, 0, 0))
        
        # Initialize pumps (heart-like)
        self.pumps = [
            {"id": "primary_pump", "rate": 5.0, "active": True},
            {"id": "secondary_pump", "rate": 3.0, "active": True}
        ]
        
    def transport_material(self, material_type: str, quantity: float,
                           from_node: str, to_node: str) -> bool:
        """Initiate transport of material between nodes"""
        cargo_id = f"cargo_{len(self.cargo)}"
        self.cargo[cargo_id] = {
            "material_type": material_type,
            "quantity": quantity,
            "from": from_node,
            "to": to_node,
            "progress": 0.0
        }
        return True
        
    def deliver_to_system(self, system_name: str, material_type: str, 
                          quantity: float) -> bool:
        """Deliver material to a specific system"""
        # Route to appropriate node based on system
        system_nodes = {
            'neural': 'head_junction',
            'muscular': 'torso_junction',
            'energy': 'torso_junction',
            'repair': 'torso_junction',
            'manufacturing': 'torso_junction'
        }
        
        target_node = system_nodes.get(system_name, 'torso_junction')
        return self.transport_material(material_type, quantity, 'heart', target_node)
        
    def update(self, delta_time: float):
        """Update transport system state"""
        # Process cargo movement
        for cargo_id, cargo in list(self.cargo.items()):
            # Move cargo based on pump activity
            total_pump_rate = sum(p["rate"] for p in self.pumps if p["active"])
            cargo["progress"] += total_pump_rate * delta_time * 0.1
            
            if cargo["progress"] >= 1.0:
                # Delivery complete
                del self.cargo[cargo_id]
                
        # Update channel flows
        for channel in self.channels.values():
            if channel.channel_type == "artery":
                channel.current_flow = channel.capacity * 0.7
            else:
                channel.current_flow = channel.capacity * 0.6
                
    def get_status(self) -> Dict[str, Any]:
        """Get transport system status"""
        return {
            'active_cargo': len(self.cargo),
            'total_channels': len(self.channels),
            'total_nodes': len(self.nodes),
            'active_pumps': sum(1 for p in self.pumps if p["active"])
        }
