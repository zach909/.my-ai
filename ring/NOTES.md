# Linked crown

- Current request: six raised points and six lowered points around one closed ring; 24 rounded links and 24 separate hinge pins, with six links per color (blue, yellow, green, red).
- `crownParameters.kcl`: 22 mm hinge pitch, 15-degree step between joints, six four-link sectors. Joint heights in each sector repeat top / mid / bottom / mid, with 90-degree included angles at both upper and lower tips. `baseHeight = 22mm` and `crownRise` is approximately 15.4 mm from mid-level to either tip.
- `link.kcl` and `descendingLink.kcl` are opposite-hand canted fork-and-tongue parts, used twice per four-link sector. Each has 3.2 mm through-bores, 4.6 mm fork gap, and 4 mm tongue. Their five sketches are fully constrained and each part executes independently.
- `main.kcl` places 24 independent links and 24 independent pins and retains four color groups. Overview, front, and detail views checked after correction of clone-before-transform lineage; ring is connected with peaks on both top and bottom edges.
- `pin.kcl` unchanged (2.9 mm shaft and retaining heads). Prior planar 90/240 layout and twelve-top-tip layout are superseded; lower-joint angles now follow the three-dimensional closed ring rather than 240 degrees.
- Dimensions and hidden joint geometry are estimates from photos. No detents, motion simulation, collision-envelope, strength, or fabrication validation completed.
