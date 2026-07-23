"""
Comprehensive tests for ASI Neural Core implementation.

Tests cover:
1. Neural Core - neurons, layers, connections, learning
2. Neural States - state management, plasticity rules
3. Integration - combined system behavior
"""

import unittest
import time
import sys
import os

# Add workspace to path
sys.path.insert(0, '/workspace')

from asi_core import (
    NeuralCore,
    NeuralLayer,
    Neuron,
    Synapse,
    ActivationFunction,
    NeuronType,
    NeuralState,
    SynapticState,
    StateManager,
    LearningSystem,
    LearningRule,
    StateType
)


class TestNeuralCore(unittest.TestCase):
    """Tests for the NeuralCore class."""
    
    def test_neural_core_creation(self):
        """Test that NeuralCore initializes correctly."""
        core = NeuralCore()
        
        self.assertEqual(len(core.layers), 4)
        self.assertIn('input', core.layers)
        self.assertIn('hidden1', core.layers)
        self.assertIn('hidden2', core.layers)
        self.assertIn('output', core.layers)
        
        total_neurons = sum(len(l.neurons) for l in core.layers.values())
        self.assertEqual(total_neurons, 352)  # 64 + 128 + 128 + 32
    
    def test_custom_config(self):
        """Test NeuralCore with custom configuration."""
        config = {
            'layers': [
                {'id': 'sensory', 'size': 32, 'type': 'SENSORY'},
                {'id': 'processing', 'size': 64, 'type': 'INTERNEURON'},
                {'id': 'motor', 'size': 16, 'type': 'MOTOR'}
            ],
            'connection_probability': 0.2,
            'recurrent_connections': True
        }
        
        core = NeuralCore(config)
        
        self.assertEqual(len(core.layers), 3)
        total_neurons = sum(len(l.neurons) for l in core.layers.values())
        self.assertEqual(total_neurons, 112)
    
    def test_update_cycle(self):
        """Test that update cycles execute without errors."""
        core = NeuralCore()
        
        for i in range(10):
            result = core.update(dt=0.001)
            
            self.assertIn('time', result)
            self.assertIn('activations', result)
            self.assertIn('statistics', result)
            # Use approximate equality for floating point
            self.assertAlmostEqual(result['time'], (i + 1) * 0.001, places=5)
    
    def test_neuromodulator_application(self):
        """Test neuromodulator effects on learning."""
        core = NeuralCore()
        
        initial_dopamine = core.neuromodulators['dopamine']
        self.assertEqual(initial_dopamine, 0.5)
        
        core.apply_neuromodulator('dopamine', 0.9)
        self.assertEqual(core.neuromodulators['dopamine'], 0.9)
        
        # Test clamping
        core.apply_neuromodulator('dopamine', 1.5)
        self.assertEqual(core.neuromodulators['dopamine'], 1.0)
        
        core.apply_neuromodulator('dopamine', -0.1)
        self.assertEqual(core.neuromodulators['dopamine'], 0.0)
    
    def test_learning_events(self):
        """Test that learning events occur during updates."""
        core = NeuralCore()
        
        initial_events = core.learning_events
        
        for _ in range(5):
            core.update(dt=0.001)
        
        self.assertGreater(core.learning_events, initial_events)
    
    def test_activity_statistics(self):
        """Test activity statistics calculation."""
        core = NeuralCore()
        
        # Run some updates to generate activity
        for _ in range(10):
            core.update(dt=0.001)
        
        stats = core.get_activity_statistics()
        
        self.assertIn('layers', stats)
        self.assertIn('average_activation', stats)
        self.assertIn('total_spikes', stats)
        self.assertIn('active_neurons', stats)
        
        self.assertGreaterEqual(stats['average_activation'], 0.0)
        self.assertLessEqual(stats['average_activation'], 1.0)
    
    def test_state_save_load(self):
        """Test saving and loading neural core state."""
        core = NeuralCore()
        
        # Run some updates
        for _ in range(5):
            core.update(dt=0.001)
        
        # Save state
        state = core.save_state()
        
        self.assertIn('config', state)
        self.assertIn('current_time', state)
        self.assertIn('layers', state)
        
        # Create new core and load state
        core2 = NeuralCore()
        core2.load_state(state)
        
        self.assertEqual(core2.current_time, core.current_time)
        self.assertEqual(core2.config, core.config)


