"""Tests for the Neural Definition Language parser (spec Part 5 sections 76-78)."""

import unittest

from asi_core.neural_dsl import (
    parse,
    parse_program,
    to_source,
    describe_extension,
    execute,
    netsearch,
    netsearch_train,
    code_to_net,
    wave_interference,
    claims_exclusive_input,
    literal_output,
    NDLError,
)
from asi_core.extension_system import Extension
from asi_core.neural_mesh import NeuralMesh


class TestParsing(unittest.TestCase):
    def test_spec_example_parses(self):
        source = """
        name="example"
        example@vale="50"
        example@definition="Handles image recognition"
        example@connections="vision*0.8+0.2"
        example@code="function"
        """
        neurons = parse(source)
        self.assertIn("example", neurons)
        neuron = neurons["example"]
        self.assertEqual(neuron.vale, 50.0)
        self.assertEqual(neuron.definition, "Handles image recognition")
        self.assertEqual(len(neuron.connections), 1)
        self.assertEqual(neuron.connections[0].target, "vision")
        self.assertAlmostEqual(neuron.connections[0].weight, 0.8)
        self.assertAlmostEqual(neuron.connections[0].bias, 0.2)
        self.assertEqual(neuron.code, "function")

    def test_multiple_neurons(self):
        source = '''
        name="a"
        a@vale="10"
        name="b"
        b@vale="20"
        '''
        neurons = parse(source)
        self.assertEqual(set(neurons.keys()), {"a", "b"})
        self.assertEqual(neurons["a"].vale, 10.0)
        self.assertEqual(neurons["b"].vale, 20.0)

    def test_attribute_before_name_still_creates_neuron(self):
        source = 'x@vale="5"\nname="x"\n'
        neurons = parse(source)
        self.assertIn("x", neurons)
        self.assertEqual(neurons["x"].vale, 5.0)

    def test_multiple_connection_terms(self):
        source = 'name="a"\na@connections="b*0.5+0.1;c*-0.3+0.0"\n'
        neurons = parse(source)
        conns = neurons["a"].connections
        self.assertEqual(len(conns), 2)
        self.assertEqual(conns[0].target, "b")
        self.assertEqual(conns[1].target, "c")
        self.assertAlmostEqual(conns[1].weight, -0.3)

    def test_comments_and_blank_lines_ignored(self):
        source = '# a comment\n\nname="a"\n\n# another\na@vale="1"\n'
        neurons = parse(source)
        self.assertEqual(neurons["a"].vale, 1.0)

    def test_type_attribute(self):
        neurons = parse('name="a"\na@type="skill"\n')
        self.assertEqual(neurons["a"].type, "skill")

    def test_unknown_attribute_raises(self):
        with self.assertRaises(NDLError):
            parse('name="a"\na@bogus="x"\n')

    def test_malformed_connection_raises(self):
        with self.assertRaises(NDLError):
            parse('name="a"\na@connections="not-a-connection"\n')

    def test_non_numeric_vale_raises(self):
        with self.assertRaises(NDLError):
            parse('name="a"\na@vale="fifty"\n')

    def test_unparseable_line_raises(self):
        with self.assertRaises(NDLError):
            parse("this is not ndl syntax")

    def test_empty_name_raises(self):
        with self.assertRaises(NDLError):
            parse('name=""\n')


class TestRoundTrip(unittest.TestCase):
    def test_parse_then_serialize_then_reparse_is_stable(self):
        source = 'name="a"\na@vale="50"\na@definition="desc"\na@connections="b*0.8+0.2"\na@code="fn"\na@type="skill"\n'
        neurons = parse(source)
        regenerated = to_source(neurons)
        reparsed = parse(regenerated)
        self.assertEqual(reparsed["a"], neurons["a"])


