# Self-Replication Plugin

This plugin enables the AI system to clone itself and assign custom prompts to each clone. Each clone operates as an independent agent with its own configuration, role, and specialization.

## Features

- **Clone Creation**: Spawn new AI instances with custom prompts and configurations
- **Role Assignment**: Assign specific roles (e.g., 'coder', 'researcher', 'analyst') to clones
- **Specialization**: Set domain specializations for focused task handling
- **Prompt Management**: Send prompts to specific clones and receive responses
- **Lifecycle Management**: List, monitor, and terminate clones as needed
- **Persistence**: Clone states and logs are saved to disk

## Available Tools

### `clone(prompt, config?, role?, specialization?)`
Create a new AI clone with a specific prompt and configuration.

**Parameters:**
- `prompt` (string): The primary instruction/prompt for the clone
- `config` (object, optional): Configuration overrides (max_tokens, temperature, etc.)
- `role` (string, optional): Role assignment (e.g., 'coder', 'researcher')
- `specialization` (string, optional): Domain specialization (e.g., 'python', 'data-analysis')

**Returns:**
```json
{
  "success": true,
  "clone_id": "clone_7c20aef7",
  "prompt": "Your custom prompt here",
  "config": { ... },
  "status": "ready",
  "message": "Clone created successfully with ID: clone_7c20aef7"
}
```

### `list_clones(active_only?)`
List all AI clones.

**Parameters:**
- `active_only` (boolean, optional): If true, only return active clones

**Returns:**
```json
{
  "count": 2,
  "clones": [ ... ]
}
```

### `get_clone(clone_id)`
Get details of a specific clone.

**Parameters:**
- `clone_id` (string): The ID of the clone to retrieve

**Returns:** Clone details or error object

### `send_prompt(clone_id, prompt, context?)`
Send a prompt to a specific clone.

**Parameters:**
- `clone_id` (string): The target clone ID
- `prompt` (string): The prompt to send
- `context` (string, optional): Additional context

**Returns:**
```json
{
  "clone_id": "clone_7c20aef7",
  "prompt": "Your question here",
  "response": "Clone's response",
  "timestamp": 1234567890
}
```

### `terminate_clone(clone_id, save_log?)`
Terminate a specific clone.

**Parameters:**
- `clone_id` (string): The ID of the clone to terminate
- `save_log` (boolean, optional): Whether to save the clone's log before termination

### `terminate_all(save_logs?)`
Terminate all clones.

**Parameters:**
- `save_logs` (boolean, optional): Whether to save logs before termination

### `clone_status(clone_id?)`
Get status information about clones.

**Parameters:**
- `clone_id` (string, optional): Specific clone ID (if omitted, returns overall status)

### `set_clone_config(clone_id, updates)`
Update configuration for a clone.

**Parameters:**
- `clone_id` (string): The target clone ID
- `updates` (object): Configuration parameters to update

## Usage Examples

### Python

```python
from plugins.plugin_self_replicate import SelfReplicatePlugin

# Initialize the plugin
plugin = SelfReplicatePlugin()

# Create a coding assistant clone
result = plugin.call('clone', 
    'You are a coding assistant specialized in Python development',
    role='coder',
    specialization='python'
)

# Get the clone ID
clone_id = result['clone_id']

# Send a prompt to the clone
response = plugin.call('send_prompt', 
    clone_id, 
    'Help me write a function to sort a list'
)

# List all clones
clones = plugin.call('list_clones')

# Check status
status = plugin.call('clone_status')

# Terminate when done
plugin.call('terminate_clone', clone_id)
```

### TypeScript

```typescript
import { SelfReplicatePlugin } from './plugins/self_replicate';

// Initialize the plugin
const plugin = new SelfReplicatePlugin();

// Create a research assistant clone
const result = plugin.clone(
    'You are a research assistant focused on scientific literature',
    undefined,
    'researcher',
    'science'
);

// Send a prompt
const response = plugin.sendPrompt(
    result.clone_id,
    'Summarize recent advances in quantum computing'
);

// List all clones
const clones = plugin.listClones();

// Terminate when done
plugin.terminateClone(result.clone_id);
```

## Use Cases

1. **Multi-Agent Workflows**: Create specialized clones for different tasks (coding, research, analysis)
2. **Parallel Processing**: Run multiple clones simultaneously on different aspects of a problem
3. **Role-Playing**: Assign different personas to clones for diverse perspectives
4. **Task Isolation**: Keep different projects/contexts separate in different clones
5. **Testing & Development**: Test different prompts/configurations without affecting the main AI

## File Structure

Clones are stored in the `/clones` directory:
- `{clone_id}.state.json`: Clone state and configuration
- `{clone_id}.log.json`: Interaction history (saved on termination)

## Integration with Plugin Manager

The plugin automatically registers with the plugin manager and exposes its tools through the standard plugin interface:

```python
from plugin_manager.manager import PluginManager

manager = PluginManager()
manager.discover()

# Access the self-replication tools
result = manager.call('self_replicate', 'clone', 'Your prompt', role='assistant')
```

## Notes

- Clones are logical instances by default (not separate processes)
- Each clone maintains its own conversation history and state
- Clone states persist across sessions via disk storage
- For production use, integrate with actual model inference in `_process_clone_prompt()`