class TestNeuralLayer(unittest.TestCase):
    """Tests for NeuralLayer class."""
    
    def test_layer_creation(self):
        """Test layer creation with different neuron types."""
        layer = NeuralLayer('test', 50, NeuronType.EXCITATORY)
        
        self.assertEqual(len(layer.neurons), 50)
        self.assertEqual(layer.layer_id, 'test')
        self.assertEqual(layer.neuron_type, NeuronType.EXCITATORY)
    
    def test_layer_connections(self):
        """Test connection creation within layer."""
        layer = NeuralLayer('test', 20)
        # Manually create additional connections for testing
        layer._create_sparse_connections(connection_probability=0.3)
        
        # Count connections
        total_synapses = sum(
            len(n.incoming_synapses) 
            for n in layer.neurons.values()
        )
        
        # With 20 neurons and 0.3 probability, expect ~20*19*0.3 = 114 synapses
        self.assertGreater(total_synapses, 50)
    
    def test_layer_update(self):
        """Test layer update cycle."""
        layer = NeuralLayer('test', 10)
        
        activations = layer.update(dt=0.001)
        
        self.assertEqual(len(activations), 10)
        for neuron_id, activation in activations.items():
            self.assertGreaterEqual(activation, 0.0)
            self.assertLessEqual(activation, 1.0)


class TestNeuron(unittest.TestCase):
    """Tests for individual Neuron class."""
    
    def test_neuron_activation_functions(self):
        """Test different activation functions."""
        for fn in ActivationFunction:
            neuron = Neuron(id=f'test_{fn.value}', activation_fn=fn)
            result = neuron.activate(1.0, dt=0.001)
            
            self.assertIsInstance(result, float)
            
            # Most functions should produce bounded output
            if fn in [ActivationFunction.SIGMOID, ActivationFunction.TANH]:
                self.assertGreaterEqual(result, -1.0)
                self.assertLessEqual(result, 1.0)
    
    def test_neuron_spike_generation(self):
        """Test spike generation when threshold exceeded."""
        neuron = Neuron(id='test', threshold=0.3)
        current_time = time.time()
        
        # Provide strong input
        neuron.activate(2.0, dt=0.001)
        
        spiked = neuron.check_spike(current_time)
        self.assertTrue(spiked)
        self.assertEqual(neuron.total_spikes, 1)
    
    def test_refractory_period(self):
        """Test refractory period prevents immediate re-spiking."""
        neuron = Neuron(id='test', threshold=0.3)
        current_time = time.time()
        
        # First spike
        neuron.activate(2.0, dt=0.001)
        neuron.check_spike(current_time)
        
        # Should be in refractory
        self.assertTrue(neuron.in_refractory)
        
        # Second spike attempt immediately after should fail
        neuron.activate(2.0, dt=0.001)
        spiked_again = neuron.check_spike(current_time)
        
        self.assertFalse(spiked_again)


class TestSynapse(unittest.TestCase):
    """Tests for Synapse class."""
    
    def test_synapse_transmission(self):
        """Test signal transmission through synapse."""
        synapse = Synapse(source_id='pre', target_id='post', weight=0.5)
        
        output = synapse.transmit(0.8)
        
        self.assertAlmostEqual(output, 0.4, places=5)
    
    def test_hebbian_learning(self):
        """Test Hebbian weight update."""
        synapse = Synapse(source_id='pre', target_id='post', weight=0.5)
        
        initial_weight = synapse.weight
        synapse.update_weight_hebbian(0.8, 0.9, dt=0.01)
        
        # Weight should increase
        self.assertGreater(synapse.weight, initial_weight)
    
    def test_weight_clamping(self):
        """Test that weights are clamped to valid range."""
        synapse = Synapse(source_id='pre', target_id='post', weight=0.9)
        
        # Apply many learning updates
        for _ in range(1000):
            synapse.update_weight_hebbian(1.0, 1.0, dt=0.1)
        
        self.assertLessEqual(synapse.weight, 1.0)
        self.assertGreaterEqual(synapse.weight, -1.0)


class TestNeuralState(unittest.TestCase):
    """Tests for NeuralState class."""
    
    def test_state_creation(self):
        """Test NeuralState initialization."""
        state = NeuralState(neuron_id='test_1')
        
        self.assertEqual(state.neuron_id, 'test_1')
        self.assertEqual(state.membrane_potential, 0.0)
        self.assertEqual(state.activation, 0.0)
    
    def test_firing_rate_calculation(self):
        """Test firing rate estimation."""
        state = NeuralState(neuron_id='test')
        base_time = time.time()
        
        # Add 10 spikes over 1 second
        for i in range(10):
            state.spike_times.append(base_time + i * 0.1)
        
        state.update_firing_rate(base_time + 1.0)
        
        # Should be approximately 10 Hz (allow larger delta due to timing variations)
        self.assertAlmostEqual(state.average_firing_rate, 10.0, delta=2.0)
    
    def test_eligibility_trace_decay(self):
        """Test eligibility trace decay over time."""
        state = NeuralState(neuron_id='test')
        state.eligibility_trace = 1.0
        
        state.update_eligibility_trace(dt=0.1)
        
        self.assertLess(state.eligibility_trace, 1.0)
        self.assertGreater(state.eligibility_trace, 0.0)
    
    def test_state_serialization(self):
        """Test state to dictionary conversion."""
        state = NeuralState(neuron_id='test')
        state.activation = 0.5
        state.membrane_potential = -0.3
        
        state_dict = state.to_dict()
        
        self.assertEqual(state_dict['neuron_id'], 'test')
        self.assertEqual(state_dict['activation'], 0.5)
        self.assertEqual(state_dict['membrane_potential'], -0.3)


