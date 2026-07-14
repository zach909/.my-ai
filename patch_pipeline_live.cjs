const fs = require('fs');
let code = fs.readFileSync('models && skills/core/pipeline.ts', 'utf-8');

code = code.replace(
  /      const predictedState = this\.selfModel\.predict\(meshInputs\);\n      \n      const propagation = this\.mesh!\.propagate\(meshInputs\);\n      const actualState = Array\.from\(propagation\.finalStates\.values\(\)\);\n      const noveltySignal = this\.selfModel\.update\(meshInputs, actualState\);/,
  `      const predictedState = this.selfModel.predict(meshInputs);
      
      let sustainedDivergence = 0;
      let lastNovelty = 0;
      const propagation = this.mesh!.propagate(meshInputs, (tickState) => {
        const currentArr = Array.from(tickState.values());
        const error = this.selfModel!.update(meshInputs, currentArr);
        lastNovelty = error;
        if (error > 0.5) sustainedDivergence++;
        else sustainedDivergence = 0;
        return sustainedDivergence >= 3;
      });
      
      if (!propagation.converged && sustainedDivergence >= 3) {
         console.warn('[LiveCorrection] Sustained divergence detected mid-flight, rerouting mesh.');
      }
      
      const actualState = Array.from(propagation.finalStates.values());
      const noveltySignal = lastNovelty || this.selfModel.update(meshInputs, actualState);`
);

fs.writeFileSync('models && skills/core/pipeline.ts', code, 'utf-8');
