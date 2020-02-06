(jasmine as any).getEnv().addReporter({
  specStarted: (result: any) => ((jasmine as any).currentTest = result),
  specDone: (result: any) => ((jasmine as any).currentTest = result)
});