class TestSynapticState(unittest.TestCase):
    """Tests for SynapticState class."""
    
    def test_synaptic_state_creation(self):
        """Test SynapticState initialization."""
        state = SynapticState(source_id='pre', target_id='post')
        
        self.assertEqual(state.source_id, 'pre')
        self.assertEqual(state.target_id, 'post')
        self.assertEqual(state.learning_rule, LearningRule.HEBBIAN)
    
    def test_multiple_learning_rules(self):
        """Test different learning rules produce different results."""
        # Hebbian
        syn_hebbian = SynapticState(source_id='pre', target_id='post', weight=0.5)
        syn_hebbian.apply_hebbian(0.8, 0.9, dt=0.01)
        
        # Oja
        syn_oja = SynapticState(source_id='pre', target_id='post', weight=0.5)
        syn_oja.apply_oja(0.8, 0.9, dt=0.01)
        
        # BCM
        syn_bcm = SynapticState(source_id='pre', target_id='post', weight=0.5)
        syn_bcm.apply_bcm(0.8, 0.9, dt=0.01)
        
        # All should change weight but by different amounts
        self.assertNotEqual(syn_hebbian.weight, 0.5)
        self.assertNotEqual(syn_oja.weight, 0.5)
        self.assertNotEqual(syn_bcm.weight, 0.5)
    
    def test_stdp_timing_dependence(self):
        """Test STDP depends on spike timing order."""
        synapse = SynapticState(source_id='pre', target_id='post', weight=0.5)
        
        # Pre before post (should strengthen)
        synapse.apply_stdp(pre_spike_time=0.0, post_spike_time=0.01)
        weight_ltp = synapse.weight
        
        # Reset
        synapse.weight = 0.5
        
        # Post before pre (should weaken)
        synapse.apply_stdp(pre_spike_time=0.01, post_spike_time=0.0)
        weight_ltd = synapse.weight
        
        self.assertGreater(weight_ltp, weight_ltd)


class TestStateManager(unittest.TestCase):
    """Tests for StateManager class."""
    
    def test_manager_initialization(self):
        """Test StateManager creates with correct defaults."""
        manager = StateManager()
        
        self.assertEqual(len(manager.neuron_states), 0)
        self.assertEqual(len(manager.synapse_states), 0)
        self.assertIn('dopamine', manager.global_state['neuromodulators'])
    
    def test_neuron_registration(self):
        """Test registering neurons."""
        manager = StateManager()
        
        for i in range(10):
            manager.register_neuron(f'neuron_{i}')
        
        self.assertEqual(len(manager.neuron_states), 10)
    
    def test_synapse_registration(self):
        """Test registering synapses."""
        manager = StateManager()
        
        for i in range(5):
            manager.register_synapse(f'n{i}', f'n{i+1}')
        
        self.assertEqual(len(manager.synapse_states), 5)
    
    def test_statistics_calculation(self):
        """Test statistics calculation."""
        manager = StateManager()
        
        # Add neurons with varying activations
        for i in range(10):
            state = manager.register_neuron(f'n{i}')
            state.activation = i / 10.0
        
        stats = manager.get_statistics()
        
        self.assertEqual(stats['neurons']['count'], 10)
        self.assertGreater(stats['neurons']['active_count'], 0)
    
    def test_neuromodulator_setting(self):
        """Test setting neuromodulator levels."""
        manager = StateManager()
        
        manager.set_neuromodulator('dopamine', 0.8)
        self.assertEqual(manager.global_state['neuromodulators']['dopamine'], 0.8)
        
        # Test clamping
        manager.set_neuromodulator('dopamine', 1.5)
        self.assertEqual(manager.global_state['neuromodulators']['dopamine'], 1.0)