class TestExtensionSelfDescription(unittest.TestCase):
    def test_describe_extension_produces_valid_ndl(self):
        ext = Extension(name="coding", purpose="write code", skills=["pattern_1", "pattern_2"])
        source = describe_extension(ext)
        neurons = parse(source)
        self.assertEqual(set(neurons.keys()), {"pattern_1", "pattern_2"})
        self.assertEqual(neurons["pattern_1"].type, "skill")
        self.assertIn("coding", neurons["pattern_1"].definition)

    def test_describe_extension_with_no_skills_is_empty(self):
        ext = Extension(name="empty", purpose="x", skills=[])
        self.assertEqual(describe_extension(ext), "")


class TestValueAliasForVale(unittest.TestCase):
    def test_value_attribute_is_alias_for_vale(self):
        neurons = parse('name="a"\na@value="42"\n')
        self.assertEqual(neurons["a"].vale, 42.0)


class TestCodeImportGrammar(unittest.TestCase):
    def test_code_at_name_declares_neuron_before_its_body(self):
        source = 'code@name="foo"\nfoo@code="print(1)"\n'
        program = parse_program(source)
        self.assertIn("foo", program.neurons)
        self.assertTrue(program.neurons["foo"].code_import)
        self.assertEqual(program.neurons["foo"].code, "print(1)")

    def test_code_to_net_is_deterministic_and_distinguishes_code(self):
        v1 = code_to_net("def f(x): return x + 1")
        v2 = code_to_net("def f(x): return x + 1")
        v3 = code_to_net("def g(y): return y * 2")
        self.assertEqual(v1, v2)
        self.assertNotEqual(v1, v3)
        for value in v1:
            self.assertGreaterEqual(value, -1.0)
            self.assertLessEqual(value, 1.0)

    def test_code_to_net_empty_code_is_zero_vector(self):
        self.assertEqual(code_to_net(""), [0.0, 0.0, 0.0])


class TestNetSearch(unittest.TestCase):
    def test_netsearch_finds_relevant_design_doc_lines(self):
        matches = netsearch("mixture of experts")
        self.assertTrue(matches)
        self.assertTrue(any("expert" in m.lower() for m in matches))

    def test_netsearch_no_matches_for_unrelated_query(self):
        self.assertEqual(netsearch("xyzzy plugh qwertyuiop"), [])

    def test_netsearch_never_touches_the_network(self):
        """Hard constraint: netsearch must be pure local text search, never
        an outbound call -- verified by supplying a fully offline corpus
        and confirming results come only from it."""
        matches = netsearch("apple banana", corpus="apple pie is great\nbanana bread too\nunrelated line")
        self.assertEqual(set(matches), {"apple pie is great", "banana bread too"})

    def test_netsearch_train_produces_stable_dimensioned_vector(self):
        matches = netsearch("hyperdimensional thinking")
        vec = netsearch_train(matches, dimensions=32, ticks=3)
        self.assertEqual(vec.dimensions, 32)

    def test_netsearch_train_on_no_matches_returns_zero_state(self):
        vec = netsearch_train([], dimensions=16)
        self.assertEqual(sum(abs(x) for x in vec.data), 0.0)


class TestQuantumWaveInterference(unittest.TestCase):
    def test_matching_signature_gives_maximal_interference(self):
        self.assertAlmostEqual(wave_interference(4.5, 4.5), 1.0, places=6)

    def test_mismatched_signature_interferes_less(self):
        matched = wave_interference(4.5, 4.5)
        mismatched = wave_interference(4.5, 10.0)
        self.assertLess(mismatched, matched)

    def test_claims_exclusive_input_true_only_on_close_match(self):
        self.assertTrue(claims_exclusive_input(10.0, 10.0))
        self.assertFalse(claims_exclusive_input(4.5, 10.0))

    def test_interference_symmetric_in_arguments(self):
        self.assertAlmostEqual(wave_interference(3.0, 7.0), wave_interference(7.0, 3.0), places=9)


