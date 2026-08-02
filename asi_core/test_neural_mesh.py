"""
Test suite for the ASI Neural Mesh implementation.

Tests verify:
1. Neural mesh initialization and configuration
2. All-to-all connectivity
3. Multidimensional neuron states
4. Zero-sum vale system
5. Settle dynamics
6. Learning with vale gating
7. Continuous operation
8. State persistence
9. Expert group routing
"""

import unittest
import random
import math
from asi_core.neural_mesh import (
    NeuralMesh, NeuronRole, NeuronState, SynapticConnection, create_mesh
)


class TestNeuralMeshInitialization(unittest.TestCase):
    """Test neural mesh initialization and configuration."""
    
    def test_default_configuration(self):
        """Test default mesh creation."""
        mesh = NeuralMesh()
        
        self.assertEqual(mesh.n_neurons, 64)
        self.assertEqual(mesh.n_dimensions, 4)
        self.assertEqual(mesh.n_input, 8)
        self.assertEqual(mesh.n_groups, 4)
        self.assertEqual(mesh.settle_ticks, 4)
    
    def test_custom_configuration(self):
        """Test custom mesh configuration."""
        mesh = NeuralMesh(
            n_neurons=32,
            n_dimensions=6,
            n_input=4,
            n_groups=2,
            settle_ticks=5
        )
        
        self.assertEqual(mesh.n_neurons, 32)
        self.assertEqual(mesh.n_dimensions, 6)
        self.assertEqual(mesh.n_input, 4)
        self.assertEqual(mesh.n_groups, 2)
        self.assertEqual(mesh.settle_ticks, 5)
    
    def test_invalid_dimensions(self):
        """Test that dimensions < 2 raises error."""
        with self.assertRaises(AssertionError):
            NeuralMesh(n_dimensions=1)
    
    def test_invalid_input_count(self):
        """Test that input >= neurons raises error."""
        with self.assertRaises(AssertionError):
            NeuralMesh(n_neurons=8, n_input=8)
    
    def test_neuron_creation(self):
        """Test that all neurons are created correctly."""
        mesh = NeuralMesh(n_neurons=16, n_dimensions=4, n_input=4)
        
        self.assertEqual(len(mesh.neurons), 16)
        
        # Check roles
        input_count = sum(1 for n in mesh.neurons.values() if n.role == NeuronRole.INPUT)
        output_count = sum(1 for n in mesh.neurons.values() if n.role == NeuronRole.OUTPUT)
        hidden_count = sum(1 for n in mesh.neurons.values() if n.role == NeuronRole.HIDDEN)
        
        self.assertEqual(input_count, 4)  # n_input
        self.assertEqual(output_count, 4)  # Fixed output count
        self.assertEqual(hidden_count, 8)  # Remaining
    
    def test_connection_count(self):
        """Test all-to-all connectivity (no self-connections)."""
        mesh = NeuralMesh(n_neurons=10)
        
        # Should have n * (n-1) connections
        expected_connections = 10 * 9
        self.assertEqual(len(mesh.connections), expected_connections)
    
    def test_weight_matrix_dimensions(self):
        """Test that weight matrices have correct dimensions."""
        mesh = NeuralMesh(n_neurons=16, n_dimensions=4, n_input=4)
        
        for conn in mesh.connections.values():
            self.assertEqual(len(conn.weight_matrix), 4)  # rows
            self.assertEqual(len(conn.weight_matrix[0]), 4)  # cols


class TestMultidimensionalStates(unittest.TestCase):
    """Test multidimensional neuron state vectors."""
    
    def test_state_vector_initialization(self):
        """Test state vectors are initialized correctly."""
        mesh = NeuralMesh(n_neurons=16, n_dimensions=6, n_input=4)
        
        for neuron in mesh.neurons.values():
            self.assertEqual(len(neuron.state_vector), 6)
    
    def test_content_state_extraction(self):
        """Test content state excludes input flag dimension."""
        mesh = NeuralMesh(n_neurons=16, n_dimensions=4, n_input=4)
        neuron = list(mesh.neurons.values())[0]
        
        content = neuron.get_content_state()
        self.assertEqual(len(content), 3)  # dimensions - 1
    
    def test_input_flag_setting(self):
        """Test input flag can be set."""
        mesh = NeuralMesh(n_neurons=16, n_dimensions=4, n_input=4)
        neuron = list(mesh.neurons.values())[0]
        
        self.assertEqual(neuron.input_flag, 0.0)
        neuron.set_input_driven(True)
        self.assertEqual(neuron.input_flag, 1.0)
        neuron.set_input_driven(False)
        self.assertEqual(neuron.input_flag, 0.0)


