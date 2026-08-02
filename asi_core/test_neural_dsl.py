"""Tests for the Neural Definition Language parser (spec Part 5 sections 76-78)."""

import unittest

from asi_core.neural_dsl import parse, to_source, describe_extension, NDLError
from asi_core.extension_system import Extension


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


if __name__ == "__main__":
    unittest.main()