class TestLearningSystem(unittest.TestCase):
    """Tests for LearningSystem class."""
    
    def test_learning_system_creation(self):
        """Test LearningSystem initialization."""
        manager = StateManager()
        system = LearningSystem(manager)
        
        self.assertEqual(system.state_manager, manager)
        self.assertIn(LearningRule.HEBBIAN, system.active_rules)
    
    def test_learning_application(self):
        """Test applying learning rules."""
        manager = StateManager()
        
        # Create connected neurons
        pre = manager.register_neuron('pre')
        post = manager.register_neuron('post')
        pre.activation = 0.8
        post.activation = 0.9
        
        manager.register_synapse('pre', 'post', weight=0.5)
        
        system = LearningSystem(manager)
        initial_weight = manager.synapse_states['pre->post'].weight
        
        system.apply_learning(dt=0.01)
        
        final_weight = manager.synapse_states['pre->post'].weight
        self.assertGreater(final_weight, initial_weight)
    
    def test_reinforcement_learning(self):
        """Test three-factor reinforcement learning."""
        manager = StateManager()
        
        pre = manager.register_neuron('pre')
        post = manager.register_neuron('post')
        post.eligibility_trace = 0.5
        
        manager.register_synapse('pre', 'post', weight=0.5)
        
        system = LearningSystem(manager)
        initial_weight = manager.synapse_states['pre->post'].weight
        
        # Positive reward
        system.apply_reinforcement(reward=1.0, dt=0.01)
        
        final_weight = manager.synapse_states['pre->post'].weight
        self.assertGreater(final_weight, initial_weight)


class TestIntegration(unittest.TestCase):
    """Integration tests combining multiple components."""
    
    def test_core_with_states(self):
        """Test NeuralCore integrated with StateManager."""
        core = NeuralCore()
        manager = StateManager()
        
        # Register states for core neurons
        for layer_id, layer in core.layers.items():
            for neuron_id, neuron in layer.neurons.items():
                manager.register_neuron(neuron_id)
        
        # Run core and update states
        for _ in range(5):
            result = core.update(dt=0.001)
            
            # Sync activations to state manager
            for layer_id, activations in result['activations'].items():
                for neuron_id, activation in activations.items():
                    state = manager.get_neuron_state(neuron_id)
                    if state:
                        state.activation = activation
        
        stats = manager.get_statistics()
        self.assertEqual(stats['neurons']['count'], 352)
    
    def test_full_learning_cycle(self):
        """Test complete learning cycle with feedback."""
        core = NeuralCore()
        manager = StateManager()
        learning_system = LearningSystem(manager)
        
        # Initialize
        for layer_id, layer in core.layers.items():
            for neuron_id in layer.neurons.keys():
                manager.register_neuron(neuron_id)
        
        # Run learning cycle
        for step in range(10):
            # Forward pass
            result = core.update(dt=0.001)
            
            # Update states
            for layer_id, activations in result['activations'].items():
                for neuron_id, activation in activations.items():
                    state = manager.get_neuron_state(neuron_id)
                    if state:
                        state.activation = activation
            
            # Update manager time and record snapshot
            manager.update_time(0.001)
            manager.record_state_snapshot()
            
            # Apply learning
            learning_system.apply_learning(dt=0.001)
        
        # Verify learning occurred
        self.assertGreater(manager.global_state['time'], 0)
        self.assertGreater(len(manager.state_history), 0)


def run_tests():
    """Run all tests and return results."""
    loader = unittest.TestLoader()
    suite = unittest.TestSuite()
    
    # Add all test classes
    suite.addTests(loader.loadTestsFromTestCase(TestNeuralCore))
    suite.addTests(loader.loadTestsFromTestCase(TestNeuralLayer))
    suite.addTests(loader.loadTestsFromTestCase(TestNeuron))
    suite.addTests(loader.loadTestsFromTestCase(TestSynapse))
    suite.addTests(loader.loadTestsFromTestCase(TestNeuralState))
    suite.addTests(loader.loadTestsFromTestCase(TestSynapticState))
    suite.addTests(loader.loadTestsFromTestCase(TestStateManager))
    suite.addTests(loader.loadTestsFromTestCase(TestLearningSystem))
    suite.addTests(loader.loadTestsFromTestCase(TestIntegration))
    
    # Run tests
    runner = unittest.TextTestRunner(verbosity=2)
    result = runner.run(suite)
    
    return result


if __name__ == '__main__':
    result = run_tests()
    
    # Print summary
    print("\n" + "="*60)
    print("TEST SUMMARY")
    print("="*60)
    print(f"Tests run: {result.testsRun}")
    print(f"Failures: {len(result.failures)}")
    print(f"Errors: {len(result.errors)}")
    print(f"Success: {result.wasSuccessful()}")
    
    sys.exit(0 if result.wasSuccessful() else 1)
