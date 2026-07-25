# Skills

Skills are expert modules added to the Mixture of Experts (MoE) system in Prometheus Elastic Core. They provide specialized capabilities for specific domains and tasks.

## Overview

**Definition**: A skill is an expert added into the MoE (Mixture of Experts).

**Key Feature**: Skills are automatically routed to by the MoE when their expertise is needed, enabling efficient and specialized processing.

## Skill Categories

### Core Skills

None of these skills have a dedicated wiki page yet (the individual
`Skill-*` pages this section used to link to don't exist), so the entries
below are plain names, not links.

| Skill | Description |
|-------|-------------|
| Plugin-Maker | Creates new plugins dynamically |
| Skill-Maker | Creates new skills dynamically |
| Coding | Programming in 500+ languages |
| Image | Image generation and processing |
| Video | Video creation and editing |
| Game | Game development and logic |

### Programming Skills

The coding skill supports 500+ programming languages:

**Popular Languages:**
- JavaScript/TypeScript
- Python
- C/C++/C#
- Java
- Go
- Rust
- Ruby
- PHP

**Specialized Languages:**
- SQL
- Shell (Bash, Zsh)
- Assembly (x86, ARM)
- CUDA
- Verilog/VHDL

**And many more:** ABAP, Ada, Agda, Alloy, Apex, APL, Arduino, ATS, Awk, Ballerina, Clojure, COBOL, Crystal, D, Dart, Elixir, Elm, Erlang, F#, Factor, Fortran, Haskell, Haxe, Io, Julia, Kotlin, Lisp, Lua, MATLAB, Nim, OCaml, Pascal, Perl, Prolog, R, Scala, Smalltalk, Swift, Tcl, VHDL, Visual Basic, Zig, and hundreds more.

## Creating a Skill

There's no `ExpertBase` class anywhere in the codebase, and a skill isn't a
class you extend at all -- it's a plain data record (`SkillDefinition`,
`plugin_manager/types.ts`) registered against the plugin that implements it:

```typescript
// The real shape (plugin_manager/types.ts)
type SkillDefinition = {
    id: string;
    name: string;
    description: string;
    expertIndex: number;      // which MoE expert slot this skill routes to
    specialization: string;
    trainingData?: string;
    selfAuthored: boolean;
};
```

### Registering a Skill

Skills are registered on the `PluginRegistry` (`plugin_manager/registry.ts`),
against the raw numeric expert slot they route to on `MoERouter`
(`models && skills/core/moe-router.ts`) -- there is no `registerExpert()`
method, and an "expert" is a weight/bias array or `{id, name, specialization}`
config, not a class instance:

```typescript
const expertId = moeRouter.addExpert({
    id: 'coding-expert', name: 'Coding', specialization: 'programming',
});
registry.registerSkill(
    { id: 'coding', name: 'Coding', description: '...',
      expertIndex: expertId, specialization: 'programming', selfAuthored: false },
    pluginId,
);

// registry.listActiveSkills() / registry.getSkill('coding') surface it from here on
```

## How Skills Work with MoE

### Routing Process

1. **Input Analysis**: Input is analyzed for domain indicators
2. **Expert Selection**: MoE router selects top-K experts
3. **Load Balancing**: Ensures even distribution across experts
4. **Processing**: Selected experts process the input
5. **Output Combination**: Results are combined weighted by confidence

### Dynamic Expert Management

Skills can be:
- **Added**: New skills loaded at runtime
- **Removed**: Unused skills unloaded to save resources
- **Updated**: Skills retrained with new knowledge
- **Prioritized**: Important skills given higher routing weight

## Built-in Skills

### Plugin-Maker Skill

Creates new plugins on demand:
- Analyzes requirements
- Generates plugin code
- Tests functionality
- Registers with plugin manager

### Skill-Maker Skill

Creates new skills on demand:
- Identifies knowledge gaps
- Designs expert architecture
- Implements specialization
- Integrates with MoE

### Coding Skill

Comprehensive programming assistance:
- Code generation from descriptions
- Code review and optimization
- Debugging and error fixing
- Language translation
- Documentation generation

### Image Skill

Image processing capabilities:
- Image generation from text
- Image editing and manipulation
- Format conversion
- Analysis and recognition

### Video Skill

Video creation and editing:
- Video generation
- Editing operations
- Effects and transitions
- Format conversion

### Game Skill

Game development support:
- Game logic implementation
- Level design
- Character AI
- Physics simulation

## Training Skills

### Reinforcement Learning

Skills learn through the RLM (Reinforcement Learning Module):
- Positive reinforcement for successful outcomes
- Negative feedback for errors
- Experience replay for consolidation
- Loop detection to avoid mistakes

### Self-Improvement

Skills can improve themselves:
- Monitor performance metrics
- Identify weaknesses
- Request additional training
- Create sub-skills for specialization

## Using Skills

### Natural Language

```
> Write a Python function to sort a list
> Create a game with player movement
> Generate an image of a sunset
> Review this code for bugs
```

### Direct Invocation

```typescript
// Access skill metadata directly (advanced) -- getSkill() returns the
// SkillDefinition record, not a live object with a .generate() method
const skill = registry.getSkill('coding');
console.log(skill?.expertIndex, skill?.specialization);
```

## Skill Extensions

Skills can be extended through:

### Extension Files

Save learned capabilities as extensions:
```
name="advanced-sorting"
expert="coding"
vale="15"
conections=".sorting-basics"*"0.8"+"0.3"
```

### Code-to-Net Import

Import binary code as skill components:
```
code@sortlib="sorting_library"
"sortlib"@code="0x7F454C46..."
```

## Best Practices

1. **Specialization**: Keep skills focused on specific domains
2. **Efficiency**: Optimize for fast routing and processing
3. **Modularity**: Design skills to work independently
4. **Documentation**: Document skill capabilities clearly
5. **Testing**: Thoroughly test skills before deployment

## Troubleshooting

### Skill Not Being Used

Check:
- Skill is registered with MoE
- Capabilities are properly defined
- Router has correct weights
- No conflicting experts

### Poor Performance

Optimize:
- Reduce skill complexity
- Improve training data
- Adjust routing weights
- Enable quantization

## See Also

- [[Home]] - Main wiki page
- [[Plugins]] - System plugins
- [[MoE]] - Mixture of Experts system
- [[Extensions]] - Self-built extensions
- [[RLM]] - Reinforcement learning

---

*Skills are the specialized experts that make Prometheus Elastic Core capable across diverse domains.*
