"""
Sensor Array - Stage 7 of development

Artificial sensory system with:
- Vision (artificial eyes)
- Hearing (frequency analysis)
- Touch/pressure sensors
- Proprioception (body position sensing)
- Internal state sensing

The brain receives information about the entire body, not just external sensors.
"""

from enum import Enum
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple
import math
import time


class SensorType(Enum):
    """Types of sensors in the array."""
    VISION = "vision"
    AUDIO = "audio"
    TACTILE = "tactile"
    PROPRIOCEPTION = "proprioception"
    TEMPERATURE = "temperature"
    PRESSURE = "pressure"
    CHEMICAL = "chemical"
    DAMAGE = "damage"


@dataclass
class VisualFrame:
    """A frame from an artificial eye."""
    timestamp: float
    width: int
    height: int
    # Simplified: store average brightness and key features instead of full image
    avg_brightness: float = 0.5
    motion_detected: bool = False
    edges: List[Tuple[int, int, int, int]] = field(default_factory=list)
    focus_distance: float = 1.0  # meters
    
    def to_dict(self) -> Dict:
        return {
            'timestamp': self.timestamp,
            'resolution': f"{self.width}x{self.height}",
            'brightness': self.avg_brightness,
            'motion': self.motion_detected,
            'focus_meters': self.focus_distance
        }


@dataclass
class AudioSample:
    """Audio data from artificial ears."""
    timestamp: float
    frequency_bands: Dict[str, float] = field(default_factory=dict)
    amplitude: float = 0.0
    direction: Optional[float] = None  # Radians, direction of sound source
    
    def to_dict(self) -> Dict:
        return {
            'timestamp': self.timestamp,
            'amplitude': self.amplitude,
            'direction_degrees': math.degrees(self.direction) if self.direction else None,
            'bands': self.frequency_bands
        }


@dataclass
class TactileReading:
    """Touch sensor reading."""
    location: Tuple[float, float, float]
    pressure: float  # 0.0 to 1.0
    texture: float = 0.0  # Roughness estimate
    temperature: float = 20.0  # Celsius
    slip_detected: bool = False


@dataclass
class ProprioceptiveState:
    """Body position and movement state."""
    timestamp: float
    joint_angles: Dict[str, float] = field(default_factory=dict)
    muscle_activations: Dict[str, float] = field(default_factory=dict)
    balance: float = 0.0  # -1.0 to 1.0, left to right
    posture: str = "neutral"


class ArtificialEye:
    """
    Artificial eye inspired by biological eye organization.
    
    Contains:
    - Transparent outer structure
    - Focusing system
    - Light-sensitive imaging surface
    - Signal processing
    - Neural connections
    """
    
    def __init__(self, name: str, resolution: Tuple[int, int] = (1920, 1080)):
        self.name = name
        self.resolution = resolution
        
        # Eye properties
        self.focus_distance: float = 2.0  # Current focus in meters
        self.min_focus: float = 0.1
        self.max_focus: float = 100.0
        
        # Pupil/adaptation
        self.pupil_size: float = 0.5  # 0.0 to 1.0
        self.light_adaptation: float = 0.5  # Adapted brightness level
        
        # State
        self.last_frame: Optional[VisualFrame] = None
        self.frame_count: int = 0
        
        # Processing
        self.motion_threshold: float = 0.1
        self.edge_detection_enabled: bool = True
    
    def capture_frame(self, timestamp: Optional[float] = None) -> VisualFrame:
        """Capture a visual frame (simulated)."""
        if timestamp is None:
            timestamp = time.time()
        
        # Simulate scene properties
        ambient_light = 0.5  # Would come from actual scene
        motion = abs(math.sin(timestamp * 0.5)) > 0.8  # Simulated motion
        
        # Adjust pupil based on light
        target_pupil = 1.0 - ambient_light
        self.pupil_size += (target_pupil - self.pupil_size) * 0.1
        self.light_adaptation += (ambient_light - self.light_adaptation) * 0.05
        
        # Create frame
        frame = VisualFrame(
            timestamp=timestamp,
            width=self.resolution[0],
            height=self.resolution[1],
            avg_brightness=ambient_light,
            motion_detected=motion,
            focus_distance=self.focus_distance
        )
        
        # Simple edge detection simulation
        if self.edge_detection_enabled:
            frame.edges = [
                (100, 100, 200, 100),  # Horizontal line
                (150, 50, 150, 200)    # Vertical line
            ]
        
        self.last_frame = frame
        self.frame_count += 1
        
        return frame
    
    def adjust_focus(self, distance: float):
        """Adjust focus to a specific distance."""
        self.focus_distance = max(self.min_focus, min(self.max_focus, distance))
    
    def get_status(self) -> Dict:
        return {
            'name': self.name,
            'resolution': f"{self.resolution[0]}x{self.resolution[1]}",
            'focus_meters': f"{self.focus_distance:.2f}",
            'pupil_size': f"{self.pupil_size:.2f}",
            'adaptation': f"{self.light_adaptation:.2f}",
            'frames_captured': self.frame_count,
            'last_frame': self.last_frame.to_dict() if self.last_frame else None
        }