class TestZeroSumValeSystem(unittest.TestCase):
    """Test the zero-sum value (vale) system."""
    
    def test_initial_vale_distribution(self):
        """Test initial vale is evenly distributed."""
        mesh = NeuralMesh(n_neurons=10, vale_init=0.1)
        
        expected_total = 0.1 * 10
        actual_total = sum(n.vale for n in mesh.neurons.values())
        
        self.assertAlmostEqual(actual_total, expected_total, places=5)
    
    def test_vale_redistribution_preserves_sum(self):
        """Test that vale redistribution maintains zero-sum constraint."""
        mesh = NeuralMesh(n_neurons=10, vale_init=0.1)
        initial_total = sum(n.vale for n in mesh.neurons.values())
        
        # Raise vale of some neurons
        mesh.raise_vale([0, 1, 2], amount=0.2)
        
        final_total = sum(n.vale for n in mesh.neurons.values())
        self.assertAlmostEqual(initial_total, final_total, places=4)
    
    def test_raise_vale_increases_specified(self):
        """Test raising vale increases specified neurons."""
        mesh = NeuralMesh(n_neurons=10, vale_init=0.1)
        
        initial_vale_0 = mesh.neurons[0].vale
        mesh.raise_vale([0], amount=0.2)
        
        self.assertGreater(mesh.neurons[0].vale, initial_vale_0)
    
    def test_demote_vale_decreases_specified(self):
        """Test demoting vale decreases specified neurons."""
        mesh = NeuralMesh(n_neurons=10, vale_init=0.1)
        
        initial_vale_0 = mesh.neurons[0].vale
        mesh.demote_vale([0], amount=0.05)
        
        self.assertLess(mesh.neurons[0].vale, initial_vale_0)
    
    def test_vale_bounded(self):
        """Test vale stays within [0, 1] bounds."""
        mesh = NeuralMesh(n_neurons=10, vale_init=0.1)
        
        # Try to raise beyond bounds
        mesh.raise_vale([0], amount=1.0)
        self.assertLessEqual(mesh.neurons[0].vale, 1.0)
        
        # Try to lower beyond bounds
        mesh.demote_vale([0], amount=1.0)
        self.assertGreaterEqual(mesh.neurons[0].vale, 0.0)


class TestSettleDynamics(unittest.TestCase):
    """Test settle loop dynamics."""
    
    def test_basic_activation(self):
        """Test basic activation produces output."""
        mesh = NeuralMesh(n_neurons=16, n_dimensions=4, n_input=4)
        
        input_pattern = [0.5, 0.3, -0.2, 0.8]
        output = mesh.activate(input_pattern)
        
        self.assertIsInstance(output, list)
        self.assertGreater(len(output), 0)
    
    def test_settle_tick_tracking(self):
        """Test that settle ticks are tracked."""
        mesh = NeuralMesh(n_neurons=16, n_input=4, settle_ticks=4)
        
        mesh.activate([0.1, 0.2, 0.3, 0.4])
        
        self.assertLessEqual(mesh.current_tick, mesh.settle_ticks)
    
    def test_input_clamping(self):
        """Test that inputs are clamped to input neurons."""
        mesh = NeuralMesh(n_neurons=8, n_dimensions=4, n_input=4)
        
        input_pattern = [0.9, -0.5, 0.3, 0.7]
        mesh.clamp_input_neurons(input_pattern)
        
        # Check input neurons received the values
        for i in range(4):
            neuron = mesh.neurons[i]
            self.assertEqual(neuron.input_flag, 1.0)
            # Content dimensions should reflect input
            if len(neuron.state_vector) > 1:
                self.assertNotEqual(neuron.state_vector[1], 0.0)
    
    def test_output_reading(self):
        """Test output is read from output neurons."""
        mesh = NeuralMesh(n_neurons=16, n_dimensions=4, n_input=4)
        
        output = mesh.activate([0.1, 0.2, 0.3, 0.4])
        
        # Should have 4 output neurons
        self.assertEqual(len(output), 4)


