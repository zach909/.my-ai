"""
Sensory System - Artificial sensory organs.

Provides environmental sensing through artificial eyes, ears,
touch sensors, and proprioceptive systems.
"""

from typing import Dict, List, Optional, Any, Tuple
from dataclasses import dataclass, field
import math
import random


@dataclass
class VisualFrame:
    """Single frame of visual data"""
    width: int
    height: int
    pixels: List[List[Tuple[float, float, float]]]  # RGB values 0-1
    timestamp: float
    depth_map: Optional[List[List[float]]] = None


@dataclass
class AudioSample:
    """Audio data sample"""
    frequency_hz: float
    amplitude: float
    phase: float
    timestamp: float


@dataclass
class TouchReading:
    """Tactile sensor reading"""
    location: Tuple[float, float, float]
    pressure: float  # 0-1
    temperature: float  # Celsius
    texture_estimate: float  # 0-1 roughness


class ArtificialEye:
    """
    Artificial eye with transparent outer structure,
    focusing system, and light-sensitive imaging surface.
    """
    
    def __init__(self, eye_id: str, side: str):
        self.id = eye_id
        self.side = side  # left or right
        
        # Optical properties
        self.focal_length: float = 0.024  # meters (similar to human)
        self.aperture: float = 0.008  # Maximum aperture
        self.current_aperture: float = 0.004
        
        # Imaging surface
        self.resolution: Tuple[int, int] = (1920, 1080)
        self.sensor_sensitivity: float = 1.0
        
        # Current state
        self.focus_distance: float = 5.0  # meters
        self.current_frame: Optional[VisualFrame] = None
        
    def adjust_focus(self, distance: float):
        """Adjust focus for target distance"""
        self.focus_distance = max(0.1, distance)
        
    def adjust_aperture(self, light_level: float):
        """Adjust aperture based on ambient light"""
        # Constrict in bright light, dilate in dim
        target_aperture = self.aperture * (1.0 - min(1.0, light_level))
        self.current_aperture = max(0.002, min(self.aperture, target_aperture))
        
    def capture_frame(self, scene_data: Dict[str, Any], 
                      timestamp: float) -> VisualFrame:
        """Capture visual frame from scene"""
        width, height = self.resolution
        
        # Generate simplified frame from scene data
        pixels = []
        for y in range(height):
            row = []
            for x in range(width):
                # Sample from scene (simplified)
                r = scene_data.get('color_r', 0.5) + random.uniform(-0.1, 0.1)
                g = scene_data.get('color_g', 0.5) + random.uniform(-0.1, 0.1)
                b = scene_data.get('color_b', 0.5) + random.uniform(-0.1, 0.1)
                row.append((max(0, min(1, r)), 
                           max(0, min(1, g)), 
                           max(0, min(1, b))))
            pixels.append(row)
            
        # Generate depth map if available
        depth_map = None
        if 'depth' in scene_data:
            depth_map = [[scene_data['depth']] * width for _ in range(height)]
            
        self.current_frame = VisualFrame(
            width=width,
            height=height,
            pixels=pixels,
            timestamp=timestamp,
            depth_map=depth_map
        )
        
        return self.current_frame
        
    def get_visual_signal(self) -> List[float]:
        """Convert visual data to neural signal format"""
        if not self.current_frame:
            return [0.0] * 64
            
        # Downsample frame to neural signal
        signal = []
        step = max(1, self.resolution[0] // 8)
        for y in range(0, self.resolution[1], step):
            for x in range(0, self.resolution[0], step):
                pixel = self.current_frame.pixels[y][x]
                # Convert RGB to luminance
                luminance = 0.299 * pixel[0] + 0.587 * pixel[1] + 0.114 * pixel[2]
                signal.append(luminance)
                
        return signal[:64]  # Return fixed size signal


class ArtificialEar:
    """Artificial auditory sensor"""
    
    def __init__(self, ear_id: str, side: str):
        self.id = ear_id
        self.side = side
        
        # Frequency response range
        self.min_frequency: float = 20.0  # Hz
        self.max_frequency: float = 20000.0  # Hz
        
        # Frequency bands for analysis
        self.frequency_bands: int = 32
        
        self.current_samples: List[AudioSample] = []
        
    def capture_audio(self, sound_data: Dict[str, Any], 
                      timestamp: float) -> List[AudioSample]:
        """Capture audio samples"""
        samples = []
        
        # Generate frequency spectrum from sound data
        base_freq = sound_data.get('frequency', 440.0)
        amplitude = sound_data.get('amplitude', 0.5)
        
        for i in range(self.frequency_bands):
            freq = self.min_frequency + (i / self.frequency_bands) * \
                   (self.max_frequency - self.min_frequency)
                   
            # Amplitude varies based on proximity to base frequency
            freq_diff = abs(freq - base_freq)
            band_amplitude = amplitude * math.exp(-freq_diff / 1000.0)
            
            samples.append(AudioSample(
                frequency_hz=freq,
                amplitude=max(0, min(1, band_amplitude)),
                phase=random.uniform(0, 2 * math.pi),
                timestamp=timestamp
            ))
            
        self.current_samples = samples
        return samples
        
    def get_audio_signal(self) -> List[float]:
        """Convert audio data to neural signal"""
        if not self.current_samples:
            return [0.0] * 32
        return [s.amplitude for s in self.current_samples[:32]]


class TactileSensor:
    """Artificial touch sensor for skin"""
    
    def __init__(self, sensor_id: str, location: Tuple[float, float, float]):
        self.id = sensor_id
        self.location = location
        self.pressure_sensitivity: float = 1.0
        self.temperature_sensitivity: float = 1.0
        
        self.current_pressure: float = 0.0
        self.current_temperature: float = 37.0
        
    def detect_contact(self, pressure: float, temperature: float):
        """Detect contact with surface"""
        self.current_pressure = max(0, min(1, pressure))
        self.current_temperature = temperature
        
    def get_reading(self) -> TouchReading:
        """Get current tactile reading"""
        return TouchReading(
            location=self.location,
            pressure=self.current_pressure,
            temperature=self.current_temperature,
            texture_estimate=random.uniform(0.3, 0.7)
        )


class ProprioceptiveSensor:
    """Internal position and movement sensing"""
    
    def __init__(self, joint_id: str):
        self.joint_id = joint_id
        self.current_angle: float = 0.0
        self.angular_velocity: float = 0.0
        self.torque: float = 0.0
        
    def update_from_joint(self, angle: float, velocity: float, torque: float):
        """Update from actual joint state"""
        self.current_angle = angle
        self.angular_velocity = velocity
        self.torque = torque
        
    def get_signal(self) -> List[float]:
        """Get proprioceptive signal"""
        return [self.current_angle, self.angular_velocity, self.torque]


class SensorySystem:
    """
    Complete sensory system integrating all sensory modalities.
    """
    
    def __init__(self, organism):
        self.organism = organism
        self.eyes: Dict[str, ArtificialEye] = {}
        self.ears: Dict[str, ArtificialEar] = {}
        self.tactile_sensors: Dict[str, TactileSensor] = {}
        self.proprioceptors: Dict[str, ProprioceptiveSensor] = {}
        
        self._initialize_sensors()
        
    def _initialize_sensors(self):
        """Create all sensory organs"""
        # Eyes
        self.eyes["left_eye"] = ArtificialEye("left_eye", "left")
        self.eyes["right_eye"] = ArtificialEye("right_eye", "right")
        
        # Ears
        self.ears["left_ear"] = ArtificialEar("left_ear", "left")
        self.ears["right_ear"] = ArtificialEar("right_ear", "right")
        
        # Tactile sensors distributed over body surface
        sensor_locations = [
            (0, 0, 0.5),   # Head
            (0.3, 0, 0.3), # Right shoulder
            (-0.3, 0, 0.3),# Left shoulder
            (0.4, 0, 0),   # Right hand
            (-0.4, 0, 0),  # Left hand
            (0.2, 0, -0.5),# Right thigh
            (-0.2, 0, -0.5),# Left thigh
            (0.3, 0, -0.9),# Right foot
            (-0.3, 0, -0.9)# Left foot
        ]
        
        for i, loc in enumerate(sensor_locations):
            self.tactile_sensors[f"tactile_{i}"] = TactileSensor(f"tactile_{i}", loc)
            
        # Proprioceptors for major joints
        joint_ids = [
            "left_shoulder", "right_shoulder",
            "left_elbow", "right_elbow",
            "left_hip", "right_hip",
            "left_knee", "right_knee",
            "spine_lumbar", "spine_cervical"
        ]
        
        for joint_id in joint_ids:
            self.proprioceptors[joint_id] = ProprioceptiveSensor(joint_id)
            
    def gather_all_data(self) -> Dict[str, Any]:
        """Gather data from all sensory systems"""
        timestamp = self.organism.state.age if hasattr(self.organism, 'state') else 0
        
        # Simulated environment data
        env_light = 0.6
        env_sound = {'frequency': 500.0, 'amplitude': 0.3}
        env_color = {'color_r': 0.5, 'color_g': 0.6, 'color_b': 0.7}
        
        # Vision
        visual_data = {}
        for eye_id, eye in self.eyes.items():
            eye.adjust_aperture(env_light)
            frame = eye.capture_frame(env_color, timestamp)
            visual_data[eye_id] = {
                'signal': eye.get_visual_signal(),
                'focus_distance': eye.focus_distance
            }
            
        # Audio
        audio_data = {}
        for ear_id, ear in self.ears.items():
            ear.capture_audio(env_sound, timestamp)
            audio_data[ear_id] = ear.get_audio_signal()
            
        # Touch
        touch_data = {}
        for sensor_id, sensor in self.tactile_sensors.items():
            # Simulate some contact
            sensor.detect_contact(random.uniform(0, 0.2), 22.0 + random.uniform(-2, 2))
            reading = sensor.get_reading()
            touch_data[sensor_id] = {
                'pressure': reading.pressure,
                'temperature': reading.temperature
            }
            
        # Proprioception
        proprio_data = {}
        if hasattr(self.organism, 'muscular_system'):
            for joint_id, prop in self.proprioceptors.items():
                if hasattr(self.organism.muscular_system, 'joints'):
                    joint = self.organism.muscular_system.joints.get(joint_id)
                    if joint:
                        prop.update_from_joint(joint.angle, joint.angular_velocity, 0)
                proprio_data[joint_id] = prop.get_signal()
                
        return {
            'vision': visual_data,
            'audio': audio_data,
            'touch': touch_data,
            'proprioception': proprio_data,
            'timestamp': timestamp
        }
        
    def process_visual_input(self, scene_data: Dict[str, Any]):
        """Process visual input and send to neural system"""
        timestamp = self.organism.state.age if hasattr(self.organism, 'state') else 0
        
        for eye_id, eye in self.eyes.items():
            frame = eye.capture_frame(scene_data, timestamp)
            signal = eye.get_visual_signal()
            
            if hasattr(self.organism, 'neural_system'):
                self.organism.neural_system.process_sensory_input('vision', signal)
                
    def process_audio_input(self, sound_data: Dict[str, Any]):
        """Process audio input and send to neural system"""
        timestamp = self.organism.state.age if hasattr(self.organism, 'state') else 0
        
        for ear_id, ear in self.ears.items():
            ear.capture_audio(sound_data, timestamp)
            signal = ear.get_audio_signal()
            
            if hasattr(self.organism, 'neural_system'):
                self.organism.neural_system.process_sensory_input('audio', signal)
                
    def update(self, delta_time: float):
        """Update all sensory systems"""
        # Update proprioceptors from muscular system
        if hasattr(self.organism, 'muscular_system'):
            for joint_id, prop in self.proprioceptors.items():
                if hasattr(self.organism.muscular_system, 'joints'):
                    joint = self.organism.muscular_system.joints.get(joint_id)
                    if joint:
                        prop.update_from_joint(joint.angle, joint.angular_velocity, 0)
                        
    def get_status(self) -> Dict[str, Any]:
        """Get sensory system status"""
        return {
            'eyes_active': len(self.eyes),
            'ears_active': len(self.ears),
            'tactile_sensors': len(self.tactile_sensors),
            'proprioceptors': len(self.proprioceptors)
        }