class ArtificialEar:
    """
    Artificial ear with frequency analysis.
    
    Analyzes sound across multiple frequency bands like biological cochlea.
    """
    
    def __init__(self, name: str, num_bands: int = 32):
        self.name = name
        self.num_bands = num_bands
        
        # Frequency bands (logarithmic spacing, 20Hz to 20kHz)
        self.frequencies = []
        for i in range(num_bands):
            freq = 20 * (1000 ** (i / (num_bands - 1)))
            self.frequencies.append(freq)
        
        # Current readings
        self.band_levels: Dict[str, float] = {}
        self.current_amplitude: float = 0.0
        self.direction: Optional[float] = None
        
        # Properties
        self.sensitivity: float = 1.0
        self.threshold: float = 0.01
    
    def capture_audio(self, timestamp: Optional[float] = None) -> AudioSample:
        """Capture audio sample (simulated)."""
        if timestamp is None:
            timestamp = time.time()
        
        # Simulate frequency analysis
        for i, freq in enumerate(self.frequencies):
            band_name = f"{freq:.0f}Hz"
            # Simulate varying levels across bands
            level = (math.sin(timestamp * 2 + i * 0.3) + 1) / 2 * self.sensitivity
            self.band_levels[band_name] = max(0, level)
        
        # Calculate overall amplitude
        self.current_amplitude = sum(self.band_levels.values()) / len(self.band_levels)
        
        # Simulate direction finding (stereo would use two ears)
        self.direction = math.sin(timestamp * 0.3) * math.pi / 4
        
        return AudioSample(
            timestamp=timestamp,
            frequency_bands=dict(self.band_levels),
            amplitude=self.current_amplitude,
            direction=self.direction
        )
    
    def set_sensitivity(self, value: float):
        """Set hearing sensitivity (0.0 to 2.0)."""
        self.sensitivity = max(0.0, min(2.0, value))
    
    def get_status(self) -> Dict:
        return {
            'name': self.name,
            'frequency_bands': self.num_bands,
            'sensitivity': f"{self.sensitivity:.2f}",
            'current_amplitude': f"{self.current_amplitude:.3f}",
            'direction_degrees': f"{math.degrees(self.direction):.1f}" if self.direction else None,
            'sample_bands': dict(list(self.band_levels.items())[:5])
        }


class TactileSensor:
    """Touch/pressure sensor at a specific body location."""
    
    def __init__(self, id: str, location: Tuple[float, float, float]):
        self.id = id
        self.location = location
        
        self.pressure: float = 0.0
        self.temperature: float = 20.0
        self.texture: float = 0.0
        self.slip_detected: bool = False
        
        # Thresholds
        self.pressure_threshold: float = 0.1
        self.temp_range: Tuple[float, float] = (-10.0, 60.0)
    
    def read(self) -> TactileReading:
        """Get current tactile reading."""
        return TactileReading(
            location=self.location,
            pressure=self.pressure,
            texture=self.texture,
            temperature=self.temperature,
            slip_detected=self.slip_detected
        )
    
    def simulate_contact(self, pressure: float, temp: float = 20.0):
        """Simulate contact with surface."""
        self.pressure = max(0.0, min(1.0, pressure))
        self.temperature = max(self.temp_range[0], min(self.temp_range[1], temp))
        
        # Detect slip if pressure is changing rapidly
        if hasattr(self, '_last_pressure'):
            if abs(self.pressure - self._last_pressure) > 0.3:
                self.slip_detected = True
            else:
                self.slip_detected = False
        self._last_pressure = self.pressure