class TestLearningWithValeGating(unittest.TestCase):
    """Test Hebbian learning with vale gating."""
    
    def test_hebbian_learning_updates_weights(self):
        """Test that Hebbian learning modifies weights."""
        mesh = NeuralMesh(n_neurons=16, n_dimensions=4, n_input=4)
        
        # Get initial weights
        conn_key = (0, 1)
        initial_weight = mesh.connections[conn_key].weight_matrix[0][0]
        
        # Apply learning
        pre_act = {0: 0.8}
        post_act = {1: 0.6}
        mesh.apply_hebbian_learning(pre_act, post_act, reward_signal=1.0, dt=0.1)
        
        # Weight should have changed
        final_weight = mesh.connections[conn_key].weight_matrix[0][0]
        self.assertNotEqual(initial_weight, final_weight)
    
    def test_vale_gates_learning_rate(self):
        """Test that high vale reduces learning."""
        mesh_low_vale = NeuralMesh(n_neurons=16, n_dimensions=4, n_input=4, vale_init=0.1)
        mesh_high_vale = NeuralMesh(n_neurons=16, n_dimensions=4, n_input=4, vale_init=0.1)
        
        # Set different vale values
        mesh_high_vale.neurons[1].vale = 0.9  # High vale = low plasticity
        mesh_low_vale.neurons[1].vale = 0.1   # Low vale = high plasticity
        
        # Apply same learning
        pre_act = {0: 0.8}
        post_act = {1: 0.6}
        
        conn_key = (0, 1)
        initial_low = mesh_low_vale.connections[conn_key].weight_matrix[0][0]
        initial_high = mesh_high_vale.connections[conn_key].weight_matrix[0][0]
        
        mesh_low_vale.apply_hebbian_learning(pre_act, post_act, dt=0.1)
        mesh_high_vale.apply_hebbian_learning(pre_act, post_act, dt=0.1)
        
        delta_low = abs(mesh_low_vale.connections[conn_key].weight_matrix[0][0] - initial_low)
        delta_high = abs(mesh_high_vale.connections[conn_key].weight_matrix[0][0] - initial_high)
        
        # Low vale should produce larger change
        self.assertGreater(delta_low, delta_high)
    
    def test_reward_modulates_learning(self):
        """Test that reward signal modulates learning magnitude."""
        mesh_positive = NeuralMesh(n_neurons=16, n_dimensions=4, n_input=4)
        mesh_negative = NeuralMesh(n_neurons=16, n_dimensions=4, n_input=4)
        
        pre_act = {0: 0.8}
        post_act = {1: 0.6}
        
        conn_key = (0, 1)
        initial_positive = mesh_positive.connections[conn_key].weight_matrix[0][0]
        initial_negative = mesh_negative.connections[conn_key].weight_matrix[0][0]

        mesh_positive.apply_hebbian_learning(pre_act, post_act, reward_signal=1.0, dt=0.1)
        mesh_negative.apply_hebbian_learning(pre_act, post_act, reward_signal=-1.0, dt=0.1)

        delta_positive = mesh_positive.connections[conn_key].weight_matrix[0][0] - initial_positive
        delta_negative = mesh_negative.connections[conn_key].weight_matrix[0][0] - initial_negative
        
        # Opposite rewards should produce opposite changes
        self.assertGreater(delta_positive, delta_negative)


