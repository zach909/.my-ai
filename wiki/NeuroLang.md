# NeuroLang Reference

NeuroLang is a custom neuron definition language used by Prometheus Elastic Core for long context processing and network specification.

## Overview

The model thinks in NeuroLang because it's built in the extension builder. All components and words are zipped, and the zipped version is quantized. Output is produced per-neuron: when a neuron exclusively has input, it's added to all neurons that fed into it.

Connections are drawn from the thesaurus, then defined by the dictionary.

## Syntax Reference

> **Note**: All neurons are connected by default. If a connection field is left blank, it uses the default all-to-all connectivity.

### Basic Neuron Definition

#### Create and Name a Neuron
```
name="example"
```

#### Set Elastic-Core Value
Higher value means the neuron changes less (more stable knowledge).
```
"name"@vale="number"
```

#### Define Connections
Default is all-to-all if not filled in.
```
"name"@conections=".names/verable"*"bias"+"wate"
```

#### Define Output for Input-Only Case
```
"name"@definishon="definshon"
```

### Advanced Features

#### Code-to-Net Import

Name a code-to-net import:
```
code@name="name"
```

Add the code net:
```
"name"@code="code"
```

#### Net Search

Name and location for net search:
```
"netsearch"@name="name"
"netsearch"@net="location"
```

## Examples

### Simple Neuron Network

```
name="input_layer"
vale="10"

name="hidden_layer"
vale="5"
conections=".input_layer"*"0.5"+"1.0"

name="output_layer"
vale="8"
conections=".hidden_layer"*"0.7"+"0.5"
definishon="final_output"
```

### Code-to-Net Example

```
code@binary_import="my_function"
"binary_import"@code="0x89504E47..."
```

### Net Search Configuration

```
"netsearch"@name="knowledge_base"
"netsearch"@net="/models/knowledge/search.net"
```

## Processing Pipeline

When NeuroLang code is processed:

1. **Parsing**: The NeuroLang interpreter parses the syntax
2. **Zipping**: All components and words are compressed
3. **Quantization**: Zipped version is quantized (4-bit)
4. **Network Construction**: Neurons and connections are built
5. **Propagation**: Activations flow through the network
6. **Output Generation**: Per-neuron outputs are combined

## Integration with System

NeuroLang integrates with:

- **Extension Builder**: Visual interface for creating NeuroLang networks
- **MoE Routing**: NeuroLang-defined experts can be routed to
- **All-to-All Mesh**: NeuroLang networks connect to the main neuron mesh
- **Zip I/O Loop**: Inputs and outputs work as zip loops for extended context

## Best Practices

1. **Value Allocation**: Use higher values for stable, important knowledge
2. **Connection Design**: Leverage default all-to-all connectivity when possible
3. **Modularity**: Create reusable neuron modules as extensions
4. **Code Import**: Use code-to-net for integrating existing binary functionality
5. **Search Optimization**: Configure net search for efficient neuron lookup

## See Also

- [[Home]] - Main wiki page
- [[Architecture]] - System architecture overview
- [[Extensions]] - Self-built extensions
- [[Builder]] - Extension Builder interface
- [[Syntax]] - Detailed syntax reference

---

*NeuroLang is the foundation of the Prometheus Elastic Core's neural network definition and processing system.*
