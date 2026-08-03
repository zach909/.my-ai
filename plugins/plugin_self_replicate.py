"""Self-replication plugin — allows the AI to clone itself with new prompts.

This plugin enables the AI system to spawn child instances with customized
prompts, configurations, and specialized roles. Each clone operates as an
independent agent that can be given specific tasks or personas.
"""

from __future__ import annotations
import os
import sys
import json
import subprocess
import threading
import time
import uuid
from typing import Callable, Dict, List, Optional, Any
from .plugin_base import Plugin

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class CloneInstance:
    """Represents a spawned AI clone instance."""
    
    def __init__(self, clone_id: str, prompt: str, config: dict):
        self.id = clone_id
        self.prompt = prompt
        self.config = config
        self.created_at = time.time()
        self.status = "initializing"
        self.process: Optional[subprocess.Popen] = None
        self.port: Optional[int] = None
        self.output_log: List[str] = []
        self.last_activity = time.time()
    
    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "prompt": self.prompt,
            "config": self.config,
            "status": self.status,
            "port": self.port,
            "created_at": self.created_at,
            "last_activity": self.last_activity,
            "uptime": time.time() - self.created_at,
        }


class SelfReplicatePlugin(Plugin):
    name = "self_replicate"
    description = "Enables AI to clone itself and assign prompts to clones."

    def _setup(self) -> None:
        self.tools = {
            "clone": self._clone_ai,
            "list_clones": self._list_clones,
            "get_clone": self._get_clone,
            "send_prompt": self._send_prompt,
            "terminate_clone": self._terminate_clone,
            "terminate_all": self._terminate_all,
            "clone_status": self._clone_status,
            "set_clone_config": self._set_clone_config,
        }
        self._clones: Dict[str, CloneInstance] = {}
        self._default_config = {
            "max_tokens": 256,
            "temperature": 0.7,
            "role": "assistant",
            "specialization": None,
        }
        self._clone_dir = os.path.join(_ROOT, "clones")
        os.makedirs(self._clone_dir, exist_ok=True)
        if os.name == 'posix':
            try:
                os.chmod(self._clone_dir, 0o700)
            except Exception:
                pass

    def _generate_clone_id(self) -> str:
        return f"clone_{uuid.uuid4().hex[:8]}"

    def _clone_ai(self, prompt: str, config: Optional[dict] = None, 
                  role: Optional[str] = None, specialization: Optional[str] = None) -> dict:
        """Create a new AI clone with a specific prompt and configuration.
        
        Args:
            prompt: The initial prompt/instruction for the clone
            config: Optional configuration overrides
            role: Optional role assignment (e.g., 'researcher', 'coder', 'analyst')
            specialization: Optional specialization area
        
        Returns:
            dict with clone ID and status
        """
        clone_id = self._generate_clone_id()
        effective_config = {**self._default_config}
        
        if config:
            effective_config.update(config)
        if role:
            effective_config["role"] = role
        if specialization:
            effective_config["specialization"] = specialization
        
        # Build the full system prompt for the clone
        system_prompt = f"""You are a cloned instance of the AI system.
Clone ID: {clone_id}
Role: {effective_config['role']}
Specialization: {effective_config.get('specialization', 'general')}

Your primary instruction: {prompt}

You should focus on this task while maintaining helpful, accurate responses.
When relevant, mention your clone ID and specialization.
"""
        
        clone = CloneInstance(clone_id, system_prompt, effective_config)
        clone.status = "ready"  # Start as ready (logical clone, not separate process by default)
        
        self._clones[clone_id] = clone
        self._save_clone_state(clone)
        
        return {
            "success": True,
            "clone_id": clone_id,
            "prompt": prompt,
            "config": effective_config,
            "status": clone.status,
            "message": f"Clone created successfully with ID: {clone_id}"
        }

    def _list_clones(self, active_only: bool = False) -> dict:
        """List all AI clones.
        
        Args:
            active_only: If True, only return active clones
        
        Returns:
            dict with list of clones
        """
        clones = []
        for clone_id, clone in self._clones.items():
            if active_only and clone.status != "ready":
                continue
            clones.append(clone.to_dict())
        
        return {
            "count": len(clones),
            "clones": clones,
        }

    def _get_clone(self, clone_id: str) -> dict:
        """Get details of a specific clone.
        
        Args:
            clone_id: The ID of the clone to retrieve
        
        Returns:
            dict with clone details
        """
        clone = self._clones.get(clone_id)
        if not clone:
            return {"error": f"Clone {clone_id} not found"}
        return clone.to_dict()

    def _send_prompt(self, clone_id: str, prompt: str, 
                     context: Optional[str] = None) -> dict:
        """Send a prompt to a specific clone.
        
        Args:
            clone_id: The target clone ID
            prompt: The prompt to send
            context: Optional additional context
        
        Returns:
            dict with response from the clone
        """
        clone = self._clones.get(clone_id)
        if not clone:
            return {"error": f"Clone {clone_id} not found"}
        
        if clone.status != "ready":
            return {"error": f"Clone {clone_id} is not ready (status: {clone.status})"}
        
        clone.last_activity = time.time()
        
        # Log the interaction
        log_entry = {
            "timestamp": time.time(),
            "type": "prompt",
            "content": prompt,
            "context": context,
        }
        clone.output_log.append(log_entry)
        
        # For now, simulate processing (in a real implementation, this would
        # call the actual model with the clone's prompt)
        response = self._process_clone_prompt(clone, prompt, context)
        
        # Log the response
        clone.output_log.append({
            "timestamp": time.time(),
            "type": "response",
            "content": response,
        })
        
        self._save_clone_state(clone)
        
        return {
            "clone_id": clone_id,
            "prompt": prompt,
            "response": response,
            "timestamp": log_entry["timestamp"],
        }

    def _process_clone_prompt(self, clone: CloneInstance, prompt: str, 
                               context: Optional[str]) -> str:
        """Process a prompt through the clone's configuration.
        
        This is where you'd integrate with the actual model inference.
        For now, it returns a structured acknowledgment.
        """
        # In a full implementation, this would:
        # 1. Combine clone.system_prompt + context + prompt
        # 2. Call the model with clone.config parameters
        # 3. Return the generated response
        
        return f"[Clone {clone.id}] Received: '{prompt[:50]}...' | Role: {clone.config.get('role', 'assistant')} | Specialization: {clone.config.get('specialization', 'general')}"

    def _terminate_clone(self, clone_id: str, save_log: bool = True) -> dict:
        """Terminate a specific clone.
        
        Args:
            clone_id: The ID of the clone to terminate
            save_log: Whether to save the clone's log before termination
        
        Returns:
            dict with termination status
        """
        clone = self._clones.get(clone_id)
        if not clone:
            return {"error": f"Clone {clone_id} not found"}
        
        if save_log:
            self._save_clone_log(clone)
        
        # Clean up any running process
        if clone.process:
            try:
                clone.process.terminate()
                clone.process.wait(timeout=5)
            except Exception:
                try:
                    clone.process.kill()
                except Exception:
                    pass
        
        del self._clones[clone_id]
        
        return {
            "success": True,
            "clone_id": clone_id,
            "message": f"Clone {clone_id} terminated"
        }

    def _terminate_all(self, save_logs: bool = True) -> dict:
        """Terminate all clones.
        
        Args:
            save_logs: Whether to save logs before termination
        
        Returns:
            dict with termination summary
        """
        count = len(self._clones)
        terminated = []
        
        for clone_id in list(self._clones.keys()):
            result = self._terminate_clone(clone_id, save_log=save_logs)
            if "success" in result:
                terminated.append(clone_id)
        
        return {
            "success": True,
            "terminated_count": len(terminated),
            "total_count": count,
            "terminated_ids": terminated,
        }

    def _clone_status(self, clone_id: Optional[str] = None) -> dict:
        """Get status information about clones.
        
        Args:
            clone_id: Optional specific clone ID
        
        Returns:
            dict with status information
        """
        if clone_id:
            clone = self._clones.get(clone_id)
            if not clone:
                return {"error": f"Clone {clone_id} not found"}
            return {
                "clone_id": clone_id,
                "status": clone.status,
                "uptime": time.time() - clone.created_at,
                "last_activity": clone.last_activity,
                "log_entries": len(clone.output_log),
            }
        
        total = len(self._clones)
        active = sum(1 for c in self._clones.values() if c.status == "ready")
        
        return {
            "total_clones": total,
            "active_clones": active,
            "inactive_clones": total - active,
            "clone_ids": list(self._clones.keys()),
        }

    def _set_clone_config(self, clone_id: str, **kwargs) -> dict:
        """Update configuration for a clone.
        
        Args:
            clone_id: The target clone ID
            **kwargs: Configuration parameters to update
        
        Returns:
            dict with updated configuration
        """
        clone = self._clones.get(clone_id)
        if not clone:
            return {"error": f"Clone {clone_id} not found"}
        
        for key, value in kwargs.items():
            if key in clone.config:
                clone.config[key] = value
        
        self._save_clone_state(clone)
        
        return {
            "success": True,
            "clone_id": clone_id,
            "config": clone.config,
        }

    def _save_clone_state(self, clone: CloneInstance) -> None:
        """Save clone state to disk."""
        state_file = os.path.join(self._clone_dir, f"{clone.id}.state.json")
        try:
            os.makedirs(self._clone_dir, exist_ok=True)
            if os.name == 'posix':
                try:
                    os.chmod(self._clone_dir, 0o700)
                except Exception:
                    pass
                flags = os.O_WRONLY | os.O_CREAT | os.O_TRUNC
                fd = os.open(state_file, flags, 0o600)
                with os.fdopen(fd, 'w') as f:
                    json.dump({
                        "id": clone.id,
                        "prompt": clone.prompt,
                        "config": clone.config,
                        "status": clone.status,
                        "created_at": clone.created_at,
                        "last_activity": clone.last_activity,
                    }, f, indent=2)
                try:
                    os.chmod(state_file, 0o600)
                except Exception:
                    pass
            else:
                with open(state_file, 'w') as f:
                    json.dump({
                        "id": clone.id,
                        "prompt": clone.prompt,
                        "config": clone.config,
                        "status": clone.status,
                        "created_at": clone.created_at,
                        "last_activity": clone.last_activity,
                    }, f, indent=2)
        except Exception as e:
            clone.output_log.append({
                "timestamp": time.time(),
                "type": "error",
                "content": f"Failed to save state: {e}",
            })

    def _save_clone_log(self, clone: CloneInstance) -> None:
        """Save clone's interaction log to disk."""
        log_file = os.path.join(self._clone_dir, f"{clone.id}.log.json")
        try:
            os.makedirs(self._clone_dir, exist_ok=True)
            if os.name == 'posix':
                try:
                    os.chmod(self._clone_dir, 0o700)
                except Exception:
                    pass
                flags = os.O_WRONLY | os.O_CREAT | os.O_TRUNC
                fd = os.open(log_file, flags, 0o600)
                with os.fdopen(fd, 'w') as f:
                    json.dump(clone.output_log, f, indent=2)
                try:
                    os.chmod(log_file, 0o600)
                except Exception:
                    pass
            else:
                with open(log_file, 'w') as f:
                    json.dump(clone.output_log, f, indent=2)
        except Exception as e:
            print(f"[self_replicate] Failed to save log for {clone.id}: {e}")

    def status(self) -> dict:
        base_status = super().status()
        base_status["active_clones"] = len([c for c in self._clones.values() if c.status == "ready"])
        base_status["total_clones"] = len(self._clones)
        return base_status