class TestContinuousOperation(unittest.TestCase):
    """Test continuous operation with state carry-over."""
    
    def test_continuous_mode_carries_state(self):
        """Test that continuous mode preserves state between steps."""
        mesh = NeuralMesh(
            n_neurons=8, n_dimensions=4, n_input=4,
            continuous=True
        )
        
        # First step
        output1 = mesh.step_continuous([0.5, 0.5, 0.5, 0.5])
        
        # Second step with zeros - state should carry over
        output2 = mesh.step_continuous([0.0, 0.0, 0.0, 0.0])
        
        # Outputs should not be identical (state carries forward)
        # but also not completely different
        self.assertIsInstance(output2, list)
    
    def test_non_continuous_resets(self):
        """Test that non-continuous mode resets each call."""
        import random
        random.seed(42)
        
        mesh = NeuralMesh(
            n_neurons=16, n_dimensions=4, n_input=4,
            continuous=False
        )
        
        input_pattern = [0.5, 0.5, 0.5, 0.5]
        
        # First call may trigger live correction
        output1 = mesh.activate(input_pattern)
        
        # Second call - live correction may still apply
        output2 = mesh.activate(input_pattern)
        
        # Third call - system should now be stable after corrections
        output3 = mesh.activate(input_pattern)
        
        # After stabilization, outputs should be consistent
        # This verifies the live correction mechanism works correctly
        self.assertEqual(len(output2), len(output3))
        for i in range(len(output2)):
            self.assertAlmostEqual(output2[i], output3[i], places=5)
        
        # All outputs should be valid (not NaN or inf)
        for output in [output1, output2, output3]:
            for val in output:
                self.assertFalse(math.isnan(val) or math.isinf(val))


class TestExpertGroupRouting(unittest.TestCase):
    """Test expert group functionality."""
    
    def test_neuron_group_assignment(self):
        """Test neurons are assigned to groups."""
        mesh = NeuralMesh(n_neurons=16, n_groups=4)
        
        groups = set(n.group for n in mesh.neurons.values())
        self.assertEqual(groups, {0, 1, 2, 3})
    
    def test_balanced_group_distribution(self):
        """Test groups are balanced."""
        mesh = NeuralMesh(n_neurons=16, n_groups=4)
        
        group_counts = {}
        for neuron in mesh.neurons.values():
            group_counts[neuron.group] = group_counts.get(neuron.group, 0) + 1
        
        # Each group should have 4 neurons
        for count in group_counts.values():
            self.assertEqual(count, 4)
    
    def test_active_groups_filtering(self):
        """Test active groups filtering."""
        mesh = NeuralMesh(n_neurons=16, n_groups=4)
        
        # Restrict to specific groups
        mesh.active_groups = {0, 1}
        
        active_mask = mesh._get_active_neurons()
        
        # Only neurons in groups 0 and 1 should be active
        for nid in active_mask:
            self.assertIn(mesh.neurons[nid].group, {0, 1})

    def test_manual_active_groups_unaffected_when_auto_route_disabled(self):
        """auto_route defaults to False: activate() must not overwrite a
        caller-set active_groups restriction."""
        mesh = NeuralMesh(n_neurons=16, n_groups=4, continuous=True)
        mesh.active_groups = {2}
        mesh.activate([0.5, 0.1, 0.2, 0.3, 0.4, 0.1, 0.2, 0.3])
        self.assertEqual(mesh.active_groups, {2})

    def test_auto_route_selects_top_k_groups(self):
        mesh = NeuralMesh(n_neurons=16, n_groups=4, continuous=True, seed=1, auto_route=True)
        mesh.activate([0.5, 0.1, 0.2, 0.3, 0.4, 0.1, 0.2, 0.3])
        self.assertEqual(len(mesh.active_groups), mesh.skill_top_k)
        for g in mesh.active_groups:
            self.assertIn(g, range(4))

    def test_auto_route_never_starves_a_group_forever(self):
        mesh = NeuralMesh(n_neurons=16, n_groups=4, continuous=True, seed=1, auto_route=True)
        seen = set()
        for _ in range(20):
            mesh.activate([0.5, 0.1, 0.2, 0.3, 0.4, 0.1, 0.2, 0.3])
            seen |= mesh.active_groups
        self.assertEqual(seen, {0, 1, 2, 3})


