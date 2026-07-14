# Example: experts integrated into the mesh via NeuroLang DSL
dims = 4

# Declare a code analysis expert
code@name="analyzer"
"analyzer"@code="def factorial(n): return 1 if n <= 1 else n * factorial(n-1)"

# Declare a search expert
"netsearch"@name="docs"
"netsearch"@corpus="Factorial computes n!. Recursion divides problem. Base case is n<=1."

# Declare a skill that combines learning
skill@name="math_expert"

# Define neurons that route through the experts
name="input"
name="process"
"process"@definishon="the factorial function computes the product of positive integers"

# Train the mesh with experts
train