class SensorArray:
    """
    Complete sensory system for the artificial organism.
    
    Integrates all sensor types and provides unified sensory processing.
    """
    
    def __init__(self):
        # Vision
        self.left_eye = ArtificialEye("left", resolution=(1920, 1080))
        self.right_eye = ArtificialEye("right", resolution=(1920, 1080))
        
        # Hearing
        self.left_ear = ArtificialEar("left", num_bands=32)
        self.right_ear = ArtificialEar("right", num_bands=32)
        
        # Tactile sensors (distributed across body)
        self.tactile_sensors: Dict[str, TactileSensor] = {}
        self._create_tactile_map()
        
        # Proprioception
        self.joint_sensors: Dict[str, float] = {}
        self.muscle_sensors: Dict[str, float] = {}
        
        # Internal sensors
        self.internal_temp: float = 37.0
        self.system_pressure: float = 1.0
        self.damage_sensors: List[Dict] = []
        
        # Processing
        self.last_update: float = 0.0
        self.sensor_fusion_enabled: bool = True
        
        # Statistics
        self.total_reads = 0
    
    def _create_tactile_map(self):
        """Create distributed tactile sensors across body."""
        locations = [
            ("hand_L", (0.3, 0.5, 0.0)),
            ("hand_R", (-0.3, 0.5, 0.0)),
            ("foot_L", (0.15, 0.0, 0.0)),
            ("foot_R", (-0.15, 0.0, 0.0)),
            ("chest", (0.0, 0.7, 0.1)),
            ("back", (0.0, 0.7, -0.1)),
            ("head_front", (0.0, 1.5, 0.1)),
            ("head_back", (0.0, 1.5, -0.1)),
        ]
        
        for name, loc in locations:
            self.tactile_sensors[name] = TactileSensor(name, loc)
    
    def update_vision(self, timestamp: Optional[float] = None) -> Dict:
        """Update both eyes and return visual data."""
        left_frame = self.left_eye.capture_frame(timestamp)
        right_frame = self.right_eye.capture_frame(timestamp)
        
        # Stereo depth estimation (simplified)
        disparity = 0.0  # Would calculate from stereo images
        
        self.total_reads += 2
        
        return {
            'left': left_frame.to_dict(),
            'right': right_frame.to_dict(),
            'stereo_disparity': disparity,
            'binocular': True
        }
    
    def update_audio(self, timestamp: Optional[float] = None) -> Dict:
        """Update both ears and return audio data."""
        left_sample = self.left_ear.capture_audio(timestamp)
        right_sample = self.right_ear.capture_audio(timestamp)
        
        # Binaural processing
        avg_amplitude = (left_sample.amplitude + right_sample.amplitude) / 2
        
        # Direction from interaural differences
        direction = (left_sample.direction or 0 + right_sample.direction or 0) / 2
        
        self.total_reads += 2
        
        return {
            'left': left_sample.to_dict(),
            'right': right_sample.to_dict(),
            'combined_amplitude': avg_amplitude,
            'estimated_direction': direction
        }
    
    def update_tactile(self) -> Dict:
        """Update all tactile sensors."""
        readings = {}
        for name, sensor in self.tactile_sensors.items():
            reading = sensor.read()
            readings[name] = {
                'pressure': reading.pressure,
                'temperature': reading.temperature,
                'texture': reading.texture,
                'slip': reading.slip_detected
            }
            self.total_reads += 1
        
        return readings
    
    def update_proprioception(self, joint_angles: Dict[str, float],
                             muscle_activations: Dict[str, float]) -> ProprioceptiveState:
        """Update body position sensing."""
        self.joint_sensors = joint_angles
        self.muscle_sensors = muscle_activations
        
        # Calculate balance (simplified)
        balance = 0.0
        if 'hip_L' in joint_angles and 'hip_R' in joint_angles:
            balance = (joint_angles['hip_L'] - joint_angles['hip_R']) / 2
        
        # Determine posture
        if abs(balance) > 0.3:
            posture = "leaning"
        elif joint_angles.get('knee', 0) > 0.5:
            posture = "crouched"
        else:
            posture = "neutral"
        
        self.total_reads += len(joint_angles) + len(muscle_activations)
        
        return ProprioceptiveState(
            timestamp=time.time(),
            joint_angles=dict(joint_angles),
            muscle_activations=dict(muscle_activations),
            balance=balance,
            posture=posture
        )
    
    def detect_damage(self, location: Tuple[float, float, float], 
                      severity: float) -> Dict:
        """Register damage detection."""
        report = {
            'location': location,
            'severity': severity,
            'timestamp': time.time(),
            'detected_by': 'damage_sensor'
        }
        self.damage_sensors.append(report)
        self.total_reads += 1
        return report
    
    def update(self, dt: float = 0.01, 
               joint_angles: Optional[Dict[str, float]] = None,
               muscle_activations: Optional[Dict[str, float]] = None) -> Dict:
        """Update all sensors."""
        timestamp = time.time()
        self.last_update = timestamp
        
        joint_angles = joint_angles or {}
        muscle_activations = muscle_activations or {}
        
        return {
            'vision': self.update_vision(timestamp),
            'audio': self.update_audio(timestamp),
            'tactile': self.update_tactile(),
            'proprioception': self.update_proprioception(
                joint_angles, muscle_activations
            ).__dict__,
            'internal': {
                'temperature': self.internal_temp,
                'pressure': self.system_pressure,
                'damage_reports': len(self.damage_sensors[-10:])
            },
            'statistics': {
                'total_reads': self.total_reads,
                'timestamp': timestamp
            }
        }
    
    def get_status(self) -> Dict:
        """Get detailed status of sensor array."""
        return {
            'vision': {
                'left': self.left_eye.get_status(),
                'right': self.right_eye.get_status()
            },
            'audio': {
                'left': self.left_ear.get_status(),
                'right': self.right_ear.get_status()
            },
            'tactile': {
                'count': len(self.tactile_sensors),
                'locations': list(self.tactile_sensors.keys()),
                'readings': {
                    name: {
                        'pressure': s.pressure,
                        'temperature': s.temperature
                    }
                    for name, s in self.tactile_sensors.items()
                }
            },
            'proprioception': {
                'joint_sensors': len(self.joint_sensors),
                'muscle_sensors': len(self.muscle_sensors)
            },
            'internal': {
                'temperature': self.internal_temp,
                'pressure': self.system_pressure,
                'recent_damage': len(self.damage_sensors[-5:])
            },
            'statistics': {
                'total_reads': self.total_reads,
                'last_update': self.last_update
            }
        }