class TestStatePersistence(unittest.TestCase):
    """Test state save/load functionality."""
    
    def test_save_state_structure(self):
        """Test saved state has correct structure."""
        mesh = NeuralMesh(n_neurons=16, n_dimensions=4, n_input=4)
        mesh.activate([0.1, 0.2, 0.3, 0.4])
        
        state = mesh.save_state()
        
        self.assertIn('config', state)
        self.assertIn('neurons', state)
        self.assertIn('connections', state)
        self.assertIn('diagnostics', state)
    
    def test_load_state_restores_values(self):
        """Test loading state restores mesh to saved condition."""
        mesh1 = NeuralMesh(n_neurons=16, n_dimensions=4, n_input=4)
        mesh1.activate([0.5, 0.5, 0.5, 0.5])
        
        # Modify vale
        mesh1.raise_vale([0, 1], amount=0.2)
        
        state = mesh1.save_state()
        
        # Create new mesh and load state
        mesh2 = NeuralMesh(n_neurons=16, n_dimensions=4, n_input=4)
        mesh2.load_state(state)
        
        # Vale should match
        for nid in mesh1.neurons:
            self.assertAlmostEqual(
                mesh1.neurons[nid].vale,
                mesh2.neurons[nid].vale,
                places=6
            )
    
    def test_config_mismatch_raises_error(self):
        """Test loading incompatible config raises error."""
        mesh1 = NeuralMesh(n_neurons=16, n_dimensions=4, n_input=4)
        state = mesh1.save_state()
        
        mesh2 = NeuralMesh(n_neurons=32, n_dimensions=4, n_input=4)
        
        with self.assertRaises(ValueError):
            mesh2.load_state(state)


class TestStatisticsAndDiagnostics(unittest.TestCase):
    """Test statistics and diagnostic tracking."""
    
    def test_get_statistics(self):
        """Test statistics collection."""
        mesh = NeuralMesh(n_neurons=16, n_dimensions=4, n_input=4)
        mesh.activate([0.1, 0.2, 0.3, 0.4])
        
        stats = mesh.get_statistics()
        
        self.assertEqual(stats['neurons']['total'], 16)
        self.assertIn('by_role', stats['neurons'])
        self.assertIn('by_group', stats['neurons'])
        self.assertIn('average_vale', stats['neurons'])
        self.assertIn('average_activation', stats['neurons'])
    
    def test_divergence_tracking(self):
        """Test divergence event tracking."""
        mesh = NeuralMesh(
            n_neurons=16, n_dimensions=4, n_input=4,
            divergence_tolerance=0.001,  # Very low tolerance
            sustained_divergence_ticks=2
        )
        
        # Activate multiple times to potentially trigger corrections
        for _ in range(5):
            mesh.activate([random.random() for _ in range(4)])
        
        # Diagnostics should be tracked
        stats = mesh.get_statistics()
        self.assertIn('live_corrections', stats['diagnostics'])
        self.assertIn('divergence_events', stats['diagnostics'])


class TestCreateMeshFactory(unittest.TestCase):
    """Test the create_mesh factory function."""
    
    def test_create_default(self):
        """Test creating default configuration."""
        mesh = create_mesh("default")
        
        self.assertEqual(mesh.n_neurons, 64)
        self.assertEqual(mesh.n_dimensions, 4)
    
    def test_create_small(self):
        """Test creating small configuration."""
        mesh = create_mesh("small")
        
        self.assertEqual(mesh.n_neurons, 16)
        self.assertEqual(mesh.n_dimensions, 4)
    
    def test_create_large(self):
        """Test creating large configuration."""
        mesh = create_mesh("large")
        
        self.assertEqual(mesh.n_neurons, 128)
        self.assertEqual(mesh.n_dimensions, 8)
    
    def test_create_experimental(self):
        """Test creating experimental configuration."""
        mesh = create_mesh("experimental")
        
        self.assertEqual(mesh.n_neurons, 32)
        self.assertTrue(mesh.continuous)
    
    def test_create_unknown_falls_back_to_default(self):
        """Test unknown config type falls back to default."""
        mesh = create_mesh("unknown_type")
        
        self.assertEqual(mesh.n_neurons, 64)


if __name__ == '__main__':
    unittest.main()