class TestExecute(unittest.TestCase):
    def test_execute_without_mesh_still_resolves_definitions_and_code(self):
        source = 'name="a"\na@definition="hello"\na@code="x=1"\n'
        result = execute(source)
        self.assertEqual(result.neuron_ids, {})
        self.assertEqual(result.definitions["a"], "hello")
        self.assertIn("a", result.code_imports)
        self.assertEqual(literal_output("a", result), "hello")
        self.assertIsNone(literal_output("nonexistent", result))

    def test_execute_creates_named_neurons_in_mesh(self):
        mesh = NeuralMesh(n_neurons=8, n_dimensions=2, n_input=2, n_groups=2)
        source = 'name="vision"\nvision@definition="sees things"\n'
        result = execute(source, mesh=mesh)
        self.assertIn("vision", result.neuron_ids)
        nid = result.neuron_ids["vision"]
        self.assertIn(nid, mesh.neurons)
        self.assertEqual(mesh.get_group_name(mesh.neurons[nid].group), "vision")

    def test_execute_applies_vale_as_elastic_core_stake(self):
        mesh = NeuralMesh(n_neurons=8, n_dimensions=2, n_input=2, n_groups=2, seed=1)
        default_vale = mesh.vale_total / mesh.n_neurons
        source = 'name="stable"\nstable@vale="0.9"\n'
        result = execute(source, mesh=mesh)
        nid = result.neuron_ids["stable"]
        self.assertGreater(mesh.neurons[nid].vale, default_vale)

    def test_execute_applies_explicit_connection_override(self):
        mesh = NeuralMesh(n_neurons=8, n_dimensions=2, n_input=2, n_groups=2, seed=2)
        source = (
            'name="source"\n'
            'name="target"\n'
            'target@connections="source*0.75+0.3"\n'
        )
        result = execute(source, mesh=mesh)
        source_id = result.neuron_ids["source"]
        target_id = result.neuron_ids["target"]
        conn = mesh.connections[(source_id, target_id)]
        for row in conn.weight_matrix:
            for w in row:
                self.assertAlmostEqual(w, 0.75)
        self.assertAlmostEqual(mesh.neurons[target_id].dsl_bias, 0.3)

    def test_execute_forward_reference_in_connections_creates_target(self):
        mesh = NeuralMesh(n_neurons=8, n_dimensions=2, n_input=2, n_groups=2)
        source = 'name="a"\na@connections="b*0.5+0.0"\n'
        result = execute(source, mesh=mesh)
        self.assertIn("b", result.neuron_ids)

    def test_execute_runs_netsearch_and_creates_neuron(self):
        mesh = NeuralMesh(n_neurons=8, n_dimensions=2, n_input=2, n_groups=2)
        source = 'netsearch@name="moe_info"\nnetsearch@net="mixture of experts"\n'
        result = execute(source, mesh=mesh)
        self.assertIn("moe_info", result.netsearch_results)
        self.assertTrue(result.netsearch_results["moe_info"])
        self.assertIn("moe_info", result.neuron_ids)
        self.assertIn("moe_info", result.definitions)

    def test_execute_end_to_end_matches_spec_example(self):
        """Runs one program touching every DSL statement kind together."""
        mesh = NeuralMesh(n_neurons=16, n_dimensions=2, n_input=2, n_groups=3, seed=7)
        source = """
        name="vision"
        vision@value="0.8"
        vision@definition="Handles image recognition"
        name="reasoner"
        reasoner@connections="vision*0.6+0.1"
        code@name="parser"
        parser@code="def parse(x): return x"
        netsearch@name="quantization_info"
        netsearch@net="background quantization"
        """
        result = execute(source, mesh=mesh)
        self.assertEqual(
            set(result.neuron_ids),
            {"vision", "reasoner", "parser", "quantization_info"},
        )
        self.assertEqual(result.definitions["vision"], "Handles image recognition")
        self.assertIn("parser", result.code_imports)
        self.assertTrue(result.netsearch_results["quantization_info"])


if __name__ == "__main__":
    unittest.main()
